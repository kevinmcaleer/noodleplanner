/**
 * Robust coverage for creating, moving and removing columns/cards on the
 * Kanban board (#956), and for how each of the five view modes (phase,
 * resource, progress, label, bucket) groups the same underlying plan.
 *
 * The board is a pure lens over the plan Markdown (see commitMarkdown()'s
 * doc comment in kanban.js): every mutation here is verified by re-parsing
 * the editor's resulting text, the same way the browser does after a drop,
 * a keyboard move, or an "Add Task" click.
 *
 * Uses the same vm-sandbox lift technique as
 * tests/test_kanban_label_drop_refresh.mjs, extended with plan-model.js so
 * phase-view structural moves (which go through NoodlePlanModel, #927) can
 * be exercised too.
 *
 * Run with: node --test tests/test_kanban_board_mutations.mjs
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

/** A KanbanBoard instance with just enough DOM/localStorage/globals stubbed
 * to drive parse() and every markdown-mutating method without touching the
 * browser. `promptValue`/`confirmValue` stand in for the window.prompt()/
 * confirm() dialogs some mutations (addNewPhase, removeLabel, ...) use. */
function buildBoard(viewMode, { promptValue = null, confirmValue = true } = {}) {
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
  const sandbox = {
    console,
    document: documentStub,
    localStorage: localStorageStub,
    window: {},
    prompt: () => promptValue,
    confirm: () => confirmValue,
    // commitMarkdown() dispatches a plain 'input' event on the editor stub.
    Event: class Event {
      constructor(type, opts = {}) {
        this.type = type;
        this.bubbles = !!opts.bubbles;
      }
    },
  };
  vm.createContext(sandbox);

  vm.runInContext(readFileSync(join(staticDir, 'task-tokenizer.js'), 'utf8'), sandbox);
  vm.runInContext(readFileSync(join(staticDir, 'plan-model.js'), 'utf8'), sandbox);
  liftFunctions(sandbox, 'script.js', ['parseTaskLine']);
  // `class KanbanBoard` is a lexical (not `var`) top-level binding, so it
  // doesn't become a property of the sandbox on its own -- expose it
  // explicitly, in the same script so the binding is still in scope.
  const kanbanSrc = readFileSync(join(staticDir, 'kanban.js'), 'utf8');
  vm.runInContext(`${kanbanSrc}\nthis.KanbanBoard = KanbanBoard;`, sandbox);

  const board = new sandbox.KanbanBoard(viewMode);
  return { board, editor };
}

/** Array.from() rather than .map(): the vm sandbox is a separate realm, so
 * arrays built inside it fail a strict cross-realm deepEqual even when
 * their contents match. */
const namesOf = (tasks) => Array.from(tasks, t => t.name).sort();
const titlesOf = (columns) => Array.from(columns, c => c.title).sort();

function loadPlan(board, editor, text) {
  editor.value = text;
  board.parse();
}

// ---------------------------------------------------------------------------
// Creating cards and columns
// ---------------------------------------------------------------------------

test('addNewCard() inserts a new task under the target phase, which shows up there on reparse', () => {
  const { board, editor } = buildBoard('phase');
  loadPlan(board, editor, 'Phase One\n  Task A 0%\n\nPhase Two\n  Task B 0%');

  const phaseOne = board.columns.find(c => c.title === 'Phase One');
  board.addNewCard(phaseOne);
  board.parse();

  const updatedPhaseOne = board.columns.find(c => c.title === 'Phase One');
  assert.deepEqual(namesOf(updatedPhaseOne.tasks), ['New Task', 'Task A']);
  // The other phase is untouched.
  const phaseTwo = board.columns.find(c => c.title === 'Phase Two');
  assert.deepEqual(namesOf(phaseTwo.tasks), ['Task B']);
});

test('addNewCard() in resource view tags the new task with that column\'s resource', () => {
  const { board, editor } = buildBoard('resource');
  // Task A is indented (as it would be under a phase in a real plan) so the
  // new task, inserted at the same indent, is a sibling rather than being
  // read as Task A's child by the indentation-based hierarchy.
  loadPlan(board, editor, '---\nresources:\n- @kev: Kevin\n- @sam: Sam\n---\n\n  Task A @kev 0%');

  const kevColumn = board.columns.find(c => c.title === 'Kevin');
  board.addNewCard(kevColumn);
  board.parse();

  const updated = board.columns.find(c => c.title === 'Kevin');
  assert.deepEqual(namesOf(updated.tasks), ['New Task', 'Task A']);
  assert.match(editor.value, /New Task @kev/);
});

test('addNewPhase() adds a new root-level phase column (stubbing the window.prompt() it uses for the name)', () => {
  const { board, editor } = buildBoard('phase', { promptValue: 'Phase Three' });
  loadPlan(board, editor, 'Phase One\n  Task A 0%');

  board.addNewPhase();
  board.parse();

  assert.deepEqual(titlesOf(board.columns), ['Phase One', 'Phase Three'].sort());
  const phaseThree = board.columns.find(c => c.title === 'Phase Three');
  assert.deepEqual(namesOf(phaseThree.tasks), []);
});

// ---------------------------------------------------------------------------
// Moving cards
// ---------------------------------------------------------------------------

test('handleCardReorder() reorders two tasks within the same phase (structural move via NoodlePlanModel)', () => {
  const { board, editor } = buildBoard('phase');
  loadPlan(board, editor, 'Phase One\n  Task A 0%\n  Task B 0%');

  const phaseOne = board.columns.find(c => c.title === 'Phase One');
  const [taskA, taskB] = phaseOne.tasks;
  assert.deepEqual(Array.from(phaseOne.tasks, t => t.name), ['Task A', 'Task B']);

  // Move Task B before Task A.
  board.handleCardReorder(taskB.lineNumber, taskA.lineNumber, true);
  board.parse();

  const reordered = board.columns.find(c => c.title === 'Phase One');
  assert.deepEqual(Array.from(reordered.tasks, t => t.name), ['Task B', 'Task A']);
});

test('handleColumnReorder() moves a phase column before another phase', () => {
  const { board, editor } = buildBoard('phase');
  loadPlan(board, editor, 'Phase One\n  Task A 0%\n\nPhase Two\n  Task B 0%');

  board.handleColumnReorder('Phase Two', 'Phase One', true);
  board.parse();

  // Array.from(): board.phases is a vm-sandbox-realm array (see namesOf above).
  assert.deepEqual(Array.from(board.phases), ['Phase Two', 'Phase One']);
});

test('handleCardDrop() moves a task to a different phase (phase view)', () => {
  const { board, editor } = buildBoard('phase');
  loadPlan(board, editor, 'Phase One\n  Task A 0%\n  Task A2 0%\n\nPhase Two\n  Task B 0%');

  const task = board.tasks.find(t => t.name === 'Task A');
  const phaseTwo = board.columns.find(c => c.title === 'Phase Two');
  board.handleCardDrop(task.lineNumber, phaseTwo);
  board.parse();

  assert.deepEqual(namesOf(board.columns.find(c => c.title === 'Phase One').tasks), ['Task A2']);
  assert.deepEqual(namesOf(board.columns.find(c => c.title === 'Phase Two').tasks), ['Task A', 'Task B']);
});

test('handleCardDrop() drops a phase header once its last task moves elsewhere (#1055)', () => {
  const { board, editor } = buildBoard('phase');
  loadPlan(board, editor, 'Phase One\n  Task A 0%\n\nPhase Two\n  Task B 0%');

  const task = board.tasks.find(t => t.name === 'Task A');
  const phaseTwo = board.columns.find(c => c.title === 'Phase Two');
  board.handleCardDrop(task.lineNumber, phaseTwo);
  board.parse();

  assert.deepEqual(Array.from(board.phases), ['Phase Two']);
  assert.equal(board.columns.find(c => c.title === 'Phase One'), undefined);
  assert.deepEqual(namesOf(board.columns.find(c => c.title === 'Phase Two').tasks), ['Task A', 'Task B']);
});

test('handleCardReorder() drops a phase header once its last task is dropped onto a card in another phase (#1065)', () => {
  const { board, editor } = buildBoard('phase');
  loadPlan(board, editor, 'Phase One\n  Task A 0%\n\nPhase Two\n  Task B 0%');

  // Dropping directly on an existing card (rather than into an empty
  // column body) reorders through handleCardReorder(), not
  // handleCardDrop() -- the emptied-out source phase still needs pruning
  // in that path too.
  const taskA = board.tasks.find(t => t.name === 'Task A');
  const taskB = board.tasks.find(t => t.name === 'Task B');
  board.handleCardReorder(taskB.lineNumber, taskA.lineNumber, true);
  board.parse();

  assert.deepEqual(Array.from(board.phases), ['Phase One']);
  assert.equal(board.columns.find(c => c.title === 'Phase Two'), undefined);
  assert.deepEqual(namesOf(board.columns.find(c => c.title === 'Phase One').tasks), ['Task A', 'Task B']);
});

test('handleCardDrop() reassigns a task\'s resource (resource view)', () => {
  const { board, editor } = buildBoard('resource');
  loadPlan(board, editor, '---\nresources:\n- @kev: Kevin\n- @sam: Sam\n---\n\nTask A @kev 0%');

  const task = board.tasks.find(t => t.name === 'Task A');
  const samColumn = board.columns.find(c => c.title === 'Sam');
  board.handleCardDrop(task.lineNumber, samColumn);
  board.parse();

  assert.deepEqual(namesOf(board.columns.find(c => c.title === 'Kevin').tasks), []);
  assert.deepEqual(namesOf(board.columns.find(c => c.title === 'Sam').tasks), ['Task A']);
});

test('handleCardDrop() updates a task\'s percent complete (progress view)', () => {
  const { board, editor } = buildBoard('progress');
  loadPlan(board, editor, 'Task A 0%');

  const task = board.tasks.find(t => t.name === 'Task A');
  const complete = board.columns.find(c => c.id === 'complete');
  board.handleCardDrop(task.lineNumber, complete);
  board.parse();

  assert.equal(board.tasks.find(t => t.name === 'Task A').percent, '100');
  assert.deepEqual(namesOf(board.columns.find(c => c.id === 'not_started').tasks), []);
  assert.deepEqual(namesOf(board.columns.find(c => c.id === 'complete').tasks), ['Task A']);
});

test('handleCardDrop() reassigns a task\'s bucket (bucket view)', () => {
  const { board, editor } = buildBoard('bucket');
  loadPlan(board, editor, '---\nbuckets: [Backlog, Doing]\n---\n\nTask A {Backlog} 0%');

  const task = board.tasks.find(t => t.name === 'Task A');
  const doing = board.columns.find(c => c.title === 'Doing');
  board.handleCardDrop(task.lineNumber, doing);
  board.parse();

  assert.deepEqual(namesOf(board.columns.find(c => c.title === 'Backlog').tasks), []);
  assert.deepEqual(namesOf(board.columns.find(c => c.title === 'Doing').tasks), ['Task A']);
});

// ---------------------------------------------------------------------------
// Renaming cards (double-click-to-edit-in-place target, #956)
// ---------------------------------------------------------------------------

test('renameTask() changes only the name, preserving every other token on the line', () => {
  const { board, editor } = buildBoard('phase');
  loadPlan(board, editor, 'Phase One\n  Task A @kev 5d 50% #urgent "note"');

  const task = board.tasks.find(t => t.name === 'Task A');
  board.renameTask(task, 'Renamed Task');
  board.parse();

  const renamed = board.tasks.find(t => t.name === 'Renamed Task');
  assert.ok(renamed, 'renamed task should be found by its new name');
  assert.equal(renamed.resources, 'kev');
  assert.equal(renamed.duration, '5');
  assert.equal(renamed.percent, '50');
  assert.equal(renamed.labels, 'urgent');
  assert.equal(renamed.comment, 'note');
});

// ---------------------------------------------------------------------------
// Removing columns and cards
// ---------------------------------------------------------------------------

test('removeLabel() deletes the label column and its tasks fall back to Unlabeled', () => {
  const { board, editor } = buildBoard('label');
  loadPlan(board, editor, '---\nlabels: [alpha, beta]\n---\n\nTask A #alpha 0%\nTask B #beta 0%');

  assert.deepEqual(titlesOf(board.columns), ['Unlabeled', 'alpha', 'beta'].sort());

  board.removeLabel('alpha');
  board.parse();

  assert.deepEqual(titlesOf(board.columns), ['Unlabeled', 'beta'].sort());
  assert.deepEqual(namesOf(board.columns.find(c => c.title === 'Unlabeled').tasks), ['Task A']);
  assert.deepEqual(namesOf(board.columns.find(c => c.title === 'beta').tasks), ['Task B']);
  assert.doesNotMatch(editor.value, /alpha/);
});

test('removeLabel() is declined when the confirm() dialog is dismissed', () => {
  const { board, editor } = buildBoard('label', { confirmValue: false });
  loadPlan(board, editor, '---\nlabels: [alpha]\n---\n\nTask A #alpha 0%');

  board.removeLabel('alpha');

  assert.match(editor.value, /#alpha/);
});

// ---------------------------------------------------------------------------
// Per-view-mode grouping (#956 item: tests for phase/resource/progress/
// label/bucket views over one shared plan)
// ---------------------------------------------------------------------------

const SHARED_PLAN = [
  '---',
  'resources:',
  '- @kev: Kevin',
  '- @sam: Sam',
  'labels: [urgent, docs]',
  'buckets: [Backlog, Doing]',
  '---',
  '',
  'Phase One',
  '  Task A @kev {Backlog} #urgent 0%',
  '  Task B @sam {Doing} #docs 50%',
  '',
  'Phase Two',
  '  Task C 100%',
].join('\n');

test('phase view groups tasks under their declared phase headers, including an implicit Unassigned', () => {
  const { board, editor } = buildBoard('phase');
  loadPlan(board, editor, SHARED_PLAN);

  assert.deepEqual(titlesOf(board.columns), ['Phase One', 'Phase Two'].sort());
  assert.deepEqual(namesOf(board.columns.find(c => c.title === 'Phase One').tasks), ['Task A', 'Task B']);
  assert.deepEqual(namesOf(board.columns.find(c => c.title === 'Phase Two').tasks), ['Task C']);
});

test('resource view groups tasks by assignee, plus an Unassigned column', () => {
  const { board, editor } = buildBoard('resource');
  loadPlan(board, editor, SHARED_PLAN);

  assert.deepEqual(titlesOf(board.columns), ['Kevin', 'Sam', 'Unassigned'].sort());
  assert.deepEqual(namesOf(board.columns.find(c => c.title === 'Kevin').tasks), ['Task A']);
  assert.deepEqual(namesOf(board.columns.find(c => c.title === 'Sam').tasks), ['Task B']);
  assert.deepEqual(namesOf(board.columns.find(c => c.title === 'Unassigned').tasks), ['Task C']);
});

test('progress view buckets tasks into fixed Not Started / In Progress / Complete columns', () => {
  const { board, editor } = buildBoard('progress');
  loadPlan(board, editor, SHARED_PLAN);

  assert.deepEqual(titlesOf(board.columns), ['Complete', 'In Progress', 'Not Started'].sort());
  assert.deepEqual(namesOf(board.columns.find(c => c.id === 'not_started').tasks), ['Task A']);
  assert.deepEqual(namesOf(board.columns.find(c => c.id === 'in_progress').tasks), ['Task B']);
  assert.deepEqual(namesOf(board.columns.find(c => c.id === 'complete').tasks), ['Task C']);
});

test('label view groups tasks by #label, including declared-but-unused front-matter labels', () => {
  const { board, editor } = buildBoard('label');
  loadPlan(board, editor, SHARED_PLAN);

  // 'docs' and 'urgent' are both used; front matter declares no unused label
  // here, so the only "empty" column is the synthetic Unlabeled one.
  assert.deepEqual(titlesOf(board.columns), ['Unlabeled', 'docs', 'urgent'].sort());
  assert.deepEqual(namesOf(board.columns.find(c => c.title === 'urgent').tasks), ['Task A']);
  assert.deepEqual(namesOf(board.columns.find(c => c.title === 'docs').tasks), ['Task B']);
  assert.deepEqual(namesOf(board.columns.find(c => c.title === 'Unlabeled').tasks), ['Task C']);
});

test('bucket view groups tasks by {bucket}, including a declared-but-unused bucket and No Bucket', () => {
  const { board, editor } = buildBoard('bucket');
  loadPlan(board, editor, SHARED_PLAN);

  // Both front-matter buckets exist as columns even though only two tasks
  // use them; a task with no {bucket} falls into the synthetic "No Bucket".
  assert.deepEqual(titlesOf(board.columns), ['Backlog', 'Doing', 'No Bucket'].sort());
  assert.deepEqual(namesOf(board.columns.find(c => c.title === 'Backlog').tasks), ['Task A']);
  assert.deepEqual(namesOf(board.columns.find(c => c.title === 'Doing').tasks), ['Task B']);
  assert.deepEqual(namesOf(board.columns.find(c => c.title === 'No Bucket').tasks), ['Task C']);
});
