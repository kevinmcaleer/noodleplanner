/**
 * Headless DOM smoke test for front-matter-panel.js (#780): mounts the
 * real panel source against a small hand-built DOM stub (same approach as
 * test_notepad_surface.mjs -- there's no jsdom in this repo's
 * devDependencies) and drives it through collapse/expand, editing a known
 * key, adding a custom key, and the raw/structured toggle, checking the
 * result by reading back the plan text the panel produced.
 *
 * Run with: node --test tests/test_front_matter_panel.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const staticDir = join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'static');

function parseClasses(simpleSelector) {
    return simpleSelector.trim().split('.').filter(Boolean);
}

class FakeElement {
    constructor(tagName, doc) {
        this.tagName = String(tagName).toUpperCase();
        this._doc = doc;
        this.children = [];
        this.parentElement = null;
        this._classes = new Set();
        this._attrs = {};
        this.dataset = {};
        this.style = {};
        this._listeners = {};
        this.value = '';
        this._connected = false;
    }
    get className() { return Array.from(this._classes).join(' '); }
    set className(v) { this._classes = new Set(String(v).trim().split(/\s+/).filter(Boolean)); }
    get classList() {
        const self = this;
        return {
            add: (...names) => names.forEach(n => self._classes.add(n)),
            remove: (...names) => names.forEach(n => self._classes.delete(n)),
            contains: (n) => self._classes.has(n),
        };
    }
    setAttribute(name, value) { this._attrs[name] = String(value); }
    getAttribute(name) { return name in this._attrs ? this._attrs[name] : null; }
    removeAttribute(name) { delete this._attrs[name]; }
    appendChild(child) { child.parentElement = this; this.children.push(child); this._propagateConnected(child, this._connected); return child; }
    _propagateConnected(el, connected) { el._connected = connected; el.children.forEach(c => this._propagateConnected(c, connected)); }
    set innerHTML(v) {
        if (v !== '') throw new Error('stub only supports innerHTML = "" (clearing)');
        this.children.forEach(c => { c.parentElement = null; this._propagateConnected(c, false); });
        this.children = [];
    }
    get textContent() { return this._text || ''; }
    set textContent(v) { this._text = v; this.children = []; }
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
    dispatchEvent(evt) {
        evt.target = evt.target || this;
        (this._listeners[evt.type] || []).slice().forEach(fn => fn(evt));
        return true;
    }
    _subtree(out = []) { this.children.forEach(c => { out.push(c); c._subtree(out); }); return out; }
    _matchesSimple(sel) { return parseClasses(sel).every(c => this._classes.has(c)); }
    querySelectorAll(selectorList) {
        const selectors = selectorList.split(',').map(s => s.trim());
        return this._subtree().filter(el => selectors.some(sel => matches(el, sel)));
    }
    querySelector(selectorList) { return this.querySelectorAll(selectorList)[0] || null; }
    contains(node) { for (let n = node; n; n = n.parentElement) if (n === this) return true; return false; }
    focus() { this._doc._active = this; }
    scrollIntoView() { /* no-op: no real layout in this stub */ }
}

function matches(el, sel) {
    const attrMatch = /^\[data-row-id="(.+)"\]$/.exec(sel);
    if (attrMatch) return el.getAttribute('data-row-id') === attrMatch[1];
    if (sel === 'input' || sel === 'textarea' || sel === 'select') return el.tagName.toLowerCase() === sel;
    return el._matchesSimple(sel);
}

function makeDocument() {
    const byId = new Map();
    const doc = {
        _active: null,
        get activeElement() { return doc._active; },
        createElement: (tag) => new FakeElement(tag, doc),
        getElementById: (id) => byId.get(id) || null,
        _register(id, el) { byId.set(id, el); },
    };
    return doc;
}

function buildSandbox() {
    const document = makeDocument();
    const store = {};
    const localStorage = {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
    };
    const sandbox = {
        console,
        document,
        window: {},
        localStorage,
        Event: class { constructor(type, opts) { this.type = type; Object.assign(this, opts); } },
        setTimeout, clearTimeout,
        requestAnimationFrame: (fn) => setTimeout(fn, 0),
        module: undefined,
        prompt: () => 'custom-value',
    };
    vm.createContext(sandbox);
    return sandbox;
}

function loadSource(sandbox, file) {
    const source = readFileSync(join(staticDir, file), 'utf8');
    vm.runInContext(source, sandbox);
}

function buildPanel(planText) {
    const sandbox = buildSandbox();
    loadSource(sandbox, 'plan-model.js');
    loadSource(sandbox, 'front-matter-model.js');
    loadSource(sandbox, 'front-matter-panel.js');

    const editor = sandbox.document.createElement('textarea');
    editor.value = planText;
    editor._connected = true;
    const container = sandbox.document.createElement('div');
    container._connected = true;
    sandbox.document._register('planEditor', editor);
    sandbox.document._register('frontMatterPanel', container);

    vm.runInContext('FrontMatterPanel.init();', sandbox);
    return { sandbox, editor, container, panel: vm.runInContext('FrontMatterPanel.instance', sandbox) };
}

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

test('panel with more than 10 lines of front matter starts collapsed', () => {
    const lines = ['---'];
    for (let i = 0; i < 12; i++) lines.push(`key${i}: value${i}`);
    lines.push('---', 'Phase', '  Task 1d', '');
    const { container, panel } = buildPanel(lines.join('\n'));
    assert.equal(panel.collapsed, true);
    assert.equal(container.querySelector('.fm-row-list'), null);
    assert.ok(container.querySelector('.fm-summary-count'));
});

test('a short front matter block starts expanded, in structured mode', () => {
    const text = '---\ntitle: My Project\n---\nPhase\n  Task 1d\n';
    const { container, panel } = buildPanel(text);
    assert.equal(panel.collapsed, false);
    assert.ok(container.querySelector('.fm-row-list'));
    const keyLabel = container.querySelectorAll('.fm-row-key')[0];
    assert.equal(keyLabel.textContent, 'Title');
});

test('clicking the summary toggle expands and collapses the panel', () => {
    const text = '---\ntitle: My Project\n---\nPhase\n  Task 1d\n';
    const { container, panel } = buildPanel(text);
    const toggle = container.querySelector('.fm-summary-toggle');
    toggle.dispatchEvent({ type: 'click' });
    assert.equal(panel.collapsed, true);
    toggle.dispatchEvent({ type: 'click' });
    assert.equal(panel.collapsed, false);
});

test('editing a known field through its widget writes back into the editor and leaves other lines alone', async () => {
    const text = '---\ntitle: My Project\nsponsor: CEO\n# a comment\n---\nPhase\n  Task 1d\n';
    const { editor, container } = buildPanel(text);
    const rows = container.querySelectorAll('.fm-row');
    const titleRow = rows.find(r => {
        const label = r.querySelector('.fm-row-key');
        return label && label.textContent === 'Title';
    });
    const input = titleRow.querySelector('input');
    input.value = 'Renamed Project';
    input.dispatchEvent({ type: 'input' });
    await wait(500);
    assert.equal(editor.value, '---\ntitle: Renamed Project\nsponsor: CEO\n# a comment\n---\nPhase\n  Task 1d\n');
});

test('the status field renders as a select with the RAG options', () => {
    const text = '---\nstatus: Amber\n---\nPhase\n  Task 1d\n';
    const { container } = buildPanel(text);
    const select = container.querySelector('.fm-value-select');
    assert.ok(select, 'expected a <select> widget for status');
});

test('adding a custom key appends it and it is editable afterwards', async () => {
    const text = '---\ntitle: My Project\n---\nPhase\n  Task 1d\n';
    const { editor, container, sandbox } = buildPanel(text);
    const select = container.querySelector('.fm-add-key-select');
    select.value = '__custom__';
    select.dispatchEvent({ type: 'change' });
    await wait(500);
    assert.match(editor.value, /custom-value:/);
});

test('raw mode shows exactly the reconstructed front-matter body and round-trips', () => {
    const text = '---\ntitle: My Project\nsponsor: CEO\n---\nPhase\n  Task 1d\n';
    const { container, panel } = buildPanel(text);
    const rawBtn = container.querySelectorAll('.fm-mode-btn')[1];
    rawBtn.dispatchEvent({ type: 'click' });
    assert.equal(panel.mode, 'raw');
    const textarea = container.querySelector('.fm-raw-textarea');
    assert.equal(textarea.value, 'title: My Project\nsponsor: CEO\n');
});

test('a plan with no front matter offers to add one', () => {
    const text = 'Phase\n  Task 1d\n';
    const { container } = buildPanel(text);
    assert.ok(container.querySelector('.fm-add-frontmatter-btn'));
});

function calendarListRow(container) {
    return container.querySelectorAll('.fm-row').find(r => {
        const label = r.querySelector('.fm-row-key');
        return label && label.textContent === 'Calendars';
    });
}

function calendarSelectRow(container) {
    return container.querySelectorAll('.fm-row').find(r => {
        const label = r.querySelector('.fm-row-key');
        return label && label.textContent === 'Active Calendar';
    });
}

test('the calendars field renders one text row per calendar, editable', async () => {
    const text = '---\ncalendars:\n- Standard: Mon-Fri\n- Gulf: Sun-Thu\n---\nPhase\n  Task 1d\n';
    const { editor, container } = buildPanel(text);
    const row = calendarListRow(container);
    const entries = row.querySelectorAll('.fm-list-entry');
    assert.equal(entries.length, 2);

    const gulfPattern = entries[1].querySelectorAll('input')[1];
    gulfPattern.value = 'Sun-Wed';
    gulfPattern.dispatchEvent({ type: 'input' });
    await wait(500);
    assert.match(editor.value, /- Gulf: Sun-Wed/);
});

test('the active-calendar field is a select offering Standard plus every declared calendar', () => {
    const text = '---\ncalendar: Gulf\ncalendars:\n- Standard: Mon-Fri\n- Gulf: Sun-Thu\n---\nPhase\n  Task 1d\n';
    const { container } = buildPanel(text);
    const row = calendarSelectRow(container);
    const select = row.querySelector('select');
    assert.ok(select, 'expected a <select> widget for the active calendar');
    const optionTexts = select.children.map(o => o.textContent);
    assert.deepEqual(optionTexts, ['(unset — Standard)', 'Standard', 'Gulf']);
    assert.equal(select.value, 'Gulf');
});

test('the active-calendar select still offers Standard when no calendars: block exists', () => {
    // The "Active Calendar" row itself only appears once its key is present
    // in the text (same rule as every other schema key -- absent keys are
    // added via the "+ Add key" control, not shown pre-emptively).
    const text = '---\ntitle: No Calendars\ncalendar:\n---\nPhase\n  Task 1d\n';
    const { container } = buildPanel(text);
    const row = calendarSelectRow(container);
    const select = row.querySelector('select');
    assert.deepEqual(select.children.map(o => o.textContent), ['(unset — Standard)', 'Standard']);
});

test('choosing an active calendar commits the calendar: key', async () => {
    const text = '---\ncalendar:\ncalendars:\n- Gulf: Sun-Thu\n---\nPhase\n  Task 1d\n';
    const { editor, container } = buildPanel(text);
    const row = calendarSelectRow(container);
    const select = row.querySelector('select');
    select.value = 'Gulf';
    select.dispatchEvent({ type: 'change' });
    await wait(0);
    assert.match(editor.value, /^calendar: Gulf$/m);
});

// #1047 ribbon follow-up: revealCalendars() is what the ribbon's Calendars
// button now calls (via ribbon.js's revealCalendarsPanel()) instead of
// falling through to a "not available yet" toast.

test('revealCalendars expands a collapsed panel into structured mode and focuses the add-key control when no calendars key exists', async () => {
    const lines = ['---'];
    for (let i = 0; i < 12; i++) lines.push(`key${i}: value${i}`);
    lines.push('---', 'Phase', '  Task 1d', '');
    const { panel, sandbox } = buildPanel(lines.join('\n'));
    assert.equal(panel.collapsed, true, 'sanity check: panel starts collapsed');
    panel.revealCalendars();
    await wait(10);
    assert.equal(panel.collapsed, false);
    assert.equal(panel.mode, 'structured');
    assert.equal(sandbox.document.activeElement && sandbox.document.activeElement.className, 'fm-add-key-select');
});

test('revealCalendars scrolls to and highlights an existing Calendars row', async () => {
    const text = '---\ntitle: My Project\ncalendars:\n- Gulf: Sun-Thu\n---\nPhase\n  Task 1d\n';
    const { panel, container } = buildPanel(text);
    panel.setMode('raw');
    panel.revealCalendars();
    await wait(10);
    assert.equal(panel.mode, 'structured');
    const calendarsRow = container.querySelectorAll('.fm-row').find(r => r.querySelector('.fm-row-key')?.textContent === 'Calendars');
    assert.ok(calendarsRow, 'expected a Calendars row once revealed');
    assert.ok(calendarsRow.classList.contains('fm-row-highlight'));
});

test('revealCalendars scrolls to the "+ Add front matter" button when the plan has no front matter block', async () => {
    const { panel, sandbox } = buildPanel('Phase\n  Task 1d\n');
    assert.equal(panel.present, false, 'sanity check: no front matter present');
    panel.revealCalendars();
    await wait(10);
    assert.equal(sandbox.document.activeElement && sandbox.document.activeElement.className, 'toolbar-btn fm-add-frontmatter-btn');
});
