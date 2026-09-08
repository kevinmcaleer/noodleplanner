/**
 * Tests for the Noodle view's edge renderer (issue #985): ports, the
 * simple port-to-port bezier, waypoint threading, and line style.
 *
 * Run with: node tests/test_noodle_edges.js
 */

const path = require('path');
const mod = require(path.join(__dirname, '..', 'packages', 'noodle-web',
    'src', 'noodle_web', 'static', 'noodle-edges.js'));

const { noodleEdgePorts, noodleEdgePathD, noodleEdgeArrowPoints, noodleEdgeMidpoint, noodleEdgeStyle } = mod;

let failures = 0;
function assert(condition, msg) {
    if (!condition) { failures++; console.error('FAIL:', msg); }
    else { console.log('PASS:', msg); }
}
function assertEqual(actual, expected, msg) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) {
        failures++;
        console.error('FAIL:', msg);
        console.error('  expected:', JSON.stringify(expected));
        console.error('  actual:  ', JSON.stringify(actual));
    } else {
        console.log('PASS:', msg);
    }
}

// -- Ports ----------------------------------------------------------------

{
    const rect = { x: 100, y: 50, width: 140, height: 44 };
    const ports = noodleEdgePorts(rect);
    assertEqual(ports.exit, { x: 240, y: 72 }, 'exit port is the right edge midpoint');
    assertEqual(ports.entry, { x: 100, y: 72 }, 'entry port is the left edge midpoint');
}

{
    // Same rect stacked directly above another -- ports are still right/left
    // mid, never top/bottom, so a vertical stack still gets a horizontal
    // exit/entry (#985: "Consistent entry/exit even when nodes are stacked
    // vertically").
    const above = { x: 100, y: 0, width: 140, height: 44 };
    const below = { x: 100, y: 200, width: 140, height: 44 };
    const portsAbove = noodleEdgePorts(above);
    const portsBelow = noodleEdgePorts(below);
    assertEqual(portsAbove.exit.y, 22, 'exit y is the node vertical midpoint, not an edge-picking heuristic');
    assertEqual(portsBelow.entry.y, 222, 'entry y likewise, however far below the source node sits');
}

// -- Simple bezier (no waypoints) -------------------------------------------

{
    const d = noodleEdgePathD([{ x: 0, y: 0 }, { x: 200, y: 100 }]);
    assert(d.startsWith('M 0 0'), 'path starts at the exit port');
    assert(d.includes('200 100'), 'path ends at the entry port');
    assert(/C /.test(d), 'a two-point path is a single cubic bezier');
}

{
    // Control points are pushed straight out horizontally from each port
    // (same y as the port itself), which is what gives the S-bend its
    // characteristic shape rather than a diagonal line.
    const a = { x: 0, y: 0 };
    const b = { x: 300, y: 150 };
    const d = noodleEdgePathD([a, b], 60);
    // "M 0 0 C 60 0, 240 150, 300 150"
    assertEqual(d, 'M 0 0 C 60 0, 240 150, 300 150', 'explicit control offset produces the expected S-bend control points');
}

// -- Waypoint threading -------------------------------------------------------

{
    const points = [{ x: 0, y: 0 }, { x: 100, y: 80 }, { x: 250, y: -40 }, { x: 400, y: 10 }];
    const d = noodleEdgePathD(points, 30);
    // One M plus three C segments (a cubic per consecutive pair of points).
    const segments = (d.match(/C /g) || []).length;
    assertEqual(segments, 3, 'threading through 2 waypoints produces 3 bezier segments');
    assert(d.startsWith('M 0 0'), 'the threaded path still starts at the exit port');
    assert(d.trim().endsWith('400 10'), 'the threaded path still ends at the entry port');
}

{
    // The very first control point must sit at the same y as the start
    // point (a horizontal exit), even when the first waypoint immediately
    // jogs up or down -- that's what "keeping the same horizontal port
    // entry and exit with gentle middle bends" means.
    const points = [{ x: 0, y: 0 }, { x: 50, y: 120 }, { x: 300, y: 120 }];
    const d = noodleEdgePathD(points, 40);
    const firstControl = /M 0 0 C (-?[\d.]+) (-?[\d.]+)/.exec(d);
    assert(firstControl, 'path has a first control point to inspect');
    assertEqual(Number(firstControl[2]), 0, 'the first control point stays at the exit port\'s y (horizontal exit)');
}

// -- Arrowhead + midpoint -----------------------------------------------------

{
    const points = noodleEdgeArrowPoints({ x: 100, y: 50 }, 8);
    assert(points.startsWith('100,50'), 'the arrow tip sits exactly on the entry point');
}

{
    const mid = noodleEdgeMidpoint([{ x: 0, y: 0 }, { x: 200, y: 0 }]);
    assertEqual(mid, { x: 100, y: 0 }, 'the midpoint of a flat edge is its literal centre');
}

// -- Line style: solid dependency, dashed associative --------------------------

assertEqual(noodleEdgeStyle('dependency').dasharray, null, 'a real dependency renders as a solid line');
assertEqual(noodleEdgeStyle('associative').dasharray, '6,3', 'an associative [relates: ...] link renders dashed');

console.log(failures === 0
    ? `\nAll tests passed.`
    : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
