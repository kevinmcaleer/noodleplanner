/**
 * A small, real (not jsdom) DOM stub and sandbox loader for the notepad
 * list surface (#1049), extracted from tests/test_notepad_surface.mjs so
 * more than one test file can drive the real surface the way a browser
 * would -- see tests/test_first_time_plan.mjs, which builds a whole plan
 * through it.
 *
 * There's no jsdom in this repo's devDependencies, and every other DOM-
 * touching test here (test_kanban_board_mutations.mjs, ...) instead lifts
 * real source into a `vm` sandbox against a small hand-built stub. This is
 * that stub, with just enough surface area for notepad.js's actual DOM
 * usage: class lists, dataset, blur/focus with relatedTarget, a
 * synchronous requestAnimationFrame queue flushed after each simulated
 * user action, and a tiny class-selector-only querySelector/
 * querySelectorAll/closest.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const repo = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const staticDir = join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'static');

// ── A small, real (not jsdom) DOM stub -- just enough surface area for
// notepad.js's own DOM usage; see the file doc comment for what it covers. ──

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
        this.placeholder = '';
        this._selectionStart = 0;
        this._selectionEnd = 0;
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
    get isConnected() { return this._connected; }
    setAttribute(name, value) { this._attrs[name] = String(value); }
    getAttribute(name) { return name in this._attrs ? this._attrs[name] : null; }
    appendChild(child) {
        if (child && child._isFragment) {
            const kids = child.children.splice(0);
            kids.forEach(k => this.appendChild(k));
            return child;
        }
        child.parentElement = this;
        this.children.push(child);
        this._propagateConnected(child, this._connected);
        return child;
    }
    _propagateConnected(el, connected) {
        el._connected = connected;
        el.children.forEach(child => this._propagateConnected(child, connected));
    }
    set innerHTML(v) {
        if (v !== '') throw new Error('stub only supports innerHTML = "" (clearing)');
        // Real browsers fire a synchronous 'blur' when the focused element
        // is removed from the document -- match that here, rather than
        // leaving a stale "active element" that only surfaces a spurious
        // blur whenever something else is later focus()ed.
        const active = this._doc._active;
        if (active && this.contains(active)) this._doc._setActive(null);
        this.children.forEach(c => { c.parentElement = null; this._propagateConnected(c, false); });
        this.children = [];
    }
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
    dispatchEvent(evt) {
        evt.target = evt.target || this;
        (this._listeners[evt.type] || []).slice().forEach(fn => fn(evt));
        return true;
    }
    _subtree(out = []) {
        this.children.forEach(child => { out.push(child); child._subtree(out); });
        return out;
    }
    _matchesSimple(sel) {
        return parseClasses(sel).every(c => this._classes.has(c));
    }
    querySelectorAll(selectorList) {
        const selectors = selectorList.split(',').map(s => s.trim());
        return this._subtree().filter(el => selectors.some(sel => el._matchesSimple(sel)));
    }
    querySelector(selectorList) { return this.querySelectorAll(selectorList)[0] || null; }
    closest(sel) {
        for (let node = this; node; node = node.parentElement) if (node._matchesSimple(sel)) return node;
        return null;
    }
    contains(node) {
        for (let n = node; n; n = n.parentElement) if (n === this) return true;
        return false;
    }
    focus() { if (this._connected) this._doc._setActive(this); }
    blur() { if (this._doc._active === this) this._doc._setActive(null); }
    get selectionStart() { return this._selectionStart; }
    set selectionStart(v) { this._selectionStart = v; }
    get selectionEnd() { return this._selectionEnd; }
    set selectionEnd(v) { this._selectionEnd = v; }
    setSelectionRange(start, end) { this._selectionStart = start; this._selectionEnd = end; }
    getBoundingClientRect() { return { top: 0, left: 0, width: 100, height: 20, bottom: 20, right: 100 }; }
}

function makeDocument() {
    const doc = {
        _active: null,
        _setActive(next) {
            const prev = doc._active;
            if (prev === next) return;
            doc._active = next;
            if (prev) prev.dispatchEvent({ type: 'blur', relatedTarget: next, target: prev });
        },
        get activeElement() { return doc._active; },
        createElement: (tag) => new FakeElement(tag, doc),
        createDocumentFragment: () => ({ _isFragment: true, children: [], appendChild(c) { this.children.push(c); return c; } }),
    };
    return doc;
}

export function buildSandbox() {
    const document = makeDocument();
    const rafQueue = [];
    const sandbox = {
        console,
        document,
        window: {},
        requestAnimationFrame: (fn) => { rafQueue.push(fn); return rafQueue.length; },
        module: undefined,
    };
    vm.createContext(sandbox);
    const flushRAF = () => { while (rafQueue.length) rafQueue.shift()(); };
    return { sandbox, flushRAF, document };
}

export function loadSource(sandbox, file) {
    const source = readFileSync(join(staticDir, file), 'utf8');
    vm.runInContext(source, sandbox);
}

/** Build a live surface with a root container marked connected (as if
 * already attached to the page), plan-model.js and notepad.js loaded into
 * one shared sandbox global so NoodlePlanModel resolves inside notepad.js. */
export function buildSurface(initialText, extraOptions = {}) {
    const { sandbox, flushRAF, document } = buildSandbox();
    loadSource(sandbox, 'plan-model.js');
    loadSource(sandbox, 'notepad.js');

    const container = document.createElement('div');
    container._connected = true;

    let text = initialText;
    const setText = (next) => { text = next; };
    const surface = vm.runInContext(
        'NoodleNotepad.createNotepadSurface',
        sandbox
    )(container, { getText: () => text, setText, ...extraOptions });

    return {
        surface,
        container,
        flushRAF,
        getText: () => text,
        rows: () => container.querySelectorAll('.notepad-row'),
        inputs: () => container.querySelectorAll('.notepad-input'),
    };
}

export function keydown(key, extra = {}) {
    let prevented = false;
    return { type: 'keydown', key, shiftKey: false, ...extra, preventDefault() { prevented = true; }, get defaultPrevented() { return prevented; } };
}
export { staticDir };
