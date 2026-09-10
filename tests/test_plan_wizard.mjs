/**
 * plan-wizard.js -- DADESRC stage wizard shell (#1054).
 *
 * Covers the pure state machine (stage order, visited/skipped tracking,
 * clamping, persistence) directly, no DOM required -- the panel UI itself
 * is covered by manual/browser verification (see the PR), the same split
 * test_estimating.mjs and test_cards.mjs use for their own DOM-facing
 * pieces.
 *
 * localStorage doesn't exist in this Node version, so a minimal in-memory
 * polyfill stands in for it.
 *
 * Run with: node --test tests/test_plan_wizard.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

class FakeLocalStorage {
    constructor() { this._data = new Map(); }
    getItem(key) { return this._data.has(key) ? this._data.get(key) : null; }
    setItem(key, value) { this._data.set(key, String(value)); }
    removeItem(key) { this._data.delete(key); }
    clear() { this._data.clear(); }
}
globalThis.localStorage = new FakeLocalStorage();

const wizard = (await import('../packages/noodle-web/src/noodle_web/static/plan-wizard.js')).default;

test.beforeEach(() => {
    globalThis.localStorage.clear();
});

test('STAGES covers all seven DADESRC stages in order', () => {
    assert.deepEqual(
        wizard.STAGES.map(s => s.key),
        ['design', 'add-tasks', 'dependencies', 'estimating', 'scheduling', 'risks', 'comms']
    );
});

test('every stage has a view, a preset and a description', () => {
    for (const stage of wizard.STAGES) {
        assert.ok(stage.view, stage.key);
        assert.ok(stage.preset, stage.key);
        assert.ok(stage.description, stage.key);
    }
});

test('defaultState starts at the first stage with everything pending', () => {
    const state = wizard.defaultState();
    assert.equal(state.currentIndex, 0);
    for (const stage of wizard.STAGES) assert.equal(state.status[stage.key], 'pending');
});

test('clampIndex keeps an index within the stage list', () => {
    assert.equal(wizard.clampIndex(-3), 0);
    assert.equal(wizard.clampIndex(999), wizard.STAGES.length - 1);
    assert.equal(wizard.clampIndex(2), 2);
});

test('isLastStage is true only for the final stage index', () => {
    assert.equal(wizard.isLastStage(0), false);
    assert.equal(wizard.isLastStage(wizard.STAGES.length - 1), true);
    assert.equal(wizard.isLastStage(wizard.STAGES.length), true);
});

test('markVisited flips a pending stage to visited without mutating the input', () => {
    const before = wizard.defaultState().status;
    const after = wizard.markVisited(before, 'add-tasks');
    assert.equal(before['add-tasks'], 'pending');
    assert.equal(after['add-tasks'], 'visited');
});

test('markVisited leaves an already-skipped stage skipped, not visited', () => {
    const skipped = wizard.markSkipped(wizard.defaultState().status, 'design');
    const after = wizard.markVisited(skipped, 'design');
    assert.equal(after.design, 'skipped');
});

test('markSkipped flips a stage to skipped regardless of its prior status', () => {
    const visited = wizard.markVisited(wizard.defaultState().status, 'risks');
    assert.equal(wizard.markSkipped(visited, 'risks').risks, 'skipped');
});

test('normaliseState falls back to a fresh default for malformed input', () => {
    assert.deepEqual(wizard.normaliseState(null), wizard.defaultState());
    assert.deepEqual(wizard.normaliseState({}), wizard.defaultState());
    assert.deepEqual(wizard.normaliseState({ currentIndex: 'x', status: {} }), wizard.defaultState());
});

test('normaliseState clamps an out-of-range currentIndex and fills in missing stage keys', () => {
    const result = wizard.normaliseState({ currentIndex: 99, status: { design: 'visited' } });
    assert.equal(result.currentIndex, wizard.STAGES.length - 1);
    assert.equal(result.status.design, 'visited');
    assert.equal(result.status['add-tasks'], 'pending');
});

test('loadState returns a fresh default when nothing is stored', () => {
    assert.deepEqual(wizard.loadState(), wizard.defaultState());
});

test('loadState round-trips whatever was written to localStorage under the wizard key', () => {
    const state = { currentIndex: 3, status: { ...wizard.defaultState().status, dependencies: 'skipped' } };
    globalThis.localStorage.setItem('noodleplanner:wizard-state', JSON.stringify(state));
    assert.deepEqual(wizard.loadState(), state);
});

test('loadState tolerates corrupt JSON and falls back to default', () => {
    globalThis.localStorage.setItem('noodleplanner:wizard-state', '{not json');
    assert.deepEqual(wizard.loadState(), wizard.defaultState());
});
