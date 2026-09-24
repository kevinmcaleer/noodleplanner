/**
 * Whiteboard noodles -- the curved links between post-its that *are* the
 * plan's outline hierarchy.
 *
 * A noodle from note A to note B means exactly one thing: "B is a child of
 * A in the plan outline". Drawing one re-parents B's whole subtree under A
 * (wbReparentTaskInPlanText() in whiteboard-structure.js); cutting one
 * moves B back out to the top level. That is how a board full of loose
 * post-its turns into a plan structure without anyone opening the outline.
 *
 * No storage of its own: noodles are *derived* from the task hierarchy on
 * every render (wbNoodleLinksFor()), never persisted to the
 * ---whiteboard--- table. See whiteboard-structure.js's header for why a
 * second source of truth for the same relationship was rejected.
 *
 * Layering: one <g class="wb-noodles-layer"> inserted *before* the notes
 * layer inside whiteboard.js's wb-layer, so it inherits the same pan/zoom
 * transform for free and SVG's document-order painting puts every noodle
 * underneath every note without any z-index bookkeeping.
 *
 * Drag cost: while a note is being dragged, only the noodles actually
 * touching that note have their path recomputed (wbRefreshNoodleGeometry()
 * takes the dragged task name), so dragging one note on a hundred-note
 * board stays as cheap as the note drag itself -- the same O(1)-per-frame
 * rule wbUpdateNoteDragFromClient() already follows for the note.
 *
 * Each noodle is drawn as two paths: a wide transparent one for hit
 * testing (a 2px curve is close to unclickable) and the visible one on
 * top. This mirrors views-products.js's own invisible hover hit area for
 * its PBS connectors.
 *
 * History: #1052 briefly overloaded this same card-to-card drag with a
 * toolbar "Dependency" mode that wrote a `[depends: ...]` link between two
 * whole notes instead of re-parenting. #1106 removes that mode entirely
 * -- it let a note representing a *summary* task appear to have a
 * dependency, breaking the "summary tasks can't have dependencies" rule
 * (plan-model.js's canAddDependency() had no way to steer the drag away
 * from even attempting it) -- so this drag is hierarchy-only again, and
 * dependency-drawing has moved to a per-row gesture on checklist rows
 * (see whiteboard-dep-noodles.js's header).
 */

// -- Configuration -------------------------------------------------------

const WB_NOODLE_HIT_WIDTH = 18;      // board units; transparent click target
const WB_NOODLE_CURVE = 0.45;        // control-point offset as a fraction of span
const WB_NOODLE_MIN_CURVE = 40;      // ...but never flatter than this
const WB_NOODLE_ARROW_SIZE = 9;

// -- Module state --------------------------------------------------------

/** link id -> { group, hit, path, arrow, cut } for every rendered noodle. */
let wbNoodleNodes = new Map();

/** The link currently being dragged out of a note, or null. */
let wbActiveLink = null;

/** The selected noodle's id, or null. */
let wbSelectedNoodle = null;

/** Latest links rendered, so geometry refresh doesn't re-derive them. */
let wbNoodleLinks = [];

// -- Pure helpers (no DOM -- unit tested directly) ------------------------

/**
 * Stable id for one link, used as the DOM key and the selection token.
 *
 * Joined on a control character rather than a space or a slash because a
 * task name may legally contain either: with " " as the separator,
 * ("Plan a", "b") and ("Plan", "a b") would collide onto one id, and two
 * different noodles sharing an id would share a DOM node.
 */
const WB_NOODLE_ID_SEP = '\u001f'; // ASCII unit separator
function wbNoodleId(parentName, childName) {
    return String(parentName).toLowerCase() + WB_NOODLE_ID_SEP + String(childName).toLowerCase();
}

/**
 * Every parent-to-child link that should be drawn: one per whiteboard row
 * whose task has a parent that is *also* on the board. A child whose
 * parent has no note has nothing to draw a noodle to -- it stays visible
 * as a checklist row inside its parent's note instead (see
 * wbBuildNoteViewModel()'s onBoard handling).
 *
 * Derived from the engine's `.parent` field, the same relation the notes
 * and the outline panel read, so the three can never disagree.
 */
function wbNoodleLinksFor(rows, tasks) {
    // Only post-it rows count as "on the board" here. A group row (issue
    // #874) names a task too, but it draws a boundary rather than a card --
    // and a noodle to a boundary is a noodle to nothing, since the boundary
    // is drawn *around* the very notes the noodle would come from.
    const onBoard = new Map();
    (rows || []).forEach(row => {
        if (!row || !row.task || row.kind === 'group' || row.kind === 'text') return;
        onBoard.set(String(row.task).toLowerCase(), row.task);
    });
    const links = [];
    const seen = new Set();

    (tasks || []).forEach(task => {
        if (!task || !task.name || !task.parent) return;
        const childKey = String(task.name).toLowerCase();
        const parentKey = String(task.parent).toLowerCase();
        if (!onBoard.has(childKey) || !onBoard.has(parentKey)) return;
        const id = wbNoodleId(parentKey, childKey);
        if (seen.has(id)) return;
        seen.add(id);
        links.push({ id, parent: onBoard.get(parentKey), child: onBoard.get(childKey) });
    });
    return links;
}

/**
 * Choose which edges two note rectangles should be joined at, and return
 * the two anchor points plus the axis the curve should bulge along.
 *
 * Picks whichever of the four sensible side pairings (right-to-left,
 * left-to-right, bottom-to-top, top-to-bottom) puts the two anchors
 * closest together, so a noodle leaves and enters by the faces that are
 * actually facing each other rather than always looping out of the right
 * edge.
 */
function wbNoodleAnchors(from, to) {
    const fromMid = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
    const toMid = { x: to.x + to.width / 2, y: to.y + to.height / 2 };

    const candidates = [
        { axis: 'x', a: { x: from.x + from.width, y: fromMid.y }, b: { x: to.x, y: toMid.y } },
        { axis: 'x', a: { x: from.x, y: fromMid.y }, b: { x: to.x + to.width, y: toMid.y } },
        { axis: 'y', a: { x: fromMid.x, y: from.y + from.height }, b: { x: toMid.x, y: to.y } },
        { axis: 'y', a: { x: fromMid.x, y: from.y }, b: { x: toMid.x, y: to.y + to.height } },
    ];

    let best = candidates[0];
    let bestDist = Infinity;
    candidates.forEach(c => {
        const dx = c.b.x - c.a.x;
        const dy = c.b.y - c.a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < bestDist) { bestDist = dist; best = c; }
    });
    return best;
}

/**
 * The cubic-bezier `d` for one noodle, bulging along `axis` so the curve
 * leaves and arrives perpendicular to the note edges it touches.
 */
function wbNoodlePathD(anchors) {
    const { a, b, axis } = anchors;
    const span = axis === 'x' ? Math.abs(b.x - a.x) : Math.abs(b.y - a.y);
    const bulge = Math.max(WB_NOODLE_MIN_CURVE, span * WB_NOODLE_CURVE);
    const dir = axis === 'x' ? (Math.sign(b.x - a.x) || 1) : (Math.sign(b.y - a.y) || 1);

    const c1 = axis === 'x' ? { x: a.x + bulge * dir, y: a.y } : { x: a.x, y: a.y + bulge * dir };
    const c2 = axis === 'x' ? { x: b.x - bulge * dir, y: b.y } : { x: b.x, y: b.y - bulge * dir };
    return `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`;
}

/**
 * The arrowhead polygon points for a noodle arriving at `b` along `axis`,
 * pointing into the child note's edge.
 */
function wbNoodleArrowPoints(anchors) {
    const { a, b, axis } = anchors;
    const s = WB_NOODLE_ARROW_SIZE;
    const dir = axis === 'x' ? (Math.sign(b.x - a.x) || 1) : (Math.sign(b.y - a.y) || 1);
    if (axis === 'x') {
        return `${b.x},${b.y} ${b.x - s * dir},${b.y - s * 0.6} ${b.x - s * dir},${b.y + s * 0.6}`;
    }
    return `${b.x},${b.y} ${b.x - s * 0.6},${b.y - s * dir} ${b.x + s * 0.6},${b.y - s * dir}`;
}

/** Midpoint of a noodle, where its cut button sits. */
function wbNoodleMidpoint(anchors) {
    const { a, b, axis } = anchors;
    const span = axis === 'x' ? Math.abs(b.x - a.x) : Math.abs(b.y - a.y);
    const bulge = Math.max(WB_NOODLE_MIN_CURVE, span * WB_NOODLE_CURVE);
    const dir = axis === 'x' ? (Math.sign(b.x - a.x) || 1) : (Math.sign(b.y - a.y) || 1);
    const c1 = axis === 'x' ? { x: a.x + bulge * dir, y: a.y } : { x: a.x, y: a.y + bulge * dir };
    const c2 = axis === 'x' ? { x: b.x - bulge * dir, y: b.y } : { x: b.x, y: b.y - bulge * dir };
    // A cubic bezier at t = 0.5 reduces to this weighted average.
    return {
        x: (a.x + 3 * c1.x + 3 * c2.x + b.x) / 8,
        y: (a.y + 3 * c1.y + 3 * c2.y + b.y) / 8,
    };
}

// -- DOM -----------------------------------------------------------------

const WB_SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Get-or-create the noodle layer, always positioned *before* the notes
 * layer so notes paint on top (see this file's header).
 */
function wbNoodlesLayer() {
    if (typeof wbGroup === 'undefined' || !wbGroup) return null;
    let layer = wbGroup.querySelector('.wb-noodles-layer');
    if (!layer) {
        layer = document.createElementNS(WB_SVG_NS, 'g');
        layer.setAttribute('class', 'wb-noodles-layer');
        const notes = wbGroup.querySelector('.wb-notes-layer');
        if (notes) wbGroup.insertBefore(layer, notes);
        else wbGroup.appendChild(layer);
    }
    return layer;
}

/**
 * The live board rect of the note for `taskName`, read straight off its
 * <foreignObject> -- which wbUpdateNoteNode() keeps current and the drag
 * handlers update every frame, so a noodle tracks a note that is mid-drag
 * without needing to know a drag is happening at all.
 */
function wbNoteRectFor(taskName) {
    if (typeof wbNoteNodes === 'undefined' || !wbNoteNodes) return null;
    const entry = wbNoteNodes.get(taskName);
    if (!entry || !entry.fo) return null;
    const fo = entry.fo;
    return {
        x: parseFloat(fo.dataset.wbX || fo.getAttribute('x') || '0'),
        y: parseFloat(fo.dataset.wbY || fo.getAttribute('y') || '0'),
        width: parseFloat(fo.dataset.wbWidth || fo.getAttribute('width') || '0'),
        height: parseFloat(fo.dataset.wbHeight || fo.getAttribute('height') || '0'),
    };
}

/** Build the (static) DOM for one noodle; geometry is set separately. */
function wbCreateNoodleNode(link) {
    const group = document.createElementNS(WB_SVG_NS, 'g');
    group.setAttribute('class', 'wb-noodle');
    group.dataset.parent = link.parent;
    group.dataset.child = link.child;

    const hit = document.createElementNS(WB_SVG_NS, 'path');
    hit.setAttribute('class', 'wb-noodle-hit');
    hit.setAttribute('fill', 'none');
    hit.setAttribute('stroke', 'transparent');
    hit.setAttribute('stroke-width', String(WB_NOODLE_HIT_WIDTH));

    const path = document.createElementNS(WB_SVG_NS, 'path');
    path.setAttribute('class', 'wb-noodle-path');
    path.setAttribute('fill', 'none');

    const arrow = document.createElementNS(WB_SVG_NS, 'polygon');
    arrow.setAttribute('class', 'wb-noodle-arrow');

    // Cut button: only made visible (via CSS) once the noodle is selected,
    // so an unselected board stays clean.
    const cut = document.createElementNS(WB_SVG_NS, 'g');
    cut.setAttribute('class', 'wb-noodle-cut');
    cut.setAttribute('role', 'button');
    cut.setAttribute('aria-label', 'Unlink ' + link.child + ' from ' + link.parent);
    const cutCircle = document.createElementNS(WB_SVG_NS, 'circle');
    cutCircle.setAttribute('r', '11');
    cutCircle.setAttribute('class', 'wb-noodle-cut-bg');
    const cutMark = document.createElementNS(WB_SVG_NS, 'path');
    cutMark.setAttribute('class', 'wb-noodle-cut-mark');
    cutMark.setAttribute('d', 'M -4 -4 L 4 4 M 4 -4 L -4 4');
    cut.appendChild(cutCircle);
    cut.appendChild(cutMark);

    const label = document.createElementNS(WB_SVG_NS, 'title');
    label.textContent = link.parent + ' → ' + link.child;

    group.appendChild(label);
    group.appendChild(hit);
    group.appendChild(path);
    group.appendChild(arrow);
    group.appendChild(cut);

    const select = (e) => {
        e.stopPropagation();
        wbSelectNoodle(link.id);
    };
    // Swallow mousedown so clicking a noodle never also starts a canvas pan.
    hit.addEventListener('mousedown', (e) => e.stopPropagation());
    hit.addEventListener('click', select);
    path.addEventListener('click', select);
    cut.addEventListener('mousedown', (e) => e.stopPropagation());
    cut.addEventListener('click', (e) => {
        e.stopPropagation();
        wbCutNoodle(link.parent, link.child);
    });

    return { group, hit, path, arrow, cut };
}

/** Position one noodle's paths from its two notes' current rects. */
function wbLayoutNoodle(node, link) {
    const from = wbNoteRectFor(link.parent);
    const to = wbNoteRectFor(link.child);
    if (!from || !to || !from.width || !to.width) {
        node.group.setAttribute('visibility', 'hidden');
        return;
    }
    node.group.removeAttribute('visibility');

    const anchors = wbNoodleAnchors(from, to);
    const d = wbNoodlePathD(anchors);
    node.hit.setAttribute('d', d);
    node.path.setAttribute('d', d);
    node.arrow.setAttribute('points', wbNoodleArrowPoints(anchors));
    const mid = wbNoodleMidpoint(anchors);
    node.cut.setAttribute('transform', `translate(${mid.x}, ${mid.y})`);
}

/**
 * Re-derive and redraw every noodle. Called at the end of each
 * wbRenderNotes() pass, so noodles and notes can never be out of step.
 */
function wbRenderNoodles(rows, tasks) {
    const layer = wbNoodlesLayer();
    if (!layer) return;

    wbNoodleLinks = wbNoodleLinksFor(rows, tasks);
    const seen = new Set();

    wbNoodleLinks.forEach(link => {
        seen.add(link.id);
        let node = wbNoodleNodes.get(link.id);
        if (!node) {
            node = wbCreateNoodleNode(link);
            layer.appendChild(node.group);
            wbNoodleNodes.set(link.id, node);
        }
        node.group.classList.toggle('selected', wbSelectedNoodle === link.id);
        wbLayoutNoodle(node, link);
    });

    for (const [id, node] of wbNoodleNodes) {
        if (!seen.has(id)) {
            node.group.remove();
            wbNoodleNodes.delete(id);
            if (wbSelectedNoodle === id) wbSelectedNoodle = null;
        }
    }
}

/**
 * Re-run layout only for the noodles touching `taskName` (or all of them
 * when no name is given). This is what a note drag calls on every frame --
 * see this file's header on why it is scoped rather than a full redraw.
 */
function wbRefreshNoodleGeometry(taskName) {
    if (!wbNoodleNodes.size) return;
    const key = taskName ? String(taskName).toLowerCase() : null;
    wbNoodleLinks.forEach(link => {
        if (key &&
            String(link.parent).toLowerCase() !== key &&
            String(link.child).toLowerCase() !== key) return;
        const node = wbNoodleNodes.get(link.id);
        if (node) wbLayoutNoodle(node, link);
    });
}

// -- Selection -----------------------------------------------------------

function wbSelectNoodle(id) {
    wbSelectedNoodle = id;
    wbNoodleNodes.forEach((node, nodeId) => {
        node.group.classList.toggle('selected', nodeId === id);
    });
}

/** Clear any noodle selection (canvas click, Escape, successful cut). */
function wbClearNoodleSelection() {
    if (!wbSelectedNoodle) return;
    wbSelectedNoodle = null;
    wbNoodleNodes.forEach(node => node.group.classList.remove('selected'));
}

/** Cut the currently selected noodle, if any. Bound to Delete/Backspace. */
function wbCutSelectedNoodle() {
    if (!wbSelectedNoodle) return false;
    const node = wbNoodleNodes.get(wbSelectedNoodle);
    if (!node) return false;
    return wbCutNoodle(node.group.dataset.parent, node.group.dataset.child);
}

// -- Commit paths --------------------------------------------------------

/**
 * Draw a noodle: make `childName` a child of `parentName` in the plan
 * outline, in one Markdown write (hence one undo step). Refuses -- with a
 * transient on-canvas message rather than a silent no-op -- for a self
 * link, a link that would make a loop, or one that already exists.
 */
function wbLinkNotes(parentName, childName) {
    const editor = document.getElementById('planEditor');
    if (!editor || !parentName || !childName) return false;

    // A text note (a thought) is not in the outline, so there is no
    // hierarchy to put it in until it is promoted.
    if (typeof wbIsThoughtNote === 'function' &&
        (wbIsThoughtNote(parentName) || wbIsThoughtNote(childName))) {
        wbFlashNoodleMessage('A text note is not a task yet. Promote it from its … menu to link it.');
        return false;
    }

    const check = wbCanLinkNotes(wbLastTasks, parentName, childName);
    if (!check.ok) {
        wbFlashNoodleMessage(check.reason);
        return false;
    }

    const next = wbReparentTaskInPlanText(editor.value, childName, parentName);
    return wbCommitMarkdown(next);
}

/**
 * Cut a noodle: move `childName` back out to the top level of the plan.
 * The task itself and its own subtree are untouched -- cutting a noodle
 * un-files an idea, it never deletes one.
 */
function wbCutNoodle(parentName, childName) {
    const editor = document.getElementById('planEditor');
    if (!editor || !childName) return false;
    const next = wbReparentTaskInPlanText(editor.value, childName, null);
    const committed = wbCommitMarkdown(next);
    if (committed) {
        wbClearNoodleSelection();
        wbFlashNoodleMessage('"' + childName + '" moved back to the top level.');
    }
    return committed;
}

// -- Drag-to-link --------------------------------------------------------

/** Convert a client point to board coordinates under the current pan/zoom. */
function wbClientToBoard(clientX, clientY) {
    if (typeof wbSvg === 'undefined' || !wbSvg) return { x: 0, y: 0 };
    const rect = wbSvg.getBoundingClientRect();
    const zoom = (typeof wbZoom === 'number' && wbZoom > 0) ? wbZoom : 1;
    const panX = (typeof wbPanX === 'number') ? wbPanX : 0;
    const panY = (typeof wbPanY === 'number') ? wbPanY : 0;
    return {
        x: (clientX - rect.left - panX) / zoom,
        y: (clientY - rect.top - panY) / zoom,
    };
}

/**
 * Start dragging a new noodle out of `parentName`'s link handle. A ghost
 * path follows the pointer until it is dropped on another note.
 */
function wbBeginLinkDrag(parentName, clientX, clientY) {
    const layer = wbNoodlesLayer();
    if (!layer || !parentName) return;

    const ghost = document.createElementNS(WB_SVG_NS, 'path');
    ghost.setAttribute('class', 'wb-noodle-ghost');
    ghost.setAttribute('fill', 'none');
    layer.appendChild(ghost);

    wbActiveLink = { parentName, ghost, hoverEl: null, hoverName: null };
    document.body.classList.add('wb-linking');
    wbUpdateLinkDrag(clientX, clientY);

    window.addEventListener('mousemove', wbLinkDragMouseMove);
    window.addEventListener('mouseup', wbLinkDragMouseUp);
}

/** Redraw the ghost noodle and highlight whatever note is under the pointer. */
function wbUpdateLinkDrag(clientX, clientY) {
    if (!wbActiveLink) return;
    const from = wbNoteRectFor(wbActiveLink.parentName);
    if (!from) return;

    const point = wbClientToBoard(clientX, clientY);
    const target = { x: point.x, y: point.y, width: 0, height: 0 };
    wbActiveLink.ghost.setAttribute('d', wbNoodlePathD(wbNoodleAnchors(from, target)));

    // Highlight the drop target so it is obvious what will be linked.
    const el = document.elementFromPoint(clientX, clientY);
    const noteEl = (el && el.closest) ? el.closest('.wb-note-card') : null;
    const fo = noteEl ? noteEl.closest('.wb-note') : null;
    const name = fo ? fo.dataset.wbTask : null;

    if (wbActiveLink.hoverEl && wbActiveLink.hoverEl !== noteEl) {
        wbActiveLink.hoverEl.classList.remove('wb-link-target', 'wb-link-target-invalid');
    }
    wbActiveLink.hoverEl = noteEl || null;
    wbActiveLink.hoverName = (name && name !== wbActiveLink.parentName) ? name : null;

    if (noteEl && wbActiveLink.hoverName) {
        const ok = wbCanLinkNotes(wbLastTasks, wbActiveLink.parentName, wbActiveLink.hoverName).ok &&
            !(typeof wbIsThoughtNote === 'function' && wbIsThoughtNote(wbActiveLink.hoverName));
        noteEl.classList.toggle('wb-link-target', ok);
        noteEl.classList.toggle('wb-link-target-invalid', !ok);
    }
}

/** Finish a link drag: commit the link if it landed on a valid note. */
function wbEndLinkDrag(clientX, clientY) {
    if (!wbActiveLink) return;
    const { parentName, ghost, hoverEl, hoverName } = wbActiveLink;

    window.removeEventListener('mousemove', wbLinkDragMouseMove);
    window.removeEventListener('mouseup', wbLinkDragMouseUp);
    document.body.classList.remove('wb-linking');
    if (ghost) ghost.remove();
    if (hoverEl) hoverEl.classList.remove('wb-link-target', 'wb-link-target-invalid');
    wbActiveLink = null;

    if (!hoverName) return;
    wbLinkNotes(parentName, hoverName);
}

function wbLinkDragMouseMove(e) {
    if (!wbActiveLink) return;
    e.preventDefault();
    wbUpdateLinkDrag(e.clientX, e.clientY);
}

function wbLinkDragMouseUp(e) {
    wbEndLinkDrag(e.clientX, e.clientY);
}

/** Touch equivalents, mirroring the note drag handlers' touch support. */
function wbLinkHandleTouchStart(e, parentName) {
    if (!e.touches || e.touches.length !== 1) return;
    e.preventDefault();
    e.stopPropagation();
    const touch = e.touches[0];
    wbBeginLinkDrag(parentName, touch.clientX, touch.clientY);
    // wbBeginLinkDrag() wires the mouse listeners; this gesture is touch.
    window.removeEventListener('mousemove', wbLinkDragMouseMove);
    window.removeEventListener('mouseup', wbLinkDragMouseUp);
    window.addEventListener('touchmove', wbLinkDragTouchMove, { passive: false });
    window.addEventListener('touchend', wbLinkDragTouchEnd);
    window.addEventListener('touchcancel', wbLinkDragTouchEnd);
}

function wbLinkDragTouchMove(e) {
    if (!wbActiveLink || !e.touches || !e.touches.length) return;
    e.preventDefault();
    wbUpdateLinkDrag(e.touches[0].clientX, e.touches[0].clientY);
}

function wbLinkDragTouchEnd(e) {
    window.removeEventListener('touchmove', wbLinkDragTouchMove);
    window.removeEventListener('touchend', wbLinkDragTouchEnd);
    window.removeEventListener('touchcancel', wbLinkDragTouchEnd);
    const touch = (e.changedTouches && e.changedTouches[0]) || null;
    if (touch) wbEndLinkDrag(touch.clientX, touch.clientY);
    else wbEndLinkDrag(-1, -1);
}

// -- Transient message ---------------------------------------------------

let wbNoodleMessageTimer = null;

/**
 * Show a short-lived message over the canvas -- used for the reasons a
 * link was refused, and for confirming a cut. Deliberately not a modal or
 * a toast queue: a refused noodle is a nudge, not an error the user has to
 * dismiss.
 */
function wbFlashNoodleMessage(text) {
    const container = document.getElementById('whiteboardContainer');
    if (!container || !text) return;
    let el = container.querySelector('.wb-noodle-message');
    if (!el) {
        el = document.createElement('div');
        el.className = 'wb-noodle-message';
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        container.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('visible');
    if (wbNoodleMessageTimer) clearTimeout(wbNoodleMessageTimer);
    wbNoodleMessageTimer = setTimeout(() => el.classList.remove('visible'), 2600);
}
