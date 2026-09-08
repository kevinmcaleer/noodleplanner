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
 *   3. *Get a task onto the board.* A task with no note gets an add
 *      button, so an outline row is one click from becoming a post-it.
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
            'Nothing in the plan yet. Add a post-it and it appears here.'
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

    // Add-to-board button for anything not already on it.
    if (!row.onBoard) {
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'wb-outline-add';
        add.title = `Add "${row.name}" to the board`;
        add.setAttribute('aria-label', `Add ${row.name} to the board`);
        add.textContent = '+';
        add.addEventListener('click', (e) => {
            e.stopPropagation();
            if (typeof wbCommitAddNotes === 'function') wbCommitAddNotes([row.name]);
        });
        el.appendChild(add);
    }

    return el;
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
