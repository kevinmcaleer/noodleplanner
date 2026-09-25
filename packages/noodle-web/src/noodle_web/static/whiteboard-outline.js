/**
 * The whiteboard's floating plan-structure outline.
 *
 * A panel that floats above the canvas on the left, showing the plan's
 * task hierarchy as a collapsible tree. It is the readable counterpart to
 * the noodles: as soon as notes are linked together, the structure those
 * links imply shows up here as an ordinary indented outline, which is also
 * how someone finds a note again on a board that has grown too big to scan
 * by eye.
 *
 * Three jobs, in the order they matter:
 *
 *   1. *Show the structure.* Every task in the plan, nested, collapsible,
 *      with a dot marking the ones that have a note on the board.
 *   2. *Find a note.* Type in the search box and the tree filters to
 *      matches and their ancestors; click a row and the canvas pans to
 *      centre that note and flashes it.
 *   3. *Get a task onto (or off) the board.* A task with no note gets a
 *      "+" button, so an outline row is one click from becoming a post-it;
 *      a task that already has one gets a "−" in the same slot instead
 *      (#1108), which only removes the note -- see
 *      wbOutlineBoardToggleClicked().
 *
 * A fourth job, added for issue #1156: *restructure the plan by dragging a
 * row.* Each row has a drag handle. Dropping it in the top half of another
 * row reorders it to sit just before that row (as its new sibling);
 * dropping in the bottom half reorders it to sit just after. Dropping in
 * the bottom half *and* far enough to the right instead nests it as a
 * child of that row -- a deliberately different horizontal zone so a
 * plain up/down reorder is never mistaken for "make this a sub-task", and
 * vice versa (see wbOutlineDropZoneFor()). Reordering writes through the
 * new wbMoveTaskInPlanText(); nesting reuses the same
 * wbReparentTaskInPlanText() a dragged noodle already writes through, so
 * there is exactly one "make X a child of Y" implementation either
 * gesture can produce.
 *
 * Data flow, matching whiteboard-notes.js's own rule: this file never
 * parses plan text. It reads the already-scheduled `wbLastTasks` that
 * updateWhiteboardView() cached, builds its tree with
 * wbBuildOutlineTree()/wbFlattenOutline() (pure, in whiteboard-structure.js,
 * unit tested), and re-renders whenever the notes do. So the outline, the
 * notes and the noodles are three renderings of one hierarchy and cannot
 * drift apart.
 *
 * State that is genuinely view-only -- whether the panel is open, and
 * which nodes are collapsed -- is persisted per project in localStorage,
 * exactly like whiteboard.js persists pan/zoom (wbViewportStorageKey()),
 * and for the same reason: it is a property of how *this* person is
 * looking at the board, not of the plan, so it must not end up in the
 * shared markdown file.
 */

// -- Configuration -------------------------------------------------------

/** Pixels of padding kept around a note when the panel pans to it. */
const WB_OUTLINE_FOCUS_PADDING = 60;

/**
 * How far right of a row's own indent a drop has to land to count as
 * "nest under this row" rather than "reorder next to it" -- see
 * wbOutlineDropZoneFor(). Comfortably more than one indent level (12px)
 * so a slightly wobbly drag never nests by accident.
 */
const WB_OUTLINE_NEST_THRESHOLD_PX = 24;

// -- Module state --------------------------------------------------------

let wbOutlineOpen = true;
let wbOutlineCollapsed = new Set();   // lower-cased task names
let wbOutlineQuery = '';
let wbOutlineEl = null;               // the panel root, once built
let wbOutlineRefs = null;             // { list, search, count, toggleBtn }
let wbOutlineLoadedFor = null;        // project id the state above came from

// -- Persistence (view state only -- never touches plan text) ------------

/**
 * localStorage key for the panel's own state, scoped to a project the same
 * way wbViewportStorageKey() scopes pan/zoom.
 */
function wbOutlineStorageKey(projectId) {
    return 'whiteboard_outline_' + (projectId || 'default');
}

function wbOutlineProjectId() {
    return (typeof getCurrentProjectId === 'function' && getCurrentProjectId()) || 'default';
}

/**
 * Parse persisted panel state. Returns null for missing/invalid input so
 * callers fall back to the defaults (open, nothing collapsed).
 */
function wbParseOutlineState(raw) {
    if (!raw) return null;
    try {
        const data = JSON.parse(raw);
        if (!data || typeof data !== 'object') return null;
        return {
            open: data.open !== false,
            collapsed: Array.isArray(data.collapsed)
                ? data.collapsed.map(n => String(n).toLowerCase())
                : [],
        };
    } catch (e) {
        return null;
    }
}

function wbLoadOutlineState() {
    const projectId = wbOutlineProjectId();
    if (wbOutlineLoadedFor === projectId) return;
    wbOutlineLoadedFor = projectId;
    let saved = null;
    try {
        saved = wbParseOutlineState(localStorage.getItem(wbOutlineStorageKey(projectId)));
    } catch (e) {
        saved = null;
    }
    wbOutlineOpen = saved ? saved.open : true;
    wbOutlineCollapsed = new Set(saved ? saved.collapsed : []);
}

function wbSaveOutlineState() {
    try {
        localStorage.setItem(
            wbOutlineStorageKey(wbOutlineProjectId()),
            JSON.stringify({ open: wbOutlineOpen, collapsed: Array.from(wbOutlineCollapsed) })
        );
    } catch (e) {
        // Storage full/unavailable -- the panel simply won't remember.
    }
}

// -- Panel construction --------------------------------------------------

/**
 * Get-or-create the panel. Lives inside #whiteboardContainer as ordinary
 * absolutely-positioned HTML (a sibling of the SVG, not a foreignObject),
 * so it floats above the canvas and stays put while the board pans -- the
 * same placement the empty state already uses.
 */
function wbEnsureOutlinePanel() {
    const container = document.getElementById('whiteboardContainer');
    if (!container) return null;
    if (wbOutlineEl && container.contains(wbOutlineEl)) return wbOutlineEl;

    const panel = document.createElement('div');
    panel.className = 'wb-outline-panel';
    panel.id = 'whiteboardOutlinePanel';
    panel.setAttribute('aria-label', 'Plan structure');

    const header = document.createElement('div');
    header.className = 'wb-outline-header';

    const heading = document.createElement('h3');
    heading.className = 'wb-outline-title';
    heading.textContent = 'Plan structure';

    const count = document.createElement('span');
    count.className = 'wb-outline-count';

    const actions = document.createElement('div');
    actions.className = 'wb-outline-actions';

    const expandBtn = wbOutlineIconButton('Expand all', 'M4 8 L8 12 L12 8 M4 3 L8 7 L12 3');
    expandBtn.addEventListener('click', () => wbOutlineExpandAll());

    const collapseBtn = wbOutlineIconButton('Collapse all', 'M4 12 L8 8 L12 12 M4 7 L8 3 L12 7');
    collapseBtn.addEventListener('click', () => wbOutlineCollapseAll());

    const hideBtn = wbOutlineIconButton('Hide the outline', 'M10 3 L5 8 L10 13');
    hideBtn.classList.add('wb-outline-hide-btn');
    hideBtn.addEventListener('click', () => wbToggleOutlinePanel());

    actions.appendChild(expandBtn);
    actions.appendChild(collapseBtn);
    actions.appendChild(hideBtn);

    header.appendChild(heading);
    header.appendChild(count);
    header.appendChild(actions);

    const searchWrap = document.createElement('div');
    searchWrap.className = 'wb-outline-search';
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'wb-outline-search-input';
    search.placeholder = 'Find a note...';
    search.setAttribute('aria-label', 'Find a note in the plan structure');
    search.addEventListener('input', () => {
        wbOutlineQuery = search.value;
        wbRenderOutlinePanel();
    });
    search.addEventListener('keydown', (e) => {
        // Keep canvas shortcuts (arrows pan, +/- zoom, f fits) out of the
        // search box -- typing "f" here must type an f, not fit the board.
        e.stopPropagation();
        if (e.key === 'Escape') {
            search.value = '';
            wbOutlineQuery = '';
            wbRenderOutlinePanel();
        }
    });
    searchWrap.appendChild(search);

    const list = document.createElement('div');
    list.className = 'wb-outline-list';
    list.setAttribute('role', 'tree');
    list.setAttribute('aria-label', 'Plan structure');

    panel.appendChild(header);
    panel.appendChild(searchWrap);
    panel.appendChild(list);

    // The collapsed rail: a thin always-present tab that brings the panel
    // back, so hiding it is never a one-way door.
    const rail = document.createElement('button');
    rail.type = 'button';
    rail.className = 'wb-outline-rail';
    rail.id = 'whiteboardOutlineRail';
    rail.title = 'Show the plan structure';
    rail.setAttribute('aria-label', 'Show the plan structure');
    rail.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
        'stroke-width="1.6" stroke-linecap="round" aria-hidden="true">' +
        '<path d="M2 4 h12 M5 8 h9 M8 12 h6"/></svg><span>Structure</span>';
    rail.addEventListener('click', () => wbToggleOutlinePanel());

    container.appendChild(panel);
    container.appendChild(rail);

    wbOutlineEl = panel;
    wbOutlineRefs = { list, search, count, rail };
    return panel;
}

/** A small square icon button for the panel header. */
function wbOutlineIconButton(label, pathD) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wb-outline-btn';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
        'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="' + pathD + '"/></svg>';
    return btn;
}

// -- Rendering -----------------------------------------------------------

/**
 * Re-render the outline from the cached tasks and whiteboard rows. Called
 * at the end of every wbRenderNotes() pass, plus whenever the panel's own
 * state (search, collapse, open/closed) changes.
 */
function wbRenderOutlinePanel() {
    const panel = wbEnsureOutlinePanel();
    if (!panel) return;
    wbLoadOutlineState();

    panel.classList.toggle('hidden', !wbOutlineOpen);
    if (wbOutlineRefs.rail) wbOutlineRefs.rail.classList.toggle('visible', !wbOutlineOpen);
    if (!wbOutlineOpen) return;

    const tasks = (typeof wbLastTasks !== 'undefined' && wbLastTasks) ? wbLastTasks : [];
    const rows = (typeof wbCurrentWhiteboardItems === 'function') ? wbCurrentWhiteboardItems() : [];
    const boardNames = rows.map(r => r && r.task).filter(Boolean);

    const tree = wbBuildOutlineTree(tasks, boardNames);
    const flat = wbFlattenOutline(tree, wbOutlineCollapsed, wbOutlineQuery);

    const { list, count } = wbOutlineRefs;
    // Kept to a bare fraction: the header also carries a title and three
    // buttons in ~260px, and anything wordier ("4 of 16 on the board")
    // gets ellipsised down to "4 of ..." -- which reads as broken rather
    // than as a count. The full phrasing lives in the tooltip instead.
    if (tasks.length) {
        count.textContent = `${boardNames.length} / ${tasks.length}`;
        count.title = `${boardNames.length} of ${tasks.length} tasks have a note on the board`;
    } else {
        count.textContent = '';
        count.removeAttribute('title');
    }

    list.innerHTML = '';

    if (!tasks.length) {
        list.appendChild(wbOutlineEmptyMessage(
            'Nothing in the plan yet. Add a note and it appears here.'
        ));
        return;
    }
    if (!flat.length) {
        list.appendChild(wbOutlineEmptyMessage(
            wbOutlineQuery ? `No task matches "${wbOutlineQuery}".` : 'Nothing to show.'
        ));
        return;
    }

    flat.forEach(row => list.appendChild(wbBuildOutlineRow(row)));
}

function wbOutlineEmptyMessage(text) {
    const el = document.createElement('p');
    el.className = 'wb-outline-empty';
    el.textContent = text;
    return el;
}

/** One row of the outline tree. */
function wbBuildOutlineRow(row) {
    const el = document.createElement('div');
    el.className = 'wb-outline-row';
    el.setAttribute('role', 'treeitem');
    el.dataset.task = row.name;
    el.style.setProperty('--wb-outline-depth', String(row.depth));
    if (row.onBoard) el.classList.add('on-board');
    if (row.matched) el.classList.add('matched');
    if (row.hasChildren) el.setAttribute('aria-expanded', String(!row.collapsed));

    // Drag handle: grabbing it and dropping elsewhere in the panel
    // restructures the plan (#1156) -- see wbAttachOutlineDragHandlers().
    const handle = document.createElement('span');
    handle.className = 'wb-outline-drag-handle';
    handle.setAttribute('draggable', 'true');
    handle.setAttribute('aria-hidden', 'true');
    handle.title = 'Drag to move or nest this task';
    handle.textContent = '⠿';
    el.appendChild(handle);
    wbAttachOutlineDragHandlers(handle, el, row.name);

    // Chevron (or a spacer, so every name lines up at its depth).
    if (row.hasChildren) {
        const chevron = document.createElement('button');
        chevron.type = 'button';
        chevron.className = 'wb-outline-chevron';
        chevron.classList.toggle('collapsed', row.collapsed);
        chevron.title = row.collapsed ? 'Expand' : 'Collapse';
        chevron.setAttribute('aria-label', (row.collapsed ? 'Expand ' : 'Collapse ') + row.name);
        chevron.innerHTML =
            '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" ' +
            'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<path d="M4 2 L8 6 L4 10"/></svg>';
        chevron.addEventListener('click', (e) => {
            e.stopPropagation();
            wbToggleOutlineNode(row.name);
        });
        el.appendChild(chevron);
    } else {
        const spacer = document.createElement('span');
        spacer.className = 'wb-outline-chevron-spacer';
        spacer.setAttribute('aria-hidden', 'true');
        el.appendChild(spacer);
    }

    // The name, and the dot marking a task that has a note on the board.
    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'wb-outline-label';
    label.title = row.onBoard
        ? `Show "${row.name}" on the board`
        : `${row.name} — not on the board yet`;

    const dot = document.createElement('span');
    dot.className = 'wb-outline-dot';
    dot.setAttribute('aria-hidden', 'true');

    const text = document.createElement('span');
    text.className = 'wb-outline-name';
    text.textContent = row.name;

    label.appendChild(dot);
    label.appendChild(text);
    label.addEventListener('click', () => wbOutlineRowActivated(row.name, row.onBoard));
    el.appendChild(label);

    // Percent complete, when the engine has one for this task.
    const percent = Number(row.task && row.task.percent);
    if (Number.isFinite(percent) && percent > 0) {
        const pct = document.createElement('span');
        pct.className = 'wb-outline-percent';
        pct.textContent = Math.round(percent) + '%';
        el.appendChild(pct);
    }

    // Pin / unpin toggle (#1108, reglyphed in #1291). Same slot either way:
    // a task with no note yet gets a pin ("pin it to the board"); one that
    // already has a note gets a struck-through pin ("unpin it"), so the
    // control always reflects whether *this* row is currently represented on
    // the canvas -- see wbOutlineBoardToggleClicked() for what each side
    // actually does. The glyphs replaced a bare "+" and "−", which named the
    // mechanics (a row appears in, or leaves, the plan's Whiteboard section)
    // rather than the act, and read as "add a task" / "delete a task" on a
    // panel that also restructures the plan.
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'wb-outline-add' + (row.onBoard ? ' wb-outline-remove' : '');
    toggle.title = row.onBoard
        ? `Unpin "${row.name}" from the board`
        : `Pin "${row.name}" to the board`;
    toggle.setAttribute('aria-label', row.onBoard
        ? `Unpin ${row.name} from the board. This only removes the note; the task and its subtasks stay in your plan.`
        : `Pin ${row.name} to the board`);
    wbOutlineSetToggleGlyph(toggle, row.onBoard);
    toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        wbOutlineBoardToggleClicked(row.name, row.onBoard);
    });
    el.appendChild(toggle);

    return el;
}

/**
 * Paint the outline toggle's two states (#1291): a pin when the row is not on
 * the board, the same pin struck through when it is.
 *
 * The glyphs come from components/note/note-markup.js, through the global the
 * board's own notes already take them from, so the pin on an outline row and
 * the pin on a note are one drawing rather than two that can drift. This file
 * is a classic script and cannot import the module, but rows are only ever
 * built once the whiteboard view is open -- long after every deferred module
 * has run -- which is the same ordering wbCreateNoteNode() relies on.
 *
 * The `+`/`−` fallback is for the case that ordering cannot happen at all
 * (the module failed to load): a text toggle that still works beats a row
 * with an empty button on it.
 */
function wbOutlineSetToggleGlyph(button, onBoard) {
    const markup = (typeof globalThis !== 'undefined') ? globalThis.NoodleNoteMarkup : null;
    const glyph = markup && (onBoard ? markup.unpinGlyph : markup.pinGlyph);
    if (typeof glyph === 'function') {
        button.innerHTML = glyph(13);
    } else {
        button.textContent = onBoard ? '−' : '+';
    }
}

/**
 * Which action the outline's add/remove toggle takes for a row that is (or
 * isn't) currently on the board. Pure decision, split out from the click
 * handler so it's testable without a DOM -- see
 * tests/test_whiteboard_outline_toggle.mjs.
 */
function wbOutlineBoardToggleAction(onBoard) {
    return onBoard ? 'remove' : 'add';
}

/**
 * Run the outline's add/remove toggle for `taskName`. 'add' reuses
 * wbCommitAddNotes() -- the same single-name path the picker's own "Add"
 * takes. 'remove' reuses wbRemoveNoteFromBoard() -- the same function the
 * note header's own "Remove from board" menu item calls -- so this is
 * never a second implementation of either action, only a second place to
 * trigger them, and removing a note here leaves the task and its subtasks
 * exactly as intact as it does from the note menu.
 */
function wbOutlineBoardToggleClicked(taskName, onBoard) {
    if (wbOutlineBoardToggleAction(onBoard) === 'remove') {
        return (typeof wbRemoveNoteFromBoard === 'function') ? wbRemoveNoteFromBoard(taskName) : false;
    }
    return (typeof wbCommitAddNotes === 'function') ? wbCommitAddNotes([taskName]) : false;
}

// -- Drag to restructure (#1156) ------------------------------------------

/** Remove every row's drop-target styling. Called before re-marking one. */
function wbClearOutlineDropIndicators() {
    if (!wbOutlineRefs || !wbOutlineRefs.list) return;
    wbOutlineRefs.list.querySelectorAll(
        '.wb-outline-drop-before, .wb-outline-drop-after, .wb-outline-drop-child'
    ).forEach(row => row.classList.remove(
        'wb-outline-drop-before', 'wb-outline-drop-after', 'wb-outline-drop-child'
    ));
}

/**
 * Which of the three drop zones `(clientX, clientY)` falls in, relative to
 * `row`: 'before' (top half -- reorder to sit just above it), 'after'
 * (bottom half, at or left of the row's own indent -- reorder to sit just
 * below it), or 'child' (bottom half *and* past
 * WB_OUTLINE_NEST_THRESHOLD_PX to the right of the row's indent -- nest
 * under it). The horizontal check only applies to the bottom half so a
 * plain reorder-before never needs a precise horizontal position to hit.
 */
function wbOutlineDropZoneFor(row, clientX, clientY) {
    const rect = row.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) return 'before';

    const indentPx = parseFloat(getComputedStyle(row).paddingLeft) || 0;
    const nestThreshold = rect.left + indentPx + WB_OUTLINE_NEST_THRESHOLD_PX;
    return clientX >= nestThreshold ? 'child' : 'after';
}

/**
 * Commit a drop: `sourceTaskName` was dragged onto `targetTaskName`'s row
 * in the given `zone`. 'child' reuses wbReparentTaskInPlanText() (the same
 * write a dragged noodle makes) via wbLinkNotes()'s cycle/self-link
 * checks; 'before'/'after' write through the new wbMoveTaskInPlanText().
 * Both paths no-op silently on a drop that changes nothing (dragging a row
 * onto itself, or right back where it already was).
 */
function wbOutlineRowDropped(sourceTaskName, targetTaskName, zone) {
    if (!sourceTaskName || !targetTaskName) return false;
    if (String(sourceTaskName).toLowerCase() === String(targetTaskName).toLowerCase()) return false;

    if (zone === 'child') {
        return (typeof wbLinkNotes === 'function') ? wbLinkNotes(targetTaskName, sourceTaskName) : false;
    }

    const editor = document.getElementById('planEditor');
    if (!editor || typeof wbMoveTaskInPlanText !== 'function' || typeof wbCommitMarkdown !== 'function') {
        return false;
    }
    const next = wbMoveTaskInPlanText(editor.value, sourceTaskName, targetTaskName, zone === 'before');
    return wbCommitMarkdown(next);
}

/**
 * Wire up dragging `taskName`'s row via `handle`, restructuring the plan
 * on drop (see wbOutlineRowDropped()). Two parallel gestures, matching
 * notepad.js's own drag-to-reorder: native HTML5 drag-and-drop for a
 * mouse, and a pointer-based fallback for touch (which never fires
 * dragstart on most mobile browsers).
 */
function wbAttachOutlineDragHandlers(handle, row, taskName) {
    handle.addEventListener('dragstart', event => {
        event.stopPropagation();
        row.classList.add('wb-outline-dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', taskName);
        if (typeof event.dataTransfer.setDragImage === 'function') {
            event.dataTransfer.setDragImage(row, 0, row.offsetHeight / 2);
        }
    });
    handle.addEventListener('dragend', () => {
        row.classList.remove('wb-outline-dragging');
        wbClearOutlineDropIndicators();
    });
    row.addEventListener('dragover', event => {
        if (event.dataTransfer.types.indexOf('text/plain') === -1) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const zone = wbOutlineDropZoneFor(row, event.clientX, event.clientY);
        wbClearOutlineDropIndicators();
        row.classList.add('wb-outline-drop-' + zone);
    });
    row.addEventListener('dragleave', event => {
        if (row.contains(event.relatedTarget)) return;
        row.classList.remove('wb-outline-drop-before', 'wb-outline-drop-after', 'wb-outline-drop-child');
    });
    row.addEventListener('drop', event => {
        event.preventDefault();
        const zone = wbOutlineDropZoneFor(row, event.clientX, event.clientY);
        wbClearOutlineDropIndicators();
        const sourceTaskName = event.dataTransfer.getData('text/plain');
        wbOutlineRowDropped(sourceTaskName, taskName, zone);
    });

    let gesture = null;
    handle.addEventListener('pointerdown', event => {
        if (event.pointerType === 'mouse') return;
        gesture = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, dragging: false };
        handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', event => {
        if (!gesture || event.pointerId !== gesture.pointerId) return;
        const distance = Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY);
        if (!gesture.dragging && distance < 8) return;
        gesture.dragging = true;
        event.preventDefault();
        row.classList.add('wb-outline-dragging');
        const targetRow = document.elementFromPoint(event.clientX, event.clientY)?.closest('.wb-outline-row');
        wbClearOutlineDropIndicators();
        gesture.target = (targetRow && targetRow !== row) ? targetRow : null;
        gesture.zone = null;
        if (gesture.target) {
            gesture.zone = wbOutlineDropZoneFor(gesture.target, event.clientX, event.clientY);
            gesture.target.classList.add('wb-outline-drop-' + gesture.zone);
        }
    });
    const finishPointer = event => {
        if (!gesture || event.pointerId !== gesture.pointerId) return;
        const completed = gesture;
        gesture = null;
        row.classList.remove('wb-outline-dragging');
        wbClearOutlineDropIndicators();
        if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
        if (event.type !== 'pointercancel' && completed.dragging && completed.target) {
            wbOutlineRowDropped(taskName, completed.target.dataset.task, completed.zone);
        }
    };
    handle.addEventListener('pointerup', finishPointer);
    handle.addEventListener('pointercancel', finishPointer);
}

// -- Interactions --------------------------------------------------------

/**
 * A row was clicked: pan the board to that note and flash it, or -- for a
 * task with no note yet -- say so rather than silently doing nothing.
 */
function wbOutlineRowActivated(taskName, onBoard) {
    if (!onBoard) {
        if (typeof wbFlashNoodleMessage === 'function') {
            wbFlashNoodleMessage(`"${taskName}" isn't on the board yet — use + to add it.`);
        }
        return;
    }
    if (typeof whiteboardFocusNote === 'function') whiteboardFocusNote(taskName);
}

function wbToggleOutlineNode(taskName) {
    const key = String(taskName).toLowerCase();
    if (wbOutlineCollapsed.has(key)) wbOutlineCollapsed.delete(key);
    else wbOutlineCollapsed.add(key);
    wbSaveOutlineState();
    wbRenderOutlinePanel();
}

function wbOutlineExpandAll() {
    wbOutlineCollapsed.clear();
    wbSaveOutlineState();
    wbRenderOutlinePanel();
}

function wbOutlineCollapseAll() {
    const tasks = (typeof wbLastTasks !== 'undefined' && wbLastTasks) ? wbLastTasks : [];
    // Only tasks that actually have children are collapsible; collapsing a
    // leaf would just leave dead entries in the persisted set.
    const parents = new Set(tasks.map(t => t && t.parent).filter(Boolean).map(n => String(n).toLowerCase()));
    wbOutlineCollapsed = parents;
    wbSaveOutlineState();
    wbRenderOutlinePanel();
}

/** Show/hide the whole panel, collapsing it to its rail. */
function wbToggleOutlinePanel(force) {
    wbLoadOutlineState();
    wbOutlineOpen = (typeof force === 'boolean') ? force : !wbOutlineOpen;
    wbSaveOutlineState();
    wbRenderOutlinePanel();
    wbUpdateOutlineToolbarButton();
}

/** Keep the toolbar's Structure toggle in sync with the panel. */
function wbUpdateOutlineToolbarButton() {
    const btn = document.getElementById('whiteboardOutlineBtn');
    if (!btn) return;
    btn.classList.toggle('active', wbOutlineOpen);
    btn.setAttribute('aria-pressed', String(wbOutlineOpen));
}
