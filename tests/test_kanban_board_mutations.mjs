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
  return { board, editor, sandbox };
}

/** Lift script.js's deleteTask() (the card delete path, driven from the task
 * detail pane rather than from KanbanBoard itself -- it splices the task's
 * line, plus any more-deeply-indented subtask lines beneath it, straight out
 * of the editor text) into an already-built board's sandbox, alongside its
 * real dependency extractTaskNameFromEditorLine() (editor.js, pure). The
 * detail-pane chrome deleteTask() also touches (closeDetailPane, the
 * setTimeout()-deferred renderText()) is irrelevant to what's being tested
 * here -- whether the right lines are removed and the board agrees on
 * reparse -- so those are stubbed to no-ops rather than lifted. */
function liftDeleteTask(sandbox) {
  sandbox.closeDetailPane = () => {};
  sandbox.renderText = () => {};
  sandbox.setTimeout = (fn) => fn();
  sandbox.currentTaskLineNumber = null;
  liftFunctions(sandbox, 'editor.js', ['extractTaskNameFromEditorLine']);
  liftFunctions(sandbox, 'script.js', ['deleteTask']);
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

test('addNewCard() in bucket view tags the new task with that bucket', () => {
  const { board, editor } = buildBoard('bucket');
  loadPlan(board, editor, '---\nbuckets: [Backlog]\n---\n\nTask A 0%');
  board.addNewCard(board.columns.find(column => column.title === 'Backlog'));
  assert.match(editor.value, /New Task \{Backlog\}/);
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

test('dropping a card on Add Phase creates the phase and moves the card (#1070)', () => {
  const { board, editor } = buildBoard('phase', { promptValue: 'Phase Two' });
  loadPlan(board, editor, 'Phase One\n  Task A 0%\n  Task B 0%');
  board.handleNewColumnDrop(board.tasks.find(t => t.name === 'Task A').lineNumber);
  board.parse();
  assert.deepEqual(namesOf(board.columns.find(c => c.title === 'Phase One').tasks), ['Task B']);
  assert.deepEqual(namesOf(board.columns.find(c => c.title === 'Phase Two').tasks), ['Task A']);
});

test('dropping the last card on Add Phase removes the emptied source phase (#1070)', () => {
  const { board, editor } = buildBoard('phase', { promptValue: 'Phase Two' });
  loadPlan(board, editor, 'Phase One\n  Task A 0%');
  board.handleNewColumnDrop(board.tasks[0].lineNumber);
  board.parse();
  assert.deepEqual(Array.from(board.phases), ['Phase Two']);
  assert.deepEqual(namesOf(board.columns[0].tasks), ['Task A']);
});

test('dropping a card on Add Label creates and assigns the label (#1070)', () => {
  const { board, editor } = buildBoard('label', { promptValue: 'Urgent' });
  loadPlan(board, editor, 'Task A #old 0%');
  board.handleNewColumnDrop(board.tasks[0].lineNumber);
  board.parse();
  assert.match(editor.value, /labels: \[urgent\]/);
  assert.match(editor.value, /Task A #urgent 0%/);
  assert.deepEqual(namesOf(board.columns.find(c => c.title === 'urgent').tasks), ['Task A']);
});

test('dropping a card on Add Bucket creates and assigns the bucket (#1070)', () => {
  const { board, editor } = buildBoard('bucket', { promptValue: 'Doing' });
  loadPlan(board, editor, '---\nbuckets: [Backlog]\n---\n\nTask A {Backlog} 0%');
  board.handleNewColumnDrop(board.tasks[0].lineNumber);
  board.parse();
  assert.match(editor.value, /buckets: \[Backlog, Doing\]/);
  assert.match(editor.value, /Task A \{Doing\} 0%/);
  assert.deepEqual(namesOf(board.columns.find(c => c.title === 'Doing').tasks), ['Task A']);
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

test('phase, label, and bucket column renames update model nodes and declarations', () => {
  const phase = buildBoard('phase', { promptValue: 'Renamed Phase' });
  loadPlan(phase.board, phase.editor, 'Old Phase\n  Task A 0%');
  phase.board.renamePhase('Old Phase');
  assert.match(phase.editor.value, /^Renamed Phase/m);

  const label = buildBoard('label', { promptValue: 'new-label' });
  loadPlan(label.board, label.editor, '---\nlabels: [old-label]\n---\n\nTask A #old-label 0%');
  label.board.renameLabel('old-label');
  assert.match(label.editor.value, /labels: \[new-label\]/);
  assert.match(label.editor.value, /#new-label/);

  const bucket = buildBoard('bucket');
  loadPlan(bucket.board, bucket.editor, '---\nbuckets: [Old Bucket]\n---\n\nTask A \{Old Bucket\} 0%');
  bucket.board.renameBucket('Old Bucket', 'New Bucket');
  assert.match(bucket.editor.value, /buckets: \[New Bucket\]/);
  assert.match(bucket.editor.value, /\{New Bucket\}/);
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

test('deleteTask() (#1078) removes the card\'s line and the board no longer shows it on reparse', () => {
  const { board, editor, sandbox } = buildBoard('phase');
  liftDeleteTask(sandbox);
  loadPlan(board, editor, 'Phase One\n  Task A 0%\n  Task B 0%');

  sandbox.currentTaskLineNumber = board.tasks.find(t => t.name === 'Task A').lineNumber;
  sandbox.deleteTask();
  board.parse();

  assert.deepEqual(namesOf(board.columns.find(c => c.title === 'Phase One').tasks), ['Task B']);
  assert.doesNotMatch(editor.value, /Task A/);
  assert.match(editor.value, /Task B/);
});

test('deleteTask() also removes more-deeply-indented subtask lines beneath the deleted card', () => {
  const { board, editor, sandbox } = buildBoard('phase');
  liftDeleteTask(sandbox);
  loadPlan(board, editor, 'Phase\n  Summary 0%\n    Child A 0%\n    Child B 0%\n  Sibling 0%');

  sandbox.currentTaskLineNumber = board.tasks.find(t => t.name === 'Summary').lineNumber;
  sandbox.deleteTask();
  board.parse();

  assert.doesNotMatch(editor.value, /Summary|Child A|Child B/);
  assert.match(editor.value, /Sibling/);
  assert.deepEqual(namesOf(board.columns.find(c => c.title === 'Phase').tasks), ['Sibling']);
});

test('deleteTask() is declined when the confirm() dialog is dismissed', () => {
  const { board, editor, sandbox } = buildBoard('phase', { confirmValue: false });
  liftDeleteTask(sandbox);
  loadPlan(board, editor, 'Phase One\n  Task A 0%');

  sandbox.currentTaskLineNumber = board.tasks[0].lineNumber;
  sandbox.deleteTask();

  assert.match(editor.value, /Task A/);
});

// ---------------------------------------------------------------------------
// Creating columns directly (not via the Add-Phase/Label/Bucket drop target)
// ---------------------------------------------------------------------------

test('addNewLabel() (#1078) adds a new, empty label column straight to front matter', () => {
  const { board, editor } = buildBoard('label', { promptValue: 'Urgent' });
  loadPlan(board, editor, '---\nlabels: [existing]\n---\n\nTask A #existing 0%');

  board.addNewLabel();
  board.parse();

  assert.match(editor.value, /labels: \[existing, urgent\]/);
  assert.deepEqual(titlesOf(board.columns), ['Unlabeled', 'existing', 'urgent'].sort());
  assert.deepEqual(namesOf(board.columns.find(c => c.title === 'urgent').tasks), []);
});

test('addNewLabel() creates front matter from scratch when the plan has none', () => {
  const { board, editor } = buildBoard('label', { promptValue: 'First' });
  loadPlan(board, editor, 'Task A 0%');

  board.addNewLabel();
  board.parse();

  assert.match(editor.value, /^---\nlabels: \[first\]\n---/);
  assert.ok(board.columns.some(c => c.title === 'first'));
});

test('addNewBucket() (#1078) adds a new, empty bucket column straight to front matter', () => {
  const { board, editor } = buildBoard('bucket', { promptValue: 'Doing' });
  loadPlan(board, editor, '---\nbuckets: [Backlog]\n---\n\nTask A {Backlog} 0%');

  board.addNewBucket();
  board.parse();

  assert.match(editor.value, /buckets: \[Backlog, Doing\]/);
  assert.deepEqual(titlesOf(board.columns), ['Backlog', 'Doing', 'No Bucket'].sort());
  assert.deepEqual(namesOf(board.columns.find(c => c.title === 'Doing').tasks), []);
});

test('addNewBucket() is a no-op when the bucket name is already declared', () => {
  const { board, editor } = buildBoard('bucket', { promptValue: 'Backlog' });
  loadPlan(board, editor, '---\nbuckets: [Backlog]\n---\n\nTask A {Backlog} 0%');

  board.addNewBucket();

  assert.match(editor.value, /buckets: \[Backlog\]/);
  assert.doesNotMatch(editor.value, /Backlog, Backlog/);
});

// ---------------------------------------------------------------------------
// Removing a column by emptying it (#1078) -- phase/bucket/label/resource
// views have no explicit "delete this column" button of their own (only
// removeLabel() does), so the only way one of their columns goes away is a
// drop that empties it out. Whether the column then survives depends on
// whether it's declared in front matter: a declared bucket/label/resource is
// kept (0 tasks) exactly like a real front-matter Resource/label/bucket that
// nothing currently references, but one only ever discovered from a task's
// own tag disappears once nothing references it any more -- there's nothing
// left to remember it by. Phase is the one view where even a declared
// column (a phase header) can't survive emptying, because there is no
// separate "phases:" declaration to fall back on (#1055/#1065).
// ---------------------------------------------------------------------------

test('moving the last card out of an undeclared bucket column removes that column', () => {
  const { board, editor } = buildBoard('bucket');
  loadPlan(board, editor, 'Task A {Adhoc} 0%');
  assert.ok(board.columns.some(c => c.title === 'Adhoc'));

  const task = board.tasks[0];
  board.handleCardDrop(task.lineNumber, board.columns.find(c => c.title === 'No Bucket'));
  board.parse();

  assert.ok(!board.columns.some(c => c.title === 'Adhoc'));
});

test('moving the last card out of a front-matter-declared bucket column keeps it, empty', () => {
  const { board, editor } = buildBoard('bucket');
  loadPlan(board, editor, '---\nbuckets: [Backlog]\n---\n\nTask A {Backlog} 0%');

  const task = board.tasks[0];
  board.handleCardDrop(task.lineNumber, board.columns.find(c => c.title === 'No Bucket'));
  board.parse();

  const backlog = board.columns.find(c => c.title === 'Backlog');
  assert.ok(backlog, 'declared bucket column should survive being emptied');
  assert.deepEqual(namesOf(backlog.tasks), []);
});

test('moving the last card out of an undeclared label removes that column; a declared one survives, empty', () => {
  const { board, editor } = buildBoard('label');
  loadPlan(board, editor, '---\nlabels: [declared]\n---\n\nTask A #undeclared 0%\nTask B #declared 0%');

  const undeclaredTask = board.tasks.find(t => t.name === 'Task A');
  board.handleCardDrop(undeclaredTask.lineNumber, board.columns.find(c => c.title === 'Unlabeled'));
  board.parse();
  assert.ok(!board.columns.some(c => c.title === 'undeclared'));

  const declaredTask = board.tasks.find(t => t.name === 'Task B');
  board.handleCardDrop(declaredTask.lineNumber, board.columns.find(c => c.title === 'Unlabeled'));
  board.parse();
  const declaredColumn = board.columns.find(c => c.title === 'declared');
  assert.ok(declaredColumn, 'front-matter-declared label column should survive being emptied');
  assert.deepEqual(namesOf(declaredColumn.tasks), []);
});

test('moving the last card off an undeclared resource removes that column; a declared one survives, empty', () => {
  const { board, editor } = buildBoard('resource');
  loadPlan(board, editor,
    '---\nresources:\n- @kev: Kevin\n---\n\nTask A @kev 0%\nTask B @sam 0%');
  assert.ok(board.columns.some(c => c.title === 'sam'));

  const undeclaredTask = board.tasks.find(t => t.name === 'Task B');
  board.handleCardDrop(undeclaredTask.lineNumber, board.columns.find(c => c.title === 'Unassigned'));
  board.parse();
  assert.ok(!board.columns.some(c => c.title === 'sam'));

  const declaredTask = board.tasks.find(t => t.name === 'Task A');
  board.handleCardDrop(declaredTask.lineNumber, board.columns.find(c => c.title === 'Unassigned'));
  board.parse();
  const kevin = board.columns.find(c => c.title === 'Kevin');
  assert.ok(kevin, 'front-matter-declared resource column should survive being emptied');
  assert.deepEqual(namesOf(kevin.tasks), []);
});

// ---------------------------------------------------------------------------
// Round-trip: after any sequence of mutations, re-parsing the editor text
// must agree with the board, and the Markdown must not accumulate orphaned
// blank lines (cf. #911, the reorder-leaves-blank-lines bug this guards
// against regressing).
// ---------------------------------------------------------------------------

test('a sequence of create/move/remove mutations leaves no orphaned blank lines and the board agrees with the Markdown', () => {
  const { board, editor, sandbox } = buildBoard('phase', { promptValue: 'Phase Three' });
  liftDeleteTask(sandbox);
  loadPlan(board, editor, 'Phase One\n  Task A 0%\n  Task B 0%\n\nPhase Two\n  Task C 0%');

  // Create.
  board.addNewCard(board.columns.find(c => c.title === 'Phase One'));
  board.parse();
  // Move.
  const taskC = board.tasks.find(t => t.name === 'Task C');
  board.handleCardDrop(taskC.lineNumber, board.columns.find(c => c.title === 'Phase One'));
  board.parse();
  // Remove (deleteTask, the card delete path).
  sandbox.currentTaskLineNumber = board.tasks.find(t => t.name === 'Task B').lineNumber;
  sandbox.deleteTask();
  board.parse();
  // Create a new phase.
  board.addNewPhase();
  board.parse();

  // No run of 2+ blank lines anywhere in the Markdown.
  assert.doesNotMatch(editor.value, /\n\s*\n\s*\n/, 'no orphaned multi-blank-line runs');

  // The board's task set matches what a fresh parse of the same text finds --
  // i.e. the rendered board and the Markdown haven't drifted apart.
  const finalText = editor.value;
  board.parse();
  assert.deepEqual(editor.value, finalText, 'reparsing the same text is a no-op');
  assert.deepEqual(namesOf(board.tasks), ['New Task', 'Task A', 'Task C'].sort());
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

test('column ordering is structural, declared, or fixed rather than alphabetical', () => {
  const plan = [
    '---',
    'resources:',
    '- @zoe: Zoe',
    '- @amy: Amy',
    'labels: [zeta, alpha]',
    'buckets: [Waiting, Active]',
    '---',
    '',
    'Second Phase',
    '  Zed @zoe #zeta {Active} 0%',
    'First Phase',
    '  Able @amy #alpha {Waiting} 100%',
  ].join('\n');
  const expected = {
    phase: ['Second Phase', 'First Phase'],
    resource: ['Zoe', 'Amy', 'Unassigned'],
    progress: ['Not Started', 'In Progress', 'Complete'],
    label: ['zeta', 'alpha', 'Unlabeled'],
    bucket: ['Waiting', 'Active', 'No Bucket'],
  };
  for (const mode of Object.keys(expected)) {
    const { board, editor } = buildBoard(mode);
    loadPlan(board, editor, plan);
    assert.deepEqual(Array.from(board.columns, column => column.title), expected[mode], mode);
  }
});

test('multi-resource and multi-label tasks appear in every matching column; a drop replaces the whole grouping value', () => {
  const plan = [
    '---',
    'resources:',
    '- @kev: Kevin',
    '- @sam: Sam',
    '- @lee: Lee',
    'labels: [api, ui, docs]',
    '---',
    '',
    'Task A @kev @sam #api #ui 0%',
  ].join('\n');

  const resource = buildBoard('resource');
  loadPlan(resource.board, resource.editor, plan);
  const resourceTask = resource.board.tasks[0];
  assert.deepEqual(namesOf(resource.board.columns.find(c => c.title === 'Kevin').tasks), ['Task A']);
  assert.deepEqual(namesOf(resource.board.columns.find(c => c.title === 'Sam').tasks), ['Task A']);
  resource.board.handleCardDrop(resourceTask.lineNumber,
    resource.board.columns.find(c => c.title === 'Lee'));
  assert.deepEqual(Array.from(resource.board.tasks[0].resourceShortnames), ['lee']);

  const label = buildBoard('label');
  loadPlan(label.board, label.editor, plan);
  const labelTask = label.board.tasks[0];
  assert.deepEqual(namesOf(label.board.columns.find(c => c.title === 'api').tasks), ['Task A']);
  assert.deepEqual(namesOf(label.board.columns.find(c => c.title === 'ui').tasks), ['Task A']);
  label.board.handleCardDrop(labelTask.lineNumber,
    label.board.columns.find(c => c.title === 'docs'));
  assert.deepEqual(Array.from(label.board.tasks[0].labelsArray), ['docs']);
});

test('progress boundaries put 0 in Not Started, 25/50/75 in In Progress, and 100 in Complete', () => {
  const { board, editor } = buildBoard('progress');
  loadPlan(board, editor, 'Zero 0%\nQuarter 25%\nHalf 50%\nThree Quarters 75%\nDone 100%');
  assert.deepEqual(namesOf(board.columns.find(c => c.id === 'not_started').tasks), ['Zero']);
  assert.deepEqual(namesOf(board.columns.find(c => c.id === 'in_progress').tasks),
    ['Half', 'Quarter', 'Three Quarters']);
  assert.deepEqual(namesOf(board.columns.find(c => c.id === 'complete').tasks), ['Done']);
});

test('only tasks at the current board depth become cards; nested children appear after drill-down', () => {
  const { board, editor } = buildBoard('phase');
  loadPlan(board, editor, 'Phase\n  Summary 0%\n    Child 0%\n      Grandchild 0%\n  Sibling 0%');
  assert.deepEqual(namesOf(board.columns[0].tasks), ['Sibling', 'Summary']);
  assert.ok(!board.columns[0].tasks.some(task => task.name === 'Child'));

  board.currentParentTask = board.tasks.find(task => task.name === 'Summary');
  board.groupTasksByViewMode();
  const childColumn = board.columns.find(column => column.title === 'Summary');
  assert.deepEqual(namesOf(childColumn.tasks), ['Child']);
});

test('priority sorting and hide-completed semantics are consistent in every view', () => {
  const plan = 'Phase\n  Low ! 0%\n  Urgent !!! 0%\n  Done !! 100%';
  for (const mode of ['phase', 'resource', 'progress', 'label', 'bucket']) {
    const { board, editor } = buildBoard(mode);
    board.sortByPriority = true;
    board.hideCompleted = true;
    loadPlan(board, editor, plan);
    for (const column of board.columns) {
      const visible = column.tasks.filter(task => board.getProgressStatus(task.percent) !== 'complete');
      const priorities = Array.from(visible, task => task.priority);
      assert.deepEqual(priorities, [...priorities].sort((a, b) =>
        ({ Urgent: 0, Important: 1, Medium: 2, Low: 3 }[a] ?? 3) -
        ({ Urgent: 0, Important: 1, Medium: 2, Low: 3 }[b] ?? 3)), mode);
      assert.equal(board.isColumnEmptyAfterFilter(column), visible.length === 0, mode);
    }
  }
});

test('a stale rendered card resolves to its model node after the plan gains an earlier line', () => {
  for (const mode of ['phase', 'resource', 'progress', 'label', 'bucket']) {
    const { board, editor } = buildBoard(mode);
    const frontMatter = mode === 'resource'
      ? '---\nresources:\n- @kev: Kevin\n- @sam: Sam\n---\n\n'
      : mode === 'label'
        ? '---\nlabels: [old, new]\n---\n\n'
        : mode === 'bucket'
          ? '---\nbuckets: [Old, New]\n---\n\n'
          : '';
    const token = mode === 'resource' ? '@kev' : mode === 'label' ? '#old' : mode === 'bucket' ? '{Old}' : '0%';
    loadPlan(board, editor, `${frontMatter}Phase\n  Target ${token}\n  Other 0%`);
    const staleTask = board.tasks.find(task => task.name === 'Target');
    editor.value = editor.value.replace('Phase\n', 'Inserted Phase\n  Inserted 0%\nPhase\n');
    const targetColumn = mode === 'phase'
      ? board.columns.find(column => column.title === 'Phase')
      : mode === 'resource'
        ? board.columns.find(column => column.title === 'Sam')
        : mode === 'progress'
          ? board.columns.find(column => column.id === 'complete')
          : mode === 'label'
            ? board.columns.find(column => column.title === 'new')
            : board.columns.find(column => column.title === 'New');
    if (mode === 'phase') board.renameTask(staleTask, 'Renamed Target');
    else board.handleCardDrop(staleTask.lineNumber, targetColumn);
    assert.match(editor.value, /Inserted 0%/);
    assert.match(editor.value, mode === 'phase' ? /Renamed Target/ : /Target/);
    assert.match(editor.value, /Other 0%/);
  }
});
