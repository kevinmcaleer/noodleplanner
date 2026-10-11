/**
 * Portfolio action chaser (static/portfolio-actions.js): which RAID items
 * count as open actions, their derived status colour, the table rows and the
 * sort/filter over the stored list.
 *
 * Classic script of top-level functions, lifted into a vm sandbox with
 * escapeHtml from state.js and the clock pinned.
 *
 * Run with: node --test tests/test_portfolio_actions.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

process.env.TZ = 'UTC';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const staticDir = join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'static');
const source = readFileSync(join(staticDir, 'portfolio-actions.js'), 'utf8');
const stateSrc = readFileSync(join(staticDir, 'state.js'), 'utf8');

function extract(src, name) {
    const start = src.indexOf(`\nfunction ${name}(`);
    assert.notEqual(start, -1, `${name} not found`);
    return src.slice(start, src.indexOf('\n}\n', start) + 3);
}

const TODAY = new Date(2026, 5, 10);
class FakeDate extends Date {
    constructor(...args) { args.length ? super(...args) : super(TODAY); }
    static now() { return TODAY.getTime(); }
}
const iso = (offset) => new FakeDate(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() + offset)
    .toISOString().slice(0, 10);
const plain = (v) => JSON.parse(JSON.stringify(v));

function load() {
    const rows = [];
    const sandbox = {
        Date: FakeDate, console, Math, String, Number, Infinity, isNaN,
        window: {},
        document: {
            getElementById: (id) => (id === 'portfolioActionsTableBody' ? sandbox.tbody : null),
            querySelectorAll: () => rows,
        },
        tbody: { innerHTML: '' },
        rows,
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(extract(stateSrc, 'escapeHtml') + '\n' + source, sandbox);
    return sandbox;
}

function project(id, name, raid_items, success = true) {
    return { project: { id, name }, parsedResult: { success, raid_items } };
}

// ── collectOpenActions ──────────────────────────────────────────────────

test('only RAID items of type action that are not closed are collected', () => {
    const { collectOpenActions } = load();
    const actions = plain(collectOpenActions([
        project('p1', 'Alpha', [
            { id: 1, type: 'action', title: 'Chase supplier', owner: 'kev', status: 'open', target_date: iso(3) },
            { id: 2, type: 'Action', title: 'In progress', status: 'In Progress' },
            { id: 3, type: 'action', title: 'Done', status: 'Closed' },
            { id: 4, type: 'risk', title: 'Not an action', status: 'open' },
            { id: 5, title: 'Untyped', status: 'open' },
        ]),
    ]));
    assert.deepEqual(actions.map((a) => a.title), ['Chase supplier', 'In progress']);
    assert.equal(actions[0].projectName, 'Alpha');
    assert.equal(actions[0].owner, 'kev');
    assert.equal(actions[1].owner, '-');
    assert.equal(actions[1].status, 'In Progress');
    assert.equal(actions[1].targetDate, null);
});

test('fields fall back: description for title, mitigation for description, date for target', () => {
    const { collectOpenActions } = load();
    const [a] = plain(collectOpenActions([
        project('p', 'P', [{ type: 'action', description: 'Only desc', mitigation_actions: 'Do it', date: '2026-07-01', raised_by: 'sam' }]),
    ]));
    assert.equal(a.title, 'Only desc');
    assert.equal(a.description, 'Only desc');
    assert.equal(a.targetDate, '2026-07-01');
    assert.equal(a.status, 'open');
    assert.equal(a.actionId, null);
    assert.equal(a.raisedBy, 'sam');
    assert.equal(a.priority, null);
    const [b] = plain(collectOpenActions([
        project('p', 'P', [{ type: 'action', mitigation_actions: 'Do it' }]),
    ]));
    assert.equal(b.title, '-');
    assert.equal(b.description, 'Do it');
});

test('actions are read even when task parsing failed, but not from a null parse', () => {
    const { collectOpenActions } = load();
    const actions = plain(collectOpenActions([
        project('a', 'A', [{ type: 'action', title: 'Still here' }], false),
        { project: { id: 'b', name: 'B' }, parsedResult: null },
        { project: { id: 'c', name: 'C' }, parsedResult: { success: true } },
    ]));
    assert.deepEqual(actions.map((a) => a.title), ['Still here']);
});

test('actions sort by target date with undated ones last', () => {
    const { collectOpenActions } = load();
    const actions = plain(collectOpenActions([
        project('a', 'A', [
            { type: 'action', title: 'undated' },
            { type: 'action', title: 'later', target_date: iso(10) },
        ]),
        project('b', 'B', [
            { type: 'action', title: 'sooner', target_date: iso(-2) },
            { type: 'action', title: 'also undated' },
        ]),
    ]));
    assert.deepEqual(actions.map((a) => a.title), ['sooner', 'later', 'undated', 'also undated']);
});

// ── deriveActionStatus / priority / dates ───────────────────────────────

test('status colour: undated blue, past red, within a week amber, later green', () => {
    const { deriveActionStatus } = load();
    assert.equal(deriveActionStatus({ targetDate: null }), 'blue');
    assert.equal(deriveActionStatus({ targetDate: iso(-1) }), 'red');
    assert.equal(deriveActionStatus({ targetDate: iso(0) }), 'amber');
    assert.equal(deriveActionStatus({ targetDate: iso(7) }), 'amber');
    assert.equal(deriveActionStatus({ targetDate: iso(8) }), 'green');
});

test('priority badge classes are case-insensitive and empty for unknown values', () => {
    const { getPriorityBadgeClass } = load();
    assert.equal(getPriorityBadgeClass('High'), 'actions-priority-high');
    assert.equal(getPriorityBadgeClass('medium'), 'actions-priority-medium');
    assert.equal(getPriorityBadgeClass('LOW'), 'actions-priority-low');
    assert.equal(getPriorityBadgeClass('urgent'), '');
    assert.equal(getPriorityBadgeClass(null), '');
});

test('formatActionDate renders en-GB and passes unparseable text through', () => {
    const { formatActionDate } = load();
    assert.equal(formatActionDate('2026-03-05'), '5 Mar 2026');
    assert.equal(formatActionDate(''), '-');
    assert.equal(formatActionDate(null), '-');
    assert.equal(formatActionDate('next week'), 'next week');
});

// ── buildActionsTableRows ───────────────────────────────────────────────

test('rows carry the project for filtering, escaped content and the click handler', () => {
    const { buildActionsTableRows } = load();
    const html = buildActionsTableRows([{
        projectId: 'p1', projectName: 'A & B', actionId: 7, title: '<b>Chase</b>',
        owner: 'kev', priority: 'high', targetDate: iso(20),
    }]);
    assert.ok(html.startsWith('<tr class="actions-row" data-project="A &amp; B" onclick="openProjectAction(\'p1\', 7)">'));
    assert.ok(html.includes('<td class="actions-task-name">&lt;b&gt;Chase&lt;/b&gt;</td>'));
    assert.ok(html.includes('<span class="actions-priority-badge actions-priority-high">High</span>'));
    assert.ok(html.includes('<td class="actions-finish-date">'));
    assert.ok(html.includes('<span class="rag-badge rag-green">OPEN</span>'));
});

test('overdue rows are marked, undated ones are blue and actionless rows pass null', () => {
    const { buildActionsTableRows } = load();
    const html = buildActionsTableRows([
        { projectId: 'p', projectName: 'P', actionId: null, title: 'late', owner: '-', priority: null, targetDate: iso(-3) },
        { projectId: 'p', projectName: 'P', actionId: 2, title: 'free', owner: '-', priority: 'odd', targetDate: null },
    ]);
    const [late, free] = html.split('</tr>');
    assert.ok(late.includes("openProjectAction('p', null)"));
    assert.ok(late.includes('class="actions-finish-date actions-overdue"'));
    assert.ok(late.includes('<span class="rag-badge rag-red">OVERDUE</span>'));
    assert.ok(late.includes('<td>-</td>'));                    // no priority
    assert.ok(free.includes('<td>Odd</td>'));                  // unknown priority: label, no badge
    assert.ok(free.includes('<td class="actions-finish-date">-</td>'));
    assert.ok(free.includes('rag-blue">OPEN</span>'));
});

test('an explicit today changes what counts as overdue', () => {
    const { buildActionsTableRows } = load();
    const action = { projectId: 'p', projectName: 'P', actionId: 1, title: 't', owner: '-', targetDate: iso(2) };
    assert.ok(buildActionsTableRows([action]).includes('OPEN'));
    const later = new FakeDate(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() + 5);
    assert.ok(buildActionsTableRows([action], later).includes('OVERDUE'));
});

// ── sort and filter over the stored list ────────────────────────────────

function seed(sandbox) {
    sandbox.window.portfolioActionsData = [
        { projectId: 'a', projectName: 'Zeta', actionId: 1, title: 'b task', owner: 'Sam', priority: 'low', targetDate: iso(1) },
        { projectId: 'b', projectName: 'alpha', actionId: 2, title: 'A task', owner: 'kev', priority: 'high', targetDate: null },
        { projectId: 'c', projectName: 'Mid', actionId: 3, title: 'c task', owner: '', priority: null, targetDate: iso(-1) },
    ];
}

test('sortPortfolioActions orders by each column and toggles direction on repeat', () => {
    const sandbox = load();
    const { sortPortfolioActions } = sandbox;
    const titles = () => plain(sandbox.window.portfolioActionsData.map((a) => a.title));
    seed(sandbox);
    sortPortfolioActions('project');
    assert.deepEqual(titles(), ['A task', 'c task', 'b task']);   // case-insensitive
    sortPortfolioActions('project');
    assert.deepEqual(titles(), ['b task', 'c task', 'A task']);   // toggled
    sortPortfolioActions('priority');
    assert.deepEqual(titles(), ['A task', 'b task', 'c task']);   // high, low, none
    sortPortfolioActions('status');
    assert.deepEqual(titles(), ['c task', 'b task', 'A task']);   // red, amber, blue
    sortPortfolioActions('owner');
    assert.deepEqual(titles(), ['c task', 'A task', 'b task']);   // '', kev, sam
    sortPortfolioActions('title');
    assert.deepEqual(titles(), ['A task', 'b task', 'c task']);
    assert.ok(sandbox.tbody.innerHTML.includes('data-project="alpha"'));
});

test('the default sort column starts ascending by target date and flips first time round', () => {
    const sandbox = load();
    seed(sandbox);
    // The module's initial column is targetDate, so the first click flips it.
    sandbox.sortPortfolioActions('targetDate');
    assert.deepEqual(plain(sandbox.window.portfolioActionsData.map((a) => a.title)), ['A task', 'b task', 'c task']);
    sandbox.sortPortfolioActions('targetDate');
    assert.deepEqual(plain(sandbox.window.portfolioActionsData.map((a) => a.title)), ['c task', 'b task', 'A task']);
});

test('sorting without stored data is a no-op', () => {
    const sandbox = load();
    sandbox.sortPortfolioActions('title');
    assert.equal(sandbox.tbody.innerHTML, '');
});

test('filterPortfolioActions hides rows of other projects and shows all for "all"', () => {
    const sandbox = load();
    const rows = [
        { dataset: { project: 'A' }, style: {} },
        { dataset: { project: 'B' }, style: {} },
    ];
    sandbox.rows.push(...rows);
    sandbox.document.getElementById = (id) => (id === 'portfolioActionsProjectFilter' ? { value: 'A' } : null);
    sandbox.filterPortfolioActions();
    assert.deepEqual(rows.map((r) => r.style.display), ['', 'none']);
    sandbox.document.getElementById = () => null;   // no filter control → 'all'
    sandbox.filterPortfolioActions();
    assert.deepEqual(rows.map((r) => r.style.display), ['', '']);
});
