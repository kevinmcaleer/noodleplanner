/**
 * Tests for the Noodle view's layout engine (issue #984): seeded
 * determinism, pins, front-matter config, restlessness, and the spring
 * relaxation itself (taut chains go straight, local disturbance leaves the
 * rest of the board alone).
 *
 * Run with: node tests/test_noodle_layout.js
 */

const path = require('path');
const mod = require(path.join(__dirname, '..', 'packages', 'noodle-web',
    'src', 'noodle_web', 'static', 'noodle-layout.js'));

const {
    noodleHash32, noodleSeededPoint, noodleIsValidPin, noodlePinnedPoint,
    noodleFrontMatterNumber, noodleExplicitEstimateNames, noodleRestlessness,
    noodleColumnsOf, noodleComputeLayout,
} = mod;

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
function assertClose(actual, expected, msg, eps = 1e-6) {
    assert(Math.abs(actual - expected) < eps, `${msg} (actual=${actual}, expected=${expected})`);
}

// -- Deterministic hashing / seeding -----------------------------------------

assertEqual(noodleHash32('Design'), noodleHash32('Design'), 'hash32 is a pure function of its input');
assert(noodleHash32('Design') !== noodleHash32('design'), 'hash32 is case-sensitive (name identity, not display casing)');

{
    const p1 = noodleSeededPoint('Build the thing', 3, { width: 600, height: 400 });
    const p2 = noodleSeededPoint('Build the thing', 3, { width: 600, height: 400 });
    assertEqual(p1, p2, 'the same name and outline index always seed to the same point');
    assert(p1.x >= 0 && p1.x <= 600 && p1.y >= 0 && p1.y <= 400, 'a seeded point stays within bounds');
}
{
    const a = noodleSeededPoint('Task A', 0, { width: 600, height: 400 });
    const b = noodleSeededPoint('Task B', 0, { width: 600, height: 400 });
    assert(a.x !== b.x || a.y !== b.y, 'different names seed to different points');
}

// -- Pins ---------------------------------------------------------------------

assert(noodleIsValidPin('top-right'), 'top-right is a recognised pin');
assert(noodleIsValidPin('CENTER'), 'pin matching is case-insensitive');
assert(!noodleIsValidPin('north-east'), 'an unrecognised corner is not a valid pin');
assert(!noodleIsValidPin(undefined), 'no pin is not a valid pin');

{
    const bounds = { width: 600, height: 400 };
    const tr = noodlePinnedPoint('top-right', bounds, 30);
    assertClose(tr.x, 570, 'top-right pin sits near the right edge');
    assertClose(tr.y, 30, 'top-right pin sits near the top edge');
    const center = noodlePinnedPoint('center', bounds, 30);
    assertClose(center.x, 300, 'center pin sits at the horizontal middle');
    assertClose(center.y, 200, 'center pin sits at the vertical middle');
}

// -- Front matter config -------------------------------------------------------

{
    const plan = '---\ntitle: Demo\nnoodle_max_distance: 320\n---\n\nDesign 3d\n';
    assertEqual(noodleFrontMatterNumber(plan, 'noodle_max_distance', 260), 320, 'reads a numeric front-matter key');
    assertEqual(noodleFrontMatterNumber(plan, 'noodle-max-distance', 260), 320, 'accepts a hyphenated variant of the same key');
    assertEqual(noodleFrontMatterNumber(plan, 'missing_key', 99), 99, 'falls back when the key is absent');
    assertEqual(noodleFrontMatterNumber('No front matter here', 'noodle_max_distance', 42), 42, 'falls back when there is no front matter at all');
}

// -- Restlessness ---------------------------------------------------------------

{
    const plan = 'Design 3d @kev\nBuild [depends: Design]\n';
    const explicit = noodleExplicitEstimateNames(plan);
    assert(explicit.has('design'), 'a task with an explicit duration is recorded as having an estimate');
    assert(!explicit.has('build'), 'a task with no duration/effort token is not recorded');
}

{
    const settled = noodleRestlessness({ name: 'Design', resources: 'Kev' }, { hasExplicitEstimate: true, connectionCount: 2 });
    assertEqual(settled, 0, 'a task with an estimate, an owner, and a connection is perfectly settled');

    const restless = noodleRestlessness({ name: 'Orphan', resources: '' }, { hasExplicitEstimate: false, connectionCount: 0 });
    assert(restless > 0.5, 'a task missing an estimate, an owner and any connection is strongly restless');

    const summary = noodleRestlessness({ name: 'Phase 1', summary: true, resources: '' }, { hasExplicitEstimate: false, connectionCount: 0 });
    assertEqual(summary, 0, 'a summary task is never restless -- it has no estimate/owner of its own to miss');
}

// -- Columns (topological, dependency-order fallback) ---------------------------

{
    const tasks = [
        { name: 'Design' },
        { name: 'Build', depends: ['Design'] },
        { name: 'Test', depends: ['Build'] },
        { name: 'Docs' }, // unconnected
    ];
    const byName = new Map(tasks.map((t) => [t.name.toLowerCase(), t]));
    const cols = noodleColumnsOf(tasks, byName);
    assertEqual(cols.get('design'), 0, 'a root task sits in column 0');
    assertEqual(cols.get('build'), 1, 'a direct successor sits one column over');
    assertEqual(cols.get('test'), 2, 'a chain of dependencies keeps advancing the column');
    assertEqual(cols.get('docs'), 0, 'an unconnected task defaults to column 0');
}

// -- Full layout: taut chains, pins, local disturbance ---------------------------

{
    // A straight dependency chain should settle onto (very close to) one
    // horizontal line -- "the critical path reads as the longest taut
    // thread" -- regardless of how far apart its seeded starting y's were.
    const tasks = [
        { name: 'A' },
        { name: 'B', depends: ['A'] },
        { name: 'C', depends: ['B'] },
        { name: 'D', depends: ['C'] },
    ];
    const { positions } = noodleComputeLayout(tasks, { iterations: 120 });
    const ys = ['a', 'b', 'c', 'd'].map((k) => positions[k].y);
    const spread = Math.max(...ys) - Math.min(...ys);
    assert(spread < 5, `a taut dependency chain settles onto ~one line (spread=${spread})`);
    // And the x axis still advances left to right with the chain.
    assert(positions.a.x < positions.b.x && positions.b.x < positions.c.x && positions.c.x < positions.d.x,
        'x strictly advances along the dependency chain');
}

{
    // A pinned task never moves, however hard its neighbours pull.
    const tasks = [
        { name: 'Anchor', pin: 'top-right' },
        { name: 'Puller', depends: ['Anchor'] },
    ];
    const { positions } = noodleComputeLayout(tasks, { iterations: 80 });
    assert(positions.anchor.pinned, 'a task with a valid [pin: ...] tag is reported pinned');
    // Check it didn't drift with the simulation (exact placement is noodlePinnedPoint's concern, tested above).
    const before = noodleComputeLayout(tasks, { iterations: 1 }).positions.anchor;
    const after = noodleComputeLayout(tasks, { iterations: 200 }).positions.anchor;
    assertEqual(before, after, 'a pinned node holds its position regardless of iteration count');
}

{
    // Local disturbance: everything outside the dirty neighbourhood should
    // barely move between two layout passes.
    const tasks = [
        { name: 'A' },
        { name: 'B', depends: ['A'] },
        { name: 'C', depends: ['B'] },
        { name: 'Unrelated' },
    ];
    const first = noodleComputeLayout(tasks, { iterations: 80 });
    const previous = new Map(Object.entries(first.positions).map(([k, p]) => [k, { x: p.x, y: p.y }]));

    const second = noodleComputeLayout(tasks, {
        iterations: 80, previous, dirty: new Set(['c']),
    });

    const unrelatedDrift = Math.abs(second.positions.unrelated.y - first.positions.unrelated.y);
    assert(unrelatedDrift < 1, `a node far from the dirty one barely moves on a local relayout (drift=${unrelatedDrift})`);
}

console.log(failures === 0
    ? `\nAll tests passed.`
    : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
