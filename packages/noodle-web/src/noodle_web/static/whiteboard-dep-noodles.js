/**
 * Whiteboard dependency noodles (#1052) -- a second, distinct kind of
 * noodle alongside whiteboard-noodles.js's hierarchy noodles.
 *
 * A hierarchy noodle means "child of" in the outline; a dependency noodle
 * means "must finish before" -- a real `[depends: ...]` link, written
 * through plan-model.js's PlanModel (addDependency()/removeDependency()),
 * never regex, per #1052's own orientation notes on the #744/#747
 * caret-drift and wrong-line-edit bug class.
 *
 * The two kinds share the drag gesture in whiteboard-noodles.js (see
 * wbLinkMode there) but never share rendering or commit logic, and are
 * drawn in their own SVG layer with a distinct visual language (dashed,
 * a different colour) so a board with both never reads as one thing.
 *
 * Geometry (anchors/curve/arrow) is reused directly from
 * whiteboard-noodles.js's pure helpers -- wbNoodleAnchors/wbNoodlePathD/
 * wbNoodleArrowPoints/wbNoteRectFor -- since a dependency noodle connects
 * the same two note rectangles the same way a hierarchy noodle does; only
 * what the link *means*, how it commits, and how it looks differ.
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
 * Every explicit (non-shorthand) dependency edge where both ends are on
 * the board. Parses a fresh PlanModel from the current editor text --
 * cheap relative to a render pass, and the single source of truth for
 * dependency resolution (handles `$deliverable` targets, dependency
 * types, lag/lead) rather than re-deriving a second time here.
 */
function wbDepNoodleLinksFor(model, rows) {
    const onBoard = new Map();
    (rows || []).forEach(row => {
        if (row && row.task) onBoard.set(String(row.task).toLowerCase(), row.task);
    });

    const links = [];
    const seen = new Set();
    for (const task of model.tasks) {
        for (const edge of task.dependencies) {
            if (edge.shorthand || !edge.target) continue;
            const fromKey = String(edge.target.name).toLowerCase();
            const toKey = String(task.name).toLowerCase();
            if (!onBoard.has(fromKey) || !onBoard.has(toKey)) continue;
            const id = wbDepNoodleId(fromKey, toKey);
            if (seen.has(id)) continue;
            seen.add(id);
            links.push({ id, from: onBoard.get(fromKey), to: onBoard.get(toKey), fromTask: edge.target, toTask: task });
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
    const from = wbNoteRectFor(link.from);
    const to = wbNoteRectFor(link.to);
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
 * Re-derive and redraw every dependency noodle. Called alongside
 * wbRenderNoodles() from the same wbRenderNotes() pass (see
 * whiteboard-notes.js), so both noodle kinds and the notes they connect
 * can never disagree.
 */
function wbRenderDependencyNoodles(rows) {
    const layer = wbDepNoodlesLayer();
    if (!layer) return;
    const editor = document.getElementById('planEditor');
    if (!editor || typeof NoodlePlanModel === 'undefined') return;

    const model = NoodlePlanModel.PlanModel.parse(editor.value);
    wbDepNoodleLinks = wbDepNoodleLinksFor(model, rows);
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

/** Mirrors wbRefreshNoodleGeometry() -- called while a note is mid-drag. */
function wbRefreshDependencyNoodleGeometry(taskName) {
    if (!wbDepNoodleNodes.size) return;
    const key = taskName ? String(taskName).toLowerCase() : null;
    wbDepNoodleLinks.forEach(link => {
        if (key && String(link.from).toLowerCase() !== key && String(link.to).toLowerCase() !== key) return;
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
