/**
 * The editor highlighter does not colour the `@` of an email address as a
 * resource. A resource reference is `@name` on its own; in `kev@example.com`
 * the `@` follows a word character, so it is part of an address -- both in a
 * front-matter YAML list and in a task line (which the shared tokenizer reads).
 *
 * Runs the real task-tokenizer.js and editor.js in a vm sandbox, as
 * test_editor_overlay_separators.mjs does.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const staticDir = new URL('../packages/noodle-web/src/noodle_web/static/', import.meta.url);
const read = name => readFileSync(new URL(name, staticDir), 'utf8');

function element() {
    return { classList: { add() {}, remove() {} }, dataset: {}, style: {}, appendChild() {} };
}

function load() {
    const sandbox = {
        console: { log() {}, error() {}, warn() {} },
        document: { createElement: () => element() },
        location: { hostname: 'noodleplanner.example' },
        setTimeout, clearTimeout,
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(read('task-tokenizer.js') + '\nglobalThis.TaskLineTokenizer = TaskLineTokenizer;', sandbox);
    vm.runInContext(read('editor.js'), sandbox);
    return sandbox;
}

/** The overlay HTML setupEditor() paints for `text`. */
function paint(text) {
    const sandbox = load();
    const editor = {
        id: 'kanbanPlanEditor', value: text, placeholder: '',
        scrollTop: 0, scrollLeft: 0, selectionStart: 0,
        parentElement: element(), addEventListener() {},
    };
    const lineNumbers = { ...element(), innerHTML: '', scrollTop: 0, querySelectorAll: () => [], querySelector: () => null };
    const highlightLayer = { style: {}, innerHTML: '' };
    sandbox.setupEditor(editor, lineNumbers, highlightLayer, false);
    return highlightLayer.innerHTML;
}

const resourceSpans = html => [...html.matchAll(/<span class="syntax-resource">([^<]*)<\/span>/g)].map(m => m[1]);

test('an email address in a front-matter list is not a resource', () => {
    const html = paint('---\nresources:\n  - @kev Kevin McAleer kev@example.com\n---\n');
    assert.deepEqual(resourceSpans(html), ['@kev']);
});

test('a front-matter list item that is only an email has no resource', () => {
    const html = paint('---\nstakeholders:\n  - kev@example.com\n---\n');
    assert.deepEqual(resourceSpans(html), []);
});

test('an email address in a task line is not a resource', () => {
    const { TaskLineTokenizer } = load();
    const tokens = TaskLineTokenizer.tokenize('Email kev@example.com 3d @bob');
    assert.deepEqual([...tokens.filter(t => t.type === 'resource').map(t => t.text)], ['@bob']);
    const { values } = TaskLineTokenizer.metadata('Email kev@example.com 3d @bob');
    assert.deepEqual([...values.resources], ['bob']);
    assert.equal(values.name, 'Email kev@example.com');
});
