/**
 * Tests for the whiteboard noodles' pure logic: deriving which links to
 * draw from the task hierarchy, choosing which note edges a noodle joins,
 * and the bezier path/arrow/midpoint geometry built from those anchors.
 *
 * Runs the real whiteboard-noodles.js in a sandbox (same vm-sandbox
 * pattern as tests/test_whiteboard_notes.js) and exercises only the pure,
 * DOM-free helpers -- the drag-to-link gesture, selection and the commit
 * path are covered by tests/test_whiteboard_structure.py instead.
 *
 * Run with: node tests/test_whiteboard_noodles.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'packages', 'noodle-web', 'src',
        'noodle_web', 'static', 'whiteboard-noodles.js'),
    'utf8'
);

let failures = 0;
function assert(condition, msg) {
    if (!condition) { failures++; console.error('FAIL:', msg); }
    else { console.log('PASS:', msg); }
}
function assertEqual(actual, expected, msg) {
    if (actual !== expected) {
        failures++;
        console.error('FAIL:', msg);
        console.error('  actual:   ' + JSON.stringify(actual));
        console.error('  expected: ' + JSON.stringify(expected));
    } else {
        console.log('PASS:', msg);
    }
}
function assertClose(actual, expected, msg, eps = 1e-6) {
    assert(Math.abs(actual - expected) < eps, `${msg} (actual=${actual}, expected=${expected})`);
}

const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const {
    wbNoodleId,
    wbNoodleLinksFor,
    wbNoodleAnchors,
    wbNoodlePathD,
    wbNoodleArrowPoints,
    wbNoodleMidpoint,
} = sandbox;

// ── Link derivation ──────────────────────────────────────────────────────

const tasks = [
    { name: 'Discovery', parent: '' },
    { name: 'Kick-off', parent: 'Discovery' },
    { name: 'Build', parent: 'Discovery' },
    { name: 'Design', parent: 'Build' },
    { name: 'Wireframes', parent: 'Design' },
    { name: 'Orphan', parent: 'Not On Board' },
];

{
    const rows = [{ task: 'Discovery' }, { task: 'Build' }, { task: 'Design' }];
    const links = wbNoodleLinksFor(rows, tasks);
    const pairs = links.map(l => `${l.parent}>${l.child}`);
    assertEqual(pairs.join(','), 'Discovery>Build,Build>Design',
        'a noodle is drawn only when BOTH ends have a note');
    assert(!pairs.some(p => p.includes('Kick-off')),
        'a child whose parent is on the board but which has no note of its own is not a noodle');
    assert(!pairs.some(p => p.includes('Wireframes')),
        'a child with a note whose parent has none is not a noodle');
    assert(!pairs.some(p => p.includes('Orphan')),
        'a child whose parent does not exist at all is not a noodle');
}

{
    // Rows are matched case-insensitively, like every other whiteboard row
    // lookup, but the link carries the row's own spelling for display.
    const links = wbNoodleLinksFor([{ task: 'discovery' }, { task: 'BUILD' }], tasks);
    assertEqual(links.length, 1, 'row matching is case-insensitive');
    assertEqual(links[0].parent, 'discovery', "the link keeps the row's own spelling");
    assertEqual(links[0].child, 'BUILD', "...for both ends");
}

{
    // A duplicate row (a hand-edited plan can have one) must not produce a
    // duplicate noodle -- two identical paths would double-darken the line
    // and give the user two overlapping click targets for one link.
    const links = wbNoodleLinksFor([{ task: 'Discovery' }, { task: 'Build' }, { task: 'build' }], tasks);
    assertEqual(links.length, 1, 'a duplicate row does not produce a duplicate noodle');
}

assertEqual(wbNoodleId('Build', 'Design'), 'build\u001fdesign', 'link ids are lower-cased');
assertEqual(wbNoodleId('build', 'DESIGN'), wbNoodleId('Build', 'Design'),
    'link ids are stable across spellings, so selection survives a re-render');
// Names may contain spaces, so a space separator would collide these two.
assert(wbNoodleId('Plan a', 'b') !== wbNoodleId('Plan', 'a b'),
    'ids for different link pairs never collide, even with spaces in names');

assertEqual(wbNoodleLinksFor(null, null).length, 0, 'null input yields no links, not a throw');
assertEqual(wbNoodleLinksFor([], tasks).length, 0, 'an empty board has no noodles');

// ── Anchor choice ────────────────────────────────────────────────────────

const box = (x, y) => ({ x, y, width: 100, height: 60 });

{
    // Target to the right -> leave the right edge, arrive at the left.
    const a = wbNoodleAnchors(box(0, 0), box(400, 0));
    assertEqual(a.axis, 'x', 'a horizontal pair curves along x');
    assertEqual(a.a.x, 100, 'leaves the source right edge');
    assertEqual(a.a.y, 30, '...at its vertical middle');
    assertEqual(a.b.x, 400, 'arrives at the target left edge');
}

{
    // Target to the left -> the mirrored pairing, not a loop round.
    const a = wbNoodleAnchors(box(400, 0), box(0, 0));
    assertEqual(a.axis, 'x', 'a right-to-left pair still curves along x');
    assertEqual(a.a.x, 400, 'leaves the source left edge');
    assertEqual(a.b.x, 100, 'arrives at the target right edge');
}

{
    // Target below -> vertical pairing.
    const a = wbNoodleAnchors(box(0, 0), box(0, 400));
    assertEqual(a.axis, 'y', 'a stacked pair curves along y');
    assertEqual(a.a.y, 60, 'leaves the source bottom edge');
    assertEqual(a.b.y, 400, 'arrives at the target top edge');
    assertEqual(a.a.x, 50, '...at its horizontal middle');
}

{
    const a = wbNoodleAnchors(box(0, 400), box(0, 0));
    assertEqual(a.axis, 'y', 'a bottom-to-top pair curves along y');
    assertEqual(a.a.y, 400, 'leaves the source top edge');
    assertEqual(a.b.y, 60, 'arrives at the target bottom edge');
}

// ── Path geometry ────────────────────────────────────────────────────────

{
    const anchors = wbNoodleAnchors(box(0, 0), box(400, 0));
    const d = wbNoodlePathD(anchors);
    assert(d.startsWith('M 100 30 C '), 'the path starts at the source anchor');
    assert(d.endsWith('400 30'), 'the path ends at the target anchor');
    assertEqual((d.match(/C/g) || []).length, 1, 'one cubic segment, not a polyline');

    // Control points bulge along x by 45% of the span (300 * 0.45 = 135).
    assert(d.includes('235 30'), 'the first control point is offset along the curve axis');
    assert(d.includes('265 30'), 'the second control point mirrors it');
}

{
    // Very close notes still get a visible curve rather than a flat line.
    const anchors = wbNoodleAnchors(box(0, 0), box(105, 0));
    const d = wbNoodlePathD(anchors);
    assert(d.includes('140 30'), 'a short span is floored at the minimum curve');
}

{
    // The midpoint is on the curve, and for a symmetric horizontal link it
    // is exactly halfway -- this is where the cut button sits, so it must
    // land on the line the user just clicked.
    const anchors = wbNoodleAnchors(box(0, 0), box(400, 0));
    const mid = wbNoodleMidpoint(anchors);
    assertClose(mid.x, 250, 'the cut button sits halfway along a symmetric link');
    assertClose(mid.y, 30, '...on the line itself');
}

{
    const anchors = wbNoodleAnchors(box(0, 0), box(0, 400));
    const mid = wbNoodleMidpoint(anchors);
    assertClose(mid.x, 50, 'a vertical link\'s midpoint is centred horizontally');
    assertClose(mid.y, 230, '...and halfway down');
}

{
    // Arrowhead: three points, tip exactly on the target anchor, pointing
    // into the note it arrives at.
    const anchors = wbNoodleAnchors(box(0, 0), box(400, 0));
    const pts = wbNoodleArrowPoints(anchors).split(' ').map(p => p.split(',').map(Number));
    assertEqual(pts.length, 3, 'the arrowhead is a triangle');
    assertEqual(pts[0][0], 400, 'its tip is on the target anchor');
    assertEqual(pts[0][1], 30, '...vertically too');
    assert(pts[1][0] < pts[0][0] && pts[2][0] < pts[0][0],
        'its base sits behind the tip, so it points into the target note');
}

{
    const anchors = wbNoodleAnchors(box(0, 0), box(0, 400));
    const pts = wbNoodleArrowPoints(anchors).split(' ').map(p => p.split(',').map(Number));
    assertEqual(pts[0][1], 400, 'a downward arrow tips at the target top edge');
    assert(pts[1][1] < pts[0][1] && pts[2][1] < pts[0][1], '...pointing down into it');
}

console.log(failures === 0 ? '\nAll whiteboard noodle tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
