/**
 * Regression tests for issue #1118: the Resource ribbon's "Overallocation"
 * and "Influence" buttons.
 *
 * Both buttons already had a real function behind them
 * (showOverallocationView()/showInfluenceDiagram(), added by #1159 which
 * closed the parent epic #1090) -- but two gaps remained:
 *
 *  1. The main "Resources" ribbon tab (ribbon-ia.js's home 'resources' tab,
 *     Comms group) renders its "Influence" button with scopeId 'resources',
 *     but ribbon.js's scopedAction() table only had a 'stakeholders:Influence'
 *     entry (matching the *contextual* "Stakeholders" tab, which only shows
 *     once the Stakeholders view is already open). Clicking Influence from
 *     the main Resources tab therefore fell through to the "not available
 *     yet" stub -- exactly the "doesn't do anything" behaviour #1118
 *     describes -- even though showInfluenceDiagram() already existed.
 *  2. The Workload view gave no indication, once Overallocation had
 *     filtered it, that a filter was active or how to clear it again
 *     (the acceptance criteria's "a clear way to drop back to the
 *     unfiltered workload" and "an empty state when nobody is
 *     overallocated").
 *
 * Covers:
 *  - ribbon-ia.js: the main "Resources" tab has both buttons.
 *  - ribbon.js: scopedAction()'s table resolves 'resources:Overallocation',
 *    'resources:Influence' AND 'stakeholders:Influence' to the right
 *    functions -- parsed the same conservative way
 *    tests/test_track_raid_type_presets.mjs does, since ribbon.js is a
 *    classic script that can't be executed standalone.
 *  - script.js: showOverallocationView()/clearOverallocationFilter()/
 *    showInfluenceDiagram(), and updateUserWorkload()'s overallocation
 *    filtering + displayUserWorkload()'s filter-notice/empty-state text,
 *    exercised against lifted copies of the real function bodies (the same
 *    liftFunctions/fakeElement technique as tests/test_escalations_view.mjs
 *    and tests/test_track_raid_type_presets.mjs).
 *
 * Run with: node --test tests/test_resource_ribbon_overallocation_influence.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

import { TABS, CONTEXTUAL_TABS } from '../packages/noodle-web/src/noodle_web/static/ribbon-ia.js';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const staticDir = join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'static');
const templatesDir = join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'templates');

const ribbonSrc = readFileSync(join(staticDir, 'ribbon.js'), 'utf8');
const scriptSrc = readFileSync(join(staticDir, 'script.js'), 'utf8');
const html = readFileSync(join(templatesDir, 'index.html'), 'utf8');

// ---------------------------------------------------------------------------
// ribbon-ia.js: the main Resources tab has Overallocation and Influence
// ---------------------------------------------------------------------------

function tabLabels(tab) {
  return [
    ...tab.groups.flatMap((g) => (g.lg || []).map((b) => b[1])),
    ...tab.groups.flatMap((g) => (g.cols || []).flatMap((col) => col.map((b) => b[1]))),
  ];
}

test('the main "Resources" ribbon tab has Overallocation and Influence buttons', () => {
  const resourcesTab = TABS.find((t) => t.id === 'resources');
  assert.ok(resourcesTab, 'no "resources" tab in TABS');
  const labels = tabLabels(resourcesTab);
  assert.ok(labels.includes('Overallocation'), 'main Resources tab is missing "Overallocation"');
  assert.ok(labels.includes('Influence'), 'main Resources tab is missing "Influence"');
});

test('the "Resource Tools" and "Stakeholders" contextual tabs also carry these buttons under scopeId \'resources\'/\'stakeholders\'', () => {
  const resourceTools = CONTEXTUAL_TABS.find((t) => t.id === 'resources' && t.label === 'Resource Tools');
  assert.ok(resourceTools, 'no contextual "Resource Tools" tab');
  assert.ok(tabLabels(resourceTools).includes('Overallocation'));

  const stakeholders = CONTEXTUAL_TABS.find((t) => t.id === 'stakeholders');
  assert.ok(stakeholders, 'no contextual "Stakeholders" tab');
  assert.ok(tabLabels(stakeholders).includes('Influence'));
});

// ---------------------------------------------------------------------------
// ribbon.js: scopedAction()'s table resolves both scopes for Influence
// ---------------------------------------------------------------------------

function scopedActionTableSource() {
  const m = ribbonSrc.match(/function scopedAction[\s\S]*?const table = \{([\s\S]*?)\n {4}\};/);
  assert.ok(m, "could not find scopedAction()'s table in ribbon.js");
  return m[1];
}

test("'resources:Overallocation' calls showOverallocationView()", () => {
  const table = scopedActionTableSource();
  assert.match(table, /'resources:Overallocation'\s*:\s*\(\)\s*=>\s*showOverallocationView\(\)/);
});

test("'resources:Influence' (the main Resources tab's scope) calls showInfluenceDiagram() -- regression for #1118's actual bug", () => {
  const table = scopedActionTableSource();
  assert.match(
    table,
    /'resources:Influence'\s*:\s*\(\)\s*=>\s*showInfluenceDiagram\(\)/,
    'the main Resources tab renders its Influence button with scopeId \'resources\', so a \'stakeholders:Influence\'-only ' +
      'table entry leaves it falling through to the "not available yet" stub',
  );
});

test("'stakeholders:Influence' (the contextual Stakeholders tab's scope) also calls showInfluenceDiagram()", () => {
  const table = scopedActionTableSource();
  assert.match(table, /'stakeholders:Influence'\s*:\s*\(\)\s*=>\s*showInfluenceDiagram\(\)/);
});

// ---------------------------------------------------------------------------
// index.html: the Workload view's filter-notice/empty-state markup exists
// ---------------------------------------------------------------------------

test('index.html has the overallocation filter notice and a dynamic empty-state text node', () => {
  assert.match(html, /id="userWorkloadFilterNotice"/);
  assert.match(html, /onclick="clearOverallocationFilter\(\)"/);
  assert.match(html, /id="userWorkloadEmptyText"/);
  assert.match(html, /id="userWorkloadTitleBanner"/);
});

// ---------------------------------------------------------------------------
// script.js: lifted function behaviour
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

/** A minimal fake DOM element: enough for both the plain property-bag style
 * (test_escalations_view.mjs's fakeElement) and, additionally, appendChild/
 * classList/createElement's element tree that displayUserWorkload() builds. */
function fakeElement(initial = {}) {
  const el = {
    style: {},
    hidden: false,
    value: '',
    children: [],
    _text: '',
    _html: '',
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      contains(c) { return this._set.has(c); },
    },
    appendChild(child) { this.children.push(child); return child; },
    removeChild(child) { this.children = this.children.filter((c) => c !== child); return child; },
    get lastChild() { return this.children[this.children.length - 1]; },
    get firstChild() { return this.children[0]; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    ...initial,
  };
  Object.defineProperty(el, 'textContent', {
    get() { return el._text; },
    set(v) { el._text = v; el._html = String(v); },
    configurable: true,
  });
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._html; },
    set(v) { el._html = v; },
    configurable: true,
  });
  return el;
}

function makeDocument(elements) {
  return {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, fakeElement());
      return elements.get(id);
    },
    querySelector(sel) {
      // updateUserWorkload() only queries the placeholder/content toggle --
      // return stub elements it can set .style.display on.
      if (sel.includes('placeholder')) return elements.get('placeholder') || (elements.set('placeholder', fakeElement()), elements.get('placeholder'));
      if (sel.includes('content')) return elements.get('content') || (elements.set('content', fakeElement()), elements.get('content'));
      return null;
    },
    createElement() { return fakeElement(); },
  };
}

function baseTask(overrides) {
  return {
    name: 'Task',
    is_summary: false,
    resources: '@alice',
    start: '2026-01-01',
    finish: '2026-01-05',
    duration_days: 5,
    percent: 0,
    level: 0,
    rag: 'green',
    ...overrides,
  };
}

// --- showOverallocationView() / clearOverallocationFilter() ---------------

function makeViewSwitchSandbox() {
  const calls = { switchToView: [], updateUserWorkload: [] };
  const sandbox = {
    window: {},
    lastRenderedTasks: [baseTask({ name: 'T1' })],
    switchToView: (v) => calls.switchToView.push(v),
    updateUserWorkload: (tasks) => calls.updateUserWorkload.push(tasks),
  };
  liftFunctions(sandbox, scriptSrc, ['showOverallocationView', 'clearOverallocationFilter']);
  return { sandbox, calls };
}

test('showOverallocationView() sets the overallocation flag, switches to the Workload view and re-renders it', () => {
  const { sandbox, calls } = makeViewSwitchSandbox();
  sandbox.showOverallocationView();
  assert.equal(sandbox.window.onlyOverallocatedWorkload, true);
  assert.deepEqual(calls.switchToView, ['user-workload']);
  assert.equal(calls.updateUserWorkload.length, 1);
  assert.deepEqual(calls.updateUserWorkload[0], sandbox.lastRenderedTasks);
});

test('clearOverallocationFilter() drops the flag and re-renders the (now unfiltered) Workload view', () => {
  const { sandbox, calls } = makeViewSwitchSandbox();
  sandbox.window.onlyOverallocatedWorkload = true;
  sandbox.clearOverallocationFilter();
  assert.equal(sandbox.window.onlyOverallocatedWorkload, false);
  assert.equal(calls.updateUserWorkload.length, 1);
  // Unlike showOverallocationView(), clearing the filter must not navigate
  // the user away from wherever they were.
  assert.deepEqual(calls.switchToView, []);
});

// --- updateUserWorkload(): the actual overallocation filtering -----------

function makeUpdateWorkloadSandbox() {
  const elements = new Map();
  elements.set('userFilter', fakeElement({ value: 'all' }));
  const captured = [];
  const sandbox = {
    window: {},
    document: makeDocument(elements),
    displayUserWorkload: (userMap, filterUser) => captured.push({ users: [...userMap.keys()].sort(), filterUser }),
  };
  liftFunctions(sandbox, scriptSrc, ['updateUserWorkload']);
  return { sandbox, elements, captured };
}

test('updateUserWorkload() with the overallocation flag off includes every resource with any assignment', () => {
  const { sandbox, captured } = makeUpdateWorkloadSandbox();
  const tasks = [
    baseTask({ name: 'Solo task', resources: '@bob', start: '2026-02-01', finish: '2026-02-03' }),
    baseTask({ name: 'Overlap A', resources: '@alice', start: '2026-01-01', finish: '2026-01-10' }),
    baseTask({ name: 'Overlap B', resources: '@alice', start: '2026-01-05', finish: '2026-01-15' }),
  ];
  sandbox.updateUserWorkload(tasks);
  assert.equal(captured.length, 1);
  assert.deepEqual(captured[0].users, ['alice', 'bob']);
});

test('updateUserWorkload() with the overallocation flag on keeps only resources whose dated tasks overlap', () => {
  const { sandbox, captured } = makeUpdateWorkloadSandbox();
  sandbox.window.onlyOverallocatedWorkload = true;
  const tasks = [
    // bob: two non-overlapping tasks -- not overallocated.
    baseTask({ name: 'Bob 1', resources: '@bob', start: '2026-02-01', finish: '2026-02-03' }),
    baseTask({ name: 'Bob 2', resources: '@bob', start: '2026-02-04', finish: '2026-02-06' }),
    // alice: two overlapping tasks -- overallocated.
    baseTask({ name: 'Alice 1', resources: '@alice', start: '2026-01-01', finish: '2026-01-10' }),
    baseTask({ name: 'Alice 2', resources: '@alice', start: '2026-01-05', finish: '2026-01-15' }),
    // carol: a single task -- can't overlap with itself, not overallocated.
    baseTask({ name: 'Carol 1', resources: '@carol', start: '2026-03-01', finish: '2026-03-05' }),
  ];
  sandbox.updateUserWorkload(tasks);
  assert.equal(captured.length, 1);
  assert.deepEqual(captured[0].users, ['alice'], 'only the overallocated resource (alice) should remain');
});

test('updateUserWorkload() with the overallocation flag on produces an empty userMap when nobody is overallocated', () => {
  const { sandbox, captured } = makeUpdateWorkloadSandbox();
  sandbox.window.onlyOverallocatedWorkload = true;
  const tasks = [
    baseTask({ name: 'Bob 1', resources: '@bob', start: '2026-02-01', finish: '2026-02-03' }),
    baseTask({ name: 'Carol 1', resources: '@carol', start: '2026-03-01', finish: '2026-03-05' }),
  ];
  sandbox.updateUserWorkload(tasks);
  assert.deepEqual(captured[0].users, []);
});

// --- displayUserWorkload(): filter notice banner + empty-state text -------

function makeDisplaySandbox() {
  const elements = new Map();
  elements.set('userWorkloadSections', fakeElement());
  elements.set('userWorkloadEmpty', fakeElement());
  elements.set('userWorkloadEmptyText', fakeElement());
  elements.set('userWorkloadFilterNotice', fakeElement());
  elements.set('userWorkloadTitleBanner', fakeElement());
  const sandbox = {
    window: {},
    document: makeDocument(elements),
    getRAGColor: () => '#ccc',
    openMilestoneTaskForm: () => {},
  };
  liftFunctions(sandbox, scriptSrc, ['displayUserWorkload']);
  return { sandbox, elements };
}

test('displayUserWorkload() hides the filter notice and uses the generic empty text when not in overallocation mode', () => {
  const { sandbox, elements } = makeDisplaySandbox();
  sandbox.displayUserWorkload(new Map(), 'all');
  assert.equal(elements.get('userWorkloadFilterNotice').style.display, 'none');
  assert.equal(elements.get('userWorkloadTitleBanner').textContent, 'User Workload Breakdown');
  assert.equal(elements.get('userWorkloadEmptyText').textContent, 'No tasks assigned to users.');
  assert.equal(elements.get('userWorkloadEmpty').style.display, 'block', 'an empty userMap is still an empty state');
});

test('displayUserWorkload() shows the filter notice, a distinct title and a distinct empty message in overallocation mode', () => {
  const { sandbox, elements } = makeDisplaySandbox();
  sandbox.window.onlyOverallocatedWorkload = true;
  sandbox.displayUserWorkload(new Map(), 'all');
  assert.equal(elements.get('userWorkloadFilterNotice').style.display, 'flex', 'the "clear filter" banner must be visible while filtered');
  assert.equal(elements.get('userWorkloadTitleBanner').textContent, 'Overallocated Resources');
  assert.equal(elements.get('userWorkloadEmptyText').textContent, 'No resources are currently overallocated.');
  assert.equal(elements.get('userWorkloadEmpty').style.display, 'block');
});

test('displayUserWorkload() renders a section per user when the overallocation-filtered userMap is non-empty', () => {
  const { sandbox, elements } = makeDisplaySandbox();
  sandbox.window.onlyOverallocatedWorkload = true;
  const userMap = new Map([['alice', [baseTask({ name: 'Alice 1' })]]]);
  sandbox.displayUserWorkload(userMap, 'all');
  assert.equal(elements.get('userWorkloadEmpty').style.display, 'none');
  assert.equal(elements.get('userWorkloadSections').children.length, 1, 'one section for the one remaining overallocated user');
});

// --- showInfluenceDiagram(): enlarge the Stakeholders view's own diagram --

test('showInfluenceDiagram() switches to the Stakeholders view and expands its existing grid, without building a new one', () => {
  const elements = new Map();
  const wrapper = fakeElement();
  elements.set('stakeholderGridWrapper', wrapper);
  const calls = { switchToView: [] };
  const sandbox = {
    document: { getElementById: (id) => elements.get(id) || null },
    switchToView: (v) => calls.switchToView.push(v),
    requestAnimationFrame: (cb) => cb(),
  };
  liftFunctions(sandbox, scriptSrc, ['showInfluenceDiagram']);
  sandbox.showInfluenceDiagram();
  assert.deepEqual(calls.switchToView, ['stakeholders']);
  assert.ok(wrapper.classList.contains('stakeholder-grid-expanded'), 'the existing #stakeholderGridWrapper should gain the expanded class');
});

test('showInfluenceDiagram() does not blow up when the grid wrapper element is not in the DOM yet', () => {
  const calls = { switchToView: [] };
  const sandbox = {
    document: { getElementById: () => null },
    switchToView: (v) => calls.switchToView.push(v),
    requestAnimationFrame: (cb) => cb(),
  };
  liftFunctions(sandbox, scriptSrc, ['showInfluenceDiagram']);
  assert.doesNotThrow(() => sandbox.showInfluenceDiagram());
  assert.deepEqual(calls.switchToView, ['stakeholders']);
});
