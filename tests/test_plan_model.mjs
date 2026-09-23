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

test('duplicate names keep distinct identities and first definition wins for lookup', () => {
    // matches the schedulers, so the editor's link is the one that sets dates
    const model = PlanModel.parse('Same 1d\nSame 2d\nAfter 1d [depends Same]\n');
    assert.notEqual(model.tasks[0].id, model.tasks[1].id);
    assert.equal(model.tasks[2].dependencies[0].target, model.tasks[0]);
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

// ---- addDependency / removeDependency / cycle detection (#1052) ----

test('addDependency creates a new [depends: ...] block when none exists', () => {
    const model = PlanModel.parse('Phase\n  A 1d\n  B 1d\n');
    const [a, b] = [model.findByName('A'), model.findByName('B')];
    assert.equal(model.addDependency(b, a), true);
    assert.equal(model.serialize(), 'Phase\n  A 1d\n  B 1d [depends: A]\n');
    assert.equal(b.dependencies.length, 1);
    assert.equal(b.dependencies[0].target, a);
});

test('addDependency appends to an existing [depends: ...] block', () => {
    const model = PlanModel.parse('Phase\n  A 1d\n  B 1d\n  C 1d [depends: A]\n');
    const c = model.findByName('C');
    assert.equal(model.addDependency(c, model.findByName('B')), true);
    assert.equal(model.serialize(), 'Phase\n  A 1d\n  B 1d\n  C 1d [depends: A, B]\n');
});

test('addDependency refuses a self-dependency', () => {
    const model = PlanModel.parse('Phase\n  A 1d\n');
    const a = model.findByName('A');
    const before = model.serialize();
    assert.equal(model.addDependency(a, a), false);
    assert.equal(model.serialize(), before);
});

test('addDependency refuses a duplicate', () => {
    const model = PlanModel.parse('Phase\n  A 1d\n  B 1d [depends: A]\n');
    const before = model.serialize();
    assert.equal(model.addDependency(model.findByName('B'), model.findByName('A')), false);
    assert.equal(model.serialize(), before);
});

test('addDependency refuses a direct cycle (A depends on B, B depends on A)', () => {
    const model = PlanModel.parse('Phase\n  A 1d\n  B 1d [depends: A]\n');
    const before = model.serialize();
    assert.equal(model.addDependency(model.findByName('A'), model.findByName('B')), false);
    assert.equal(model.serialize(), before);
});

test('addDependency refuses a transitive cycle (A -> B -> C, then C -> A)', () => {
    const model = PlanModel.parse('Phase\n  A 1d [depends: B]\n  B 1d [depends: C]\n  C 1d\n');
    const before = model.serialize();
    assert.equal(model.addDependency(model.findByName('C'), model.findByName('A')), false);
    assert.equal(model.serialize(), before);
});

test('canAddDependency refuses when the dependent task is a summary task (#1106)', () => {
    const model = PlanModel.parse('Phase\n  A 1d\n  B 1d\nOther 1d\n');
    const phase = model.findByName('Phase');
    const other = model.findByName('Other');
    const check = model.canAddDependency(phase, other);
    assert.equal(check.ok, false);
    assert.match(check.reason, /summary/);
});

test('canAddDependency refuses when the predecessor is a summary task (#1106)', () => {
    const model = PlanModel.parse('Phase\n  A 1d\n  B 1d\nOther 1d\n');
    const phase = model.findByName('Phase');
    const other = model.findByName('Other');
    const check = model.canAddDependency(other, phase);
    assert.equal(check.ok, false);
    assert.match(check.reason, /summary/);
});

test('addDependency refuses a summary-task endpoint and changes nothing (#1106)', () => {
    const model = PlanModel.parse('Phase\n  A 1d\n  B 1d\nOther 1d\n');
    const before = model.serialize();
    assert.equal(model.addDependency(model.findByName('Phase'), model.findByName('Other')), false);
    assert.equal(model.serialize(), before);
});

test('canAddDependency reports a reason without mutating anything', () => {
    const model = PlanModel.parse('Phase\n  A 1d\n  B 1d [depends: A]\n');
    const before = model.serialize();
    const check = model.canAddDependency(model.findByName('A'), model.findByName('B'));
    assert.equal(check.ok, false);
    assert.match(check.reason, /circular/);
    assert.equal(model.serialize(), before, 'a check must never mutate the model');
});

test('removeDependency drops the whole block when it was the only entry', () => {
    const model = PlanModel.parse('Phase\n  A 1d\n  B 1d [depends: A]\n');
    assert.equal(model.removeDependency(model.findByName('B'), model.findByName('A')), true);
    assert.equal(model.serialize(), 'Phase\n  A 1d\n  B 1d\n');
});

test('removeDependency keeps the remaining entries when there are several', () => {
    const model = PlanModel.parse('Phase\n  A 1d\n  B 1d\n  C 1d [depends: A, B]\n');
    assert.equal(model.removeDependency(model.findByName('C'), model.findByName('A')), true);
    assert.equal(model.serialize(), 'Phase\n  A 1d\n  B 1d\n  C 1d [depends: B]\n');
});

test('removeDependency returns false for a dependency that does not exist', () => {
    const model = PlanModel.parse('Phase\n  A 1d\n  B 1d\n');
    assert.equal(model.removeDependency(model.findByName('B'), model.findByName('A')), false);
});

test('removeDependency does not remove an implicit sequential (*) dependency', () => {
    const model = PlanModel.parse('Phase\n  A 1d\n  *B 1d\n');
    const before = model.serialize();
    assert.equal(model.removeDependency(model.findByName('B'), model.findByName('A')), false);
    assert.equal(model.serialize(), before);
});

test('addDependency then removeDependency round-trips back to the original text', () => {
    const original = 'Phase\n  A 1d\n  B 1d\n  C 1d\n';
    const model = PlanModel.parse(original);
    const [a, b, c] = [model.findByName('A'), model.findByName('B'), model.findByName('C')];
    model.addDependency(c, a);
    model.addDependency(c, b);
    model.removeDependency(c, a);
    model.removeDependency(c, b);
    assert.equal(model.serialize(), original);
});

// ---- insertTaskAfter / removeTask (#1049 notepad surface) ----

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

// ---- cardTextFor / insertCardAfter (#1050 reusable cards) ----

test('cardTextFor serialises a leaf task as a single line', () => {
    const model = PlanModel.parse('Phase\n  Task A 1d\n  Task B 2d\n');
    const text = model.cardTextFor(model.findByName('Task A'));
    assert.equal(text, 'Task A 1d');
});

test('cardTextFor serialises a subtree relative to its own root, dropping the source indent', () => {
    const model = PlanModel.parse('Phase\n  Sub-phase\n    Task A 1d\n    Task B 2d\n  Other\n');
    const text = model.cardTextFor(model.findByName('Sub-phase'));
    assert.equal(text, 'Sub-phase\n  Task A 1d\n  Task B 2d');
});

test('cardTextFor on a task with no children is just that one line, even deeply nested', () => {
    const model = PlanModel.parse('Phase\n  Sub-phase\n    Task A 1d\n');
    const text = model.cardTextFor(model.findByName('Task A'));
    assert.equal(text, 'Task A 1d');
});

test('cardTextFor returns an empty string for a null task', () => {
    const model = PlanModel.parse('Phase\n  Task A 1d\n');
    assert.equal(model.cardTextFor(null), '');
});

test('insertCardAfter inserts a flat card as new siblings at the anchor indent', () => {
    const model = PlanModel.parse('Phase\n  Task A 1d\n');
    const anchor = model.findByName('Task A');
    const inserted = model.insertCardAfter(anchor, anchor.indent, 'Task B 1d\nTask C 1d');
    assert.equal(inserted.length, 2);
    assert.equal(model.serialize(), 'Phase\n  Task A 1d\n  Task B 1d\n  Task C 1d\n');
});

test('insertCardAfter reconstructs the card\'s own nested hierarchy at the anchor point', () => {
    const model = PlanModel.parse('Phase\n  Task A 1d\n');
    const anchor = model.findByName('Task A');
    const cardText = 'Sub-phase\n  Nested A 1d\n  Nested B 1d\nOther root';
    model.insertCardAfter(anchor, anchor.indent, cardText);
    assert.equal(
        model.serialize(),
        'Phase\n  Task A 1d\n  Sub-phase\n    Nested A 1d\n    Nested B 1d\n  Other root\n'
    );
    const subPhase = model.findByName('Sub-phase');
    assert.deepEqual(subPhase.children.map(t => t.name), ['Nested A', 'Nested B']);
});

test('insertCardAfter round-trips with cardTextFor: saving a subtree and re-inserting it reproduces the same shape', () => {
    const source = PlanModel.parse('Phase\n  Sub-phase\n    Task A 1d\n    Task B 2d\n');
    const cardText = source.cardTextFor(source.findByName('Sub-phase'));

    const target = PlanModel.parse('Other Phase\n  Existing 1d\n');
    const anchor = target.findByName('Existing');
    target.insertCardAfter(anchor, anchor.indent, cardText);

    const reinserted = target.findByName('Sub-phase');
    assert.ok(reinserted);
    assert.equal(reinserted.indent, anchor.indent);
    assert.deepEqual(reinserted.children.map(t => t.name), ['Task A', 'Task B']);
});

test('insertCardAfter ignores blank lines within the card text', () => {
    const model = PlanModel.parse('Phase\n  Task A 1d\n');
    const anchor = model.findByName('Task A');
    const inserted = model.insertCardAfter(anchor, anchor.indent, 'Task B 1d\n\n  \nTask C 1d');
    assert.equal(inserted.length, 2);
});

test('insertCardAfter with empty card text inserts nothing', () => {
    const model = PlanModel.parse('Phase\n  Task A 1d\n');
    const anchor = model.findByName('Task A');
    const inserted = model.insertCardAfter(anchor, anchor.indent, '   \n\n');
    assert.equal(inserted.length, 0);
    assert.equal(model.serialize(), 'Phase\n  Task A 1d\n');
});

// #911: reordering spliced a blank line -- which had separated two other
// tasks in the original text -- into the gap the move created, instead of
// it just disappearing along with the boundary it used to mark.
test('reorder does not splice a stray blank line into the new gap', () => {
    const model = PlanModel.parse('Task A\nTask B\n\nTask C\n');
    const a = model.findByName('Task A');
    const b = model.findByName('Task B');
    assert.equal(model.moveAfter(a, b), true);
    assert.equal(model.serialize(), 'Task B\nTask A\nTask C\n');
});

// #911: the moved task's *old* predecessor is left just as exposed -- its
// blank trailing line described the boundary to the task that just left,
// not to whatever now follows it.
test('reorder does not leave a stray blank line at the old predecessor', () => {
    const model = PlanModel.parse('Task A\n\nTask B\nTask C\n');
    const b = model.findByName('Task B');
    const a = model.findByName('Task A');
    assert.equal(model.moveBefore(b, a), true);
    assert.equal(model.serialize(), 'Task B\nTask A\nTask C\n');
});

test('reorder keeps a non-blank trailing comment attached to its task', () => {
    const model = PlanModel.parse('Task A\n// keep me\nTask B\n\nTask C\n');
    const a = model.findByName('Task A');
    const b = model.findByName('Task B');
    assert.equal(model.moveAfter(a, b), true);
    assert.equal(model.serialize(), 'Task B\nTask A\n// keep me\nTask C\n');
});

test('a sequential lag is not part of the task name, and rides on the implicit edge', () => {
    // node loads no TaskLineTokenizer, so this is the fallback naming path --
    // which used to leave the `+` behind (`+ Build`)
    const model = PlanModel.parse('Phase\n  Design 3d\n  * +2d Build 3d\n  *+2d Cure 2d\n  * -1d Inspect 1d\n  Review 1d [depends Build]\n');
    assert.deepEqual(model.tasks.map(task => task.name), ['Phase', 'Design', 'Build', 'Cure', 'Inspect', 'Review']);

    const edgeOf = name => model.findByName(name).dependencies.find(edge => edge.shorthand);
    assert.equal(edgeOf('Build').target, model.findByName('Design'));
    assert.equal(edgeOf('Build').lag, '+2d');
    assert.equal(edgeOf('Cure').lag, '+2d');
    assert.equal(edgeOf('Inspect').lag, '-1d');

    // a dependency on the lagged task by name resolves to it
    const review = model.findByName('Review').dependencies[0];
    assert.equal(review.target, model.findByName('Build'));
});
