/**
 * Proof for #967's host-authoritative edit protocol (static/collab-ops.js).
 *
 * The three acceptance criteria in the issue are behavioural claims about
 * concurrent editing, and each has a test here that actually exercises the
 * claim rather than asserting a helper returns something:
 *
 *  - two participants editing *different* tasks never lose either edit
 *  - two participants editing the *same* task resolve deterministically
 *    (last write wins, host arrival order) and *visibly*
 *  - an op that no longer applies is rejected rather than landing on the
 *    wrong task
 *
 * The under-a-second-on-a-LAN criterion is a transport property of the
 * relay, not of this module; it is covered by the #963/#967 relay tests and
 * the live browser run, not here.
 *
 * Run with: node --test tests/test_collab_ops.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// plan-model.js is a UMD-style script that publishes itself on globalThis;
// collab-ops.js reads it from there (see its loadPlanModel). Importing it
// for side effects is what makes it available to the module under test.
import '../packages/noodle-web/src/noodle_web/static/plan-model.js';

const STATIC_DIR = new URL('../packages/noodle-web/src/noodle_web/static/', import.meta.url);

// task-tokenizer.js declares a top-level `const`, so importing it would not
// publish it anywhere plan-model.js can see. The browser loads it as a
// classic script, where it *is* a global -- evaluating it the same way here
// (the pattern tests/test_task_tokenizer.js already uses) is what makes
// these tests exercise the real task-line grammar rather than
// plan-model.js's name-only fallback. Without it the fallback leaves a
// trailing "50%" in the parsed name, and every assertion below would be
// testing something the browser never does.
vm.runInThisContext(
    readFileSync(new URL('task-tokenizer.js', STATIC_DIR), 'utf8') +
    '\nglobalThis.TaskLineTokenizer = TaskLineTokenizer;'
);

const {
    applyPlanOp,
    buildPlanSnapshot,
    describeConflict,
    isPlanOp,
    readPercent,
    writePercent,
} = await import('../packages/noodle-web/src/noodle_web/static/collab-ops.js');

const PLAN = [
    'Phase 1',
    '  Design API @alice 3d 50%',
    '  Build API @bob 5d 10%',
    'Phase 2',
    '  Ship it 1d',
    '',
].join('\n');

function op(fields) {
    return { type: 'plan_op', ...fields };
}

test('a snapshot names every task with its position, depth and progress', () => {
    const snapshot = buildPlanSnapshot(PLAN, 3);
    assert.equal(snapshot.type, 'plan_snapshot');
    assert.equal(snapshot.rev, 3);
    assert.deepEqual(
        snapshot.tasks.map((t) => [t.id, t.name, t.indent, t.percent]),
        [
            [0, 'Phase 1', 0, null],
            [1, 'Design API', 2, 50],
            [2, 'Build API', 2, 10],
            [3, 'Phase 2', 0, null],
            [4, 'Ship it', 2, null],
        ]
    );
    assert.equal(snapshot.tasks[0].has_children, true);
    assert.equal(snapshot.tasks[1].has_children, false);
});

test('percent is read and written without disturbing the rest of the line', () => {
    assert.equal(readPercent('  Design API @alice 3d 50%'), 50);
    assert.equal(readPercent('  Ship it 1d'), null);
    // Rewritten in place, so @alice and 3d keep their positions.
    assert.equal(writePercent('  Design API @alice 3d 50%', 75), '  Design API @alice 3d 75%');
    assert.equal(writePercent('  Ship it 1d', 20), '  Ship it 1d 20%');
    // Out-of-range values are clamped rather than written as nonsense.
    assert.equal(writePercent('  Ship it 1d', 140), '  Ship it 1d 100%');
    assert.equal(writePercent('  Ship it 1d', -5), '  Ship it 1d 0%');
});

test('a percent inside a quoted comment is prose, not progress', () => {
    // The tokenizer treats quoted spans as free text; so must we, or a note
    // like "cut 50% of scope" would be silently rewritten as the task's
    // progress.
    const line = '  Design API "cut 50% of scope" 3d';
    assert.equal(readPercent(line), null);
    assert.equal(writePercent(line, 25), '  Design API "cut 50% of scope" 3d 25%');
});

test('set_percent edits only its own task and keeps the plan byte-identical elsewhere', () => {
    const result = applyPlanOp(PLAN, op({ op: 'set_percent', id: 1, expect: 'Design API', value: 75 }));
    assert.equal(result.ok, true);
    assert.equal(result.previous, 50);
    const lines = result.text.split('\n');
    assert.equal(lines[1], '  Design API @alice 3d 75%');
    // Every other line untouched -- Markdown stays canonical.
    assert.deepEqual([lines[0], lines[2], lines[3], lines[4]], ['Phase 1', '  Build API @bob 5d 10%', 'Phase 2', '  Ship it 1d']);
});

test('rename rewrites the name and leaves the metadata alone', () => {
    const result = applyPlanOp(PLAN, op({ op: 'rename', id: 2, expect: 'Build API', value: 'Build the API' }));
    assert.equal(result.ok, true);
    assert.equal(result.previous, 'Build API');
    assert.equal(result.text.split('\n')[2], '  Build the API @bob 5d 10%');
});

test('add_task appends under its parent as the last child', () => {
    const result = applyPlanOp(PLAN, op({ op: 'add_task', parent_id: 0, expect: 'Phase 1', name: 'Write tests' }));
    assert.equal(result.ok, true);
    const lines = result.text.split('\n');
    assert.deepEqual(lines.slice(0, 4), ['Phase 1', '  Design API @alice 3d 50%', '  Build API @bob 5d 10%', '  Write tests']);
    // It really is a child of Phase 1, not a sibling that merely looks indented.
    const snapshot = buildPlanSnapshot(result.text, 1);
    assert.equal(snapshot.tasks[3].name, 'Write tests');
    assert.equal(snapshot.tasks[3].indent, 2);
});

test('add_task with no parent appends at the end of the plan', () => {
    const result = applyPlanOp(PLAN, op({ op: 'add_task', parent_id: null, name: 'Phase 3' }));
    assert.equal(result.ok, true);
    const snapshot = buildPlanSnapshot(result.text, 1);
    assert.equal(snapshot.tasks[snapshot.tasks.length - 1].name, 'Phase 3');
    assert.equal(snapshot.tasks[snapshot.tasks.length - 1].indent, 0);
});

test('move reorders a task and carries its subtree with it', () => {
    const result = applyPlanOp(PLAN, op({ op: 'move', id: 3, expect: 'Phase 2', target_id: 0, position: 'before' }));
    assert.equal(result.ok, true);
    const snapshot = buildPlanSnapshot(result.text, 1);
    assert.deepEqual(snapshot.tasks.map((t) => t.name), ['Phase 2', 'Ship it', 'Phase 1', 'Design API', 'Build API']);
});

test('a move into a task\'s own subtree is refused, not applied', () => {
    // Allowing this would detach the whole branch from the document.
    const result = applyPlanOp(PLAN, op({ op: 'move', id: 0, expect: 'Phase 1', target_id: 1, position: 'child' }));
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'invalid');
});

// -- acceptance criterion: different tasks never lose either edit ----------

test('two participants editing different tasks both keep their edit', () => {
    // Applied in host arrival order, exactly as the relay would.
    const first = applyPlanOp(PLAN, op({ op: 'set_percent', id: 1, expect: 'Design API', value: 90 }));
    const second = applyPlanOp(first.text, op({ op: 'set_percent', id: 2, expect: 'Build API', value: 30 }));
    assert.equal(second.ok, true);

    const snapshot = buildPlanSnapshot(second.text, 2);
    assert.equal(snapshot.tasks[1].percent, 90, "the first participant's edit survived");
    assert.equal(snapshot.tasks[2].percent, 30, "the second participant's edit survived");
});

test('interleaved edits to different tasks survive in either arrival order', () => {
    const aThenB = applyPlanOp(
        applyPlanOp(PLAN, op({ op: 'rename', id: 1, expect: 'Design API', value: 'Design' })).text,
        op({ op: 'set_percent', id: 2, expect: 'Build API', value: 30 })
    );
    const bThenA = applyPlanOp(
        applyPlanOp(PLAN, op({ op: 'set_percent', id: 2, expect: 'Build API', value: 30 })).text,
        op({ op: 'rename', id: 1, expect: 'Design API', value: 'Design' })
    );
    // Order of independent edits must not change the result.
    assert.equal(aThenB.text, bThenA.text);
});

// -- acceptance criterion: same task resolves deterministically and visibly --

test('two participants editing the same task resolve last-write-wins', () => {
    const first = applyPlanOp(PLAN, op({ op: 'set_percent', id: 1, expect: 'Design API', value: 60 }));
    const second = applyPlanOp(first.text, op({ op: 'set_percent', id: 1, expect: 'Design API', value: 80 }));

    assert.equal(buildPlanSnapshot(second.text, 2).tasks[1].percent, 80, 'the later op wins');
    assert.equal(second.previous, 60, 'and it reports exactly what it displaced');
});

test('a superseded edit is reported, not lost silently', () => {
    const second = applyPlanOp(PLAN, op({ op: 'set_percent', id: 1, expect: 'Design API', value: 80 }));
    const notice = describeConflict(
        op({ op: 'set_percent', id: 1, value: 80 }),
        second.previous,
        'Bob'
    );
    assert.match(notice, /Bob also edited this/);
    assert.match(notice, /50%/, 'the notice says what the value was before');
});

test('agreeing on the same value is not reported as a conflict', () => {
    // Both participants set 50%, which is already the value -- nothing was
    // displaced, so nagging about a conflict would be noise.
    const result = applyPlanOp(PLAN, op({ op: 'set_percent', id: 1, expect: 'Design API', value: 50 }));
    assert.equal(describeConflict(op({ op: 'set_percent', id: 1, value: 50 }), result.previous, 'Bob'), null);
});

// -- staleness -------------------------------------------------------------

test('an op naming a task that has since changed is rejected, not misapplied', () => {
    // Someone moved Phase 2 to the top, so id 1 is no longer "Design API".
    const moved = applyPlanOp(PLAN, op({ op: 'move', id: 3, expect: 'Phase 2', target_id: 0, position: 'before' }));
    const stale = applyPlanOp(moved.text, op({ op: 'set_percent', id: 1, expect: 'Design API', value: 99 }));

    assert.equal(stale.ok, false);
    assert.equal(stale.reason, 'stale');
    // Critically, the task that *does* sit at id 1 was left alone.
    assert.equal(buildPlanSnapshot(moved.text, 1).tasks[1].name, 'Ship it');
    assert.equal(readPercent(moved.text.split('\n')[1]), null);
});

test('an op naming a task id that no longer exists is rejected', () => {
    const result = applyPlanOp(PLAN, op({ op: 'set_percent', id: 99, expect: 'Nope', value: 10 }));
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'unknown_task');
});

// -- malformed input -------------------------------------------------------

test('malformed ops are rejected rather than throwing', () => {
    // These arrive over the network from a joiner; a bad one must not be
    // able to take down the host's session.
    for (const bad of [
        null,
        undefined,
        'not an object',
        {},
        { type: 'plan_op' },
        { type: 'plan_op', op: 'drop_database', id: 0 },
        { type: 'not_an_op', op: 'set_percent', id: 0 },
        op({ op: 'set_percent', id: 1, expect: 'Design API', value: 'abc' }),
        op({ op: 'rename', id: 1, expect: 'Design API', value: '   ' }),
        op({ op: 'add_task', parent_id: 0, name: '' }),
        op({ op: 'move', id: 1, expect: 'Design API', target_id: 2, position: 'sideways' }),
    ]) {
        const result = applyPlanOp(PLAN, bad);
        assert.equal(result.ok, false, `expected rejection for ${JSON.stringify(bad)}`);
    }
});

test('isPlanOp accepts only the four real op kinds', () => {
    for (const kind of ['set_percent', 'rename', 'add_task', 'move']) {
        assert.equal(isPlanOp(op({ op: kind })), true);
    }
    assert.equal(isPlanOp(op({ op: 'delete_everything' })), false);
    assert.equal(isPlanOp({ type: 'plan_snapshot', op: 'rename' }), false);
});

test('an unchanged plan round-trips byte for byte', () => {
    // A rejected op must leave the document exactly as it was, and an
    // applied one must not reformat anything it did not touch.
    assert.equal(applyPlanOp(PLAN, op({ op: 'set_percent', id: 99, value: 1 })).ok, false);
    const applied = applyPlanOp(PLAN, op({ op: 'set_percent', id: 1, expect: 'Design API', value: 50 }));
    assert.equal(applied.text, PLAN, 'setting the value it already had changes nothing');
});
