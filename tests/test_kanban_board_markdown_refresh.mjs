/**
 * Regression test for issue #1061: dragging a card on the Kanban board
 * updated the plan's underlying text correctly, but the Markdown visibly
 * shown in the board view's own plan panel (#kanbanPlanEditor) stayed
 * frozen at its pre-drop content.
 *
 * Root cause: #kanbanPlanEditor is a syntax-highlighted editor -- the real
 * `<textarea>` renders its text fully transparent (see .editor-textarea in
 * style.css) and what the user actually sees is a `.editor-highlight-layer`
 * div, repainted only by that editor's own 'input' listener (editor.js's
 * setupEditor -> updateLineNumbers -> highlightLayer.innerHTML = ...),
 * exposed per-editor as editor._updateLineNumbers.
 *
 * KanbanBoard.commitMarkdown() (kanban.js) -- used by every board
 * write-back, including handleCardDrop() -- wrote the new text straight
 * into both #planEditor.value and #kanbanPlanEditor.value, then dispatched
 * a single 'input' event, but only on #planEditor. script.js's two-way
 * mirror between the editors forwards that to #kanbanPlanEditor by setting
 * kanbanEditor.value and re-dispatching 'input' on it -- but only when
 * `kanbanEditor.value !== mainEditor.value`. Since commitMarkdown had
 * already set both editors' .value to the same new text before dispatching,
 * that guard was false, so #kanbanPlanEditor's own 'input' listener -- and
 * so its highlight-layer repaint -- never ran. The panel only caught up
 * once some unrelated later edit made the two editors' values briefly
 * differ. This is the same mechanism #974 fixed for switching projects
 * (multi-plan-loader.js calling _updateLineNumbers() directly after setting
 * .value), just not yet applied to commitMarkdown()'s own write-back.
 *
 * Fix: commitMarkdown() now calls kanbanEditor._updateLineNumbers()
 * directly after setting its value, the same way multi-plan-loader.js
 * already does, rather than relying on an 'input' dispatch that never
 * reliably reaches it.
 *
 * Uses the same vm-sandbox lift technique as
 * tests/test_kanban_label_drop_refresh.mjs, with a second editor stub for
 * #kanbanPlanEditor and the real main<->kanban mirror-sync listeners
 * (lifted verbatim from script.js) wired up, so the test exercises the
 * actual short-circuit rather than a re-description of it.
 *
 * Run with: node --test tests/test_kanban_board_markdown_refresh.mjs
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
      for (const fn of (this.listeners[event.type] || []).slice()) fn(event);
      return true;
    },
  };
}

/** A KanbanBoard instance with #planEditor and #kanbanPlanEditor wired up
 * the same way index.html + script.js + editor.js wire the real ones:
 * mirror-sync listeners between them, and a per-editor _updateLineNumbers
 * spy standing in for editor.js's highlight-layer repaint. */
function buildBoard(viewMode) {
  const editor = makeEditorStub('');
  const kanbanEditor = makeEditorStub('');
  const elements = { planEditor: editor, kanbanPlanEditor: kanbanEditor };
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
  class EventStub {
    constructor(type, opts) { this.type = type; Object.assign(this, opts || {}); }
  }
  const sandbox = { console, document: documentStub, localStorage: localStorageStub, window: {}, Event: EventStub };
  vm.createContext(sandbox);

  vm.runInContext(readFileSync(join(staticDir, 'task-tokenizer.js'), 'utf8'), sandbox);
  vm.runInContext(readFileSync(join(staticDir, 'plan-model.js'), 'utf8'), sandbox);
  liftFunctions(sandbox, 'script.js', ['parseTaskLine']);
  const kanbanSrc = readFileSync(join(staticDir, 'kanban.js'), 'utf8');
  vm.runInContext(`${kanbanSrc}\nthis.KanbanBoard = KanbanBoard;`, sandbox);

  const board = new sandbox.KanbanBoard(viewMode);

  // The main<->kanban mirror-sync listeners, lifted verbatim from
  // script.js's DOMContentLoaded block (around "Initialize Kanban editor
  // sync") so the test exercises the real short-circuit condition.
  editor.addEventListener('input', function () {
    if (kanbanEditor.value !== editor.value) {
      kanbanEditor.value = editor.value;
      kanbanEditor.dispatchEvent(new sandbox.Event('input', { bubbles: true }));
    }
  });
  kanbanEditor.addEventListener('input', function () {
    if (editor.value !== kanbanEditor.value) {
      editor.value = kanbanEditor.value;
      editor.dispatchEvent(new sandbox.Event('input', { bubbles: true }));
    }
  });

  // Stand-in for editor.js's setupEditor(): each editor's own 'input'
  // listener repaints its highlight layer via its exposed
  // _updateLineNumbers. Counted here instead of rendering real HTML.
  let kanbanUpdateCount = 0;
  kanbanEditor._updateLineNumbers = () => { kanbanUpdateCount += 1; };
  kanbanEditor.addEventListener('input', () => kanbanEditor._updateLineNumbers());

  return { board, editor, kanbanEditor, getKanbanUpdateCount: () => kanbanUpdateCount };
}

test('dropping a card on the board repaints the Kanban plan panel\'s own highlight layer immediately', () => {
  const { board, editor, kanbanEditor, getKanbanUpdateCount } = buildBoard('label');

  editor.value = 'Task A #Alpha 0%\nTask B 0%';
  kanbanEditor.value = editor.value;
  board.parse();

  const unlabeledColumn = board.columns.find(c => c.title === 'Unlabeled');
  const taskB = board.tasks.find(t => t.name === 'Task B');
  assert.ok(taskB, 'Task B should have parsed');

  const alphaColumn = board.columns.find(c => c.title === 'Alpha');
  board.handleCardDrop(taskB.lineNumber, alphaColumn);

  // The underlying text is correct either way (covered by
  // test_kanban_label_drop_refresh.mjs) -- the bug is that the visible
  // panel didn't catch up with it.
  assert.equal(kanbanEditor.value, editor.value, 'kanbanPlanEditor should mirror the new plan text');
  assert.equal(
    getKanbanUpdateCount(),
    1,
    "kanbanPlanEditor's highlight layer must repaint once as part of the drop's own commit, " +
    'not stay frozen until an unrelated later edit touches it'
  );
});
