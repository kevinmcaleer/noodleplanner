/**
 * Tests for issue #1286: right-click menu on RAID entries.
 *
 * Covers:
 *  - script.js: closeRaidItemQuickly() marks the item closed and appends the
 *    closure date to the mitigation actions (once, not on every close).
 *  - script.js: showRaidContextMenu() offers Edit / New Risk / Close /
 *    Open RAID Log, hiding Close for an already-closed item, and labels the
 *    close action by the entry's type.
 *  - both RAID surfaces (the dashboard's Risks & Issues widget in
 *    views-tables.js and the RAID log rows in script.js) wire a
 *    'contextmenu' listener to showRaidContextMenu.
 *
 * Run with: node --test tests/test_raid_context_menu.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const staticDir = join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'static');
const scriptSrc = readFileSync(join(staticDir, 'script.js'), 'utf8');
const viewsTablesSrc = readFileSync(join(staticDir, 'views-tables.js'), 'utf8');

/** Top-level `function name(` ... `\n}` declarations lifted into a sandbox
 * (same helper as tests/test_escalations_view.mjs). */
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

function baseItem(overrides) {
  return {
    id: 1,
    type: 'risk',
    title: 'Vendor may miss deadline',
    description: '',
    owner: '',
    mitigation_actions: '',
    score: 12,
    status: 'open',
    escalation_level: 'project',
    ...overrides,
  };
}

function closeSandbox(raidItems) {
  const calls = [];
  const sandbox = {
    raidItems,
    renderRaidTable: () => calls.push('renderRaidTable'),
    syncRaidLogToPlanText: () => calls.push('syncRaidLogToPlanText'),
    updateReportRaid: () => calls.push('updateReportRaid'),
  };
  liftFunctions(sandbox, scriptSrc, ['closeRaidItemQuickly']);
  return { sandbox, calls };
}

const TODAY = new Date().toISOString().split('T')[0];

test('closeRaidItemQuickly() closes the item and appends the closure date', () => {
  const items = [baseItem({ mitigation_actions: 'Chasing the vendor weekly' })];
  const { sandbox, calls } = closeSandbox(items);
  sandbox.closeRaidItemQuickly(1);

  assert.equal(items[0].status, 'closed');
  assert.match(items[0].mitigation_actions, /Chasing the vendor weekly/);
  assert.match(items[0].mitigation_actions, new RegExp(`Closed ${TODAY}`));
  assert.deepEqual(calls, ['renderRaidTable', 'syncRaidLogToPlanText', 'updateReportRaid']);
});

test('closeRaidItemQuickly() sets the date as the whole note when there is no mitigation text', () => {
  const items = [baseItem({ mitigation_actions: '' })];
  const { sandbox } = closeSandbox(items);
  sandbox.closeRaidItemQuickly(1);
  assert.equal(items[0].mitigation_actions, `Closed ${TODAY}`);
});

test('closeRaidItemQuickly() does not append a second closure date', () => {
  const items = [baseItem({ mitigation_actions: 'Closed 2020-01-01', status: 'open' })];
  const { sandbox } = closeSandbox(items);
  sandbox.closeRaidItemQuickly(1);
  assert.equal(items[0].mitigation_actions, 'Closed 2020-01-01');
  assert.equal(items[0].status, 'closed');
});

test('closeRaidItemQuickly() is a no-op for an unknown id or an already-closed item', () => {
  const items = [baseItem({ status: 'closed', mitigation_actions: 'done' })];
  const { sandbox, calls } = closeSandbox(items);
  sandbox.closeRaidItemQuickly(99);
  sandbox.closeRaidItemQuickly(1);
  assert.equal(items[0].mitigation_actions, 'done');
  assert.deepEqual(calls, []);
});

// ---------------------------------------------------------------------------
// showRaidContextMenu(): which options it offers
// ---------------------------------------------------------------------------

function menuSandbox(raidItems) {
  const labels = [];
  const actions = new Map();
  const appended = [];

  function fakeNode() {
    const node = {
      className: '',
      id: '',
      style: {},
      children: [],
      attrs: {},
      setAttribute(k, v) { node.attrs[k] = v; },
      appendChild(child) { node.children.push(child); return child; },
      addEventListener() {},
      getBoundingClientRect: () => ({ width: 180, height: 200 }),
      querySelector: () => null,
    };
    return node;
  }

  const sandbox = {
    raidItems,
    document: {
      createElement: () => fakeNode(),
      body: { appendChild: (el) => appended.push(el) },
      addEventListener() {},
      removeEventListener() {},
    },
    window: { innerWidth: 1200, innerHeight: 800 },
    setTimeout: () => {},
    closeTaskContextMenu: () => {},
    closeTaskContextMenuOnOutsideClick: () => {},
    handleContextMenuKeydown: () => {},
    createContextMenuItem: (label, icon, onClick) => {
      labels.push(label);
      actions.set(label, onClick);
      return { label };
    },
    createContextMenuSeparator: () => ({ separator: true }),
    openRaidForm: (...args) => { labels.push(`__openRaidForm(${args.join(',')})`); },
    switchToView: (view) => { labels.push(`__switchToView(${view})`); },
    closeRaidItemQuickly: (id) => { labels.push(`__closeRaidItemQuickly(${id})`); },
  };
  liftFunctions(sandbox, scriptSrc, ['showRaidContextMenu']);
  return { sandbox, labels, actions, appended };
}

const EVENT = { clientX: 100, clientY: 100 };

test('showRaidContextMenu() offers Edit, New Risk, Close Risk and Open RAID Log for an open risk', () => {
  const { sandbox, labels } = menuSandbox([baseItem({ id: 7 })]);
  sandbox.showRaidContextMenu(EVENT, 7);
  assert.deepEqual(labels, ['Edit', 'New Risk…', 'Close Risk', 'Open RAID Log']);
});

test('showRaidContextMenu() labels the close action by the entry type', () => {
  const { sandbox, labels } = menuSandbox([baseItem({ id: 7, type: 'issue' })]);
  sandbox.showRaidContextMenu(EVENT, 7);
  assert.ok(labels.includes('Close Issue'), `expected a "Close Issue" item, got ${labels.join(', ')}`);
});

test('showRaidContextMenu() omits the close action for an already-closed entry', () => {
  const { sandbox, labels } = menuSandbox([baseItem({ id: 7, status: 'closed' })]);
  sandbox.showRaidContextMenu(EVENT, 7);
  assert.deepEqual(labels, ['Edit', 'New Risk…', 'Open RAID Log']);
});

test('showRaidContextMenu() drops Edit when the row has no matching item', () => {
  const { sandbox, labels } = menuSandbox([]);
  sandbox.showRaidContextMenu(EVENT, 99);
  assert.deepEqual(labels, ['New Risk…', 'Open RAID Log']);
});

test('the menu actions open the form, close the item and switch to the RAID view', () => {
  const { sandbox, labels, actions } = menuSandbox([baseItem({ id: 7 })]);
  sandbox.showRaidContextMenu(EVENT, 7);

  actions.get('Edit')();
  actions.get('New Risk…')();
  actions.get('Close Risk')();
  actions.get('Open RAID Log')();

  assert.ok(labels.includes('__openRaidForm(7)'), 'Edit should open the form for this item');
  assert.ok(labels.includes('__openRaidForm()'), 'New Risk should open a blank form');
  assert.ok(labels.includes('__closeRaidItemQuickly(7)'));
  assert.ok(labels.includes('__switchToView(raid)'));
});

// ---------------------------------------------------------------------------
// Both RAID surfaces wire the menu up
// ---------------------------------------------------------------------------

test("the dashboard's Risks & Issues rows listen for contextmenu", () => {
  const fn = viewsTablesSrc.slice(viewsTablesSrc.indexOf('function updateReportRaid('));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /addEventListener\('contextmenu'/);
  assert.match(body, /showRaidContextMenu\(e, item\.id\)/);
});

test('the RAID log view rows listen for contextmenu', () => {
  const fn = scriptSrc.slice(scriptSrc.indexOf('function renderRaidTable('));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /addEventListener\('contextmenu'/);
  assert.match(body, /showRaidContextMenu\(e, item\.id\)/);
});
