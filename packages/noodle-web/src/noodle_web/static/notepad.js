/**
 * notepad.js — the simple, notepad-style plan entry surface (#1049).
 *
 * A second, deliberately minimal way into a plan: type a line, press
 * Enter, get a task; Tab / Shift+Tab indent and outdent; drag to reorder.
 * A Kanban mode on the same content groups tasks for quick moving around.
 * No front matter, no token syntax, no PM-only controls are shown -- only
 * task names -- but the Markdown underneath is unchanged and every edit
 * round-trips through NoodlePlanModel (plan-model.js), never regex.
 *
 * Generic by design: NotepadSurface.mount(container, { getText, setText })
 * knows nothing about NoodlePlanner's editor/project/localStorage
 * machinery. It only reads and writes plan text through the two callbacks
 * it is given, so the collab joiner surface (#970) can reuse it as-is.
 */
(function (root) {
    const PlanModel = root.NoodlePlanModel ? root.NoodlePlanModel.PlanModel :
        (typeof require === 'function' ? require('./plan-model.js').PlanModel : null);

    /**
     * Kanban-mode grouping over the same in-memory model. Columns are
     * top-level (root) tasks -- "phases" -- with their children as cards.
     * A root with no children renders as an empty drop target rather than
     * being treated as a card itself, so the column/card relationship
     * stays unambiguous while dragging. If the whole plan is flat (no root
     * has any children at all -- the common case for a first 20-task list
     * with no phases yet), everything collapses into a single "All Tasks"
     * column so Kanban mode is never simply empty for a beginner.
     */
    function computeKanbanColumns(model) {
        if (!model || !model.roots.length) return [];
        const anyNesting = model.roots.some(r => r.children.length > 0);
        if (!anyNesting) {
            return [{ id: 'all', title: 'All Tasks', root: null, cards: model.roots.slice() }];
        }
        return model.roots.map(r => ({ id: r.id, title: r.name || '(untitled)', root: r, cards: r.children.slice() }));
    }

    function el(tag, className, attrs) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (attrs) for (const key of Object.keys(attrs)) node.setAttribute(key, attrs[key]);
        return node;
    }

    class NotepadSurface {
        constructor(container, options) {
            this.container = container;
            this.options = options || {};
            this.mode = 'list';
            this.model = null;
            this._dragTask = null;
            this._buildChrome();
            this.refresh();
        }

        _buildChrome() {
            this.container.innerHTML = '';
            this.container.classList.add('notepad-surface');
            this.toolbar = el('div', 'notepad-toolbar');
            this.listModeBtn = el('button', 'notepad-mode-btn', { type: 'button' });
            this.listModeBtn.textContent = 'List';
            this.listModeBtn.addEventListener('click', () => this.setMode('list'));
            this.kanbanModeBtn = el('button', 'notepad-mode-btn', { type: 'button' });
            this.kanbanModeBtn.textContent = 'Kanban';
            this.kanbanModeBtn.addEventListener('click', () => this.setMode('kanban'));
            this.toolbar.appendChild(this.listModeBtn);
            this.toolbar.appendChild(this.kanbanModeBtn);
            this.body = el('div', 'notepad-body');
            this.container.appendChild(this.toolbar);
            this.container.appendChild(this.body);
        }

        /** Re-read plan text from the caller and re-render the current mode. */
        refresh() {
            const text = this.options.getText ? this.options.getText() : '';
            this.model = PlanModel.parse(text);
            this._render();
        }

        setMode(mode) {
            this.mode = mode === 'kanban' ? 'kanban' : 'list';
            this._render();
        }

        getMode() { return this.mode; }

        _commit() {
            const text = this.model.serialize();
            if (this.options.setText) this.options.setText(text);
            if (this.options.onChange) this.options.onChange(text);
        }

        _render() {
            this.listModeBtn.classList.toggle('active', this.mode === 'list');
            this.kanbanModeBtn.classList.toggle('active', this.mode === 'kanban');
            this.body.innerHTML = '';
            if (this.mode === 'kanban') this._renderKanban();
            else this._renderList();
        }

        // ---- List mode -----------------------------------------------

        _renderList() {
            const list = el('div', 'notepad-list');
            if (!this.model.tasks.length) {
                const empty = el('div', 'notepad-empty-row');
                empty.textContent = 'Type a task and press Enter to get started.';
                list.appendChild(empty);
            }
            for (const task of this.model.tasks) {
                list.appendChild(this._buildRow(task));
            }
            const addRow = el('button', 'notepad-add-row', { type: 'button' });
            addRow.textContent = '+ Add task';
            addRow.addEventListener('click', () => {
                const last = this.model.tasks[this.model.tasks.length - 1] || null;
                const node = this.model.insertTaskAfter(last, '');
                this._commit();
                this._render();
                this._focusRow(node.id, true);
            });
            this.body.appendChild(list);
            this.body.appendChild(addRow);
        }

        _buildRow(task) {
            const row = el('div', 'notepad-row', { 'data-task-id': String(task.id) });
            row.style.paddingLeft = (task.indent * 10) + 'px';

            const handle = el('span', 'notepad-drag-handle', { 'aria-hidden': 'true' });
            handle.textContent = '⠿';
            this._wireDrag(handle, row, task);

            const text = el('div', 'notepad-row-text', {
                contenteditable: 'true',
                'data-task-id': String(task.id),
                role: 'textbox',
                'aria-label': 'Task',
            });
            text.textContent = task.name;
            this._wireRowText(text, task);

            row.appendChild(handle);
            row.appendChild(text);
            row.appendChild(this._buildEstimateButton(task));
            return row;
        }

        /** Optional -- only rendered when estimating.js (#1053) is loaded,
         * so NotepadSurface stays usable standalone without it. */
        _buildEstimateButton(task) {
            if (typeof EstimatingTool === 'undefined') return el('span', null);
            const btn = el('button', 'estimate-open-btn', { type: 'button', title: 'Estimate' });
            btn.textContent = '⏱';
            btn.addEventListener('click', () => {
                EstimatingTool.openEstimatePopup({
                    getText: () => this.model.serialize(),
                    setText: (text) => { this.options.setText ? this.options.setText(text) : null; this.refresh(); },
                    taskName: task.name,
                });
            });
            return btn;
        }

        _wireRowText(text, task) {
            const commitRename = () => {
                const value = text.textContent.replace(/\s+/g, ' ').trim();
                if (value !== task.name) {
                    this.model.rename(task, value);
                    this._commit();
                }
            };
            text.addEventListener('blur', commitRename);
            text.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    commitRename();
                    const node = this.model.insertTaskAfter(task, '');
                    this._commit();
                    this._render();
                    this._focusRow(node.id, true);
                    return;
                }
                if (event.key === 'Tab') {
                    event.preventDefault();
                    commitRename();
                    if (event.shiftKey) this.model.outdentTasks([task]);
                    else this.model.indentTasks([task]);
                    this._commit();
                    this._render();
                    this._focusRow(task.id, true);
                    return;
                }
                if (event.key === 'Backspace' && !text.textContent) {
                    if (task.children.length) return;
                    event.preventDefault();
                    const index = this.model.tasks.indexOf(task);
                    const previous = index > 0 ? this.model.tasks[index - 1] : null;
                    if (!this.model.removeTask(task)) return;
                    this._commit();
                    this._render();
                    if (previous) this._focusRow(previous.id, true);
                }
            });
        }

        _focusRow(taskId, atEnd) {
            const node = this.body.querySelector(`.notepad-row-text[data-task-id="${taskId}"]`);
            if (!node) return;
            node.focus();
            if (atEnd && typeof window.getSelection === 'function' && node.firstChild) {
                const range = document.createRange();
                range.selectNodeContents(node);
                range.collapse(false);
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
            }
        }

        // ---- Drag to reorder (pointer events -- works for mouse & touch) --

        _wireDrag(handle, row, task) {
            handle.addEventListener('pointerdown', (event) => {
                event.preventDefault();
                this._dragTask = task;
                row.classList.add('notepad-row-dragging');
                const onMove = (moveEvent) => {
                    const target = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
                    const targetRow = target && target.closest ? target.closest('.notepad-row') : null;
                    this.body.querySelectorAll('.notepad-row-drop-before, .notepad-row-drop-after')
                        .forEach(node => node.classList.remove('notepad-row-drop-before', 'notepad-row-drop-after'));
                    if (!targetRow || targetRow === row) return;
                    const rect = targetRow.getBoundingClientRect();
                    const before = moveEvent.clientY < rect.top + rect.height / 2;
                    targetRow.classList.add(before ? 'notepad-row-drop-before' : 'notepad-row-drop-after');
                };
                const onUp = (upEvent) => {
                    window.removeEventListener('pointermove', onMove);
                    window.removeEventListener('pointerup', onUp);
                    row.classList.remove('notepad-row-dragging');
                    const dropBefore = this.body.querySelector('.notepad-row-drop-before');
                    const dropAfter = this.body.querySelector('.notepad-row-drop-after');
                    this.body.querySelectorAll('.notepad-row-drop-before, .notepad-row-drop-after')
                        .forEach(node => node.classList.remove('notepad-row-drop-before', 'notepad-row-drop-after'));
                    const dragged = this._dragTask;
                    this._dragTask = null;
                    let moved = false;
                    if (dropBefore) {
                        const targetTask = this.model.findById(Number(dropBefore.dataset.taskId));
                        moved = this.model.moveBefore(dragged, targetTask);
                    } else if (dropAfter) {
                        const targetTask = this.model.findById(Number(dropAfter.dataset.taskId));
                        moved = this.model.moveAfter(dragged, targetTask);
                    }
                    if (moved) {
                        this._commit();
                        this._render();
                    }
                };
                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', onUp, { once: true });
            });
        }

        // ---- Kanban mode -----------------------------------------------

        _renderKanban() {
            const columns = computeKanbanColumns(this.model);
            const board = el('div', 'notepad-kanban-board');
            if (!columns.length) {
                const empty = el('div', 'notepad-empty-row');
                empty.textContent = 'Type a task in List mode to get started.';
                board.appendChild(empty);
            }
            for (const column of columns) {
                board.appendChild(this._buildColumn(column));
            }
            this.body.appendChild(board);
        }

        _buildColumn(column) {
            const el_ = el('div', 'notepad-kanban-column', { 'data-column-id': String(column.id) });
            const header = el('div', 'notepad-kanban-column-header');
            header.textContent = column.title;
            el_.appendChild(header);
            const cardList = el('div', 'notepad-kanban-card-list');
            for (const card of column.cards) {
                cardList.appendChild(this._buildCard(card));
            }
            if (!column.cards.length) {
                const placeholder = el('div', 'notepad-kanban-placeholder');
                placeholder.textContent = 'Drop tasks here';
                cardList.appendChild(placeholder);
            }
            el_.appendChild(cardList);
            return el_;
        }

        _buildCard(task) {
            const card = el('div', 'notepad-kanban-card', { 'data-task-id': String(task.id) });
            const handle = el('span', 'notepad-drag-handle', { 'aria-hidden': 'true' });
            handle.textContent = '⠿';
            const text = el('div', 'notepad-row-text', { contenteditable: 'true' });
            text.textContent = task.name;
            text.addEventListener('blur', () => {
                const value = text.textContent.replace(/\s+/g, ' ').trim();
                if (value !== task.name) {
                    this.model.rename(task, value);
                    this._commit();
                }
            });
            card.appendChild(handle);
            card.appendChild(text);
            this._wireCardDrag(handle, card, task);
            return card;
        }

        /**
         * Card drag, same Pointer Events technique as list-mode row drag
         * (_wireDrag) rather than native HTML5 drag-and-drop -- native DnD
         * has no default touch support, and #1049 requires drag-to-reorder
         * to work on touch.
         */
        _wireCardDrag(handle, card, task) {
            handle.addEventListener('pointerdown', (event) => {
                event.preventDefault();
                this._dragTask = task;
                card.classList.add('notepad-row-dragging');
                const onMove = (moveEvent) => {
                    const target = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
                    const column = target && target.closest ? target.closest('.notepad-kanban-column') : null;
                    this.body.querySelectorAll('.notepad-kanban-column-drop-target')
                        .forEach(node => node.classList.remove('notepad-kanban-column-drop-target'));
                    if (column) column.classList.add('notepad-kanban-column-drop-target');
                };
                const onUp = () => {
                    window.removeEventListener('pointermove', onMove);
                    window.removeEventListener('pointerup', onUp);
                    card.classList.remove('notepad-row-dragging');
                    const dropColumn = this.body.querySelector('.notepad-kanban-column-drop-target');
                    this.body.querySelectorAll('.notepad-kanban-column-drop-target')
                        .forEach(node => node.classList.remove('notepad-kanban-column-drop-target'));
                    const dragged = this._dragTask;
                    this._dragTask = null;
                    if (!dropColumn) return;
                    const column = computeKanbanColumns(this.model)
                        .find(c => String(c.id) === dropColumn.dataset.columnId);
                    if (!column) return;
                    let moved = false;
                    if (column.root) {
                        moved = this.model.moveAsChild(dragged, column.root, true);
                    } else if (column.cards.length && dragged !== column.cards[0]) {
                        moved = this.model.moveAsRoot(dragged);
                    }
                    if (moved) {
                        this._commit();
                        this._render();
                    }
                };
                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', onUp, { once: true });
            });
        }

        destroy() {
            this.container.innerHTML = '';
        }
    }

    function mount(container, options) {
        return new NotepadSurface(container, options);
    }

    const api = { mount, computeKanbanColumns, NotepadSurface };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.NotepadSurface = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
