/**
 * Regression tests for issue #1112: the Plan ribbon's Baseline button opens
 * a dialog to create, list, clear and delete baselines, instead of just
 * toggling the Gantt "show baseline overlay" display checkbox.
 *
 * The plan format still only ever keeps one *active* baseline's task-level
 * data (the pre-existing ---baseline--- markdown table) -- what's new is a
 * lightweight history log (id/name/date, no task data) layered on top as a
 * JSON comment line, so past baselines stay listed and deletable even after
 * being replaced or cleared. See format_converter.py's
 * generate_baseline_history_comment()/extract_baseline_history() for the
 * Python mirror of the two functions this file round-trips.
 *
 * Covers:
 *  - ribbon.js: the "Baseline" label opens the dialog (not the old Gantt
 *    checkbox toggle), and its pressed state reflects an active baseline.
 *  - index.html: the dialog's overlay/inputs/list container exist, plus the
 *    Gantt toolbar's new "Manage Baselines..." button.
 *  - script.js, lifted into a sandbox (same liftFunctions/fakeElement
 *    technique as tests/test_escalations_view.mjs):
 *      - generateBaselineHistoryComment()/extractBaselineHistoryFromSectionText()
 *        round-trip, and default cleanly on old/malformed plans.
 *      - createBaseline() refuses with no rendered tasks, otherwise creates
 *        a new baseline, makes it active, and prepends it to the history.
 *      - clearActiveBaseline() drops the active baseline's task data but
 *        keeps every history entry.
 *      - deleteBaselineEntry() removes just that entry from history, and
 *        additionally clears the active baseline if it was the one deleted.
 *      - renderBaselineDialogList() shows an empty-state message with no
 *        history, lists every entry otherwise, marks the active one, and
 *        only offers a "Clear" button on the active row.
 *      - openBaselineDialog()/closeBaselineDialog() toggle the overlay.
 *
 * Run with: node --test tests/test_baseline_dialog.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const staticDir = join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'static');
const templatesDir = join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'templates');

const ribbonSrc = readFileSync(join(staticDir, 'ribbon.js'), 'utf8');
const scriptSrc = readFileSync(join(staticDir, 'script.js'), 'utf8');
const html = readFileSync(join(templatesDir, 'index.html'), 'utf8');

// ---------------------------------------------------------------------------
// ribbon.js: "Baseline" opens the dialog, not the old Gantt checkbox toggle
// ---------------------------------------------------------------------------

test('ribbon.js\'s Baseline action opens the Baseline dialog', () => {
  const m = ribbonSrc.match(/const LABEL_ACTIONS = \{([\s\S]*?)\n\};/);
  assert.ok(m, 'could not find ribbon.js\'s LABEL_ACTIONS table');
  assert.match(m[1], /Baseline:\s*\(\)\s*=>\s*\{[^}]*openBaselineDialog/);
  assert.doesNotMatch(m[1], /Baseline:\s*\(\)\s*=>\s*toggleGanttCheckbox/, 'Baseline should no longer just toggle the Gantt display checkbox');
});

test('ribbon.js\'s isButtonActive() reflects an active baseline for the "Baseline" label', () => {
  const m = ribbonSrc.match(/function isButtonActive\([\s\S]*?\n\}/);
  assert.ok(m, 'could not find isButtonActive()');
  assert.match(m[0], /label === 'Baseline'[^\n]*hasActiveBaseline/);
});

// ---------------------------------------------------------------------------
// index.html: the dialog and its Gantt toolbar entry point exist
// ---------------------------------------------------------------------------

test('index.html has the Baseline dialog overlay, name input and list, and no duplicate Manage Baselines button', () => {
  assert.match(html, /id="baselineDialogOverlay"/);
  assert.match(html, /id="newBaselineName"/);
  assert.match(html, /id="baselineHistoryList"/);
  // #1266: the Gantt toolbar's "Manage Baselines..." button was removed as
  // a duplicate -- the ribbon's Baseline button is now the only way in.
  assert.doesNotMatch(html, /id="manageBaselinesBtn"/);
});

// ---------------------------------------------------------------------------
// script.js, lifted into a sandbox
// ---------------------------------------------------------------------------

/** Top-level `function name(` ... `\n}` declarations from a classic script,
 * lifted into a sandboxed vm context (same helper as
 * tests/test_escalations_view.mjs / tests/test_track_raid_type_presets.mjs). */
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

/** Objects/arrays built by code running inside the vm sandbox come from a
 * different realm (a different Array/Object constructor) than this file's
 * own literals, which makes strict assert.deepEqual report "same structure
 * but not reference-equal" even when every value matches. Round-trip
 * through JSON to compare plain values instead. */
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function fakeElement(initial = {}) {
  return { style: {}, hidden: false, value: '', classList: { add() {}, remove() {} }, ...initial };
}

function makeSandbox(overrides = {}) {
  const elements = new Map();
  elements.set('newBaselineName', fakeElement({ value: '' }));
  elements.set('baselineHistoryList', fakeElement({ innerHTML: '' }));
  elements.set('baselineDialogOverlay', fakeElement({
    classList: {
      _classes: new Set(),
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      contains(c) { return this._classes.has(c); },
    },
  }));

  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, fakeElement());
      return elements.get(id);
    },
    createElement() {
      const el = { _text: '', innerHTML: '' };
      Object.defineProperty(el, 'textContent', {
        get() { return el._text; },
        set(v) {
          el._text = v;
          el.innerHTML = String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        },
      });
      return el;
    },
  };

  const toasts = [];
  const sandbox = {
    document,
    confirm: () => true,
    showToast: (msg) => toasts.push(msg),
    showBaselineToggle: () => {},
    syncBaselineToPlanText: () => {},
    renderGanttChart: () => {},
    updateMilestonesTable: () => {},
    lastRenderedTasks: [],
    baselineItems: [],
    baselineHistory: [],
    activeBaselineId: null,
    ...overrides,
  };

  liftFunctions(sandbox, scriptSrc, [
    'escapeHtml',
    'formatBaselineTimestamp',
    'createBaseline',
    'clearActiveBaseline',
    'deleteBaselineEntry',
    'generateBaselineHistoryComment',
    'extractBaselineSectionText',
    'extractBaselineHistoryFromSectionText',
    'openBaselineDialog',
    'closeBaselineDialog',
    'renderBaselineDialogList',
    'createBaselineFromDialog',
    'clearActiveBaselineFromDialog',
    'deleteBaselineEntryFromDialog',
  ]);
  return { sandbox, elements, toasts };
}

const sampleTasks = [
  { name: 'Task 1', start: '2026-03-02', finish: '2026-03-05', duration_days: 3 },
];

test('createBaseline() refuses when there are no rendered tasks', () => {
  const { sandbox, toasts } = makeSandbox();
  const ok = sandbox.createBaseline('Sprint 1');
  assert.equal(ok, false);
  assert.deepEqual(plain(sandbox.baselineHistory), []);
  assert.equal(sandbox.activeBaselineId, null);
  assert.match(toasts[0], /No tasks to baseline/);
});

test('createBaseline() creates a baseline, makes it active, and prepends it to history', () => {
  const { sandbox } = makeSandbox({ lastRenderedTasks: sampleTasks });
  const ok = sandbox.createBaseline('Sprint 1');
  assert.equal(ok, true);
  assert.equal(sandbox.baselineItems.length, 1);
  assert.equal(sandbox.baselineItems[0].name, 'Task 1');
  assert.equal(sandbox.baselineHistory.length, 1);
  assert.equal(sandbox.baselineHistory[0].name, 'Sprint 1');
  assert.equal(sandbox.activeBaselineId, sandbox.baselineHistory[0].id);
});

test('createBaseline() with no name falls back to a timestamp label', () => {
  const { sandbox } = makeSandbox({ lastRenderedTasks: sampleTasks });
  sandbox.createBaseline('');
  assert.match(sandbox.baselineHistory[0].name, /^Baseline /);
});

test('createBaseline() called again prepends a second entry ahead of the first', () => {
  const { sandbox } = makeSandbox({ lastRenderedTasks: sampleTasks });
  sandbox.createBaseline('First');
  const firstId = sandbox.activeBaselineId;
  sandbox.createBaseline('Second');
  assert.equal(sandbox.baselineHistory.length, 2);
  assert.equal(sandbox.baselineHistory[0].name, 'Second');
  assert.equal(sandbox.baselineHistory[1].name, 'First');
  assert.equal(sandbox.baselineHistory[1].id, firstId);
  assert.notEqual(sandbox.activeBaselineId, firstId);
});

test('clearActiveBaseline() drops active task data but keeps history', () => {
  const { sandbox } = makeSandbox({ lastRenderedTasks: sampleTasks });
  sandbox.createBaseline('Sprint 1');
  const id = sandbox.activeBaselineId;
  sandbox.clearActiveBaseline();
  assert.deepEqual(plain(sandbox.baselineItems), []);
  assert.equal(sandbox.activeBaselineId, null);
  assert.equal(sandbox.baselineHistory.length, 1);
  assert.equal(sandbox.baselineHistory[0].id, id);
});

test('deleteBaselineEntry() on a non-active entry only removes that entry', () => {
  const { sandbox } = makeSandbox({ lastRenderedTasks: sampleTasks });
  sandbox.createBaseline('First');
  const firstId = sandbox.activeBaselineId;
  sandbox.createBaseline('Second');
  const secondId = sandbox.activeBaselineId;

  sandbox.deleteBaselineEntry(firstId);

  assert.equal(sandbox.baselineHistory.length, 1);
  assert.equal(sandbox.baselineHistory[0].id, secondId);
  assert.equal(sandbox.activeBaselineId, secondId, 'deleting a non-active entry must not touch the active one');
  assert.equal(sandbox.baselineItems.length, 1, 'the still-active baseline\'s task data must survive');
});

test('deleteBaselineEntry() on the active entry also clears the active baseline', () => {
  const { sandbox } = makeSandbox({ lastRenderedTasks: sampleTasks });
  sandbox.createBaseline('Only one');
  const id = sandbox.activeBaselineId;

  sandbox.deleteBaselineEntry(id);

  assert.deepEqual(plain(sandbox.baselineHistory), []);
  assert.equal(sandbox.activeBaselineId, null);
  assert.deepEqual(plain(sandbox.baselineItems), []);
});

test('generateBaselineHistoryComment()/extractBaselineHistoryFromSectionText() round-trip', () => {
  const { sandbox } = makeSandbox();
  const entries = [
    { id: 'bl-2', name: 'Second', date: '2026-09-10T00:00:00.000Z' },
    { id: 'bl-1', name: 'First', date: '2026-09-01T00:00:00.000Z' },
  ];
  const comment = sandbox.generateBaselineHistoryComment('bl-2', entries);
  assert.match(comment, /^<!-- baseline-history: \{.*\} -->$/);

  const sectionText = comment + '\n\n| Task Name | Start | Finish | Duration |\n|-|-|-|-|\n';
  const parsed = sandbox.extractBaselineHistoryFromSectionText(sectionText);
  assert.deepEqual(plain(parsed), { active: 'bl-2', entries });
});

test('generateBaselineHistoryComment() returns empty string for no entries', () => {
  const { sandbox } = makeSandbox();
  assert.equal(sandbox.generateBaselineHistoryComment(null, []), '');
});

test('extractBaselineHistoryFromSectionText() defaults cleanly on a pre-#1112 plan (table only, no comment)', () => {
  const { sandbox } = makeSandbox();
  const parsed = sandbox.extractBaselineHistoryFromSectionText('| Task Name | Start | Finish | Duration |\n|-|-|-|-|\n| Task 1 | 2026-03-02 | 2026-03-05 | 3d |');
  assert.deepEqual(plain(parsed), { active: null, entries: [] });
});

test('extractBaselineHistoryFromSectionText() defaults cleanly on malformed JSON', () => {
  const { sandbox } = makeSandbox();
  const parsed = sandbox.extractBaselineHistoryFromSectionText('<!-- baseline-history: {not json} -->');
  assert.deepEqual(plain(parsed), { active: null, entries: [] });
});

test('renderBaselineDialogList() shows an empty-state message with no history', () => {
  const { sandbox, elements } = makeSandbox();
  sandbox.renderBaselineDialogList();
  assert.match(elements.get('baselineHistoryList').innerHTML, /No baselines yet/);
});

test('renderBaselineDialogList() lists every entry, marks the active one, and only that row gets a Clear button', () => {
  const { sandbox, elements } = makeSandbox({
    baselineHistory: [
      { id: 'bl-2', name: 'Second', date: '2026-09-10T00:00:00.000Z' },
      { id: 'bl-1', name: 'First', date: '2026-09-01T00:00:00.000Z' },
    ],
    activeBaselineId: 'bl-2',
  });
  sandbox.renderBaselineDialogList();
  const html = elements.get('baselineHistoryList').innerHTML;

  assert.match(html, /Second/);
  assert.match(html, /First/);
  assert.match(html, /baseline-active-badge/);

  // Split on the row wrapper's opening tag, not the bare class name: an
  // active row's class attribute is 'baseline-history-row
  // baseline-history-row-active', and splitting on the class name alone
  // would also cut in the middle of that modifier class.
  const rows = html.split('<div class="baseline-history-row').slice(1);
  assert.equal(rows.length, 2);
  assert.match(rows[0], /clearActiveBaselineFromDialog/, 'the active row should offer a Clear button');
  assert.doesNotMatch(rows[1], /clearActiveBaselineFromDialog/, 'a non-active row should not offer a Clear button');
  assert.match(rows[1], /deleteBaselineEntryFromDialog\('bl-1'\)/);
});

test('openBaselineDialog()/closeBaselineDialog() toggle the overlay\'s "active" class', () => {
  const { sandbox, elements } = makeSandbox({ lastRenderedTasks: sampleTasks });
  const overlay = elements.get('baselineDialogOverlay');

  sandbox.openBaselineDialog();
  assert.equal(overlay.classList.contains('active'), true);

  sandbox.closeBaselineDialog();
  assert.equal(overlay.classList.contains('active'), false);
});

test('openBaselineDialog() clears any leftover text in the name field', () => {
  const { sandbox, elements } = makeSandbox();
  elements.get('newBaselineName').value = 'leftover text';
  sandbox.openBaselineDialog();
  assert.equal(elements.get('newBaselineName').value, '');
});

test('createBaselineFromDialog() reads the name field, creates a baseline, and refreshes the list', () => {
  const { sandbox, elements } = makeSandbox({ lastRenderedTasks: sampleTasks });
  elements.get('newBaselineName').value = 'From the dialog';
  sandbox.createBaselineFromDialog();

  assert.equal(sandbox.baselineHistory[0].name, 'From the dialog');
  assert.equal(elements.get('newBaselineName').value, '', 'the name field should be cleared after creating');
  assert.match(elements.get('baselineHistoryList').innerHTML, /From the dialog/);
});

test('deleteBaselineEntryFromDialog() removes the entry and refreshes the list', () => {
  const { sandbox, elements } = makeSandbox({ lastRenderedTasks: sampleTasks });
  sandbox.createBaseline('To be deleted');
  const id = sandbox.activeBaselineId;

  sandbox.deleteBaselineEntryFromDialog(id);

  assert.deepEqual(plain(sandbox.baselineHistory), []);
  assert.doesNotMatch(elements.get('baselineHistoryList').innerHTML, /To be deleted/);
  assert.match(elements.get('baselineHistoryList').innerHTML, /No baselines yet/);
});

test('clearActiveBaselineFromDialog() clears the active baseline and refreshes the list, keeping the entry visible', () => {
  const { sandbox, elements } = makeSandbox({ lastRenderedTasks: sampleTasks });
  sandbox.createBaseline('Keep me listed');
  sandbox.clearActiveBaselineFromDialog();

  assert.equal(sandbox.activeBaselineId, null);
  assert.deepEqual(plain(sandbox.baselineItems), []);
  const html = elements.get('baselineHistoryList').innerHTML;
  assert.match(html, /Keep me listed/, 'a cleared baseline stays listed, just no longer active');
  assert.doesNotMatch(html, /baseline-active-badge/);
});
