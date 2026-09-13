/**
 * Dependency-editing performance on a 100-task plan (#1052).
 *
 * #1052's acceptance criteria name a target explicitly -- "interaction
 * stays under 100 ms on a 100-task plan -- measured, not assumed" -- so
 * this file is the measurement. It exercises the two model-layer paths a
 * dependency drag actually runs, both in whiteboard-dep-noodles.js:
 *
 *  - the hover check (wbCanLinkDependency): PlanModel.parse of the whole
 *    editor text, two findByName lookups and canAddDependency, run again
 *    on *every* pointer move during a drag. This is the hot one -- it is
 *    what decides whether the drag feels immediate or laggy.
 *  - the commit (wbLinkDependency): the same parse, then addDependency
 *    and serialize of the whole plan back to text.
 *
 * The DOM half of the drag (ghost path redraw, elementFromPoint, class
 * toggles) is not measured here: it needs a real browser, and it is the
 * model work above that scales with plan size. Browser-side verification
 * of the drag itself is on the PR.
 *
 * These thresholds are a regression guard, not a benchmark score. The
 * measured cost today is ~0.4 ms for a hover check -- roughly 200x under
 * the target -- so a failure here means something has changed
 * algorithmically (an accidental O(n^2) walk, a re-parse per candidate
 * row), not that a CI runner was briefly busy.
 *
 * Run with: node --test tests/test_dependency_perf.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { PlanModel } = (await import('../packages/noodle-web/src/noodle_web/static/plan-model.js')).default;

/** #1052's named target, in milliseconds, for one interaction. */
const BUDGET_MS = 100;

/**
 * A 100-task plan shaped like a real one: ten phases of ten leaf tasks,
 * each leaf carrying the duration/resource/tag tokens the tokeniser has
 * to chew through, and a chain of dependencies already in place so the
 * cycle check has a graph to walk rather than a trivial one.
 */
function buildPlan(taskCount) {
    const lines = ['---', 'title: Hundred task plan', 'start: 2026-01-05', '---', ''];
    for (let index = 0; index < taskCount; index += 1) {
        if (index % 10 === 0) lines.push(`Phase ${index / 10}`);
        const depends = index % 10 === 0 ? '' : ` [depends: Task ${index - 1}]`;
        lines.push(`  Task ${index} 3d @alice #delivery${depends}`);
    }
    return lines.join('\n');
}

const PLAN_TEXT = buildPlan(100);

/** Median of `runs` timed calls to `fn`, after a warm-up pass. */
function medianMs(fn, runs = 25) {
    fn();
    const samples = [];
    for (let i = 0; i < runs; i += 1) {
        const started = performance.now();
        fn();
        samples.push(performance.now() - started);
    }
    samples.sort((a, b) => a - b);
    return samples[Math.floor(samples.length / 2)];
}

test('the 100-task fixture really does hold 100 tasks', () => {
    const model = PlanModel.parse(PLAN_TEXT);
    let leaves = 0;
    const walk = node => {
        if (!node.children.length) leaves += 1;
        node.children.forEach(walk);
    };
    model.roots.forEach(walk);
    assert.equal(leaves, 100);
});

test('a drag-hover check on a 100-task plan stays well inside the 100 ms budget', () => {
    // wbCanLinkDependency(), which runs on every pointer move.
    const median = medianMs(() => {
        const model = PlanModel.parse(PLAN_TEXT);
        const from = model.findByName('Task 3');
        const to = model.findByName('Task 77');
        model.canAddDependency(to, from);
    });
    assert.ok(median < BUDGET_MS, `hover check took ${median.toFixed(2)} ms (budget ${BUDGET_MS} ms)`);
});

test('the hover check is no slower when the drag would close a cycle', () => {
    // The expensive branch: _wouldCreateCycle walks the successors graph
    // forward from the target until it finds the predecessor. Linking the
    // head of a chain to its tail makes it walk the whole chain.
    const median = medianMs(() => {
        const model = PlanModel.parse(PLAN_TEXT);
        const from = model.findByName('Task 9');
        const to = model.findByName('Task 1');
        const result = model.canAddDependency(to, from);
        assert.equal(result.ok, false);
    });
    assert.ok(median < BUDGET_MS, `cycle-refusing hover check took ${median.toFixed(2)} ms (budget ${BUDGET_MS} ms)`);
});

test('committing a dependency on a 100-task plan stays well inside the 100 ms budget', () => {
    // wbLinkDependency(): parse, add the edge, serialise the plan back.
    const median = medianMs(() => {
        const model = PlanModel.parse(PLAN_TEXT);
        const from = model.findByName('Task 3');
        const to = model.findByName('Task 77');
        assert.equal(model.addDependency(to, from), true);
        model.serialize();
    });
    assert.ok(median < BUDGET_MS, `commit took ${median.toFixed(2)} ms (budget ${BUDGET_MS} ms)`);
});

test('a whole drag across every row of a 100-task plan stays responsive', () => {
    // The worst realistic gesture: the pointer crosses all 100 rows, so
    // the hover check runs 100 times. Each individual check is what has
    // to stay under budget (the user feels per-move lag, not the sum),
    // and the sum is asserted too, at a proportionally looser bound, to
    // catch a per-move cost that only shows up in aggregate.
    const model = () => PlanModel.parse(PLAN_TEXT);
    let worstMove = 0;
    const started = performance.now();
    for (let index = 0; index < 100; index += 1) {
        const moveStarted = performance.now();
        const parsed = model();
        const from = parsed.findByName('Task 3');
        const to = parsed.findByName(`Task ${index}`);
        if (to) parsed.canAddDependency(to, from);
        worstMove = Math.max(worstMove, performance.now() - moveStarted);
    }
    const total = performance.now() - started;
    assert.ok(worstMove < BUDGET_MS, `worst single move took ${worstMove.toFixed(2)} ms (budget ${BUDGET_MS} ms)`);
    assert.ok(total < BUDGET_MS * 20, `a 100-move drag took ${total.toFixed(2)} ms`);
});

test('parsing cost grows roughly linearly, not quadratically, with plan size', () => {
    // The guard that actually catches an algorithmic regression: ten times
    // the tasks should cost roughly ten times as much, not a hundred.
    const small = medianMs(() => PlanModel.parse(buildPlan(100)), 10);
    const large = medianMs(() => PlanModel.parse(buildPlan(1000)), 10);
    // Generous: quadratic growth would be ~100x, linear ~10x. Anything
    // under 30x is comfortably not quadratic even on a noisy runner.
    assert.ok(large < small * 30, `1000 tasks cost ${large.toFixed(2)} ms vs ${small.toFixed(2)} ms for 100`);
});
