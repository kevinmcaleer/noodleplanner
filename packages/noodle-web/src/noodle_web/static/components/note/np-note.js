/**
 * <np-note> -- the whiteboard post-it, at the fidelity the app actually ships.
 *
 * Phase A of the post-it consolidation epic (#1241), issue #1242. This file
 * contains *no redesign*. Its only job is that a note in Storybook renders
 * what a note on the board renders, noise included -- so that the alignment
 * and visual-noise work that follows is done against the real thing.
 *
 * ## Why that mattered enough to rewrite the file
 *
 * The previous <np-note> (the #1193 pilot) modelled a title, an inert menu
 * button, rows of `checkbox -> name`, and a footer. The shipping note's header
 * carries a title and six buttons; its checklist row carries up to ten
 * children; its card has a parent caption and a resize grip. The reported
 * problem with the note is crowding, and the crowding lives entirely in the
 * controls the pilot did not model -- so a row of `checkbox -> name` would
 * have laid out beautifully in Storybook and changed nothing on the board.
 *
 * ## Light DOM, deliberately
 *
 * Every other component here renders into a shadow root, and
 * `../README.md` states the convention: only `--np-*` custom properties
 * cross that boundary, so a component never depends on a global class name.
 * This one inverts that goal on purpose, and renders into the light DOM using
 * the app's own `.wb-note-*` class names, styled by the app's own
 * `views/whiteboard.css`. Three reasons, in order of weight:
 *
 *  1. **The whiteboard reaches into the note from outside it.**
 *     `wbNoteRowRectFor()` (whiteboard-dep-noodles.js) finds rows with
 *     `querySelectorAll('.wb-note-row[data-wb-row-task]')` and reads
 *     `row.dataset.wbRowTask`; the row dependency drag resolves its drop
 *     target with `document.elementFromPoint()` then `.closest('.wb-note-row')`;
 *     the note drag bails out of a header press via
 *     `e.target.closest('.wb-note-link-handle')`. None of that survives
 *     retargeting across a shadow boundary, and a `part` does nothing for any
 *     of it -- `part` is styling only. Adopting a shadow-root note would mean
 *     inventing a component API for every one of those call sites first.
 *  2. **The styles this component needs are the app's own.** Fidelity means
 *     rendering under `views/whiteboard.css`. In a shadow root that stylesheet
 *     does not reach the markup, so it would have to be adopted in
 *     (`adoptedStyleSheets`, an async fetch) or -- far worse -- retyped, which
 *     is the exact copy-paste divergence #1187 exists to stop. The pilot had
 *     already drifted twice that way: `rgba(0,0,0,0.08)` against the app's
 *     `0.1`, and a `:focus-visible` ring the app's own button does not have.
 *  3. **Both browser suites read the note from the light DOM**, by class name
 *     (`tests/test_whiteboard_notes.py`, `tests/ui/test_task_peek.py`).
 *
 * So: no `.wb-note-*` declaration is written in this file at all. If the note
 * looks wrong here, it looks wrong on the board, which is the whole promise
 * (`docs/design/consolidation-and-handoff.md`). Storybook already injects the
 * app's stylesheets in the app's own load order, so nothing extra is needed
 * there.
 *
 * `tests/test_np_note_fidelity.mjs` fails when the app grows a note control
 * this file does not model.
 *
 * ## Usage
 *
 *   <script type="module" src="/static/components/note/np-note.js"></script>
 *   <np-note task="Build" colour="#FCE38A" parent="Phase 1"></np-note>
 *   <script>
 *     document.querySelector('np-note').rows = [
 *       { name: 'Ship Widget', complete: true, deliverable: 'Widget',
 *         resources: ['sam'] },
 *       { name: 'Nested', hasChildren: true, childCount: 2 },
 *     ];
 *   </script>
 *
 * `rows` mirrors the child view-models `wbBuildNoteViewModel()` builds:
 * `{ name, complete, hasChildren, childCount, resources, deliverable,
 *    planningType, languageHint, date, depTarget }`.
 */

// whiteboard-notes.js's own constants, which are what decide how crowded a
// row looks. A component previewing 40px narrower than a real note (the
// pilot was 220) is not a cosmetic difference here.
export const WB_NOTE_DEFAULT_WIDTH = 260;
export const WB_NOTE_DEFAULT_HEIGHT = 220;
export const WB_NOTE_MIN_WIDTH = 160;
export const WB_NOTE_MIN_HEIGHT = 120;

/** Avatars rendered inline on a checklist row before the overflow chip takes
 * over -- whiteboard-notes.js's WB_ROW_AVATAR_CAP (#1243). */
export const WB_ROW_AVATAR_CAP = 3;

/** The shipped pastel palette (whiteboard-notes.js's WB_NOTE_PASTEL_COLOURS).
 * The pilot's story offered six colours, not one of which is in this list. */
export const WB_NOTE_PASTEL_COLOURS = [
    '#FFF3B0', '#FCE38A', // yellow
    '#FFD6E0', '#F7A8B8', // pink
    '#CFF4D2', '#B8E6B8', // green
    '#C7E5FF', '#A9D6F5', // blue
    '#FFCBC1', '#FFAFA3', // red
];

/** WCAG relative luminance of a #RRGGBB colour. Ported verbatim from
 * whiteboard-notes.js's wbRelativeLuminance(). */
function relativeLuminance(hex) {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || '').trim());
    if (!m) return null;
    const int = parseInt(m[1], 16);
    const rgb = [(int >> 16) & 255, (int >> 8) & 255, int & 255].map((c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

/** WCAG contrast ratio between two #RRGGBB colours. Ported from
 * whiteboard-notes.js's wbContrastRatio(). */
export function contrastRatio(hexA, hexB) {
    const lA = relativeLuminance(hexA);
    const lB = relativeLuminance(hexB);
    if (lA === null || lB === null) return null;
    return (Math.max(lA, lB) + 0.05) / (Math.min(lA, lB) + 0.05);
}

/**
 * The note's one text colour, by real measured contrast.
 *
 * Ported from whiteboard-notes.js's wbContrastTextColour(), values included.
 * The pilot had its own: a `luminance > 0.5` threshold returning
 * `#1a1a1a`/`#ffffff`, and `#333333` for anything unparseable -- two different
 * algorithms and four different values, so a Storybook note could legitimately
 * show text the app would never render. Returns null for an invalid colour so
 * the caller falls back to the themed default, exactly as the app does.
 */
export function contrastTextColour(bgHex) {
    if (!bgHex) return null;
    const dark = '#161616';
    const light = '#fafafa';
    const ratioDark = contrastRatio(bgHex, dark);
    const ratioLight = contrastRatio(bgHex, light);
    if (ratioDark === null || ratioLight === null) return null;
    return ratioDark >= ratioLight ? dark : light;
}

/** wbGetInitials(): first letters of the first two words, or the first two
 * letters of a single word, uppercased. */
export function getInitials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
}

const el = (tag, className, attrs) => {
    const node = document.createElement(tag);
    if (className) node.setAttribute('class', className);
    for (const [k, v] of Object.entries(attrs || {})) {
        if (v !== null && v !== undefined) node.setAttribute(k, String(v));
    }
    return node;
};

export class NpNote extends HTMLElement {
    static get observedAttributes() {
        return [
            'task', 'title', 'colour', 'color', 'parent', 'comment', 'rows',
            'resources', 'width', 'height',
            'freeform', 'title-only', 'selected', 'flash', 'park-armed',
            'parking', 'link-target', 'link-target-invalid', 'editing',
        ];
    }

    constructor() {
        super();
        this._rows = [];
        this._resources = [];
        this._built = false;
    }

    connectedCallback() {
        this._build();
        this._render();
    }

    attributeChangedCallback(name, _old, value) {
        if (name === 'rows' && value) {
            try { this._rows = JSON.parse(value); } catch { this._rows = []; }
        }
        if (name === 'resources' && value) {
            this._resources = value.split(',').map((r) => r.trim()).filter(Boolean);
        }
        if (this._built) this._render();
    }

    get rows() { return this._rows; }
    set rows(value) { this._rows = Array.isArray(value) ? value : []; if (this._built) this._render(); }

    get resources() { return this._resources; }
    set resources(value) { this._resources = Array.isArray(value) ? value : []; if (this._built) this._render(); }

    /** The task name, as `.wb-note`'s `data-wb-task` carries it. */
    get task() { return this.getAttribute('task') || this.getAttribute('title') || 'Untitled note'; }

    // ── Skeleton ────────────────────────────────────────────────────────
    //
    // Built once and updated in place, mirroring the app's own split between
    // wbCreateNoteNode() (static skeleton, cached refs) and wbUpdateNoteNode()
    // (per-render fill). Children are appended in the app's order:
    // header, parent caption, body, footer, resize handle.

    _build() {
        if (this._built) return;
        this.replaceChildren();

        // `.wb-note` is the foreignObject wrapper on the board, and carries the
        // park-armed/parking states -- so it is the host element here, not a
        // child. `.wb-note-card` is what everything else hangs off.
        this.classList.add('wb-note');

        const card = el('div', 'wb-note-card');
        const header = el('div', 'wb-note-header');

        const title = el('p', 'wb-note-title');
        const dateBtn = el('button', 'wb-note-smart-btn wb-note-date-btn',
            { type: 'button', 'aria-label': 'Attach detected date' });
        const resourceBtn = el('button', 'wb-note-smart-btn wb-note-resource-btn',
            { type: 'button', 'aria-label': 'Assign a resource', 'aria-haspopup': 'menu', 'aria-expanded': 'false' });
        resourceBtn.textContent = '＋';
        resourceBtn.title = 'Quick assign';
        const linkHandle = el('button', 'wb-note-link-handle',
            { type: 'button', 'aria-label': 'Draw a link to another note' });
        linkHandle.innerHTML = LINK_HANDLE_SVG;
        const coachBtn = el('button', 'wb-note-coach-btn',
            { type: 'button', 'aria-label': 'Planning prompts', 'aria-haspopup': 'dialog' });
        const promoteBtn = el('button', 'wb-note-promote-btn',
            { type: 'button', 'aria-label': 'Promote to task' });
        promoteBtn.textContent = '⇧';
        const menuBtn = el('button', 'wb-note-menu-btn',
            { type: 'button', 'aria-label': 'Note options', 'aria-haspopup': 'true', 'aria-expanded': 'false' });
        menuBtn.textContent = '⋮';
        menuBtn.addEventListener('click', (e) => { e.stopPropagation(); this._toggleMenu(menuBtn); });

        header.append(title, dateBtn, resourceBtn, linkHandle, coachBtn, promoteBtn, menuBtn);

        const parentCaption = el('div', 'wb-note-parent');
        const body = el('div', 'wb-note-body');
        const footer = el('div', 'wb-note-footer');
        const progress = el('span', 'wb-note-progress');
        const avatars = el('div', 'wb-note-avatars');
        footer.append(progress, avatars);
        const resizeHandle = el('div', 'wb-note-resize-handle', { 'aria-hidden': 'true' });

        card.append(header, parentCaption, body, footer, resizeHandle);
        this.appendChild(card);

        this._refs = {
            card, header, title, dateBtn, resourceBtn, linkHandle, coachBtn,
            promoteBtn, menuBtn, parentCaption, body, footer, progress, avatars,
        };
        this._built = true;
    }

    // ── Render ──────────────────────────────────────────────────────────

    _render() {
        const r = this._refs;
        if (!r) return;

        const task = this.task;
        this.dataset.wbTask = task;

        // Sizing: the host is the note box. On the board wbUpdateNoteNode()
        // clamps width/height into the min/default; the same clamp here so a
        // story cannot preview a note narrower than one can actually be.
        const width = Math.max(WB_NOTE_MIN_WIDTH, Number(this.getAttribute('width')) || WB_NOTE_DEFAULT_WIDTH);
        const height = Math.max(WB_NOTE_MIN_HEIGHT, Number(this.getAttribute('height')) || WB_NOTE_DEFAULT_HEIGHT);
        this.style.width = `${width}px`;
        this.style.height = `${height}px`;

        // Colour fills the whole card raw (#1103) and the one text colour is
        // derived from it by real measured contrast.
        const colour = this.getAttribute('colour') || this.getAttribute('color') || '';
        const text = contrastTextColour(colour);
        if (colour) r.card.style.setProperty('--wb-note-accent', colour); else r.card.style.removeProperty('--wb-note-accent');
        if (text) r.card.style.setProperty('--wb-note-text', text); else r.card.style.removeProperty('--wb-note-text');

        const freeform = this.hasAttribute('freeform');
        const titleOnly = this.hasAttribute('title-only');

        r.card.classList.toggle('wb-note-title-only', titleOnly);
        r.card.classList.toggle('wb-note-freeform', freeform);
        r.card.classList.toggle('wb-note-selected', this.hasAttribute('selected'));
        r.card.classList.toggle('wb-note-flash', this.hasAttribute('flash'));
        r.card.classList.toggle('wb-link-target', this.hasAttribute('link-target'));
        r.card.classList.toggle('wb-link-target-invalid', this.hasAttribute('link-target-invalid'));
        // These two sit on the foreignObject wrapper in the app, which is this
        // host element -- not on the card.
        this.classList.toggle('wb-note-park-armed', this.hasAttribute('park-armed'));
        this.classList.toggle('wb-note-parking', this.hasAttribute('parking'));

        r.title.textContent = task;
        r.title.title = `${task} (double-click to rename)`;
        r.title.classList.toggle('editing', this.hasAttribute('editing'));

        // Header buttons, under their real conditions.
        const date = this.getAttribute('data-date-suggestion');
        r.dateBtn.style.display = date ? '' : 'none';
        if (date) r.dateBtn.textContent = date;
        const planningType = this.getAttribute('data-planning-type');
        r.coachBtn.textContent = planningType === 'product' ? 'P' : planningType === 'activity' ? 'A' : '✦';
        r.coachBtn.classList.toggle('typed', Boolean(planningType));
        r.coachBtn.classList.toggle('suspected-activity',
            this.hasAttribute('language-hint') && !planningType);
        // Free-form notes only, and fully opaque when shown.
        r.promoteBtn.style.display = freeform ? '' : 'none';

        // The "under X" caption, shown only when the parent note is on the
        // board too. Hidden at the title-only tier by the app's own CSS.
        const parent = this.getAttribute('parent');
        r.parentCaption.textContent = parent ? `under ${parent}` : '';
        r.parentCaption.style.display = parent ? '' : 'none';

        this._renderBody(freeform);
        this._renderFooter(freeform);
    }

    _renderBody(freeform) {
        const r = this._refs;
        const children = [];

        if (freeform) {
            // A free-form note with no comment renders an entirely blank body,
            // deliberately (#885): nothing prompts for detail. The pilot always
            // appended a paragraph, empty or not.
            const comment = this.getAttribute('comment');
            if (comment) {
                const text = el('p', 'wb-note-freetext');
                text.textContent = comment;
                children.push(text);
            }
            r.body.replaceChildren(...children);
            return;
        }

        if (!this._rows.length) {
            const empty = el('p', 'wb-note-empty');
            // Both of the app's strings, not a third one. The pilot hardcoded
            // "No child tasks", which the app never renders.
            const linked = Number(this.getAttribute('linked-notes')) || 0;
            empty.textContent = linked
                ? `${linked} linked note${linked === 1 ? '' : 's'}`
                : 'No subtasks yet';
            children.push(empty);
        } else {
            children.push(...this._rows.map((row) => this._buildRow(row)));
        }

        const linkedSummary = this.getAttribute('linked-summary');
        if (linkedSummary) {
            const line = el('div', 'wb-note-linked-summary');
            line.textContent = linkedSummary;
            children.push(line);
        }

        // Always present on a non-free-form note (#1104), on every render.
        children.push(this._buildAddRow());
        r.body.replaceChildren(...children);
    }

    /**
     * One checklist row, with every child wbBuildChildRow() appends, in the
     * same DOM order and under the same condition.
     *
     * The order is the point of this method: it is feature-arrival order, not
     * a designed one, and reproducing it faithfully is what makes the
     * alignment problem visible in Storybook. Note the deliverable badge sits
     * *between* the checkbox and the name, so the name's start position moves
     * row to row.
     */
    _buildRow(vm) {
        const name = vm.name || '';
        const row = el('div', 'wb-note-row');
        row.dataset.wbRowTask = name;
        row.dataset.wbRowSummary = vm.hasChildren ? 'true' : 'false';

        // ── Lead zone ──────────────────────────────────────────────────
        // The bare native checkbox the app ships. Not the round
        // `--np-success`-green one the pilot invented, which exists nowhere in
        // NoodlePlanner. Whether the app *should* have a designed checkbox is
        // a later question, and it cannot be asked honestly while Storybook
        // already shows one.
        const checkbox = el('input', 'wb-note-checkbox', { type: 'checkbox' });
        checkbox.checked = Boolean(vm.complete);
        checkbox.title = vm.complete ? 'Mark as incomplete' : 'Mark as complete';
        checkbox.setAttribute('aria-label',
            `Mark "${name}" as ${vm.complete ? 'incomplete' : 'complete'}`);
        row.appendChild(checkbox);

        // The deliverable badge's slot reserves its width whether or not this
        // child has one, so names start on the same x down the card (#1243).
        const badgeSlot = el('div', 'wb-note-row-badge');
        if (vm.deliverable) {
            const badge = el('span', 'wb-note-deliverable-badge', { title: `Deliverable: ${vm.deliverable}` });
            badge.textContent = '$';
            badgeSlot.appendChild(badge);
        }
        row.appendChild(badgeSlot);

        // ── Name zone ──────────────────────────────────────────────────
        const label = el('span', 'wb-note-row-name', { title: name });
        label.textContent = name;
        row.appendChild(label);

        const content = el('div', 'wb-note-row-content');
        row.appendChild(content);

        if (vm.date) {
            const date = el('button', 'wb-note-row-smart wb-note-row-date', {
                type: 'button',
                'aria-haspopup': 'dialog',
                'aria-expanded': 'false',
                'aria-label': `Attach detected date ${vm.date} to ${name}`,
            });
            date.textContent = vm.date;
            date.title = `Attach ${vm.date}`;
            content.appendChild(date);
        }

        if (vm.hasChildren) {
            const badge = el('button', 'wb-note-count-badge', {
                type: 'button',
                'aria-haspopup': 'dialog',
                'aria-expanded': 'false',
                'aria-label': `${name} has ${vm.childCount || 0} subtasks. Peek subtasks.`,
            });
            badge.textContent = `${vm.childCount || 0} \u25BE`;
            content.appendChild(badge);
            row.classList.add('wb-note-row-drillable');
        }

        // ── Trailing gutter ────────────────────────────────────────────
        // Constant width on every row, so these three slots start at the same
        // x whichever of them a given child actually fills.
        const gutter = el('div', 'wb-note-row-gutter');
        row.appendChild(gutter);

        const hintSlot = el('div', 'wb-note-row-slot wb-note-row-slot-hint');
        gutter.appendChild(hintSlot);
        if (vm.languageHint || vm.planningType) {
            const coach = el('button',
                'wb-note-row-coach' + (vm.languageHint && !vm.planningType ? ' suspected-activity' : ''),
                {
                    type: 'button',
                    'aria-haspopup': 'dialog',
                    'aria-expanded': 'false',
                    'aria-label': `Planning hint for ${name}`,
                });
            coach.textContent = vm.planningType === 'product' ? 'P'
                : vm.planningType === 'activity' ? 'A' : '\u2726';
            coach.title = vm.planningType
                ? `Planning type: ${vm.planningType}`
                : 'This wording may describe an activity';
            hintSlot.appendChild(coach);
        }

        const peopleSlot = el('div', 'wb-note-row-slot wb-note-row-slot-people');
        gutter.appendChild(peopleSlot);
        const resources = vm.resources || [];
        resources.slice(0, WB_ROW_AVATAR_CAP).forEach((resource) => {
            const avatar = el('span', 'wb-note-row-avatar', { title: resource });
            avatar.textContent = getInitials(resource);
            peopleSlot.appendChild(avatar);
        });
        if (resources.length) {
            // One chip carrying every count the degradation tiers need; which
            // it shows is a CSS decision, because the tier is a container query.
            const more = el('span', 'wb-note-row-avatar-more', { title: resources.join(', ') });
            more.dataset.total = String(resources.length);
            more.dataset.over3 = String(Math.max(0, resources.length - WB_ROW_AVATAR_CAP));
            peopleSlot.appendChild(more);
        }
        const assign = el('button', 'wb-note-row-smart wb-note-row-resource', {
            type: 'button',
            'aria-haspopup': 'menu',
            'aria-expanded': 'false',
            'aria-label': `Assign a resource to ${name}`,
        });
        assign.textContent = '\uFF0B';
        assign.title = 'Quick assign';
        peopleSlot.appendChild(assign);

        const depSlot = el('div', 'wb-note-row-slot wb-note-row-slot-dep');
        gutter.appendChild(depSlot);
        // Leaf rows only -- a summary row is never a dependency endpoint, so it
        // shows the count badge at position 7 instead and never both.
        if (!vm.hasChildren) {
            const handle = el('button', 'wb-note-row-dep-handle', {
                type: 'button',
                title: 'Drag to another task to make it depend on this one',
                'aria-label': `Draw a dependency from "${name}" to another task`,
            });
            handle.innerHTML = DEP_HANDLE_SVG;
            depSlot.appendChild(handle);
        }

        if (vm.depTarget === 'valid') row.classList.add('wb-dep-row-target');
        if (vm.depTarget === 'invalid') row.classList.add('wb-dep-row-target-invalid');

        return row;
    }

    /**
     * The always-present "Add task..." row (#1104).
     *
     * Deliberately NOT given `.wb-note-row`: several call sites and tests find
     * a real child row by that class and then assume `.wb-note-row-name`
     * exists on it, so sharing it would break them on almost every note. The
     * app's own wbBuildAddChildRow() carries the same warning.
     */
    _buildAddRow() {
        const row = el('div', 'wb-note-add-row');
        const icon = el('span', 'wb-note-add-icon', { 'aria-hidden': 'true' });
        icon.textContent = '+';
        const input = el('input', 'wb-note-add-input', {
            type: 'text', placeholder: 'Add task…', 'aria-label': `Add a task to ${this.task}`,
        });
        row.append(icon, input);
        return row;
    }

    _renderFooter(freeform) {
        const r = this._refs;
        const done = this._rows.filter((row) => row.complete).length;
        const total = this._rows.length;
        // The app's exact spacing: `${completed} / ${total}`. The pilot took an
        // arbitrary string.
        r.progress.textContent = freeform || !total ? '' : `${done} / ${total}`;
        // Capped at six, as the app caps it -- not five.
        r.avatars.replaceChildren(...this._resources.slice(0, 6).map((resource) => {
            const avatar = el('div', 'wb-note-avatar', { title: resource });
            avatar.textContent = getInitials(resource);
            return avatar;
        }));
    }

    // ── The ⋮ menu ──────────────────────────────────────────────────────
    //
    // The pilot rendered a menu button and bound nothing at all to it, so the
    // one control every note carries did nothing in Storybook. This builds the
    // real thing: the same six sections wbBuildNoteMenu() composes, in the same
    // order, with the same classes -- a swatch grid plus "Default colour",
    // Rename, a conditional Unlink, a conditional Promote, Open task details,
    // Send to parking lot, Remove from board, Delete task, and three dividers.
    //
    // Appended to document.body rather than into the card, because
    // `.wb-note-menu` is `position: fixed` and the card is `overflow: hidden`.

    _toggleMenu(btn) {
        const open = document.getElementById('npNoteMenu');
        if (open) { open.remove(); btn.setAttribute('aria-expanded', 'false'); return; }

        const menu = el('div', 'wb-note-menu', { id: 'npNoteMenu', role: 'menu', 'aria-label': `Options for ${this.task}` });
        const list = el('ul', 'wb-note-menu-list');
        menu.appendChild(list);

        const item = (className, label, attrs) => {
            const li = el('li');
            const button = el('button', className, { type: 'button', role: 'menuitem', ...(attrs || {}) });
            button.textContent = label;
            li.appendChild(button);
            list.appendChild(li);
            return button;
        };
        const divider = () => list.appendChild(el('li', 'wb-note-menu-divider', { role: 'separator' }));

        // 1 & 2: colour -- "Default colour", then a labelled 6-column grid.
        item('wb-note-menu-default', 'Default colour');
        const labelLi = el('li', 'wb-note-menu-label', { role: 'presentation' });
        labelLi.textContent = 'Colour';
        list.appendChild(labelLi);
        const gridLi = el('li', null, { role: 'presentation' });
        const grid = el('div', 'wb-note-menu-grid');
        const current = (this.getAttribute('colour') || this.getAttribute('color') || '').toLowerCase();
        for (const swatch of WB_NOTE_PASTEL_COLOURS) {
            const selected = swatch.toLowerCase() === current;
            const button = el('button', 'wb-note-menu-swatch', {
                type: 'button', role: 'menuitemradio',
                'aria-checked': selected ? 'true' : 'false', title: swatch,
            });
            button.style.background = swatch;
            if (selected) {
                const check = el('span', 'wb-note-menu-swatch-check');
                check.textContent = '✓';
                check.style.color = contrastTextColour(swatch) || '';
                button.appendChild(check);
            }
            grid.appendChild(button);
        }
        gridLi.appendChild(grid);
        list.appendChild(gridLi);

        // 3 & 4: structure -- Rename, and Unlink only when the note has a parent.
        divider();
        item('wb-note-menu-action', 'Rename');
        const parent = this.getAttribute('parent');
        if (parent) item('wb-note-menu-action', `Unlink from "${parent}"`);

        // 5: promote -- free-form notes only.
        if (this.hasAttribute('freeform')) item('wb-note-menu-promote', 'Promote to task');

        // 6: open task details.
        item('wb-note-menu-open-task', 'Open task details');

        // 7: parking -- deliberately neutral, not destructive: parking
        // relocates the text, it does not destroy it.
        divider();
        item('wb-note-menu-action', 'Send to parking lot');

        // 8 & 9: the destructive pair.
        divider();
        item('wb-note-menu-remove', 'Remove from board');
        item('wb-note-menu-remove wb-note-menu-delete', 'Delete task');

        document.body.appendChild(menu);
        const rect = btn.getBoundingClientRect();
        menu.style.left = `${Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, rect.left))}px`;
        menu.style.top = `${rect.bottom + 4}px`;
        btn.setAttribute('aria-expanded', 'true');

        const close = (e) => {
            if (menu.contains(e.target) || btn.contains(e.target)) return;
            menu.remove();
            btn.setAttribute('aria-expanded', 'false');
            document.removeEventListener('mousedown', close, true);
        };
        setTimeout(() => document.addEventListener('mousedown', close, true), 0);
    }
}

// Both handles are the app's own inline SVG, character for character.
const LINK_HANDLE_SVG =
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="round" aria-hidden="true">' +
    '<circle cx="4" cy="4" r="2"/><circle cx="12" cy="12" r="2"/>' +
    '<path d="M4 6 C4 11, 7 12, 10 12"/></svg>';

const DEP_HANDLE_SVG =
    '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="round" aria-hidden="true">' +
    '<circle cx="4" cy="4" r="2"/><circle cx="12" cy="12" r="2"/>' +
    '<path d="M4 6 C4 11, 7 12, 10 12"/></svg>';

if (!customElements.get('np-note')) {
    customElements.define('np-note', NpNote);
}
