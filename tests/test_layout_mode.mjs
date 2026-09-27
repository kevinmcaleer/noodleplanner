/**
 * The layout-mode helper (#1379, static/layout-mode.js): which layout a width
 * resolves to, the Settings override, and the `layoutchange` event.
 *
 * Each case loads the script into a fresh context with a stub matchMedia whose
 * width can be changed, and a localStorage stand-in, because the module holds
 * its state once loaded.
 *
 * Run with: node --test tests/test_layout_mode.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(
    path.join(here, '..', 'packages/noodle-web/src/noodle_web/static/layout-mode.js'),
    'utf8',
);

function memoryStorage(initial = {}) {
    const items = new Map(Object.entries(initial));
    return {
        items,
        getItem: (key) => (items.has(key) ? items.get(key) : null),
        setItem: (key, value) => { items.set(key, String(value)); },
        removeItem: (key) => { items.delete(key); },
    };
}

// Just enough of a media-query evaluator for the three queries the helper
// asks: min/max-width in px and `(pointer: coarse)`.
function evaluate(query, screen) {
    return query.split(' and ').every((part) => {
        const m = part.match(/\((min|max)-width:\s*([\d.]+)px\)/);
        if (m) return m[1] === 'min' ? screen.width >= Number(m[2]) : screen.width <= Number(m[2]);
        if (/pointer:\s*coarse/.test(part)) return screen.coarse;
        throw new Error(`unexpected media query ${part}`);
    });
}

/** A fresh copy of the module on a screen `width` wide. */
function load({ width = 1280, coarse = false, storage = memoryStorage() } = {}) {
    const screen = { width, coarse };
    const lists = [];
    const events = [];
    const listeners = new Map();
    const documentElement = { dataset: {} };
    const document = {
        documentElement,
        addEventListener: (type, fn) => { listeners.set(fn, type); },
        removeEventListener: (type, fn) => { listeners.delete(fn); },
        dispatchEvent: (event) => {
            events.push(event);
            for (const [fn, type] of listeners) if (type === event.type) fn(event);
            return true;
        },
    };
    class CustomEvent {
        constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
    }
    const sandbox = {
        document,
        CustomEvent,
        addEventListener: () => {},
        matchMedia(query) {
            const list = {
                media: query,
                get matches() { return evaluate(query, screen); },
                handlers: [],
                addEventListener(type, fn) { this.handlers.push(fn); },
            };
            lists.push(list);
            return list;
        },
    };
    if (typeof storage === 'function') {
        Object.defineProperty(sandbox, 'localStorage', { get: storage });
    } else {
        sandbox.localStorage = storage;
    }
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    return {
        api: sandbox.NoodleLayout,
        root: documentElement,
        events,
        storage,
        /** Resize the stub screen and fire every list's change handler. */
        resize(newWidth, newCoarse = screen.coarse) {
            screen.width = newWidth;
            screen.coarse = newCoarse;
            for (const list of lists) for (const fn of list.handlers) fn();
        },
    };
}

test('the breakpoints are #572\'s: phone under 768, tablet to 1024', () => {
    for (const [width, layout] of [
        [320, 'phone'], [390, 'phone'], [744, 'phone'], [767, 'phone'],
        [768, 'tablet'], [820, 'tablet'], [834, 'tablet'], [1024, 'tablet'],
        [1025, 'desktop'], [1280, 'desktop'], [1920, 'desktop'],
    ]) {
        const { api, root } = load({ width });
        assert.equal(api.get(), layout, `${width}px`);
        assert.equal(root.dataset.layout, layout, `${width}px sets data-layout`);
    }
});

test('the pointer is recorded next to the layout', () => {
    assert.equal(load({ width: 820, coarse: true }).root.dataset.pointer, 'coarse');
    assert.equal(load({ width: 820, coarse: false }).root.dataset.pointer, 'fine');
    assert.equal(load({ width: 820, coarse: true }).api.isTouch(), true);
});

test('a resize across a breakpoint updates the attribute and fires layoutchange once', () => {
    const { api, root, events, resize } = load({ width: 1280 });
    const seen = [];
    api.onChange((detail) => seen.push(detail.layout));

    resize(1100);
    assert.equal(events.length, 0, 'still desktop: no event');

    resize(820);
    assert.equal(root.dataset.layout, 'tablet');
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'layoutchange');
    assert.equal(events[0].detail.layout, 'tablet');
    assert.equal(events[0].detail.previous, 'desktop');
    assert.equal(events[0].detail.override, 'auto');

    resize(390);
    assert.deepEqual(seen, ['tablet', 'phone']);
});

test('the override wins over the width, is persisted, and fires layoutchange', () => {
    const storage = memoryStorage();
    const { api, root, events } = load({ width: 820, storage });
    assert.equal(api.get(), 'tablet');

    api.setOverride('desktop');
    assert.equal(api.get(), 'desktop');
    assert.equal(root.dataset.layout, 'desktop');
    assert.equal(storage.items.get('np-layout'), 'desktop');
    assert.equal(events.at(-1).detail.override, 'desktop');

    // A fresh page load in the same browser keeps the choice.
    assert.equal(load({ width: 820, storage }).api.get(), 'desktop');
});

test('an override holds while the window is resized', () => {
    const { api, resize } = load({ width: 1280, storage: memoryStorage({ 'np-layout': 'phone' }) });
    assert.equal(api.get(), 'phone');
    resize(1600);
    assert.equal(api.get(), 'phone');
});

test('auto clears the stored choice and returns to the width\'s layout', () => {
    const storage = memoryStorage({ 'np-layout': 'phone' });
    const { api } = load({ width: 1280, storage });
    api.setOverride('auto');
    assert.equal(storage.items.has('np-layout'), false);
    assert.equal(api.get(), 'desktop');
    assert.equal(api.getOverride(), 'auto');
});

test('an unknown stored or requested value is treated as auto', () => {
    assert.equal(load({ width: 390, storage: memoryStorage({ 'np-layout': 'watch' }) }).api.get(), 'phone');
    const { api } = load({ width: 1280 });
    api.setOverride('fridge');
    assert.equal(api.getOverride(), 'auto');
    assert.equal(api.get(), 'desktop');
});

test('storage that throws still works for the life of the page', () => {
    const { api } = load({ width: 1280, storage: () => { throw new Error('blocked'); } });
    assert.equal(api.get(), 'desktop');
    api.setOverride('tablet');
    assert.equal(api.get(), 'tablet');
    assert.equal(api.getOverride(), 'tablet');
});

test('the override is never plan text: nothing but the one key is written', () => {
    const storage = memoryStorage();
    const { api } = load({ width: 1280, storage });
    api.setOverride('phone');
    assert.deepEqual([...storage.items.keys()], ['np-layout']);
});
