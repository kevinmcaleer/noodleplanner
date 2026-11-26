/**
 * ui-mode.js: which interface the app shows (classic ribbon or table views),
 * kept per browser and settable from the address bar.
 *
 * Run with: node --test tests/test_ui_mode.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'packages/noodle-web/src/noodle_web/static/ui-mode.js'), 'utf8');

function load({ stored = null, search = '', storage = true } = {}) {
    const store = new Map(stored == null ? [] : [['np-ui', stored]]);
    const events = [];
    const sandbox = {
        console,
        location: { search },
        CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
        document: { documentElement: { dataset: {} }, dispatchEvent: (e) => events.push(e) },
        addEventListener() {},
    };
    if (storage) {
        sandbox.localStorage = {
            getItem: (k) => (store.has(k) ? store.get(k) : null),
            setItem: (k, v) => store.set(k, String(v)),
            removeItem: (k) => store.delete(k),
        };
    }
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox);
    return { api: sandbox.NoodleUiMode, html: sandbox.document.documentElement, store, events };
}

test('classic is the default, and is what the page is marked as', () => {
    const { api, html } = load();
    assert.equal(api.get(), 'classic');
    assert.equal(html.dataset.ui, 'classic');
    assert.equal(api.isTables(), false);
});

test('a stored choice is applied before anything renders', () => {
    const { api, html } = load({ stored: 'tables' });
    assert.equal(html.dataset.ui, 'tables');
    assert.equal(api.isTables(), true);
});

test('an unknown stored value falls back to classic', () => {
    assert.equal(load({ stored: 'banana' }).html.dataset.ui, 'classic');
});

test('?ui=tables switches it on and remembers it; ?ui=classic switches it off', () => {
    const on = load({ search: '?project=1&ui=tables' });
    assert.equal(on.html.dataset.ui, 'tables');
    assert.equal(on.store.get('np-ui'), 'tables');
    const off = load({ stored: 'tables', search: '?ui=classic' });
    assert.equal(off.html.dataset.ui, 'classic');
    assert.equal(off.store.has('np-ui'), false);
    assert.equal(load({ stored: 'tables', search: '?ui=nonsense' }).html.dataset.ui, 'tables');
});

test('set() stores, marks the page and raises uimodechange once per real change', () => {
    const { api, html, store, events } = load();
    assert.equal(api.set('tables'), 'tables');
    assert.equal(html.dataset.ui, 'tables');
    assert.equal(store.get('np-ui'), 'tables');
    api.set('tables');
    assert.equal(events.length, 1);
    assert.deepEqual({ ...events[0].detail }, { mode: 'tables', previous: 'classic' });
    api.set('classic');
    assert.equal(events.length, 2);
    assert.equal(store.has('np-ui'), false);
});

test('without storage the choice lasts for the page', () => {
    const { api, html } = load({ storage: false });
    api.set('tables');
    assert.equal(html.dataset.ui, 'tables');
    assert.equal(api.get(), 'tables');
});
