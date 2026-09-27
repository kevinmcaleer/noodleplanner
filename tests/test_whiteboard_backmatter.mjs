/**
 * Tests for the ---whiteboard--- back-matter section (issue #844).
 *
 * This is the storage-format foundation for the whiteboard/todo-list view
 * (epic #840): a note's position, colour, and size have to round-trip
 * through the plan text like every other back-matter section, so the
 * board looks the same on another machine or after a save/reload. No
 * canvas, no notes, no rendering is built here -- see #845/#846 for that.
 *
 * Covers the JS-side helpers in static/script.js (parseWhiteboardMarkdown,
 * generateWhiteboardText, extractWhiteboardFromPlanText,
 * updatePlanWhiteboardText, renamePlanWhiteboardTask,
 * validateWhiteboardRows), the ---whiteboard--- marker handling in
 * mergeDuplicateSections, and confirms the browser scheduling engine's
 * planBody() (engine/local-parse.js) already stops the task outline at a
 * ---whiteboard--- marker via its generic `^---[a-z][a-z -]*---$` marker
 * regex, with no code change needed there.
 *
 * Run with: node --test tests/test_whiteboard_backmatter.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import backMatter from '../packages/noodle-web/src/noodle_web/static/back-matter-markers.js';

import { planBody } from '../packages/noodle-web/src/noodle_web/static/engine/local-parse.js';
import { scheduleTasksFromText } from '../packages/noodle-web/src/noodle_web/static/engine/scheduler.js';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const staticDir = join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'static');

/** Top-level `function name(` ... `\n}` declarations from a classic script. */
function liftFunctions(sandbox, file, names) {
  const source = readFileSync(join(staticDir, file), 'utf8');
  for (const name of names) {
    const start = source.indexOf(`\nfunction ${name}(`);
    assert.notEqual(start, -1, `${name} not found in ${file}`);
    const end = source.indexOf('\n}\n', start);
    assert.notEqual(end, -1, `${name} in ${file} has no closing brace at column 0`);
    vm.runInNewContext(source.slice(start, end + 3), sandbox);
  }
  return sandbox;
}

// The section-marker constants normally come from state.js (loaded before
// script.js in index.html). Seed them directly rather than lifting the
// whole file, since these are simple string literals.
const sandbox = {
  // The canonical back-matter marker list and section-boundary helpers,
  // from back-matter-markers.js (loaded before state.js in index.html).
  ...backMatter,
  HIGHLIGHTS_START: '---highlights---',
  HIGHLIGHTS_END: '---end-highlights---',
  BUDGET_START: '---budget---',
  RAID_LOG_START: '---raid log---',
  COMMS_START: '---comms---',
  BASELINE_START: '---baseline---',
  BENEFITS_START: '---benefits---',
  LESSONS_START: '---lessons learned---',
  WHITEBOARD_START: '---whiteboard---',
  PARKING_LOT_START: '---parking lot---',
};

liftFunctions(sandbox, 'script.js', [
  'extractWhiteboardFromPlanText',
  'parseWhiteboardMarkdown',
  'generateWhiteboardText',
  'validateWhiteboardRows',
  'updatePlanWhiteboardText',
  'renamePlanWhiteboardTask',
  'mergeDuplicateSections',
  'repairStrandedSeparator',
  'extractParkingLotFromPlanText',
  'parseParkingLotMarkdown',
  'generateParkingLotText',
  'updatePlanParkingLotText',
  'generateParkingLotDetailComment',
  'extractParkingLotDetailFromSectionText',
]);

const {
  extractWhiteboardFromPlanText, parseWhiteboardMarkdown, generateWhiteboardText,
  validateWhiteboardRows, updatePlanWhiteboardText, renamePlanWhiteboardTask,
  mergeDuplicateSections, repairStrandedSeparator, extractParkingLotFromPlanText, parseParkingLotMarkdown,
  generateParkingLotText, updatePlanParkingLotText,
  generateParkingLotDetailComment, extractParkingLotDetailFromSectionText,
} = sandbox;

/**
 * Structural-equality check via JSON, used instead of assert.deepEqual
 * whenever one side is a value returned by a lifted (vm-sandboxed)
 * function: such values live in a separate V8 realm, and
 * assert.deepEqual's stricter checks can spuriously reject them against
 * a same-realm literal even when the content is identical. JSON.stringify
 * is realm-agnostic, so this sidesteps the issue entirely.
 */
function eqJSON(actual, expected, message) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), message);
}

const SAMPLE_TABLE = [
  '| Task      | X   | Y  | Colour  | Width | Height | Collapsed |',
  '|-----------|-----|----|---------|-------|--------|-----------|',
  '| Discovery | 120 | 80 | #4A90D9 | 240   | 200    | no        |',
  '| Build     | 420 | 80 |         | 240   | 260    | no        |',
].join('\n');

// ---------------------------------------------------------------------------
// extractWhiteboardFromPlanText
// ---------------------------------------------------------------------------

test('extractWhiteboardFromPlanText returns empty string when absent', () => {
  assert.equal(extractWhiteboardFromPlanText('Phase 1\n  Task 1 3d'), '');
});

test('extractWhiteboardFromPlanText extracts the section body', () => {
  const text = 'Phase 1\n  Task 1 3d\n\n---whiteboard---\n' + SAMPLE_TABLE;
  const result = extractWhiteboardFromPlanText(text);
  assert.match(result, /Discovery/);
  assert.doesNotMatch(result, /---whiteboard---/);
});

test('extractWhiteboardFromPlanText stops before a later out-of-order section', () => {
  const text = 'Phase 1\n  Task 1 3d\n\n---whiteboard---\n' + SAMPLE_TABLE +
    '\n\n---baseline---\n| Task Name |\n|-----------|\n| Task 1 |';
  const result = extractWhiteboardFromPlanText(text);
  assert.match(result, /Discovery/);
  assert.doesNotMatch(result, /---baseline---/);
  assert.doesNotMatch(result, /Task Name/);
});

// ---------------------------------------------------------------------------
// parseWhiteboardMarkdown
// ---------------------------------------------------------------------------

test('parseWhiteboardMarkdown parses every column', () => {
  const items = parseWhiteboardMarkdown(SAMPLE_TABLE);
  eqJSON(items, [
    { task: 'Discovery', x: 120, y: 80, colour: '#4A90D9', width: 240, height: 200, collapsed: false },
    { task: 'Build', x: 420, y: 80, colour: '', width: 240, height: 260, collapsed: false },
  ]);
});

test('parseWhiteboardMarkdown returns [] for empty or table-less text', () => {
  eqJSON(parseWhiteboardMarkdown(''), []);
  eqJSON(parseWhiteboardMarkdown('no table here'), []);
});

test('parseWhiteboardMarkdown matches columns by name, not position, and ignores unknown columns', () => {
  const text = [
    '| Note ID | Y  | Task      | X   | Colour  |',
    '|---------|----|-----------|-----|---------|',
    '| 1       | 80 | Discovery | 120 | #4A90D9 |',
  ].join('\n');
  const items = parseWhiteboardMarkdown(text);
  eqJSON(items, [
    { task: 'Discovery', x: 120, y: 80, colour: '#4A90D9', width: null, height: null, collapsed: false },
  ]);
});

test('parseWhiteboardMarkdown: empty Width/Height are null, not zero', () => {
  const text = [
    '| Task | X | Y | Width | Height |',
    '|------|---|---|-------|--------|',
    '| A    | 1 | 2 |       |        |',
  ].join('\n');
  const items = parseWhiteboardMarkdown(text);
  assert.equal(items[0].width, null);
  assert.equal(items[0].height, null);
});

test('parseWhiteboardMarkdown: Collapsed yes/no maps to boolean', () => {
  const text = [
    '| Task | Collapsed |',
    '|------|-----------|',
    '| A    | yes       |',
    '| B    | no        |',
  ].join('\n');
  const items = parseWhiteboardMarkdown(text);
  assert.equal(items[0].collapsed, true);
  assert.equal(items[1].collapsed, false);
});

test('parseWhiteboardMarkdown: an orphan row (Task matches no summary task) is kept, not dropped', () => {
  const text = [
    '| Task           | X   | Y  |',
    '|----------------|-----|----|',
    '| Discovery      | 120 | 80 |',
    '| Old Phase Name | 420 | 80 |',
  ].join('\n');
  const items = parseWhiteboardMarkdown(text);
  eqJSON(items.map((i) => i.task), ['Discovery', 'Old Phase Name']);
});

test('parseWhiteboardMarkdown: a duplicate Task across two rows keeps both rows', () => {
  const text = [
    '| Task      | X   | Y   |',
    '|-----------|-----|-----|',
    '| Discovery | 120 | 80  |',
    '| Discovery | 500 | 300 |',
  ].join('\n');
  const items = parseWhiteboardMarkdown(text);
  assert.equal(items.length, 2);
  assert.equal(items[0].x, 120);
  assert.equal(items[1].x, 500);
});

// ---------------------------------------------------------------------------
// Free-floating text objects (issue #1018) -- Kind/Id/Text columns sharing
// the same table as post-it rows. See script.js's "Whiteboard back matter"
// header comment for why this is a second row shape in the same table
// rather than a second section.
// ---------------------------------------------------------------------------

const TEXT_TABLE = [
  '| Task | X   | Y  | Kind | Id      | Text          |',
  '|------|-----|----|------|---------|---------------|',
  '|      | 200 | 60 | text | t1a2b3c | Section label |',
].join('\n');

test('parseWhiteboardMarkdown: a Kind=text row parses to a text-object shape, not a post-it shape', () => {
  const items = parseWhiteboardMarkdown(TEXT_TABLE);
  eqJSON(items, [
    { kind: 'text', id: 't1a2b3c', text: 'Section label', x: 200, y: 60 },
  ]);
});

test('parseWhiteboardMarkdown: a Kind=text row with no Id is dropped (unlike a post-it row, it has nothing else to key off)', () => {
  const text = [
    '| Task | X | Y | Kind | Id | Text |',
    '|------|---|---|------|----|------|',
    '|      | 1 | 2 | text |    | Oops |',
  ].join('\n');
  eqJSON(parseWhiteboardMarkdown(text), []);
});

test('parseWhiteboardMarkdown: a text object round-trips embedded pipes and newlines', () => {
  const items = [{ kind: 'text', id: 't1', text: 'Line one\nLine two | with a pipe', x: 5, y: 9 }];
  const table = generateWhiteboardText(items);
  eqJSON(parseWhiteboardMarkdown(table), items);
});

test('parseWhiteboardMarkdown: a plan with only post-it rows (no Kind/Id/Text columns at all) parses exactly as before', () => {
  const items = parseWhiteboardMarkdown(SAMPLE_TABLE);
  eqJSON(items, [
    { task: 'Discovery', x: 120, y: 80, colour: '#4A90D9', width: 240, height: 200, collapsed: false },
    { task: 'Build', x: 420, y: 80, colour: '', width: 240, height: 260, collapsed: false },
  ]);
});

test('generateWhiteboardText: a list of only post-it items omits Kind/Id/Text columns entirely', () => {
  const items = parseWhiteboardMarkdown(SAMPLE_TABLE);
  const text = generateWhiteboardText(items);
  assert.doesNotMatch(text.split('\n')[0], /Kind|Id|Text/);
});

test('generateWhiteboardText: a mixed list of post-it and text-object rows round-trips both, each keeping its own shape', () => {
  const items = [
    { task: 'Discovery', x: 120, y: 80, colour: '#4A90D9', width: 240, height: 200, collapsed: false },
    { kind: 'text', id: 't1a2b3c', text: 'Section label', x: 200, y: 60 },
  ];
  const text = generateWhiteboardText(items);
  eqJSON(parseWhiteboardMarkdown(text), items);
});

test('updatePlanWhiteboardText: a text-object-only board round-trips through the plan', () => {
  const planText = 'Phase 1\n  Task 1 3d';
  const items = [{ kind: 'text', id: 't1', text: 'Margin question?', x: 10, y: 20 }];
  const result = updatePlanWhiteboardText(planText, items);
  const roundTripped = parseWhiteboardMarkdown(extractWhiteboardFromPlanText(result));
  eqJSON(roundTripped, items);
});

test('validateWhiteboardRows: a text-object row produces no orphan/duplicate warnings and does not throw', () => {
  const items = [
    { task: 'Discovery', x: 0, y: 0, colour: '', width: null, height: null, collapsed: false },
    { kind: 'text', id: 't1', text: 'A heading', x: 0, y: 0 },
  ];
  eqJSON(validateWhiteboardRows(items, ['Discovery']), []);
});

test('validateWhiteboardRows: two text-object rows never collide with each other', () => {
  const items = [
    { kind: 'text', id: 't1', text: 'One', x: 0, y: 0 },
    { kind: 'text', id: 't2', text: 'One', x: 10, y: 10 },
  ];
  eqJSON(validateWhiteboardRows(items), []);
});

// ---------------------------------------------------------------------------
// validateWhiteboardRows
// ---------------------------------------------------------------------------

test('validateWhiteboardRows: no warnings for valid, unique rows', () => {
  const items = parseWhiteboardMarkdown(SAMPLE_TABLE);
  eqJSON(validateWhiteboardRows(items, ['Discovery', 'Build']), []);
});

test('validateWhiteboardRows: orphan row produces a warning, items untouched', () => {
  const items = [
    { task: 'Discovery', x: 0, y: 0, colour: '', width: null, height: null, collapsed: false },
    { task: 'Old Phase Name', x: 0, y: 0, colour: '', width: null, height: null, collapsed: false },
  ];
  const warnings = validateWhiteboardRows(items, ['Discovery']);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].type, 'orphan');
  assert.equal(warnings[0].task, 'Old Phase Name');
  assert.equal(items.length, 2);
});

test('validateWhiteboardRows: duplicate Task produces one warning covering both rows', () => {
  const items = [
    { task: 'Discovery', x: 1, y: 1, colour: '', width: null, height: null, collapsed: false },
    { task: 'Discovery', x: 2, y: 2, colour: '', width: null, height: null, collapsed: false },
  ];
  const warnings = validateWhiteboardRows(items);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].type, 'duplicate');
  assert.match(warnings[0].message, /later row wins/);
});

test('validateWhiteboardRows: Task is matched case-insensitively (dependency-resolution convention)', () => {
  const items = [
    { task: 'discovery', x: 0, y: 0, colour: '', width: null, height: null, collapsed: false },
  ];
  eqJSON(validateWhiteboardRows(items, ['Discovery']), []);
});

test('validateWhiteboardRows: duplicate detection is case-insensitive', () => {
  const items = [
    { task: 'Discovery', x: 1, y: 1, colour: '', width: null, height: null, collapsed: false },
    { task: 'discovery', x: 2, y: 2, colour: '', width: null, height: null, collapsed: false },
  ];
  const warnings = validateWhiteboardRows(items);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].type, 'duplicate');
});

// ---------------------------------------------------------------------------
// generateWhiteboardText / round trip
// ---------------------------------------------------------------------------

test('generateWhiteboardText: empty list returns empty string', () => {
  assert.equal(generateWhiteboardText([]), '');
});

test('generateWhiteboardText round-trips through parseWhiteboardMarkdown', () => {
  const items = parseWhiteboardMarkdown(SAMPLE_TABLE);
  const text = generateWhiteboardText(items);
  eqJSON(parseWhiteboardMarkdown(text), items);
});

// ---------------------------------------------------------------------------
// updatePlanWhiteboardText
// ---------------------------------------------------------------------------

test('updatePlanWhiteboardText appends a new section', () => {
  const text = 'Phase 1\n  Task 1 3d';
  const items = [{ task: 'Phase 1', x: 10, y: 20, colour: '', width: null, height: null, collapsed: false }];
  const result = updatePlanWhiteboardText(text, items);
  assert.match(result, /---whiteboard---/);
  assert.match(result, /Phase 1/);
});

test('updatePlanWhiteboardText replaces an existing section without touching others', () => {
  const text = 'Phase 1\n  Task 1 3d\n\n---raid log---\n| Type | Description |\n|------|-------------|\n| risk | R1 |' +
    '\n\n---whiteboard---\n' + SAMPLE_TABLE;
  const items = [{ task: 'Phase 1', x: 1, y: 1, colour: '', width: null, height: null, collapsed: false }];
  const result = updatePlanWhiteboardText(text, items);
  assert.equal((result.match(/---whiteboard---/g) || []).length, 1);
  assert.doesNotMatch(result, /Discovery/);
  assert.match(result, /Phase 1/);
  assert.match(result, /---raid log---/);
  assert.match(result, /R1/);
});

test('updatePlanWhiteboardText with an empty items list removes the section', () => {
  const text = 'Phase 1\n  Task 1 3d\n\n---whiteboard---\n' + SAMPLE_TABLE;
  const result = updatePlanWhiteboardText(text, []);
  assert.doesNotMatch(result, /---whiteboard---/);
  assert.equal(result.trim(), 'Phase 1\n  Task 1 3d');
});

// ---------------------------------------------------------------------------
// renamePlanWhiteboardTask -- rename sync (issue #844)
// ---------------------------------------------------------------------------

test('renamePlanWhiteboardTask updates a matching row', () => {
  const text = 'Phase A\n  Task 1 3d\n\n---whiteboard---\n' + SAMPLE_TABLE;
  const result = renamePlanWhiteboardTask(text, 'Discovery', 'Investigation');
  const items = parseWhiteboardMarkdown(extractWhiteboardFromPlanText(result));
  const taskNames = items.map((i) => i.task).sort();
  eqJSON(taskNames, ['Build', 'Investigation'].sort());
});

test('renamePlanWhiteboardTask updates every row that matches (duplicate names)', () => {
  const text = 'Phase A\n  Task 1 3d\n\n---whiteboard---\n' +
    '| Task      | X   | Y   |\n|-----------|-----|-----|\n| Discovery | 1   | 1   |\n| Discovery | 2   | 2   |';
  const result = renamePlanWhiteboardTask(text, 'Discovery', 'Investigation');
  const items = parseWhiteboardMarkdown(extractWhiteboardFromPlanText(result));
  assert.equal(items.length, 2);
  assert.ok(items.every((i) => i.task === 'Investigation'));
});

test('renamePlanWhiteboardTask is a no-op when there is no whiteboard section', () => {
  const text = 'Phase A\n  Task 1 3d';
  assert.equal(renamePlanWhiteboardTask(text, 'Phase A', 'Phase B'), text);
});

test('renamePlanWhiteboardTask is a no-op when no row matches the old name', () => {
  const text = 'Phase A\n  Task 1 3d\n\n---whiteboard---\n' + SAMPLE_TABLE;
  assert.equal(renamePlanWhiteboardTask(text, 'Nonexistent', 'Whatever'), text);
});

test('renamePlanWhiteboardTask leaves other back-matter sections untouched', () => {
  const text = 'Phase A\n  Task 1 3d\n\n---raid log---\n| Type | Description |\n|------|-------------|\n| risk | R1 |' +
    '\n\n---whiteboard---\n' + SAMPLE_TABLE;
  const result = renamePlanWhiteboardTask(text, 'Discovery', 'Investigation');
  assert.match(result, /---raid log---/);
  assert.match(result, /R1/);
});

// ---------------------------------------------------------------------------
// mergeDuplicateSections -- loading two plans at once (issue #844)
// ---------------------------------------------------------------------------

test('mergeDuplicateSections merges duplicate ---whiteboard--- markers, keeping the first', () => {
  const text = [
    'Phase A',
    '  Task 1 3d',
    '',
    '---whiteboard---',
    '| Task | X | Y |',
    '|------|---|---|',
    '| Phase A | 1 | 2 |',
    '',
    '---whiteboard---',
    '| Task | X | Y |',
    '|------|---|---|',
    '| Phase B | 3 | 4 |',
  ].join('\n');

  const result = mergeDuplicateSections(text);
  assert.equal((result.match(/---whiteboard---/g) || []).length, 1);
  assert.match(result, /Phase A[^\n]*\| 1 \| 2 \|/);
  assert.doesNotMatch(result, /Phase B/);
});

// ---------------------------------------------------------------------------
// planBody() (engine/local-parse.js) -- the browser scheduling engine must
// never read the whiteboard table as tasks.
// ---------------------------------------------------------------------------

test('planBody stops the task outline at a ---whiteboard--- marker', () => {
  const plan = [
    '---',
    'title: Test',
    '---',
    'Phase A',
    '  Task A1 2d @jd',
    '  Task A2 3d',
    '',
    '---whiteboard---',
    SAMPLE_TABLE,
  ].join('\n');
  const body = planBody(plan);
  assert.equal(body.trim(), 'Phase A\n  Task A1 2d @jd\n  Task A2 3d');
});

test('end-to-end: the local scheduler never produces a task from a whiteboard row', () => {
  const plan = [
    '---',
    'title: Test',
    '---',
    'Task A 2d',
    'Task B 3d',
    '',
    '---whiteboard---',
    SAMPLE_TABLE,
  ].join('\n');
  const tasks = scheduleTasksFromText(planBody(plan), { today: '2026-06-01' });
  const names = tasks.map((t) => t.name);
  assert.deepEqual(names, ['Task A', 'Task B']);
});

test('a plan with a whiteboard section schedules the same tasks as the same plan without one', () => {
  const withoutWhiteboard = ['Task A 2d', 'Task B 3d'].join('\n');
  const withWhiteboard = withoutWhiteboard + '\n\n---whiteboard---\n' + SAMPLE_TABLE;

  const namesWithout = scheduleTasksFromText(planBody(withoutWhiteboard), { today: '2026-06-01' }).map((t) => t.name);
  const namesWith = scheduleTasksFromText(planBody(withWhiteboard), { today: '2026-06-01' }).map((t) => t.name);
  assert.deepEqual(namesWith, namesWithout);
});

// ---------------------------------------------------------------------------
// Parking lot (issue #1019) -- the "good idea, not now" holding pen.
// Canonically the section *after* ---whiteboard---, so every whiteboard
// helper above must stop at a following ---parking lot--- marker instead
// of swallowing it (mirrors this file's own whiteboard-vs-baseline
// ordering coverage).
// ---------------------------------------------------------------------------

const PARKING_LOT_TABLE = [
  '| ID | Text                   | Date Parked |',
  '|----|------------------------|-------------|',
  '| 1  | Explore a mobile app   | 2026-03-01  |',
  '| 2  | Ask about extra budget |             |',
].join('\n');

test('extractWhiteboardFromPlanText stops before a following ---parking lot--- section', () => {
  const text = 'Phase 1\n  Task 1 3d\n\n---whiteboard---\n' + SAMPLE_TABLE +
    '\n\n---parking lot---\n' + PARKING_LOT_TABLE;
  const result = extractWhiteboardFromPlanText(text);
  assert.match(result, /Discovery/);
  assert.doesNotMatch(result, /---parking lot---/);
  assert.doesNotMatch(result, /Explore a mobile app/);
});

test('updatePlanWhiteboardText preserves a following ---parking lot--- section', () => {
  const text = 'Phase 1\n  Task 1 3d\n\n---whiteboard---\n' + SAMPLE_TABLE +
    '\n\n---parking lot---\n' + PARKING_LOT_TABLE;
  const items = [{ task: 'Phase 1', x: 1, y: 1, colour: '', width: null, height: null, collapsed: false }];
  const result = updatePlanWhiteboardText(text, items);
  assert.match(result, /---parking lot---/);
  assert.match(result, /Explore a mobile app/);
  assert.ok(result.indexOf('---whiteboard---') < result.indexOf('---parking lot---'));
});

test('extractParkingLotFromPlanText returns empty string when absent', () => {
  assert.equal(extractParkingLotFromPlanText('Phase 1\n  Task 1 3d'), '');
});

test('extractParkingLotFromPlanText extracts the section body', () => {
  const text = 'Phase 1\n  Task 1 3d\n\n---parking lot---\n' + PARKING_LOT_TABLE;
  const result = extractParkingLotFromPlanText(text);
  assert.match(result, /Explore a mobile app/);
  assert.doesNotMatch(result, /---parking lot---/);
});

test('parseParkingLotMarkdown parses every column', () => {
  const items = parseParkingLotMarkdown(PARKING_LOT_TABLE);
  eqJSON(items, [
    { id: 1, text: 'Explore a mobile app', date_parked: '2026-03-01' },
    { id: 2, text: 'Ask about extra budget', date_parked: '' },
  ]);
});

test('parseParkingLotMarkdown returns [] for empty or table-less text', () => {
  eqJSON(parseParkingLotMarkdown(''), []);
  eqJSON(parseParkingLotMarkdown('no table here'), []);
});

test('parseParkingLotMarkdown matches columns by name, not position', () => {
  const text = [
    '| Date Parked | Text         | ID |',
    '|--------------|--------------|----|',
    '| 2026-04-01   | A stray idea | 5  |',
  ].join('\n');
  const items = parseParkingLotMarkdown(text);
  eqJSON(items, [{ id: 5, text: 'A stray idea', date_parked: '2026-04-01' }]);
});

test('parseParkingLotMarkdown: a row with no Text is skipped', () => {
  const text = [
    '| ID | Text | Date Parked |',
    '|----|------|-------------|',
    '| 1  |      | 2026-01-01  |',
  ].join('\n');
  eqJSON(parseParkingLotMarkdown(text), []);
});

test('generateParkingLotText: empty list returns empty string', () => {
  assert.equal(generateParkingLotText([]), '');
});

test('generateParkingLotText round-trips through parseParkingLotMarkdown', () => {
  const items = parseParkingLotMarkdown(PARKING_LOT_TABLE);
  const text = generateParkingLotText(items);
  eqJSON(parseParkingLotMarkdown(text), items);
});

test('generateParkingLotText escapes a pipe in Text', () => {
  const items = [{ id: 1, text: 'A | B', date_parked: '' }];
  const text = generateParkingLotText(items);
  assert.match(text, /A \\\| B/);
  assert.equal(parseParkingLotMarkdown(text)[0].text, 'A | B');
});

test('updatePlanParkingLotText appends a new section', () => {
  const text = 'Phase 1\n  Task 1 3d';
  const items = [{ id: 1, text: 'A good idea', date_parked: '2026-01-01' }];
  const result = updatePlanParkingLotText(text, items);
  assert.match(result, /---parking lot---/);
  assert.match(result, /A good idea/);
});

test('updatePlanParkingLotText replaces an existing section without touching others', () => {
  const text = 'Phase 1\n  Task 1 3d\n\n---raid log---\n| Type | Description |\n|------|-------------|\n| risk | R1 |' +
    '\n\n---parking lot---\n' + PARKING_LOT_TABLE;
  const items = [{ id: 1, text: 'Replacement idea', date_parked: '' }];
  const result = updatePlanParkingLotText(text, items);
  assert.equal((result.match(/---parking lot---/g) || []).length, 1);
  assert.doesNotMatch(result, /Explore a mobile app/);
  assert.match(result, /Replacement idea/);
  assert.match(result, /---raid log---/);
  assert.match(result, /R1/);
});

test('updatePlanParkingLotText with an empty items list removes the section', () => {
  const text = 'Phase 1\n  Task 1 3d\n\n---parking lot---\n' + PARKING_LOT_TABLE;
  const result = updatePlanParkingLotText(text, []);
  assert.doesNotMatch(result, /---parking lot---/);
  assert.equal(result.trim(), 'Phase 1\n  Task 1 3d');
});

test('mergeDuplicateSections merges duplicate ---parking lot--- markers, keeping the first', () => {
  const text = [
    'Phase A',
    '  Task 1 3d',
    '',
    '---parking lot---',
    '| ID | Text | Date Parked |',
    '|----|------|-------------|',
    '| 1  | Idea A |           |',
    '',
    '---parking lot---',
    '| ID | Text | Date Parked |',
    '|----|------|-------------|',
    '| 1  | Idea B |           |',
  ].join('\n');

  const result = mergeDuplicateSections(text);
  assert.equal((result.match(/---parking lot---/g) || []).length, 1);
  assert.match(result, /Idea A/);
  assert.doesNotMatch(result, /Idea B/);
});

test('planBody stops the task outline at a ---parking lot--- marker', () => {
  const plan = [
    '---',
    'title: Test',
    '---',
    'Phase A',
    '  Task A1 2d @jd',
    '  Task A2 3d',
    '',
    '---parking lot---',
    PARKING_LOT_TABLE,
  ].join('\n');
  const body = planBody(plan);
  assert.equal(body.trim(), 'Phase A\n  Task A1 2d @jd\n  Task A2 3d');
});

test('a plan with a parking lot section schedules the same tasks as the same plan without one', () => {
  const without = ['Task A 2d', 'Task B 3d'].join('\n');
  const withParkingLot = without + '\n\n---parking lot---\n' + PARKING_LOT_TABLE;

  const namesWithout = scheduleTasksFromText(planBody(without), { today: '2026-06-01' }).map((t) => t.name);
  const namesWith = scheduleTasksFromText(planBody(withParkingLot), { today: '2026-06-01' }).map((t) => t.name);
  assert.deepEqual(namesWith, namesWithout);
});

// ---------------------------------------------------------------------------
// repairStrandedSeparator -- plans whose new notes were inserted beneath the
// `---` ahead of ---highlights--- (fixed for new notes by #1303) are
// repaired when they load.
// ---------------------------------------------------------------------------

const HIGHLIGHTS_TAIL = '---highlights---\n## 2026-01-01 @kev\nAll good\n\n---end-highlights---\n';

test('repairStrandedSeparator moves a stranded --- back below the outline', () => {
  const broken = '---\ntitle: T\n---\n\nPhase A\n  Task 1 3d\n\n---\n\nNew idea\n  Child 1d\n\n' + HIGHLIGHTS_TAIL;
  const repaired = repairStrandedSeparator(broken);
  assert.equal(repaired,
    '---\ntitle: T\n---\n\nPhase A\n  Task 1 3d\n\nNew idea\n  Child 1d\n\n---\n\n' + HIGHLIGHTS_TAIL);

  const names = (plan) => scheduleTasksFromText(planBody(plan), { today: '2026-06-01' }).map((t) => t.name);
  assert.ok(names(broken).includes('---'), 'the broken plan schedules a phantom "---" task');
  assert.ok(!names(repaired).includes('---'), 'the repaired plan does not');
  assert.ok(names(repaired).includes('Child'), 'the note\'s tasks survive the repair');
});

test('repairStrandedSeparator leaves a well-formed plan byte-for-byte unchanged', () => {
  const clean = 'Phase A\n  Task 1 3d\n\n---\n\n' + HIGHLIGHTS_TAIL;
  assert.equal(repairStrandedSeparator(clean), clean);
  const noSeparator = 'Phase A\n  Task 1 3d\n';
  assert.equal(repairStrandedSeparator(noSeparator), noSeparator);
});

test('repairStrandedSeparator only touches the outline, not the back matter', () => {
  const ruleInHighlights = 'Phase A\n\n---\n\n---highlights---\n## 2026-01-01 @kev\nfoo\n---\nbar\n\n---end-highlights---\n';
  assert.equal(repairStrandedSeparator(ruleInHighlights), ruleInHighlights);
});

test('repairStrandedSeparator handles a plan with no back matter', () => {
  assert.equal(repairStrandedSeparator('A\n---\nB\n'), 'A\nB\n\n---\n');
});

test('repairStrandedSeparator leaves an unclosed front-matter fence alone', () => {
  const unclosed = '---\ntitle: x\nTask A\n';
  assert.equal(repairStrandedSeparator(unclosed), unclosed);
});
