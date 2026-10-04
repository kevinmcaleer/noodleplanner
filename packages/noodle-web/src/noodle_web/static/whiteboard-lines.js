/**
 * Whiteboard associative lines (#874) -- labelled lines between post-its for
 * idea-forming ("conflicts with", "see also", "same team").
 *
 * They are the third kind of line on the board, and the only one that is
 * *not* derived from the plan. A hierarchy noodle (whiteboard-noodles.js) is
 * the outline's parent/child link and a dependency noodle
 * (whiteboard-dep-noodles.js) is a real `[depends: ...]` token; an
 * associative line is a whiteboard-only annotation with no scheduling
 * weight, so it has to be stored. It is a `Kind: line` row in the
 * `---whiteboard---` table (see script.js's parseWhiteboardMarkdown() and
 * docs/reference/plan-format.rst): `Id` keys it, `From`/`To` name the two
 * notes by task, `Text` is the label and `Colour` is the pen.
 *
 * Drawn as a dotted line with no arrowhead, in the pen's colour, so it can
 * never be mistaken for a dependency (dashed, purple, arrowed) or a sub-task
 * (solid, blue, arrowed): the line's *style* carries its type, its colour is
 * free personal choice. The geometry is the hierarchy noodle's, reused.
 *
 * A line only draws while both of its notes are on the board. If a note
 * leaves the board the row stays in the file, as an orphan note row does,
 * and the line comes back with the note.
 *
 * Promoting a line to a dependency ("Make dependency") is one Markdown
 * commit: the `[depends: ...]` token goes in through plan-model.js and the
 * line's row comes out, so one undo puts both back.
 */

/**
 * The pen palette. Stored as the hex value in the row's `Colour` cell (blank
 * is the default pen, drawn in the theme's secondary text colour). Mid-tone
 * so each reads on both the light and the dark canvas.
 */
const WB_LINE_PENS = [
    { name: 'Red', colour: '#E5484D' },
    { name: 'Orange', colour: '#F76B15' },
    { name: 'Green', colour: '#30A46C' },
    { name: 'Blue', colour: '#3E63DD' },
    { name: 'Purple', colour: '#8E4EC6' },
    { name: 'Pink', colour: '#D6409F' },
    { name: 'Brown', colour: '#A18072' },
    { name: 'Grey', colour: '#7C8794' },
];

const WB_LINE_ID_PREFIX = 'l';

/** A fresh opaque id for a line row, unique among `items`. */
function wbGenerateLineId(items) {
    const taken = new Set((items || []).map(item => item && item.id).filter(Boolean));
    let id;
    do {
        id = WB_LINE_ID_PREFIX + Math.random().toString(36).slice(2, 8);
    } while (taken.has(id));
    return id;
}

/** Whether `colour` is one of the pens (case-insensitive hex match). */
function wbIsKnownPen(colour) {
    const key = String(colour || '').toLowerCase();
    return WB_LINE_PENS.some(pen => pen.colour.toLowerCase() === key);
}

/** The `line` rows of a parsed whiteboard table, in file order. */
function wbLineRows(items) {
    return (items || []).filter(item => item && item.kind === 'line' && item.id && item.from && item.to);
}

/**
 * Add a line between two notes. Returns the new items array and the new
 * line's id, or `{ ok: false, reason }` when the line would be meaningless:
 * a note joined to itself, or two notes already joined (in either
 * direction -- an associative line has no direction to tell apart).
 */
function wbAddLineToItems(items, fromName, toName) {
    if (!fromName || !toName) return { ok: false, reason: 'Pick two notes to join.' };
    const a = String(fromName).toLowerCase();
    const b = String(toName).toLowerCase();
    if (a === b) return { ok: false, reason: 'A line needs two different notes.' };
    const exists = wbLineRows(items).some(line => {
        const from = line.from.toLowerCase();
        const to = line.to.toLowerCase();
        return (from === a && to === b) || (from === b && to === a);
    });
    if (exists) return { ok: false, reason: 'Those notes already have a line between them.' };

    const id = wbGenerateLineId(items);
    return {
        ok: true,
        id,
        items: (items || []).concat([{ kind: 'line', id, from: fromName, to: toName, label: '', colour: '' }]),
    };
}

/** Change a line's label and/or pen. Returns a new items array. */
function wbUpdateLineInItems(items, id, changes) {
    return (items || []).map(item => {
        if (!item || item.kind !== 'line' || item.id !== id) return item;
        const next = { ...item };
        if (changes && changes.label !== undefined) next.label = String(changes.label).replace(/\s*\n\s*/g, ' ').trim();
        if (changes && changes.colour !== undefined) next.colour = String(changes.colour || '');
        return next;
    });
}

/** Drop a line row. Returns a new items array. */
function wbRemoveLineFromItems(items, id) {
    return (items || []).filter(item => !(item && item.kind === 'line' && item.id === id));
}

/**
 * Promote a line to a real dependency: `to` comes to depend on `from`, so the
 * arrow runs the way the line was drawn (from -> to). The plan text comes
 * back with the `[depends: ...]` token written and the line's row gone, or
 * `{ ok: false, reason }` -- a summary task cannot take a dependency, and a
 * loop is refused, both by plan-model.js's canAddDependency().
 */
function wbPromoteLineInPlanText(planText, id) {
    if (typeof NoodlePlanModel === 'undefined') return { ok: false, reason: 'The plan model is not loaded.' };
    const items = parseWhiteboardMarkdown(extractWhiteboardFromPlanText(planText));
    const line = wbLineRows(items).find(item => item.id === id);
    if (!line) return { ok: false, reason: 'That line no longer exists.' };

    const model = NoodlePlanModel.PlanModel.parse(planText);
    const from = model.findByName(line.from);
    const to = model.findByName(line.to);
    if (!from || !to) return { ok: false, reason: 'One of the notes is no longer a task in the plan.' };
    const check = model.canAddDependency(to, from);
    if (!check.ok) return { ok: false, reason: check.reason };

    model.addDependency(to, from);
    const written = model.serialize();
    const remaining = wbRemoveLineFromItems(
        parseWhiteboardMarkdown(extractWhiteboardFromPlanText(written)), id);
    return { ok: true, text: updatePlanWhiteboardText(written, remaining), from: line.from, to: line.to };
}

// -- DOM -----------------------------------------------------------------

/** Board units: the room the label and its controls get at a line's middle. */
const WB_LINE_TAG_WIDTH = 280;
const WB_LINE_TAG_HEIGHT = 120;

/** line id -> { group, hit, path, tag, ... } for every rendered line. */
let wbLineNodes = new Map();
let wbLineList = [];
let wbSelectedLine = null;
/** The line being drawn from a note's menu, or null. */
let wbActiveLineDraw = null;

function wbLinesLayer() {
    if (typeof wbGroup === 'undefined' || !wbGroup) return null;
    let layer = wbGroup.querySelector('.wb-assoc-lines-layer');
    if (!layer) {
        layer = document.createElementNS(WB_SVG_NS, 'g');
        layer.setAttribute('class', 'wb-assoc-lines-layer');
        // Under the notes like the other two kinds, so a line never hides one.
        const notes = wbGroup.querySelector('.wb-notes-layer');
        if (notes) wbGroup.insertBefore(layer, notes);
        else wbGroup.appendChild(layer);
    }
    return layer;
}

/** The board rect for a note by task name, matched case-insensitively. */
function wbLineEndRect(taskName) {
    if (typeof wbNoteNodes === 'undefined' || !wbNoteNodes || !taskName) return null;
    const direct = wbNoteRectFor(taskName);
    if (direct && direct.width) return direct;
    const key = String(taskName).toLowerCase();
    for (const name of wbNoteNodes.keys()) {
        if (String(name).toLowerCase() !== key) continue;
        const rect = wbNoteRectFor(name);
        if (rect && rect.width) return rect;
    }
    return null;
}

function wbLinePenColour(colour) {
    return colour || 'var(--np-text-secondary)';
}

function wbCreateLineNode(line) {
    const group = document.createElementNS(WB_SVG_NS, 'g');
    group.setAttribute('class', 'wb-assoc-line');
    group.dataset.lineId = line.id;

    const hit = document.createElementNS(WB_SVG_NS, 'path');
    hit.setAttribute('class', 'wb-assoc-line-hit');
    hit.setAttribute('fill', 'none');
    hit.setAttribute('stroke', 'transparent');
    hit.setAttribute('stroke-width', String(WB_NOODLE_HIT_WIDTH));

    const path = document.createElementNS(WB_SVG_NS, 'path');
    path.setAttribute('class', 'wb-assoc-line-path');
    path.setAttribute('fill', 'none');

    const tag = document.createElementNS(WB_SVG_NS, 'foreignObject');
    tag.setAttribute('class', 'wb-assoc-line-tag-fo');
    tag.setAttribute('width', String(WB_LINE_TAG_WIDTH));
    tag.setAttribute('height', String(WB_LINE_TAG_HEIGHT));

    const body = document.createElement('div');
    body.className = 'wb-assoc-line-tag';
    body.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');

    const labelText = document.createElement('button');
    labelText.type = 'button';
    labelText.className = 'wb-assoc-line-label';
    labelText.title = 'Select this line to label or recolour it';

    const controls = document.createElement('div');
    controls.className = 'wb-assoc-line-controls';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'wb-assoc-line-input';
    input.placeholder = 'Label, e.g. conflicts with';
    input.setAttribute('aria-label', 'Line label');
    input.maxLength = 60;

    const pens = document.createElement('div');
    pens.className = 'wb-assoc-line-pens';
    pens.setAttribute('role', 'group');
    pens.setAttribute('aria-label', 'Pen colour');
    const penButtons = [{ name: 'Default', colour: '' }].concat(WB_LINE_PENS).map(pen => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'wb-assoc-line-pen';
        btn.dataset.pen = pen.colour;
        btn.title = pen.name + ' pen';
        btn.setAttribute('aria-label', pen.name + ' pen');
        btn.style.setProperty('--wb-pen', wbLinePenColour(pen.colour));
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            wbSetLineProps(line.id, { colour: pen.colour });
        });
        pens.appendChild(btn);
        return btn;
    });

    const actions = document.createElement('div');
    actions.className = 'wb-assoc-line-actions';
    const promote = document.createElement('button');
    promote.type = 'button';
    promote.className = 'wb-assoc-line-action wb-assoc-line-promote';
    promote.textContent = 'Make dependency';
    promote.title = 'Turn this line into a real dependency: the second note can only start once the first has finished';
    promote.addEventListener('click', (e) => { e.stopPropagation(); wbPromoteLine(line.id); });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'wb-assoc-line-action wb-assoc-line-delete';
    remove.textContent = 'Delete';
    remove.title = 'Remove this line (Delete)';
    remove.addEventListener('click', (e) => { e.stopPropagation(); wbDeleteLine(line.id); });
    actions.appendChild(promote);
    actions.appendChild(remove);

    controls.appendChild(input);
    controls.appendChild(pens);
    controls.appendChild(actions);
    body.appendChild(labelText);
    body.appendChild(controls);
    tag.appendChild(body);

    const title = document.createElementNS(WB_SVG_NS, 'title');

    group.appendChild(title);
    group.appendChild(hit);
    group.appendChild(path);
    group.appendChild(tag);

    const select = (e) => { e.stopPropagation(); wbSelectLine(line.id); };
    hit.addEventListener('mousedown', (e) => e.stopPropagation());
    hit.addEventListener('click', select);
    path.addEventListener('click', select);
    labelText.addEventListener('mousedown', (e) => e.stopPropagation());
    labelText.addEventListener('click', select);
    body.addEventListener('mousedown', (e) => e.stopPropagation());
    body.addEventListener('dblclick', (e) => e.stopPropagation());

    const commitLabel = () => {
        const current = wbLineList.find(item => item.id === line.id);
        if (current && input.value.trim() !== (current.label || '')) wbSetLineProps(line.id, { label: input.value });
    };
    input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); commitLabel(); input.blur(); }
        if (e.key === 'Escape') { input.value = (wbLineList.find(item => item.id === line.id) || {}).label || ''; input.blur(); }
    });
    input.addEventListener('blur', commitLabel);

    return { group, hit, path, tag, title, labelText, input, penButtons, promote };
}

/** Position and restyle one line's DOM from its row and its notes' rects. */
function wbLayoutLine(node, line) {
    const from = wbLineEndRect(line.from);
    const to = wbLineEndRect(line.to);
    if (!from || !to) {
        node.group.setAttribute('visibility', 'hidden');
        return;
    }
    node.group.removeAttribute('visibility');

    const anchors = wbNoodleAnchors(from, to);
    const d = wbNoodlePathD(anchors);
    const mid = wbNoodleMidpoint(anchors);
    node.hit.setAttribute('d', d);
    node.path.setAttribute('d', d);
    node.path.style.stroke = wbLinePenColour(line.colour);
    node.tag.setAttribute('x', String(mid.x - WB_LINE_TAG_WIDTH / 2));
    node.tag.setAttribute('y', String(mid.y - 14));
    node.title.textContent = line.label
        ? line.from + ' — ' + line.label + ' — ' + line.to
        : line.from + ' — ' + line.to;

    node.labelText.textContent = line.label || '';
    node.labelText.hidden = !line.label;
    node.labelText.style.setProperty('--wb-pen', wbLinePenColour(line.colour));
    if (document.activeElement !== node.input) node.input.value = line.label || '';
    node.penButtons.forEach(btn => {
        btn.setAttribute('aria-pressed', String(btn.dataset.pen.toLowerCase() === String(line.colour || '').toLowerCase()));
    });
}

/**
 * Re-derive and redraw every line. Called from the same wbRenderNotes() pass
 * as the other two kinds of noodle, so a line and the notes it joins can
 * never disagree.
 */
function wbRenderLines(rows) {
    const layer = wbLinesLayer();
    if (!layer) return;
    wbLineList = wbLineRows(rows);
    const seen = new Set();

    wbLineList.forEach(line => {
        seen.add(line.id);
        let node = wbLineNodes.get(line.id);
        if (!node) {
            node = wbCreateLineNode(line);
            layer.appendChild(node.group);
            wbLineNodes.set(line.id, node);
        }
        node.group.classList.toggle('selected', wbSelectedLine === line.id);
        wbLayoutLine(node, line);
    });

    for (const [id, node] of wbLineNodes) {
        if (!seen.has(id)) {
            node.group.remove();
            wbLineNodes.delete(id);
            if (wbSelectedLine === id) wbSelectedLine = null;
        }
    }
}

/** Re-lay-out only the lines touching a note mid-drag, as wbRefreshNoodleGeometry() does. */
function wbRefreshLineGeometry(taskName) {
    if (!wbLineNodes.size) return;
    const key = taskName ? String(taskName).toLowerCase() : null;
    wbLineList.forEach(line => {
        if (key && line.from.toLowerCase() !== key && line.to.toLowerCase() !== key) return;
        const node = wbLineNodes.get(line.id);
        if (node) wbLayoutLine(node, line);
    });
}

function wbSelectLine(id) {
    wbSelectedLine = id;
    wbLineNodes.forEach((node, nodeId) => node.group.classList.toggle('selected', nodeId === id));
}

function wbClearLineSelection() {
    if (!wbSelectedLine) return;
    wbSelectedLine = null;
    wbLineNodes.forEach(node => node.group.classList.remove('selected'));
}

/** Delete key: cut the selected line. */
function wbCutSelectedLine() {
    if (!wbSelectedLine) return false;
    return wbDeleteLine(wbSelectedLine);
}

// -- Commit paths --------------------------------------------------------

function wbLinesEditor() {
    return (typeof document !== 'undefined') ? document.getElementById('planEditor') : null;
}

/** Read the table, apply `change(items)`, write it back as one commit. */
function wbCommitLineItems(change) {
    const editor = wbLinesEditor();
    if (!editor) return false;
    const planText = editor.value;
    const items = parseWhiteboardMarkdown(extractWhiteboardFromPlanText(planText));
    const next = change(items);
    if (!next) return false;
    return wbCommitMarkdown(updatePlanWhiteboardText(planText, next));
}

function wbSetLineProps(id, changes) {
    return wbCommitLineItems(items => wbUpdateLineInItems(items, id, changes));
}

function wbDeleteLine(id) {
    const committed = wbCommitLineItems(items => wbRemoveLineFromItems(items, id));
    if (committed) wbClearLineSelection();
    return committed;
}

/** Draw a line between two notes -- a no-op with a message if it is refused. */
function wbAddLine(fromName, toName) {
    let result = null;
    const committed = wbCommitLineItems(items => {
        result = wbAddLineToItems(items, fromName, toName);
        return result.ok ? result.items : null;
    });
    if (result && !result.ok) wbFlashNoodleMessage(result.reason);
    if (committed && result && result.id) wbSelectLine(result.id);
    return committed;
}

function wbPromoteLine(id) {
    const editor = wbLinesEditor();
    if (!editor) return false;
    const result = wbPromoteLineInPlanText(editor.value, id);
    if (!result.ok) {
        wbFlashNoodleMessage(result.reason);
        return false;
    }
    const committed = wbCommitMarkdown(result.text);
    if (committed) {
        wbClearLineSelection();
        wbFlashNoodleMessage('"' + result.to + '" now depends on "' + result.from + '".');
    }
    return committed;
}

// -- Drawing a line from a note's menu -------------------------------------

/**
 * Start drawing a line out of `fromName`: a ghost follows the pointer, and
 * the next press on another note joins them. A press anywhere else, or Escape,
 * cancels. Armed from the note's menu ("Draw a line to…") rather than a
 * hover handle, because a note's edges already belong to the sub-task
 * handle and to resizing.
 */
function wbBeginLineDraw(fromName) {
    const layer = wbLinesLayer();
    if (!layer || !fromName) return;
    wbCancelLineDraw();

    const ghost = document.createElementNS(WB_SVG_NS, 'path');
    ghost.setAttribute('class', 'wb-assoc-line-ghost');
    ghost.setAttribute('fill', 'none');
    layer.appendChild(ghost);

    wbActiveLineDraw = { fromName, ghost, hoverEl: null };
    document.body.classList.add('wb-line-drawing');
    wbFlashNoodleMessage('Click the note to join "' + fromName + '" to. Esc cancels.');

    window.addEventListener('mousemove', wbLineDrawMouseMove, true);
    window.addEventListener('mousedown', wbLineDrawMouseDown, true);
    window.addEventListener('keydown', wbLineDrawKeyDown, true);
}

function wbLineDrawNoteAt(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY);
    const fo = (el && el.closest) ? el.closest('foreignObject[data-wb-task]') : null;
    return fo ? { fo, name: fo.dataset.wbTask } : null;
}

function wbLineDrawMouseMove(e) {
    const draw = wbActiveLineDraw;
    if (!draw) return;
    const from = wbLineEndRect(draw.fromName);
    if (!from) return;
    const point = wbClientToBoard(e.clientX, e.clientY);
    draw.ghost.setAttribute('d', wbNoodlePathD(wbNoodleAnchors(from, { x: point.x, y: point.y, width: 0, height: 0 })));

    const hit = wbLineDrawNoteAt(e.clientX, e.clientY);
    const el = hit && hit.name !== draw.fromName ? hit.fo : null;
    if (draw.hoverEl && draw.hoverEl !== el) draw.hoverEl.classList.remove('wb-line-target');
    if (el) el.classList.add('wb-line-target');
    draw.hoverEl = el;
}

function wbLineDrawMouseDown(e) {
    const draw = wbActiveLineDraw;
    if (!draw) return;
    // The press is the whole gesture: it must not also start a note drag or
    // a lasso underneath.
    e.preventDefault();
    e.stopPropagation();
    const hit = wbLineDrawNoteAt(e.clientX, e.clientY);
    const fromName = draw.fromName;
    wbCancelLineDraw();
    if (hit && hit.name !== fromName) wbAddLine(fromName, hit.name);
}

function wbLineDrawKeyDown(e) {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    wbCancelLineDraw();
}

function wbCancelLineDraw() {
    const draw = wbActiveLineDraw;
    if (!draw) return;
    window.removeEventListener('mousemove', wbLineDrawMouseMove, true);
    window.removeEventListener('mousedown', wbLineDrawMouseDown, true);
    window.removeEventListener('keydown', wbLineDrawKeyDown, true);
    document.body.classList.remove('wb-line-drawing');
    if (draw.ghost) draw.ghost.remove();
    if (draw.hoverEl) draw.hoverEl.classList.remove('wb-line-target');
    wbActiveLineDraw = null;
}
