/**
 * cards.js -- reusable plan cards (#1050).
 *
 * Covers the pure logic (storage CRUD, subtree extraction, structural
 * insertion) directly, no DOM required -- the popup UI itself is covered
 * by manual/browser verification (see the PR), the same split
 * test_estimating.mjs and test_notepad_surface.mjs use for their own
 * DOM-facing pieces.
 *
 * localStorage doesn't exist in this Node version, so a minimal in-memory
 * polyfill stands in for it -- cards.js only calls getItem/setItem, so
 * that's all this needs to provide.
 *
 * Run with: node --test tests/test_cards.mjs
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

const planModel = (await import('../packages/noodle-web/src/noodle_web/static/plan-model.js')).default;
globalThis.NoodlePlanModel = planModel;
const cards = (await import('../packages/noodle-web/src/noodle_web/static/cards.js')).default;

test.beforeEach(() => {
    globalThis.localStorage.clear();
});

// ---- Storage CRUD ----

test('listCards is empty with nothing saved', () => {
    assert.deepEqual(cards.listCards(), []);
});

test('saveCard stores a record and listCards returns it', () => {
    const record = cards.saveCard('Testing block', 'Write tests 1d\nRun tests 1d');
    assert.ok(record);
    assert.equal(record.name, 'Testing block');
    assert.equal(record.text, 'Write tests 1d\nRun tests 1d');
    assert.ok(record.id);
    const listed = cards.listCards();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, record.id);
});

test('saveCard refuses a blank name or blank text and persists nothing', () => {
    assert.equal(cards.saveCard('', 'Task A 1d'), null);
    assert.equal(cards.saveCard('  ', 'Task A 1d'), null);
    assert.equal(cards.saveCard('Name', ''), null);
    assert.equal(cards.saveCard('Name', '   '), null);
    assert.deepEqual(cards.listCards(), []);
});

test('listCards sorts by name', () => {
    cards.saveCard('Zebra', 'Task 1d');
    cards.saveCard('Apple', 'Task 1d');
    const listed = cards.listCards();
    assert.deepEqual(listed.map(c => c.name), ['Apple', 'Zebra']);
});

test('getCard finds a saved record by id, or returns null', () => {
    const record = cards.saveCard('A card', 'Task A 1d');
    assert.equal(cards.getCard(record.id).name, 'A card');
    assert.equal(cards.getCard('not-a-real-id'), null);
});

test('deleteCard removes a saved record and returns true', () => {
    const record = cards.saveCard('A card', 'Task A 1d');
    assert.equal(cards.deleteCard(record.id), true);
    assert.deepEqual(cards.listCards(), []);
});

test('deleteCard returns false for an id that does not exist', () => {
    assert.equal(cards.deleteCard('not-a-real-id'), false);
});

// ---- Plan-text operations ----

test('cardTextForTask extracts a task subtree from plan text', () => {
    const planText = 'Phase\n  Sub-phase\n    Task A 1d\n    Task B 2d\n';
    const text = cards.cardTextForTask(planText, 'Sub-phase');
    assert.equal(text, 'Sub-phase\n  Task A 1d\n  Task B 2d');
});

test('cardTextForTask returns an empty string for a task name that is not in the plan', () => {
    const planText = 'Phase\n  Task A 1d\n';
    assert.equal(cards.cardTextForTask(planText, 'Nope'), '');
});

test('insertCardAsTasks inserts the card after the named anchor task, at its indent', () => {
    const planText = 'Phase\n  Task A 1d\n';
    const result = cards.insertCardAsTasks(planText, 'Task A', 'Task B 1d\nTask C 1d');
    assert.equal(result, 'Phase\n  Task A 1d\n  Task B 1d\n  Task C 1d\n');
});

test('insertCardAsTasks leaves plan text unchanged when the anchor task is not found', () => {
    const planText = 'Phase\n  Task A 1d\n';
    const result = cards.insertCardAsTasks(planText, 'Nope', 'Task B 1d');
    assert.equal(result, planText);
});

test('insertCardAsTasks leaves plan text unchanged for an empty card', () => {
    const planText = 'Phase\n  Task A 1d\n';
    const result = cards.insertCardAsTasks(planText, 'Task A', '   \n');
    assert.equal(result, planText);
});

test('save then insert round-trips a real subtree into a different plan, nested correctly', () => {
    const sourcePlan = 'Software Deployment\n  Testing\n    Write tests 1d\n    Run tests 1d\n';
    const cardText = cards.cardTextForTask(sourcePlan, 'Testing');
    const record = cards.saveCard('Testing block', cardText);
    assert.ok(record);

    const targetPlan = 'Office Move\n  Packing 1d\n';
    const result = cards.insertCardAsTasks(targetPlan, 'Packing', cards.getCard(record.id).text);
    assert.equal(
        result,
        'Office Move\n  Packing 1d\n  Testing\n    Write tests 1d\n    Run tests 1d\n'
    );
});
