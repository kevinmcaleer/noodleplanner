/**
 * Regression tests for #1082: an automatic labels rewrite can prepend YAML
 * front matter after the user creates the first task in a blank Markdown plan.
 * The editor caret must follow the task text, not stay on line one in the new
 * front matter block.
 *
 * Run with: node tests/test_editor_cursor.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'packages', 'noodle-web', 'src', 'noodle_web', 'static', 'script.js'),
    'utf8'
);
const start = source.indexOf('function setEditorValuePreservingCursor(');
const end = source.indexOf('\n/**\n * Copy a DOM element', start);
const context = vm.createContext({ requestAnimationFrame: (callback) => callback() });
vm.runInContext(
    source.slice(start, end) +
    '\nglobalThis.setEditorValuePreservingCursor = setEditorValuePreservingCursor;',
    context
);

let failures = 0;
function equal(actual, expected, message) {
    if (actual !== expected) {
        failures++;
        console.error('FAIL:', message, '\n expected:', expected, '\n actual:  ', actual);
    } else {
        console.log('PASS:', message);
    }
}

function editor(value, selectionStart, selectionEnd = selectionStart) {
    return {
        value,
        selectionStart,
        selectionEnd,
        scrollTop: 12,
        scrollLeft: 4,
        setSelectionRange(start, end) {
            this.selectionStart = start;
            this.selectionEnd = end;
        },
    };
}

const task = 'Write first task #urgent';
const withFrontMatter = '---\nlabels: [urgent]\n---\n' + task;

const caretEditor = editor(task, task.length);
context.setEditorValuePreservingCursor(caretEditor, withFrontMatter);
equal(caretEditor.selectionStart, withFrontMatter.length,
    'caret follows the first task when labels front matter is prepended');
equal(caretEditor.selectionEnd, withFrontMatter.length,
    'collapsed caret stays collapsed after front matter is prepended');

const selectedWordStart = task.indexOf('first');
const selectedWordEnd = selectedWordStart + 'first'.length;
const selectionEditor = editor(task, selectedWordStart, selectedWordEnd);
context.setEditorValuePreservingCursor(selectionEditor, withFrontMatter);
const insertedLength = withFrontMatter.length - task.length;
equal(selectionEditor.selectionStart, selectedWordStart + insertedLength,
    'selection start follows unchanged task text through a prefix insertion');
equal(selectionEditor.selectionEnd, selectedWordEnd + insertedLength,
    'selection end follows unchanged task text through a prefix insertion');

const existingFrontMatter = '---\ntitle: Demo\n---\n' + task;
const addedLabels = '---\ntitle: Demo\nlabels: [urgent]\n---\n' + task;
const existingEditor = editor(existingFrontMatter, existingFrontMatter.length);
context.setEditorValuePreservingCursor(existingEditor, addedLabels);
equal(existingEditor.selectionStart, addedLabels.length,
    'caret follows the task when a labels line is inserted into existing front matter');

if (failures) process.exit(1);
console.log('\nAll tests passed.');
