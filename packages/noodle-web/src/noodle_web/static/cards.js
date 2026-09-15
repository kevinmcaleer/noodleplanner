/**
 * cards.js — reusable plan cards (#1050).
 *
 * A card is a named, portable fragment of the task outline: a task and its
 * whole subtree, captured as plain outline text (plan-model.js's
 * cardTextFor()/insertCardAfter() -- indented purely relative to its own
 * root, so it can be dropped in at any depth of a different plan). Cards
 * are stored client-side only, in localStorage, consistent with
 * project-storage.js and #766's "no server-side plan storage" constraint
 * -- this is a separate, much smaller store, not routed through
 * project-storage.js's IndexedDB-backed project store.
 *
 * A card can be inserted two ways:
 *  - "as tasks": structurally, via PlanModel.insertCardAfter(), anchored on
 *    a chosen task in the outline -- the fragment's own hierarchy is
 *    reconstructed at that point and the result is immediately a real,
 *    schedulable part of the plan.
 *  - "as plain text": spliced verbatim at the caller-supplied cursor
 *    position (via the `insertAtCursor` callback), for someone who wants
 *    to review or hand-edit the fragment before it becomes "real" on the
 *    next parse -- no PlanModel involved, so nothing is re-indented or
 *    re-anchored on their behalf.
 */
(function (root) {
    const PlanModel = root.NoodlePlanModel ? root.NoodlePlanModel.PlanModel :
        (typeof require === 'function' ? require('./plan-model.js').PlanModel : null);

    const CARDS_STORAGE_KEY = 'noodleplanner:cards';

    // ---- Storage (plain localStorage; see file header for why not project-storage.js) ----

    function loadCards() {
        try {
            const raw = localStorage.getItem(CARDS_STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            console.error('Error loading cards:', error);
            return [];
        }
    }

    function persistCards(cards) {
        try {
            localStorage.setItem(CARDS_STORAGE_KEY, JSON.stringify(cards));
            if (typeof clearStorageFailure === 'function') clearStorageFailure();
            return true;
        } catch (error) {
            if (typeof reportStorageFailure === 'function') reportStorageFailure('card library', error);
            else console.error('Error saving cards:', error);
            return false;
        }
    }

    function listCards() {
        return loadCards().slice().sort((a, b) => a.name.localeCompare(b.name));
    }

    function makeCardId() {
        return 'card_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    }

    /** Returns the saved record, or null if `name`/`text` was blank or the write failed. */
    function saveCard(name, text) {
        const trimmedName = String(name || '').trim();
        const trimmedText = String(text || '').replace(/\s+$/, '');
        if (!trimmedName || !trimmedText) return null;
        const cards = loadCards();
        const record = { id: makeCardId(), name: trimmedName, text: trimmedText, createdAt: new Date().toISOString() };
        cards.push(record);
        return persistCards(cards) ? record : null;
    }

    function getCard(id) {
        return loadCards().find(card => card.id === id) || null;
    }

    function deleteCard(id) {
        const cards = loadCards();
        const next = cards.filter(card => card.id !== id);
        if (next.length === cards.length) return false;
        return persistCards(next);
    }

    // ---- Pure plan-text operations, via PlanModel ----

    /** The named task's subtree as card text, or '' if the task isn't found. */
    function cardTextForTask(planText, taskName) {
        const model = PlanModel.parse(planText);
        const task = model.findByName(taskName);
        if (!task) return '';
        return model.cardTextFor(task);
    }

    /**
     * Insert `cardText` as new sibling tasks immediately after the task
     * named `afterTaskName`, at that task's own indent. Returns the
     * updated plan text unchanged if the anchor task can't be found or the
     * card has no content.
     */
    function insertCardAsTasks(planText, afterTaskName, cardText) {
        const model = PlanModel.parse(planText);
        const afterTask = model.findByName(afterTaskName);
        if (!afterTask) return planText;
        const inserted = model.insertCardAfter(afterTask, afterTask.indent, cardText);
        if (!inserted.length) return planText;
        return model.serialize();
    }

    // ---- Popup UI: a self-contained overlay, injected/removed on open/close ----

    function el(tag, className, attrs) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (attrs) for (const key of Object.keys(attrs)) node.setAttribute(key, attrs[key]);
        return node;
    }

    function escapeCardHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function lineCount(text) {
        return String(text || '').split(/\r\n|\n|\r/).filter(line => line.trim() !== '').length;
    }

    /**
     * Open the card library popup for a task: save that task's subtree as
     * a new card, or browse and insert an existing card relative to it.
     *
     * @param {{getText():string, setText(text:string):void, taskName:string,
     *          insertAtCursor?:(text:string)=>void}} options
     */
    function openCardLibraryPopup(options) {
        const { getText, setText, taskName, insertAtCursor } = options;
        const existing = document.getElementById('cardLibraryOverlay');
        if (existing) existing.remove();

        const overlay = el('div', 'card-popup-overlay', { id: 'cardLibraryOverlay' });
        const dialog = el('div', 'card-popup');
        dialog.innerHTML = `
            <div class="card-popup-header">
                <span>Snippets</span>
                <np-close-button flat></np-close-button>
            </div>
            <div class="card-popup-body">
                <div class="card-save-section">
                    <label class="card-save-label">Save "${escapeCardHtml(taskName)}" and its subtree as a snippet
                        <div class="card-save-row">
                            <input type="text" id="cardSaveName" placeholder="Snippet name">
                            <button type="button" class="card-save-btn" id="cardSaveBtn">Save</button>
                        </div>
                    </label>
                </div>
                <div class="card-list-section">
                    <div class="card-list-heading">Insert a saved snippet after "${escapeCardHtml(taskName)}"</div>
                    <div class="card-list" id="cardLibraryList"></div>
                </div>
            </div>
            <div class="card-popup-footer">
                <button type="button" class="card-popup-cancel">Close</button>
            </div>
        `;
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        function close() { overlay.remove(); }
        dialog.querySelector('np-close-button').addEventListener('close', close);
        dialog.querySelector('.card-popup-cancel').addEventListener('click', close);
        overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });

        function renderList() {
            const listEl = dialog.querySelector('#cardLibraryList');
            const cards = listCards();
            if (!cards.length) {
                listEl.innerHTML = '<np-empty-state>No snippets saved yet.</np-empty-state>';
                return;
            }
            listEl.innerHTML = '';
            cards.forEach(card => {
                const row = el('div', 'card-list-row');
                row.innerHTML = `
                    <div class="card-list-info">
                        <div class="card-list-name">${escapeCardHtml(card.name)}</div>
                        <div class="card-list-meta">${lineCount(card.text)} task${lineCount(card.text) === 1 ? '' : 's'}</div>
                    </div>
                    <div class="card-list-actions">
                        <button type="button" class="card-insert-tasks-btn">Insert as Tasks</button>
                        <button type="button" class="card-insert-text-btn">Insert as Text</button>
                        <np-button type="button" class="card-delete-btn" icon-only variant="danger" size="small" label="Delete snippet"><span slot="icon">🗑</span></np-button>
                    </div>
                `;
                row.querySelector('.card-insert-tasks-btn').addEventListener('click', () => {
                    const result = insertCardAsTasks(getText(), taskName, card.text);
                    setText(result);
                    close();
                });
                row.querySelector('.card-insert-text-btn').addEventListener('click', () => {
                    if (typeof insertAtCursor === 'function') insertAtCursor(card.text);
                    else setText(getText().replace(/\n+$/, '') + '\n' + card.text + '\n');
                    close();
                });
                row.querySelector('.card-delete-btn').addEventListener('click', () => {
                    deleteCard(card.id);
                    renderList();
                });
                listEl.appendChild(row);
            });
        }

        dialog.querySelector('#cardSaveBtn').addEventListener('click', () => {
            const nameInput = dialog.querySelector('#cardSaveName');
            const text = cardTextForTask(getText(), taskName);
            if (!text) return;
            const record = saveCard(nameInput.value, text);
            if (!record) return;
            nameInput.value = '';
            renderList();
        });

        renderList();
    }

    const api = {
        listCards, saveCard, getCard, deleteCard,
        cardTextForTask, insertCardAsTasks,
        openCardLibraryPopup,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.CardLibrary = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
