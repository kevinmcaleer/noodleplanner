/**
 * The plan editor's undo/redo history (static/editor-undo.js): snapshots in
 * sessionStorage, the undo/redo ordering, the history cap, and the
 * per-project stacks that stop Ctrl+Z from overwriting one plan with
 * another's content.
 *
 * The module is `const EditorUndoManager = (function () { ... })()`, so it is
 * run in a vm sandbox and the binding is read back as the script's final
 * expression. sessionStorage is an in-memory stand-in and `planEditor` a
 * fake textarea that records the input events it is sent.
 *
 * Run with: node --test tests/test_editor_undo.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(
    path.join(here, '..', 'packages/noodle-web/src/noodle_web/static/editor-undo.js'),
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

/**
 * A fresh manager. `projectId` is what getCurrentProjectId() answers and can
 * be changed through the returned handle; `editor` is the fake textarea.
 */
function load({ storage = memoryStorage(), projectId = 'p1', editorValue = '', noEditor = false } = {}) {
    const handle = { projectId };
    const editor = {
        value: editorValue,
        events: [],
        dispatchEvent(e) { this.events.push(e.type); return true; },
    };
    const buttons = { undoBtn: { disabled: null }, redoBtn: { disabled: null } };
    class Event { constructor(type, init) { this.type = type; this.bubbles = !!(init && init.bubbles); } }
    const sandbox = {
        sessionStorage: storage,
        JSON, console, setTimeout, clearTimeout, Event,
        getCurrentProjectId: () => handle.projectId,
        window: { addEventListener: () => {} },
        document: {
            getElementById: (id) => (id === 'planEditor' ? (noEditor ? null : editor) : buttons[id] || null),
            querySelector: () => null,
            addEventListener: () => {},
        },
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    const manager = vm.runInContext(source + '\n;EditorUndoManager', sandbox);
    return { manager, storage, editor, buttons, handle };
}

const stored = (storage, key) => JSON.parse(storage.getItem(key));

test('pushSnapshot records content under the project key and enables undo after two', () => {
    const { manager, storage, buttons } = load();
    manager.pushSnapshot('one');
    assert.equal(manager.canUndo(), false);
    assert.equal(buttons.undoBtn.disabled, true);
    manager.pushSnapshot('two');
    assert.equal(manager.canUndo(), true);
    assert.equal(manager.canRedo(), false);
    assert.equal(buttons.undoBtn.disabled, false);
    assert.equal(buttons.redoBtn.disabled, true);
    assert.deepEqual(stored(storage, 'noodle_undo_p1_history'), ['one', 'two']);
    assert.deepEqual(stored(storage, 'noodle_undo_p1_redo'), []);
});

test('identical consecutive snapshots are not pushed twice', () => {
    const { manager, storage } = load();
    manager.pushSnapshot('same');
    manager.pushSnapshot('same');
    manager.pushSnapshot('other');
    manager.pushSnapshot('same');
    assert.deepEqual(stored(storage, 'noodle_undo_p1_history'), ['same', 'other', 'same']);
});

test('undo restores the previous snapshot into the editor and fires input; redo returns', () => {
    const { manager, editor, storage } = load();
    manager.pushSnapshot('a');
    manager.pushSnapshot('b');
    manager.pushSnapshot('c');
    manager.undo();
    assert.equal(editor.value, 'b');
    assert.deepEqual(editor.events, ['input']);
    assert.deepEqual(stored(storage, 'noodle_undo_p1_history'), ['a', 'b']);
    assert.deepEqual(stored(storage, 'noodle_undo_p1_redo'), ['c']);
    assert.equal(manager.canRedo(), true);
    manager.undo();
    assert.equal(editor.value, 'a');
    assert.equal(manager.canUndo(), false);
    manager.redo();
    assert.equal(editor.value, 'b');
    manager.redo();
    assert.equal(editor.value, 'c');
    assert.equal(manager.canRedo(), false);
    assert.deepEqual(editor.events, ['input', 'input', 'input', 'input']);
});

test('undoing the only snapshot moves it to redo without touching the editor', () => {
    const { manager, editor, storage } = load({ editorValue: 'typed' });
    manager.pushSnapshot('only');
    manager.undo();
    assert.equal(editor.value, 'typed');
    assert.deepEqual(editor.events, []);
    assert.deepEqual(stored(storage, 'noodle_undo_p1_history'), []);
    assert.deepEqual(stored(storage, 'noodle_undo_p1_redo'), ['only']);
    manager.undo();   // nothing left: a no-op
    assert.deepEqual(stored(storage, 'noodle_undo_p1_redo'), ['only']);
});

test('a new edit after undo discards the redo stack', () => {
    const { manager, storage } = load();
    manager.pushSnapshot('a');
    manager.pushSnapshot('b');
    manager.undo();
    assert.deepEqual(stored(storage, 'noodle_undo_p1_redo'), ['b']);
    manager.pushSnapshot('c');
    assert.deepEqual(stored(storage, 'noodle_undo_p1_redo'), []);
    assert.deepEqual(stored(storage, 'noodle_undo_p1_history'), ['a', 'c']);
    assert.equal(manager.canRedo(), false);
});

test('history is capped at 100 snapshots, dropping the oldest', () => {
    const { manager, storage } = load();
    for (let i = 0; i < 105; i++) manager.pushSnapshot(`v${i}`);
    const history = stored(storage, 'noodle_undo_p1_history');
    assert.equal(history.length, 100);
    assert.equal(history[0], 'v5');
    assert.equal(history[99], 'v104');
});

test('undo and redo are no-ops without an editor element', () => {
    const { manager, storage } = load({ noEditor: true });
    manager.pushSnapshot('a');
    manager.pushSnapshot('b');
    manager.undo();
    assert.deepEqual(stored(storage, 'noodle_undo_p1_history'), ['a', 'b']);
    assert.deepEqual(stored(storage, 'noodle_undo_p1_redo'), []);
    manager.redo();
    assert.deepEqual(stored(storage, 'noodle_undo_p1_history'), ['a', 'b']);
});

test('switching projects keeps each plan its own stacks (Ctrl+Z never crosses plans)', () => {
    const { manager, storage, editor, handle } = load({ projectId: 'alpha' });
    manager.pushSnapshot('alpha v1');
    manager.pushSnapshot('alpha v2');

    // The user opens plan beta: its editor shows beta's content.
    handle.projectId = 'beta';
    editor.value = 'beta v1';
    manager.onProjectSwitch('beta');
    assert.deepEqual(stored(storage, 'noodle_undo_beta_history'), ['beta v1']);
    assert.equal(manager.canUndo(), false);   // nothing of alpha's to undo here

    manager.pushSnapshot('beta v2');
    manager.undo();
    assert.equal(editor.value, 'beta v1');    // beta's own text, never alpha's
    assert.deepEqual(editor.events, ['input']);

    // Back to alpha: its history is intact and undo returns alpha's own text.
    handle.projectId = 'alpha';
    editor.value = 'alpha v2';
    manager.onProjectSwitch('alpha');
    assert.deepEqual(stored(storage, 'noodle_undo_alpha_history'), ['alpha v1', 'alpha v2']);
    manager.undo();
    assert.equal(editor.value, 'alpha v1');
    // beta's stacks were persisted when we left.
    assert.deepEqual(stored(storage, 'noodle_undo_beta_history'), ['beta v1']);
    assert.deepEqual(stored(storage, 'noodle_undo_beta_redo'), ['beta v2']);
});

test('pushSnapshot follows getCurrentProjectId even without an explicit switch', () => {
    const { manager, storage, handle } = load({ projectId: 'one' });
    manager.pushSnapshot('one a');
    handle.projectId = 'two';
    manager.pushSnapshot('two a');
    assert.deepEqual(stored(storage, 'noodle_undo_one_history'), ['one a']);
    assert.deepEqual(stored(storage, 'noodle_undo_two_history'), ['two a']);
});

test('a missing project id falls back to the "default" key', () => {
    const { manager, storage } = load({ projectId: null });
    manager.pushSnapshot('x');
    assert.deepEqual(stored(storage, 'noodle_undo_default_history'), ['x']);
    manager.onProjectSwitch(undefined);
    assert.deepEqual(stored(storage, 'noodle_undo_default_history'), ['x']);
});

test('onProjectSwitch seeds the editor content only when it differs from the top', () => {
    const { manager, storage, editor } = load({ projectId: 'p' });
    editor.value = 'seed';
    manager.onProjectSwitch('p');
    manager.onProjectSwitch('p');
    assert.deepEqual(stored(storage, 'noodle_undo_p_history'), ['seed']);
    editor.value = '';
    manager.onProjectSwitch('p');   // empty editor seeds nothing
    assert.deepEqual(stored(storage, 'noodle_undo_p_history'), ['seed']);
});

test('stacks persisted by an earlier page load are restored from sessionStorage', () => {
    const storage = memoryStorage({
        noodle_undo_p1_history: JSON.stringify(['old a', 'old b']),
        noodle_undo_p1_redo: JSON.stringify(['old c']),
    });
    const { manager, editor } = load({ storage, projectId: 'p1' });
    assert.equal(manager.canUndo(), false);   // nothing loaded until first use
    manager.redo();
    assert.equal(editor.value, 'old c');
    manager.undo();
    assert.equal(editor.value, 'old b');
});

test('corrupt stored stacks are treated as empty', () => {
    const storage = memoryStorage({ noodle_undo_p1_history: '{broken' });
    const { manager } = load({ storage, projectId: 'p1' });
    manager.pushSnapshot('fresh');
    assert.deepEqual(stored(storage, 'noodle_undo_p1_history'), ['fresh']);
});

test('init migrates the legacy single-pair keys and seeds the editor', () => {
    const storage = memoryStorage({
        noodle_undo_history: '["mixed"]',
        noodle_redo_history: '[]',
    });
    const { manager, buttons } = load({ storage, projectId: 'p1', editorValue: 'current' });
    manager.init();
    assert.equal(storage.getItem('noodle_undo_history'), null);
    assert.equal(storage.getItem('noodle_redo_history'), null);
    assert.deepEqual(stored(storage, 'noodle_undo_p1_history'), ['current']);
    assert.equal(buttons.undoBtn.disabled, true);
});

test('scheduleSnapshot debounces to one snapshot and captureImmediate cancels the pending one', async () => {
    const { manager, storage } = load();
    manager.scheduleSnapshot('typing 1');
    manager.scheduleSnapshot('typing 12');
    manager.scheduleSnapshot('typing 123');
    assert.equal(storage.getItem('noodle_undo_p1_history'), null);
    await new Promise((r) => setTimeout(r, 700));
    assert.deepEqual(stored(storage, 'noodle_undo_p1_history'), ['typing 123']);

    manager.scheduleSnapshot('typing 1234');
    manager.captureImmediate('indented');
    await new Promise((r) => setTimeout(r, 700));
    assert.deepEqual(stored(storage, 'noodle_undo_p1_history'), ['typing 123', 'indented']);
});
