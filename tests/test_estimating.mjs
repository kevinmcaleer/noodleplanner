/**
 * estimating.js -- three-point (PERT) estimating popup (#1053).
 *
 * Covers the pure logic (PERT calculation, back-matter table read/write,
 * task-line duration write-back) directly, no DOM required. The popup UI
 * itself is covered by manual/browser verification (see the PR), the same
 * split test_notepad_surface.mjs and test_highlight_toggles.mjs use for
 * their own DOM-facing pieces.
 *
 * Run with: node --test tests/test_estimating.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const staticDir = join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'static');

function loadTokenizer() {
    const src = readFileSync(join(staticDir, 'task-tokenizer.js'), 'utf8');
    const sandbox = {};
    vm.createContext(sandbox);
    vm.runInContext(src + '\nthis.TaskLineTokenizer = TaskLineTokenizer;', sandbox);
    return sandbox.TaskLineTokenizer;
}

globalThis.TaskLineTokenizer = loadTokenizer();
const planModel = (await import('../packages/noodle-web/src/noodle_web/static/plan-model.js')).default;
globalThis.NoodlePlanModel = planModel;
const est = (await import('../packages/noodle-web/src/noodle_web/static/estimating.js')).default;

test('calculatePert weights optimistic/likely/pessimistic (O + 4M + P) / 6', () => {
    assert.equal(est.calculatePert(1, 2, 3), 2);
    assert.equal(est.calculatePert(1, 2, 5), (1 + 8 + 5) / 6);
});

test('calculatePert returns null for a non-numeric input rather than NaN', () => {
    assert.equal(est.calculatePert('', 2, 5), null);
    assert.equal(est.calculatePert('abc', 2, 5), null);
});

test('daysToDurationText rounds to the nearest whole day, minimum 1', () => {
    assert.equal(est.daysToDurationText(2.3), '2d');
    assert.equal(est.daysToDurationText(2.6), '3d');
    assert.equal(est.daysToDurationText(0.2), '1d');
    assert.equal(est.daysToDurationText(0), '1d');
});

test('setTaskDuration replaces an existing duration token in place, leaving the rest of the line untouched', () => {
    const line = '  Task A @alice 2d #urgent';
    const result = est.setTaskDuration(line, '5d');
    assert.equal(result, '  Task A @alice 5d #urgent');
});

test('setTaskDuration inserts a duration right after the name when none exists', () => {
    const line = '  Task A @alice #urgent';
    const result = est.setTaskDuration(line, '3d');
    assert.equal(result, '  Task A 3d @alice #urgent');
});

test('setTaskDuration on a bare name with nothing else appends the duration', () => {
    assert.equal(est.setTaskDuration('  Task A', '3d'), '  Task A 3d');
});

test('setTaskDuration does not confuse an effort token (~2d) or a dependency lag (+2d) for the duration', () => {
    const line = '  Task A ~1d/3d [depends: Task B +2d]';
    const result = est.setTaskDuration(line, '5d');
    // No bare `\d+[dwmy]` duration token exists on this line -- effort and
    // lag are different token types -- so a new one is inserted, and
    // neither the effort token nor the dependency block is touched.
    assert.ok(result.includes('~1d/3d'));
    assert.ok(result.includes('[depends: Task B +2d]'));
    assert.ok(/\bTask A 5d\b/.test(result));
});

test('extractEstimatesFromPlanText returns empty string when the section is absent', () => {
    assert.equal(est.extractEstimatesFromPlanText('Phase\n  Task A\n'), '');
});

test('extractEstimatesFromPlanText stops at the next back-matter marker', () => {
    const text = [
        'Phase',
        '  Task A',
        '',
        '---estimates---',
        '| Task | Optimistic | Most Likely | Pessimistic | Mode | Size |',
        '|------|------------|-------------|-------------|------|------|',
        '| Task A | 1 | 2 | 5 | duration | |',
        '',
        '---raid log---',
        '| ID | Type | Title |',
    ].join('\n');
    const section = est.extractEstimatesFromPlanText(text);
    assert.ok(section.includes('Task A'));
    assert.ok(!section.includes('raid log'));
});

test('parseEstimatesMarkdown round-trips through generateEstimatesText', () => {
    const records = [
        { task: 'Task A', optimistic: '1', mostLikely: '2', pessimistic: '5', mode: 'duration', size: '' },
        { task: 'Task B', optimistic: '', mostLikely: '', pessimistic: '', mode: 'tshirt', size: 'L' },
    ];
    const text = est.generateEstimatesText(records);
    const parsed = est.parseEstimatesMarkdown(text);
    assert.deepEqual(parsed, records);
});

test('parseEstimatesMarkdown skips a commented-out row', () => {
    const text = [
        '| Task | Optimistic | Most Likely | Pessimistic | Mode | Size |',
        '|------|------------|-------------|-------------|------|------|',
        '| Task A | 1 | 2 | 5 | duration | |',
        '// | Task B | 1 | 2 | 5 | duration | |',
    ].join('\n');
    const records = est.parseEstimatesMarkdown(text);
    assert.equal(records.length, 1);
    assert.equal(records[0].task, 'Task A');
});

test('findEstimateRecord / upsertEstimateRecord: insert then update the same task', () => {
    let records = [];
    records = est.upsertEstimateRecord(records, 'Task A', { optimistic: '1', mostLikely: '2', pessimistic: '5', mode: 'duration', size: '' });
    assert.equal(records.length, 1);
    assert.equal(est.findEstimateRecord(records, 'Task A').optimistic, '1');

    records = est.upsertEstimateRecord(records, 'Task A', { optimistic: '2' });
    assert.equal(records.length, 1);
    assert.equal(est.findEstimateRecord(records, 'Task A').optimistic, '2');
    assert.equal(est.findEstimateRecord(records, 'Task A').mostLikely, '2', 'unpatched fields are preserved');
});

test('updatePlanEstimatesText inserts a new section, and removes it when records is empty', () => {
    const base = 'Phase\n  Task A\n';
    const withSection = est.updatePlanEstimatesText(base, [
        { task: 'Task A', optimistic: '1', mostLikely: '2', pessimistic: '5', mode: 'duration', size: '' },
    ]);
    assert.ok(withSection.includes('---estimates---'));
    assert.ok(withSection.includes('Task A'));

    const removed = est.updatePlanEstimatesText(withSection, []);
    assert.ok(!removed.includes('---estimates---'));
    assert.equal(removed.trim(), base.trim());
});

test('updatePlanEstimatesText preserves a following section that is not canonically after estimates', () => {
    const text = [
        'Phase',
        '  Task A',
        '',
        '---estimates---',
        '| Task | Optimistic | Most Likely | Pessimistic | Mode | Size |',
        '|------|------------|-------------|-------------|------|------|',
        '| Task A | 1 | 2 | 5 | duration | |',
        '',
        '---budget---',
        '| ID | Description | Estimate |',
        '|----|-------------|----------|',
        '| 1  | Dev work    | 5000     |',
    ].join('\n');
    const updated = est.updatePlanEstimatesText(text, [
        { task: 'Task A', optimistic: '2', mostLikely: '3', pessimistic: '6', mode: 'duration', size: '' },
    ]);
    assert.ok(updated.includes('---budget---'));
    assert.ok(updated.includes('Dev work'));
});

test('applyEstimate: three-point mode writes a PERT duration and records the three inputs', () => {
    const before = 'Phase\n  Task A\n';
    const { text, days } = est.applyEstimate(before, 'Task A', { mode: 'duration', optimistic: 1, mostLikely: 2, pessimistic: 5 });
    assert.equal(days, (1 + 8 + 5) / 6);
    assert.ok(/Task A 2d/.test(text));
    const records = est.parseEstimatesMarkdown(est.extractEstimatesFromPlanText(text));
    assert.deepEqual(est.findEstimateRecord(records, 'Task A'), {
        task: 'Task A', optimistic: '1', mostLikely: '2', pessimistic: '5', mode: 'duration', size: '',
    });
});

test('applyEstimate: t-shirt mode writes the mapped duration and records the size, not O/M/P', () => {
    const before = 'Phase\n  Task A 1d\n';
    const { text, days } = est.applyEstimate(before, 'Task A', { mode: 'tshirt', size: 'L' });
    assert.equal(days, est.TSHIRT_DAYS.L);
    assert.ok(new RegExp('Task A ' + est.TSHIRT_DAYS.L + 'd').test(text));
    const records = est.parseEstimatesMarkdown(est.extractEstimatesFromPlanText(text));
    assert.deepEqual(est.findEstimateRecord(records, 'Task A'), {
        task: 'Task A', optimistic: '', mostLikely: '', pessimistic: '', mode: 'tshirt', size: 'L',
    });
});

test('applyEstimate on an unknown task name is a no-op', () => {
    const before = 'Phase\n  Task A\n';
    const { text, days } = est.applyEstimate(before, 'Nonexistent', { mode: 'duration', optimistic: 1, mostLikely: 2, pessimistic: 5 });
    assert.equal(text, before);
    assert.equal(days, null);
});

test('applyEstimate re-estimating the same task updates both the duration and the recorded inputs', () => {
    const first = est.applyEstimate('Phase\n  Task A\n', 'Task A', { mode: 'duration', optimistic: 1, mostLikely: 2, pessimistic: 5 });
    const second = est.applyEstimate(first.text, 'Task A', { mode: 'duration', optimistic: 2, mostLikely: 4, pessimistic: 10 });
    assert.equal(second.days, (2 + 16 + 10) / 6);
    const records = est.parseEstimatesMarkdown(est.extractEstimatesFromPlanText(second.text));
    assert.equal(records.length, 1, 're-estimating updates the existing row rather than adding a second one');
    assert.equal(records[0].optimistic, '2');
});

test('applyEstimate never mutates other tasks or sections in the plan', () => {
    const before = [
        'Phase 1',
        '  Task A',
        '  Task B 4d @alice',
        '',
        '---raid log---',
        '| ID | Type | Title |',
        '|----|------|-------|',
        '| 1  | Risk | Test  |',
    ].join('\n');
    const { text } = est.applyEstimate(before, 'Task A', { mode: 'duration', optimistic: 1, mostLikely: 2, pessimistic: 5 });
    assert.ok(text.includes('Task B 4d @alice'));
    assert.ok(text.includes('| 1  | Risk | Test  |'));
});
