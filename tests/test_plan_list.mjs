/**
 * The plan list's data (#1384, epic #1376): static/plan-list.js groups the
 * scheduler's tasks into cards, and static/summary-collapse.js remembers which
 * are open, per project, for both the plan list and the Gantt.
 *
 * Both are classic scripts; their pure parts run here in a vm sandbox. The
 * cards themselves are drawn by <np-note stacked>, which the browser suite
 * (tests/ui/test_plan_list.py) covers.
 *
 * Run with: node --test tests/test_plan_list.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.join(here, '..', 'packages/noodle-web/src/noodle_web/static');
const read = (name) => fs.readFileSync(path.join(staticDir, name), 'utf8');

function memoryStorage() {
    const items = new Map();
    return {
        getItem: (key) => (items.has(key) ? items.get(key) : null),
        setItem: (key, value) => items.set(key, String(value)),
        removeItem: (key) => items.delete(key),
        items,
    };
}

function load({ projectId = 'p1', storage = memoryStorage() } = {}) {
    const events = [];
    const sandbox = {
        console,
        localStorage: storage,
        document: { dispatchEvent: (event) => events.push(event), addEventListener() {} },
        CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    };
    sandbox.getCurrentProjectId = () => sandbox.projectId;
    sandbox.projectId = projectId;
    vm.createContext(sandbox);
    vm.runInContext(read('summary-collapse.js'), sandbox);
    vm.runInContext(read('plan-list.js'), sandbox);
    return { sandbox, storage, events, list: sandbox.NoodlePlanList, collapse: sandbox.NoodleSummaryCollapse };
}

/** Plain data out of the sandbox's realm, so deepEqual compares values. */
const plain = (value) => JSON.parse(JSON.stringify(value));

const task = (name, level, extra = {}) => ({ name, level, is_summary: false, ...extra });
const summary = (name, level, extra = {}) => ({ name, level, is_summary: true, ...extra });

const TASKS = [
    task('Kick-off', 1, { percent: 100, start: '2026-01-05', finish: '2026-01-05' }),
    summary('Design', 1, { percent: 50, start: '2026-01-06', finish: '2026-01-20', rag: 'On track' }),
    task('Research', 2, { percent: 100, resources: 'alex', finish: '2026-01-08' }),
    summary('Wireframes', 2, { percent: 0 }),
    task('Sketches', 3, { percent: 100, resources: 'sam, alex' }),
    task('Review', 3, { percent: 0, resources: '@jo' }),
    task('Sign-off', 2, { percent: 0 }),
    summary('Build', 1, { start: '2026-02-01', finish: '2026-03-01' }),
    task('Code', 2, { percent: 20 }),
    task('Launch', 1, { percent: 0, start: '2026-03-02', finish: '2026-03-02' }),
];

test('a card per top-level summary, then one Ungrouped card', () => {
    const { list } = load();
    const cards = list.groups(TASKS);
    assert.deepEqual(plain(cards.map((c) => c.name)), ['Design', 'Build', 'Ungrouped']);
    assert.deepEqual(plain(cards[0].rows.map((r) => [r.task.name, r.depth, r.index])), [
        ['Research', 0, 2], ['Wireframes', 0, 3], ['Sketches', 1, 4], ['Review', 1, 5], ['Sign-off', 0, 6],
    ]);
    assert.deepEqual(plain(cards[2].rows.map((r) => r.task.name)), ['Kick-off', 'Launch']);
});

test('a card\'s summary line counts its tasks, not its summaries', () => {
    const { list } = load();
    const [design, build, ungrouped] = list.groups(TASKS);
    assert.equal(design.total, 4);
    assert.equal(design.done, 2);
    assert.equal(design.percent, 50);
    assert.equal(design.start, '2026-01-06');
    assert.equal(design.finish, '2026-01-20');
    assert.equal(design.rag, 'On track');
    assert.deepEqual(plain(design.resources), ['alex', 'sam', 'jo']);
    // No percent of its own: the average of its tasks.
    assert.equal(build.percent, 20);
    // The Ungrouped card spans its tasks.
    assert.equal(ungrouped.start, '2026-01-05');
    assert.equal(ungrouped.finish, '2026-03-02');
    assert.equal(ungrouped.percent, 50);
    assert.equal(ungrouped.done, 1);
});

test('a card\'s RAG is the worst of its unfinished tasks\'', () => {
    const { list, sandbox } = load();
    sandbox.ragStatusToColour = (rag) => ({ 'task overdue': 'red', 'behind schedule': 'amber' })[String(rag).toLowerCase()] || 'green';
    const card = (...leaves) => list.groups([summary('S', 1), ...leaves.map((l, i) => task(`T${i}`, 2, l))])[0].rag;
    assert.equal(card({ percent: 100 }, { percent: 100 }), 'Complete');
    assert.equal(card({ percent: 0 }, {}), 'Not Started');
    assert.equal(card({ percent: 100 }, { percent: 0, rag: 'Not Started' }), 'On Track');
    assert.equal(card({ percent: 10, rag: 'Behind Schedule' }, { rag: 'Not Started' }), 'Behind Schedule');
    assert.equal(card({ rag: 'Behind Schedule' }, { rag: 'Task Overdue' }), 'Task Overdue');
    // A finished task's old status does not count against the card.
    assert.equal(card({ percent: 100, rag: 'Task Overdue' }, { percent: 50 }), 'On Track');
    // A summary's own RAG, when it has one, wins.
    assert.equal(list.groups([summary('S', 1, { rag: 'Behind Schedule' }), task('T', 2, { percent: 100 })])[0].rag, 'Behind Schedule');
});

test('a nested summary knows its children and whether they are part done', () => {
    const { list } = load();
    const wireframes = list.groups(TASKS)[0].rows.find((r) => r.task.name === 'Wireframes');
    assert.equal(wireframes.childCount, 2);
    assert.equal(wireframes.indeterminate, true);
});

test('a collapsed nested summary hides the rows under it, and only those', () => {
    const { list } = load();
    const design = list.groups(TASKS)[0];
    const rows = list.visibleRows(design, (name) => name === 'Wireframes');
    assert.deepEqual(plain(rows.map((r) => [r.task.name, r.collapsed])), [
        ['Research', false], ['Wireframes', true], ['Sign-off', false],
    ]);
    assert.equal(list.visibleRows(design, () => false).length, 5);
});

test('a plan with no summaries is one Ungrouped card; no tasks, no cards', () => {
    const { list } = load();
    const cards = list.groups([task('A', 1), task('B', 1)]);
    assert.deepEqual(plain(cards.map((c) => [c.name, c.total])), [['Ungrouped', 2]]);
    assert.deepEqual(plain(list.groups([])), []);
    assert.deepEqual(plain(list.groups(null)), []);
});

test('dates are short', () => {
    const { list } = load();
    assert.equal(list.shortDate('2026-03-05'), '5 Mar');
    assert.equal(list.shortDate(''), '');
    assert.equal(list.shortDate('soon'), 'soon');
});

test('collapse state is per project, and survives a reload', () => {
    const storage = memoryStorage();
    const first = load({ storage });
    assert.equal(first.collapse.isCollapsed('Design', false), false);
    assert.equal(first.collapse.isCollapsed('Design', true), true);
    first.collapse.set('Design', true);
    first.collapse.set('Build', false);
    assert.equal(first.events.length, 2);
    assert.equal(first.events[0].type, 'summarycollapsechange');
    assert.deepEqual(plain(first.events[0].detail), { name: 'Design', collapsed: true });

    // A new page on the same project reads it back, whatever the default.
    const reload = load({ storage });
    assert.equal(reload.collapse.isCollapsed('design', false), true);
    assert.equal(reload.collapse.isCollapsed('Build', true), false);

    // Another project starts from its own defaults.
    const other = load({ storage, projectId: 'p2' });
    assert.equal(other.collapse.get('Design'), undefined);
    assert.ok(storage.items.has('noodleplanner:collapsed-summaries:p1'));
});

test('setting what is already stored changes nothing', () => {
    const { collapse, events } = load();
    collapse.set('Design', true);
    collapse.set('Design', true);
    assert.equal(events.length, 1);
    assert.equal(collapse.toggle('Design', false), false);
    assert.equal(collapse.isCollapsed('Design', true), false);
});
