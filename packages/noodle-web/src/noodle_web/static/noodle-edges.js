/**
 * noodle-edges.js -- the Noodle view's edge renderer (issue #985).
 *
 * Pure geometry, no DOM (same split as noodle-layout.js): given a node's
 * layout-engine coordinates, this only ever answers "what SVG path/points
 * would draw this edge". It never touches layout -- no overlap avoidance,
 * no layering, no crossing-minimisation -- that is noodle-layout.js's job
 * and *only* its job, so a lens can swap layout engines (force-directed for
 * brainstorm, hierarchical for commit) without this file changing at all,
 * per #985's "Key decisions".
 *
 * Port model: every edge leaves the right edge of its source node and
 * enters the left edge of its target node (noodleEdgePorts()) -- always,
 * regardless of whether the target sits above, below, or beside the
 * source, so a curve reads consistently even when nodes are stacked
 * vertically (#985 scope: "Consistent entry/exit even when nodes are
 * stacked vertically").
 *
 * Simple case: a single cubic bezier, control points pushed a fixed
 * horizontal distance straight out from each port -- the Node-RED/Blender
 * S-bend. With waypoints (from the layout engine, to dodge an intervening
 * node) the same port-to-port horizontal entry/exit is kept, and a smooth
 * multi-segment spline threads through the waypoints in between
 * (noodleEdgePathD() handles both: no waypoints collapses to the simple
 * case automatically).
 */

// -- Ports ---------------------------------------------------------------

/**
 * The two ports of a node rect: {x, y, width, height}. Exit is the right
 * edge's midpoint, entry the left edge's -- the port model every edge
 * uses regardless of the two nodes' relative position.
 */
function noodleEdgePorts(rect) {
    return {
        exit: { x: rect.x + rect.width, y: rect.y + rect.height / 2 },
        entry: { x: rect.x, y: rect.y + rect.height / 2 },
    };
}

// -- Path geometry ---------------------------------------------------------

const NOODLE_EDGE_MIN_CONTROL = 40; // board units; never a flatter bulge than this

/**
 * Smoothly thread a cubic-bezier chain through `points` (an ordered array
 * of at least 2 {x,y} points -- ports, with any layout-engine waypoints in
 * between). The first and last points always leave/arrive horizontally
 * (their tangent is forced to (1, 0)), which is what keeps port entry/exit
 * horizontal whether or not waypoints are present; interior waypoints get
 * a Catmull-Rom-style tangent from their neighbours, which is what gives
 * "gentle middle bends" rather than sharp corners.
 */
function noodleEdgePathD(points, controlOffset) {
    if (!points || points.length < 2) return '';
    if (points.length === 2) {
        return noodleSimpleBezierD(points[0], points[1], controlOffset);
    }

    const tangents = points.map((p, i) => {
        if (i === 0 || i === points.length - 1) return { x: 1, y: 0 }; // horizontal at the ports
        const prev = points[i - 1];
        const next = points[i + 1];
        const dx = next.x - prev.x;
        const dy = next.y - prev.y;
        const len = Math.hypot(dx, dy) || 1;
        return { x: dx / len, y: dy / len };
    });

    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i];
        const p1 = points[i + 1];
        const segLen = Math.max(NOODLE_EDGE_MIN_CONTROL, Math.hypot(p1.x - p0.x, p1.y - p0.y) / 3);
        const c1 = { x: p0.x + tangents[i].x * segLen, y: p0.y + tangents[i].y * segLen };
        const c2 = { x: p1.x - tangents[i + 1].x * segLen, y: p1.y - tangents[i + 1].y * segLen };
        d += ` C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p1.x} ${p1.y}`;
    }
    return d;
}

/** The no-waypoints case: one cubic bezier, control points pushed straight out horizontally. */
function noodleSimpleBezierD(a, b, controlOffset) {
    const offset = controlOffset || Math.max(NOODLE_EDGE_MIN_CONTROL, Math.abs(b.x - a.x) * 0.5);
    const c1 = { x: a.x + offset, y: a.y };
    const c2 = { x: b.x - offset, y: b.y };
    return `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`;
}

/** Arrowhead polygon points for an edge arriving horizontally at `entryPoint`. */
function noodleEdgeArrowPoints(entryPoint, size) {
    const s = size || 8;
    const { x, y } = entryPoint;
    return `${x},${y} ${x - s},${y - s * 0.6} ${x - s},${y + s * 0.6}`;
}

/**
 * The visual midpoint of a full (possibly multi-segment) edge -- where a
 * selection handle, cut button, or dependency-count badge (#986) sits.
 * Picks the midpoint of whichever segment is closest to the halfway point
 * along the whole chain, then evaluates that cubic bezier at t=0.5.
 */
function noodleEdgeMidpoint(points, controlOffset) {
    if (!points || points.length < 2) return { x: 0, y: 0 };
    if (points.length === 2) {
        const offset = controlOffset || Math.max(NOODLE_EDGE_MIN_CONTROL, Math.abs(points[1].x - points[0].x) * 0.5);
        const a = points[0], b = points[1];
        const c1 = { x: a.x + offset, y: a.y };
        const c2 = { x: b.x - offset, y: b.y };
        return {
            x: (a.x + 3 * c1.x + 3 * c2.x + b.x) / 8,
            y: (a.y + 3 * c1.y + 3 * c2.y + b.y) / 8,
        };
    }
    const mid = Math.floor((points.length - 1) / 2);
    return { x: (points[mid].x + points[mid + 1].x) / 2, y: (points[mid].y + points[mid + 1].y) / 2 };
}

// -- Line style: type carries meaning, colour is free (#985 scope) ----------

/**
 * `kind` is 'dependency' (solid -- a real scheduling dependency, whatever
 * its FS/SS/FF/SF type) or 'associative' (dashed -- a `[relates: ...]`
 * link with no scheduling effect, engine/tokeniser.js's `task.relates`).
 * Colour is deliberately not decided here -- the epic calls it "free
 * personal choice, expressive rather than semantic", so the caller picks
 * it; this only ever answers the one thing that *is* semantic, dash or not.
 */
function noodleEdgeStyle(kind) {
    return { dasharray: kind === 'associative' ? '6,3' : null };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        noodleEdgePorts,
        noodleEdgePathD,
        noodleEdgeArrowPoints,
        noodleEdgeMidpoint,
        noodleEdgeStyle,
    };
}
