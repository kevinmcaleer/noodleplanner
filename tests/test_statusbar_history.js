/**
 * Tests for the status bar's message log (status-bar.js).
 *
 * Several independent checks (circular dependencies, MS Project assignment
 * risk, cross-project dependency RAG, duplicate deliverables, plain toasts)
 * used to each overwrite the single `#statusBarMessage` DOM slot directly,
 * so whichever ran last silently erased anyone else's warning -- including
 * an actionable warning's Fix button. This file exercises the log-backed
 * replacement directly: keyed sticky entries update in place instead of
 * spamming duplicates, an actionable warning always wins the compact slot
 * over a passive one regardless of push order, and a transient toast still
 * gets its moment before revealing whatever sticky warning is underneath.
 *
 * Run with: node tests/test_statusbar_history.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'packages', 'noodle-web', 'src',
        'noodle_web', 'static', 'status-bar.js'),
    'utf8'
);

let failures = 0;
function assert(condition, msg) {
    if (!condition) {
        failures++;
        console.error('FAIL:', msg);
    } else {
        console.log('PASS:', msg);
    }
}

// ---------------------------------------------------------------------------
// A minimal DOM stub. `window` is deliberately left undefined: status-bar.js
// guards its dynamic `import('/static/mpp-export.js')` behind
// `typeof window !== 'undefined'`, and that module's own detector is already
// covered directly in tests/test_mpp_assignment_warning.mjs (a real ES
// module import, no DOM needed) -- this file is about the log mechanics.
// ---------------------------------------------------------------------------

function makeClassList() {
    const set = new Set();
    return {
        _set: set,
        add(...cls) { cls.forEach((c) => set.add(c)); },
        remove(...cls) { cls.forEach((c) => set.delete(c)); },
        toggle(c, force) {
            const has = set.has(c);
            const want = force === undefined ? !has : !!force;
            if (want) set.add(c); else set.delete(c);
        },
        contains(c) { return set.has(c); },
    };
}

function allText(node) {
    if (!node) return '';
    if (node._isTextNode) return node.textContent;
    if (node.children) return node.children.map(allText).join('');
    return '';
}

function findByClass(node, cls) {
    if (!node || !node.children) return [];
    let out = [];
    node.children.forEach((c) => {
        if (c.classList && c.classList.contains(cls)) out.push(c);
        out = out.concat(findByClass(c, cls));
    });
    return out;
}

function makeElement(tag) {
    const el = {
        tag,
        children: [],
        style: {},
        attrs: {},
        listeners: {},
        value: '',
        _isTextNode: false,
        get textContent() { return allText(this); },
        set textContent(v) { this.children = v ? [makeTextNode(v)] : []; },
        set innerHTML(v) { this.children = []; },
        appendChild(child) {
            if (child && child._isFragment) {
                child.children.forEach((c) => this.children.push(c));
                child.children = [];
            } else {
                this.children.push(child);
            }
            return child;
        },
        removeChild(child) { this.children = this.children.filter((c) => c !== child); },
        setAttribute(k, v) { this.attrs[k] = v; },
        getAttribute(k) { return this.attrs[k]; },
        addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
        removeEventListener(type, fn) {
            if (this.listeners[type]) this.listeners[type] = this.listeners[type].filter((f) => f !== fn);
        },
        click() {
            (this.listeners.click || []).forEach((fn) => fn({ preventDefault() {}, stopPropagation() {} }));
        },
        contains(other) {
            if (other === this) return true;
            return this.children.some((c) => (c.contains ? c.contains(other) : c === other));
        },
    };
    Object.defineProperty(el, 'dataset', { value: {}, writable: true });
    el.classList = makeClassList();
    Object.defineProperty(el, 'className', {
        get() { return Array.from(this.classList._set).join(' '); },
        set(v) {
            this.classList._set.clear();
            String(v || '').split(/\s+/).filter(Boolean).forEach((c) => this.classList._set.add(c));
        },
    });
    return el;
}

function makeTextNode(text) {
    return { _isTextNode: true, textContent: text };
}

function makeFragment() {
    return { _isFragment: true, children: [], appendChild(child) { this.children.push(child); return child; } };
}

function newSandbox() {
    const elementsById = {};
    ['statusBarMessage', 'statusBarHistoryBtn', 'statusBarHistoryPopup', 'statusBarHistoryList',
        'statusBarHistoryMore', 'statusLogOverlay', 'statusLogFullList', 'planEditor'].forEach((id) => {
        elementsById[id] = makeElement(id === 'planEditor' ? 'textarea' : 'div');
    });

    const documentStub = {
        getElementById: (id) => elementsById[id] || null,
        createElement: (tag) => makeElement(tag),
        createTextNode: (text) => makeTextNode(text),
        createDocumentFragment: () => makeFragment(),
        addEventListener() {},
        removeEventListener() {},
        body: makeElement('body'),
    };

    // `window` only needs to exist so the source's `window._foo = ...`
    // globals (e.g. `_circularDependencyFixes`) don't throw a
    // ReferenceError; its guarded `import('/static/mpp-export.js')` call
    // rejects harmlessly (caught by the source's own .catch) since vm
    // contexts have no dynamic-import loader configured.
    const sandbox = { console, document: documentStub, window: {}, setTimeout, clearTimeout, Date };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    sandbox._el = elementsById;
    return sandbox;
}

// ── pushStatusLogEntry: unkeyed entries always append ───────────────────
{
    const sb = newSandbox();
    sb.pushStatusLogEntry({ text: 'Saved' });
    sb.pushStatusLogEntry({ text: 'Comms plan exported' });
    sb.renderStatusHistoryPopup();
    const rows = findByClass(sb._el.statusBarHistoryList, 'status-log-row');
    assert(rows.length === 2, 'two unkeyed pushes produce two log rows');
}

// ── pushStatusLogEntry: same key + same text is a no-op (no duplicate) ──
{
    const sb = newSandbox();
    sb.pushStatusLogEntry({ key: 'circular-dependency', text: '⚠ loop on Foo' });
    sb.pushStatusLogEntry({ key: 'circular-dependency', text: '⚠ loop on Foo' });
    sb.renderStatusHistoryPopup();
    const rows = findByClass(sb._el.statusBarHistoryList, 'status-log-row');
    assert(rows.length === 1, 're-pushing an unchanged keyed entry does not duplicate it');
}

// ── pushStatusLogEntry: same key + different text updates in place ──────
{
    const sb = newSandbox();
    sb.pushStatusLogEntry({ key: 'mpp-assignment-risk', text: '⚠ Task A is risky' });
    sb.pushStatusLogEntry({ key: 'mpp-assignment-risk', text: '⚠ Task B is risky' });
    sb.renderStatusHistoryPopup();
    const rows = findByClass(sb._el.statusBarHistoryList, 'status-log-row');
    assert(rows.length === 1, 're-pushing a changed keyed entry updates in place, not appends');
    assert(allText(sb._el.statusBarHistoryList).includes('Task B'), 'the updated text is what shows');
}

// ── clearStatusLogEntry removes a sticky entry ───────────────────────────
{
    const sb = newSandbox();
    sb.pushStatusLogEntry({ key: 'programme-dependencies', text: '⚠ dependency behind' });
    sb.clearStatusLogEntry('programme-dependencies');
    assert(allText(sb._el.statusBarMessage) === '', 'clearing the only entry empties the compact bar');
}

// ── Compact bar: actionable sticky warning wins over a passive one, ─────
// ── regardless of which was pushed first ─────────────────────────────────
{
    const sb = newSandbox();
    // Passive warning pushed LAST (most recent) -- naive "newest wins" would
    // show this one and hide the Fix button underneath.
    sb.pushStatusLogEntry({ key: 'circular-dependency', text: '⚠ Circular dependency: A -> B', actions: [{ label: 'Fix', onClick() {} }] });
    sb.pushStatusLogEntry({ key: 'duplicate-deliverables', text: '⚠ Product has no activities' });
    assert(allText(sb._el.statusBarMessage).includes('Circular dependency'),
        'the actionable warning stays visible even though a passive one was pushed after it');
}
{
    // Same scenario, opposite push order -- must still win.
    const sb = newSandbox();
    sb.pushStatusLogEntry({ key: 'duplicate-deliverables', text: '⚠ Product has no activities' });
    sb.pushStatusLogEntry({ key: 'mpp-assignment-risk', text: '⚠ Task at risk', actions: [{ label: 'Fix It', onClick() {} }] });
    assert(allText(sb._el.statusBarMessage).includes('Task at risk'),
        'an actionable warning pushed after a passive one takes the compact slot');

    // And the Fix It button itself is actually present and clickable.
    const btns = findByClass(sb._el.statusBarMessage, 'status-bar-fix-btn');
    assert(btns.length === 1 && btns[0].textContent === 'Fix It', 'the Fix It button renders in the compact bar');
}

// ── Compact bar: a transient toast gets shown even over a sticky warning ─
{
    const sb = newSandbox();
    sb.pushStatusLogEntry({ key: 'mpp-assignment-risk', text: '⚠ Task at risk', actions: [{ label: 'Fix It', onClick() {} }] });
    sb.setStatusMessage('Saved', 5000);
    assert(allText(sb._el.statusBarMessage).includes('Saved'), 'a fresh transient toast briefly takes the compact slot');
}

// ── Compact bar: once the toast expires, the sticky warning reappears ───
{
    const sb = newSandbox();
    sb.pushStatusLogEntry({ key: 'mpp-assignment-risk', text: '⚠ Task at risk', actions: [{ label: 'Fix It', onClick() {} }] });
    sb.setStatusMessage('Saved', 20); // very short duration for a fast test
    assert(allText(sb._el.statusBarMessage).includes('Saved'), 'toast shows immediately');
    setTimeout(() => {
        assert(allText(sb._el.statusBarMessage).includes('Task at risk'),
            'the still-active Fix It warning reappears once the toast expires, instead of leaving the bar blank');
        finish();
    }, 60);
}

// ── setStatusMessage('', duration, key) clears that keyed entry ─────────
function afterExpiryTest() {
    const sb = newSandbox();
    sb.pushStatusLogEntry({ key: 'storage-failure', text: 'Browser storage is full' });
    sb.setStatusMessage('', 0, 'storage-failure');
    assert(allText(sb._el.statusBarMessage) === '', 'an empty message with a key clears that sticky entry');
}

// ── updateCircularDependencyWarnings produces a Fix button and clears ───
// ── cleanly once the conflict is gone ─────────────────────────────────────
function circularDependencyTest() {
    const sb = newSandbox();
    sb._el.planEditor.value = 'Foo [depends Foo]\n';
    const result = {
        tasks: [{
            name: 'Foo',
            circular_dependencies: [{ message: 'Foo depends on itself', fixable: true, name: 'Foo' }],
        }],
    };
    sb.updateCircularDependencyWarnings(result);
    assert(allText(sb._el.statusBarMessage).includes('Circular dependency'), 'circular dependency warning shows');
    const fixBtns = findByClass(sb._el.statusBarMessage, 'status-bar-fix-btn');
    assert(fixBtns.length === 1, 'a Fix button renders for a fixable circular dependency');

    sb.updateCircularDependencyWarnings({ tasks: [] });
    assert(allText(sb._el.statusBarMessage) === '', 'the warning clears once no conflicts remain');
}

// ── History popup shows at most the 10 most recent, newest first ────────
function popupCapTest() {
    const sb = newSandbox();
    for (let i = 0; i < 14; i++) sb.pushStatusLogEntry({ text: 'Event ' + i });
    sb.openStatusHistoryPopup();
    const rows = findByClass(sb._el.statusBarHistoryList, 'status-log-row');
    assert(rows.length === 10, 'the popup shows at most 10 entries');
    assert(allText(rows[0]).includes('Event 13'), 'the popup lists newest first');
    assert(sb._el.statusBarHistoryMore.textContent.includes('4'), 'the "more in full log" count reflects what is hidden');
}

// ── Fullscreen log is not capped at 10 ───────────────────────────────────
function fullscreenNotCappedTest() {
    const sb = newSandbox();
    for (let i = 0; i < 14; i++) sb.pushStatusLogEntry({ text: 'Event ' + i });
    sb.openStatusLogFullscreen();
    const rows = findByClass(sb._el.statusLogFullList, 'status-log-row');
    assert(rows.length === 14, 'the fullscreen log is not capped at 10');
}

// ── History badge reflects actionable vs. merely-present entries ────────
function badgeTest() {
    const sb = newSandbox();
    sb.updateStatusBarHistoryToggle();
    assert(!sb._el.statusBarHistoryBtn.classList.contains('has-entries'), 'no badge when the log is empty');

    sb.pushStatusLogEntry({ text: 'Comms plan exported' });
    assert(sb._el.statusBarHistoryBtn.classList.contains('has-entries'), 'badge appears once there is a message');
    assert(!sb._el.statusBarHistoryBtn.classList.contains('has-actionable'), 'not flagged actionable for a plain toast');

    sb.pushStatusLogEntry({ key: 'circular-dependency', text: '⚠ loop', actions: [{ label: 'Fix', onClick() {} }] });
    assert(sb._el.statusBarHistoryBtn.classList.contains('has-actionable'), 'flagged actionable once a Fix-able warning exists');
}

function finish() {
    afterExpiryTest();
    circularDependencyTest();
    popupCapTest();
    fullscreenNotCappedTest();
    badgeTest();

    console.log(`\n${failures === 0 ? 'All tests passed.' : failures + ' test(s) failed.'}`);
    process.exit(failures === 0 ? 0 : 1);
}
