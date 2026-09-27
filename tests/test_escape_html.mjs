/**
 * The one global escapeHtml() (state.js), and the markup built with it.
 *
 * escapeHtml() used to be declared four times as a top-level function --
 * twice in script.js, once each in version-history.js and
 * portfolio-projects-table.js -- and, because every classic <script> shares
 * one global scope, whichever loaded last won for every caller. All four
 * were DOM round-trips (textContent -> innerHTML), which escape & < > but
 * leave " and ' alone, yet ~50 callers put the result inside a quoted
 * attribute (title="...", data-*="..."): a task, risk or project name
 * arriving in a shared plan or a collab session could close the attribute
 * and add an event handler of its own. Two of the copies also returned ''
 * for any falsy value, so a 0 rendered blank.
 *
 * Covers:
 *  - exactly one classic script declares escapeHtml, it is state.js, and
 *    state.js loads before every script that calls it (index.html and
 *    collab_join.html);
 *  - escapeHtml() escapes & < > " ', keeps 0, and blanks null/undefined;
 *  - escapeJsAttr() round-trips any string through onclick="f('...')";
 *  - no caller still backslash-escapes ' *after* escapeHtml() (which now
 *    turns it into &#39;, decoded back to a bare ' before the JS runs);
 *  - the RAID table row, the Kanban breadcrumb and the Deliverables
 *    matrix, which interpolated plan text without escaping it.
 *
 * Run with: node --test tests/test_escape_html.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const staticDir = join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'static');
const templatesDir = join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'templates');

const read = (file) => readFileSync(join(staticDir, file), 'utf8');

/** The classic (non-module) /static scripts a template loads, in order. */
function classicScripts(template) {
  const html = readFileSync(join(templatesDir, template), 'utf8');
  return [...html.matchAll(/<script\b([^>]*)\bsrc="\/static\/([^"?]+)/g)]
    .filter(m => !/type="module"/.test(m[1]))
    .map(m => m[2]);
}

/** Top-level `function name(` ... `\n}` declarations from a classic script. */
function liftFunctions(sandbox, file, names) {
  const source = read(file);
  for (const name of names) {
    const start = source.indexOf(`\nfunction ${name}(`);
    assert.notEqual(start, -1, `${name} not found in ${file}`);
    const end = source.indexOf('\n}\n', start);
    assert.notEqual(end, -1, `${name} in ${file} has no closing brace at column 0`);
    vm.runInContext(source.slice(start, end + 3), sandbox);
  }
  return sandbox;
}

/** state.js's helpers in a fresh context -- no DOM, which they must not need. */
function escapers() {
  const sandbox = vm.createContext({});
  liftFunctions(sandbox, 'state.js', ['escapeHtml', 'escapeJsAttr']);
  return sandbox;
}

const decodeEntities = (s) => s
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const HOSTILE = 'x" onmouseover="alert(1)" data-x=\'<img src=x onerror=alert(2)>&';

// ---------------------------------------------------------------------------
// One declaration, loaded first
// ---------------------------------------------------------------------------

for (const template of ['index.html', 'collab_join.html']) {
  test(`${template}: state.js declares the only escapeHtml, before every caller`, () => {
    const scripts = classicScripts(template);
    const declaring = scripts.filter(f => /^(?:async\s+)?function\s+escapeHtml\s*\(/m.test(read(f)));
    assert.deepEqual(declaring, ['state.js']);
    const stateAt = scripts.indexOf('state.js');
    for (const [index, file] of scripts.entries()) {
      if (/\bescapeHtml\(/.test(read(file)) && file !== 'state.js') {
        assert.ok(index > stateAt, `${file} calls escapeHtml but loads before state.js`);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Behaviour
// ---------------------------------------------------------------------------

test('escapeHtml() escapes quotes, so its result is safe inside an attribute', () => {
  const { escapeHtml } = escapers();
  const out = escapeHtml('x" onmouseover="y');
  assert.doesNotMatch(out, /"/);
  assert.equal(out, 'x&quot; onmouseover=&quot;y');
  assert.equal(escapeHtml("it's"), 'it&#39;s');
  assert.equal(escapeHtml('<b>&</b>'), '&lt;b&gt;&amp;&lt;/b&gt;');
  assert.equal(decodeEntities(escapeHtml(HOSTILE)), HOSTILE);
});

test('escapeHtml() renders 0 and false, and blanks only null/undefined', () => {
  const { escapeHtml } = escapers();
  assert.equal(escapeHtml(0), '0');
  assert.equal(escapeHtml(false), 'false');
  assert.equal(escapeHtml(''), '');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(12.5), '12.5');
});

test("escapeJsAttr() survives onclick=\"f('...')\" for any string", () => {
  const { escapeJsAttr } = escapers();
  for (const value of ["O'Brien's plan", HOSTILE, 'back\\slash', 'two\nlines', "');alert(1);('", null]) {
    const attr = escapeJsAttr(value);
    assert.doesNotMatch(attr, /["'<>]/, 'the attribute value itself must be inert');
    // The browser decodes the attribute's entities, then runs the handler.
    const js = decodeEntities(attr);
    assert.equal(vm.runInNewContext(`'${js}'`), value == null ? '' : value);
  }
});

test("no caller backslash-escapes ' after escapeHtml() (which has already made it &#39;)", () => {
  const offenders = [];
  for (const file of classicScripts('index.html')) {
    read(file).split('\n').forEach((line, i) => {
      if (/escapeHtml\([^)]*\)\.replace\(\/'\/g,\s*"\\\\'"\)/.test(line)) offenders.push(`${file}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
});

// ---------------------------------------------------------------------------
// Markup that interpolated plan text unescaped
// ---------------------------------------------------------------------------

/** A fake element: records innerHTML/textContent, children and attributes. */
function fakeElement(tag = 'div', created = []) {
  const el = {
    tagName: tag.toUpperCase(),
    innerHTML: '',
    textContent: '',
    className: '',
    href: '',
    title: '',
    style: {},
    dataset: {},
    children: [],
    classList: { add() {}, remove() {}, contains: () => false },
    appendChild(child) { el.children.push(child); return child; },
    addEventListener() {},
    querySelector: () => fakeElement('a', created),
    querySelectorAll: () => [],
  };
  created.push(el);
  return el;
}

const allMarkup = (created) => created.map(el => el.innerHTML).join('\n');

test('the RAID log table escapes every field it writes into a row', () => {
  const created = [];
  const elements = {
    raidTableBody: fakeElement('tbody', created),
    raidEmptyState: fakeElement('div', created),
    raidTable: fakeElement('table', created),
  };
  const sandbox = vm.createContext({
    console,
    document: {
      getElementById: (id) => elements[id] || null,
      createElement: (tag) => fakeElement(tag, created),
    },
    raidItems: [{
      id: 7, // an integer from every RAID parser; it also lands in onclick="openRaidForm(7)"
      type: 'risk"><img src=x onerror=alert(2)>',
      title: HOSTILE,
      description: HOSTILE,
      raised_by: HOSTILE,
      owner: HOSTILE,
      mitigation_actions: HOSTILE,
      impact: 3,
      likelihood: 3,
      score: 9,
      status: 'open"><img src=x onerror=alert(3)>',
      escalated: true,
      escalation_level: 'board"><img src=x onerror=alert(4)>',
      priority: HOSTILE,
      target_date: HOSTILE,
    }],
    raidSortColumn: 'id',
    raidSortAsc: true,
    renderEscalationsView() {},
    updateRaidSortIndicators() {},
    updateRaidMarkdownEditor() {},
    syncRaidLogToPlanText() {},
    showRaidContextMenu() {},
  });
  liftFunctions(sandbox, 'state.js', ['escapeHtml']);
  liftFunctions(sandbox, 'script.js', ['renderRaidTable']);
  sandbox.renderRaidTable();

  const rows = elements.raidTableBody.children;
  assert.equal(rows.length, 1);
  assert.doesNotMatch(rows[0].innerHTML, /<img/);
  assert.doesNotMatch(rows[0].innerHTML, /" onmouseover=/);
});

function loadKanban(created) {
  const elements = { kanbanBreadcrumb: fakeElement('nav', created) };
  const sandbox = vm.createContext({
    console,
    document: {
      readyState: 'loading', // keep kanban.js from initialising itself on load
      getElementById: (id) => elements[id] || null,
      createElement: (tag) => fakeElement(tag, created),
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
    },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    window: {},
  });
  vm.runInContext(`${read('kanban.js')}\nthis.KanbanBoard = KanbanBoard;`, sandbox);
  return { board: new sandbox.KanbanBoard('phase'), elements };
}

test('the Kanban breadcrumb shows a parent task name as text, not markup', () => {
  const created = [];
  const { board } = loadKanban(created);
  const name = '<img src=x onerror=alert(1)>';
  board.hierarchyBreadcrumb = [{ name, lineNumber: 1 }];
  board.currentParentTask = { name: 'Child', lineNumber: 2 };
  board.renderBreadcrumb();

  assert.doesNotMatch(allMarkup(created), /<img/);
  assert.ok(created.some(el => el.textContent === name), 'the crumb should carry the name as its text');
});

test('the Deliverables matrix escapes names, ids and people in its role cells', () => {
  const created = [];
  const elements = { deliverablesMatrixBody: fakeElement('tbody', created) };
  const deliverable = { name: 'Spec', deliverable: 'spec"><img src=x onerror=alert(1)>', percent: 0 };
  const sandbox = vm.createContext({
    console,
    window: {},
    globalResourceMap: {},
    document: {
      getElementById: (id) => elements[id] || null,
      querySelector: () => null,
      createElement: (tag) => fakeElement(tag, created),
    },
    pbsExtractDeliverables: () => [deliverable],
    pbsComputeRollup: () => ({ percent: 0 }),
    _dmCollectPeople: () => [{ shortname: 'kev"><img src=x onerror=alert(2)>', displayName: HOSTILE }],
    _dmGetRolesForDeliverable: () => ({}),
  });
  liftFunctions(sandbox, 'state.js', ['escapeHtml']);
  liftFunctions(sandbox, 'views-products.js', ['updateDeliverablesMatrix']);
  sandbox.updateDeliverablesMatrix([deliverable], 'Plan', {}, []);

  const rows = elements.deliverablesMatrixBody.children;
  assert.equal(rows.length, 1);
  assert.doesNotMatch(rows[0].innerHTML, /<img/);
  assert.doesNotMatch(rows[0].innerHTML, /" onmouseover=/);
});
