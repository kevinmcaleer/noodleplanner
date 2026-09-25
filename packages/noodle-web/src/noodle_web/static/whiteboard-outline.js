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
 * A right-click on a row opens its own menu -- rename, edit, assign
 * resources, indent, outdent, delete -- on the host's board and a
 * collaborator's alike; see wbBuildOutlineRowMenu().
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

// While the host runs a planning session: lower-cased task name ->
// 'shown' | 'hidden' | 'inherited', from collab-session.js. Null otherwise,
// which is what keeps the eye controls off every other board -- the
// joiner's included, since its page never loads collab-session.js.
let wbOutlineVisibility = null;

// The task whose name is being edited in place, or null. While set, the
// panel does not rebuild its rows -- a plan snapshot arriving mid-edit (a
// collaborator's change, or the host's in a planning session) would
// otherwise throw away the input and what was typed into it.
let wbOutlineEditingName = null;

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

    // Planning-session host only: hide everything from collaborators, or
    // share it all again -- see wbOutlineVisibilityActive().
    const shareAllBtn = document.createElement('button');
    shareAllBtn.type = 'button';
    shareAllBtn.className = 'wb-outline-btn wb-outline-share-all';
    shareAllBtn.hidden = true;
    shareAllBtn.addEventListener('click', () => {
        if (typeof toggleCollabAllVisibility === 'function') toggleCollabAllVisibility();
    });

    const hideBtn = wbOutlineIconButton('Hide the outline', 'M10 3 L5 8 L10 13');
    hideBtn.classList.add('wb-outline-hide-btn');
    hideBtn.addEventListener('click', () => wbToggleOutlinePanel());

    actions.appendChild(shareAllBtn);
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
    wbOutlineRefs = { list, search, count, rail, shareAllBtn };
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
    if (wbOutlineEditingName !== null) return;
    wbLoadOutlineState();

    panel.classList.toggle('hidden', !wbOutlineOpen);
    if (wbOutlineRefs.rail) wbOutlineRefs.rail.classList.toggle('visible', !wbOutlineOpen);
    if (!wbOutlineOpen) return;

    const tasks = (typeof wbLastTasks !== 'undefined' && wbLastTasks) ? wbLastTasks : [];
    const rows = (typeof wbCurrentWhiteboardItems === 'function') ? wbCurrentWhiteboardItems() : [];
    const boardNames = rows.map(r => r && r.task).filter(Boolean);

    const tree = wbBuildOutlineTree(tasks, boardNames);
    const flat = wbFlattenOutline(tree, wbOutlineCollapsed, wbOutlineQuery);
    wbOutlineVisibility = wbOutlineVisibilityActive() ? collabVisibilityStatuses() : null;
    wbRenderOutlineShareAll(tasks.length > 0);

    const { list, count } = wbOutlineRefs;
    // Kept to a bare fraction: the header also carries a title and up to four
    // buttons in ~300px, and anything wordier ("4 of 16 on the board")
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
    label.title += ' (double-click to rename)';

    const dot = document.createElement('span');
    dot.className = 'wb-outline-dot';
    dot.setAttribute('aria-hidden', 'true');

    const text = document.createElement('span');
    text.className = 'wb-outline-name';
    text.textContent = row.name;

    label.appendChild(dot);
    label.appendChild(text);
    label.addEventListener('click', () => wbOutlineRowActivated(row.name, row.onBoard));
    label.addEventListener('dblclick', (e) => {
        e.preventDefault();
        wbOutlineBeginRename(label, row.name);
    });
    label.addEventListener('keydown', (e) => {
        if (e.key === 'F2') {
            e.preventDefault();
            wbOutlineBeginRename(label, row.name);
        }
    });
    el.appendChild(label);

    if (wbOutlineVisibility) wbAppendOutlineEye(el, label, row.name);

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

    el.addEventListener('contextmenu', (e) => wbOutlineRowContextMenu(e, row.name, el));

    return el;
}

// -- Right-click menu ------------------------------------------------------
//
// A row's own menu: rename, edit, assign resources, indent, outdent and
// delete, for any task in the structure whether or not it has a note. It is
// the same on the host's board and a collaborator's, because every item
// commits through wbCommitMarkdown(), which a collaborator's page sends to
// the host like any other whiteboard edit. It shares the note menu's DOM
// id, styling and wbShowBoardMenu() plumbing, so opening it closes any other
// board menu and the keyboard and outside-click handling are that menu's.

/** Right-click (or the context-menu key) on a row. A rename in progress
 * keeps the browser's own menu, where cut, copy and paste live. */
function wbOutlineRowContextMenu(e, taskName, rowEl) {
    const target = e.target;
    if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName || '')) return;
    e.preventDefault();
    e.stopPropagation();
    let x = e.clientX;
    let y = e.clientY;
    if (x === 0 && y === 0) {
        // From the keyboard: no pointer, so open under the row's name.
        const rect = rowEl.getBoundingClientRect();
        x = rect.left + 24;
        y = rect.bottom;
    }
    wbOpenOutlineRowMenu(taskName, x, y, rowEl.querySelector('.wb-outline-label') || rowEl);
}

function wbOpenOutlineRowMenu(taskName, clientX, clientY, returnFocus) {
    if (typeof wbShowBoardMenu !== 'function') return;
    wbShowBoardMenu(wbBuildOutlineRowMenu(taskName),
        { taskName, btn: null, returnFocus }, { x: clientX, y: clientY });
}

/** The plan text the menu's writes start from. */
function wbOutlinePlanText() {
    const editor = document.getElementById('planEditor');
    return editor ? editor.value : '';
}

/**
 * Build the row menu for `taskName`. Indent and Outdent are always listed,
 * so they can be found, but are marked aria-disabled -- still focusable,
 * per the menu pattern -- with the reason in their tooltip when the task
 * has nowhere to go.
 */
function wbBuildOutlineRowMenu(taskName) {
    const menu = document.createElement('div');
    menu.id = 'wbNoteMenu';
    menu.className = 'wb-note-menu wb-outline-row-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', `Options for ${taskName}`);

    const list = document.createElement('ul');
    list.className = 'wb-note-menu-list';
    list.setAttribute('role', 'none');
    menu.appendChild(list);

    const addItem = (label, title, action, options) => {
        const opts = options || {};
        const li = document.createElement('li');
        li.setAttribute('role', 'none');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = opts.className || 'wb-note-menu-action';
        btn.setAttribute('role', 'menuitem');
        btn.textContent = label;
        btn.title = title;
        if (opts.disabled) btn.setAttribute('aria-disabled', 'true');
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (opts.disabled) return;
            wbCloseNoteMenu();
            action();
        });
        li.appendChild(btn);
        list.appendChild(li);
        return btn;
    };
    const addDivider = () => {
        const li = document.createElement('li');
        li.className = 'wb-note-menu-divider';
        li.setAttribute('role', 'separator');
        list.appendChild(li);
    };

    addItem('Rename', 'Rename this task (or double-click its name, or press F2)',
        () => wbOutlineRenameByName(taskName));
    addItem('Edit task…', 'Change the task\'s details',
        () => wbOutlineEditTask(taskName));
    addItem('Assign resources…', 'Choose who works on this task',
        () => wbOutlineAssignResources(taskName));

    addDivider();
    const text = wbOutlinePlanText();
    const neighbours = wbOutlineNeighbours(text, taskName);
    const canIndent = wbIndentTaskInPlanText(text, taskName) !== text;
    const canOutdent = wbOutdentTaskInPlanText(text, taskName) !== text;
    addItem('Indent',
        canIndent
            ? `Make this a subtask of "${neighbours.previousSibling}"`
            : 'Nothing above this task at the same level to make it a subtask of',
        () => wbOutlineIndentTask(taskName), { disabled: !canIndent });
    addItem('Outdent',
        canOutdent
            ? `Move this task out of "${neighbours.parent}", one level up`
            : 'Already at the top level of the plan',
        () => wbOutlineOutdentTask(taskName), { disabled: !canOutdent });

    addDivider();
    const deleteBtn = addItem('Delete task',
        'Deletes the task and its subtasks from the plan, not just its note',
        () => { if (typeof wbDeleteNoteTask === 'function') wbDeleteNoteTask(taskName); },
        { className: 'wb-note-menu-remove wb-note-menu-delete' });
    deleteBtn.setAttribute('aria-label',
        `Delete ${taskName}. This removes the task and its subtasks from the plan, not just the note.`);

    return menu;
}

/** The outline row showing `taskName`, or null when it is not rendered. */
function wbOutlineRowFor(taskName) {
    if (!wbOutlineRefs || !wbOutlineRefs.list) return null;
    const key = String(taskName).toLowerCase();
    return Array.from(wbOutlineRefs.list.querySelectorAll('.wb-outline-row'))
        .find(row => String(row.dataset.task).toLowerCase() === key) || null;
}

/** "Rename": the same in-place edit a double-click on the row starts. */
function wbOutlineRenameByName(taskName) {
    const row = wbOutlineRowFor(taskName);
    const label = row && row.querySelector('.wb-outline-label');
    if (label) wbOutlineBeginRename(label, taskName);
}

/**
 * "Edit task…": the task-details form, through the same wbOpenChildTask()
 * the note menu's "Open task details" uses. On a collaborator's page that
 * form is the host's, so collab-join.js answers it with the quick editor
 * below instead.
 */
function wbOutlineEditTask(taskName) {
    if (typeof wbOpenChildTask === 'function') wbOpenChildTask(taskName);
}

/** "Assign resources…": the note's own quick-assign menu, under the row. */
function wbOutlineAssignResources(taskName) {
    if (typeof wbToggleResourceMenu !== 'function') return;
    const row = wbOutlineRowFor(taskName);
    const anchor = (row && row.querySelector('.wb-outline-label')) || row;
    if (anchor) wbToggleResourceMenu(taskName, anchor);
}

function wbOutlineIndentTask(taskName) {
    if (typeof wbCommitMarkdown !== 'function') return false;
    const text = wbOutlinePlanText();
    const next = wbIndentTaskInPlanText(text, taskName);
    return next === text ? false : wbCommitMarkdown(next);
}

function wbOutlineOutdentTask(taskName) {
    if (typeof wbCommitMarkdown !== 'function') return false;
    const text = wbOutlinePlanText();
    const next = wbOutdentTaskInPlanText(text, taskName);
    return next === text ? false : wbCommitMarkdown(next);
}

// -- Quick task editor ------------------------------------------------------
//
// A small form for the fields a task line carries that the board has no
// direct control for: duration, percent complete and the comment. It exists
// for planning-session collaborators, whose page has no task-details form
// (that form is the host's app) -- see openTaskFormByName() in
// collab-join.js. Saving writes through wbSetTaskFieldsInPlanText() and
// wbCommitMarkdown(), so it is one undo step on the host and one edit sent
// to the host from a collaborator. Renaming stays the row's and the note's
// own job, rather than a second way to do it here.

let wbQuickEditState = null;   // { form, returnFocus }

function wbCloseQuickTaskEditor(restoreFocus) {
    if (!wbQuickEditState) return;
    const { form, returnFocus } = wbQuickEditState;
    wbQuickEditState = null;
    if (form.parentNode) form.remove();
    document.removeEventListener('mousedown', wbQuickEditOutsideClick, true);
    if (restoreFocus && returnFocus && document.contains(returnFocus)) returnFocus.focus();
}

function wbQuickEditOutsideClick(e) {
    if (!wbQuickEditState || wbQuickEditState.form.contains(e.target)) return;
    wbCloseQuickTaskEditor(false);
}

/** The element the editor opens beside: the task's note, its outline row,
 * or failing both the board itself. */
function wbQuickEditAnchor(taskName) {
    const entry = (typeof wbNoteNodes !== 'undefined' && wbNoteNodes) ? wbNoteNodes.get(taskName) : null;
    if (entry && entry.refs && entry.refs.card) return entry.refs.card;
    return wbOutlineRowFor(taskName) || document.getElementById('whiteboardContainer');
}

/** A labelled field for the quick editor. */
function wbQuickEditField(form, id, labelText, input, hint) {
    const group = document.createElement('div');
    group.className = 'wb-quick-edit-field';
    const label = document.createElement('label');
    label.setAttribute('for', id);
    label.textContent = labelText;
    input.id = id;
    group.appendChild(label);
    group.appendChild(input);
    if (hint) {
        const small = document.createElement('small');
        small.textContent = hint;
        group.appendChild(small);
    }
    form.appendChild(group);
    return input;
}

/**
 * Open the quick editor for `taskName`. Returns false (and opens nothing)
 * when the task is not in the plan outline.
 */
function wbOpenQuickTaskEditor(taskName) {
    const editor = document.getElementById('planEditor');
    const current = editor ? wbTaskFieldsFromPlanText(editor.value, taskName) : null;
    if (!current) return false;
    const name = current.name;
    // A summary task's duration is its children's span; the scheduler
    // ignores one written on its line, so offering it would be a lie.
    const isSummary = typeof wbHasChildren === 'function' && wbHasChildren(wbLastTasks, name);

    wbCloseQuickTaskEditor(false);
    if (typeof wbCloseNoteMenu === 'function') wbCloseNoteMenu();
    if (typeof wbCloseSmartMenu === 'function') wbCloseSmartMenu();

    const returnFocus = document.activeElement;
    const form = document.createElement('form');
    form.className = 'wb-smart-menu wb-quick-edit';
    form.setAttribute('role', 'dialog');
    form.setAttribute('aria-label', `Edit ${name}`);
    form.noValidate = true;

    const heading = document.createElement('strong');
    heading.textContent = name;
    form.appendChild(heading);

    let durationInput = null;
    if (!isSummary) {
        durationInput = document.createElement('input');
        durationInput.type = 'text';
        durationInput.value = current.duration;
        durationInput.placeholder = 'e.g. 3d or 2w';
        wbQuickEditField(form, 'wbQuickEditDuration', 'Duration', durationInput);
    }

    const percentInput = document.createElement('input');
    percentInput.type = 'number';
    percentInput.min = '0';
    percentInput.max = '100';
    percentInput.step = '5';
    percentInput.value = current.percent;
    wbQuickEditField(form, 'wbQuickEditPercent', '% complete', percentInput);

    const commentInput = document.createElement('textarea');
    commentInput.rows = 3;
    commentInput.value = current.comment;
    wbQuickEditField(form, 'wbQuickEditComment', 'Comment', commentInput);

    const error = document.createElement('p');
    error.className = 'wb-quick-edit-error';
    error.setAttribute('role', 'alert');
    error.hidden = true;
    form.appendChild(error);

    const actions = document.createElement('div');
    actions.className = 'wb-quick-edit-actions';
    const cancel = document.createElement('np-button');
    cancel.setAttribute('variant', 'neutral');
    cancel.setAttribute('size', 'small');
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => wbCloseQuickTaskEditor(true));
    const save = document.createElement('np-button');
    save.setAttribute('variant', 'primary');
    save.setAttribute('size', 'small');
    save.textContent = 'Save';
    save.addEventListener('click', () => form.requestSubmit());
    actions.appendChild(cancel);
    actions.appendChild(save);
    form.appendChild(actions);

    const fail = (message, input) => {
        error.textContent = message;
        error.hidden = false;
        input.focus();
    };
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const duration = durationInput ? durationInput.value.trim() : undefined;
        const percent = percentInput.value.trim();
        if (durationInput && duration && !/^\d+[dwmy]?$/i.test(duration)) {
            fail('Duration is a number of days, or e.g. 2w for weeks.', durationInput);
            return;
        }
        if (percent && !(/^\d+$/.test(percent) && Number(percent) <= 100)) {
            fail('% complete is a whole number from 0 to 100.', percentInput);
            return;
        }
        const fields = { percent, comment: commentInput.value };
        if (durationInput) fields.duration = duration;
        const text = editor.value;
        const next = wbSetTaskFieldsInPlanText(text, name, fields);
        wbCloseQuickTaskEditor(true);
        if (next !== text && typeof wbCommitMarkdown === 'function') wbCommitMarkdown(next);
    });
    form.addEventListener('keydown', (e) => {
        // Keep the board's shortcuts (arrows pan, f fits ...) out of the form.
        e.stopPropagation();
        if (e.key === 'Escape') {
            e.preventDefault();
            wbCloseQuickTaskEditor(true);
        } else if (e.key === 'Enter' && !e.shiftKey &&
                   /^(INPUT|TEXTAREA)$/.test(e.target.tagName || '')) {
            // Enter saves from any field; Shift+Enter is left to the comment.
            e.preventDefault();
            form.requestSubmit();
        }
    });

    document.body.appendChild(form);
    wbPlaceQuickTaskEditor(form, wbQuickEditAnchor(name));
    wbQuickEditState = { form, returnFocus };
    setTimeout(() => {
        if (wbQuickEditState && wbQuickEditState.form === form) {
            document.addEventListener('mousedown', wbQuickEditOutsideClick, true);
        }
    }, 0);
    (durationInput || percentInput).focus();
    return true;
}

/** Beside `anchor`, kept inside the board's safe band -- the placement
 * rule wbOpenSmartMenu() uses for the note's own popups. */
function wbPlaceQuickTaskEditor(form, anchor) {
    const edgeGap = 8;
    const bounds = (typeof wbNoteMenuSafeBounds === 'function')
        ? wbNoteMenuSafeBounds(edgeGap)
        : { top: edgeGap, bottom: window.innerHeight - edgeGap };
    const rect = anchor ? anchor.getBoundingClientRect()
        : { left: edgeGap, right: edgeGap, top: bounds.top, bottom: bounds.top };
    const box = form.getBoundingClientRect();
    let left = rect.right + edgeGap;
    if (left + box.width > window.innerWidth - edgeGap) left = rect.left - box.width - edgeGap;
    left = Math.max(edgeGap, Math.min(left, window.innerWidth - box.width - edgeGap));
    const top = Math.max(bounds.top, Math.min(rect.top, bounds.bottom - box.height));
    form.style.maxHeight = `${Math.max(120, bounds.bottom - top)}px`;
    form.style.left = `${left}px`;
    form.style.top = `${top}px`;
}

// -- Hiding from collaborators (planning-session host only) ----------------

/** True on the host's board while a planning session is live. */
function wbOutlineVisibilityActive() {
    return typeof collabVisibilityControlsActive === 'function' && collabVisibilityControlsActive();
}

function wbOutlineEyeGlyph(button, hidden) {
    button.innerHTML = '';
    const icon = document.createElement('i');
    icon.className = hidden ? 'bi bi-eye-slash' : 'bi bi-eye';
    icon.setAttribute('aria-hidden', 'true');
    button.appendChild(icon);
}

/** The header's eye: hide the whole plan from collaborators, or share it
 * all again. */
function wbRenderOutlineShareAll(hasTasks) {
    const button = wbOutlineRefs && wbOutlineRefs.shareAllBtn;
    if (!button) return;
    button.hidden = !wbOutlineVisibility || !hasTasks;
    if (button.hidden) return;
    const anyShared = typeof collabAnyTaskShared === 'function' ? collabAnyTaskShared() : true;
    const label = anyShared
        ? 'Hide the whole plan from collaborators'
        : 'Show the whole plan to collaborators';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(!anyShared));
    button.classList.toggle('is-hidden', !anyShared);
    wbOutlineEyeGlyph(button, !anyShared);
}

/** A row's eye: hide this task and everything under it from collaborators,
 * or share it again. A row hidden by a parent shows a dimmed slashed eye;
 * clicking it shares the path down to this task, not its siblings. */
function wbAppendOutlineEye(rowEl, label, taskName) {
    const status = wbOutlineVisibility.get(String(taskName).toLowerCase()) || 'shown';
    const hidden = status !== 'shown';
    rowEl.classList.toggle('collab-hidden', hidden);
    rowEl.classList.toggle('collab-hidden-inherited', status === 'inherited');

    const eye = document.createElement('button');
    eye.type = 'button';
    eye.className = 'wb-outline-eye';
    let text;
    if (status === 'shown') text = `Hide "${taskName}" from collaborators`;
    else if (status === 'hidden') text = `Show "${taskName}" to collaborators`;
    else text = `"${taskName}" is hidden with its parent — show it to collaborators`;
    eye.title = text;
    eye.setAttribute('aria-label', text);
    eye.setAttribute('aria-pressed', String(hidden));
    wbOutlineEyeGlyph(eye, hidden);
    eye.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof toggleCollabTaskVisibility === 'function') toggleCollabTaskVisibility(taskName);
    });
    rowEl.insertBefore(eye, label);
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
 * A row was clicked: pan the board to that note and flash it, frame the
 * whole boundary when the row is a group, or -- for a task with no note
 * yet -- say so rather than silently doing nothing.
 *
 * A group has no note of its own (see whiteboard-groups.js), so
 * whiteboardFocusNote() finds nothing for it; it is framed the way the
 * group toolbar's "Zoom to this group" frames it, zooming out as well as
 * in so a group bigger than the screen fits whole.
 */
function wbOutlineRowActivated(taskName, onBoard) {
    if (wbOutlineFocusGroup(taskName)) return;
    if (!onBoard) {
        if (typeof wbFlashNoodleMessage === 'function') {
            wbFlashNoodleMessage(`"${taskName}" isn't on the board yet — use + to add it.`);
        }
        return;
    }
    if (typeof whiteboardFocusNote === 'function') whiteboardFocusNote(taskName);
}

/**
 * Double-click (or F2) on a row's name: edit it in place. Enter or clicking
 * away keeps what was typed, Escape keeps the old name. The rename goes
 * through wbRenameNoteTask() -- the same path a note's own title edit takes
 * -- so the outline line, every `[depends ...]` naming the task and its
 * whiteboard rows (note or group) all follow the new name in one commit,
 * for any task in the structure whether or not it is on the board. On a
 * collaborator's board that commit is sent to the host like any other
 * whiteboard edit.
 */
function wbOutlineBeginRename(label, taskName) {
    if (wbOutlineEditingName !== null) return;
    wbOutlineEditingName = taskName;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'wb-outline-rename-input';
    input.value = taskName;
    input.setAttribute('aria-label', `Rename ${taskName}`);
    // The input replaces the whole label: an input nested in a <button>
    // is invalid markup, and some browsers will not let it take a caret.
    label.replaceWith(input);

    let finished = false;
    const finish = (keep) => {
        if (finished) return;
        finished = true;
        const typed = input.value.trim();
        wbOutlineEditingName = null;
        if (keep && typed && typed !== taskName && typeof wbRenameNoteTask === 'function') {
            wbRenameNoteTask(taskName, typed);
        }
        wbRenderOutlinePanel();
    };

    // Keep clicks and keys inside the input: a click would bubble to the
    // label and pan the board, and canvas shortcuts must not fire on typing.
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('dblclick', (e) => e.stopPropagation());
    input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
    input.focus();
    input.select();
}

/** Frame the group boundary named `taskName`, if the board draws one. */
function wbOutlineFocusGroup(taskName) {
    if (typeof wbGroupNodes === 'undefined' || !wbGroupNodes || typeof wbZoomToBoardRect !== 'function') {
        return false;
    }
    const key = String(taskName).toLowerCase();
    let node = wbGroupNodes.get(taskName);
    if (!node) {
        for (const [name, candidate] of wbGroupNodes) {
            if (String(name).toLowerCase() === key) { node = candidate; break; }
        }
    }
    if (!node || !node.rect) return false;
    const r = node.rect;
    return wbZoomToBoardRect({
        x: +r.getAttribute('x'), y: +r.getAttribute('y'),
        width: +r.getAttribute('width'), height: +r.getAttribute('height'),
    });
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
