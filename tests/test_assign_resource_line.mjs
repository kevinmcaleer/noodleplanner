/**
 * Assigning a resource from the Gantt / Tasks table ("Assign Resource" in a
 * row's menu, or editing the Resources cell) rewrites the task's `@name`
 * tokens and nothing else.
 *
 * syncGanttEditToEditor() (editor-sync.js) used to write resources as a
 * bracket, replacing the first `[...]` on the line -- which is the task's
 * `[depends ...]` block, not a resource list (resources are `@name`, or
 * `@name[30%]` with an allocation):
 *
 *   Build API 5d @kev [depends Design]  --(assign jen)-->  Build API 5d @kev [jen]
 *
 * dropping the dependency, renaming the task "Build API [jen]" and leaving
 * kev assigned. Both of its paths -- through NoodlePlanModel, and the
 * name-matching fallback used without it -- are exercised here.
 *
 * Run with: node --test tests/test_assign_resource_line.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const staticDir = join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'static');
const read = (file) => readFileSync(join(staticDir, file), 'utf8');

function editorStub(value) {
  return { value, dispatchEvent() { return true; } };
}

/** editor-sync.js with (withModel) or without NoodlePlanModel loaded. */
function load(planText, { withModel }) {
  const editor = editorStub(planText);
  const sandbox = vm.createContext({
    console,
    document: { getElementById: (id) => (id === 'planEditor' ? editor : null) },
    Event: class Event { constructor(type) { this.type = type; } },
  });
  vm.runInContext(read('task-tokenizer.js'), sandbox);
  vm.runInContext('this.TaskLineTokenizer = TaskLineTokenizer;', sandbox);
  if (withModel) vm.runInContext(read('plan-model.js'), sandbox);
  vm.runInContext(read('editor-sync.js'), sandbox);
  return { sandbox, editor };
}

/** Assign `value` to the task on `lineIndex` (0-based) of `plan`, both ways. */
function assign(plan, lineIndex, value, task) {
  const results = [];
  for (const withModel of [true, false]) {
    const { sandbox, editor } = load(plan, { withModel });
    sandbox.syncGanttEditToEditor({ ...task }, lineIndex, 'resources', value);
    results.push(editor.value);
  }
  assert.equal(results[0], results[1], 'the model path and the fallback agree');
  return results[0];
}

function metadata(line) {
  const { sandbox } = load('', { withModel: false });
  const v = sandbox.TaskLineTokenizer.metadata(line).values;
  return { name: v.name, resources: Array.from(v.resources), dependencies: Array.from(v.dependencies) };
}

test('assigning a resource keeps [depends ...] and the task name intact', () => {
  const out = assign('Design 3d\nBuild API 5d @kev [depends Design]', 1, 'jen', { name: 'Build API', level: 1 });
  const line = out.split('\n')[1];
  assert.equal(line, 'Build API 5d [depends Design] @jen');
  assert.deepEqual(metadata(line), { name: 'Build API', resources: ['jen'], dependencies: ['Design'] });
});

test('several resources, with or without @, separated by commas or spaces', () => {
  assert.equal(assign('Task A 2d @old', 0, 'kev, jen', { name: 'Task A', level: 1 }), 'Task A 2d @kev @jen');
  assert.equal(assign('Task A 2d', 0, '@kev @jen', { name: 'Task A', level: 1 }), 'Task A 2d @kev @jen');
});

test('clearing the resources removes every @name token and nothing else', () => {
  assert.equal(
    assign('Build API 5d @kev @jen [depends Design] {Backend}', 0, '', { name: 'Build API', level: 1 }),
    'Build API 5d [depends Design] {Backend}',
  );
});

test('allocations are resources: replaced when reassigned, kept when given', () => {
  assert.equal(assign('Design @dev[30%] 5d', 0, 'kev', { name: 'Design', level: 1 }), 'Design 5d @kev');
  assert.equal(assign('Design 5d @kev', 0, 'dev[30%]', { name: 'Design', level: 1 }), 'Design 5d @dev[30%]');
});

test('quality roles, comments, brackets and buckets are not resources', () => {
  assert.equal(
    assign('Spec $spec @kev:P @ann 3d "ask @bob" [levelled @ann 2026-01-05] {QA @x}', 0, 'jen', { name: 'Spec', level: 1 }),
    'Spec $spec @kev:P 3d "ask @bob" [levelled @ann 2026-01-05] {QA @x} @jen',
  );
  const curly = 'Call 1d “ping @bob”';
  assert.equal(assign(`${curly} @kev`, 0, 'jen', { name: 'Call', level: 1 }), `${curly} @jen`);
});

test('an indented subtask keeps its indentation', () => {
  const plan = 'Phase\n  Child 2d @kev [depends Other]\nOther 1d';
  const out = assign(plan, 1, 'jen', { name: 'Child', level: 2 });
  assert.equal(out, 'Phase\n  Child 2d [depends Other] @jen\nOther 1d');
});
