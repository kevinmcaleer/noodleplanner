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

test('rename collapses an embedded newline instead of splitting the task onto extra lines', () => {
    // #1006: a name is spliced into one physical line by _serialiseContent
    // /serialize(); an embedded newline would turn that into several lines,
    // and one of them could be mistaken for structure (e.g. a back-matter
    // marker) on the document's next parse.
    const model = PlanModel.parse('A 1d\nB 1d\n');
    model.rename(model.tasks[0], 'Foo\n---whiteboard---\nBar');
    assert.equal(model.tasks[0].name, 'Foo ---whiteboard--- Bar');
    assert.equal(model.serialize(), 'Foo ---whiteboard--- Bar 1d\nB 1d\n');
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

test('sibling reorder moves the whole subtree through the model', () => {
    const model = PlanModel.parse('Phase\n  A\n    A child 1d\n  B 1d\n  C 1d\n');
    const a = model.findByName('A');
    const c = model.findByName('C');
    assert.equal(model.moveAfter(a, c), true);
    assert.equal(
        model.serialize(),
        'Phase\n  B 1d\n  C 1d\n  A\n    A child 1d\n'
    );
    assert.equal(a.parent.name, 'Phase');
});

test('reorder expands star shorthand when adjacency breaks', () => {
    const model = PlanModel.parse('Phase\n  A 1d\n  *B 1d\n  C 1d\n');
    const b = model.findByName('B');
    const c = model.findByName('C');
    assert.equal(model.moveBefore(c, b), true);
    assert.equal(
        model.serialize(),
        'Phase\n  A 1d\n  C 1d\n  B 1d [depends: A]\n'
    );
    assert.equal(b.dependencies[0].target.name, 'A');
    assert.equal(b.dependencies[0].shorthand, false);
});

test('an expanded sequential dependency stays explicit when adjacency returns', () => {
    const model = PlanModel.parse('Phase\n  A 1d\n  *B 1d\n  C 1d\n');
    const b = model.findByName('B');
    const c = model.findByName('C');
    assert.equal(model.moveBefore(c, b), true);
    assert.equal(model.moveBefore(b, c), true);
    assert.equal(
        model.serialize(),
        'Phase\n  A 1d\n  B 1d [depends: A]\n  C 1d\n'
    );
    assert.equal(b.dependencies[0].shorthand, false);
});

test('moving between parents preserves descendants and adjusts indentation', () => {
    const model = PlanModel.parse('One\n  Work\n    Child 1d\nTwo\n');
    const work = model.findByName('Work');
    const two = model.findByName('Two');
    assert.equal(model.moveAsChild(work, two, true), true);
    assert.equal(model.serialize(), 'One\nTwo\n  Work\n    Child 1d\n');
});

test('reorder preserves CRLF and the absence of a final newline', () => {
    const model = PlanModel.parse('Phase\r\n  A 1d\r\n  B 1d');
    assert.equal(model.moveAfter(model.findByName('A'), model.findByName('B')), true);
    assert.equal(model.serialize(), 'Phase\r\n  B 1d\r\n  A 1d');
});

test('insertTaskAfter appends a root task with matching indentation', () => {
    const model = PlanModel.parse('First\n');
    const node = model.insertTaskAfter(model.tasks[0], 0, 'Second');
    assert.equal(node.name, 'Second');
    assert.equal(model.serialize(), 'First\nSecond\n');
    assert.deepEqual(model.tasks.map(task => task.name), ['First', 'Second']);
});

test('insertTaskAfter with no anchor appends to an empty document', () => {
    const model = PlanModel.parse('');
    const node = model.insertTaskAfter(null, 0, 'First task');
    assert.equal(node.name, 'First task');
    assert.equal(model.serialize(), 'First task');
});

test('insertTaskAfter at a deeper indent nests under the anchor task', () => {
    const model = PlanModel.parse('Phase\n');
    const phase = model.tasks[0];
    const child = model.insertTaskAfter(phase, 2, 'Child task');
    assert.equal(child.parent, phase);
    assert.deepEqual(phase.children, [child]);
    assert.equal(model.serialize(), 'Phase\n  Child task\n');
});

test('insertTaskAfter nests after an existing last child, not before it', () => {
    const model = PlanModel.parse('Phase\n  Existing child 1d\n');
    const phase = model.tasks[0];
    model.insertTaskAfter(phase, 2, 'New child');
    assert.deepEqual(model.tasks.map(task => task.name), ['Phase', 'Existing child', 'New child']);
    assert.equal(model.serialize(), 'Phase\n  Existing child 1d\n  New child\n');
});

test('insertTaskAfter at a shallower indent closes out the anchor\'s whole subtree first', () => {
    const model = PlanModel.parse('Phase\n  Task\n    Sub task 1d\nOther phase\n');
    const subTask = model.findByName('Sub task');
    const node = model.insertTaskAfter(subTask, 0, 'New root');
    assert.equal(node.parent, null);
    assert.deepEqual(
        model.tasks.map(task => task.name),
        ['Phase', 'Task', 'Sub task', 'New root', 'Other phase']
    );
    assert.equal(
        model.serialize(),
        'Phase\n  Task\n    Sub task 1d\nNew root\nOther phase\n'
    );
});

test('insertTaskAfter preserves CRLF and a missing final newline', () => {
    const model = PlanModel.parse('First\r\nSecond');
    model.insertTaskAfter(model.tasks[0], 0, 'Between');
    assert.equal(model.serialize(), 'First\r\nBetween\r\nSecond');
});

test('removeTask drops a leaf task and keeps the rest of the document intact', () => {
    const model = PlanModel.parse('First\nSecond\nThird\n');
    const second = model.findByName('Second');
    assert.equal(model.removeTask(second), true);
    assert.equal(model.serialize(), 'First\nThird\n');
    assert.deepEqual(model.tasks.map(task => task.name), ['First', 'Third']);
});

test('removeTask refuses to remove a task that still has children', () => {
    const model = PlanModel.parse('Phase\n  Child 1d\n');
    assert.equal(model.removeTask(model.tasks[0]), false);
    assert.equal(model.serialize(), 'Phase\n  Child 1d\n');
});

test('removeTask folds trailing comment lines onto the previous task', () => {
    const model = PlanModel.parse('First\nSecond\n// a note\nThird\n');
    const second = model.findByName('Second');
    assert.equal(model.removeTask(second), true);
    assert.equal(model.serialize(), 'First\n// a note\nThird\n');
});
