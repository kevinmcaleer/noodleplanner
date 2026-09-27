/**
 * The project workbook as a sync target (#1138): the workbook Report > Share >
 * Excel exports can be edited in Excel and synced back into the plan.
 *
 * These drive the whole round trip through the real pieces -- the local
 * parser, the browser workbook builder and ExcelJS -- because the thing that
 * can go wrong is the seam between them: a row that no longer matches its
 * task, a computed cell mistaken for an edit, a percent Excel stored as 0.5.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';

import { localParse } from '../packages/noodle-web/src/noodle_web/static/engine/local-parse.js';
import { createPlanWorkbook } from '../packages/noodle-web/src/noodle_web/static/browser-excel.js';
import {
  WORKBOOK_SYNC_SHEET,
  applyWorkbookTaskDiff,
  buildSyncRows,
  defaultWorkbookSyncChoice,
  diffWorkbookTasks,
  parsePlanTasks,
  percentFromCell,
  readWorkbookTasks,
  setLineComment,
  setLinePercent,
} from '../packages/noodle-web/src/noodle_web/static/workbook-sync.js';

const FRONT = '---\ntitle: Office move\nstart date: 2026-01-05\n---\n';
const BODY = [
  'Design',
  '  Wireframes 3d 50% "check with Sam"',
  '  Review 2d',
  'Build',
  '  API 3d ~2h/4h',
  '  UI 4d',
].join('\n');

async function exported(body = BODY) {
  const parse = localParse(FRONT + body);
  assert.ok(parse.success);
  const workbook = await createPlanWorkbook(parse, { ExcelJS, now: new Date(2026, 0, 6) });
  // Through bytes and back, as a file on disk would be.
  const reloaded = new ExcelJS.Workbook();
  await reloaded.xlsx.load(await workbook.xlsx.writeBuffer());
  return reloaded;
}

function tasksSheetRow(workbook, name) {
  const sheet = workbook.getWorksheet('Tasks');
  let found = null;
  sheet.eachRow((row) => { if (String(row.getCell(2).value).trim() === name) found = row; });
  assert.ok(found, `no Tasks row named ${name}`);
  return found;
}

const choicesFor = (diff, overrides = {}) =>
  Object.fromEntries(diff.entries.map((e) => [e.key, overrides[e.name] ?? defaultWorkbookSyncChoice(e.kind)]));

test('an untouched export has nothing to sync', async () => {
  const diff = diffWorkbookTasks(BODY, readWorkbookTasks(await exported()));
  assert.deepEqual(diff.entries, []);
  assert.equal(diff.hasBase, true);
});

test('the hidden sheet records each row id, path and synced values', async () => {
  const rows = buildSyncRows(localParse(FRONT + BODY).tasks);
  assert.deepEqual(rows[1], { id: 2, path: 'design › wireframes', percent: 50, comment: 'check with Sam' });
  const workbook = await exported();
  assert.equal(workbook.getWorksheet(WORKBOOK_SYNC_SHEET).state, 'veryHidden');
});

test('a percent and comment edited in Excel come back as updates and apply', async () => {
  const workbook = await exported();
  tasksSheetRow(workbook, 'Review').getCell(7).value = 100;
  tasksSheetRow(workbook, 'Wireframes').getCell(12).value = 'Sam signed off';
  const diff = diffWorkbookTasks(BODY, readWorkbookTasks(workbook));
  assert.deepEqual(diff.entries.map((e) => [e.kind, e.name, e.fields.map((f) => f.field)]), [
    ['updated', 'Wireframes', ['comment']],
    ['updated', 'Review', ['percent']],
  ]);
  const next = applyWorkbookTaskDiff(BODY, diff, choicesFor(diff));
  assert.equal(next, [
    'Design',
    '  Wireframes 3d 50% "Sam signed off"',
    '  Review 2d 100%',
    'Build',
    '  API 3d ~2h/4h',
    '  UI 4d',
  ].join('\n'));
});

test('a change made only in the plan since the export is not undone', async () => {
  const workbook = await exported();
  const planMovedOn = BODY.replace('Wireframes 3d 50%', 'Wireframes 3d 80%');
  assert.deepEqual(diffWorkbookTasks(planMovedOn, readWorkbookTasks(workbook)).entries, []);
});

test('the same field changed on both sides is a conflict that defaults to the plan', async () => {
  const workbook = await exported();
  tasksSheetRow(workbook, 'Wireframes').getCell(7).value = 60;
  const planMovedOn = BODY.replace('Wireframes 3d 50%', 'Wireframes 3d 80%');
  const diff = diffWorkbookTasks(planMovedOn, readWorkbookTasks(workbook));
  assert.equal(diff.entries.length, 1);
  const [entry] = diff.entries;
  assert.equal(entry.kind, 'conflict');
  assert.deepEqual(entry.fields[0], { field: 'percent', local: 80, external: 60, base: 50, conflict: true });
  assert.equal(applyWorkbookTaskDiff(planMovedOn, diff, choicesFor(diff)), planMovedOn, 'keep-mine by default');
  const theirs = applyWorkbookTaskDiff(planMovedOn, diff, { [entry.key]: 'keep-theirs' });
  assert.match(theirs, /Wireframes 3d 60%/);
});

test('computed cells and derived percents are export-only', async () => {
  const workbook = await exported();
  tasksSheetRow(workbook, 'Design').getCell(7).value = 99; // a summary: rolled up
  tasksSheetRow(workbook, 'API').getCell(7).value = 90;    // effort-tracked
  tasksSheetRow(workbook, 'UI').getCell(3).value = '2027-01-01'; // Start
  tasksSheetRow(workbook, 'UI').getCell(5).value = 40;     // Duration
  tasksSheetRow(workbook, 'UI').getCell(9).value = 'Urgent'; // Priority
  assert.deepEqual(diffWorkbookTasks(BODY, readWorkbookTasks(workbook)).entries, []);
});

test('a percent typed as 50% (stored 0.5, percent format) reads as 50', () => {
  assert.equal(percentFromCell(0.5, '0%'), 50);
  assert.equal(percentFromCell(50, 'General'), 50);
  assert.equal(percentFromCell('75%'), 75);
  assert.equal(percentFromCell(''), 0);
  assert.equal(percentFromCell({ formula: 'A1', result: 30 }), 30);
  assert.equal(percentFromCell('done'), null);
});

test('a row matched by id survives its name being re-indented in Excel', async () => {
  const workbook = await exported();
  const row = tasksSheetRow(workbook, 'Review');
  row.getCell(2).value = 'Review'; // indentation stripped: would read as top level
  row.getCell(7).value = 100;
  const diff = diffWorkbookTasks(BODY, readWorkbookTasks(workbook));
  assert.deepEqual(diff.entries.map((e) => [e.kind, e.path]), [['updated', 'design › review']]);
});

test('a row added in Excel becomes a new task in the right place', async () => {
  const workbook = await exported();
  const sheet = workbook.getWorksheet('Tasks');
  // A new child of Design, typed under Review the way the export indents.
  sheet.spliceRows(5, 0, ['', '    Sign-off', '', '', '', '', 20, '', '', '', '', 'by Friday']);
  // And a new top-level task at the very end.
  sheet.addRow(['', 'Handover', '', '', '', '', '', '', '', '', '', '']);
  const diff = diffWorkbookTasks(BODY, readWorkbookTasks(workbook));
  assert.deepEqual(diff.entries.map((e) => [e.kind, e.name]), [['added', 'Sign-off'], ['added', 'Handover']]);
  const next = applyWorkbookTaskDiff(BODY, diff, choicesFor(diff));
  assert.equal(next, [
    'Design',
    '  Wireframes 3d 50% "check with Sam"',
    '  Review 2d',
    '  Sign-off 20% "by Friday"',
    'Build',
    '  API 3d ~2h/4h',
    '  UI 4d',
    'Handover',
  ].join('\n'));
  assert.ok(localParse(FRONT + next).success);
});

test('a new top-level row after a nested one does not adopt its later siblings', () => {
  const body = 'A\n  A1\n  A2\nB';
  const read = {
    rows: [
      { rowNumber: 2, id: 1, name: 'A', depth: 2, percent: 0, comment: '' },
      { rowNumber: 3, id: 2, name: 'A1', depth: 4, percent: 0, comment: '' },
      { rowNumber: 4, id: null, name: 'New', depth: 2, percent: 0, comment: '' },
      { rowNumber: 5, id: 3, name: 'A2', depth: 4, percent: 0, comment: '' },
      { rowNumber: 6, id: 4, name: 'B', depth: 2, percent: 0, comment: '' },
    ],
    base: [
      { id: 1, path: 'a', percent: 0, comment: '' },
      { id: 2, path: 'a › a1', percent: 0, comment: '' },
      { id: 3, path: 'a › a2', percent: 0, comment: '' },
      { id: 4, path: 'b', percent: 0, comment: '' },
    ],
  };
  // readWorkbookTasks assigns paths; do the same here.
  const withPaths = { ...read, rows: read.rows };
  const stack = [];
  for (const r of withPaths.rows) {
    while (stack.length && stack.at(-1).depth >= r.depth) stack.pop();
    r.parentPath = stack.length ? stack.at(-1).path : '';
    r.path = (r.parentPath ? r.parentPath + ' › ' : '') + r.name.toLowerCase();
    stack.push(r);
  }
  const diff = diffWorkbookTasks(body, withPaths);
  assert.deepEqual(diff.entries.map((e) => [e.kind, e.path]), [['added', 'new']]);
  assert.equal(applyWorkbookTaskDiff(body, diff, choicesFor(diff)), 'A\n  A1\n  A2\nNew\nB');
});

test('a row deleted in Excel is offered as a removal, unticked by default', async () => {
  const workbook = await exported();
  const sheet = workbook.getWorksheet('Tasks');
  sheet.spliceRows(tasksSheetRow(workbook, 'Review').number, 1);
  const diff = diffWorkbookTasks(BODY, readWorkbookTasks(workbook));
  assert.deepEqual(diff.entries.map((e) => [e.kind, e.name]), [['removed', 'Review']]);
  assert.equal(applyWorkbookTaskDiff(BODY, diff, choicesFor(diff)), BODY);
  const removed = applyWorkbookTaskDiff(BODY, diff, { [diff.entries[0].key]: 'accept' });
  assert.doesNotMatch(removed, /Review/);
});

test('removing a summary removes its subtree', () => {
  const body = 'A\n  A1\n    A1a\n  A2\nB';
  const nodes = parsePlanTasks(body);
  const diff = { entries: [{ kind: 'removed', key: 'k', path: nodes[1].path }] };
  assert.equal(applyWorkbookTaskDiff(body, diff, { k: 'accept' }), 'A\n  A2\nB');
});

test('a task deleted from the plan since the export is not resurrected', async () => {
  const workbook = await exported();
  tasksSheetRow(workbook, 'Review').getCell(7).value = 100;
  const planWithout = BODY.replace('  Review 2d\n', '');
  const diff = diffWorkbookTasks(planWithout, readWorkbookTasks(workbook));
  assert.deepEqual(diff.entries, []);
  assert.equal(diff.unmatched, 1);
});

test('without the hidden sheet, the stored snapshot is the base', async () => {
  const workbook = await exported();
  const base = readWorkbookTasks(workbook).base;
  workbook.removeWorksheet(workbook.getWorksheet(WORKBOOK_SYNC_SHEET).id);
  tasksSheetRow(workbook, 'Review').getCell(7).value = 100;
  const read = readWorkbookTasks(workbook);
  assert.equal(read.base, null);
  const diff = diffWorkbookTasks(BODY, read, base);
  assert.deepEqual(diff.entries.map((e) => e.kind), ['updated']);
});

test('with no base at all, every difference is a conflict', async () => {
  const workbook = await exported();
  workbook.removeWorksheet(workbook.getWorksheet(WORKBOOK_SYNC_SHEET).id);
  tasksSheetRow(workbook, 'Review').getCell(7).value = 100;
  const diff = diffWorkbookTasks(BODY, readWorkbookTasks(workbook));
  assert.equal(diff.hasBase, false);
  assert.deepEqual(diff.entries.map((e) => [e.kind, defaultWorkbookSyncChoice(e.kind)]), [['conflict', 'keep-mine']]);
});

test('a workbook with no Tasks sheet is refused', async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('RAID Log');
  assert.throws(() => readWorkbookTasks(workbook), /no Tasks sheet/);
});

test('line edits touch only the task\'s own percent and note', () => {
  assert.equal(setLinePercent('Task 3d 40%', 70), 'Task 3d 70%');
  assert.equal(setLinePercent('Task 3d', 70), 'Task 3d 70%');
  assert.equal(setLinePercent('Task 3d', 0), 'Task 3d');
  assert.equal(setLinePercent('Task 3d p40', 70), 'Task 3d 70%');
  assert.equal(setLinePercent('Task @jd[50%] 3d "20% done"', 70), 'Task @jd[50%] 3d "20% done" 70%');
  assert.equal(setLineComment('Task 3d "old"', 'new'), 'Task 3d "new"');
  assert.equal(setLineComment('Task 3d !"pinned"', 'new'), 'Task 3d !"new"');
  assert.equal(setLineComment('Task 3d', 'a "quoted" word'), 'Task 3d "a ”quoted” word"');
  assert.equal(setLineComment('Task 3d "old" @jd', ''), 'Task 3d @jd');
  assert.equal(setLineComment('Task 3d', ''), 'Task 3d');
});
