/**
 * Pure-logic tests for #967's host-authoritative plan-editing protocol
 * (packages/noodle-web/src/noodle_web/static/collab-plan-ops.js), the same
 * "extract the DOM-free logic and test it head-on" pattern used elsewhere
 * in this app (computeRagRollup(), aggregateEscalatedRaidItems(), and --
 * most directly relevant here -- test_plan_model.mjs for the parse-once
 * model this protocol applies ops against).
 *
 *   node --test tests/test_collab_plan_ops.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import planModel from '../packages/noodle-web/src/noodle_web/static/plan-model.js';

// plan-model.js's task metadata (name/percent/duration/...) comes from
// TaskLineTokenizer when it's loaded (a classic, non-module script -- see
// static/task-tokenizer.js) and falls back to a much cruder regex
// otherwise (which doesn't extract `percent` at all). In the browser both
// files are plain <script> tags sharing one global lexical scope; in Node
// there's no such thing, so lift it into a vm sandbox and expose it as a
// real global, the same technique tests/test_kanban_label_drop_refresh.mjs
// already uses for the same file.
const tokenizerSource = readFileSync(
    new URL('../packages/noodle-web/src/noodle_web/static/task-tokenizer.js', import.meta.url),
    'utf8'
);
const tokenizerSandbox = {};
vm.createContext(tokenizerSandbox);
vm.runInContext(`${tokenizerSource}\nthis.TaskLineTokenizer = TaskLineTokenizer;`, tokenizerSandbox);
globalThis.TaskLineTokenizer = tokenizerSandbox.TaskLineTokenizer;

// collab-plan-ops.js looks up the parse-once model via the same
// `typeof NoodlePlanModel !== 'undefined'` global-lookup convention
// plan-model.js itself uses for TaskLineTokenizer -- see that module's
// docstring. Set it up once, before importing collab-plan-ops.js.
globalThis.NoodlePlanModel = planModel;
const collabPlanOps = (await import('../packages/noodle-web/src/noodle_web/static/collab-plan-ops.js')).default;

const { applyPlanOp, buildPlanSnapshot, diffChangedTasks, ConflictTracker, taskLevel, findTask } = collabPlanOps;
const { PlanModel } = planModel;

const SAMPLE = [
    'Phase A',
    '  Task One 2d 20%',
    '  Task Two 3d',
    'Phase B',
    '  Task Three 1d',
    '',
].join('\n');

test('taskLevel matches plan-model.js findByName\'s own level scheme', () => {
    assert.equal(taskLevel(0), 1);
    assert.equal(taskLevel(2), 2);
    assert.equal(taskLevel(4), 3);
});

test('set_progress updates only the targeted task\'s percent', () => {
    const result = applyPlanOp(SAMPLE, {
        kind: 'plan_op', op: 'set_progress', task: { name: 'Task One', level: 2 }, value: 55,
    });
    assert.equal(result.ok, true);
    const model = PlanModel.parse(result.text);
    assert.equal(model.findByName('Task One', 2).content.includes('55%'), true);
    assert.equal(model.findByName('Task One', 2).content.includes('20%'), false);
    // untouched sibling
    assert.equal(model.findByName('Task Two', 2).content.includes('%'), false);
    assert.equal(model.findByName('Task Three', 2).content, 'Task Three 1d');
});

test('set_progress clamps out-of-range values and rejects non-numeric ones', () => {
    const over = applyPlanOp(SAMPLE, { op: 'set_progress', task: { name: 'Task One', level: 2 }, value: 500 });
    assert.equal(over.ok, true);
    assert.equal(PlanModel.parse(over.text).findByName('Task One', 2).content.includes('100%'), true);

    const bad = applyPlanOp(SAMPLE, { op: 'set_progress', task: { name: 'Task One', level: 2 }, value: 'not-a-number' });
    assert.equal(bad.ok, false);
    assert.equal(bad.text, SAMPLE);
});

test('mark_complete is sugar for set_progress 100', () => {
    const result = applyPlanOp(SAMPLE, { op: 'mark_complete', task: { name: 'Task Two', level: 2 } });
    assert.equal(result.ok, true);
    assert.equal(PlanModel.parse(result.text).findByName('Task Two', 2).content.includes('100%'), true);
});

test('set_name renames only the targeted task, elsewhere in the outline untouched', () => {
    const result = applyPlanOp(SAMPLE, { op: 'set_name', task: { name: 'Phase A', level: 1 }, name: 'Phase Alpha' });
    assert.equal(result.ok, true);
    const model = PlanModel.parse(result.text);
    assert.ok(model.findByName('Phase Alpha', 1));
    assert.equal(model.findByName('Phase A', 1), null);
    assert.ok(model.findByName('Task One', 2)); // children preserved, unrenamed
});

test('add_task under a summary task inserts a new child leaf, round-tripping the rest', () => {
    const result = applyPlanOp(SAMPLE, {
        op: 'add_task', parent: { name: 'Phase A', level: 1 }, name: 'Task Zero', position: 'top',
    });
    assert.equal(result.ok, true);
    const model = PlanModel.parse(result.text);
    const phaseA = model.findByName('Phase A', 1);
    assert.equal(phaseA.children.map((c) => c.name).join(','), 'Task Zero,Task One,Task Two');
    // Everything else in the plan is untouched.
    assert.ok(model.findByName('Phase B', 1));
    assert.ok(model.findByName('Task Three', 2));
});

test('add_task with no parent appends a new root-level task', () => {
    const result = applyPlanOp(SAMPLE, { op: 'add_task', parent: null, name: 'Phase C' });
    assert.equal(result.ok, true);
    const model = PlanModel.parse(result.text);
    assert.equal(model.roots.map((t) => t.name).join(','), 'Phase A,Phase B,Phase C');
});

test('add_task fails cleanly when the named parent does not exist', () => {
    const result = applyPlanOp(SAMPLE, { op: 'add_task', parent: { name: 'No Such Phase', level: 1 }, name: 'X' });
    assert.equal(result.ok, false);
    assert.equal(result.text, SAMPLE);
});

test('reorder_task moves a task up/down among its siblings only', () => {
    const down = applyPlanOp(SAMPLE, { op: 'reorder_task', task: { name: 'Task One', level: 2 }, direction: 'down' });
    assert.equal(down.ok, true);
    let model = PlanModel.parse(down.text);
    let phaseA = model.findByName('Phase A', 1);
    assert.equal(phaseA.children.map((c) => c.name).join(','), 'Task Two,Task One');

    // Already at the top -- moving further up is a harmless no-op failure.
    const stuck = applyPlanOp(SAMPLE, { op: 'reorder_task', task: { name: 'Task One', level: 2 }, direction: 'up' });
    assert.equal(stuck.ok, false);
    assert.equal(stuck.text, SAMPLE);
});

test('two ops for two different tasks both apply cleanly when applied in sequence', () => {
    const first = applyPlanOp(SAMPLE, { op: 'set_progress', task: { name: 'Task One', level: 2 }, value: 90 });
    const second = applyPlanOp(first.text, { op: 'mark_complete', task: { name: 'Task Three', level: 2 } });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    const model = PlanModel.parse(second.text);
    assert.equal(model.findByName('Task One', 2).content.includes('90%'), true);
    assert.equal(model.findByName('Task Three', 2).content.includes('100%'), true);
    // Neither op disturbed the other's task.
    assert.equal(model.findByName('Task Two', 2).content.includes('%'), false);
});

test('unknown op type and a missing target task are rejected without mutating the text', () => {
    const unknownOp = applyPlanOp(SAMPLE, { op: 'delete_universe', task: { name: 'Task One', level: 2 } });
    assert.equal(unknownOp.ok, false);
    assert.equal(unknownOp.text, SAMPLE);

    const missingTask = applyPlanOp(SAMPLE, { op: 'set_progress', task: { name: 'Nope', level: 2 }, value: 10 });
    assert.equal(missingTask.ok, false);
    assert.equal(missingTask.text, SAMPLE);
});

test('buildPlanSnapshot reflects percent and structure', () => {
    const snapshot = buildPlanSnapshot(SAMPLE);
    const taskOne = snapshot.find((t) => t.name === 'Task One');
    assert.equal(taskOne.percent, 20);
    assert.equal(taskOne.level, 2);
    const phaseA = snapshot.find((t) => t.name === 'Phase A');
    assert.equal(phaseA.is_summary, true);
    assert.equal(snapshot.find((t) => t.name === 'Task Three').is_summary, false);
});

test('diffChangedTasks reports only tasks whose percent moved', () => {
    const before = buildPlanSnapshot(SAMPLE);
    const after = buildPlanSnapshot(applyPlanOp(SAMPLE, {
        op: 'set_progress', task: { name: 'Task Two', level: 2 }, value: 75,
    }).text);
    const changed = diffChangedTasks(before, after);
    assert.deepEqual(changed, [{ name: 'Task Two', level: 2 }]);
});

test('ConflictTracker: same actor re-editing a task is never a conflict', () => {
    const tracker = new ConflictTracker(5000);
    const ref = { name: 'Task One', level: 2 };
    assert.equal(tracker.record(ref, 'Alice', 1000), null);
    assert.equal(tracker.record(ref, 'Alice', 1500), null);
});

test('ConflictTracker: a different actor editing the same task within the window is a conflict', () => {
    const tracker = new ConflictTracker(5000);
    const ref = { name: 'Task One', level: 2 };
    assert.equal(tracker.record(ref, 'Alice', 1000), null);
    const conflict = tracker.record(ref, 'Bob', 3000);
    assert.ok(conflict);
    assert.equal(conflict.previous_actor, 'Alice');
    assert.equal(conflict.actor, 'Bob');
    assert.equal(conflict.task.name, 'Task One');
    assert.match(conflict.message, /Bob also edited this/);
});

test('ConflictTracker: a different actor editing well outside the window is not a conflict', () => {
    const tracker = new ConflictTracker(5000);
    const ref = { name: 'Task One', level: 2 };
    tracker.record(ref, 'Alice', 1000);
    assert.equal(tracker.record(ref, 'Bob', 10000), null);
});

test('ConflictTracker tracks tasks independently', () => {
    const tracker = new ConflictTracker(5000);
    tracker.record({ name: 'Task One', level: 2 }, 'Alice', 1000);
    // A different task, same window -- no conflict.
    assert.equal(tracker.record({ name: 'Task Two', level: 2 }, 'Bob', 1200), null);
});

test('findTask resolves the same task plan-model.js\'s findByName would', () => {
    const model = PlanModel.parse(SAMPLE);
    const found = findTask(model, { name: 'Task Two', level: 2 });
    assert.equal(found, model.findByName('Task Two', 2));
    assert.equal(findTask(model, { name: 'Does Not Exist', level: 1 }), null);
});
