/**
 * Tests for the one canonical back-matter marker list
 * (static/back-matter-markers.js) and the readers/writers that used to
 * carry their own hand-copied lists.
 *
 * Those copies drifted: `---parking lot---` (#1019) and `---estimates---`
 * (#1053) never reached most of them, and a marker a reader does not know
 * is read as the tail of whatever section precedes it. estimating.js
 * appends ---estimates--- at the very end, typically right after
 * ---whiteboard---, so its rows parsed as whiteboard notes (a phantom
 * "Task" note, O/M values used as x/y), the next note drag rewrote the
 * whiteboard section *including* them and so deleted the estimates, the
 * RAID reader grew phantom items "Most Likely" and "2d", the MS Project
 * merge dropped both sections, and the trend report counted estimate rows
 * as tasks.
 *
 * Run with: node --test tests/test_back_matter_markers.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';

import {
  mergeImportedTasks,
  extractBackMatterSections,
  stripBackMatterSections,
} from '../packages/noodle-web/src/noodle_web/static/msproject-sync.js';
import {
  buildRaidSnapshot,
  spliceRaidSection,
} from '../packages/noodle-web/src/noodle_web/static/collab-backmatter-ops.js';

const require = createRequire(import.meta.url);
const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const staticDir = join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'static');
const backMatter = require(join(staticDir, 'back-matter-markers.js'));
const Estimating = require(join(staticDir, 'estimating.js'));

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

// state.js's own per-section marker constants, read out of the file rather
// than re-typed here, so the sandbox sees exactly what the browser does.
const stateSource = readFileSync(join(staticDir, 'state.js'), 'utf8');
const stateMarkers = {};
for (const m of stateSource.matchAll(/^const (\w+) = '(---[a-z][a-z -]*---)';$/gm)) {
  stateMarkers[m[1]] = m[2];
}

const sandbox = { console, ...stateMarkers, ...backMatter };
liftFunctions(sandbox, 'script.js', [
  'extractWhiteboardFromPlanText',
  'parseWhiteboardMarkdown',
  'generateWhiteboardText',
  'updatePlanWhiteboardText',
  'extractParkingLotFromPlanText',
  'parseParkingLotMarkdown',
  'generateParkingLotText',
  'updatePlanParkingLotText',
  'generateParkingLotDetailComment',
  'extractParkingLotDetailFromSectionText',
  'extractRaidLogFromPlanText',
  'extractCommsFromPlanText',
  'extractHighlightsFromText',
  'extractBaselineSectionText',
]);
liftFunctions(sandbox, 'trend-report.js', ['cleanTaskName', 'extractTasksFromPlanText']);
liftFunctions(sandbox, 'views-tables.js', ['extractCompletionFromPlanText']);
liftFunctions(sandbox, 'lessons.js', ['extractLessonsFromPlanText']);

const structure = { console, ...backMatter };
vm.createContext(structure);
vm.runInContext(readFileSync(join(staticDir, 'task-tokenizer.js'), 'utf8'), structure);
vm.runInContext(readFileSync(join(staticDir, 'whiteboard-structure.js'), 'utf8'), structure);

const ESTIMATES = [
  '---estimates---',
  '| Task  | Optimistic | Most Likely | Pessimistic | Mode     | Size |',
  '|-------|------------|-------------|-------------|----------|------|',
  '| Build | 2d         | 4d          | 8d          | duration |      |',
].join('\n');

const WHITEBOARD = [
  '---whiteboard---',
  '| Task  | X   | Y  | Colour | Width | Height | Collapsed |',
  '|-------|-----|----|--------|-------|--------|-----------|',
  '| Build | 120 | 80 |        | 240   | 200    | no        |',
].join('\n');

const PARKING_LOT = [
  '---parking lot---',
  '| ID | Text        | Date Parked |',
  '|----|-------------|-------------|',
  '| 1  | Later maybe | 2026-01-01  |',
].join('\n');

const RAID = [
  '---raid log---',
  '| ID | Type | Description | Owner | Status |',
  '|----|------|-------------|-------|--------|',
  '| 1  | Risk | Slippage    | Ann   | Open   |',
].join('\n');

const TASKS = '---\ntitle: Demo\n---\n\nBuild @ann 5d 50%\n  Design 2d 100%';

/** Structural equality across vm realms (see test_whiteboard_backmatter.mjs). */
function eqJSON(actual, expected, message) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), message);
}

// ---------------------------------------------------------------------------
// The canonical list itself
// ---------------------------------------------------------------------------

test('the canonical list matches format_converter.py ALL_SECTION_MARKERS, in order', () => {
  const py = readFileSync(join(repo, 'packages', 'noodle-core', 'src', 'noodle_core', 'format_converter.py'), 'utf8');
  const constants = {};
  for (const m of py.matchAll(/^(\w+) = '(---[a-z][a-z -]*---)'$/gm)) constants[m[1]] = m[2];
  const tuple = py.match(/^ALL_SECTION_MARKERS = \(([\s\S]*?)\)/m);
  assert.ok(tuple, 'ALL_SECTION_MARKERS not found in format_converter.py');
  const pyMarkers = tuple[1].split(',').map(s => s.trim()).filter(Boolean).map(name => constants[name]);
  assert.deepEqual([...backMatter.NP_BACK_MATTER_MARKERS], pyMarkers);
});

test("every marker constant state.js declares is in the canonical list", () => {
  assert.ok(Object.keys(stateMarkers).length >= 11, 'expected state.js to declare the marker constants');
  for (const [name, value] of Object.entries(stateMarkers)) {
    assert.ok(backMatter.NP_BACK_MATTER_MARKERS.includes(value), `${name} (${value}) missing from NP_BACK_MATTER_MARKERS`);
  }
});

test('index.html and collab_join.html load the list before state.js', () => {
  for (const page of ['index.html', 'collab_join.html']) {
    const html = readFileSync(join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'templates', page), 'utf8');
    const markersAt = html.indexOf('/static/back-matter-markers.js');
    assert.notEqual(markersAt, -1, `${page} does not load back-matter-markers.js`);
    assert.ok(markersAt < html.indexOf('/static/state.js'), `${page} loads back-matter-markers.js after state.js`);
  }
});

test('npBackMatterSectionEnd only stops at a marker on its own line', () => {
  const text = 'A note quoting ---estimates--- inline\nmore\n---raid log---\nrows';
  assert.equal(backMatter.npBackMatterSectionEnd(text, 0), text.indexOf('---raid log---'));
  assert.equal(backMatter.npBackMatterSectionEnd('no markers', 0), 'no markers'.length);
  // Its own marker, excluded, is not a boundary.
  const dup = '---comms---\na\n---comms---\nb';
  assert.equal(backMatter.npBackMatterSectionEnd(dup, 11, ['---comms---']), dup.length);
  assert.equal(backMatter.npIsBackMatterMarker('  ---estimates---\r'), true);
  assert.equal(backMatter.npIsBackMatterMarker('---estimate---'), false);
});

// ---------------------------------------------------------------------------
// Whiteboard + parking lot (script.js)
// ---------------------------------------------------------------------------

test('whiteboard reader stops at a following estimates section: no phantom notes', () => {
  const plan = TASKS + '\n\n' + WHITEBOARD + '\n\n' + ESTIMATES;
  const section = sandbox.extractWhiteboardFromPlanText(plan);
  assert.doesNotMatch(section, /estimates|Optimistic/);
  const notes = sandbox.parseWhiteboardMarkdown(section);
  eqJSON(notes.map(n => n.task), ['Build']);
});

test('a whiteboard write keeps a following estimates section intact', () => {
  const plan = TASKS + '\n\n' + WHITEBOARD + '\n\n' + ESTIMATES;
  const notes = sandbox.parseWhiteboardMarkdown(sandbox.extractWhiteboardFromPlanText(plan));
  notes[0].x = 300;
  const next = sandbox.updatePlanWhiteboardText(plan, notes);
  assert.ok(next.endsWith(ESTIMATES), 'estimates section lost or altered by the whiteboard write');
  assert.equal(next.split('---estimates---').length, 2);
  eqJSON(Estimating.parseEstimatesMarkdown(Estimating.extractEstimatesFromPlanText(next)).map(r => r.task), ['Build']);
  // And the round trip is stable: the next read still sees one note.
  eqJSON(sandbox.parseWhiteboardMarkdown(sandbox.extractWhiteboardFromPlanText(next)).map(n => n.x), [300]);
});

test('parking lot reader and writer stop at a following estimates section', () => {
  const plan = TASKS + '\n\n' + PARKING_LOT + '\n\n' + ESTIMATES;
  assert.doesNotMatch(sandbox.extractParkingLotFromPlanText(plan), /estimates/);
  const items = sandbox.parseParkingLotMarkdown(sandbox.extractParkingLotFromPlanText(plan));
  assert.equal(items.length, 1);
  const next = sandbox.updatePlanParkingLotText(plan, []);
  assert.ok(next.endsWith(ESTIMATES), 'emptying the parking lot deleted the estimates section');
  assert.doesNotMatch(next, /parking lot/);
});

// ---------------------------------------------------------------------------
// Other script.js section readers
// ---------------------------------------------------------------------------

test('RAID reader stops at estimates, benefits, parking lot and highlights', () => {
  for (const follower of [ESTIMATES, '---benefits---\n| Benefit | Owner |\n|--|--|\n| Most Likely | 2d |',
    PARKING_LOT, '---highlights---\n## 2026-01-01 @ann\nShipped']) {
    const section = sandbox.extractRaidLogFromPlanText(TASKS + '\n\n' + RAID + '\n\n' + follower);
    assert.equal(section, RAID.slice('---raid log---\n'.length), `RAID text swallowed ${follower.split('\n')[0]}`);
  }
});

test('comms, highlights, lessons and baseline readers stop at estimates', () => {
  const comms = '---comms---\n| Activity | Audience |\n|--|--|\n| Standup | Team |';
  assert.doesNotMatch(sandbox.extractCommsFromPlanText(TASKS + '\n\n' + comms + '\n\n' + ESTIMATES), /Optimistic/);
  const lessons = '---lessons learned---\n| ID | Lesson |\n|--|--|\n| 1 | Plan early |';
  assert.doesNotMatch(sandbox.extractLessonsFromPlanText(TASKS + '\n\n' + lessons + '\n\n' + ESTIMATES), /Optimistic/);
  const baseline = '---baseline---\n| Task | Start | End |\n|--|--|--|\n| Build | 2026-01-01 | 2026-01-05 |';
  assert.doesNotMatch(sandbox.extractBaselineSectionText(TASKS + '\n\n' + baseline + '\n\n' + PARKING_LOT), /Later maybe/);
  const highlights = sandbox.extractHighlightsFromText(TASKS + '\n\n---highlights---\n## 2026-01-01 @ann\nShipped\n\n' + ESTIMATES);
  assert.equal(highlights.length, 1);
  assert.doesNotMatch(highlights[0].content, /Optimistic/);
});

test('trend report and completion sparkline do not count estimate rows as tasks', () => {
  const plan = TASKS + '\n\n' + ESTIMATES;
  eqJSON(sandbox.extractTasksFromPlanText(plan).map(t => t.friendlyName), ['Build', 'Design']);
  // One leaf task (Design) at 100%; an estimate row counted as a 0% leaf
  // would drag this down to 50.
  assert.equal(sandbox.extractCompletionFromPlanText(plan), 100);
  assert.equal(sandbox.extractCompletionFromPlanText(TASKS + '\n\n' + PARKING_LOT + '\n| 2 | 3d thing 0% | |'), 100);
});

test('clearing the mind map keeps a plan whose only back matter is estimates', () => {
  const editor = { value: TASKS + '\n\n' + ESTIMATES, dispatchEvent() {} };
  const mindmap = {
    ...backMatter,
    mindmapTree: null, mindmapSelectedNode: null, mindmapNodeElements: [], mindmapTasks: [], mindmapGroup: null,
    document: { querySelector: () => null, getElementById: () => editor },
    Event: class { constructor(type) { this.type = type; } },
  };
  liftFunctions(mindmap, 'mindmap.js', ['mindmapClearToEmpty']);
  mindmap.mindmapClearToEmpty();
  assert.doesNotMatch(editor.value, /Build @ann/);
  assert.ok(editor.value.endsWith(ESTIMATES), 'estimates section dropped by the mind map');
});

// ---------------------------------------------------------------------------
// whiteboard-structure.js
// ---------------------------------------------------------------------------

test('wbOutlineRegion ends at an estimates section, so new tasks never land inside it', () => {
  const plan = 'Build 5d\n\n' + ESTIMATES;
  const lines = plan.split('\n');
  const { end } = structure.wbOutlineRegion(lines);
  assert.ok(end <= lines.indexOf('---estimates---'), 'outline region runs into the estimates section');
  const next = structure.wbAppendTopLevelTask(plan, 'Launch');
  assert.ok(next.endsWith(ESTIMATES), 'the new task was spliced into the estimates table');
  assert.equal(next.split('\n').indexOf('Launch'), 1);
});

// ---------------------------------------------------------------------------
// ES modules: msproject-sync.js, collab-backmatter-ops.js
// ---------------------------------------------------------------------------

test('MS Project merge keeps the parking lot and estimates sections', () => {
  const imported = '---\ntitle: Imported\n---\nImported task 3d';
  // With a whiteboard ahead of them they used to survive only by being
  // read as part of the whiteboard text; as the only back matter, nothing
  // carried them over at all.
  for (const current of [
    TASKS + '\n\n' + WHITEBOARD + '\n\n' + PARKING_LOT + '\n\n' + ESTIMATES,
    TASKS + '\n\n' + PARKING_LOT + '\n\n' + ESTIMATES,
  ]) {
    const merged = mergeImportedTasks(current, imported);
    assert.equal(merged.includes(WHITEBOARD), current.includes(WHITEBOARD), 'whiteboard lost');
    assert.ok(merged.includes(PARKING_LOT), 'parking lot lost');
    assert.ok(merged.endsWith(ESTIMATES), 'estimates lost');
    assert.match(merged, /Imported task 3d/);
    assert.doesNotMatch(merged, /Design 2d/);
  }
});

test('MS Project extract/strip treat parking lot and estimates as back matter', () => {
  const body = 'Build 5d\n\n' + PARKING_LOT + '\n\n' + ESTIMATES;
  assert.equal(stripBackMatterSections(body), 'Build 5d');
  const sections = extractBackMatterSections('Build 5d\n\n' + WHITEBOARD + '\n\n' + PARKING_LOT + '\n\n' + ESTIMATES);
  assert.equal(sections.whiteboard, WHITEBOARD.slice('---whiteboard---\n'.length));
  assert.equal(sections.parkingLot, PARKING_LOT.slice('---parking lot---\n'.length));
  assert.equal(sections.estimates, ESTIMATES.slice('---estimates---\n'.length));
});

test('collab RAID snapshot stops at estimates, and a RAID splice keeps them last', () => {
  for (const plan of [
    TASKS + '\n\n' + RAID + '\n\n' + ESTIMATES,
    TASKS + '\n\n' + RAID + '\n\n' + PARKING_LOT + '\n\n' + ESTIMATES,
  ]) {
    const snapshot = buildRaidSnapshot(plan, 1);
    eqJSON(snapshot.items.map(i => i.description), ['Slippage']);
    const spliced = spliceRaidSection(plan, snapshot.items);
    assert.ok(spliced.endsWith(ESTIMATES), 'estimates moved or lost by the RAID splice');
    assert.equal(spliced.includes(PARKING_LOT), plan.includes(PARKING_LOT));
    assert.equal(spliced.split('---estimates---').length, 2);
  }
});
