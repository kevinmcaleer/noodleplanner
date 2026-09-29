/**
 * Whiteboard dependency noodles (#1052, reworked by #1106) -- a second,
 * distinct kind of noodle alongside whiteboard-noodles.js's hierarchy
 * noodles.
 *
 * A hierarchy noodle means "child of" in the outline; a dependency noodle
 * means "must finish before" -- a real `[depends: ...]` link, written
 * through plan-model.js's PlanModel (addDependency()/removeDependency()),
 * never regex, per #1052's own orientation notes on the #744/#747
 * caret-drift and wrong-line-edit bug class.
 *
 * #1052 originally drew a dependency noodle between two whole note cards,
 * sharing whiteboard-noodles.js's card-to-card drag gesture behind a
 * "Dependency" toolbar mode. That let a card representing a *summary*
 * task appear to have a dependency, which breaks the "summary tasks can't
 * have dependencies" rule (plan-model.js's canAddDependency() now refuses
 * it, but the card-level gesture had no way to steer the user away from
 * even attempting it). #1106 removes that whole-card gesture entirely --
 * see whiteboard-noodles.js's own header -- and replaces it with a
 * per-row one: a small handle on a checklist row (wbBuildChildRow() in
 * whiteboard-notes.js, only ever rendered for a real leaf task, never a
 * summary child row or the note's own header) that drags a noodle out to
 * *another* checklist row, started and finished here
 * (wbBeginRowDepDrag()/wbEndRowDepDrag()).
 *
 * Geometry between two whole note cards is reused directly from
 * whiteboard-noodles.js's pure helpers -- wbNoodleAnchors/wbNoodlePathD/
 * wbNoodleArrowPoints. A checklist-row endpoint (see
 * wbDepNoodleEndpointRectFor()) is anchored on its card's outer edge
 * instead, so the arrowhead saying which task waits on which is never
 * hidden under the card -- see wbDepNoodleGeometry().
 */

const WB_DEP_NOODLE_ID_SEP = '';
function wbDepNoodleId(fromName, toName) {
    return String(fromName).toLowerCase() + WB_DEP_NOODLE_ID_SEP + String(toName).toLowerCase();
}

let wbDepNoodleNodes = new Map();
let wbDepNoodleLinks = [];
let wbDepSelectedNoodle = null;

function wbDepNoodlesLayer() {
    if (typeof wbGroup === 'undefined' || !wbGroup) return null;
    let layer = wbGroup.querySelector('.wb-dep-noodles-layer');
    if (!layer) {
        layer = document.createElementNS(WB_SVG_NS, 'g');
        layer.setAttribute('class', 'wb-dep-noodles-layer');
        // After the hierarchy layer (painted on top of it) but still
        // before the notes layer, so both noodle kinds sit under every
        // note regardless of which was inserted first.
        const notes = wbGroup.querySelector('.wb-notes-layer');
        if (notes) wbGroup.insertBefore(layer, notes);
        else wbGroup.appendChild(layer);
    }
    return layer;
}

/**
 * Every explicit (non-shorthand) dependency edge with a resolved target.
 * Parses a fresh PlanModel from the current editor text -- cheap relative
 * to a render pass, and the single source of truth for dependency
 * resolution (handles `$deliverable` targets, dependency types, lag/lead)
 * rather than re-deriving a second time here.
 *
 * Unlike #1052's original version, this no longer restricts to edges
 * where both ends have their own whiteboard row -- a dependency now
 * usually joins two checklist rows *inside* other notes' bodies, not two
 * note cards, so "is this visible on the board at all" is resolved later,
 * per edge, by wbLayoutDepNoodle() (via wbDepNoodleEndpointRectFor()) at
 * layout time -- exactly how wbNoteRectFor() already makes a hierarchy
 * noodle simply not draw when its note isn't on the board, rather than
 * this function trying to know the board's current DOM up front.
 */
function wbDepNoodleLinksFor(model) {
    const links = [];
    const seen = new Set();
    for (const task of model.tasks) {
        for (const edge of task.dependencies) {
            if (edge.shorthand || !edge.target) continue;
            const fromKey = String(edge.target.name).toLowerCase();
            const toKey = String(task.name).toLowerCase();
            const id = wbDepNoodleId(fromKey, toKey);
            if (seen.has(id)) continue;
            seen.add(id);
            links.push({ id, from: edge.target.name, to: task.name, fromTask: edge.target, toTask: task });
        }
    }
    return links;
}

function wbCreateDepNoodleNode(link) {
    const group = document.createElementNS(WB_SVG_NS, 'g');
    group.setAttribute('class', 'wb-dep-noodle');
    group.dataset.from = link.from;
    group.dataset.to = link.to;

    const hit = document.createElementNS(WB_SVG_NS, 'path');
    hit.setAttribute('class', 'wb-dep-noodle-hit');
    hit.setAttribute('fill', 'none');
    hit.setAttribute('stroke', 'transparent');
    hit.setAttribute('stroke-width', String(WB_NOODLE_HIT_WIDTH));

    const path = document.createElementNS(WB_SVG_NS, 'path');
    path.setAttribute('class', 'wb-dep-noodle-path');
    path.setAttribute('fill', 'none');

    const arrow = document.createElementNS(WB_SVG_NS, 'polygon');
    arrow.setAttribute('class', 'wb-dep-noodle-arrow');

    const cut = document.createElementNS(WB_SVG_NS, 'g');
    cut.setAttribute('class', 'wb-dep-noodle-cut');
    cut.setAttribute('role', 'button');
    cut.setAttribute('aria-label', 'Remove dependency: ' + link.to + ' on ' + link.from);
    const cutCircle = document.createElementNS(WB_SVG_NS, 'circle');
    cutCircle.setAttribute('r', '11');
    cutCircle.setAttribute('class', 'wb-dep-noodle-cut-bg');
    const cutMark = document.createElementNS(WB_SVG_NS, 'path');
    cutMark.setAttribute('class', 'wb-dep-noodle-cut-mark');
    cutMark.setAttribute('d', 'M -4 -4 L 4 4 M 4 -4 L -4 4');
    cut.appendChild(cutCircle);
    cut.appendChild(cutMark);

    const label = document.createElementNS(WB_SVG_NS, 'title');
    label.textContent = link.to + ' depends on ' + link.from;

    group.appendChild(label);
    group.appendChild(hit);
    group.appendChild(path);
    group.appendChild(arrow);
    group.appendChild(cut);

    const select = (e) => { e.stopPropagation(); wbSelectDepNoodle(link.id); };
    hit.addEventListener('mousedown', (e) => e.stopPropagation());
    hit.addEventListener('click', select);
    path.addEventListener('click', select);
    cut.addEventListener('mousedown', (e) => e.stopPropagation());
    cut.addEventListener('click', (e) => {
        e.stopPropagation();
        wbCutDependencyNoodle(link.from, link.to);
    });

    return { group, hit, path, arrow, cut };
}

function wbLayoutDepNoodle(node, link) {
    const from = wbDepNoodleEndpointRectFor(link.from);
    const to = wbDepNoodleEndpointRectFor(link.to);
    if (!from || !to || !from.width || !to.width) {
        node.group.setAttribute('visibility', 'hidden');
        return;
    }
    node.group.removeAttribute('visibility');

    const geometry = wbDepNoodleGeometry(from, to);
    node.hit.setAttribute('d', geometry.d);
    node.path.setAttribute('d', geometry.d);
    node.arrow.setAttribute('points', geometry.arrow);
    node.cut.setAttribute('transform', `translate(${geometry.mid.x}, ${geometry.mid.y})`);
}

/** Board units. Larger than a hierarchy noodle's arrowhead: which way a
 * dependency points is the whole of what it says. */
const WB_DEP_NOODLE_ARROW_SIZE = 13;

/**
 * The path, arrowhead and midpoint for one dependency noodle, from the
 * endpoint rects wbDepNoodleEndpointRectFor() returns. Pure -- unit tested
 * in tests/test_whiteboard_dep_noodles.mjs.
 *
 * Two whole note cards are joined exactly like a hierarchy noodle
 * (wbNoodleAnchors()). An endpoint that is a checklist row is different:
 * the row is *inside* its note card, and this layer paints under the notes
 * layer, so a noodle ending on the row's own edge had its arrowhead hidden
 * behind the card -- a dependency read as a plain line with no direction.
 * So a row endpoint is anchored on its card's outer left or right edge, at
 * the row's height, and the arrowhead sits just outside the card pointing
 * in at that row. Only the card's sides are used: a top or bottom edge
 * would say nothing about which row is meant.
 *
 * When the two ends cannot face each other across a gap (the cards overlap
 * horizontally, or both rows are in the same card) the noodle leaves and
 * enters by the same side, looping out and back.
 */
function wbDepNoodleGeometry(from, to) {
    const size = WB_DEP_NOODLE_ARROW_SIZE;
    if (!from.card && !to.card) {
        const anchors = wbNoodleAnchors(from, to);
        return {
            d: wbNoodlePathD(anchors),
            arrow: wbNoodleArrowPoints(anchors, size),
            mid: wbNoodleMidpoint(anchors),
        };
    }

    const sides = (end) => {
        const box = end.card || end;
        const y = end.y + end.height / 2;
        return { right: { x: box.x + box.width, y, out: 1 }, left: { x: box.x, y, out: -1 } };
    };
    const fromSides = sides(from);
    const toSides = sides(to);
    const candidates = [
        { a: fromSides.right, b: toSides.left },
        { a: fromSides.left, b: toSides.right },
        { a: fromSides.right, b: toSides.right },
        { a: fromSides.left, b: toSides.left },
    ].filter(({ a, b }) => {
        // Facing sides only work with the gap between them in front of
        // both: otherwise the curve doubles back through the cards.
        if (a.out === b.out) return true;
        return a.out > 0 ? b.x >= a.x : b.x <= a.x;
    });

    let best = candidates[0];
    let bestDist = Infinity;
    candidates.forEach(c => {
        const dist = Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y);
        if (dist < bestDist) { bestDist = dist; best = c; }
    });

    const { a, b } = best;
    const bulge = a.out === b.out
        ? Math.max(WB_NOODLE_MIN_CURVE, Math.abs(b.y - a.y) * 0.25)
        : Math.max(WB_NOODLE_MIN_CURVE, Math.abs(b.x - a.x) * WB_NOODLE_CURVE);
    const c1 = { x: a.x + bulge * a.out, y: a.y };
    const c2 = { x: b.x + bulge * b.out, y: b.y };
    const baseX = b.x + size * b.out;
    return {
        d: `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`,
        arrow: `${b.x},${b.y} ${baseX},${b.y - size * 0.6} ${baseX},${b.y + size * 0.6}`,
        // A cubic bezier at t = 0.5 -- see wbNoodleMidpoint().
        mid: {
            x: (a.x + 3 * c1.x + 3 * c2.x + b.x) / 8,
            y: (a.y + 3 * c1.y + 3 * c2.y + b.y) / 8,
        },
    };
}

/**
 * The board rect (board-space x/y/width/height) for `taskName`, wherever
 * it is currently drawn: its own note card if it has one
 * (wbNoteRectFor()), otherwise the checklist row for it inside its
 * parent's note body (wbNoteRowRectFor()), otherwise null -- exactly the
 * same "not on the board right now" outcome wbNoteRectFor() alone already
 * gives a hierarchy noodle, just resolved over the wider set of places a
 * task can now appear. A row's rect also carries `card`, the rect of the
 * note it is in, which wbDepNoodleGeometry() anchors on.
 */
function wbDepNoodleEndpointRectFor(taskName) {
    const cardRect = (typeof wbNoteRectFor === 'function') ? wbNoteRectFor(taskName) : null;
    if (cardRect && cardRect.width) return cardRect;
    return (typeof wbNoteRowRectFor === 'function') ? wbNoteRowRectFor(taskName) : null;
}

/**
 * Re-derive and redraw every dependency noodle. Called alongside
 * wbRenderNoodles() from the same wbRenderNotes() pass (see
 * whiteboard-notes.js), so both noodle kinds and the notes they connect
 * can never disagree.
 */
function wbRenderDependencyNoodles() {
    const layer = wbDepNoodlesLayer();
    if (!layer) return;
    const editor = document.getElementById('planEditor');
    if (!editor || typeof NoodlePlanModel === 'undefined') return;

    const model = NoodlePlanModel.PlanModel.parse(editor.value);
    wbDepNoodleLinks = wbDepNoodleLinksFor(model);
    const seen = new Set();

    wbDepNoodleLinks.forEach(link => {
        seen.add(link.id);
        let node = wbDepNoodleNodes.get(link.id);
        if (!node) {
            node = wbCreateDepNoodleNode(link);
            layer.appendChild(node.group);
            wbDepNoodleNodes.set(link.id, node);
        }
        node.group.classList.toggle('selected', wbDepSelectedNoodle === link.id);
        wbLayoutDepNoodle(node, link);
    });

    for (const [id, node] of wbDepNoodleNodes) {
        if (!seen.has(id)) {
            node.group.remove();
            wbDepNoodleNodes.delete(id);
            if (wbDepSelectedNoodle === id) wbDepSelectedNoodle = null;
        }
    }
}

/**
 * Mirrors wbRefreshNoodleGeometry() -- called while a note is mid-drag.
 * A link "touches" the dragged note either because one of its own ends
 * *is* that note's task (the #1052 card-to-card case) or because it's a
 * checklist row living inside that note's body (#1106) -- in which case
 * the row moves with the note even though its own task name never
 * matches `taskName`.
 */
function wbRefreshDependencyNoodleGeometry(taskName) {
    if (!wbDepNoodleNodes.size) return;
    const key = taskName ? String(taskName).toLowerCase() : null;
    const touches = (task) => {
        if (!key || !task) return false;
        if (String(task.name).toLowerCase() === key) return true;
        return !!(task.parent && String(task.parent.name).toLowerCase() === key);
    };
    wbDepNoodleLinks.forEach(link => {
        if (!touches(link.fromTask) && !touches(link.toTask)) return;
        const node = wbDepNoodleNodes.get(link.id);
        if (node) wbLayoutDepNoodle(node, link);
    });
}

function wbSelectDepNoodle(id) {
    wbDepSelectedNoodle = id;
    wbDepNoodleNodes.forEach((node, nodeId) => node.group.classList.toggle('selected', nodeId === id));
}

function wbClearDepNoodleSelection() {
    if (!wbDepSelectedNoodle) return;
    wbDepSelectedNoodle = null;
    wbDepNoodleNodes.forEach(node => node.group.classList.remove('selected'));
}

function wbCutSelectedDependencyNoodle() {
    if (!wbDepSelectedNoodle) return false;
    const node = wbDepNoodleNodes.get(wbDepSelectedNoodle);
    if (!node) return false;
    return wbCutDependencyNoodle(node.group.dataset.from, node.group.dataset.to);
}

// -- Commit paths (through plan-model.js, never regex) -------------------

/**
 * Check whether a dependency drag from `fromName` to `toName` is legal,
 * without mutating anything -- used for live drag-hover feedback.
 */
function wbCanLinkDependency(fromName, toName) {
    const editor = document.getElementById('planEditor');
    if (!editor || !fromName || !toName) return { ok: false, reason: 'Pick two notes to link.' };
    const model = NoodlePlanModel.PlanModel.parse(editor.value);
    const from = model.findByName(fromName);
    const to = model.findByName(toName);
    if (!from || !to) return { ok: false, reason: 'Task not found.' };
    return model.canAddDependency(to, from);
}

/**
 * Commit a dependency drag: `toName` depends on `fromName` (fromName must
 * finish before toName starts). Re-parses the editor's current text at
 * commit time (not a cached model) so the write lands on whatever is
 * actually there, the same way wbLinkNotes() does for hierarchy noodles.
 */
function wbLinkDependency(fromName, toName) {
    const editor = document.getElementById('planEditor');
    if (!editor || !fromName || !toName) return false;

    const model = NoodlePlanModel.PlanModel.parse(editor.value);
    const from = model.findByName(fromName);
    const to = model.findByName(toName);
    const check = model.canAddDependency(to, from);
    if (!check.ok) {
        wbFlashNoodleMessage(check.reason);
        return false;
    }
    model.addDependency(to, from);
    return wbCommitMarkdown(model.serialize());
}

/** Remove a dependency noodle: `toName` no longer depends on `fromName`. */
function wbCutDependencyNoodle(fromName, toName) {
    const editor = document.getElementById('planEditor');
    if (!editor || !fromName || !toName) return false;

    const model = NoodlePlanModel.PlanModel.parse(editor.value);
    const from = model.findByName(fromName);
    const to = model.findByName(toName);
    if (!from || !to || !model.removeDependency(to, from)) return false;

    const committed = wbCommitMarkdown(model.serialize());
    if (committed) {
        wbClearDepNoodleSelection();
        wbFlashNoodleMessage('"' + toName + '" no longer depends on "' + fromName + '".');
    }
    return committed;
}

// -- Row geometry (#1106) -------------------------------------------------

/**
 * The live board rect of the checklist row for `taskName`, wherever it
 * happens to be rendered right now -- i.e. inside whichever note's body
 * currently shows it as a direct-child row (wbBuildChildRow(), tagged
 * with data-wb-row-task -- see whiteboard-notes.js). Unlike wbNoteRectFor()
 * (a note's own <foreignObject>, positioned in board units directly),
 * a row's position only exists as ordinary HTML layout inside that
 * foreignObject, so it has to be measured with getBoundingClientRect()
 * and converted back through wbClientToBoard() the same way a pointer
 * position is -- this is therefore DOM-dependent and only exercised by
 * manual/browser verification, never node --test (see this file's own
 * header).
 *
 * Returns null when the row isn't currently on screen at all: no note
 * shows it as a child row right now (its parent isn't on the board, or it
 * *is* on the board as its own note rather than a row -- see
 * wbDepNoodleEndpointRectFor(), which tries that case first), or the row
 * exists in the DOM but is hidden (a collapsed/title-only note hides its
 * whole body -- views/whiteboard.css's `.wb-note-title-only .wb-note-body`
 * -- which collapses getBoundingClientRect() to a zero rect, indistinguishable
 * here from "not rendered" and treated the same way: no noodle drawn,
 * rather than one anchored at a meaningless (0, 0)).
 */
function wbNoteRowRectFor(taskName) {
    if (typeof wbNoteNodes === 'undefined' || !wbNoteNodes || !taskName) return null;
    if (typeof wbClientToBoard !== 'function') return null;
    // A pan or zoom still waiting for its frame (whiteboard.js) has moved
    // the view but not the notes yet: measured now, a row would convert
    // back to the wrong board point.
    if (typeof wbFlushTransform === 'function') wbFlushTransform();
    const key = String(taskName).toLowerCase();

    for (const [noteTask, entry] of wbNoteNodes) {
        const body = entry && entry.refs && entry.refs.body;
        if (!body) continue;
        // Compared case-insensitively in JS (this file's convention
        // throughout) rather than baked into a `[data-wb-row-task="..."]`
        // attribute selector, since attribute-value matching in CSS is
        // case-sensitive and a task name may differ from `taskName` only
        // in case (e.g. a dependency edge's own recorded spelling).
        const rows = body.querySelectorAll('.wb-note-row[data-wb-row-task]');
        for (const row of rows) {
            if (String(row.dataset.wbRowTask).toLowerCase() !== key) continue;
            const rect = row.getBoundingClientRect();
            if (!rect.width || !rect.height) return null; // hidden (e.g. title-only tier)
            const topLeft = wbClientToBoard(rect.left, rect.top);
            const bottomRight = wbClientToBoard(rect.right, rect.bottom);
            const card = (typeof wbNoteRectFor === 'function') ? wbNoteRectFor(noteTask) : null;
            return {
                x: topLeft.x,
                y: topLeft.y,
                width: bottomRight.x - topLeft.x,
                height: bottomRight.y - topLeft.y,
                card: (card && card.width) ? card : null,
            };
        }
    }
    return null;
}

// -- Row-to-row drag-to-link (#1106) --------------------------------------

/** The row dependency drag currently in progress, or null. */
let wbActiveRowDepDrag = null;

/**
 * Start dragging a dependency noodle out of a checklist row's own handle
 * (wbBuildChildRow() in whiteboard-notes.js). Mirrors
 * wbBeginLinkDrag()/wbUpdateLinkDrag()/wbEndLinkDrag() in
 * whiteboard-noodles.js (same ghost-follows-pointer, drop-on-release
 * shape) but drops onto another checklist *row* rather than a note card,
 * and always commits a dependency, never a re-parent -- there is no mode
 * to switch, unlike the card-level gesture #1106 removes.
 */
function wbBeginRowDepDrag(fromName, clientX, clientY) {
    const layer = wbDepNoodlesLayer();
    if (!layer || !fromName) return;

    const ghost = document.createElementNS(WB_SVG_NS, 'path');
    ghost.setAttribute('class', 'wb-dep-noodle-ghost');
    ghost.setAttribute('fill', 'none');
    layer.appendChild(ghost);

    wbActiveRowDepDrag = { fromName, ghost, hoverEl: null, hoverName: null };
    document.body.classList.add('wb-linking');
    wbUpdateRowDepDrag(clientX, clientY);

    window.addEventListener('mousemove', wbRowDepDragMouseMove);
    window.addEventListener('mouseup', wbRowDepDragMouseUp);
}

/** Redraw the ghost noodle and highlight whatever row is under the pointer. */
function wbUpdateRowDepDrag(clientX, clientY) {
    if (!wbActiveRowDepDrag) return;
    const from = wbDepNoodleEndpointRectFor(wbActiveRowDepDrag.fromName);
    if (!from) return;

    const point = wbClientToBoard(clientX, clientY);
    const target = { x: point.x, y: point.y, width: 0, height: 0 };
    wbActiveRowDepDrag.ghost.setAttribute('d', wbNoodlePathD(wbNoodleAnchors(from, target)));

    const el = document.elementFromPoint(clientX, clientY);
    const rowEl = (el && el.closest) ? el.closest('.wb-note-row') : null;
    const name = (rowEl && rowEl.dataset) ? rowEl.dataset.wbRowTask : null;
    const isLeafRow = !!(rowEl && rowEl.dataset && rowEl.dataset.wbRowSummary !== 'true');

    if (wbActiveRowDepDrag.hoverEl && wbActiveRowDepDrag.hoverEl !== rowEl) {
        wbActiveRowDepDrag.hoverEl.classList.remove('wb-dep-row-target', 'wb-dep-row-target-invalid');
    }
    wbActiveRowDepDrag.hoverEl = rowEl || null;
    wbActiveRowDepDrag.hoverName = (rowEl && isLeafRow && name && name !== wbActiveRowDepDrag.fromName)
        ? name : null;

    if (rowEl && name) {
        const ok = isLeafRow && name !== wbActiveRowDepDrag.fromName &&
            wbCanLinkDependency(wbActiveRowDepDrag.fromName, name).ok;
        rowEl.classList.toggle('wb-dep-row-target', ok);
        rowEl.classList.toggle('wb-dep-row-target-invalid', !ok);
    }
}

/** Finish a row drag: commit the dependency if it landed on a valid row. */
function wbEndRowDepDrag(clientX, clientY) {
    if (!wbActiveRowDepDrag) return;
    const { fromName, ghost, hoverEl, hoverName } = wbActiveRowDepDrag;

    window.removeEventListener('mousemove', wbRowDepDragMouseMove);
    window.removeEventListener('mouseup', wbRowDepDragMouseUp);
    document.body.classList.remove('wb-linking');
    if (ghost) ghost.remove();
    if (hoverEl) hoverEl.classList.remove('wb-dep-row-target', 'wb-dep-row-target-invalid');
    wbActiveRowDepDrag = null;

    if (!hoverName) return;
    wbLinkDependency(fromName, hoverName);
}

function wbRowDepDragMouseMove(e) {
    if (!wbActiveRowDepDrag) return;
    e.preventDefault();
    wbUpdateRowDepDrag(e.clientX, e.clientY);
}

function wbRowDepDragMouseUp(e) {
    wbEndRowDepDrag(e.clientX, e.clientY);
}

/** Touch equivalent, mirroring whiteboard-noodles.js's wbLinkHandleTouchStart(). */
function wbRowDepHandleTouchStart(e, fromName) {
    if (!e.touches || e.touches.length !== 1) return;
    e.preventDefault();
    e.stopPropagation();
    const touch = e.touches[0];
    wbBeginRowDepDrag(fromName, touch.clientX, touch.clientY);
    window.removeEventListener('mousemove', wbRowDepDragMouseMove);
    window.removeEventListener('mouseup', wbRowDepDragMouseUp);
    window.addEventListener('touchmove', wbRowDepDragTouchMove, { passive: false });
    window.addEventListener('touchend', wbRowDepDragTouchEnd);
    window.addEventListener('touchcancel', wbRowDepDragTouchEnd);
}

function wbRowDepDragTouchMove(e) {
    if (!wbActiveRowDepDrag || !e.touches || !e.touches.length) return;
    e.preventDefault();
    wbUpdateRowDepDrag(e.touches[0].clientX, e.touches[0].clientY);
}

function wbRowDepDragTouchEnd(e) {
    window.removeEventListener('touchmove', wbRowDepDragTouchMove);
    window.removeEventListener('touchend', wbRowDepDragTouchEnd);
    window.removeEventListener('touchcancel', wbRowDepDragTouchEnd);
    const touch = (e.changedTouches && e.changedTouches[0]) || null;
    if (touch) wbEndRowDepDrag(touch.clientX, touch.clientY);
    else wbEndRowDepDrag(-1, -1);
}
