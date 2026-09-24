/**
 * The whiteboard post-it's markup, in one place (issue #1249, epic #1241).
 *
 * ## Why this file exists
 *
 * Until now the note was built twice. `wbCreateNoteNode()` and
 * `wbBuildChildRow()` in `whiteboard-notes.js` built what ships, and
 * `NpNote._build()` / `_buildRow()` in `np-note.js` built what Storybook drew
 * -- the same elements, the same class names, the same ARIA, typed out
 * separately. That is the "Storybook is a parallel drawing of a note nobody
 * sees" problem #1249 opens with, and it had already bitten twice in this epic
 * alone: `getInitials` drifted between the two (#1246, "Mary Jane Watson" was
 * MJ in one and MW in the other) and the title was an `<h3>` on the board and a
 * `<p>` in the component, which matters because `visual-system.css` excludes
 * `.wb-note-title` from its heading ink by *element* selector.
 *
 * So: one builder, two callers. The board gets its skeleton from here and
 * wires its own listeners onto the refs; `<np-note>` gets the same skeleton and
 * leaves it inert. A change to the note's markup is now a change to this file,
 * which is what makes Storybook the place the note is designed rather than a
 * second drawing of it.
 *
 * ## What is here and what is not
 *
 * Markup only -- structure, classes, ARIA, glyphs. No event listeners, no plan
 * parsing, no view-model derivation. Everything conditional is driven by a
 * plain model the caller has already resolved: the board works out whether a
 * child has a detected date from `wbTaskDateSuggestions()`, Storybook takes it
 * from a story arg, and this file only knows "there is a date chip, its text is
 * X and its label is Y".
 *
 * That split is deliberate and is what makes the sharing possible at all. The
 * board's behaviour -- drag, resize, the link and dependency gestures, the
 * menus, rename, peek -- is 6,500 lines of app that Storybook neither has nor
 * wants. Pulling it in here would mean pulling the app in with it.
 *
 * ## Namespace
 *
 * `createElementNS(XHTML_NS, ...)` rather than `createElement`, because the
 * board's notes live inside an SVG `<foreignObject>`. In an HTML document the
 * two are identical -- `createElement` is HTML-namespaced wherever it is
 * called -- so Storybook is unaffected, and being explicit is what the app's
 * own builders already did.
 */

export const XHTML_NS = 'http://www.w3.org/1999/xhtml';

/**
 * Avatars rendered inline on a checklist row before the overflow chip takes
 * over (#1243). The note footer caps the same list at six; the row is tighter.
 */
export const ROW_AVATAR_CAP = 3;

/** One element, with a class and attributes. */
export function el(tag, className, attrs) {
    const node = document.createElementNS(XHTML_NS, tag);
    if (className) node.setAttribute('class', className);
    for (const [key, value] of Object.entries(attrs || {})) {
        if (value !== null && value !== undefined) node.setAttribute(key, String(value));
    }
    return node;
}

/**
 * The noodle: two nodes joined by a curve, at `size` px.
 *
 * `stroke="currentColor"` on purpose -- it is how the link handle and the row's
 * dependency handle inherit the note's measured ink rather than carrying a
 * colour of their own (#1248).
 */
export function noodleGlyph(size) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" ` +
        'stroke-width="1.8" stroke-linecap="round" aria-hidden="true">' +
        '<circle cx="4" cy="4" r="2"/><circle cx="12" cy="12" r="2"/>' +
        '<path d="M4 6 C4 11, 7 12, 10 12"/></svg>';
}

/**
 * The pin (issue #1291). One drawing, two states: `pinGlyph()` is a pushpin
 * pressed into the board, `unpinGlyph()` is the same pin with a stroke through
 * it. Both are `stroke="currentColor"`, like noodleGlyph() above, so wherever
 * they land -- a note header measured against its own pastel, the outline
 * panel's row against the app surface -- they inherit that surface's ink
 * rather than carrying a colour of their own.
 *
 * "Pinned" is the board's word for what the plan file has always stored:
 * a note is on the whiteboard because there is a row for its task in the
 * Whiteboard section. Pinning adds that row, unpinning removes it, and
 * neither touches the task itself. See wbRemoveNoteFromBoard() and
 * wbCommitAddNotes() in whiteboard-notes.js -- the two functions every pin
 * control in the app ends up calling.
 */
export function pinGlyph(size) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" ` +
        'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M9.8 1.6 14.4 6.2"/>' +
        '<path d="M10.6 2.4 9 4 6.2 4.6 3.3 7.5l5.2 5.2 2.9-2.9L12 7l1.6-1.6"/>' +
        '<path d="M5.9 10.1 2.2 13.8"/></svg>';
}

/** The pin, struck through: "this is on the board -- take it off". */
export function unpinGlyph(size) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" ` +
        'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M9.8 1.6 14.4 6.2"/>' +
        '<path d="M10.6 2.4 9 4 6.2 4.6 3.3 7.5l5.2 5.2 2.9-2.9L12 7l1.6-1.6"/>' +
        '<path d="M5.9 10.1 2.2 13.8"/>' +
        '<path d="M1.6 1.6 14.4 14.4"/></svg>';
}

/**
 * Scissors for the cut between two checklist rows (issue #874).
 *
 * `stroke="currentColor"` for the same reason as noodleGlyph(): the control
 * inherits the note's measured ink rather than carrying a colour of its own.
 */
export function scissorsGlyph(size) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" ` +
        'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<circle cx="4" cy="3.5" r="2"/><circle cx="4" cy="12.5" r="2"/>' +
        '<path d="M5.7 4.8 L14 12.5 M5.7 11.2 L14 3.5"/></svg>';
}

/**
 * The card skeleton: header, "under X" caption, body, footer, resize grip.
 *
 * Returns `{ card, refs }`. Everything a caller needs to reach later is in
 * `refs`, so neither caller has to re-query the tree it just built -- which is
 * also what lets the board keep its existing `entry.refs` shape unchanged.
 *
 * The header's child order is load bearing; the comment on the append run
 * below and the one on `.wb-note-header` in `views/whiteboard.css` say why.
 */
export function buildNoteCard() {
    const card = el('div', 'wb-note-card');
    const header = el('div', 'wb-note-header');

    // An <h3>, not a <p>. visual-system.css gives headings --np-font-heading
    // and then excludes this one class from the heading *ink*, by element
    // selector, because painting --np-ink over a note measured 1.12:1. The
    // element is therefore part of the contract, not a tag choice.
    const title = el('h3', 'wb-note-title');

    // The pin (issue #1291). A note on the board is pinned to it, and this is
    // how you take it off -- the same act as the outline panel's own unpin
    // control and the `...` menu's "Remove from board", never a third way to
    // do it (whiteboard-notes.js wires all three to wbRemoveNoteFromBoard()).
    //
    // Left of the title, not in the right-hand cluster, and that is the whole
    // point of where it sits: the cluster is note *options*, while this says
    // something about the note's relationship to the board, so it reads with
    // the identity the title carries rather than with the tools. It is also
    // the one header control that must not widen the cluster the comment on
    // the appendChild run below protects.
    //
    // Hidden at rest: it collapses to zero width and the title sits where it
    // always has, so a board of notes is not a board of pins. `.wb-note-card`
    // hover or keyboard focus slides it in and the title slides over to make
    // room -- see `.wb-note-pin-btn` in views/whiteboard.css, which owns the
    // transition and the reduced-motion opt-out.
    const pinBtn = el('button', 'wb-note-pin-btn', {
        type: 'button',
        tabindex: '0',
        title: 'Unpin from the board',
        'aria-label': 'Unpin this note from the board. This only removes the note; the task and its subtasks stay in your plan.',
    });
    pinBtn.innerHTML = pinGlyph(13);

    // No date chip on the note. A detected date belongs to the task line it
    // was detected in, and the checklist rows carry their own
    // `.wb-note-row-date` for exactly that. The header's twin offered to
    // attach a date to the *summary*, which is the same category error the
    // quick-assign made with resources.

    // No quick-assign on the note itself. A post-it is a summary task, and
    // resources belong on the tasks inside it -- the checklist rows keep their
    // own `.wb-note-row-resource` control, which is the one that assigns to a
    // thing somebody actually does. The header's twin assigned to the summary
    // line, which is a different act wearing the same `＋`, and it was the
    // only header control that was neither about the note's identity (title,
    // colour, menu) nor about its place in the graph (the noodle handle).

    const coachBtn = el('button', 'wb-note-coach-btn', {
        type: 'button',
        'aria-label': 'Planning prompts',
        'aria-haspopup': 'dialog',
    });
    coachBtn.textContent = '✦';

    // No "promote to task" button. A note becomes a summary task by gaining a
    // child, and the "Add task..." row at the foot of the body -- which every
    // note now carries, free-form ones included -- is how you give it one.
    // Typing there *is* the promotion, so a separate header control asked the
    // user to name, in advance, a structural change that the next thing they
    // typed would have made anyway.

    // No `...` menu button. Its actions moved to the object toolbar that
    // floats above a selected note (whiteboard-object-toolbar.js), the way
    // Obsidian's canvas does it; a right-click still opens the full menu.

    // One sentence, both places. The board's tooltip said "Drag to another
    // note to make it a subtask" and its accessible name said "Draw a noodle
    // to another note" -- the same disagreement #1248 fixed on the row's
    // controls, describing the gesture to one user and the outcome to another.
    const linkLabel = 'Drag to another note to make it a subtask';
    const linkHandle = el('button', 'wb-note-link-handle', {
        type: 'button',
        title: linkLabel,
        'aria-label': linkLabel,
    });
    linkHandle.innerHTML = noodleGlyph(14);

    // Order matters, and the link handle's position is load bearing (#1250).
    //
    // The header is a right-aligned button cluster with a `flex: 1` title
    // taking the slack, so the cluster spans past the header's own midpoint
    // whenever it is wider than half the header -- with the buttons left
    // here, measured, that is the 160px tier only (78px of cluster against a
    // ~70px budget); 260px clears it. Whatever sits at that midpoint receives
    // the press a user means as "grab the middle and move it".
    //
    // For every button here but one that is merely a dead spot: the board's
    // header mousedown handler returns early on them, so no drag starts. The
    // link handle is the exception, because it carries its own mousedown
    // listener that begins a *link* drag -- and the park branch requires a
    // move, so a note dragged from that point to the parking lot is silently
    // not parked. Appending it last makes that impossible by construction: as
    // the final child of a right-aligned cluster it occupies [W - 10 - w,
    // W - 10], and the midpoint W/2 can only fall there when W <= 2 * (10 + w),
    // which is 64px for the 22px handle and 80px for the 30px coarse-pointer
    // one -- both below WB_NOTE_MIN_WIDTH.
    header.append(pinBtn, title, coachBtn, linkHandle);

    const parentCaption = el('div', 'wb-note-parent');
    const body = el('div', 'wb-note-body');

    // The footer carries the progress count and nothing else. It used to
    // carry the note's own resource stack, which is resources assigned to a
    // *summary* task -- bad practice in a plan, and something the board should
    // not be displaying as though it were normal. Resources live on the tasks
    // inside the note, where the rows show them.
    const footer = el('div', 'wb-note-footer');
    const progress = el('span', 'wb-note-progress');
    footer.appendChild(progress);

    const resizeHandle = el('div', 'wb-note-resize-handle', { 'aria-hidden': 'true' });

    card.append(header, parentCaption, body, footer, resizeHandle);

    // ── The rails ──────────────────────────────────────────────────────
    //
    // Two controls that belong to a checklist row but are drawn *outside* the
    // card, level with the row the pointer is on: the planning hint to its
    // left, the dependency handle to its right.
    //
    // Why they are not in the row any more: the row's trailing gutter was
    // 136px of a 260px note -- deliverable, hint, people, dependency, each
    // reserving its width whether or not it had anything in it -- and the task
    // name got what was left. On a default note that was under 30px, so every
    // name rendered as three characters and an ellipsis. The two controls that
    // are *gestures* rather than information moved out here; the two that say
    // something about the task (the deliverable, the people) stayed.
    //
    // Why there is one pair per note rather than one per row: they only ever
    // show for the row the pointer or the keyboard is on, so a note never
    // needs two of either. The board moves this pair to the active row
    // (wbShowRowRails()) instead of building, positioning and tearing down a
    // pair for every row of every note on the canvas.
    //
    // They are a sibling of the card, not a child of it. `.wb-note-card` is
    // `overflow: hidden` for its rounded corners and `.wb-note-body` is
    // `overflow-x: hidden` for its scroller, so anything inside the card is
    // clipped at the card's edge by two separate rules. The parent -- the
    // board's <foreignObject>, which is `overflow: visible`, or the component
    // host -- is the first box that does not clip, which is why the caller
    // appends this next to the card rather than inside it.
    const rails = el('div', 'wb-note-rails', { 'aria-hidden': 'false' });

    const railHint = el('button', 'wb-note-rail wb-note-rail-hint', {
        type: 'button',
        hidden: '',
        'aria-haspopup': 'dialog',
        'aria-expanded': 'false',
    });

    const railDep = el('button', 'wb-note-rail wb-note-rail-dep', {
        type: 'button',
        hidden: '',
    });
    railDep.innerHTML = noodleGlyph(12);

    rails.append(railHint, railDep);

    return {
        card,
        rails,
        refs: {
            card, header, pinBtn, title, coachBtn,
            linkHandle, parentCaption, body, footer, progress,
            resizeHandle, rails, railHint, railDep,
        },
    };
}

/**
 * One checklist row, in the three zones #1243 settled on.
 *
 *   LEAD    the checkbox
 *   NAME    the name, then a content box for things that describe the task
 *   GUTTER  a constant width holding the deliverable and people slots, each of
 *           which renders as an empty box when unoccupied rather than
 *           `display: none`
 *
 * That last rule is the whole point: a busy row and a bare row have identical
 * geometry, which is what they did not have before.
 *
 * The gutter used to hold two more slots, for the planning hint and the
 * dependency handle. Four reserved slots came to 136px of a 260px note and the
 * name got the remainder -- under 30px, which is three characters and an
 * ellipsis on every row of a default-width note. The two that are gestures
 * rather than facts now render on the note's rails, outside the card, for the
 * hovered row only; see buildNoteCard().
 *
 * `model` is already resolved by the caller:
 *
 *   { name, complete, indeterminate, hasChildren, childCount, deliverable,
 *     date: { text, label } | null,
 *     coach: { glyph, label, suspected } | null,
 *     depHandle: boolean,
 *     scissors: { label } | null }
 *
 * `scissors` is the cut *after* this row (issue #874). It is a sibling of
 * the row, not a child of it: the cut sits in the gap between two checklist
 * items, and a child of the row would be clipped by the next row painting
 * over it. Callers append `cut` immediately after `row` when it is non-null.
 * The last visible row never asks for one -- there is no cut after it.
 *
 * Returns `{ row, cut, refs }`. Optional controls are `null` in `refs` when
 * the model did not ask for them, which is how the board knows what to wire.
 * `cut` is null when the model did not ask for scissors.
 */
export function buildChecklistRow(model) {
    const name = model.name || '';
    const row = el('div', 'wb-note-row');

    // Read by whiteboard-dep-noodles.js's wbNoteRowRectFor() (to draw a
    // committed dependency noodle at this row's own position) and by its
    // row-drag drop handling, to find which task a handle was dropped onto.
    row.dataset.wbRowTask = name;
    row.dataset.wbRowSummary = model.hasChildren ? 'true' : 'false';

    // ── Lead zone ──────────────────────────────────────────────────────
    // <np-checkbox> (#1245) rather than a bare native input. It keeps the
    // `.wb-note-checkbox` class: the rule behind that name is gone, but the
    // name is what several call sites and browser tests find a row's checkbox
    // by, and renaming it buys nothing.
    //
    // `row` reports whether this is a summary, which is the only kind that may
    // render the mixed state.
    const checkbox = el('np-checkbox', 'wb-note-checkbox', {
        dense: '',
        row: model.hasChildren ? 'summary' : 'leaf',
        title: model.complete ? 'Mark as incomplete' : 'Mark as complete',
        label: `Mark "${name}" as ${model.complete ? 'incomplete' : 'complete'}`,
    });
    if (model.complete) checkbox.setAttribute('checked', '');
    if (model.indeterminate && model.hasChildren) checkbox.setAttribute('indeterminate', '');
    row.appendChild(checkbox);

    // ── Name zone ──────────────────────────────────────────────────────
    const label = el('span', 'wb-note-row-name', { title: name });
    label.textContent = name;
    row.appendChild(label);

    // Affordances that describe the task rather than act on it travel with the
    // name and shrink before it does.
    const content = el('div', 'wb-note-row-content');
    row.appendChild(content);

    let dateBtn = null;
    if (model.date) {
        dateBtn = el('button', 'wb-note-row-smart wb-note-row-date', {
            type: 'button',
            'aria-haspopup': 'dialog',
            'aria-expanded': 'false',
            'aria-label': model.date.label,
            title: model.date.label,
        });
        dateBtn.textContent = model.date.text;
        content.appendChild(dateBtn);
    }

    let countBadge = null;
    if (model.hasChildren) {
        countBadge = el('button', 'wb-note-count-badge', {
            type: 'button',
            'aria-haspopup': 'dialog',
            'aria-expanded': 'false',
            'aria-label': `${name} has ${model.childCount || 0} subtasks. Peek subtasks.`,
        });
        countBadge.textContent = `${model.childCount || 0} ▾`;
        content.appendChild(countBadge);
        row.classList.add('wb-note-row-drillable');
    }

    // ── Trailing gutter ────────────────────────────────────────────────
    const gutter = el('div', 'wb-note-row-gutter');
    row.appendChild(gutter);

    // The deliverable leads the gutter. It moved out of the lead zone, where
    // it reserved 15px between every checkbox and every name -- a gap most
    // rows had no use for and nothing explained. Here it costs nothing when
    // absent, because the gutter is a fixed width either way, and names now
    // start immediately after the checkbox.
    //
    // First in the gutter because the gutter runs information -> gesture: the
    // `$` says something about the task, the three after it are things you do
    // to it.
    const delivSlot = el('div', 'wb-note-row-slot wb-note-row-slot-deliv');
    gutter.appendChild(delivSlot);
    if (model.deliverable) {
        // Content, not decoration: it names a real deliverable. As a bare span
        // with only a title it reached a screen reader as "$".
        const badge = el('span', 'wb-note-deliverable-badge', {
            role: 'img',
            'aria-label': `Deliverable: ${model.deliverable}`,
            title: `Deliverable: ${model.deliverable}`,
        });
        badge.textContent = '$';
        delivSlot.appendChild(badge);
    }

    // No hint slot. The planning hint is a rail control now -- drawn to the
    // left of the note, level with this row, when the row is hovered or
    // focused (see buildNoteCard()'s rails). The model still carries `coach`,
    // because that is what tells the board whether this row has a hint to show
    // at all; it is stashed on the row rather than rendered into it.
    if (model.coach) {
        row.dataset.wbRowCoach = JSON.stringify(model.coach);
    }

    const peopleSlot = el('div', 'wb-note-row-slot wb-note-row-slot-people');
    gutter.appendChild(peopleSlot);

    const assignBtn = el('button', 'wb-note-row-smart wb-note-row-resource', {
        type: 'button',
        'aria-haspopup': 'menu',
        'aria-expanded': 'false',
        'aria-label': `Assign a resource to ${name}`,
        title: 'Quick assign',
    });
    // Drawn, not typed. This was U+FF0B FULLWIDTH PLUS SIGN, whose advance
    // width and side bearings are a CJK cell rather than the Latin metrics the
    // rest of the button is laid out in -- so it sat left and low inside a
    // 20px circle, in whichever fallback font happened to carry it. Two lines
    // in a viewBox land on the middle of the circle in every font.
    assignBtn.innerHTML =
        '<svg viewBox="0 0 12 12" width="9" height="9" fill="none" stroke="currentColor" ' +
        'stroke-width="1.8" stroke-linecap="round" aria-hidden="true">' +
        '<path d="M6 2v8M2 6h8"/></svg>';

    // No dep slot either, for the same reason. Leaf rows only -- a summary row
    // is never a dependency endpoint, so it shows the count badge instead and
    // never both -- and the flag says so here so the rail does not have to
    // re-derive it.
    row.dataset.wbRowDep = (model.depHandle && !model.hasChildren) ? 'true' : 'false';

    // Scissors live in the gap *after* this row, as a sibling. The last
    // visible row of a note never asks for one: a cut with nothing below
    // it would lift the whole remainder into an empty-bodied post-it.
    let cut = null;
    let scissors = null;
    if (model.scissors) {
        row.classList.add('wb-note-row-splittable');
        cut = el('div', 'wb-note-cut');
        scissors = el('button', 'wb-note-scissors', {
            type: 'button',
            'aria-label': model.scissors.label,
            title: model.scissors.label,
        });
        scissors.innerHTML = scissorsGlyph(16);
        cut.appendChild(scissors);
    }

    return {
        row,
        cut,
        refs: {
            row, checkbox, name: label, content, dateBtn, countBadge,
            gutter, delivSlot, peopleSlot, assignBtn, cut, scissors,
        },
    };
}

/**
 * The always-present "Add task…" row (#1104).
 *
 * Deliberately NOT given `.wb-note-row`: several call sites and tests find a
 * real child row by that class and then assume `.wb-note-row-name` exists on
 * it, so sharing it would break them on almost every note. Since #1250 it does
 * share the row's *lead-zone columns* -- the "+" occupies a checkbox's width
 * and the input reserves the badge slot's -- which is a CSS relationship, not
 * a class one, and `views/whiteboard.css` carries the warning at its end.
 */
export function buildAddRow(taskName) {
    const row = el('div', 'wb-note-add-row');
    // No leading glyph. A "+" in the checkbox column said the same thing as
    // the placeholder immediately beside it, and a second thing it did not
    // mean -- a checkbox column is for ticking, and this row cannot be ticked.
    // The row now reads as one more task line, in italic, which is the only
    // difference it needs from the lines above it.
    const input = el('input', 'wb-note-add-input', {
        type: 'text',
        placeholder: 'Add task…',
        'aria-label': `Add a task under "${taskName}"`,
    });
    row.appendChild(input);
    return { row, refs: { row, input } };
}

// ── The bridge to the app ────────────────────────────────────────────────
//
// `whiteboard-notes.js` is a classic script, not a module -- it is one of
// ~40 loaded by <script src> at the end of index.html's body, and it declares
// globals the other whiteboard files read. It therefore cannot `import` this
// file, so this file hands itself over instead.
//
// Ordering is safe because of *when* the builders are called rather than when
// the scripts run. Classic scripts execute during parse and modules are
// deferred to after it, so `whiteboard-notes.js` is evaluated first -- but it
// only reads `globalThis.NoodleNoteMarkup` inside wbCreateNoteNode() and
// wbBuildChildRow(), which run when the whiteboard view is opened, long after
// every deferred module has executed. `<np-checkbox>` and
// `<np-resource-stack>` already depend on exactly this ordering: the app
// creates those elements by tag name and they are inert until their modules
// upgrade them.
//
// Storybook does not use this path at all -- `np-note.js` imports the named
// exports above -- so the two callers share the builders without sharing a
// loading mechanism.
if (typeof globalThis !== 'undefined') {
    globalThis.NoodleNoteMarkup = {
        XHTML_NS, ROW_AVATAR_CAP, el, noodleGlyph, scissorsGlyph,
        pinGlyph, unpinGlyph,
        buildNoteCard, buildChecklistRow, buildAddRow,
    };
}
