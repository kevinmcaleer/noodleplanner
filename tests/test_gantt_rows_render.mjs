/**
 * renderGanttRows() (views-gantt.js) builds the name -> row-id map for the
 * Predecessors column once per render, and appends each info row once.
 *
 * The map is what turns a task's `depends` names into "3FS, 5SS+2d", and
 * buildTaskNameToIdMap()'s own comment says it is "called once per
 * render" -- but it was called inside the per-row loop, rebuilding a map
 * of every task for every row: quadratic in the plan on each Gantt render.
 * The loop also appended each info row to #ganttInfoBody twice (the
 * second call only moved it to where it already was).
 *
 * Run with: node --test tests/test_gantt_rows_render.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const staticDir = join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'static');
const source = readFileSync(join(staticDir, 'views-gantt.js'), 'utf8');

/** Top-level `function name(` ... `\n}` declarations from views-gantt.js. */
function liftFunctions(sandbox, names) {
  for (const name of names) {
    const start = source.indexOf(`\nfunction ${name}(`);
    assert.notEqual(start, -1, `${name} not found`);
    const end = source.indexOf('\n}\n', start);
    assert.notEqual(end, -1, `${name} has no closing brace at column 0`);
    vm.runInContext(source.slice(start, end + 3), sandbox);
  }
}

function fakeElement(tag) {
  const el = {
    tagName: tag,
    children: [],
    appended: 0,
    style: {},
    dataset: {},
    innerHTML: '',
    textContent: '',
    classList: { add() {}, remove() {} },
    appendChild(child) {
      el.appended++;
      const at = el.children.indexOf(child);
      if (at >= 0) el.children.splice(at, 1);
      el.children.push(child);
      return child;
    },
    addEventListener() {},
  };
  return el;
}

function render(ganttTasks) {
  const elements = { ganttInfoBody: fakeElement('tbody'), ganttBody: fakeElement('div') };
  const counted = { maps: 0 };
  const noop = () => {};
  const sandbox = vm.createContext({
    ganttTasks,
    collapsedSummaryTasks: new Set(),
    document: {
      getElementById: (id) => elements[id] || null,
      createElement: fakeElement,
      createTextNode: (text) => ({ text }),
    },
    GanttScale: { dayOf: () => 0 },
    ganttTotalWidth: () => 1000,
    getConditionalFormatting: () => null,
    createMiniPiechart: () => fakeElement('svg'),
    createTaskContextButton: () => fakeElement('button'),
    ragStatusToColour: () => '',
    renderWeekendHighlights: noop,
    syncGanttPercentToEditor: noop,
    setupGanttEditableCell: noop,
    makeEditable: noop,
    makePriorityEditable: noop,
    makeBucketEditable: noop,
    showTaskContextMenuAtPosition: noop,
    addRowInteractions: noop,
    placeGanttElement: noop,
    setupBarDragListeners: noop,
    setupBarClickToOpenTask: noop,
    renderBaselineBar: noop,
    renderDeadlineMarker: noop,
  });
  liftFunctions(sandbox, ['buildTaskNameToIdMap', 'formatPredecessors', 'renderGanttRows']);
  const realMap = sandbox.buildTaskNameToIdMap;
  sandbox.buildTaskNameToIdMap = (tasks) => { counted.maps++; return realMap(tasks); };
  sandbox.renderGanttRows();
  return { elements, counted };
}

const tasks = (n) => Array.from({ length: n }, (_, i) => ({
  id: i + 1,
  name: `Task ${i + 1}`,
  level: 1,
  start: '2026-01-05',
  finish: '2026-01-06',
  duration_days: 1,
  depends: i ? [`Task ${i}`] : [],
  lag_lead: i === 2 ? { 'Task 2': '+2d' } : {},
}));

test('the name -> id map is built once per render, not once per row', () => {
  const { counted } = render(tasks(50));
  assert.equal(counted.maps, 1);
});

test('the Predecessors column still reads each dependency by row id', () => {
  const { elements } = render(tasks(3));
  const predecessors = elements.ganttInfoBody.children.map(row => row.children.at(-1).textContent);
  assert.deepEqual(predecessors, ['-', '1FS', '2FS+2d']);
});

test('each info row is appended once, in task order', () => {
  const { elements } = render(tasks(5));
  const body = elements.ganttInfoBody;
  assert.equal(body.appended, 5);
  assert.deepEqual(body.children.map(row => row.dataset.taskIndex), [0, 1, 2, 3, 4]);
  assert.equal(elements.ganttBody.children.length, 5);
});
