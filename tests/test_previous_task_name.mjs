/**
 * A sequential task (`* Build 2d`) depends on the task before it, and
 * script.js's parseTaskLine() names that task through getPreviousTaskName().
 *
 * getPreviousTaskName() used to get the previous task's name by calling
 * parseTaskLine() on it -- which, when that line was a `*` task too,
 * resolved *its* predecessor the same way, re-splitting the editor each
 * time, all the way up the chain. Parsing every line of a plan of n
 * sequential tasks (getAllTaskNames() does, on each keystroke in the task
 * form's dependency field; so do openTaskForm(), the inspector and the
 * Kanban board) was therefore quadratic in lines and cubic in work: 400
 * sequential tasks took over a second a pass. Only the previous task's
 * name is needed, and that does not depend on its own predecessor.
 *
 * Run with: node --test tests/test_previous_task_name.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const staticDir = join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'static');
const read = (file) => readFileSync(join(staticDir, file), 'utf8');

/** Top-level `function name(` ... `\n}` declarations from a classic script. */
function liftFunctions(sandbox, file, names) {
  const source = read(file);
  for (const name of names) {
    const start = source.indexOf(`\nfunction ${name}(`);
    assert.notEqual(start, -1, `${name} not found in ${file}`);
    const end = source.indexOf('\n}\n', start);
    assert.notEqual(end, -1, `${name} in ${file} has no closing brace at column 0`);
    vm.runInContext(source.slice(start, end + 3), sandbox);
  }
}

/** parseTaskLine() over `plan` in #planEditor, counting tokenizer calls. */
function load(plan) {
  // task-tokenizer.js declares TaskLineTokenizer with `const`, a binding a
  // later property could not shadow, so load it apart and hand the parser
  // a counting wrapper
  const own = vm.createContext({});
  vm.runInContext(`${read('task-tokenizer.js')}\nthis.TaskLineTokenizer = TaskLineTokenizer;`, own);
  const tokenizer = own.TaskLineTokenizer;
  const counted = { calls: 0 };
  const editor = { value: plan };
  const sandbox = vm.createContext({
    console,
    document: { getElementById: (id) => (id === 'planEditor' ? editor : null) },
    TaskLineTokenizer: {
      ...tokenizer,
      metadata(line) { counted.calls++; return tokenizer.metadata(line); },
    },
  });
  liftFunctions(sandbox, 'script.js', ['isSummaryLine', 'getPreviousTaskName', 'parseTaskLine']);
  const lines = plan.split('\n');
  const parse = (lineNumber) => sandbox.parseTaskLine(lines[lineNumber - 1], lineNumber);
  return { parse, counted };
}

test('a * task depends on the task before it', () => {
  const { parse } = load('Design 3d\n* Build 2d');
  assert.equal(parse(2).dependencies, 'Design');
  assert.equal(parse(2).name, 'Build');
});

test("the previous task's own * and metadata are not part of its name", () => {
  const { parse } = load('Build API 5d @kev [depends Design] "note"\n* Test 1d\n* +2d Ship 1d');
  assert.equal(parse(2).dependencies, 'Build API');
  assert.equal(parse(3).dependencies, 'Test +2d');
});

test('explicit dependencies follow the implicit one', () => {
  const { parse } = load('A 1d\n* B 1d [depends X, Y]');
  assert.equal(parse(2).dependencies, 'A, X, Y');
});

test('summary tasks, blank lines, headings and dividers are skipped', () => {
  const plan = 'Phase 1\n  Design 3d\n\n# heading\n=== divider ===\nPhase 2\n  * Build 2d';
  const { parse } = load(plan);
  assert.equal(parse(7).dependencies, 'Design');
});

test('the first task has no predecessor to depend on', () => {
  const { parse } = load('* Lonely 1d');
  assert.equal(parse(1).dependencies, '');
});

test('parsing every line of a long * chain reads each line a bounded number of times', () => {
  const n = 400;
  const plan = ['Start 1d', ...Array.from({ length: n }, (_, i) => `* Step ${i} 1d`)].join('\n');
  const { parse, counted } = load(plan);

  for (let line = 1; line <= n + 1; line++) parse(line);

  assert.equal(parse(n + 1).dependencies, `Step ${n - 2}`);
  // each line once for itself, once for its predecessor's name (the old
  // recursion walked the whole chain above each line: ~n*n/2 = 80,000)
  assert.ok(counted.calls <= 3 * (n + 2), `${counted.calls} tokenizer calls for ${n + 1} lines`);
});
