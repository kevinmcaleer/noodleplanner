/**
 * AI provider configuration (static/ai-config.js): the BYOK settings kept in
 * localStorage — presets, defaults, the read/save/clear round-trip and what
 * counts as "configured".
 *
 * Classic script, lifted into a vm sandbox with an in-memory localStorage and
 * just enough `document` for the load-time listener and the navbar dot.
 *
 * Run with: node --test tests/test_ai_config.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(
    path.join(here, '..', 'packages/noodle-web/src/noodle_web/static/ai-config.js'),
    'utf8',
);

const KEY = 'noodleplanner_ai_config';

function memoryStorage(initial = {}) {
    const items = new Map(Object.entries(initial));
    return {
        items,
        getItem: (key) => (items.has(key) ? items.get(key) : null),
        setItem: (key, value) => { items.set(key, String(value)); },
        removeItem: (key) => { items.delete(key); },
    };
}

/** A fresh copy of the module over `storage`, with the navbar dot captured. */
function load(storage = memoryStorage()) {
    const dot = { style: { display: 'unset' } };
    const listeners = [];
    const sandbox = {
        localStorage: storage,
        JSON,
        console,
        document: {
            addEventListener: (type, fn) => listeners.push([type, fn]),
            getElementById: (id) => (id === 'aiConfiguredDot' ? dot : null),
            querySelector: () => null,
        },
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    return { ...sandbox, storage, dot, listeners };
}

const plain = (v) => JSON.parse(JSON.stringify(v));

test('presets name the four providers with Ollama pointing at the hosted tunnel', () => {
    const { getProviderPresets } = load();
    const presets = plain(getProviderPresets());
    assert.deepEqual(Object.keys(presets), ['ollama', 'openai', 'anthropic', 'custom']);
    assert.equal(presets.ollama.endpoint, 'https://ai.noodleplanner.com/v1');
    assert.equal(presets.openai.endpoint, 'https://api.openai.com/v1');
    assert.equal(presets.anthropic.endpoint, 'https://api.anthropic.com/v1');
    assert.deepEqual(presets.custom, { label: 'Custom', endpoint: '', model: '' });
    for (const p of Object.values(presets)) assert.ok(p.label);
});

test('the default config is Ollama, enabled, with no key', () => {
    const { getDefaultAIConfig, getProviderPresets } = load();
    const defaults = plain(getDefaultAIConfig());
    assert.deepEqual(defaults, {
        provider: 'ollama',
        endpoint: getProviderPresets().ollama.endpoint,
        apiKey: '',
        model: getProviderPresets().ollama.model,
        enabled: true,
    });
});

test('first read auto-configures the defaults into storage', () => {
    const { getAIConfig, getDefaultAIConfig, storage } = load();
    assert.equal(storage.getItem(KEY), null);
    const config = plain(getAIConfig());
    assert.deepEqual(config, plain(getDefaultAIConfig()));
    assert.deepEqual(JSON.parse(storage.getItem(KEY)), config);
});

test('save then read round-trips the config verbatim', () => {
    const { saveAIConfig, getAIConfig, storage } = load();
    const config = { provider: 'openai', endpoint: 'https://api.openai.com/v1', apiKey: 'sk-1', model: 'gpt-4o', enabled: true, extra: 'kept' };
    saveAIConfig(config);
    assert.deepEqual(plain(getAIConfig()), config);
    assert.equal(storage.getItem(KEY), JSON.stringify(config));
});

test('an existing config is read as stored, not merged with the presets', () => {
    const { getAIConfig } = load(memoryStorage({ [KEY]: JSON.stringify({ provider: 'anthropic', apiKey: 'k' }) }));
    assert.deepEqual(plain(getAIConfig()), { provider: 'anthropic', apiKey: 'k' });
});

test('corrupt JSON in storage falls back to the defaults without touching storage', () => {
    const { getAIConfig, getDefaultAIConfig, storage } = load(memoryStorage({ [KEY]: '{not json' }));
    assert.deepEqual(plain(getAIConfig()), plain(getDefaultAIConfig()));
    assert.equal(storage.getItem(KEY), '{not json');
});

test('a throwing storage (private mode) also yields the defaults', () => {
    const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() {} };
    const { getAIConfig, getDefaultAIConfig } = load(broken);
    assert.deepEqual(plain(getAIConfig()), plain(getDefaultAIConfig()));
});

test('isAIConfigured: Ollama needs no key, other providers do, and disabled is unconfigured', () => {
    const { saveAIConfig, isAIConfigured } = load();
    assert.equal(isAIConfigured(), true);   // the auto-configured Ollama default
    saveAIConfig({ provider: 'openai', endpoint: 'https://x', apiKey: '', model: 'm', enabled: true });
    assert.equal(isAIConfigured(), false);
    saveAIConfig({ provider: 'openai', endpoint: 'https://x', apiKey: 'sk', model: 'm', enabled: true });
    assert.equal(isAIConfigured(), true);
    saveAIConfig({ provider: 'openai', endpoint: 'https://x', apiKey: 'sk', model: 'm', enabled: false });
    assert.equal(isAIConfigured(), false);
    saveAIConfig({ provider: 'custom', endpoint: '', apiKey: 'sk', model: 'm', enabled: true });
    assert.equal(isAIConfigured(), false);
    saveAIConfig({ provider: '', endpoint: 'https://x', apiKey: 'sk', model: 'm', enabled: true });
    assert.equal(isAIConfigured(), false);
    saveAIConfig({ provider: 'ollama', endpoint: 'http://localhost:11434/v1', apiKey: '', model: 'm', enabled: true });
    assert.equal(isAIConfigured(), true);
});

test('clearAIConfig resets to the Ollama defaults (the indicator refresh re-seeds them at once)', () => {
    const { saveAIConfig, clearAIConfig, getAIConfig, getDefaultAIConfig, storage } = load();
    saveAIConfig({ provider: 'openai', endpoint: 'https://x', apiKey: 'sk', model: 'm', enabled: true });
    clearAIConfig();
    // The key is removed and then immediately re-written by the navbar
    // indicator's read, so "clear" means "back to defaults", never "unset".
    assert.deepEqual(JSON.parse(storage.getItem(KEY)), plain(getDefaultAIConfig()));
    assert.equal(plain(getAIConfig()).provider, 'ollama');
});

test('the navbar dot follows the configured state on every save and clear', () => {
    const { saveAIConfig, clearAIConfig, dot } = load();
    saveAIConfig({ provider: 'openai', endpoint: 'https://x', apiKey: '', model: 'm', enabled: true });
    assert.equal(dot.style.display, 'none');
    saveAIConfig({ provider: 'openai', endpoint: 'https://x', apiKey: 'sk', model: 'm', enabled: true });
    assert.equal(dot.style.display, 'block');
    clearAIConfig();
    // Cleared storage re-seeds Ollama, which needs no key: configured again.
    assert.equal(dot.style.display, 'block');
});

test('the indicator is refreshed on DOMContentLoaded', () => {
    const { listeners, dot } = load();
    const [[type, fn]] = listeners;
    assert.equal(type, 'DOMContentLoaded');
    fn();
    assert.equal(dot.style.display, 'block');
});

test('onAIProviderChange fills the endpoint and model from the preset and relabels the key', () => {
    const fields = { aiEndpoint: { value: 'old' }, aiModel: { value: 'old' } };
    const label = { textContent: '' };
    const sandbox = load();
    sandbox.document.getElementById = (id) => fields[id] || (id === 'aiApiKeyGroup' ? { querySelector: () => label } : null);
    sandbox.onAIProviderChange('anthropic');
    assert.equal(fields.aiEndpoint.value, 'https://api.anthropic.com/v1');
    assert.equal(fields.aiModel.value, sandbox.getProviderPresets().anthropic.model);
    assert.equal(label.textContent, 'API Key');
    sandbox.onAIProviderChange('ollama');
    assert.equal(label.textContent, 'API Key (optional)');
    sandbox.onAIProviderChange('nope');
    assert.equal(fields.aiEndpoint.value, 'https://ai.noodleplanner.com/v1');   // unchanged by unknown provider
});
