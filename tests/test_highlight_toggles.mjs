/**
 * highlight-toggles.js -- per-category syntax highlight toggles (#1051).
 *
 * The module only ever touches a body-level CSS class and a localStorage
 * key -- it never rewrites editor text. It also keeps its state at
 * closure/module scope (loaded once at start-up, like a real page would
 * load it), so each test here runs the source fresh in its own vm.Context
 * -- the same technique tests/test_kanban_board_mutations.mjs uses for
 * KanbanBoard -- rather than relying on Node's module cache, which would
 * share one instance's state across assertions.
 *
 * Run with: node --test tests/test_highlight_toggles.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const modulePath = join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'static', 'highlight-toggles.js');
const source = readFileSync(modulePath, 'utf8');

function makeStorage() {
    const store = {};
    return {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
    };
}

function makeBody() {
    const classes = new Set();
    return {
        classList: {
            toggle(name, force) {
                const has = classes.has(name);
                const want = force === undefined ? !has : force;
                if (want) classes.add(name); else classes.delete(name);
            },
            contains: (name) => classes.has(name),
        },
    };
}

/** Run highlight-toggles.js fresh in its own sandbox, with `localStorage`
 * and `document.body` seeded before the module's own top-level `load()`/
 * `applyToDom()` calls run -- exercising the exact same start-up path a
 * real page load takes. */
function loadModule({ storage = makeStorage(), body = makeBody() } = {}) {
    const sandbox = { console, localStorage: storage, document: { body }, module: { exports: {} } };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    return { mod: sandbox.HighlightToggles, storage, body };
}

test('defaults to every category on ("all" preset)', () => {
    const { mod } = loadModule();
    // getState() returns an object from the vm sandbox's own realm, so
    // spread it into a plain object literal here before comparing against
    // one -- deepStrictEqual also checks [[Prototype]], which otherwise
    // differs across realms even when every own property matches.
    assert.deepEqual({ ...mod.getState() }, { duration: true, resource: true, tag: true, comment: true, dependency: true });
    for (const c of mod.CATEGORIES) assert.equal(mod.isOn(c), true);
});

test('setCategory/toggleCategory flip one category, persist, and update the body class', () => {
    const { mod, storage, body } = loadModule();
    mod.setCategory('duration', false);
    assert.equal(mod.isOn('duration'), false);
    assert.equal(body.classList.contains('hl-off-duration'), true);
    assert.equal(mod.isOn('resource'), true);
    assert.equal(body.classList.contains('hl-off-resource'), false);

    const persisted = JSON.parse(storage.getItem('noodleplanner:highlight-toggles'));
    assert.equal(persisted.duration, false);

    mod.toggleCategory('duration');
    assert.equal(mod.isOn('duration'), true);
    assert.equal(body.classList.contains('hl-off-duration'), false);
});

test('setCategory ignores an unknown category name', () => {
    const { mod } = loadModule();
    const before = mod.getState();
    mod.setCategory('nonsense', false);
    assert.deepEqual(mod.getState(), before);
});

test('applyPreset("plain") turns every category off; "all" turns every category back on', () => {
    const { mod, body } = loadModule();
    assert.equal(mod.applyPreset('plain'), true);
    for (const c of mod.CATEGORIES) {
        assert.equal(mod.isOn(c), false);
        assert.equal(body.classList.contains('hl-off-' + c), true);
    }
    assert.equal(mod.applyPreset('all'), true);
    for (const c of mod.CATEGORIES) {
        assert.equal(mod.isOn(c), true);
        assert.equal(body.classList.contains('hl-off-' + c), false);
    }
});

test('applyPreset("dependencies") lights only dependencies, per #783(D)\'s stage-preset example', () => {
    const { mod } = loadModule();
    mod.applyPreset('dependencies');
    assert.deepEqual({ ...mod.getState() }, { duration: false, resource: false, tag: false, comment: false, dependency: true });
});

test('applyPreset covers the remaining DADESRC stage presets (#1054)', () => {
    const { mod } = loadModule();
    assert.deepEqual({ ...mod.PRESETS.design }, { duration: false, resource: false, tag: false, comment: false, dependency: false });
    assert.deepEqual({ ...mod.PRESETS.scheduling }, { duration: true, resource: false, tag: false, comment: false, dependency: true });
    assert.deepEqual({ ...mod.PRESETS.risks }, { duration: false, resource: false, tag: false, comment: false, dependency: false });
    assert.deepEqual({ ...mod.PRESETS.comms }, { duration: false, resource: false, tag: false, comment: false, dependency: false });
    assert.equal(mod.applyPreset('scheduling'), true);
    assert.deepEqual({ ...mod.getState() }, { duration: true, resource: false, tag: false, comment: false, dependency: true });
});

test('applyPreset with an unknown name is a no-op and returns false', () => {
    const { mod } = loadModule();
    const before = mod.getState();
    assert.equal(mod.applyPreset('nonexistent'), false);
    assert.deepEqual(mod.getState(), before);
});

test('a fresh module instance restores persisted state from localStorage', () => {
    const storage = makeStorage();
    const first = loadModule({ storage });
    first.mod.setCategory('comment', false);
    first.mod.setCategory('tag', false);

    const second = loadModule({ storage, body: makeBody() });
    assert.equal(second.mod.isOn('comment'), false);
    assert.equal(second.mod.isOn('tag'), false);
    assert.equal(second.mod.isOn('duration'), true);
});

test('corrupt localStorage content falls back to the "all" default rather than throwing', () => {
    const storage = makeStorage();
    storage.setItem('noodleplanner:highlight-toggles', '{not json');
    const { mod } = loadModule({ storage });
    assert.deepEqual({ ...mod.getState() }, { duration: true, resource: true, tag: true, comment: true, dependency: true });
});

test('getState() returns a copy, not a live reference to internal state', () => {
    const { mod } = loadModule();
    const snapshot = mod.getState();
    snapshot.duration = false;
    assert.equal(mod.isOn('duration'), true);
});

// #1278: the reported bug was "resources, dependencies and dates show as
// plain white text while % complete is still coloured" -- exactly the
// shape of an all-off toggle state (percent is the one token with no
// toggle category), written by the wizard's Design-stage preset through
// the persisting applyPreset() and never undone.
test('applyOverride recolours the DOM without touching the saved preference, and clearOverride restores it', () => {
    const { mod, storage, body } = loadModule();
    const before = storage.getItem('noodleplanner:highlight-toggles');

    assert.equal(mod.applyOverride('design'), true);
    for (const c of mod.CATEGORIES) assert.equal(body.classList.contains('hl-off-' + c), true);
    // The user's own state is untouched, in memory and on disk.
    for (const c of mod.CATEGORIES) assert.equal(mod.isOn(c), true);
    assert.equal(storage.getItem('noodleplanner:highlight-toggles'), before);

    mod.clearOverride();
    for (const c of mod.CATEGORIES) assert.equal(body.classList.contains('hl-off-' + c), false);
});

test('an override does not survive into a fresh module instance', () => {
    const storage = makeStorage();
    const first = loadModule({ storage });
    first.mod.applyOverride('plain');

    const second = loadModule({ storage, body: makeBody() });
    for (const c of second.mod.CATEGORIES) {
        assert.equal(second.mod.isOn(c), true);
        assert.equal(second.body.classList.contains('hl-off-' + c), false);
    }
});

test('applyOverride with an unknown name is a no-op and returns false', () => {
    const { mod, body } = loadModule();
    assert.equal(mod.applyOverride('nonexistent'), false);
    for (const c of mod.CATEGORIES) assert.equal(body.classList.contains('hl-off-' + c), false);
});

// An explicit toggle is the user speaking, so it ends the override rather
// than being masked by it -- otherwise flipping a category from the ribbon
// while the wizard is open would appear to do nothing.
test('an explicit toggle while an override is active ends the override and persists', () => {
    const { mod, storage, body } = loadModule();
    mod.applyOverride('plain');
    mod.setCategory('resource', false);

    assert.equal(body.classList.contains('hl-off-resource'), true);
    assert.equal(body.classList.contains('hl-off-duration'), false, 'the override no longer masks the saved state');
    assert.equal(JSON.parse(storage.getItem('noodleplanner:highlight-toggles')).resource, false);
});

test('getEffectiveState reports what is on screen; getState reports the user preference', () => {
    const { mod } = loadModule();
    mod.applyOverride('dependencies');
    assert.deepEqual({ ...mod.getEffectiveState() }, { ...mod.PRESETS.dependencies });
    assert.deepEqual({ ...mod.getState() }, { ...mod.PRESETS.all });
});

// Browsers that already ran the buggy wizard carry an all-off payload
// under this key. It predates the version marker, so it is discarded on
// load rather than migrated -- otherwise the fix would not reach anyone
// who had already hit the bug.
test('a pre-versioned stored payload is discarded in favour of the "all" default', () => {
    const storage = makeStorage();
    storage.setItem('noodleplanner:highlight-toggles',
        JSON.stringify({ duration: false, resource: false, tag: false, comment: false, dependency: false }));
    const { mod } = loadModule({ storage });
    assert.deepEqual({ ...mod.getState() }, { ...mod.PRESETS.all });
});

test('a versioned stored payload is still honoured', () => {
    const storage = makeStorage();
    const first = loadModule({ storage });
    first.mod.setCategory('comment', false);
    const raw = JSON.parse(storage.getItem('noodleplanner:highlight-toggles'));
    assert.equal(raw.v, 2, 'saved payloads carry the version marker');

    const second = loadModule({ storage, body: makeBody() });
    assert.equal(second.mod.isOn('comment'), false);
});
