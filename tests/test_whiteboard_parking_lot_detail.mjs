/**
 * Tests for the parking lot's richer per-item detail and the "Restore to
 * board" action (issue #1110).
 *
 * Issue #1019 shipped a one-way "Send to parking lot": the note's task
 * (and any children) was deleted, and only a flattened "name — comment"
 * string survived in the ---parking lot--- table. #1110 closes that gap:
 * wbSendNoteToParkingLot() now also snapshots the note's exact title,
 * resolved colour, and (for a checklist note) every child's name and
 * completion state into the parked item's `detail` field (see
 * wbBuildParkedItemDetail()) before the task is deleted, and a new
 * wbRestoreParkedItem() rebuilds the task/children/whiteboard row from
 * that snapshot and removes the item from the parking lot.
 *
 * See format_converter.py's own "Parking lot" header comment (the
 * generate_parking_lot_detail_comment()/extract_parking_lot_detail()
 * pair) for the JSON schema this mirrors, and
 * tests/test_whiteboard_backmatter.mjs for the pure round-trip coverage
 * of the JS mirrors of those two functions.
 *
 * Technique: script.js can't be loaded wholesale (it has top-level DOM
 * side effects), so its back-matter helpers are lifted function-by-function
 * into a sandbox (same liftFunctions() technique as
 * tests/test_baseline_dialog.mjs / tests/test_whiteboard_backmatter.mjs).
 * whiteboard-structure.js has no such side effects, so it is loaded
 * wholesale instead (same as tests/test_whiteboard_structure.js) --
 * simpler, and it gives wbAppendChildTask()/wbAppendTopLevelTask() a
 * working closure over their own file's WB_INDENT_UNIT/WB_NEW_NOTE_BASE_NAME
 * consts. whiteboard-notes.js's own functions are lifted individually too
 * (rather than loaded wholesale): wbSendNoteToParkingLot()/
 * wbRestoreParkedItem() read and write the file's `wbLastTasks`/
 * `wbLastPlanText` module state, which -- being `let` bindings, not global
 * object properties -- would be unreachable from outside a whole-file vm
 * run; lifting only the needed functions leaves those identifiers as free
 * variables that resolve against (pre-seeded, externally readable/settable)
 * sandbox properties instead, exactly like test_baseline_dialog.mjs's
 * baselineItems/baselineHistory/activeBaselineId. wbCommitMarkdown() itself
 * is stubbed (never lifted) to write straight to a fake #planEditor's
 * `.value` instead of touching a real DOM/renderText() pipeline.
 *
 * Run with: node --test tests/test_whiteboard_parking_lot_detail.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import backMatter from '../packages/noodle-web/src/noodle_web/static/back-matter-markers.js';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const staticDir = join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'static');

const structureSrc = readFileSync(join(staticDir, 'whiteboard-structure.js'), 'utf8');
const notesSrc = readFileSync(join(staticDir, 'whiteboard-notes.js'), 'utf8');
const scriptSrc = readFileSync(join(staticDir, 'script.js'), 'utf8');

/** Top-level `function name(` ... `\n}` declarations from a classic script,
 * lifted into a sandboxed vm context (same helper as
 * tests/test_baseline_dialog.mjs / tests/test_whiteboard_backmatter.mjs). */
function liftFunctions(sandbox, source, names) {
  for (const name of names) {
    const start = source.indexOf(`\nfunction ${name}(`);
    assert.notEqual(start, -1, `${name} not found`);
    const end = source.indexOf('\n}\n', start);
    assert.notEqual(end, -1, `${name} has no closing brace at column 0`);
    vm.runInNewContext(source.slice(start, end + 3), sandbox);
  }
  return sandbox;
}

/** Values built inside the vm sandbox live in a different realm; compare
 * via JSON round-trip rather than assert.deepEqual (same rationale as
 * test_whiteboard_backmatter.mjs's eqJSON()). */
function eqJSON(actual, expected, message) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), message);
}

function makeSandbox() {
  const elements = new Map();
  const editor = { value: '' };
  elements.set('planEditor', editor);

  const document = {
    getElementById(id) {
      return elements.has(id) ? elements.get(id) : null;
    },
  };

  const sandbox = {
    // The canonical back-matter marker list and section-boundary helpers,
    // from back-matter-markers.js (loaded before state.js in index.html).
    ...backMatter,
    console,
    document,
    // Section-marker constants normally come from state.js (loaded before
    // script.js in index.html) -- seeded directly, same as
    // tests/test_whiteboard_backmatter.mjs.
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
    // whiteboard-notes.js module state wbSendNoteToParkingLot()/
    // wbRestoreParkedItem()/wbCurrentNoteColour() read and write --
    // pre-seeded as plain sandbox properties (see this file's header
    // comment for why a whole-file vm run can't be used instead).
    wbLastTasks: [],
    wbLastPlanText: '',
    wbColourOverrides: new Map(),
    // Consts whiteboard-notes.js declares with `const` at module scope;
    // lifted functions close over their *own* file's consts when the
    // whole file is loaded, but per-function lifting needs them seeded.
    WB_NOTE_DEFAULT_WIDTH: 260,
    WB_NOTE_DEFAULT_HEIGHT: 220,
    WB_PROMOTED_TASK_NAME_MAX: 80,
    // wbPalette()'s own backing array (tier 3 of the colour precedence) --
    // a `const` co-declared with wbPalette() in whiteboard-notes.js, so
    // per-function lifting needs it seeded here too.
    WB_NOTE_PASTEL_COLOURS: [
      '#FFF3B0', '#FCE38A',
      '#FFD6E0', '#F7A8B8',
      '#CFF4D2', '#B8E6B8',
      '#C7E5FF', '#A9D6F5',
      '#FFCBC1', '#FFAFA3',
    ],
    // wbCommitMarkdown() is never lifted (its real body drives a full
    // DOM/renderText() pipeline) -- this stub is the whole "commit" a
    // test needs: write the text, report success.
    wbCommitMarkdown(nextText) {
      editor.value = nextText;
      return true;
    },
    // The panel's own DOM rebuild; a no-op here since these are
    // logic-level tests, not DOM ones (the panel/button DOM itself is
    // covered by tests/test_whiteboard_parking_lot.py's Selenium suite).
    wbRenderParkingLotList() {},
  };

  // whiteboard-structure.js has no top-level DOM side effects (only
  // consts/function declarations), so it loads wholesale -- same
  // approach as tests/test_whiteboard_structure.js.
  vm.createContext(sandbox);
  vm.runInContext(structureSrc, sandbox);

  // script.js's back-matter helpers, lifted individually (the file as a
  // whole has top-level DOM side effects it can't run without).
  liftFunctions(sandbox, scriptSrc, [
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
  ]);

  // whiteboard-notes.js's own functions, lifted individually (see this
  // file's header comment for why -- wbLastTasks/wbLastPlanText access).
  liftFunctions(sandbox, notesSrc, [
    'wbDirectChildren',
    'wbHasChildren',
    'wbChildCount',
    'wbIsChildComplete',
    'wbSanitiseChildTaskName',
    'wbPalette',
    'wbShadeColour',
    'wbDerivedPaletteColour',
    'wbThemeColourFor',
    'wbResolveNoteColour',
    'wbThemeColoursFromPlanText',
    'wbCurrentRowFor',
    'wbCurrentNoteColour',
    'wbTodayIsoDate',
    'wbBuildParkedItemText',
    'wbBuildParkedItemDetail',
    'wbSendNoteToParkingLot',
    'wbSanitiseCommentText',
    'wbRestoreParkedItem',
    'wbRectsOverlap',
    'wbFindFreeSpacePosition',
    'wbBuildAddNoteRows',
    'wbCurrentParkingLotItems',
    'wbDeleteParkedItem',
    'wbReorderParkedItem',
  ]);

  return { sandbox, editor };
}

// ---------------------------------------------------------------------------
// wbBuildParkedItemText() -- flat display text (pure)
// ---------------------------------------------------------------------------

test('wbBuildParkedItemText: a free-form note with a comment', () => {
  const { sandbox } = makeSandbox();
  const task = { name: 'Loose Idea', comment: 'A stray thought worth keeping.' };
  assert.equal(sandbox.wbBuildParkedItemText('Loose Idea', task, []), 'Loose Idea — A stray thought worth keeping.');
});

test('wbBuildParkedItemText: a free-form note with no comment is just the name', () => {
  const { sandbox } = makeSandbox();
  assert.equal(sandbox.wbBuildParkedItemText('Blank Idea', {}, []), 'Blank Idea');
});

test('wbBuildParkedItemText: a checklist note (children present) notes the item count', () => {
  const { sandbox } = makeSandbox();
  const tasks = [
    { name: 'Plan Launch', parent: null },
    { name: 'Book venue', parent: 'Plan Launch' },
    { name: 'Send invites', parent: 'Plan Launch' },
  ];
  assert.equal(sandbox.wbBuildParkedItemText('Plan Launch', {}, tasks), 'Plan Launch — 2 items');
});

// ---------------------------------------------------------------------------
// wbBuildParkedItemDetail() -- the full snapshot (pure)
// ---------------------------------------------------------------------------

test('wbBuildParkedItemDetail: a free-form note carries title, colour and comment', () => {
  const { sandbox } = makeSandbox();
  const task = { name: 'Loose Idea', comment: 'A stray thought.' };
  const detail = sandbox.wbBuildParkedItemDetail('Loose Idea', task, []);
  assert.equal(detail.title, 'Loose Idea');
  assert.match(detail.colour, /^#[0-9A-F]{6}$/);
  assert.equal(detail.comment, 'A stray thought.');
  assert.equal('checklist' in detail, false, 'a freeform note has no checklist key at all');
});

test('wbBuildParkedItemDetail: a checklist note carries every child name and completion state', () => {
  const { sandbox } = makeSandbox();
  const tasks = [
    { name: 'Plan Launch', parent: null },
    { name: 'Book venue', parent: 'Plan Launch', percent: 100 },
    { name: 'Send invites', parent: 'Plan Launch', percent: 0 },
  ];
  const detail = sandbox.wbBuildParkedItemDetail('Plan Launch', {}, tasks);
  eqJSON(detail.checklist, [
    { name: 'Book venue', done: true },
    { name: 'Send invites', done: false },
  ]);
  assert.equal('comment' in detail, false, 'no comment set, so no comment key at all');
});

test('wbBuildParkedItemDetail: colour follows the row -> Theme -> derived precedence, same as the note itself', () => {
  const { sandbox } = makeSandbox();
  const row = { task: 'Loose Idea', colour: '#4A90D9' };
  sandbox.wbLastPlanText = '---whiteboard---\n| Task | X | Y | Colour |\n|------|---|---|--------|\n| Loose Idea | 0 | 0 | #4A90D9 |';
  const detail = sandbox.wbBuildParkedItemDetail('Loose Idea', {}, []);
  assert.equal(detail.colour, '#4A90D9');
});

// ---------------------------------------------------------------------------
// wbSendNoteToParkingLot() -- capture detail, then delete the task/row
// ---------------------------------------------------------------------------

const FREEFORM_PLAN = [
  'Phase 1',
  '  Loose Idea "A stray thought worth keeping."',
  '  Other Task 2d',
  '',
  '---whiteboard---',
  '| Task | X | Y | Colour | Width | Height | Collapsed |',
  '|------|---|---|--------|-------|--------|-----------|',
  '| Loose Idea | 120 | 80 | #4A90D9 | 240 | 200 | no |',
  '| Other Task | 480 | 80 |  | 240 | 200 | no |',
].join('\n');

const CHECKLIST_PLAN = [
  'Phase 1',
  '  Plan Launch',
  '    Book venue 100%',
  '    Send invites 0%',
  '',
  '---whiteboard---',
  '| Task | X | Y | Colour | Width | Height | Collapsed |',
  '|------|---|---|--------|-------|--------|-----------|',
  '| Plan Launch | 120 | 80 | #D94A4A | 240 | 200 | no |',
].join('\n');

test('wbSendNoteToParkingLot: a free-form note is parked with title, colour and comment preserved', () => {
  const { sandbox, editor } = makeSandbox();
  editor.value = FREEFORM_PLAN;
  sandbox.wbLastPlanText = FREEFORM_PLAN;
  sandbox.wbLastTasks = [
    { name: 'Loose Idea', parent: 'Phase 1', comment: 'A stray thought worth keeping.' },
    { name: 'Other Task', parent: 'Phase 1' },
    { name: 'Phase 1', parent: null },
  ];

  const ok = sandbox.wbSendNoteToParkingLot('Loose Idea');
  assert.equal(ok, true);

  const outlineAfterSend = editor.value.split('---whiteboard---')[0];
  assert.doesNotMatch(outlineAfterSend, /Loose Idea/, 'the task line itself is gone, not just its board row');
  assert.match(editor.value, /---parking lot---/);

  const section = sandbox.extractParkingLotFromPlanText(editor.value);
  const items = sandbox.parseParkingLotMarkdown(section);
  assert.equal(items.length, 1);
  assert.equal(items[0].text, 'Loose Idea — A stray thought worth keeping.');
  assert.ok(items[0].detail, 'a detail snapshot was attached');
  assert.equal(items[0].detail.title, 'Loose Idea');
  assert.equal(items[0].detail.colour, '#4A90D9');
  assert.equal(items[0].detail.comment, 'A stray thought worth keeping.');

  // The whiteboard row is gone, but the unrelated note survives.
  const wbItems = sandbox.parseWhiteboardMarkdown(sandbox.extractWhiteboardFromPlanText(editor.value));
  eqJSON(wbItems.map((i) => i.task), ['Other Task']);
});

test('wbSendNoteToParkingLot: a checklist note preserves every child name and completion state in detail', () => {
  const { sandbox, editor } = makeSandbox();
  editor.value = CHECKLIST_PLAN;
  sandbox.wbLastPlanText = CHECKLIST_PLAN;
  sandbox.wbLastTasks = [
    { name: 'Plan Launch', parent: 'Phase 1' },
    { name: 'Book venue', parent: 'Plan Launch', percent: 100 },
    { name: 'Send invites', parent: 'Plan Launch', percent: 0 },
    { name: 'Phase 1', parent: null },
  ];

  const ok = sandbox.wbSendNoteToParkingLot('Plan Launch');
  assert.equal(ok, true);

  const items = sandbox.parseParkingLotMarkdown(sandbox.extractParkingLotFromPlanText(editor.value));
  assert.equal(items.length, 1);
  assert.equal(items[0].text, 'Plan Launch — 2 items');
  eqJSON(items[0].detail.checklist, [
    { name: 'Book venue', done: true },
    { name: 'Send invites', done: false },
  ]);
  assert.equal(items[0].detail.colour, '#D94A4A');

  // The children went with the parent -- the whole subtree left the
  // outline. (Split on ---parking lot---, not ---whiteboard---: sending
  // the board's only note also empties the whiteboard section, so the
  // marker itself is gone -- the children's names still legitimately
  // appear after this point, inside the parking-lot-detail JSON.)
  assert.doesNotMatch(editor.value.split('---parking lot---')[0], /Book venue|Send invites/);
});

// ---------------------------------------------------------------------------
// wbRestoreParkedItem() -- the inverse: rebuild task(s) + row from detail
// ---------------------------------------------------------------------------

test('wbRestoreParkedItem: a freeform item is rebuilt as a task with its comment and colour', () => {
  const { sandbox, editor } = makeSandbox();
  editor.value = FREEFORM_PLAN;
  sandbox.wbLastPlanText = FREEFORM_PLAN;
  sandbox.wbLastTasks = [
    { name: 'Loose Idea', parent: 'Phase 1', comment: 'A stray thought worth keeping.' },
    { name: 'Other Task', parent: 'Phase 1' },
    { name: 'Phase 1', parent: null },
  ];
  sandbox.wbSendNoteToParkingLot('Loose Idea');

  const parked = sandbox.wbCurrentParkingLotItems();
  assert.equal(parked.length, 1);

  const ok = sandbox.wbRestoreParkedItem(parked[0].id);
  assert.equal(ok, true);

  // The parking lot is empty again.
  assert.equal(sandbox.wbCurrentParkingLotItems().length, 0);

  // A new top-level task exists with the restored title and comment.
  assert.match(editor.value.split('---whiteboard---')[0], /^Loose Idea "A stray thought worth keeping\.?"/m);

  // A whiteboard row exists for it, carrying the preserved colour.
  const wbItems = sandbox.parseWhiteboardMarkdown(sandbox.extractWhiteboardFromPlanText(editor.value));
  const restoredRow = wbItems.find((i) => i.task === 'Loose Idea');
  assert.ok(restoredRow, 'a whiteboard row was created for the restored note');
  assert.equal(restoredRow.colour, '#4A90D9');
});

test('wbRestoreParkedItem: a checklist item is rebuilt with every child restored, done state intact', () => {
  const { sandbox, editor } = makeSandbox();
  editor.value = CHECKLIST_PLAN;
  sandbox.wbLastPlanText = CHECKLIST_PLAN;
  sandbox.wbLastTasks = [
    { name: 'Plan Launch', parent: 'Phase 1' },
    { name: 'Book venue', parent: 'Plan Launch', percent: 100 },
    { name: 'Send invites', parent: 'Plan Launch', percent: 0 },
    { name: 'Phase 1', parent: null },
  ];
  sandbox.wbSendNoteToParkingLot('Plan Launch');

  const parked = sandbox.wbCurrentParkingLotItems();
  const ok = sandbox.wbRestoreParkedItem(parked[0].id);
  assert.equal(ok, true);
  assert.equal(sandbox.wbCurrentParkingLotItems().length, 0);

  const outline = editor.value.split('---whiteboard---')[0];
  assert.match(outline, /^Plan Launch\s*$/m);
  assert.match(outline, /Book venue 100%/);
  // An incomplete child carries no percent token at all (matching how a
  // brand-new 0% task is normally written in this outline format).
  assert.match(outline, /^\s+Send invites\s*$/m);

  const wbItems = sandbox.parseWhiteboardMarkdown(sandbox.extractWhiteboardFromPlanText(editor.value));
  const restoredRow = wbItems.find((i) => i.task === 'Plan Launch');
  assert.ok(restoredRow);
  assert.equal(restoredRow.colour, '#D94A4A');
});

test('wbRestoreParkedItem: a name collision with an existing task is uniquified, not overwritten', () => {
  const { sandbox, editor } = makeSandbox();
  editor.value = FREEFORM_PLAN;
  sandbox.wbLastPlanText = FREEFORM_PLAN;
  sandbox.wbLastTasks = [
    { name: 'Loose Idea', parent: 'Phase 1', comment: 'A stray thought worth keeping.' },
    { name: 'Other Task', parent: 'Phase 1' },
    { name: 'Phase 1', parent: null },
  ];
  sandbox.wbSendNoteToParkingLot('Loose Idea');

  // Something else in the outline is now already named "Loose Idea"
  // (e.g. the user typed a new task with that name while it was parked).
  editor.value = editor.value.replace('Phase 1\n', 'Phase 1\n  Loose Idea 1d\n');

  const parked = sandbox.wbCurrentParkingLotItems();
  const ok = sandbox.wbRestoreParkedItem(parked[0].id);
  assert.equal(ok, true);

  const outline = editor.value.split('---whiteboard---')[0];
  assert.match(outline, /Loose Idea 2/, 'the restored task was given a unique name instead of colliding');
});

test('wbRestoreParkedItem: a legacy item with no detail (pre-#1110) still restores, splitting its flat text', () => {
  const { sandbox, editor } = makeSandbox();
  const plan = [
    'Phase 1',
    '  Other Task 2d',
    '',
    '---parking lot---',
    '| ID | Text | Date Parked |',
    '|----|------|-------------|',
    '| 1  | Old Idea — An old comment | 2026-01-01 |',
  ].join('\n');
  editor.value = plan;
  sandbox.wbLastPlanText = plan;
  sandbox.wbLastTasks = [{ name: 'Other Task', parent: null }];

  const parked = sandbox.wbCurrentParkingLotItems();
  assert.equal(parked.length, 1);
  assert.equal('detail' in parked[0], false);

  const ok = sandbox.wbRestoreParkedItem(parked[0].id);
  assert.equal(ok, true);
  assert.equal(sandbox.wbCurrentParkingLotItems().length, 0);

  const outline = editor.value.split('---whiteboard---')[0];
  assert.match(outline, /^Old Idea "An old comment"/m);
});

test('wbRestoreParkedItem: a legacy item with no " — " separator restores as a plain titled task', () => {
  const { sandbox, editor } = makeSandbox();
  const plan = [
    'Phase 1\n  Other Task 2d',
    '',
    '---parking lot---',
    '| ID | Text | Date Parked |',
    '|----|------|-------------|',
    '| 1  | Just A Title | |',
  ].join('\n');
  editor.value = plan;
  sandbox.wbLastPlanText = plan;
  sandbox.wbLastTasks = [{ name: 'Other Task', parent: null }];

  const parked = sandbox.wbCurrentParkingLotItems();
  const ok = sandbox.wbRestoreParkedItem(parked[0].id);
  assert.equal(ok, true);
  assert.match(editor.value.split('---whiteboard---')[0], /^Just A Title\s*$/m);
});

test('wbRestoreParkedItem: restoring is a single Markdown commit (one undo step)', () => {
  const { sandbox, editor } = makeSandbox();
  editor.value = FREEFORM_PLAN;
  sandbox.wbLastPlanText = FREEFORM_PLAN;
  sandbox.wbLastTasks = [
    { name: 'Loose Idea', parent: 'Phase 1', comment: 'A stray thought worth keeping.' },
    { name: 'Other Task', parent: 'Phase 1' },
    { name: 'Phase 1', parent: null },
  ];
  sandbox.wbSendNoteToParkingLot('Loose Idea');

  let commitCount = 0;
  sandbox.wbCommitMarkdown = (nextText) => { commitCount++; editor.value = nextText; return true; };

  const parked = sandbox.wbCurrentParkingLotItems();
  sandbox.wbRestoreParkedItem(parked[0].id);
  assert.equal(commitCount, 1);
});

test('wbRestoreParkedItem: an unknown item id is a no-op', () => {
  const { sandbox, editor } = makeSandbox();
  editor.value = FREEFORM_PLAN;
  const before = editor.value;
  const ok = sandbox.wbRestoreParkedItem(999999);
  assert.equal(ok, false);
  assert.equal(editor.value, before);
});

// ---------------------------------------------------------------------------
// wbRestoreParkedItem(itemId, atPoint) -- restore at an exact board point
// (issue #1201's drag-out-of-the-panel restore)
// ---------------------------------------------------------------------------

test('wbRestoreParkedItem: atPoint centres the restored row on that board point', () => {
  const { sandbox, editor } = makeSandbox();
  editor.value = FREEFORM_PLAN;
  sandbox.wbLastPlanText = FREEFORM_PLAN;
  sandbox.wbLastTasks = [
    { name: 'Loose Idea', parent: 'Phase 1', comment: 'A stray thought worth keeping.' },
    { name: 'Other Task', parent: 'Phase 1' },
    { name: 'Phase 1', parent: null },
  ];
  sandbox.wbSendNoteToParkingLot('Loose Idea');
  const parked = sandbox.wbCurrentParkingLotItems();

  const ok = sandbox.wbRestoreParkedItem(parked[0].id, { x: 1000, y: 600 });
  assert.equal(ok, true);

  const wbItems = sandbox.parseWhiteboardMarkdown(sandbox.extractWhiteboardFromPlanText(editor.value));
  const restoredRow = wbItems.find((i) => i.task === 'Loose Idea');
  assert.ok(restoredRow, 'a whiteboard row was created for the restored note');
  // Centred on (1000, 600): top-left is offset by half the default note
  // size (WB_NOTE_DEFAULT_WIDTH/HEIGHT, seeded 260x220 above), exactly what
  // wbBoardPointFromClient() -> wbRestoreParkedItem() computes for a drop.
  assert.equal(restoredRow.x, 1000 - 260 / 2);
  assert.equal(restoredRow.y, 600 - 220 / 2);
});

test('wbRestoreParkedItem: an invalid atPoint (missing/non-finite) falls back to free-space placement', () => {
  const { sandbox, editor } = makeSandbox();
  editor.value = FREEFORM_PLAN;
  sandbox.wbLastPlanText = FREEFORM_PLAN;
  sandbox.wbLastTasks = [
    { name: 'Loose Idea', parent: 'Phase 1', comment: 'A stray thought worth keeping.' },
    { name: 'Other Task', parent: 'Phase 1' },
    { name: 'Phase 1', parent: null },
  ];
  sandbox.wbSendNoteToParkingLot('Loose Idea');
  const parked = sandbox.wbCurrentParkingLotItems();

  const ok = sandbox.wbRestoreParkedItem(parked[0].id, { x: NaN, y: 600 });
  assert.equal(ok, true);

  const wbItems = sandbox.parseWhiteboardMarkdown(sandbox.extractWhiteboardFromPlanText(editor.value));
  const restoredRow = wbItems.find((i) => i.task === 'Loose Idea');
  assert.ok(restoredRow);
  // Free-space placement never lands exactly on the bogus point's y.
  assert.notEqual(restoredRow.y, 600 - 220 / 2);
});

// ---------------------------------------------------------------------------
// wbReorderParkedItem() -- persist a new list order (issue #1201)
// ---------------------------------------------------------------------------

function seedThreeParkedItems(sandbox, editor) {
  const plan = [
    'Phase 1',
    '  Other Task 2d',
    '',
    '---parking lot---',
    '| ID | Text | Date Parked |',
    '|----|------|-------------|',
    '| 1  | First idea | 2026-01-01 |',
    '| 2  | Second idea | 2026-01-02 |',
    '| 3  | Third idea | 2026-01-03 |',
  ].join('\n');
  editor.value = plan;
  return sandbox.wbCurrentParkingLotItems();
}

test('wbReorderParkedItem: moving the first item after the last reorders the table', () => {
  const { sandbox, editor } = makeSandbox();
  seedThreeParkedItems(sandbox, editor);

  const ok = sandbox.wbReorderParkedItem(1, 3, true); // First idea -> after Third idea
  assert.equal(ok, true);

  const order = sandbox.wbCurrentParkingLotItems().map((i) => i.text);
  eqJSON(order, ['Second idea', 'Third idea', 'First idea']);
});

test('wbReorderParkedItem: dropping before a target places it ahead of that row', () => {
  const { sandbox, editor } = makeSandbox();
  seedThreeParkedItems(sandbox, editor);

  const ok = sandbox.wbReorderParkedItem(3, 1, false); // Third idea -> before First idea
  assert.equal(ok, true);

  const order = sandbox.wbCurrentParkingLotItems().map((i) => i.text);
  eqJSON(order, ['Third idea', 'First idea', 'Second idea']);
});

test('wbReorderParkedItem: dropping an item on itself is a no-op', () => {
  const { sandbox, editor } = makeSandbox();
  seedThreeParkedItems(sandbox, editor);
  const before = editor.value;

  const ok = sandbox.wbReorderParkedItem(2, 2, true);
  assert.equal(ok, false);
  assert.equal(editor.value, before);
});

test('wbReorderParkedItem: an unknown dragged or target id is a no-op', () => {
  const { sandbox, editor } = makeSandbox();
  seedThreeParkedItems(sandbox, editor);
  const before = editor.value;

  assert.equal(sandbox.wbReorderParkedItem(999, 1, true), false);
  assert.equal(sandbox.wbReorderParkedItem(1, 999, true), false);
  assert.equal(editor.value, before);
});

test('wbReorderParkedItem: reordering is a single Markdown commit (one undo step)', () => {
  const { sandbox, editor } = makeSandbox();
  seedThreeParkedItems(sandbox, editor);

  let commitCount = 0;
  sandbox.wbCommitMarkdown = (nextText) => { commitCount++; editor.value = nextText; return true; };

  sandbox.wbReorderParkedItem(1, 3, true);
  assert.equal(commitCount, 1);
});
