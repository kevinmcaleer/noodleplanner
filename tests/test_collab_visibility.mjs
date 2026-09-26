/**
 * The host's "hide from collaborators" eye (static/collab-visibility.js):
 * what a joiner is sent while parts of the plan are hidden, and why an
 * edit coming back from them can never change a hidden task.
 *
 * Run with: node --test tests/test_collab_visibility.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const STATIC_DIR = new URL('../packages/noodle-web/src/noodle_web/static/', import.meta.url);

// The real task-line grammar, as the browser has it -- see
// tests/test_collab_ops.mjs for why the fallback parse is not enough.
vm.runInThisContext(
    readFileSync(new URL('task-tokenizer.js', STATIC_DIR), 'utf8') +
    '\nglobalThis.TaskLineTokenizer = TaskLineTokenizer;'
);

const require = createRequire(import.meta.url);
require('../packages/noodle-web/src/noodle_web/static/plan-model.js');
require('../packages/noodle-web/src/noodle_web/static/collab-merge.js');
const V = require('../packages/noodle-web/src/noodle_web/static/collab-visibility.js');

const PLAN = [
    'Discovery',
    '  Interviews 3d',
    '  Survey 2d',
    'Budget',
    '  Salaries 1d',
    '  Contracts 1d [depends: Interviews]',
    'Delivery',
    '  Build 5d [depends: Salaries, Survey]',
    '  Launch 1d',
    '',
    '---whiteboard---',
    '| Task | X | Y |',
    '| --- | --- | --- |',
    '| Discovery | 10 | 10 |',
    '| Budget | 300 | 10 |',
    '| Salaries | 600 | 10 |',
    '',
].join('\n');

const hide = (plan, state, ...names) =>
    names.reduce((current, name) => V.toggleTask(plan, current, name), state || V.createState());

test('with nothing hidden the plan is shared exactly as it is', () => {
    const state = V.createState();
    assert.ok(V.isTrivial(state));
    assert.equal(V.redactPlanText(PLAN, state), PLAN);
});

test('hiding a task removes it, its subtasks and every row naming them', () => {
    const state = hide(PLAN, null, 'Budget');
    const shared = V.redactPlanText(PLAN, state);
    assert.doesNotMatch(shared, /Budget|Salaries|Contracts/);
    assert.match(shared, /Discovery/);
    assert.match(shared, /\| Discovery \| 10 \| 10 \|/);
    // A visible task's dependency on a hidden one does not give its name away.
    assert.match(shared, /  Build 5d \[depends: Survey\]/);
});

test('a dependency block naming only hidden tasks is dropped', () => {
    const plan = 'Secret\nOpen 2d [depends: Secret]\n';
    const shared = V.redactPlanText(plan, hide(plan, null, 'Secret'));
    assert.equal(shared, 'Open 2d\n');
});

test('statuses tell the host which rows are hidden directly and which by a parent', () => {
    const state = hide(PLAN, null, 'Budget');
    const statuses = V.statuses(PLAN, state);
    assert.equal(statuses.get('budget'), 'hidden');
    assert.equal(statuses.get('salaries'), 'inherited');
    assert.equal(statuses.get('discovery'), 'shown');
});

test('the top-level eye hides everything, then shares everything', () => {
    const allHidden = V.toggleAll(PLAN, V.createState());
    assert.equal(V.anyShared(PLAN, allHidden), false);
    assert.doesNotMatch(V.redactPlanText(PLAN, allHidden), /Discovery|Budget|Delivery/);
    const allShown = V.toggleAll(PLAN, allHidden);
    assert.ok(V.isTrivial(allShown));
});

test('unhiding one task under hide-all reveals its path, not its siblings', () => {
    let state = V.toggleAll(PLAN, V.createState());
    state = V.toggleTask(PLAN, state, 'Launch');
    const shared = V.redactPlanText(PLAN, state);
    assert.match(shared, /^Delivery\n  Launch 1d\n/);
    assert.doesNotMatch(shared, /Build|Discovery|Budget/);

    // Unhiding the phase itself then shares the rest of it.
    state = V.toggleTask(PLAN, V.toggleAll(PLAN, V.createState()), 'Discovery');
    assert.match(V.redactPlanText(PLAN, state), /Discovery\n  Interviews 3d\n  Survey 2d\n/);
});

test('revealing a task nested two levels under a hidden phase keeps its siblings hidden', () => {
    const plan = 'A\n  B\n    C\n    D\n  E\n';
    let state = V.toggleAll(plan, V.createState());
    state = V.toggleTask(plan, state, 'C');
    assert.equal(V.redactPlanText(plan, state), 'A\n  B\n    C\n');
});

test('a joiner edit to a visible task is merged around the hidden ones', () => {
    const state = hide(PLAN, null, 'Budget');
    const shared = V.redactPlanText(PLAN, state);
    const edited = shared.replace('  Launch 1d', '  Launch 2d 50%').replace('| Discovery | 10 | 10 |', '| Discovery | 40 | 70 |');
    const result = V.restoreHidden(PLAN, shared, edited, state);
    assert.equal(result.ok, true);
    assert.equal(result.text, PLAN.replace('  Launch 1d', '  Launch 2d 50%').replace('| Discovery | 10 | 10 |', '| Discovery | 40 | 70 |'));
});

test('a joiner deleting the parent of a hidden task is refused', () => {
    const plan = 'Delivery\n  Build\n  Secret\nOther\n';
    const state = hide(plan, null, 'Secret');
    const shared = V.redactPlanText(plan, state);
    assert.equal(shared, 'Delivery\n  Build\nOther\n');
    const result = V.restoreHidden(plan, shared, 'Other\n', state);
    assert.deepEqual(result, { ok: false, reason: 'protected' });
});

test('a joiner renaming the parent of a hidden task keeps it hidden under the new name', () => {
    const plan = 'Delivery\n  Build\n  Secret\nOther\n';
    const state = hide(plan, null, 'Secret');
    const shared = V.redactPlanText(plan, state);
    const result = V.restoreHidden(plan, shared, shared.replace('Delivery', 'Shipping'), state);
    assert.equal(result.ok, true);
    assert.equal(result.text, 'Shipping\n  Build\n  Secret\nOther\n');
});

test('a joiner cannot rename a visible task onto a hidden task\'s name to reveal it', () => {
    const plan = 'Open\nSecret\n';
    const state = hide(plan, null, 'Secret');
    const shared = V.redactPlanText(plan, state);
    const result = V.restoreHidden(plan, shared, 'Secret\n', state);
    assert.equal(result.ok, false);
});

test('a joiner\'s new task stays visible to them under hide-all', () => {
    let state = V.toggleAll(PLAN, V.createState());
    state = V.toggleTask(PLAN, state, 'Delivery');
    const shared = V.redactPlanText(PLAN, state);
    const edited = shared.replace('  Launch 1d\n', '  Launch 1d\nRetro\n');
    const result = V.restoreHidden(PLAN, shared, edited, state);
    assert.equal(result.ok, true);
    assert.match(result.text, /  Launch 1d\nRetro\n/);
    assert.match(V.redactPlanText(result.text, result.state), /Retro/);
    // The hidden phases came through untouched.
    assert.match(result.text, /Budget\n  Salaries 1d\n/);
});

test('the host renaming a hidden task keeps it hidden', () => {
    const state = hide(PLAN, null, 'Budget');
    const renamed = PLAN.replace('Budget\n', 'Money\n').replace('| Budget |', '| Money |');
    const next = V.reconcileRenames(PLAN, renamed, state);
    assert.doesNotMatch(V.redactPlanText(renamed, next), /Money|Salaries/);
});

test('a plan without a final newline still merges a joiner\'s appended task', () => {
    const plan = 'Open\nSecret';
    const state = hide(plan, null, 'Secret');
    const shared = V.redactPlanText(plan, state);
    assert.equal(shared, 'Open');
    const result = V.restoreHidden(plan, shared, 'Open\nNew', state);
    assert.equal(result.ok, true);
    assert.equal(result.text, 'Open\nSecret\nNew');
});

// A joiner's pin or unpin rewrites the whole whiteboard table, padded to its
// widest cell (script.js's updatePlanWhiteboardText()). Merged line by line,
// that edit spans the host's hidden rows, and every pin and unpin was
// refused as `protected` while anything on the board was hidden.
const BOARD_PLAN = [
    'Alpha',
    '  Alpha one',
    '  Alpha two',
    'Beta',
    '  Beta one',
    '',
    '---whiteboard---',
    '| Task  | X   | Y  | Colour  | Width | Height | Collapsed |',
    '|-------|-----|----|---------|-------|--------|-----------|',
    '| Alpha | 60  | 60 | #FFAFA3 | 240   | 180    | no        |',
    '| Beta  | 360 | 60 |         | 240   | 180    | no        |',
    '',
].join('\n');

test('a joiner pinning a note keeps the host\'s hidden rows on the board', () => {
    const state = hide(BOARD_PLAN, null, 'Beta');
    const shared = V.redactPlanText(BOARD_PLAN, state);
    assert.doesNotMatch(shared, /Beta/);
    // What the joiner's wbCommitAddNotes() sends: the table re-padded, the
    // final newline gone.
    const edited = [
        'Alpha',
        '  Alpha one',
        '  Alpha two',
        '',
        '---whiteboard---',
        '| Task      | X   | Y   | Colour  | Width | Height | Collapsed |',
        '|-----------|-----|-----|---------|-------|--------|-----------|',
        '| Alpha     | 60  | 60  | #FFAFA3 | 240   | 180    | no        |',
        '| Alpha one | 200 | 284 |         |       |        | no        |',
    ].join('\n');
    const result = V.restoreHidden(BOARD_PLAN, shared, edited, state);
    assert.equal(result.ok, true);
    assert.equal(result.text, [
        'Alpha',
        '  Alpha one',
        '  Alpha two',
        'Beta',
        '  Beta one',
        '',
        '---whiteboard---',
        '| Task      | X   | Y   | Colour  | Width | Height | Collapsed |',
        '|-----------|-----|-----|---------|-------|--------|-----------|',
        '| Alpha     | 60  | 60  | #FFAFA3 | 240   | 180    | no        |',
        '| Alpha one | 200 | 284 |         |       |        | no        |',
        '| Beta      | 360 | 60  |         | 240   | 180    | no        |',
    ].join('\n'));
    // And the joiner is still shown only what they were before, plus the pin.
    assert.doesNotMatch(V.redactPlanText(result.text, result.state), /Beta/);
});

test('a joiner unpinning the last note they can see keeps the hidden rows', () => {
    const state = hide(BOARD_PLAN, null, 'Beta');
    const shared = V.redactPlanText(BOARD_PLAN, state);
    // An empty board: updatePlanWhiteboardText() drops the section outright.
    const result = V.restoreHidden(BOARD_PLAN, shared, 'Alpha\n  Alpha one\n  Alpha two', state);
    assert.equal(result.ok, true);
    assert.equal(result.text, [
        'Alpha',
        '  Alpha one',
        '  Alpha two',
        'Beta',
        '  Beta one',
        '',
        '---whiteboard---',
        '| Task | X   | Y  | Colour | Width | Height | Collapsed |',
        '|------|-----|----|--------|-------|--------|-----------|',
        '| Beta | 360 | 60 |        | 240   | 180    | no        |',
        '',
    ].join('\n'));
});

test('a joiner\'s board edit leaves the section that follows it alone', () => {
    const plan = BOARD_PLAN + '\n---parking lot---\n- idea\n';
    const state = hide(plan, null, 'Beta');
    const shared = V.redactPlanText(plan, state);
    const edited = shared.replace('| Alpha | 60  | 60 |', '| Alpha | 90  | 60 |');
    const result = V.restoreHidden(plan, shared, edited, state);
    assert.equal(result.ok, true);
    assert.equal(result.text, plan.replace('| Alpha | 60  | 60 |', '| Alpha | 90  | 60 |'));
});

test('a joiner cannot write a board row for a hidden task', () => {
    const state = hide(BOARD_PLAN, null, 'Beta');
    const shared = V.redactPlanText(BOARD_PLAN, state);
    const edited = shared.replace(
        '| Alpha | 60  | 60 | #FFAFA3 | 240   | 180    | no        |',
        '| Alpha | 60  | 60 | #FFAFA3 | 240   | 180    | no        |\n| Beta  | 0   | 0  |         |       |        | no        |'
    );
    assert.deepEqual(V.restoreHidden(BOARD_PLAN, shared, edited, state), { ok: false, reason: 'protected' });
});
