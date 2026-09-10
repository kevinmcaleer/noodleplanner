/**
 * Tests for the Noodle view's semantic zoom helpers (issue #986):
 * crossing-edge counts (the "N links" badge), the buried-detail marker's
 * internal-cycle check, and the badge label formatting.
 *
 * Run with: node tests/test_noodle_zoom.js
 */

const path = require('path');
const mod = require(path.join(__dirname, '..', 'packages', 'noodle-web',
    'src', 'noodle_web', 'static', 'noodle-zoom.js'));

const { noodleCountCrossingEdges, noodleBadgeLabel, noodleHasInternalCycle, noodleBuriedDetail } = mod;

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

// -- Crossing edges / badge -----------------------------------------------------

{
    // A 100-task plan rolling up into ~8 clean summary nodes: only the
    // edges that actually leave the group should count.
    const insideKeys = new Set(['design', 'build', 'test']);
    const edges = [
        { from: 'kickoff', to: 'design' },       // crosses in
        { from: 'design', to: 'build' },         // internal -- not a crossing
        { from: 'build', to: 'test' },           // internal -- not a crossing
        { from: 'test', to: 'launch' },          // crosses out
        { from: 'test', to: 'training' },        // crosses out
    ];
    const counts = noodleCountCrossingEdges(edges, insideKeys);
    assertEqual(counts, { incoming: 1, outgoing: 2, total: 3 }, 'only edges with exactly one end inside the group count as crossing');
}

{
    const insideKeys = new Set(['a', 'b']);
    const edges = [{ from: 'a', to: 'b' }]; // wholly internal
    assertEqual(noodleCountCrossingEdges(edges, insideKeys), { incoming: 0, outgoing: 0, total: 0 }, 'a wholly-internal edge never crosses the boundary');
}

assertEqual(noodleBadgeLabel(0), null, 'zero crossing edges gets no badge');
assertEqual(noodleBadgeLabel(1), '1 link', 'singular badge label');
assertEqual(noodleBadgeLabel(3), '3 links', 'plural badge label');

// -- Internal cycle (buried detail) ----------------------------------------------

{
    const insideKeys = new Set(['a', 'b', 'c']);
    const cyclic = [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }];
    assert(noodleHasInternalCycle(cyclic, insideKeys), 'a genuine cycle wholly inside the group is detected');

    const acyclic = [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }];
    assert(!noodleHasInternalCycle(acyclic, insideKeys), 'a simple chain is not flagged as a cycle');
}

{
    // A cycle that only closes via a node *outside* the group must not be
    // reported -- the epic's point is that this marker is about detail
    // buried specifically inside the collapsed node.
    const insideKeys = new Set(['a', 'b']);
    const edges = [{ from: 'a', to: 'b' }, { from: 'b', to: 'outside' }, { from: 'outside', to: 'a' }];
    assert(!noodleHasInternalCycle(edges, insideKeys), 'a cycle that only closes through an outside node is not an internal cycle');
}

// -- Buried detail marker ---------------------------------------------------------

{
    const insideKeys = new Set(['a', 'b', 'c']);
    const cyclic = [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }];
    const detail = noodleBuriedDetail(cyclic, insideKeys);
    assert(detail.buried, 'an internal cycle alone is enough to flag buried detail');
    assert(detail.reasons.includes('dependency loop'), 'the reason names the dependency loop');
}

{
    const insideKeys = new Set(['a', 'b']);
    const clean = [{ from: 'a', to: 'b' }];
    const settled = noodleBuriedDetail(clean, insideKeys);
    assertEqual(settled, { buried: false, reasons: [] }, 'nothing buried when there is no cycle and no caller-supplied signal');

    const flagged = noodleBuriedDetail(clean, insideKeys, { hasAtRiskDescendant: true });
    assert(flagged.buried, 'a caller-supplied at-risk signal alone is also enough to flag buried detail');
    assert(flagged.reasons.includes('at-risk task'), 'the reason names the at-risk task');
}

console.log(failures === 0
    ? `\nAll tests passed.`
    : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
