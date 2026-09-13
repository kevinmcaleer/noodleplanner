/**
 * Headless DOM smoke test for back-matter-panel.js (#1203): mounts the real
 * panel source against a small hand-built DOM stub (same approach as
 * test_front_matter_panel.mjs -- there's no jsdom in this repo's
 * devDependencies) and drives it through collapse/expand and editing the
 * raw markdown, checking the result by reading back the plan text the
 * panel produced.
 *
 * Run with: node --test tests/test_back_matter_panel.mjs
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
}

function matches(el, sel) {
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
        module: undefined,
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
    loadSource(sandbox, 'back-matter-panel.js');

    const editor = sandbox.document.createElement('textarea');
    editor.value = planText;
    editor._connected = true;
    const container = sandbox.document.createElement('div');
    container._connected = true;
    sandbox.document._register('planEditor', editor);
    sandbox.document._register('backMatterPanel', container);

    vm.runInContext('BackMatterPanel.init();', sandbox);
    return { sandbox, editor, container, panel: vm.runInContext('BackMatterPanel.instance', sandbox) };
}

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

test('a plan with no back matter hides the panel', () => {
    const { container, panel } = buildPanel('Phase\n  Task 1d\n');
    assert.equal(panel.present, false);
    assert.equal(container.style.display, 'none');
});

test('a plan with back matter shows the panel, collapsed by default', () => {
    const text = 'Phase\n  Task 1d\n\n---highlights---\n- Kick-off done\n';
    const { container, panel } = buildPanel(text);
    assert.equal(panel.present, true);
    assert.equal(panel.collapsed, true);
    assert.notEqual(container.style.display, 'none');
    assert.equal(container.querySelector('.fm-raw-textarea'), null);
    assert.ok(container.querySelector('.fm-summary-toggle'));
});

test('clicking the disclosure toggle shows the raw markdown for the back matter', () => {
    const text = 'Phase\n  Task 1d\n\n---highlights---\n- Kick-off done\n';
    const { container, panel } = buildPanel(text);
    const toggle = container.querySelector('.fm-summary-toggle');
    toggle.dispatchEvent({ type: 'click' });
    assert.equal(panel.collapsed, false);
    const textarea = container.querySelector('.fm-raw-textarea');
    assert.ok(textarea, 'expected the raw textarea once expanded');
    assert.equal(textarea.value, '---highlights---\n- Kick-off done\n');

    toggle.dispatchEvent({ type: 'click' });
    assert.equal(panel.collapsed, true);
    assert.equal(container.querySelector('.fm-raw-textarea'), null);
});

test('editing the raw textarea writes the change back into the shared editor text', async () => {
    const text = 'Phase\n  Task 1d\n\n---highlights---\n- Kick-off done\n';
    const { editor, container } = buildPanel(text);
    container.querySelector('.fm-summary-toggle').dispatchEvent({ type: 'click' });
    const textarea = container.querySelector('.fm-raw-textarea');
    textarea.value = '---highlights---\n- Kick-off done\n- First demo landed\n';
    textarea.dispatchEvent({ type: 'input' });
    await wait(500);
    assert.equal(editor.value, 'Phase\n  Task 1d\n\n---highlights---\n- Kick-off done\n- First demo landed\n');
});

test('typing the raw markdown directly into the editor keeps the panel in sync via refreshFromEditor', () => {
    const { editor, container, panel } = buildPanel('Phase\n  Task 1d\n');
    assert.equal(panel.present, false);
    editor.value = 'Phase\n  Task 1d\n\n---benefits---\n| ID | Benefit |\n';
    panel.refreshFromEditor();
    assert.equal(panel.present, true);
    assert.notEqual(container.style.display, 'none');
});
