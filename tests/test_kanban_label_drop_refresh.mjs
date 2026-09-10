/**
 * Regression test for issue #973: dragging a card to a different label
 * column on the Kanban board rewrote the task's label in the plan text
 * correctly (KanbanBoard.handleCardDrop()'s 'label' case, via
 * commitMarkdown()), but the board itself didn't visually move the card --
 * it stayed under its old column until some later, unrelated edit (e.g.
 * pressing Enter in the plan editor) triggered a second render.
 *
 * Root cause: KanbanBoard.groupTasksByViewMode() called
 * filterTasksByHierarchyLevel() *before* refreshing this.allTasksCache,
 * but filterTasksByHierarchyLevel() (and getAllTasks()) read
 * this.allTasksCache. So every grouping pass used the *previous* parse
 * cycle's task objects -- one cycle behind the task list that had just been
 * rebuilt by this same parse() call. commitMarkdown() only calls parse()
 * once per commit, so the drop's own re-render showed stale columns; the
 * next unrelated parse() (e.g. from pressing Enter) is what caught the
 * cache up, matching the bug report's own diagnostic note.
 *
 * This drives KanbanBoard.parse() directly (no DOM rendering, so it's fast
 * and independent of the browser) using the same vm-sandbox lift technique
 * as tests/test_note_colour_writer.mjs: kanban.js's top-level side effects
 * are limited to a single `document.readyState === 'loading'` guarded
 * DOMContentLoaded registration, so (unlike script.js) the whole file can
 * be run directly to get the real KanbanBoard class; parseTaskLine (needed
 * by KanbanBoard.parse()) is lifted from script.js, same as this file's
 * neighbour lifts other script.js helpers.
 *
 * Run with: node --test tests/test_kanban_label_drop_refresh.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const staticDir = join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'static');

/** Top-level `function name(` ... `\n}` declarations from a classic script. */
function liftFunctions(sandbox, file, names) {
  const source = readFileSync(join(staticDir, file), 'utf8');
  for (const name of names) {
    const start = source.indexOf(`\nfunction ${name}(`);
    assert.notEqual(start, -1, `${name} not found in ${file}`);
    const end = source.indexOf('\n}\n', start);
    assert.notEqual(end, -1, `${name} in ${file} has no closing brace at column 0`);
    vm.runInContext(source.slice(start, end + 3), sandbox);
  }
  return sandbox;
}

function makeEditorStub(initialValue) {
  return {
    value: initialValue,
    listeners: {},
    addEventListener(type, fn) {
      (this.listeners[type] ||= []).push(fn);
    },
    dispatchEvent(event) {
      for (const fn of this.listeners[event.type] || []) fn(event);
      return true;
    },
  };
}

/** A KanbanBoard instance with just enough DOM/localStorage stubbed for parse(). */
function buildBoard(viewMode) {
  const editor = makeEditorStub('');
  const elements = { planEditor: editor };
  const store = {};
  const documentStub = {
    readyState: 'loading', // avoid kanban.js's own-load initializeKanban() call
    getElementById: (id) => elements[id] || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
  };
  const localStorageStub = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  const sandbox = { console, document: documentStub, localStorage: localStorageStub, window: {} };
  vm.createContext(sandbox);

  vm.runInContext(readFileSync(join(staticDir, 'task-tokenizer.js'), 'utf8'), sandbox);
  liftFunctions(sandbox, 'script.js', ['parseTaskLine']);
  // `class KanbanBoard` is a lexical (not `var`) top-level binding, so it
  // doesn't become a property of the sandbox on its own -- expose it
  // explicitly, in the same script so the binding is still in scope.
  const kanbanSrc = readFileSync(join(staticDir, 'kanban.js'), 'utf8');
  vm.runInContext(`${kanbanSrc}\nthis.KanbanBoard = KanbanBoard;`, sandbox);

  const board = new sandbox.KanbanBoard(viewMode);
  return { board, editor };
}

test('re-labelling a task and re-parsing immediately (as a board drop does) groups it under its new column, not its old one', () => {
  const { board, editor } = buildBoard('label');

  editor.value = 'Task A #Alpha 0%\nTask B 0%';
  board.parse();

  // Array.from() rather than .map(): the vm sandbox is a separate realm, so
  // arrays built inside it (e.g. by column.tasks.map()) fail a strict
  // cross-realm deepEqual even when their contents match.
  const namesOf = (tasks) => Array.from(tasks, t => t.name);
  const columnNamed = (title) => board.columns.find(c => c.title === title);
  assert.deepEqual(namesOf(columnNamed('Alpha').tasks), ['Task A']);
  assert.deepEqual(namesOf(columnNamed('Unlabeled').tasks), ['Task B']);

  // Same write-back handleCardDrop()'s 'label' case performs, followed by
  // the single immediate re-parse commitMarkdown() does -- no unrelated
  // second edit in between.
  editor.value = 'Task A #Alpha 0%\nTask B #Alpha 0%';
  board.parse();

  assert.deepEqual(
    namesOf(columnNamed('Alpha').tasks).sort(),
    ['Task A', 'Task B'],
    'the dropped card should show under its new label column immediately after the single re-parse a drop triggers'
  );
  assert.deepEqual(
    namesOf(columnNamed('Unlabeled').tasks),
    [],
    'the dropped card must not still show under its old label column'
  );
});
