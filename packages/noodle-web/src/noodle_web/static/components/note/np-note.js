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

// The row's checkbox is a component of its own (#1245); importing it here
// means a story only has to load np-note.
import '../checkbox/np-checkbox.js';
import '../resource-stack/np-resource-stack.js';
import '../menu/np-menu.js';
// The note's markup, shared with the board's own builders (#1249) -- see that
// file's header for why it is a separate module rather than living here.
import {
    ROW_AVATAR_CAP, buildAddRow, buildChecklistRow, buildNoteCard, el,
} from './note-markup.js';

// whiteboard-notes.js's own constants, which are what decide how crowded a
// row looks. A component previewing 40px narrower than a real note (the
// pilot was 220) is not a cosmetic difference here.
export const WB_NOTE_DEFAULT_WIDTH = 260;
export const WB_NOTE_DEFAULT_HEIGHT = 220;
export const WB_NOTE_MIN_WIDTH = 160;
export const WB_NOTE_MIN_HEIGHT = 120;

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

export class NpNote extends HTMLElement {
    static get observedAttributes() {
        return [
            'task', 'title', 'colour', 'color', 'parent', 'comment', 'rows',
            'width', 'height',
            'freeform', 'title-only', 'selected', 'flash', 'park-armed',
            'parking', 'link-target', 'link-target-invalid', 'editing',
        ];
    }

    constructor() {
        super();
        this._rows = [];
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
        if (this._built) this._render();
    }

    get rows() { return this._rows; }
    set rows(value) { this._rows = Array.isArray(value) ? value : []; if (this._built) this._render(); }

    /** Optional `{ name|shortname: { name, role, email } }` for the resource
     * stacks' hover profile cards; the app fills it from front matter. */
    get details() { return this._details; }
    set details(value) { this._details = value || {}; if (this._built) this._render(); }


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

        // The skeleton comes from note-markup.js, which the app's own
        // wbCreateNoteNode() also builds from (#1249). This used to be ~50
        // lines of element creation duplicating that function element for
        // element -- the "Storybook is a parallel drawing" problem the epic
        // exists to close. What is left here is what only a component does:
        // owning the menu button's click, since the board wires its own.
        const { card, rails, refs } = buildNoteCard();
        refs.menuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._toggleMenu(refs.menuBtn);
        });
        // Beside the card, not inside it -- the card and its body both clip
        // horizontally, so a rail drawn within either never leaves the note.
        // The host is the positioning context; `_render()` keeps it relative.
        this.append(card, rails);

        // The rails follow the row under the pointer or the keyboard, same as
        // the board. Delegated from the host, so rows rebuilt by `_render()`
        // need no wiring of their own.
        const activate = (e) => {
            const row = e.target.closest && e.target.closest('.wb-note-row');
            if (row && this.contains(row)) this._showRails(row);
        };
        card.addEventListener('pointerover', activate);
        card.addEventListener('focusin', activate);
        card.addEventListener('pointerleave', () => this._hideRails());
        for (const btn of [refs.railHint, refs.railDep]) {
            btn.addEventListener('pointerleave', () => this._hideRails());
        }

        this._refs = refs;
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
        // The rails are absolutely positioned against the host.
        this.style.position = 'relative';

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
        const planningType = this.getAttribute('data-planning-type');
        r.coachBtn.textContent = planningType === 'product' ? 'P' : planningType === 'activity' ? 'A' : '✦';
        r.coachBtn.classList.toggle('typed', Boolean(planningType));
        r.coachBtn.classList.toggle('suspected-activity',
            this.hasAttribute('language-hint') && !planningType);
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
        this._hideRails();

        if (freeform) {
            // A free-form note with no comment renders no prose at all,
            // deliberately (#885): nothing prompts for detail. The pilot always
            // appended a paragraph, empty or not. The add row below is the one
            // thing that does follow -- typing a task into it is how a note
            // becomes a summary task, so withholding it here would leave the
            // note with no way out of free-form.
            const comment = this.getAttribute('comment');
            if (comment) {
                const text = el('p', 'wb-note-freetext');
                text.textContent = comment;
                children.push(text);
            }
            children.push(this._buildAddRow());
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

        // Same per-note people-slot reservation the board makes, so a story
        // previews the width a note of this shape really gets (#1243).
        const widest = this._rows.reduce(
            (n, row) => Math.max(n, Math.min((row.resources || []).length, ROW_AVATAR_CAP)), 0);
        const over = this._rows.some((row) => (row.resources || []).length > ROW_AVATAR_CAP);
        const chips = widest + (over ? 1 : 0);
        const stack = chips ? chips * 20 - (chips - 1) * 5 : 0;
        r.card.style.setProperty('--wb-row-people', `${Math.max(stack, 20)}px`);

        // Always present (#1104), on every render, free-form branch included.
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

        // Same builder the board uses (#1249). The story's arg shape and the
        // board's view model are different objects, so each side resolves its
        // own model and the markup is built once, here and there, from the
        // same code.
        const { row, refs } = buildChecklistRow({
            name,
            complete: vm.complete,
            indeterminate: vm.indeterminate,
            hasChildren: vm.hasChildren,
            childCount: vm.childCount,
            deliverable: vm.deliverable,
            date: vm.date ? {
                text: vm.date,
                label: `Attach the detected date ${vm.date} to ${name}`,
            } : null,
            coach: (vm.languageHint || vm.planningType) ? {
                glyph: vm.planningType === 'product' ? 'P'
                    : vm.planningType === 'activity' ? 'A' : '\u2726',
                suspected: !!vm.languageHint && !vm.planningType,
                label: vm.planningType
                    ? `Planning hint for ${name}: this is a ${vm.planningType}`
                    : `Planning hint for ${name}: this wording may describe an activity`,
            } : null,
            depHandle: true,
        });

        // One control, never two -- the chips open the assign menu themselves,
        // so a "+" beside them is a second button for the same job. Mirrors
        // wbAppendChildResourceControls() in whiteboard-notes.js.
        const resources = vm.resources || [];
        if (resources.length) {
            // One <np-resource-stack> (#1246, under #1199), which owns the
            // overlap, the cap, the overflow chip and the hover profile card.
            //
            // No `size` attribute -- it would write --np-avatar-size inline
            // and outrank both `.wb-note-row-avatar` and the narrow-tier
            // container query, which is exactly the bug the board just lost.
            const stack = el('np-resource-stack', 'wb-note-row-avatar', {
                max: String(ROW_AVATAR_CAP),
            });
            stack.names = resources;
            if (this._details) stack.details = this._details;
            refs.peopleSlot.appendChild(stack);
        } else {
            refs.peopleSlot.appendChild(refs.assignBtn);
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
        return buildAddRow(this.task).row;
    }

    /**
     * Put the rails level with `row` and show what that row asks for -- the
     * component's own small copy of the board's wbShowRowRails().
     *
     * Storybook is where the note is designed, so the rails have to be
     * reachable here: a control that only exists on the canvas is a control
     * nobody can look at. The geometry is simpler than the board's because
     * there is no zoom transform to divide back out.
     */
    _showRails(row) {
        const { rails, railHint, railDep } = this._refs;
        const cardRect = this._refs.card.getBoundingClientRect();
        const rowRect = row.getBoundingClientRect();
        const top = rowRect.top - cardRect.top + rowRect.height / 2;
        rails.dataset.wbRailRow = row.dataset.wbRowTask || '';
        railHint.style.top = `${top}px`;
        railDep.style.top = `${top}px`;

        let coach = null;
        try {
            coach = row.dataset.wbRowCoach ? JSON.parse(row.dataset.wbRowCoach) : null;
        } catch { coach = null; }
        if (coach) {
            railHint.textContent = coach.glyph;
            railHint.classList.toggle('suspected-activity', Boolean(coach.suspected));
            railHint.title = coach.label;
            railHint.setAttribute('aria-label', coach.label);
        }
        railHint.hidden = !coach;
        railDep.hidden = row.dataset.wbRowDep !== 'true';
    }

    _hideRails() {
        const { rails, railHint, railDep } = this._refs;
        railHint.hidden = true;
        railDep.hidden = true;
        rails.dataset.wbRailRow = '';
    }

    _renderFooter(freeform) {
        const r = this._refs;
        const done = this._rows.filter((row) => row.complete).length;
        const total = this._rows.length;
        // The app's exact spacing: `${completed} / ${total}`. The pilot took an
        // arbitrary string.
        r.progress.textContent = freeform || !total ? '' : `${done} / ${total}`;
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
        if (open) { this._closeMenu(btn); return; }

        // The same six sections wbBuildNoteMenu() composes, as data (#1247).
        // <np-menu> emits the dividers, the roles and the keyboard model; this
        // says only what is in the menu and under what condition.
        const parent = this.getAttribute('parent');
        const freeform = this.hasAttribute('freeform');
        const colour = this.getAttribute('colour') || this.getAttribute('color') || '';

        const structure = [{ id: 'rename', label: 'Rename' }];
        if (parent) structure.push({ id: 'unlink', label: `Unlink from "${parent}"` });
        if (freeform) {
            structure.push({
                id: 'promote', label: 'Promote to task', className: 'wb-note-menu-promote',
            });
        }
        structure.push({
            id: 'open-task', label: 'Open task details', className: 'wb-note-menu-open-task',
        });

        const menu = document.createElement('np-menu');
        menu.id = 'npNoteMenu';
        menu.setAttribute('aria-label', `Options for ${this.task}`);
        menu.sections = [
            { items: [{ id: 'default-colour', label: 'Default colour', className: 'wb-note-menu-default' }] },
            {
                label: 'Colour',
                swatches: WB_NOTE_PASTEL_COLOURS,
                selected: colour,
                checkColour: (swatch) => contrastTextColour(swatch) || '',
            },
            { items: structure },
            // Neutral on purpose: parking relocates the text, it does not
            // destroy it.
            { items: [{ id: 'park', label: 'Send to parking lot' }] },
            {
                items: [
                    { id: 'remove', label: 'Remove from board', destructive: true },
                    { id: 'delete', label: 'Delete task', destructive: true, confirms: true },
                ],
            },
        ];
        menu.addEventListener('dismiss', () => this._closeMenu(btn));
        menu.addEventListener('select', () => this._closeMenu(btn));

        document.body.appendChild(menu);
        const rect = btn.getBoundingClientRect();
        menu.style.left = `${Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, rect.left))}px`;
        menu.style.top = `${rect.bottom + 4}px`;
        btn.setAttribute('aria-expanded', 'true');

        const first = menu.items[0];
        if (first) first.focus();

        this._menuOutside = (e) => {
            if (menu.contains(e.target) || btn.contains(e.target)) return;
            this._closeMenu(btn);
        };
        setTimeout(() => document.addEventListener('mousedown', this._menuOutside, true), 0);
    }

    _closeMenu(btn) {
        const menu = document.getElementById('npNoteMenu');
        if (menu) menu.remove();
        if (this._menuOutside) {
            document.removeEventListener('mousedown', this._menuOutside, true);
            this._menuOutside = null;
        }
        if (btn) {
            btn.setAttribute('aria-expanded', 'false');
            btn.focus();
        }
    }
}


if (!customElements.get('np-note')) {
    customElements.define('np-note', NpNote);
}
