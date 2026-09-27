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
import { buildTasks } from '../packages/noodle-web/src/noodle_web/static/engine/scheduler.js';
import { planBody } from '../packages/noodle-web/src/noodle_web/static/engine/local-parse.js';

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

// --- #747: every failure mode of the old name-prefix regex -------------------
//
// The old syncs found a line with `^indent\*?name`: a prefix of another name
// matched first, a duplicate always hit the first occurrence, a line opening
// with a token ($product, `* +2d`, `!!`, `{bucket}`) never matched, and an
// indent other than (level-1)*2 spaces never matched. Each case below takes
// the task the views render -- its `_uid` from the engine's buildTasks(), not
// a hand-written one -- through every sync, and checks that exactly its own
// line changed.

const SYNCS = {
    predecessors: (page, task) => page.syncGanttPredecessorsToEditor({ ...task, depends: ['Other'] }, task._uid),
    percent: (page, task) => page.syncGanttPercentToEditor({ ...task, percent: '50%' }, task._uid),
    duration: (page, task) => page.syncGanttDurationToEditor({ ...task, duration_days: 5 }, task._uid),
    start: (page, task) => page.syncGanttStartDateToEditor({ ...task, start: '2026-02-02' }, task._uid),
    finish: (page, task) => page.syncGanttFinishDateToEditor({ ...task, finish: '2026-02-09' }, task._uid),
    priority: (page, task) => page.syncGanttPriorityToEditor({ ...task, priority: 'Urgent' }, task._uid),
    resources: (page, task) => page.syncGanttEditToEditor(task, task._uid, 'resources', 'kev'),
    comment: (page, task) => page.syncGanttEditToEditor(task, task._uid, 'comment', 'note'),
    bucket: (page, task) => page.syncGanttEditToEditor(task, task._uid, 'bucket', 'Doing'),
    name: (page, task) => page.syncGanttEditToEditor(task, task._uid, 'name', 'Renamed', task.name),
};

/** What each sync writes, as it appears on the edited line. */
const WRITTEN = {
    predecessors: '[depends Other]', percent: '50%', duration: '5d', start: '2026-02-02',
    finish: '2026-02-09', priority: '!!!', resources: '@kev', comment: '"note"',
    bucket: '{Doing}', name: 'Renamed',
};

/** The rendered task with this uid, as a view hands it to a sync. */
function renderedTask(text, uid) {
    const task = buildTasks(planBody(text))[uid];
    return { _uid: task._uid, name: task.name, level: task.level };
}

/** Run one sync on `text` and return the lines it changed, by index. */
function runSync(text, sync, uid) {
    const { sandbox: page, editor } = load(text);
    SYNCS[sync](page, renderedTask(text, uid));
    const before = text.split('\n');
    const after = editor.value.split('\n');
    assert.equal(after.length, before.length, `${sync} added or removed a line`);
    return Object.fromEntries(after.map((line, i) => [i, line]).filter(([i, line]) => line !== before[i]));
}

test('a name that prefixes an earlier task: every sync edits its own line (#747)', () => {
    // `^  \*?Design` matched `Design UI` first
    const text = 'Other 1d\nProject\n  Design UI 3d 2026-01-05\n  Design 2d 2026-01-05\n';
    const expected = {
        predecessors: '  Design 2d 2026-01-05 [depends Other]',
        percent: '  Design 2d 50% 2026-01-05',
        duration: '  Design 5d 2026-01-05',
        start: '  Design 2d 2026-02-02',
        finish: '  Design 2d 2026-01-05 2026-02-09',
        priority: '  Design !!! 2d 2026-01-05',
        resources: '  Design @kev 2d 2026-01-05',
        comment: '  Design 2d 2026-01-05 "note"',
        bucket: '  Design 2d 2026-01-05 {Doing}',
        name: '  Renamed 2d 2026-01-05',
    };
    assert.equal(renderedTask(text, 3).name, 'Design');
    for (const sync of Object.keys(SYNCS)) {
        assert.deepEqual(runSync(text, sync, 3), { 3: expected[sync] }, sync);
    }
});

test('duplicate task names: every sync edits the occurrence it was given (#747)', () => {
    // [text, the first Review's uid, the second's] -- nested and top level
    for (const [text, first, second] of [
        ['Other 1d\nPhase 1\n  Review 1d 2026-01-05\nPhase 2\n  Review 1d 2026-01-05\n', 2, 4],
        ['Other 1d\nReview 1d 2026-01-05\nMiddle 1d\nReview 1d 2026-01-05\n', 1, 3],
    ]) {
        assert.equal(renderedTask(text, first).name, 'Review');
        assert.equal(renderedTask(text, second).name, 'Review');
        for (const sync of Object.keys(SYNCS)) {
            const changed = runSync(text, sync, second);
            assert.deepEqual(Object.keys(changed), [String(second)], `${sync} on ${JSON.stringify(text)}`);
            assert.ok(changed[second].includes(WRITTEN[sync]), `${sync}: ${changed[second]}`);
        }
    }
});

test('a line that opens with a token: every sync reaches it and keeps the token (#747)', () => {
    // parseTaskLine strips these from the name, so `^\*?name` never matched
    const cases = [
        ['$GW2 Gateway review 3d 2026-01-05', '$GW2'],
        ['* +2d Build 2d 2026-01-05', '* +2d'],
        ['!! Polish 1d 2026-01-05', '!!'],
        ['{Backlog} Triage 1d 2026-01-05', '{Backlog}'],
    ];
    for (const [line, token] of cases) {
        const text = `Other 1d\n${line}\n`;
        for (const sync of Object.keys(SYNCS)) {
            const changed = runSync(text, sync, 1);
            assert.deepEqual(Object.keys(changed), ['1'], `${sync} on ${line}`);
            assert.ok(changed[1].includes(WRITTEN[sync]), `${sync} on ${line}: ${changed[1]}`);
            // the priority sync replaces a priority, the bucket sync a bucket
            const replaced = (sync === 'priority' && token === '!!') || (sync === 'bucket' && token === '{Backlog}');
            if (!replaced) assert.ok(changed[1].includes(token), `${sync} on ${line} lost ${token}: ${changed[1]}`);
        }
    }
});

test('the predecessor sync on a $product line writes the block and keeps the product (#747)', () => {
    const text = 'Other 1d\n  $GW2 Gateway review 3d\n';
    assert.deepEqual(runSync(text, 'predecessors', 1), { 1: '  $GW2 Gateway review 3d [depends Other]' });
});

test('a child indented by 3 spaces or a tab: every sync reaches it and keeps the indent (#747)', () => {
    for (const indent of ['   ', '\t', ' \t ']) {
        const text = `Other 1d\nPhase\n${indent}Odd 1d 2026-01-05\n`;
        assert.equal(renderedTask(text, 2).level, 2);
        for (const sync of Object.keys(SYNCS)) {
            const changed = runSync(text, sync, 2);
            assert.deepEqual(Object.keys(changed), ['2'], `${sync} with indent ${JSON.stringify(indent)}`);
            assert.ok(changed[2].startsWith(indent) && !/^\s/.test(changed[2].slice(indent.length)),
                `${sync} changed the indent: ${JSON.stringify(changed[2])}`);
            assert.ok(changed[2].includes(WRITTEN[sync]), `${sync}: ${changed[2]}`);
        }
    }
});

test('front matter, comments and blank lines do not shift a rendered task off its line (#747)', () => {
    const text = '---\ntitle: X\n---\n// intro\nDesign UI 3d\n\n  // note\nDesign 2d\nDesign 2d\n\n---notes---\nDesign 9d\n';
    // the engine renders from the plan body; its uids must be the model's
    const tasks = buildTasks(planBody(text));
    assert.deepEqual(tasks.map(t => t.name), ['Design UI', 'Design', 'Design']);
    const changed = runSync(text, 'percent', 2);
    assert.deepEqual(changed, { 8: 'Design 2d 50%' });
});
