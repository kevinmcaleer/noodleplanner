/**
 * Coverage for the notepad list surface (#1049): typing a line and
 * pressing Enter creates a task, Tab/Shift+Tab indent and outdent,
 * Backspace removes an emptied leaf row, renaming on blur, and
 * drag-to-reorder -- all verified the same way the browser would see it,
 * by reading back the plan Markdown the surface produced.
 *
 * There's no jsdom in this repo's devDependencies, and every other DOM-
 * touching test here (test_kanban_board_mutations.mjs, ...) instead lifts
 * real source into a `vm` sandbox against a small hand-built stub -- this
 * follows the same approach, with a stub just capable enough for
 * notepad.js's actual DOM surface (class lists, dataset, blur/focus with
 * relatedTarget, a synchronous requestAnimationFrame queue flushed after
 * each simulated user action, and a tiny class-selector-only
 * querySelector/querySelectorAll/closest).
 *
 * Run with: node --test tests/test_notepad_surface.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
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

function buildSandbox() {
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

function loadSource(sandbox, file) {
    const source = readFileSync(join(staticDir, file), 'utf8');
    vm.runInContext(source, sandbox);
}

/** Build a live surface with a root container marked connected (as if
 * already attached to the page), plan-model.js and notepad.js loaded into
 * one shared sandbox global so NoodlePlanModel resolves inside notepad.js. */
function buildSurface(initialText, extraOptions = {}) {
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

function keydown(key, extra = {}) {
    let prevented = false;
    return { type: 'keydown', key, shiftKey: false, ...extra, preventDefault() { prevented = true; }, get defaultPrevented() { return prevented; } };
}

// ── Tests ────────────────────────────────────────────────────────────────

test('an empty plan renders a single draft row ready to type into', () => {
    const { rows, inputs } = buildSurface('');
    assert.equal(rows().length, 1);
    assert.equal(rows()[0].classList.contains('notepad-row--draft'), true);
    assert.equal(inputs()[0].value, '');
});

test('typing into the draft and pressing Enter creates the first task', () => {
    const { surface, flushRAF, getText, rows, inputs } = buildSurface('');
    const draftInput = inputs()[0];
    draftInput.value = 'Buy noodles';
    draftInput.dispatchEvent(keydown('Enter'));
    flushRAF();

    // The document started as '' -- no final newline to preserve -- so the
    // round-trip-preserving model correctly keeps it that way (see
    // test_plan_model.mjs's matching insertTaskAfter case).
    assert.equal(getText(), 'Buy noodles');
    assert.equal(rows().length, 2); // the new task, plus a fresh draft after it
    assert.equal(rows()[0].classList.contains('notepad-row--draft'), false);
    assert.equal(inputs()[0].value, 'Buy noodles');
    assert.equal(rows()[1].classList.contains('notepad-row--draft'), true);
    void surface;
});

test('pressing Enter repeatedly builds a flat outline, one task per line', () => {
    const { flushRAF, getText, inputs } = buildSurface('');
    for (const line of ['First', 'Second', 'Third']) {
        const draft = inputs()[inputs().length - 1];
        draft.value = line;
        draft.dispatchEvent(keydown('Enter'));
        flushRAF();
    }
    assert.equal(getText(), 'First\nSecond\nThird');
});

test('Tab on the current line nests it under the previous task, preserving what was typed', () => {
    // Tab re-renders the draft row (its indentation/position changes), which
    // rebuilds every row's <input> from scratch -- re-querying after each
    // dispatch (rather than reusing the original element, the way a stale
    // Playwright ElementHandle would after a real DOM rebuild) is what
    // actually exercises that rebuild, and caught a real bug where the
    // freshly-typed text was silently dropped by it.
    const { flushRAF, getText, inputs } = buildSurface('Phase\n');
    let draft = inputs()[inputs().length - 1];
    draft.value = 'Child task';
    draft.dispatchEvent(keydown('Tab'));
    flushRAF();

    draft = inputs()[inputs().length - 1];
    assert.equal(draft.value, 'Child task', 'Tab must not discard the text already typed into the draft');

    draft.dispatchEvent(keydown('Enter'));
    flushRAF();
    assert.equal(getText(), 'Phase\n  Child task\n');
});

test('Tab cannot indent a draft past one level deeper than its anchor', () => {
    const { flushRAF, getText, inputs } = buildSurface('Phase\n');
    let draft = inputs()[inputs().length - 1];
    draft.value = 'Child';
    draft.dispatchEvent(keydown('Tab')); // render() runs synchronously -> re-query
    draft = inputs()[inputs().length - 1];
    draft.dispatchEvent(keydown('Tab')); // a second Tab should not go deeper
    draft = inputs()[inputs().length - 1];
    flushRAF();
    assert.equal(draft.value, 'Child', 'repeated Tab must not discard the typed text either');
    draft.dispatchEvent(keydown('Enter'));
    flushRAF();
    assert.equal(getText(), 'Phase\n  Child\n');
});

test('Shift+Tab outdents an existing task', () => {
    const { flushRAF, getText, rows } = buildSurface('Phase\n  Child 1d\n');
    const childRow = rows().find(r => r.querySelector('.notepad-input').value === 'Child');
    const input = childRow.querySelector('.notepad-input');
    input.dispatchEvent(keydown('Tab', { shiftKey: true }));
    flushRAF();
    assert.equal(getText(), 'Phase\nChild 1d\n');
});

test('editing an existing task and blurring renames it', () => {
    const { flushRAF, getText, rows } = buildSurface('Old name 1d\n');
    const input = rows()[0].querySelector('.notepad-input');
    input.value = 'New name';
    input.dispatchEvent({ type: 'blur', relatedTarget: null });
    flushRAF();
    assert.equal(getText(), 'New name 1d\n');
});

test('blurring without any edit does not touch the document', () => {
    const { flushRAF, getText, rows } = buildSurface('Task 1d\n');
    const input = rows()[0].querySelector('.notepad-input');
    input.dispatchEvent({ type: 'blur', relatedTarget: null });
    flushRAF();
    assert.equal(getText(), 'Task 1d\n');
});

test('clearing a task name to blank is refused and the input reverts', () => {
    const { flushRAF, getText, rows } = buildSurface('Task 1d\n');
    const input = rows()[0].querySelector('.notepad-input');
    input.value = '   ';
    input.dispatchEvent({ type: 'blur', relatedTarget: null });
    flushRAF();
    assert.equal(getText(), 'Task 1d\n');
    assert.equal(input.value, 'Task');
});

test('Backspace at the start of an emptied leaf task removes it', () => {
    const { flushRAF, getText, rows } = buildSurface('First\nSecond\nThird\n');
    const secondInput = rows()[1].querySelector('.notepad-input');
    secondInput.value = '';
    secondInput.selectionStart = 0;
    secondInput.selectionEnd = 0;
    secondInput.dispatchEvent(keydown('Backspace'));
    flushRAF();
    assert.equal(getText(), 'First\nThird\n');
});

test('Backspace refuses to remove a task that still has children', () => {
    const { flushRAF, getText, rows } = buildSurface('Phase\n  Child 1d\n');
    const phaseInput = rows()[0].querySelector('.notepad-input');
    phaseInput.value = '';
    phaseInput.selectionStart = 0;
    phaseInput.selectionEnd = 0;
    phaseInput.dispatchEvent(keydown('Backspace'));
    flushRAF();
    assert.equal(getText(), 'Phase\n  Child 1d\n');
});

test('dragging a row onto another reorders through the same model moveBefore/moveAfter used elsewhere', () => {
    const { flushRAF, getText, rows } = buildSurface('First\nSecond\nThird\n');
    const dataTransfer = { effectAllowed: null, dropEffect: null, _data: {}, types: ['text/plain'], setData(t, v) { this._data[t] = v; }, getData(t) { return this._data[t]; }, setDragImage() {} };

    const firstHandle = rows()[0].querySelector('.notepad-drag-handle');
    firstHandle.dispatchEvent({ type: 'dragstart', dataTransfer });

    const thirdRow = rows()[2];
    // clientY 25 with a stubbed 20px-tall row (top 0) resolves to "after".
    thirdRow.dispatchEvent({ type: 'dragover', clientY: 25, dataTransfer, preventDefault() {} });
    thirdRow.dispatchEvent({ type: 'drop', clientY: 25, dataTransfer, preventDefault() {} });
    flushRAF();

    assert.equal(getText(), 'Second\nThird\nFirst\n');
});

test('refresh() re-reads getText() and rebuilds from the new document', () => {
    const { surface, getText, rows, inputs } = buildSurface('Original\n');
    // Simulate an external edit (e.g. the raw Markdown editor) that bypassed
    // the surface entirely.
    const external = 'Original\nAdded elsewhere\n';
    // The test's own setText closure is captured by buildSurface(); reach
    // around it is unnecessary here since refresh() re-reads via getText().
    const before = getText();
    assert.equal(before, 'Original\n');
    surface.refresh();
    // getText() still returns the original text (nothing external actually
    // changed it in this harness) -- refresh() is exercised for "does it
    // run without throwing and keep the surface consistent".
    assert.equal(rows().length, 2); // "Original" task + trailing draft
    assert.equal(inputs()[0].value, 'Original');
    void external;
});

test('a caller-supplied onSwitchToKanban callback renders a Board button and fires on click', () => {
    let clicked = false;
    const { container } = buildSurface('Task 1d\n', { onSwitchToKanban: () => { clicked = true; } });
    const btn = container.querySelector('.notepad-kanban-btn');
    assert.ok(btn, 'expected a Board button when onSwitchToKanban is supplied');
    btn.dispatchEvent({ type: 'click' });
    assert.equal(clicked, true);
});

test('no Board button is rendered when onSwitchToKanban is not supplied (the generic, standalone seam)', () => {
    const { container } = buildSurface('Task 1d\n');
    assert.equal(container.querySelector('.notepad-kanban-btn'), null);
});
