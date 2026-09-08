/**
 * Tests for the whiteboard note colour menu's write path (issue #849):
 * wbApplyNoteColourToPlanText() in whiteboard-notes.js, which is what
 * wbHandleNoteColourPick()/wbFlushPendingColourPicks() actually run
 * before committing.
 *
 * This is an integration-style test across three files -- script.js's
 * front-matter/whiteboard-row helpers, kanban.js's Theme: block
 * read/writer (parsePlanThemeColours/buildPlanTextWithThemeColours,
 * extracted from KanbanBoard.saveThemeColours() so this file's colour
 * menu can reuse the exact same format/algorithm instead of hand-rolling
 * a second one), and whiteboard-notes.js's own wbApplyNoteColourToPlanText.
 * Uses the same `liftFunctions` vm-sandbox technique as
 * tests/test_whiteboard_backmatter.mjs (lift just the named top-level
 * `function name() {...}` blocks from a file with heavy, DOM-dependent
 * top-level side effects, rather than loading the whole file) for
 * script.js and kanban.js; whiteboard-notes.js itself has no top-level
 * side effects (see its own tests/test_whiteboard_notes.js), so the
 * whole file is run directly into the same sandbox.
 *
 * Run with: node --test tests/test_note_colour_writer.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

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
// whole file, since these are simple string literals -- same convention
// as test_whiteboard_backmatter.mjs.
const sandbox = {
  console,
  HIGHLIGHTS_START: '---highlights---',
  HIGHLIGHTS_END: '---end-highlights---',
  BUDGET_START: '---budget---',
  RAID_LOG_START: '---raid log---',
  COMMS_START: '---comms---',
  BASELINE_START: '---baseline---',
  BENEFITS_START: '---benefits---',
  LESSONS_START: '---lessons learned---',
  WHITEBOARD_START: '---whiteboard---',
};

liftFunctions(sandbox, 'script.js', [
  'extractFrontMatterSection',
  'removeFrontMatterSection',
  'extractWhiteboardFromPlanText',
  'parseWhiteboardMarkdown',
  'generateWhiteboardText',
  'updatePlanWhiteboardText',
]);

liftFunctions(sandbox, 'kanban.js', [
  'parsePlanThemeColours',
  'buildPlanTextWithThemeColours',
]);

// whiteboard-notes.js has no top-level side effects (just declarations),
// so -- unlike script.js/kanban.js -- the whole file can run directly,
// same as its own tests/test_whiteboard_notes.js does.
const wbSource = readFileSync(join(staticDir, 'whiteboard-notes.js'), 'utf8');
vm.runInNewContext(wbSource, sandbox);

const { parsePlanThemeColours, wbApplyNoteColourToPlanText } = sandbox;

// ---------------------------------------------------------------------------
// Setting a colour writes Theme:, not the whiteboard row's Colour column
// ---------------------------------------------------------------------------

test('setting a colour writes the Theme: entry and leaves other front matter alone', () => {
  const before = [
    '---',
    'title: Demo',
    'status: Green',
    'Theme:',
    '- Other Phase: #223344',
    '---',
    '',
    'Phase 1',
    '  Task 1 3d',
    '',
    '---whiteboard---',
    '| Task    | X  | Y  | Colour | Width | Height | Collapsed |',
    '|---------|----|----|--------|-------|--------|-----------|',
    '| Phase 1 | 10 | 20 |        | 240   | 200    | no        |',
  ].join('\n');

  const after = wbApplyNoteColourToPlanText(before, 'Phase 1', '#abcdef');

  assert.match(after, /title: Demo/, 'unrelated front-matter key is untouched');
  assert.match(after, /status: Green/, 'unrelated front-matter key is untouched');
  assert.match(after, /- Other Phase: #223344/, 'an unrelated Theme: entry is preserved');
  assert.match(after, /- Phase 1: #ABCDEF/, 'the new Theme: entry is written, uppercased');

  const colours = parsePlanThemeColours(after);
  assert.equal(Object.keys(colours).length, 2, 'exactly one Theme: entry was added, none dropped');

  assert.doesNotMatch(after, /\|\s*#abcdef\s*\|/i, 'the whiteboard row\'s own Colour column is not written');
});

test('setting a colour clears a pre-existing whiteboard-row Colour value for that task', () => {
  const before = [
    '---',
    'title: Demo',
    '---',
    '',
    'Phase 1',
    '  Task 1 3d',
    '',
    '---whiteboard---',
    '| Task    | X  | Y  | Colour  | Width | Height | Collapsed |',
    '|---------|----|----|---------|-------|--------|-----------|',
    '| Phase 1 | 10 | 20 | #112233 | 240   | 200    | no        |',
  ].join('\n');

  const after = wbApplyNoteColourToPlanText(before, 'Phase 1', '#abcdef');

  assert.match(after, /- Phase 1: #ABCDEF/, 'the Theme: entry is written');
  assert.doesNotMatch(after, /#112233/, 'the stale row Colour value is gone, not left stranded');
});

test('setting a colour on one row does not touch another row\'s Colour or another task\'s Theme entry', () => {
  const before = [
    '---',
    'title: Demo',
    'Theme:',
    '- Phase 2: #223344',
    '---',
    '',
    'Phase 1',
    '  Task 1 3d',
    'Phase 2',
    '  Task 2 3d',
    '',
    '---whiteboard---',
    '| Task    | X  | Y   | Colour  | Width | Height | Collapsed |',
    '|---------|----|-----|---------|-------|--------|-----------|',
    '| Phase 1 | 10 | 20  |         | 240   | 200    | no        |',
    '| Phase 2 | 10 | 260 | #556677 | 240   | 200    | no        |',
  ].join('\n');

  const after = wbApplyNoteColourToPlanText(before, 'Phase 1', '#abcdef');

  assert.match(after, /- Phase 2: #223344/, 'Phase 2\'s existing Theme: entry is untouched');
  assert.match(after, /#556677/, 'Phase 2\'s whiteboard-row Colour is untouched');
  assert.match(after, /- Phase 1: #ABCDEF/, 'Phase 1 gets its new Theme: entry');
});

// ---------------------------------------------------------------------------
// Clearing a colour ("Default colour") leaves no residue
// ---------------------------------------------------------------------------

test('clearing the only Theme: entry removes the whole Theme: block, not just the entry', () => {
  const before = [
    '---',
    'title: Demo',
    'Theme:',
    '- Phase 1: #ABCDEF',
    '---',
    '',
    'Phase 1',
    '  Task 1 3d',
  ].join('\n');

  const after = wbApplyNoteColourToPlanText(before, 'Phase 1', null);

  assert.doesNotMatch(after, /Theme:/, 'an empty Theme: block is removed entirely, not left as a dangling header');
  assert.match(after, /title: Demo/, 'other front matter survives');
});

test('clearing one colour keeps every other Theme: entry', () => {
  const before = [
    '---',
    'title: Demo',
    'Theme:',
    '- Phase 1: #ABCDEF',
    '- Phase 2: #223344',
    '---',
    '',
    'Phase 1',
    '  Task 1 3d',
  ].join('\n');

  const after = wbApplyNoteColourToPlanText(before, 'Phase 1', null);

  assert.doesNotMatch(after, /Phase 1: #ABCDEF/, 'the cleared entry is gone');
  assert.match(after, /- Phase 2: #223344/, 'the other entry survives untouched');
});

test('clearing also removes a stray whiteboard-row Colour value, leaving the row itself intact', () => {
  const before = [
    '---',
    'title: Demo',
    '---',
    '',
    'Phase 1',
    '  Task 1 3d',
    '',
    '---whiteboard---',
    '| Task    | X  | Y  | Colour  | Width | Height | Collapsed |',
    '|---------|----|----|---------|-------|--------|-----------|',
    '| Phase 1 | 10 | 20 | #112233 | 240   | 200    | no        |',
  ].join('\n');

  const after = wbApplyNoteColourToPlanText(before, 'Phase 1', null);

  assert.doesNotMatch(after, /#112233/, 'the stray Colour value is gone');
  assert.match(after, /\| Phase 1\s*\|/, 'the row itself (X/Y/Width/Height) is kept, not deleted');
});

test('clearing a colour that was never set is a harmless no-op', () => {
  const before = [
    '---',
    'title: Demo',
    '---',
    '',
    'Phase 1',
    '  Task 1 3d',
  ].join('\n');

  const after = wbApplyNoteColourToPlanText(before, 'Phase 1', null);
  assert.equal(after, before, 'nothing changes when there was nothing to clear');
});

// ---------------------------------------------------------------------------
// Round trip: set then clear returns to the original text
// ---------------------------------------------------------------------------

test('set then clear round-trips back to the original plan text', () => {
  const before = [
    '---',
    'title: Demo',
    'status: Green',
    '---',
    '',
    'Phase 1',
    '  Task 1 3d',
  ].join('\n');

  const afterSet = wbApplyNoteColourToPlanText(before, 'Phase 1', '#abcdef');
  const afterClear = wbApplyNoteColourToPlanText(afterSet, 'Phase 1', null);

  assert.equal(afterClear, before, 'setting then clearing the same colour is a no-op overall');
});
