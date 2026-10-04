/**
 * Whiteboard associative lines (#874): the `Kind: line` rows in the
 * ---whiteboard--- table and the pure helpers in whiteboard-lines.js. The
 * drawing itself (SVG layer, label/pen controls, the draw-from-menu gesture)
 * is DOM-dependent and covered by browser verification.
 *
 * Run with: node --test tests/test_whiteboard_lines.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import backMatter from '../packages/noodle-web/src/noodle_web/static/back-matter-markers.js';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const staticDir = join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'static');

function lift(sandbox, file, names) {
  const source = readFileSync(join(staticDir, file), 'utf8');
  for (const name of names) {
    const start = source.indexOf(`\nfunction ${name}(`);
    assert.notEqual(start, -1, `${name} not found in ${file}`);
    const end = source.indexOf('\n}\n', start);
    vm.runInContext(source.slice(start, end + 3), sandbox);
  }
}

const sandbox = {
  console,
  ...backMatter,
  WHITEBOARD_START: '---whiteboard---',
  PARKING_LOT_START: '---parking lot---',
  Math,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(staticDir, 'task-tokenizer.js'), 'utf8') +
  '\nthis.TaskLineTokenizer = TaskLineTokenizer;', sandbox);
vm.runInContext(readFileSync(join(staticDir, 'plan-model.js'), 'utf8'), sandbox);
lift(sandbox, 'script.js', [
  'extractWhiteboardFromPlanText', 'parseWhiteboardMarkdown', 'generateWhiteboardText',
  'validateWhiteboardRows', 'updatePlanWhiteboardText', 'renamePlanWhiteboardTask',
]);
vm.runInContext('const WB_LINE_PENS = [{ name: "Red", colour: "#E5484D" }, { name: "Blue", colour: "#3E63DD" }];' +
  'const WB_LINE_ID_PREFIX = "l";', sandbox);
lift(sandbox, 'whiteboard-lines.js', [
  'wbGenerateLineId', 'wbIsKnownPen', 'wbLineRows', 'wbAddLineToItems', 'wbUpdateLineInItems',
  'wbRemoveLineFromItems', 'wbPromoteLineInPlanText',
]);

const j = (v) => JSON.parse(JSON.stringify(v));

const note = (task, x = 0, y = 0) => ({ task, x, y, colour: '', width: null, height: null, collapsed: false });
const line = (id, from, to, label = '', colour = '') => ({ kind: 'line', id, from, to, label, colour });

test('a line row round-trips through the table with its label and pen', () => {
  const items = [note('Alpha', 10, 20), note('Beta', 400, 20), line('l1abc', 'Alpha', 'Beta', 'conflicts with', '#E5484D')];
  const text = sandbox.generateWhiteboardText(items);
  assert.match(text, /\| From /);
  assert.match(text, /\| To /);
  assert.deepEqual(j(sandbox.parseWhiteboardMarkdown(text)), items);
});

test('a label with pipes and newlines survives', () => {
  const items = [note('A'), note('B'), line('l1', 'A', 'B', 'a | b\nc')];
  const back = j(sandbox.parseWhiteboardMarkdown(sandbox.generateWhiteboardText(items)));
  assert.equal(back[2].label, 'a | b\nc');
});

test('a plan with no lines keeps the seven-column table', () => {
  const text = sandbox.generateWhiteboardText([note('A')]);
  assert.doesNotMatch(text, /From|Kind/);
});

test('lines coexist with text objects and groups', () => {
  const items = [
    note('A', 1, 2), { kind: 'group', task: 'Phase', colour: '' },
    { kind: 'text', id: 't1', text: 'Heading', x: 5, y: 6 }, line('l1', 'A', 'Phase', 'see also'),
  ];
  assert.deepEqual(j(sandbox.parseWhiteboardMarkdown(sandbox.generateWhiteboardText(items))), items);
});

test('a line row with no Id, From or To is dropped', () => {
  const text = [
    '| Task | X | Y | Colour | Width | Height | Collapsed | Kind | Id | Text | From | To |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
    '| | | | | | | | line | | x | A | B |',
    '| | | | | | | | line | l1 | x | | B |',
    '| | | | | | | | line | l2 | x | A | |',
    '| | | | | | | | line | l3 | ok | A | B |',
  ].join('\n');
  const items = j(sandbox.parseWhiteboardMarkdown(text));
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'l3');
});

test('validateWhiteboardRows ignores lines', () => {
  const items = [note('A'), line('l1', 'A', 'Gone')];
  assert.deepEqual(j(sandbox.validateWhiteboardRows(items, ['A'])), []);
});

test('renaming a task renames the ends of its lines', () => {
  const plan = 'A 1d\nB 1d\n\n' + '---whiteboard---\n' +
    sandbox.generateWhiteboardText([note('A'), note('B'), line('l1', 'A', 'B')]);
  const next = sandbox.renamePlanWhiteboardTask(plan, 'A', 'Alpha');
  const items = j(sandbox.parseWhiteboardMarkdown(sandbox.extractWhiteboardFromPlanText(next)));
  assert.equal(items[0].task, 'Alpha');
  assert.equal(items[2].from, 'Alpha');
  assert.equal(items[2].to, 'B');
});

test('wbAddLineToItems refuses a self-line and a duplicate in either direction', () => {
  const items = [note('A'), note('B')];
  assert.equal(sandbox.wbAddLineToItems(items, 'A', 'a').ok, false);
  const added = sandbox.wbAddLineToItems(items, 'A', 'B');
  assert.equal(added.ok, true);
  assert.equal(added.items.length, 3);
  assert.equal(sandbox.wbAddLineToItems(added.items, 'B', 'A').ok, false);
  assert.equal(sandbox.wbAddLineToItems(added.items, 'A', 'B').ok, false);
});

test('wbUpdateLineInItems sets label and pen, wbRemoveLineFromItems drops the row', () => {
  const items = [note('A'), note('B'), line('l1', 'A', 'B')];
  const updated = j(sandbox.wbUpdateLineInItems(items, 'l1', { label: '  same team ', colour: '#3E63DD' }));
  assert.equal(updated[2].label, 'same team');
  assert.equal(updated[2].colour, '#3E63DD');
  const removed = j(sandbox.wbRemoveLineFromItems(items, 'l1'));
  assert.equal(removed.length, 2);
});

test('wbIsKnownPen matches case-insensitively', () => {
  assert.equal(sandbox.wbIsKnownPen('#e5484d'), true);
  assert.equal(sandbox.wbIsKnownPen('#000000'), false);
});

test('promoting a line writes the dependency and removes the line in one text', () => {
  const plan = 'Phase\n  A 1d\n  B 1d\n\n---whiteboard---\n' +
    sandbox.generateWhiteboardText([note('Phase'), line('l1', 'A', 'B', 'before')]);
  const result = sandbox.wbPromoteLineInPlanText(plan, 'l1');
  assert.equal(result.ok, true, result.reason);
  assert.match(result.text, /B 1d.*\[depends: A\]|\[depends: A\].*B|B.*depends/s);
  const items = j(sandbox.parseWhiteboardMarkdown(sandbox.extractWhiteboardFromPlanText(result.text)));
  assert.equal(items.some(i => i.kind === 'line'), false);
});

test('promoting is refused for a summary task and for a missing line', () => {
  const plan = 'Phase\n  A 1d\n  B 1d\n\n---whiteboard---\n' +
    sandbox.generateWhiteboardText([line('l1', 'Phase', 'B')]);
  const refused = sandbox.wbPromoteLineInPlanText(plan, 'l1');
  assert.equal(refused.ok, false);
  assert.ok(refused.reason);
  assert.equal(sandbox.wbPromoteLineInPlanText(plan, 'nope').ok, false);
});
