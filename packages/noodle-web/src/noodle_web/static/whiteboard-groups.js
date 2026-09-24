/**
 * Whiteboard grouping and merging — issue #874's "join/group" half.
 *
 * Two gestures a facilitator already has at a physical wall, and the
 * multi-select both of them need:
 *
 *   Group  — drag a lasso round several notes on empty canvas (or
 *            shift-click them), then "Group these" or Ctrl/Cmd+G. A
 *            boundary titled "Untitled group" is drawn around them, its
 *            title already in edit.
 *   Merge   — drag one note onto another, or select several and Combine.
 *            The sources' items end up on the target's list and the emptied
 *            sources go. One task holds everything afterwards.
 *
 * The issue asks for those two to feel clearly different at the moment of
 * choosing, and they do, because they end somewhere different: group leaves
 * every member a note of its own inside a boundary, merge leaves one note.
 * The selection toolbar offers both side by side so the choice is visible
 * rather than remembered.
 *
 * ## What is stored
 *
 * A group is a `Kind: group` row in the ---whiteboard--- table carrying only
 * the summary task's name (see script.js's "Whiteboard back matter" header
 * for why a new Kind rather than a new section). Membership is *not* stored:
 * the members of a group are that task's children in the outline, which is
 * the same relationship a noodle draws and the same rule this repo already
 * follows for noodles — "adding a Links column would have created a second
 * source of truth for the same relationship".
 *
 * Neither is the boundary's rect. A boundary is the box its members occupy,
 * so a stored rect could disagree with them the moment one moved. It is
 * derived on every render (wbGroupBox()), and the table's X/Y/Width/Height
 * cells are written from that derivation so the markdown still reads
 * sensibly on its own.
 *
 * The row exists at all — rather than treating every off-board parent of
 * on-board children as a boundary — because those are different facts. A
 * plan can perfectly well have a parent the user simply has not put on the
 * board; drawing a boundary round its children would be the board inventing
 * an intent nobody expressed, and would change how every existing plan
 * renders.
 *
 * ## Open question, decided
 *
 * #874 asks whether notes inside a boundary travel with it and leans yes.
 * They do (wbBeginGroupDrag()): physically they would, and a boundary you
 * can slide off its own contents is a boundary that lies about what it
 * contains for as long as the gesture lasts.
 */

// ── The lasso ───────────────────────────────────────────────────────────
//
// A plain drag on empty canvas, as on Obsidian's canvas: every note it
// touches is selected, and the selection toolbar then offers Group and
// Combine. Panning moved to the two-finger swipe (and Space+drag or a
// middle-button drag -- see wbHandleMouseDown() in whiteboard.js). A
// shift-drag (`mode: 'add'`) adds to the selection instead of replacing it.

/** In-flight lasso, or null. Board coordinates, not client ones. */
let wbLasso = null;

function wbLassoLayer() {
    if (typeof wbGroup === 'undefined' || !wbGroup) return null;
    // Above the notes, so the marquee is drawn over the cards it crosses:
    // wbOverlayGroup carries wbGroup's pan/zoom on the far side of the
    // untransformed notes layer (see wbPlaceBoardObject() in whiteboard.js).
    const host = (typeof wbOverlayGroup !== 'undefined' && wbOverlayGroup) || wbGroup;
    let layer = host.querySelector('.wb-lasso-layer');
    if (!layer) {
        layer = document.createElementNS(SVG_NS, 'g');
        layer.setAttribute('class', 'wb-lasso-layer');
        host.appendChild(layer);
    }
    return layer;
}

/** Client (screen) point -> board coordinates, undoing pan and zoom. */
function wbClientToBoard(clientX, clientY) {
    const svg = (typeof wbSvg !== 'undefined') ? wbSvg : null;
    if (!svg) return { x: clientX, y: clientY };
    const rect = svg.getBoundingClientRect();
    const zoom = (typeof wbZoom === 'number' && wbZoom > 0) ? wbZoom : 1;
    const panX = (typeof wbPanX === 'number') ? wbPanX : 0;
    const panY = (typeof wbPanY === 'number') ? wbPanY : 0;
    return {
        x: (clientX - rect.left - panX) / zoom,
        y: (clientY - rect.top - panY) / zoom,
    };
}

/**
 * Start a lasso at a client point. Returns false when there is no canvas to
 * draw on, which is the caller's signal to fall through to panning.
 */
function wbBeginLasso(clientX, clientY, mode) {
    const layer = wbLassoLayer();
    if (!layer) return false;
    wbCancelLasso();
    const kind = mode === 'add' ? 'add' : 'select';
    const start = wbClientToBoard(clientX, clientY);
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('class', 'wb-lasso');
    layer.appendChild(rect);
    wbLasso = { startX: start.x, startY: start.y, rect, moved: false, mode: kind };
    wbUpdateLasso(clientX, clientY);
    return true;
}

function wbLassoBox() {
    if (!wbLasso) return null;
    const { startX, startY, x, y } = wbLasso;
    return {
        x: Math.min(startX, x), y: Math.min(startY, y),
        width: Math.abs(x - startX), height: Math.abs(y - startY),
    };
}

function wbUpdateLasso(clientX, clientY) {
    if (!wbLasso) return;
    const at = wbClientToBoard(clientX, clientY);
    wbLasso.x = at.x;
    wbLasso.y = at.y;
    const box = wbLassoBox();
    if (box.width > 3 || box.height > 3) wbLasso.moved = true;
    wbLasso.rect.setAttribute('x', String(box.x));
    wbLasso.rect.setAttribute('y', String(box.y));
    wbLasso.rect.setAttribute('width', String(box.width));
    wbLasso.rect.setAttribute('height', String(box.height));
}

/**
 * The notes a board box touches.
 *
 * Touched, not enclosed: a marquee that only takes notes it fully contains
 * makes the user drag a box bigger than the thing they are pointing at,
 * which on a board of 280px cards means most of the canvas.
 */
function wbNotesTouching(box) {
    const hit = [];
    if (!box || typeof wbNoteNodes === 'undefined') return hit;
    for (const [name, entry] of wbNoteNodes) {
        const rect = wbNoteCurrentRect(entry);
        const overlaps = rect.x < box.x + box.width
            && rect.x + rect.width > box.x
            && rect.y < box.y + box.height
            && rect.y + rect.height > box.y;
        if (overlaps) hit.push(name);
    }
    return hit;
}

/**
 * Finish the lasso and select every note it touched -- on top of what was
 * already selected, for a shift-drag.
 */
function wbEndLasso() {
    if (!wbLasso) return;
    const box = wbLassoBox();
    const { moved, mode } = wbLasso;
    wbLasso.rect.remove();
    wbLasso = null;
    if (!moved) return;

    let hit = wbNotesTouching(box);
    if (mode === 'add' && typeof wbGetSelectedNoteTasks === 'function') {
        const already = wbGetSelectedNoteTasks();
        hit = already.concat(hit.filter(n => !already.includes(n)));
    }
    if (typeof wbSetSelectedNotes === 'function') wbSetSelectedNotes(hit);
}

/**
 * Lift a set of selected notes to the groups they fill.
 *
 * Selecting a whole group and a note beside it means "put that group
 * and this note together", not "tear the group's notes out of it". So a
 * note climbs to its group whenever every note of that group was touched,
 * and on up while the next group out is filled too. The result is what the
 * new group should contain: notes, and whole groups, each named once.
 */
function wbLiftToFilledGroups(names, tasks, rows) {
    const groups = wbGroupRows(rows);
    const groupKeys = new Map();
    for (const name of groups.keys()) groupKeys.set(String(name).toLowerCase(), name);
    const hit = new Set(names.map(n => String(n).toLowerCase()));
    const parentOf = new Map();
    for (const t of (tasks || [])) {
        if (t && t.name) parentOf.set(String(t.name).toLowerCase(), t.parent || '');
    }

    const out = [];
    const seen = new Set();
    for (const name of names) {
        let current = name;
        for (let depth = 0; depth < 32; depth++) {
            const parentKey = String(parentOf.get(String(current).toLowerCase()) || '').toLowerCase();
            const group = parentKey && groupKeys.get(parentKey);
            if (!group) break;
            const inside = wbGroupNoteDescendants(group, tasks);
            if (!inside.length || !inside.every(n => hit.has(String(n).toLowerCase()))) break;
            current = group;
        }
        const key = String(current).toLowerCase();
        if (!seen.has(key)) { seen.add(key); out.push(current); }
    }
    return out;
}

function wbCancelLasso() {
    if (!wbLasso) return;
    wbLasso.rect.remove();
    wbLasso = null;
}

// ── The selection toolbar ───────────────────────────────────────────────
//
// #874 asks for a mini-toolbar that asks "group these?" once a selection
// exists. It carries Combine beside it, because the two gestures are the
// ones a selection is *for* and the difference between them is the thing
// the issue wants visible at the moment of choosing rather than learned.

function wbSelectionToolbar() {
    if (typeof document === 'undefined') return null;
    const host = document.getElementById('whiteboardContainer');
    if (!host) return null;
    let bar = host.querySelector('.wb-selection-toolbar');
    if (!bar) {
        bar = document.createElement('div');
        bar.className = 'wb-selection-toolbar';
        bar.setAttribute('role', 'toolbar');
        bar.setAttribute('aria-label', 'Selected notes');
        bar.hidden = true;

        const count = document.createElement('span');
        count.className = 'wb-selection-count';

        const groupBtn = document.createElement('button');
        groupBtn.type = 'button';
        groupBtn.className = 'wb-selection-btn wb-selection-group';
        groupBtn.textContent = 'Group these';
        groupBtn.title = 'Draw a boundary round these notes, keeping each one separate';
        groupBtn.addEventListener('click', (e) => { e.stopPropagation(); wbGroupSelection(); });

        const combineBtn = document.createElement('button');
        combineBtn.type = 'button';
        combineBtn.className = 'wb-selection-btn wb-selection-combine';
        combineBtn.textContent = 'Combine';
        combineBtn.title = 'Fuse these notes into one, with every item on a single list';
        combineBtn.addEventListener('click', (e) => { e.stopPropagation(); wbCombineSelection(); });

        bar.append(count, groupBtn, combineBtn);
        host.appendChild(bar);
    }
    return bar;
}

/**
 * Show the toolbar whenever two or more notes are selected, and say how
 * many. One note is not a group and cannot be combined with anything, so
 * the bar stays out of the way until the selection can actually use it.
 */
function wbUpdateSelectionToolbar() {
    const bar = wbSelectionToolbar();
    if (!bar) return;
    const selected = (typeof wbGetSelectedNoteTasks === 'function')
        ? wbGetSelectedNoteTasks() : [];
    if (selected.length < 2) { bar.hidden = true; return; }
    const count = bar.querySelector('.wb-selection-count');
    if (count) count.textContent = `${selected.length} notes selected`;
    bar.hidden = false;
}

// ── Group ───────────────────────────────────────────────────────────────

/** Rows that are group boundaries, by task name. */
function wbGroupRows(rows) {
    const out = new Map();
    for (const row of (rows || [])) {
        if (row && row.kind === 'group' && row.task) out.set(row.task, row);
    }
    return out;
}

/** How much board a boundary leaves around the notes inside it. */
const WB_GROUP_PAD = 18;
/** Room above them for the boundary's own title. */
const WB_GROUP_TITLE_H = 30;
/** The title's font size in board pixels; the CSS matches it. */
const WB_GROUP_TITLE_FONT = 15;

/**
 * The box a group occupies: its members' bounds, padded, with room for the
 * title. Null when nothing it contains is on the board -- a boundary around
 * nothing is not drawn rather than drawn empty, because an empty boundary
 * looks like a bug and a missing one looks like what it is.
 */
function wbGroupBox(groupName, tasks) {
    const members = wbGroupMemberNames(groupName, tasks);
    let box = null;
    for (const name of members) {
        const entry = (typeof wbNoteNodes !== 'undefined') ? wbNoteNodes.get(name) : null;
        const rect = entry ? wbNoteCurrentRect(entry) : wbGroupBox(name, tasks);
        if (!rect) continue;
        if (!box) {
            box = { x: rect.x, y: rect.y, right: rect.x + rect.width, bottom: rect.y + rect.height };
        } else {
            box.x = Math.min(box.x, rect.x);
            box.y = Math.min(box.y, rect.y);
            box.right = Math.max(box.right, rect.x + rect.width);
            box.bottom = Math.max(box.bottom, rect.y + rect.height);
        }
    }
    if (!box) return null;
    return {
        x: box.x - WB_GROUP_PAD,
        y: box.y - WB_GROUP_PAD - WB_GROUP_TITLE_H,
        width: (box.right - box.x) + WB_GROUP_PAD * 2,
        height: (box.bottom - box.y) + WB_GROUP_PAD * 2 + WB_GROUP_TITLE_H,
    };
}

/** The direct children of `groupName`, which is what a group contains. */
function wbGroupMemberNames(groupName, tasks) {
    const key = String(groupName || '').toLowerCase();
    return (tasks || [])
        .filter(t => t && t.parent && String(t.parent).toLowerCase() === key)
        .map(t => t.name);
}

/**
 * Every note that travels when `groupName` moves: its members, and their
 * members, all the way down. A nested group has no note of its own, so the
 * things that actually move are the post-its at the leaves of the grouping.
 */
function wbGroupNoteDescendants(groupName, tasks) {
    const out = [];
    const seen = new Set();
    const walk = (name, depth) => {
        if (depth > 32) return;
        for (const child of wbGroupMemberNames(name, tasks)) {
            const key = String(child).toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            if (typeof wbNoteNodes !== 'undefined' && wbNoteNodes.has(child)) out.push(child);
            walk(child, depth + 1);
        }
    };
    walk(groupName, 0);
    return out;
}

/** Group boundary nodes, by task name -- the groups' twin of wbNoteNodes. */
let wbGroupNodes = new Map();

function wbGroupsLayer() {
    if (typeof wbGroup === 'undefined' || !wbGroup) return null;
    let layer = wbGroup.querySelector('.wb-groups-layer');
    if (!layer) {
        layer = document.createElementNS(SVG_NS, 'g');
        layer.setAttribute('class', 'wb-groups-layer');
        // Behind the notes and the noodles -- the only z-order a container
        // can have without covering what it contains -- but *in front of*
        // `.wb-grid`, which is the canvas group's first child. The grid is a
        // full-canvas rect with a pattern fill and it hit-tests, so a layer
        // inserted before it is not merely painted under the dots: every
        // press meant for a boundary lands on the grid and pans the board
        // instead.
        const notes = wbGroup.querySelector('.wb-notes-layer');
        if (notes) wbGroup.insertBefore(layer, notes);
        else wbGroup.appendChild(layer);
    }
    return layer;
}

/**
 * Render every group boundary the rows call for. Called from
 * wbRenderNotes() *after* the notes, because a boundary is measured from
 * the notes inside it and they have to have their rects first.
 */
function wbRenderGroups(rows, tasks) {
    const layer = wbGroupsLayer();
    if (!layer) return;
    const groups = wbGroupRows(rows);
    const seen = new Set();

    for (const [name] of groups) {
        const box = wbGroupBox(name, tasks);
        if (!box) continue;
        seen.add(name);

        let node = wbGroupNodes.get(name);
        if (!node) {
            const g = document.createElementNS(SVG_NS, 'g');
            g.setAttribute('class', 'wb-group');
            const rect = document.createElementNS(SVG_NS, 'rect');
            rect.setAttribute('class', 'wb-group-box');
            rect.setAttribute('rx', '12');
            const label = document.createElementNS(SVG_NS, 'text');
            label.setAttribute('class', 'wb-group-title');

            // Ungroup lives on the boundary rather than in a menu because a
            // boundary has no menu, and adding one would give a container
            // more chrome than the notes it contains. Revealed on hover, the
            // same rule the row rails follow: it is a gesture, not a fact.
            const undo = document.createElementNS(SVG_NS, 'text');
            undo.setAttribute('class', 'wb-group-ungroup');
            undo.textContent = 'Ungroup';
            undo.setAttribute('role', 'button');
            undo.setAttribute('tabindex', '0');

            g.append(rect, label, undo);
            layer.appendChild(g);

            g.addEventListener('mousedown', (e) => wbGroupMouseDown(e, name));
            label.addEventListener('dblclick', (e) => { e.stopPropagation(); wbRenameGroup(name); });
            undo.addEventListener('mousedown', (e) => e.stopPropagation()); // never starts a drag
            undo.addEventListener('click', (e) => {
                e.stopPropagation();
                wbUngroupGroup(g.dataset.wbGroup);
            });

            node = { g, rect, label, undo };
            wbGroupNodes.set(name, node);
        }

        node.g.dataset.wbGroup = name;
        node.rect.setAttribute('x', String(box.x));
        node.rect.setAttribute('y', String(box.y));
        node.rect.setAttribute('width', String(box.width));
        node.rect.setAttribute('height', String(box.height));
        node.label.setAttribute('x', String(box.x + 12));
        node.label.setAttribute('y', String(box.y + 21));
        node.label.textContent = name;
        node.undo.setAttribute('x', String(box.x + box.width - 12));
        node.undo.setAttribute('y', String(box.y + 20));
        node.undo.setAttribute('aria-label', `Ungroup ${name}`);
    }

    for (const [name, node] of wbGroupNodes) {
        if (!seen.has(name)) {
            node.g.remove();
            wbGroupNodes.delete(name);
        }
    }
}

/** The title a new group starts with, as Obsidian's canvas does. */
const WB_GROUP_DEFAULT_TITLE = 'Untitled group';

/**
 * Group `memberNames` (notes, or groups) under a new boundary, and put its
 * title straight into edit.
 *
 * The group is created with a placeholder title rather than after a prompt:
 * the boundary appears the moment the gesture ends, and naming it is typing
 * into its own title where it sits on the board -- #874's "gentle naming
 * prompt", without a dialog in the way. The name still matters (an unnamed
 * box round four notes says only that somebody drew a box), so the
 * placeholder is selected, ready to be typed over.
 *
 * Returns the new group's name, or false.
 */
function wbCreateGroup(memberNames, options) {
    const members = (memberNames || []).filter(Boolean);
    if (members.length < 2) return false;
    const editor = (typeof document !== 'undefined') ? document.getElementById('planEditor') : null;
    if (!editor) return false;

    const title = (options && options.title) || WB_GROUP_DEFAULT_TITLE;
    const clean = (typeof wbSanitiseChildTaskName === 'function')
        ? wbSanitiseChildTaskName(title) : String(title).trim();
    const unique = (typeof wbUniqueTaskName === 'function' && typeof wbOutlineTaskNames === 'function')
        ? wbUniqueTaskName(wbOutlineTaskNames(editor.value), clean)
        : clean;
    if (!unique) return false;

    const next = wbGroupTasksInPlanText(editor.value, members, unique);
    if (next === editor.value) {
        if (typeof showToast === 'function') {
            showToast('Those notes cannot be grouped together: one of them already contains another', 'info');
        }
        return false;
    }

    // The boundary row goes in the same commit as the outline move, so the
    // group never exists as a summary task with no boundary -- which would
    // render as a noodle fan for one frame and read as something else
    // entirely.
    const withRow = wbUpsertGroupRow(next, unique);
    if (!wbCommitMarkdown(withRow)) return false;
    if (typeof wbSetSelectedNotes === 'function') wbSetSelectedNotes([]);
    if (!options || options.editTitle !== false) wbEditGroupTitleWhenDrawn(unique);
    return unique;
}

/**
 * Turn the current selection into a group (the selection toolbar's button,
 * the ribbon's, and Ctrl/Cmd+G). A selection that covers every note of an
 * existing group puts that group in whole, nested, rather than pulling its
 * notes out of it -- see wbLiftToFilledGroups().
 */
function wbGroupSelection() {
    const selected = (typeof wbGetSelectedNoteTasks === 'function')
        ? wbGetSelectedNoteTasks() : [];
    if (selected.length < 2) return false;
    const tasks = (typeof wbLastTasks !== 'undefined') ? wbLastTasks : [];
    const editor = (typeof document !== 'undefined') ? document.getElementById('planEditor') : null;
    const rows = editor ? wbReadBoardRows(editor.value) : [];
    const members = wbLiftToFilledGroups(selected, tasks, rows);
    if (members.length < 2) {
        if (typeof showToast === 'function') {
            showToast('Those notes are already a group: select another note too to put the group inside a new one', 'info');
        }
        return false;
    }
    return wbCreateGroup(members) !== false;
}

/**
 * The ribbon's Arrange → Group button (#1341). The same gesture as the
 * selection toolbar's "Group these", but the ribbon button is always on
 * screen, so with fewer than two notes selected it says how to make a
 * selection rather than silently doing nothing -- the silence was the
 * reported bug.
 */
function wbGroupSelectionFromRibbon() {
    const selected = (typeof wbGetSelectedNoteTasks === 'function')
        ? wbGetSelectedNoteTasks() : [];
    if (selected.length < 2) {
        if (typeof showToast === 'function') {
            showToast('Select two or more notes to group: drag round them on empty canvas, or shift-click them', 'info');
        }
        return false;
    }
    return wbGroupSelection();
}

/**
 * Dissolve a group: the members go back to the top level and both the
 * summary task and its boundary row go.
 */
function wbUngroupGroup(groupName) {
    const editor = (typeof document !== 'undefined') ? document.getElementById('planEditor') : null;
    if (!editor || !groupName) return false;
    const next = wbUngroupTasksInPlanText(editor.value, groupName);
    if (next === editor.value) return false;
    return wbCommitMarkdown(wbRemoveGroupRow(next, groupName));
}

/**
 * The task name the scheduler will parse out of a typed name: `Build 3d`
 * is a task called `Build`. A board row naming the raw text would match no
 * task, and its note or boundary would silently disappear.
 */
function wbParsedTaskName(typed) {
    return (typeof wbTaskNameFromLine === 'function')
        ? wbTaskNameFromLine(typed)
        : String(typed || '').trim();
}

/**
 * Rename a group to `typed`. The boundary row keys off the task name, so it
 * follows the rename in the same commit or the group loses its boundary.
 * Returns the new name, or false when nothing changed.
 */
function wbRenameGroupTo(groupName, typed) {
    const editor = (typeof document !== 'undefined') ? document.getElementById('planEditor') : null;
    if (!editor || !groupName || typed == null) return false;
    const name = (typeof wbSanitiseChildTaskName === 'function')
        ? wbSanitiseChildTaskName(typed) : String(typed).trim();
    if (!name || name === groupName) return false;

    const taskName = wbParsedTaskName(name);
    if (!taskName) return false;

    const renamed = wbRenameTaskInPlanText(editor.value, groupName, name);
    if (renamed === editor.value) return false;
    const rows = wbReadBoardRows(renamed).map(row =>
        (row && row.kind === 'group' && row.task === groupName) ? { ...row, task: taskName } : row);
    return wbCommitMarkdown(updatePlanWhiteboardText(renamed, rows)) ? taskName : false;
}

/** Double-clicking a group's title edits it in place. */
function wbRenameGroup(groupName) {
    return wbEditGroupTitle(groupName);
}

// ── Editing a title in place ────────────────────────────────────────────
//
// The title is SVG text on the panned layer, which cannot take a caret, so
// editing lays an HTML input over it at the same screen position and font
// size. Enter or clicking away keeps what was typed; Escape keeps the old
// title.

let wbGroupTitleEditor = null;

function wbEditGroupTitle(groupName) {
    if (typeof document === 'undefined') return false;
    const node = wbGroupNodes.get(groupName);
    const host = document.getElementById('whiteboardContainer');
    if (!node || !host) return false;
    wbCloseGroupTitleEditor(true);

    const hostRect = host.getBoundingClientRect();
    const boxRect = node.rect.getBoundingClientRect();
    const labelRect = node.label.getBoundingClientRect();
    const zoom = (typeof wbZoom === 'number' && wbZoom > 0) ? wbZoom : 1;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'wb-group-title-input';
    input.value = groupName;
    input.setAttribute('aria-label', 'Group title');
    input.style.left = `${Math.round(boxRect.left - hostRect.left + 6 * zoom)}px`;
    input.style.top = `${Math.round(labelRect.top - hostRect.top - 4)}px`;
    input.style.width = `${Math.max(140, Math.round(boxRect.width - 90 * zoom))}px`;
    input.style.fontSize = `${Math.max(10, Math.round(WB_GROUP_TITLE_FONT * zoom))}px`;

    node.g.classList.add('wb-group-editing');
    const editor = { groupName, input, node, done: false };
    wbGroupTitleEditor = editor;

    input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); wbCloseGroupTitleEditor(true); }
        else if (e.key === 'Escape') { e.preventDefault(); wbCloseGroupTitleEditor(false); }
    });
    // A press inside the field is caret placement, never a pan or a lasso.
    input.addEventListener('mousedown', (e) => e.stopPropagation());
    input.addEventListener('blur', () => wbCloseGroupTitleEditor(true));

    host.appendChild(input);
    input.focus();
    input.select();
    return true;
}

function wbCloseGroupTitleEditor(keep) {
    const editor = wbGroupTitleEditor;
    if (!editor || editor.done) return;
    editor.done = true;
    wbGroupTitleEditor = null;
    const typed = editor.input.value;
    editor.input.remove();
    editor.node.g.classList.remove('wb-group-editing');
    const host = (typeof document !== 'undefined') ? document.getElementById('whiteboardContainer') : null;
    if (host && typeof host.focus === 'function') host.focus({ preventScroll: true });
    if (keep) wbRenameGroupTo(editor.groupName, typed);
}

/**
 * Open the title editor once `groupName`'s boundary is on the board. The
 * board redraws from the plan a tick after a commit, so the boundary a
 * group was just created with does not exist yet when the commit returns.
 */
function wbEditGroupTitleWhenDrawn(groupName, triesLeft) {
    const left = (triesLeft == null) ? 40 : triesLeft;
    if (wbGroupNodes.has(groupName)) { wbEditGroupTitle(groupName); return; }
    if (left <= 0 || typeof setTimeout !== 'function') return;
    setTimeout(() => wbEditGroupTitleWhenDrawn(groupName, left - 1), 25);
}

// ── Merge ───────────────────────────────────────────────────────────────

/**
 * Fold `sourceNames` into `targetName` and take the sources off the board.
 *
 * Both entry points land here: the drag-to-stack case with one source, and
 * Combine with several. The naming prompt #874 asks for is offered rather
 * than forced -- the merged note already has a name (the target's), so
 * cancelling leaves something sensible instead of nothing.
 */
function wbMergeNotes(targetName, sourceNames) {
    const editor = (typeof document !== 'undefined') ? document.getElementById('planEditor') : null;
    if (!editor || !targetName || !sourceNames || !sourceNames.length) return false;

    const next = wbMergeTasksInPlanText(editor.value, targetName, sourceNames);
    if (next === editor.value) return false;

    // The sources' own tasks are gone (or are now rows on the target), so
    // their board rows would be orphans. Dropping them here rather than
    // leaving wbRenderNotes() to skip them keeps the table honest.
    let rows = wbReadBoardRows(next).filter(row => {
        if (!row || row.kind === 'text') return true;
        return !sourceNames.some(n => String(n).toLowerCase() === String(row.task || '').toLowerCase());
    });

    const typed = (typeof prompt === 'function')
        ? prompt('Name the combined note:', targetName)
        : null;
    let plan = updatePlanWhiteboardText(next, rows);
    if (typed != null) {
        const name = (typeof wbSanitiseChildTaskName === 'function')
            ? wbSanitiseChildTaskName(typed) : String(typed).trim();
        const taskName = wbParsedTaskName(name);
        if (name && taskName && name !== targetName) {
            const renamed = wbRenameTaskInPlanText(plan, targetName, name);
            if (renamed !== plan) {
                rows = wbReadBoardRows(renamed).map(row =>
                    (row && row.task === targetName) ? { ...row, task: taskName } : row);
                plan = updatePlanWhiteboardText(renamed, rows);
            }
        }
    }

    if (!wbCommitMarkdown(plan)) return false;
    if (typeof wbSetSelectedNotes === 'function') wbSetSelectedNotes([]);
    return true;
}

/** Combine every selected note into the first one selected. */
function wbCombineSelection() {
    const selected = (typeof wbGetSelectedNoteTasks === 'function')
        ? wbGetSelectedNoteTasks() : [];
    if (selected.length < 2) return false;
    const [target, ...sources] = selected;
    return wbMergeNotes(target, sources);
}

/**
 * The drag-to-stack case: `draggedName` was released over `ontoName`.
 *
 * Confirmed rather than silent. Dropping a note on another note is one
 * pixel away from dropping it *beside* another note, and the two outcomes
 * are "nothing happened" and "that note no longer exists".
 */
function wbMergeDroppedNote(draggedName, ontoName) {
    if (!draggedName || !ontoName || draggedName === ontoName) return false;
    if (typeof confirm === 'function' &&
        !confirm(`Combine "${draggedName}" into "${ontoName}"?\n\n` +
                 `Its items move onto "${ontoName}" and the note goes.`)) {
        return false;
    }
    return wbMergeNotes(ontoName, [draggedName]);
}

/**
 * Whichever note's card is under this client point, other than `exceptName`.
 * Read from the notes' own rects rather than elementFromPoint(), which
 * during a drag finds the note being dragged: it is under the pointer by
 * definition, and it is the one answer that is never useful.
 */
function wbNoteAt(clientX, clientY, exceptName) {
    if (typeof wbNoteNodes === 'undefined') return null;
    const at = wbClientToBoard(clientX, clientY);
    let found = null;
    for (const [name, entry] of wbNoteNodes) {
        if (name === exceptName) continue;
        const rect = wbNoteCurrentRect(entry);
        if (at.x >= rect.x && at.x <= rect.x + rect.width
            && at.y >= rect.y && at.y <= rect.y + rect.height) {
            found = name; // later entries paint on top, so the last match wins
        }
    }
    return found;
}

// ── Dragging a boundary ─────────────────────────────────────────────────

let wbActiveGroupDrag = null;

/**
 * Press on a boundary: start dragging it, and everything inside it with it.
 *
 * #874 left this as an open question and leaned yes. It is yes. A boundary
 * is a claim about which notes belong together; sliding it off them would
 * make that claim false for the length of the gesture and then true again
 * somewhere else, which is a worse story than "the group moves".
 */
function wbGroupMouseDown(e, groupName) {
    if (e.button !== 0) return;
    // The title is the rename target; the box is the drag handle. A press
    // that lands on the label still drags, because a double-click is two
    // presses and the first one must not move the group out from under the
    // second -- wbGroupMouseUp() only commits a drag that actually moved.
    e.preventDefault();
    e.stopPropagation();

    const tasks = (typeof wbLastTasks !== 'undefined') ? wbLastTasks : [];
    const members = wbGroupNoteDescendants(groupName, tasks);
    if (!members.length) return;

    const start = wbClientToBoard(e.clientX, e.clientY);
    wbActiveGroupDrag = {
        groupName,
        startX: start.x,
        startY: start.y,
        moved: false,
        origins: members.map(name => {
            const entry = wbNoteNodes.get(name);
            const rect = wbNoteCurrentRect(entry);
            return { name, entry, x: rect.x, y: rect.y };
        }),
    };
    if (typeof wbSetDragCursor === 'function') wbSetDragCursor('grabbing');
}

function wbGroupMouseMove(e) {
    if (!wbActiveGroupDrag) return;
    const at = wbClientToBoard(e.clientX, e.clientY);
    const dx = at.x - wbActiveGroupDrag.startX;
    const dy = at.y - wbActiveGroupDrag.startY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) wbActiveGroupDrag.moved = true;

    for (const origin of wbActiveGroupDrag.origins) {
        wbSetBoardRect(origin.entry.fo, { x: Math.round(origin.x + dx), y: Math.round(origin.y + dy) });
    }
    // The boundary and the noodles are both measured from the notes, so
    // re-deriving here is what keeps them attached mid-drag.
    wbRenderGroupsFromBoard();
    if (typeof wbRenderDependencyNoodles === 'function') wbRenderDependencyNoodles();
}

function wbGroupMouseUp() {
    const drag = wbActiveGroupDrag;
    if (!drag) return;
    wbActiveGroupDrag = null;
    if (typeof wbSetDragCursor === 'function') wbSetDragCursor('');
    if (!drag.moved) return;

    const editor = (typeof document !== 'undefined') ? document.getElementById('planEditor') : null;
    if (!editor) return;
    const moved = new Map();
    for (const origin of drag.origins) {
        const rect = wbNoteCurrentRect(origin.entry);
        moved.set(String(origin.name).toLowerCase(), { x: Math.round(rect.x), y: Math.round(rect.y) });
    }
    // One commit for the whole group, not one per note: moving six notes is
    // one thing the user did and should be one press of undo.
    const rows = wbReadBoardRows(editor.value).map(row => {
        if (!row || row.kind === 'text') return row;
        const at = moved.get(String(row.task || '').toLowerCase());
        return at ? { ...row, x: at.x, y: at.y } : row;
    });
    wbCommitMarkdown(updatePlanWhiteboardText(editor.value, rows));
}

// ── Row plumbing ────────────────────────────────────────────────────────

/** The ---whiteboard--- rows of a plan, or []. */
function wbReadBoardRows(planText) {
    if (typeof extractWhiteboardFromPlanText !== 'function'
        || typeof parseWhiteboardMarkdown !== 'function') return [];
    const section = extractWhiteboardFromPlanText(planText);
    return section ? parseWhiteboardMarkdown(section) : [];
}

function wbUpsertGroupRow(planText, groupName) {
    const rows = wbReadBoardRows(planText);
    if (!rows.some(r => r && r.kind === 'group' && r.task === groupName)) {
        rows.push({ kind: 'group', task: groupName, colour: '' });
    }
    return updatePlanWhiteboardText(planText, rows);
}

function wbRemoveGroupRow(planText, groupName) {
    const rows = wbReadBoardRows(planText)
        .filter(r => !(r && r.kind === 'group' && r.task === groupName));
    return updatePlanWhiteboardText(planText, rows);
}

/** Re-derive every boundary from the board as it stands right now. */
function wbRenderGroupsFromBoard() {
    const rows = wbReadBoardRows(
        (typeof wbLastPlanText !== 'undefined') ? wbLastPlanText : '');
    wbRenderGroups(rows, (typeof wbLastTasks !== 'undefined') ? wbLastTasks : []);
}

// Window-level listeners, registered once: a boundary drag has to keep
// tracking after the pointer leaves the boundary, exactly like a note drag.
if (typeof window !== 'undefined') {
    window.addEventListener('mousemove', wbGroupMouseMove);
    window.addEventListener('mouseup', wbGroupMouseUp);
}
