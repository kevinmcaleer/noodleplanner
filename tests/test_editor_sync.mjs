/**
 * Table/Gantt edits written back to the plan editor (editor-sync.js).
 *
 * Each sync finds its task through the plan model, never by a name-prefix
 * regex over the text (#747, #921), and rewrites the field with
 * updateLineField() over the shared task-line grammar (#563). Runs the real
 * task-tokenizer.js, plan-model.js and editor-sync.js in a vm sandbox with a
 * stand-in #planEditor.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const staticDir = new URL('../packages/noodle-web/src/noodle_web/static/', import.meta.url);
const read = name => readFileSync(new URL(name, staticDir), 'utf8');

function load(text) {
    const editor = { value: text, dispatchEvent() {} };
    const sandbox = {
        console: { log() {}, error() {} },
        Event: class { constructor(type) { this.type = type; } },
        document: { getElementById: id => (id === 'planEditor' ? editor : null) },
    };
    vm.createContext(sandbox);
    vm.runInContext(read('task-tokenizer.js') + '\nglobalThis.TaskLineTokenizer = TaskLineTokenizer;', sandbox);
    vm.runInContext(read('plan-model.js'), sandbox);
    vm.runInContext(read('editor-sync.js'), sandbox);
    return { sandbox, editor };
}

const { sandbox } = load('');
const field = (...args) => sandbox.updateLineField(...args);

test('updateLineField replaces a field in place', () => {
    assert.equal(field('Design 5d 20% @kev', 'percent', '50%'), 'Design 5d 50% @kev');
});

test('updateLineField removes a field and the space beside it', () => {
    assert.equal(field('Design 5d 20% @kev', 'percent', ''), 'Design 5d @kev');
    assert.equal(field('Design 5d', 'percent', ''), 'Design 5d', 'nothing to remove is a no-op');
});

test('updateLineField places a missing field after its anchors, else after the name', () => {
    assert.equal(field('Design 5d @kev', 'percent', '10%', { after: ['duration', 'effort'] }), 'Design 5d 10% @kev');
    assert.equal(field('Design @kev', 'percent', '10%', { after: ['duration'] }), 'Design 10% @kev');
    assert.equal(field('Design', 'percent', '10%'), 'Design 10%');
    assert.equal(field('* +2d Build @kev', 'percent', '10%'), '* +2d Build 10% @kev',
        'a sequential star and its lag are not fields');
});

test('the finish date is the second date, and needs a start date before it', () => {
    assert.equal(sandbox.updateFinishDateInLine('A 2026-01-05 2026-01-09', '2026-01-12'), 'A 2026-01-05 2026-01-12');
    assert.equal(sandbox.updateFinishDateInLine('A 2026-01-05 @kev', '2026-01-12'), 'A 2026-01-05 2026-01-12 @kev');
    assert.equal(sandbox.updateFinishDateInLine('A 3d', '2026-01-12'), 'A 3d',
        'a lone date would be read as the start, so none is written');
});

test('a deadline is never mistaken for a start date', () => {
    assert.equal(sandbox.updateLineField('A D2026-02-01 3d', 'date', '2026-01-05', { after: ['duration'] }),
        'A D2026-02-01 3d 2026-01-05');
});

test('a token inside a [depends] block or a comment is not a field', () => {
    assert.equal(field('A [depends B +2d] "due 5d"', 'duration', '3d'), 'A 3d [depends B +2d] "due 5d"');
});

test('percent sync edits the task by identity, not by the first matching name (#747)', () => {
    const { sandbox: page, editor } = load('Phase 1\n  Review 1d\nPhase 2\n  Review 1d\n');
    page.syncGanttPercentToEditor({ _uid: 3, name: 'Review', level: 2, percent: '100%' }, 3);
    assert.equal(editor.value, 'Phase 1\n  Review 1d\nPhase 2\n  Review 1d 100%\n');
});

test('percent sync reaches a $product line the name regex missed (#747)', () => {
    const { sandbox: page, editor } = load('Spec $spec 2d\nBuild [depends $spec]\n');
    page.syncGanttPercentToEditor({ _uid: 0, name: 'Spec', level: 1, percent: '40%' }, 0);
    assert.equal(editor.value, 'Spec $spec 2d 40%\nBuild [depends $spec]\n');
});

test('a name edit renames through the model, so dependants follow', () => {
    const { sandbox: page, editor } = load('Design 2d\nBuild [depends Design]\n');
    page.syncGanttEditToEditor({ _uid: 0, name: 'Wireframes' }, 0, 'name', 'Wireframes', 'Design');
    assert.equal(editor.value, 'Wireframes 2d\nBuild [depends Wireframes]\n');
});

test('a resources edit writes @ tokens and leaves a [depends] block alone', () => {
    const { sandbox: page, editor } = load('A 1d\nB 2d @jo [depends A]\n');
    page.syncGanttEditToEditor({ _uid: 1, name: 'B' }, 1, 'resources', 'kev, ann');
    assert.equal(editor.value, 'A 1d\nB 2d @kev @ann [depends A]\n');
    page.syncGanttEditToEditor({ _uid: 1, name: 'B' }, 1, 'resources', '');
    assert.equal(editor.value, 'A 1d\nB 2d [depends A]\n');
});

test('comment and bucket edits set, replace and clear their own token', () => {
    const { sandbox: page, editor } = load('A 1d\n');
    page.syncGanttEditToEditor({ _uid: 0 }, 0, 'comment', 'first');
    page.syncGanttEditToEditor({ _uid: 0 }, 0, 'bucket', 'Backlog');
    assert.equal(editor.value, 'A 1d "first" {Backlog}\n');
    page.syncGanttEditToEditor({ _uid: 0 }, 0, 'comment', 'second');
    assert.equal(editor.value, 'A 1d "second" {Backlog}\n');
    page.syncGanttEditToEditor({ _uid: 0 }, 0, 'comment', '');
    assert.equal(editor.value, 'A 1d {Backlog}\n');
});

test('priority sync replaces every marker with one', () => {
    const { sandbox: page, editor } = load('A 1d !\n');
    page.syncGanttPriorityToEditor({ _uid: 0, name: 'A', priority: 'Urgent' }, 0);
    assert.equal(editor.value, 'A 1d !!!\n');
    page.syncGanttPriorityToEditor({ _uid: 0, name: 'A', priority: 'Low' }, 0);
    assert.equal(editor.value, 'A 1d\n');
});

test('predecessor sync writes, replaces and removes the [depends] block', () => {
    const { sandbox: page, editor } = load('A 1d\nB 1d\nC 2d "note"\n');
    const task = { _uid: 2, name: 'C', depends: ['A', 'B'], dependency_types: { B: 'SS' }, lag_lead: { A: '+1d' } };
    page.syncGanttPredecessorsToEditor(task, 2);
    assert.equal(editor.value, 'A 1d\nB 1d\nC 2d "note" [depends A +1d, B:SS]\n');
    page.syncGanttPredecessorsToEditor({ ...task, depends: [] }, 2);
    assert.equal(editor.value, 'A 1d\nB 1d\nC 2d "note"\n');
});
