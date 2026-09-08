import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import planModel from '../packages/noodle-web/src/noodle_web/static/plan-model.js';

const { PlanModel } = planModel;
const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

test('all real plans round-trip byte for byte through the model', () => {
    const paths = [
        ...readdirSync(join(repo, 'templates'), { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .map(entry => join(repo, 'templates', entry.name, 'plan.md')),
        ...readdirSync(join(repo, 'tests', 'fixtures', 'roundtrip'))
            .filter(name => name.endsWith('.md'))
            .map(name => join(repo, 'tests', 'fixtures', 'roundtrip', name)),
    ];
    for (const path of paths) {
        let text;
        try { text = readFileSync(path, 'utf8'); } catch { continue; }
        assert.equal(PlanModel.parse(text).serialize(), text, path);
    }
});

test('front matter, comments, CRLF and back matter remain opaque', () => {
    const text = '---\r\ntitle: Odd\r\n---\r\n// note\r\nPhase\r\n  A 1d\r\n\r\n---whiteboard---\r\n{"task":"A"}';
    const model = PlanModel.parse(text);
    assert.deepEqual(model.tasks.map(task => task.name), ['Phase', 'A']);
    assert.equal(model.serialize(), text);
});

test('unchanged tabs and mixed indentation round-trip exactly', () => {
    const text = 'Phase\n\tTabbed 1d\n   Three spaces 1d\n';
    assert.equal(PlanModel.parse(text).serialize(), text);
});

test('a bare divider before back matter is not parsed as a task', () => {
    const text = 'Task 1d\n---\n---whiteboard---\n| Task |\n';
    const model = PlanModel.parse(text);
    assert.deepEqual(model.tasks.map(task => task.name), ['Task']);
    assert.equal(model.serialize(), text);
});

test('dependencies are object edges and successors are graph queries', () => {
    const model = PlanModel.parse('Build $artifact 1d\nTest 1d [depends Build:SS +2d]\nShip 1d [depends $artifact]\n');
    const [build, verify, ship] = model.tasks;
    assert.equal(verify.dependencies[0].target, build);
    assert.equal(verify.dependencies[0].type, 'SS');
    assert.equal(verify.dependencies[0].lag, '+2d');
    assert.equal(ship.dependencies[0].target, build);
    assert.deepEqual(model.successorsOf(build), [verify, ship]);
});

test('star shorthand points to the preceding task object', () => {
    const model = PlanModel.parse('First 1d\n*Second 1d\n');
    assert.equal(model.tasks[1].dependencies[0].target, model.tasks[0]);
    assert.equal(model.tasks[1].dependencies[0].shorthand, true);
});

test('rename cascades through explicit dependency edges', () => {
    const model = PlanModel.parse('A 1d\nB 1d [depends A:SS +2d]\n');
    model.rename(model.tasks[0], 'Foundation');
    assert.equal(model.serialize(), 'Foundation 1d\nB 1d [depends Foundation:SS +2d]\n');
});

test('rename migrates Theme colours and whiteboard task rows', () => {
    const text = '---\nTheme:\n- Phase: #AABBCC\n---\nPhase\n  Work 1d\n---whiteboard---\n| Task | X |\n| --- | --- |\n| Phase | 10 |\n';
    const model = PlanModel.parse(text);
    model.rename(model.tasks[0], 'Delivery');
    const output = model.serialize();
    assert.match(output, /- Delivery: #AABBCC/);
    assert.match(output, /\| Delivery \| 10 \|/);
});

test('duplicate names keep distinct identities and last definition wins for lookup', () => {
    const model = PlanModel.parse('Same 1d\nSame 2d\nAfter 1d [depends Same]\n');
    assert.notEqual(model.tasks[0].id, model.tasks[1].id);
    assert.equal(model.tasks[2].dependencies[0].target, model.tasks[1]);
});

test('tree move carries descendants and never leaves splice blank lines', () => {
    const model = PlanModel.parse('One\n  Child 1d\n\nTwo 1d\n');
    const one = model.tasks[0];
    const two = model.tasks[2];
    assert.equal(model.moveAsChild(one, two, true), true);
    assert.equal(model.serialize(), 'Two 1d\n  One\n    Child 1d\n\n');
    assert.equal(one.parent, two);
    assert.equal(model.taskAt(0), two);
});

test('a node cannot be moved into its own descendant', () => {
    const model = PlanModel.parse('Parent\n  Child 1d\n');
    assert.equal(model.moveAsChild(model.tasks[0], model.tasks[1], true), false);
    assert.equal(model.serialize(), 'Parent\n  Child 1d\n');
});

// #967: addTask/reorderSibling were added for the collab-session live
// editing protocol (collab-plan-ops.js) to apply "add task"/"reorder task"
// intents without hand-rolling markdown text -- see that module's tests
// (test_collab_plan_ops.mjs) for the op-protocol level coverage; these
// cover the PlanModel API itself directly.

test('addTask appends a new root task, or a new child at top/bottom of a parent', () => {
    const model = PlanModel.parse('Phase\n  Existing 1d\n');
    const phase = model.tasks[0];

    const child = model.addTask('New Child', phase, 'top');
    assert.equal(child.parent, phase);
    assert.equal(phase.children.map(c => c.name).join(','), 'New Child,Existing');
    assert.equal(model.serialize(), 'Phase\n  New Child\n  Existing 1d\n');

    const root = model.addTask('New Root', null);
    assert.equal(root.parent, null);
    assert.equal(model.roots[model.roots.length - 1], root);
    assert.equal(model.serialize(), 'Phase\n  New Child\n  Existing 1d\nNew Root\n');
});

test('addTask defaults an empty/blank name to "New Task" and returns null for an unknown parent', () => {
    const model = PlanModel.parse('Phase\n  Existing 1d\n');
    const blank = model.addTask('   ', null);
    assert.equal(blank.name, 'New Task');

    const foreignParent = PlanModel.parse('Other\n').tasks[0];
    assert.equal(model.addTask('X', foreignParent), null);
});

test('reorderSibling swaps a task with its immediate up/down sibling only', () => {
    const model = PlanModel.parse('A 1d\nB 1d\nC 1d\n');
    const [a, b] = model.tasks;

    assert.equal(model.reorderSibling(b, 'up'), true);
    assert.equal(model.tasks.map(t => t.name).join(','), 'B,A,C');
    assert.equal(model.serialize(), 'B 1d\nA 1d\nC 1d\n');

    // Already first -- moving up further is a no-op, not an error.
    assert.equal(model.reorderSibling(b, 'up'), false);
    assert.equal(model.serialize(), 'B 1d\nA 1d\nC 1d\n');
});

test('reorderSibling never crosses out of its own parent’s children', () => {
    const model = PlanModel.parse('Phase\n  Only 1d\nOther 1d\n');
    const only = model.tasks[1];
    assert.equal(model.reorderSibling(only, 'down'), false);
    assert.equal(model.serialize(), 'Phase\n  Only 1d\nOther 1d\n');
});
