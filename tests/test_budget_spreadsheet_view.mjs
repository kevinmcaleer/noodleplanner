/**
 * Regression tests for issue #1119 (part of the #1090 Budget tracker epic):
 *
 *  - the Budget tracker's "Spreadsheet" toggle button must be a proper,
 *    clearly-enabled button -- previously a 2px accent-on-white outline
 *    with no fill, which read as greyed-out/disabled even though it worked;
 *  - switching to the spreadsheet view hides the toolbar's Category/Type
 *    filter dropdowns, so equivalent filters must live in the spreadsheet's
 *    own Category/Type column headers, using the exact same option values
 *    as the toolbar filters, and must actually narrow the rows shown
 *    (individually and combined) without losing filtered-out items.
 *
 * Covers:
 *  - index.html: the Spreadsheet button isn't `disabled` and is wired to
 *    toggleBudgetSheetView().
 *  - components.css: .budget-view-toggle's base (non-hover/active) rule is
 *    a solid filled button, not a pale outline.
 *  - script.js, lifted into a sandboxed vm context (same liftFunctions/
 *    fakeElement technique as tests/test_escalations_view.mjs):
 *      - budgetItemMatchesSheetFilters() respects 'all' vs a specific
 *        category/type, including both at once,
 *      - generateBudgetTable(items) can build markdown from an arbitrary
 *        filtered subset instead of always the full budgetItems array,
 *      - syncBudgetItemsToSheet() narrows the markdown fed into the sheet
 *        by category, by type, and by both together,
 *      - syncSheetToBudgetItems() preserves items hidden by the current
 *        header filters instead of deleting them on the next edit,
 *      - injectBudgetSheetHeaderFilters() adds a <select> into the
 *        Category/Type column header cells (cloned from the toolbar's own
 *        #budgetCategoryFilter/#budgetTypeFilter, so the option values
 *        match exactly), skips other columns, and wires changing it back
 *        to the filter state + a re-sync.
 *
 * Run with: node --test tests/test_budget_spreadsheet_view.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const staticDir = join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'static');
const templatesDir = join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'templates');

const scriptSrc = readFileSync(join(staticDir, 'script.js'), 'utf8');
const html = readFileSync(join(templatesDir, 'index.html'), 'utf8');
const componentsCss = readFileSync(join(staticDir, 'components.css'), 'utf8');

/** Top-level `function name(` ... `\n}` declarations from a classic script
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

// ---------------------------------------------------------------------------
// index.html: the Spreadsheet button is a real, enabled, clickable button
// ---------------------------------------------------------------------------

test('the Budget tracker\'s Spreadsheet button is not disabled and is wired up', () => {
  const m = html.match(/<button class="toolbar-btn budget-view-toggle"[^>]*>/);
  assert.ok(m, 'could not find the budget-view-toggle button in index.html');
  const openTag = m[0];
  assert.doesNotMatch(openTag, /\bdisabled\b/, 'Spreadsheet button should not carry a disabled attribute');
  assert.match(openTag, /onclick="toggleBudgetSheetView\(\)"/);
  assert.match(openTag, /id="budgetViewToggle"/);
});

// ---------------------------------------------------------------------------
// components.css: the button is a solid, filled button, not a pale outline
// ---------------------------------------------------------------------------

test('.budget-view-toggle renders as a solid filled button, not a greyed-out outline', () => {
  const start = componentsCss.indexOf('.budget-view-toggle {');
  assert.notEqual(start, -1, '.budget-view-toggle base rule not found in components.css');
  const end = componentsCss.indexOf('}', start);
  const rule = componentsCss.slice(start, end);

  // The pre-#1119 rule filled the button with the page background and drew
  // the accent only as text/border -- exactly what read as greyed-out.
  assert.doesNotMatch(rule, /background:\s*var\(--np-surface\)/, 'button should not fall back to the surface (page background) fill');
  assert.doesNotMatch(rule, /background:\s*(#fff|white)\b/i, 'button should not be a white/unfilled outline');
  // It should instead be filled with the accent color, like other solid
  // toolbar buttons (e.g. .export-btn) elsewhere in the app.
  assert.match(rule, /background:\s*var\(--np-accent\)/, 'button should have a solid accent fill by default');
});

// ---------------------------------------------------------------------------
// script.js: budgetItemMatchesSheetFilters()
// ---------------------------------------------------------------------------

function makeFilterSandbox(categoryFilter, typeFilter) {
  const sandbox = { console };
  vm.createContext(sandbox);
  sandbox.budgetSheetCategoryFilter = categoryFilter;
  sandbox.budgetSheetTypeFilter = typeFilter;
  liftFunctions(sandbox, scriptSrc, ['budgetItemMatchesSheetFilters']);
  return sandbox;
}

test("budgetItemMatchesSheetFilters() treats 'all' as no filter on either axis", () => {
  const sandbox = makeFilterSandbox('all', 'all');
  assert.equal(sandbox.budgetItemMatchesSheetFilters({ category: 'Hardware', type: 'Opex' }), true);
  assert.equal(sandbox.budgetItemMatchesSheetFilters({ category: 'Software', type: 'Capex' }), true);
});

test('budgetItemMatchesSheetFilters() narrows by category alone', () => {
  const sandbox = makeFilterSandbox('Hardware', 'all');
  assert.equal(sandbox.budgetItemMatchesSheetFilters({ category: 'Hardware', type: 'Opex' }), true);
  assert.equal(sandbox.budgetItemMatchesSheetFilters({ category: 'Software', type: 'Opex' }), false);
});

test('budgetItemMatchesSheetFilters() narrows by type alone', () => {
  const sandbox = makeFilterSandbox('all', 'Capex');
  assert.equal(sandbox.budgetItemMatchesSheetFilters({ category: 'Hardware', type: 'Capex' }), true);
  assert.equal(sandbox.budgetItemMatchesSheetFilters({ category: 'Hardware', type: 'Opex' }), false);
});

test('budgetItemMatchesSheetFilters() combines category and type', () => {
  const sandbox = makeFilterSandbox('Hardware', 'Capex');
  assert.equal(sandbox.budgetItemMatchesSheetFilters({ category: 'Hardware', type: 'Capex' }), true);
  assert.equal(sandbox.budgetItemMatchesSheetFilters({ category: 'Hardware', type: 'Opex' }), false);
  assert.equal(sandbox.budgetItemMatchesSheetFilters({ category: 'Software', type: 'Capex' }), false);
});

// ---------------------------------------------------------------------------
// script.js: generateBudgetTable(items) accepts an arbitrary subset
// ---------------------------------------------------------------------------

test('generateBudgetTable(items) builds markdown from the given subset, not always the full list', () => {
  const sandbox = { console };
  vm.createContext(sandbox);
  sandbox.budgetItems = [
    { id: 1, description: 'Laptop', type: 'Capex', category: 'Hardware' },
    { id: 2, description: 'Consulting day', type: 'Opex', category: 'Consultancy' },
  ];
  liftFunctions(sandbox, scriptSrc, ['generateBudgetTable']);

  // No argument: falls back to the full budgetItems array (unchanged
  // behaviour for every other caller of generateBudgetTable()).
  const full = sandbox.generateBudgetTable();
  assert.match(full, /Laptop/);
  assert.match(full, /Consulting day/);

  // A filtered subset: only that subset appears.
  const filtered = sandbox.generateBudgetTable([sandbox.budgetItems[0]]);
  assert.match(filtered, /Laptop/);
  assert.doesNotMatch(filtered, /Consulting day/);
});

// ---------------------------------------------------------------------------
// script.js: syncBudgetItemsToSheet() narrows what's loaded into the sheet
// ---------------------------------------------------------------------------

function makeSyncToSheetSandbox({ categoryFilter = 'all', typeFilter = 'all' } = {}) {
  const sandbox = { console };
  vm.createContext(sandbox);
  sandbox.budgetSheetCategoryFilter = categoryFilter;
  sandbox.budgetSheetTypeFilter = typeFilter;
  sandbox.budgetItems = [
    { id: 1, description: 'Laptop', type: 'Capex', category: 'Hardware' },
    { id: 2, description: 'Consulting day', type: 'Opex', category: 'Consultancy' },
    { id: 3, description: 'Server rack', type: 'Capex', category: 'Hardware' },
  ];
  let loadedMarkdown = null;
  sandbox.budgetSheetInstance = {
    loadMarkdown(md) { loadedMarkdown = md; },
  };
  liftFunctions(sandbox, scriptSrc, ['budgetItemMatchesSheetFilters', 'generateBudgetTable', 'syncBudgetItemsToSheet']);
  return { sandbox, getLoadedMarkdown: () => loadedMarkdown };
}

test('syncBudgetItemsToSheet() with no filters loads every item', () => {
  const { sandbox, getLoadedMarkdown } = makeSyncToSheetSandbox();
  sandbox.syncBudgetItemsToSheet();
  const md = getLoadedMarkdown();
  assert.match(md, /Laptop/);
  assert.match(md, /Consulting day/);
  assert.match(md, /Server rack/);
});

test('syncBudgetItemsToSheet() narrows rows by category', () => {
  const { sandbox, getLoadedMarkdown } = makeSyncToSheetSandbox({ categoryFilter: 'Hardware' });
  sandbox.syncBudgetItemsToSheet();
  const md = getLoadedMarkdown();
  assert.match(md, /Laptop/);
  assert.match(md, /Server rack/);
  assert.doesNotMatch(md, /Consulting day/);
});

test('syncBudgetItemsToSheet() narrows rows by type', () => {
  const { sandbox, getLoadedMarkdown } = makeSyncToSheetSandbox({ typeFilter: 'Opex' });
  sandbox.syncBudgetItemsToSheet();
  const md = getLoadedMarkdown();
  assert.match(md, /Consulting day/);
  assert.doesNotMatch(md, /Laptop/);
  assert.doesNotMatch(md, /Server rack/);
});

test('syncBudgetItemsToSheet() combines category and type filters', () => {
  const { sandbox, getLoadedMarkdown } = makeSyncToSheetSandbox({ categoryFilter: 'Hardware', typeFilter: 'Capex' });
  sandbox.syncBudgetItemsToSheet();
  const md = getLoadedMarkdown();
  assert.match(md, /Laptop/);
  assert.match(md, /Server rack/);
  assert.doesNotMatch(md, /Consulting day/);

  // A combination that matches nothing produces an empty sheet, not an error.
  sandbox.budgetSheetTypeFilter = 'Opex';
  sandbox.syncBudgetItemsToSheet();
  assert.equal(getLoadedMarkdown(), '');
});

// ---------------------------------------------------------------------------
// script.js: syncSheetToBudgetItems() must not delete filtered-out items
// ---------------------------------------------------------------------------

test('syncSheetToBudgetItems() keeps items hidden by the header filters instead of deleting them', () => {
  const sandbox = { console };
  vm.createContext(sandbox);
  sandbox.budgetSheetCategoryFilter = 'Hardware';
  sandbox.budgetSheetTypeFilter = 'all';
  sandbox.budgetItems = [
    { id: 1, description: 'Laptop', type: 'Capex', category: 'Hardware' },
    { id: 2, description: 'Consulting day', type: 'Opex', category: 'Consultancy' },
  ];
  sandbox.budgetNextId = 3;
  // The sheet only shows the Hardware row (id 1); the user edits its
  // description while the Consultancy row (id 2) stays hidden off-screen.
  sandbox.budgetSheetInstance = {
    getRows: () => [{ description: 'Laptop (renamed)', estimate: '', forecast: '', type: 'Capex', invoice_number: '', po_number: '', supplier: '', total: '', date_ordered: '', date_received: '', category: 'Hardware' }],
    getColumns: () => [{ name: 'description' }, { name: 'type' }, { name: 'category' }],
  };
  liftFunctions(sandbox, scriptSrc, ['budgetItemMatchesSheetFilters', 'syncSheetToBudgetItems']);

  sandbox.syncSheetToBudgetItems();

  const descriptions = sandbox.budgetItems.map((i) => i.description);
  assert.ok(descriptions.includes('Laptop (renamed)'), 'the visible, edited row should be kept');
  assert.ok(descriptions.includes('Consulting day'), 'the row hidden by the category filter should not be deleted');
  assert.equal(sandbox.budgetItems.length, 2);
});

// ---------------------------------------------------------------------------
// script.js: injectBudgetSheetHeaderFilters() adds header <select>s
// ---------------------------------------------------------------------------

/** A minimal fake DOM element supporting just enough of the real API
 * (attributes, classList, a single text child, cloneNode, querySelector,
 * addEventListener) for injectBudgetSheetHeaderFilters() to run unmodified. */
class FakeEl {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this._attrs = {};
    this._classes = new Set();
    this.childNodes = [];
    this.parentElement = null;
    this._listeners = {};
    this.value = '';
  }
  get className() { return Array.from(this._classes).join(' '); }
  set className(v) { this._classes = new Set(String(v).trim().split(/\s+/).filter(Boolean)); }
  get classList() {
    const self = this;
    return {
      add: (...names) => names.forEach((n) => self._classes.add(n)),
      remove: (...names) => names.forEach((n) => self._classes.delete(n)),
      contains: (n) => self._classes.has(n),
    };
  }
  setAttribute(name, value) { this._attrs[name] = String(value); }
  getAttribute(name) { return name in this._attrs ? this._attrs[name] : null; }
  removeAttribute(name) { delete this._attrs[name]; }
  appendChild(node) { node.parentElement = this; this.childNodes.push(node); return node; }
  get firstChild() { return this.childNodes[0] || null; }
  get textContent() {
    return this.childNodes.map((n) => (n.tagName ? n.textContent : n._text || '')).join('');
  }
  set textContent(v) { this.childNodes = [{ _text: String(v), textContent: String(v) }]; }
  _elementSubtree(out = []) {
    this.childNodes.forEach((n) => { if (n && n.tagName) { out.push(n); n._elementSubtree(out); } });
    return out;
  }
  _matchesClass(sel) { return sel.startsWith('.') && this._classes.has(sel.slice(1)); }
  querySelectorAll(sel) { return this._elementSubtree().filter((el) => el._matchesClass(sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
  fire(type) {
    let stopped = false;
    const evt = { type, target: this, stopPropagation: () => { stopped = true; } };
    (this._listeners[type] || []).slice().forEach((fn) => fn(evt));
    return stopped;
  }
  cloneNode(deep) {
    const clone = new FakeEl(this.tagName);
    clone._attrs = { ...this._attrs };
    clone._classes = new Set(this._classes);
    clone.value = this.value;
    if (deep) {
      clone.childNodes = this.childNodes.map((n) => (n.tagName ? n.cloneNode(true) : { _text: n._text, textContent: n._text }));
      clone.childNodes.forEach((n) => { if (n.tagName) n.parentElement = clone; });
    }
    return clone;
  }
}

/** Builds a fake <select> with the same <option value="..."> children as the
 * real #id select in index.html, so tests can assert the header filter's
 * clone genuinely carries the same option values. */
function fakeSelectFromRealOptions(id) {
  const re = new RegExp(`<select id="${id}"[^>]*>([\\s\\S]*?)<\\/select>`);
  const m = html.match(re);
  assert.ok(m, `could not find #${id} in index.html`);
  const values = [...m[1].matchAll(/<option value="([^"]*)">([^<]*)</g)];
  const select = new FakeEl('select');
  select.setAttribute('id', id);
  select.setAttribute('onchange', 'renderBudgetTable()');
  values.forEach(([, value, label]) => {
    const opt = new FakeEl('option');
    opt.setAttribute('value', value);
    opt.value = value;
    opt.textContent = label;
    select.appendChild(opt);
  });
  return { select, optionValues: values.map(([, value]) => value) };
}

function makeHeaderFilterSandbox() {
  const sandbox = { console };
  vm.createContext(sandbox);
  sandbox.budgetSheetCategoryFilter = 'all';
  sandbox.budgetSheetTypeFilter = 'all';
  sandbox.syncBudgetItemsToSheet = () => { sandbox._syncCalls = (sandbox._syncCalls || 0) + 1; };

  const container = new FakeEl('div');
  container.setAttribute('id', 'budgetSheetContainer');

  function addHeader(label) {
    const th = new FakeEl('th');
    th.classList.add('ns-col-header');
    const nameDiv = new FakeEl('div');
    nameDiv.classList.add('ns-col-name');
    nameDiv.textContent = label;
    th.appendChild(nameDiv);
    container.appendChild(th);
    return th;
  }

  const categoryTh = addHeader('Category');
  const typeTh = addHeader('Type');
  const descriptionTh = addHeader('Description'); // should be left alone

  const { select: categorySelect, optionValues: categoryValues } = fakeSelectFromRealOptions('budgetCategoryFilter');
  const { select: typeSelect, optionValues: typeValues } = fakeSelectFromRealOptions('budgetTypeFilter');

  const elementsById = {
    budgetSheetContainer: container,
    budgetCategoryFilter: categorySelect,
    budgetTypeFilter: typeSelect,
  };
  sandbox.document = { getElementById: (id) => elementsById[id] || null };

  liftFunctions(sandbox, scriptSrc, ['injectBudgetSheetHeaderFilters']);

  return { sandbox, categoryTh, typeTh, descriptionTh, categoryValues, typeValues };
}

test('injectBudgetSheetHeaderFilters() adds a filter select to the Category and Type headers only', () => {
  const { sandbox, categoryTh, typeTh, descriptionTh } = makeHeaderFilterSandbox();
  sandbox.injectBudgetSheetHeaderFilters();

  assert.ok(categoryTh.querySelector('.budget-sheet-col-filter'), 'Category header should get a filter select');
  assert.ok(typeTh.querySelector('.budget-sheet-col-filter'), 'Type header should get a filter select');
  assert.equal(descriptionTh.querySelector('.budget-sheet-col-filter'), null, 'other columns should be left alone');
});

test('injectBudgetSheetHeaderFilters() offers the exact same option values as the toolbar filters', () => {
  const { sandbox, categoryTh, typeTh, categoryValues, typeValues } = makeHeaderFilterSandbox();
  sandbox.injectBudgetSheetHeaderFilters();

  const categorySelect = categoryTh.querySelector('.budget-sheet-col-filter');
  const typeSelect = typeTh.querySelector('.budget-sheet-col-filter');
  const optionValuesOf = (select) => select.childNodes.filter((n) => n.tagName === 'OPTION').map((n) => n.value);

  assert.deepEqual(optionValuesOf(categorySelect), categoryValues);
  assert.deepEqual(optionValuesOf(typeSelect), typeValues);
});

test('changing the header filter select updates the filter state and re-syncs the sheet', () => {
  const { sandbox, categoryTh } = makeHeaderFilterSandbox();
  sandbox.injectBudgetSheetHeaderFilters();

  const categorySelect = categoryTh.querySelector('.budget-sheet-col-filter');
  categorySelect.value = 'Software';
  const stopped = categorySelect.fire('change');

  assert.equal(sandbox.budgetSheetCategoryFilter, 'Software');
  assert.equal(sandbox._syncCalls, 1, 'changing the filter should trigger a re-sync of the sheet');
  assert.equal(stopped, true, 'the change should not bubble to the header\'s own sort-on-click handler');
});
