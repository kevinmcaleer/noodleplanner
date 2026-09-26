/**
 * Regression tests for issue #1096: the Home tab's "Escalations" button
 * opens a view listing risks whose "Escalate To" field (the RAID item edit
 * form's #raidItemEscalation select, values 'project' / 'programme' /
 * 'board') is set to Board or Programme.
 *
 * Covers:
 *  - ribbon-ia.js / ribbon.js: the Home tab's Track group has an
 *    "Escalations" button, and it resolves to the 'escalations' view (the
 *    same VIEW_FOR_LABEL table other simple view-switch buttons use).
 *  - state.js: 'escalations' is a recognised tracking view.
 *  - index.html: the escalations view's table/empty-state/filter markup
 *    exists with the ids renderEscalationsView() drives.
 *  - script.js: renderEscalationsView(), exercised against a lifted copy
 *    of the real function (same liftFunctions/fakeElement technique as
 *    tests/test_track_raid_type_presets.mjs) --
 *      - includes a risk escalated to 'board' or 'programme',
 *      - excludes a risk not escalated ('project'),
 *      - excludes a risk escalated to some other value,
 *      - excludes non-risk RAID items (issue/action/decision/dependency)
 *        even when escalated to board/programme,
 *      - the #escalationsFilterTarget select narrows to just that target,
 *      - the empty state toggles correctly with zero/nonzero matches.
 *
 * Run with: node --test tests/test_escalations_view.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

import { TABS } from '../packages/noodle-web/src/noodle_web/static/ribbon-ia.js';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const staticDir = join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'static');
const templatesDir = join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'templates');

const ribbonSrc = readFileSync(join(staticDir, 'ribbon.js'), 'utf8');
const scriptSrc = readFileSync(join(staticDir, 'script.js'), 'utf8');
const stateSrc = readFileSync(join(staticDir, 'state.js'), 'utf8');
const html = readFileSync(join(templatesDir, 'index.html'), 'utf8');

// ---------------------------------------------------------------------------
// ribbon-ia.js: the Home tab's Track group has an Escalations button
// ---------------------------------------------------------------------------

test('the Home ribbon Track group has an Escalations button', () => {
  const homeTab = TABS.find((t) => t.id === 'home');
  assert.ok(homeTab, 'no "home" tab in TABS');
  const trackGroup = homeTab.groups.find((g) => g.name === 'Track');
  assert.ok(trackGroup, 'Home tab has no "Track" group');
  const labels = [
    ...(trackGroup.lg || []).map((b) => b[1]),
    ...(trackGroup.cols || []).flatMap((col) => col.map((b) => b[1])),
  ];
  assert.ok(labels.includes('Escalations'), 'Home ribbon Track group is missing an "Escalations" button');
});

// ---------------------------------------------------------------------------
// ribbon.js: the "Escalations" label resolves to the 'escalations' view
// ---------------------------------------------------------------------------

test('ribbon.js resolves the "Escalations" label to the escalations view', () => {
  const m = ribbonSrc.match(/const VIEW_FOR_LABEL = \{([\s\S]*?)\n\};/);
  assert.ok(m, "could not find ribbon.js's VIEW_FOR_LABEL table");
  assert.match(m[1], /Escalations:\s*'escalations'/, '"Escalations" should map to the \'escalations\' view');
});

// ---------------------------------------------------------------------------
// state.js: 'escalations' is a recognised tracking view
// ---------------------------------------------------------------------------

test("'escalations' is registered as a tracking view in state.js", () => {
  const stateSrc = readFileSync(join(staticDir, 'state.js'), 'utf8');
  const m = stateSrc.match(/const TRACKING_VIEWS = \[([\s\S]*?)\];/);
  assert.ok(m, 'could not find TRACKING_VIEWS in state.js');
  assert.match(m[1], /'escalations'/);
});

// ---------------------------------------------------------------------------
// index.html: the escalations view's markup exists
// ---------------------------------------------------------------------------

test('index.html has the escalations view container, table body, empty state and target filter', () => {
  assert.match(html, /id="escalations-view"/);
  assert.match(html, /id="escalationsTableBody"/);
  assert.match(html, /id="escalationsEmptyState"/);
  assert.match(html, /id="escalationsFilterTarget"/);
});

test("the RAID item edit form's #raidItemEscalation select offers exactly project/programme/board", () => {
  const m = html.match(/<select id="raidItemEscalation"[^>]*>([\s\S]*?)<\/select>/);
  assert.ok(m, 'could not find the #raidItemEscalation select in index.html');
  const values = [...m[1].matchAll(/<option value="([^"]+)"/g)].map((mm) => mm[1]);
  assert.deepEqual(values, ['project', 'programme', 'board']);
});

// ---------------------------------------------------------------------------
// script.js: renderEscalationsView() filtering, lifted into a sandbox
// ---------------------------------------------------------------------------

/** Top-level `function name(` ... `\n}` declarations from a classic script,
 * lifted into a sandboxed vm context (same helper as
 * tests/test_track_raid_type_presets.mjs / tests/test_raid_comms_section_collision.mjs). */
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

/** A minimal fake DOM element: a plain object whose .textContent setter
 * keeps .innerHTML in sync the way a real <div> would, close enough for
 * escapeHtml()'s own document.createElement('div') round-trip. */
function fakeElement(initial = {}) {
  const el = { style: {}, hidden: false, value: '', ...initial };
  return el;
}

function makeSandbox({ raidItems = [], filterValue = 'all' } = {}) {
  const elements = new Map();
  elements.set('escalationsTableBody', fakeElement({ innerHTML: '' }));
  elements.set('escalationsEmptyState', fakeElement({ hidden: false }));
  elements.set('escalationsFilterTarget', fakeElement({ value: filterValue }));

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
          el.innerHTML = String(v)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        },
      });
      return el;
    },
  };

  const sandbox = { document, raidItems };
  liftFunctions(sandbox, stateSrc, ['escapeHtml']);
  liftFunctions(sandbox, scriptSrc, ['normalizedEscalationTarget', 'renderEscalationsView']);
  return { sandbox, elements };
}

function baseItem(overrides) {
  return {
    id: 1,
    type: 'risk',
    title: 'Untitled',
    description: '',
    owner: '',
    score: 4,
    status: 'open',
    escalation_level: 'project',
    target_date: '',
    ...overrides,
  };
}

test('renderEscalationsView() includes a risk escalated to Board or Programme', () => {
  const { sandbox, elements } = makeSandbox({
    raidItems: [
      baseItem({ id: 1, title: 'Vendor may miss deadline', owner: 'Alice', escalation_level: 'board', score: 20, status: 'open' }),
      baseItem({ id: 2, title: 'Budget overrun risk', owner: 'Bob', escalation_level: 'programme', score: 9, status: 'open' }),
    ],
  });
  sandbox.renderEscalationsView();
  const body = elements.get('escalationsTableBody').innerHTML;
  assert.match(body, /Vendor may miss deadline/);
  assert.match(body, /Alice/);
  assert.match(body, /Budget overrun risk/);
  assert.match(body, /Bob/);
  assert.equal(elements.get('escalationsEmptyState').hidden, true, 'empty state should be hidden when there are matches');
});

test('renderEscalationsView() excludes a risk that is not escalated (level "project")', () => {
  const { sandbox, elements } = makeSandbox({
    raidItems: [baseItem({ id: 1, title: 'Not escalated risk', escalation_level: 'project' })],
  });
  sandbox.renderEscalationsView();
  assert.doesNotMatch(elements.get('escalationsTableBody').innerHTML, /Not escalated risk/);
  assert.equal(elements.get('escalationsEmptyState').hidden, false, 'empty state should show when nothing matches');
});

test('renderEscalationsView() excludes a risk escalated to an unrecognised value', () => {
  const { sandbox, elements } = makeSandbox({
    raidItems: [baseItem({ id: 1, title: 'Weirdly escalated risk', escalation_level: 'department' })],
  });
  sandbox.renderEscalationsView();
  assert.doesNotMatch(elements.get('escalationsTableBody').innerHTML, /Weirdly escalated risk/);
});

test('renderEscalationsView() excludes non-risk RAID items even when escalated to Board/Programme', () => {
  const { sandbox, elements } = makeSandbox({
    raidItems: [
      baseItem({ id: 1, type: 'issue', title: 'Escalated issue', escalation_level: 'board' }),
      baseItem({ id: 2, type: 'action', title: 'Escalated action', escalation_level: 'programme' }),
      baseItem({ id: 3, type: 'decision', title: 'Escalated decision', escalation_level: 'board' }),
      baseItem({ id: 4, type: 'dependency', title: 'Escalated dependency', escalation_level: 'programme' }),
      baseItem({ id: 5, type: 'risk', title: 'Escalated risk', escalation_level: 'board' }),
    ],
  });
  sandbox.renderEscalationsView();
  const body = elements.get('escalationsTableBody').innerHTML;
  assert.doesNotMatch(body, /Escalated issue/);
  assert.doesNotMatch(body, /Escalated action/);
  assert.doesNotMatch(body, /Escalated decision/);
  assert.doesNotMatch(body, /Escalated dependency/);
  assert.match(body, /Escalated risk/);
});

test("'program' (US spelling) normalizes to Programme, same as the RAID log's escalation badge", () => {
  const { sandbox, elements } = makeSandbox({
    raidItems: [baseItem({ id: 1, title: 'Legacy spelling risk', escalation_level: 'program' })],
  });
  sandbox.renderEscalationsView();
  const body = elements.get('escalationsTableBody').innerHTML;
  assert.match(body, /Legacy spelling risk/);
  assert.match(body, /raid-escalation-programme/);
  assert.match(body, />Programme</);
});

test('the #escalationsFilterTarget select narrows the list to just that escalation target', () => {
  const items = [
    baseItem({ id: 1, title: 'Board risk', escalation_level: 'board' }),
    baseItem({ id: 2, title: 'Programme risk', escalation_level: 'programme' }),
  ];

  const boardOnly = makeSandbox({ raidItems: items, filterValue: 'board' });
  boardOnly.sandbox.renderEscalationsView();
  const boardBody = boardOnly.elements.get('escalationsTableBody').innerHTML;
  assert.match(boardBody, /Board risk/);
  assert.doesNotMatch(boardBody, /Programme risk/);

  const programmeOnly = makeSandbox({ raidItems: items, filterValue: 'programme' });
  programmeOnly.sandbox.renderEscalationsView();
  const programmeBody = programmeOnly.elements.get('escalationsTableBody').innerHTML;
  assert.match(programmeBody, /Programme risk/);
  assert.doesNotMatch(programmeBody, /Board risk/);
});

test('renderEscalationsView() shows the empty state when there are zero escalated risks', () => {
  const { sandbox, elements } = makeSandbox({ raidItems: [] });
  sandbox.renderEscalationsView();
  assert.equal(elements.get('escalationsTableBody').innerHTML, '');
  assert.equal(elements.get('escalationsEmptyState').hidden, false);
});

test('clicking a title opens the RAID item form for that item', () => {
  const { sandbox, elements } = makeSandbox({
    raidItems: [baseItem({ id: 42, title: 'Click me', escalation_level: 'board' })],
  });
  sandbox.renderEscalationsView();
  assert.match(elements.get('escalationsTableBody').innerHTML, /onclick="openRaidForm\(42\)"/);
});
