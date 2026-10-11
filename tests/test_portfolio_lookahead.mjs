/**
 * Portfolio 2-week look-ahead (static/portfolio-lookahead.js): the computed
 * task status, which tasks land in the overdue and upcoming lists, the
 * status counts, and the <np-task-row> markup each list renders.
 *
 * The module is a classic script of top-level function declarations, so it
 * is lifted into a vm sandbox with the few script.js/state.js helpers it
 * calls, and the clock is pinned so the lists do not depend on when CI runs.
 *
 * Run with: node --test tests/test_portfolio_lookahead.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

process.env.TZ = 'UTC';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const staticDir = join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'static');
const source = readFileSync(join(staticDir, 'portfolio-lookahead.js'), 'utf8');
const scriptSrc = readFileSync(join(staticDir, 'script.js'), 'utf8');
const stateSrc = readFileSync(join(staticDir, 'state.js'), 'utf8');

function extract(src, name) {
    const start = src.indexOf(`\nfunction ${name}(`);
    assert.notEqual(start, -1, `${name} not found`);
    const end = src.indexOf('\n}\n', start);
    return src.slice(start, end + 3);
}

const TODAY = new Date(2026, 5, 10); // local midnight, 10 June 2026

class FakeDate extends Date {
    constructor(...args) { args.length ? super(...args) : super(TODAY); }
    static now() { return TODAY.getTime(); }
}

/** A fresh sandbox with the clock pinned to TODAY. */
function load() {
    const sandbox = { Date: FakeDate, console, window: {}, parseInt, Math, Number, String };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(
        [
            extract(stateSrc, 'escapeHtml'),
            extract(scriptSrc, 'formatSubtaskDate'),
            extract(scriptSrc, 'formatTaskRowDates'),
            extract(scriptSrc, 'reportRowDates'),
            extract(scriptSrc, 'taskRowResourceNames'),
            source,
        ].join('\n'),
        sandbox,
    );
    return sandbox;
}

const plain = (v) => JSON.parse(JSON.stringify(v));
const iso = (d) => d.toISOString().slice(0, 10);
const day = (offset) => new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() + offset);

// ── computeLookAheadTaskStatus ──────────────────────────────────────────

test('100% is Complete whatever the dates', () => {
    const { computeLookAheadTaskStatus: f } = load();
    assert.equal(f({ startDate: day(-20), finishDate: day(-10), percent: 100, today: TODAY }), 'Complete');
    assert.equal(f({ startDate: null, finishDate: null, percent: 100, today: TODAY }), 'Complete');
});

test('a task starting after today is Not Started', () => {
    const { computeLookAheadTaskStatus: f } = load();
    assert.equal(f({ startDate: day(1), finishDate: day(5), percent: 0, today: TODAY }), 'Not Started');
    // the boundary: starting today is not "after today"
    assert.equal(f({ startDate: day(0), finishDate: day(5), percent: 0, today: TODAY }), 'Task Overdue');
});

test('a started task with no progress is Task Overdue', () => {
    const { computeLookAheadTaskStatus: f } = load();
    assert.equal(f({ startDate: day(-3), finishDate: day(3), percent: 0, today: TODAY }), 'Task Overdue');
    assert.equal(f({ startDate: day(-3), finishDate: null, percent: 0, today: TODAY }), 'Task Overdue');
});

test('past its finish date and incomplete is Task Overdue', () => {
    const { computeLookAheadTaskStatus: f } = load();
    assert.equal(f({ startDate: day(-10), finishDate: day(-1), percent: 90, today: TODAY }), 'Task Overdue');
    // finishing today is not yet overdue, but 100% was expected by now
    assert.equal(f({ startDate: day(-10), finishDate: day(0), percent: 99, today: TODAY }), 'Behind Schedule');
});

test('progress against elapsed time splits On Track from Behind Schedule', () => {
    const { computeLookAheadTaskStatus: f } = load();
    // 10-day task, 5 days elapsed → expected 50%
    assert.equal(f({ startDate: day(-5), finishDate: day(5), percent: 50, today: TODAY }), 'On Track');
    assert.equal(f({ startDate: day(-5), finishDate: day(5), percent: 49, today: TODAY }), 'Behind Schedule');
});

test('without dates the status falls back to progress bands', () => {
    const { computeLookAheadTaskStatus: f } = load();
    const bare = (percent) => f({ startDate: null, finishDate: null, percent, today: TODAY });
    assert.equal(bare(0), 'Task Overdue');
    assert.equal(bare(49), 'Task Overdue');
    assert.equal(bare(50), 'Behind Schedule');
    assert.equal(bare(79), 'Behind Schedule');
    assert.equal(bare(80), 'On Track');
});

test('look-ahead status agrees with the inspector except at the rounding boundary', () => {
    // The module's header promises it mirrors calculateInspectorRag() in
    // script.js. The inspector compares percent with the *unrounded*
    // expected figure while the look-ahead rounds first, so the two can
    // only disagree where percent equals the rounded expectation and sits
    // below the raw one. Pin that as the sole permitted divergence.
    const { computeLookAheadTaskStatus: f } = load();
    const inspectorBox = { Date: FakeDate, Math, parseInt, String, Number, formatInspectorDate: (s) => s };
    vm.createContext(inspectorBox);
    vm.runInContext(
        ['ragDayDate', 'ragToday', 'calculateInspectorRag'].map((n) => extract(scriptSrc, n)).join('\n'),
        inspectorBox,
    );
    const divergences = [];
    for (let startOffset = -12; startOffset <= 3; startOffset++) {
        for (let length = 1; length <= 10; length++) {
            for (let percent = 0; percent <= 100; percent += 1) {
                const start = day(startOffset);
                const finish = day(startOffset + length);
                const lookahead = f({ startDate: start, finishDate: finish, percent, today: TODAY });
                const inspector = inspectorBox.calculateInspectorRag({
                    percent, startDate: iso(start), finishDate: iso(finish), deadline: '',
                }).status;
                if (lookahead !== inspector) {
                    const elapsed = Math.max(0, -startOffset);
                    const raw = Math.min(100, (elapsed / Math.max(1, length)) * 100);
                    assert.equal(lookahead, 'On Track', `start ${startOffset}d, ${length}d, ${percent}%`);
                    assert.equal(inspector, 'Behind Schedule', `start ${startOffset}d, ${length}d, ${percent}%`);
                    assert.ok(percent === Math.round(raw) && percent < raw,
                        `unexpected divergence: start ${startOffset}d, ${length}d, ${percent}% (raw ${raw})`);
                    divergences.push([startOffset, length, percent]);
                }
            }
        }
    }
    // The divergence is real (e.g. 1 of 3 days elapsed, 33%): keep it visible.
    assert.ok(divergences.length > 0);
});

// ── collectLookAheadTasks ───────────────────────────────────────────────

function project(id, name, tasks, success = true) {
    return { project: { id, name }, parsedResult: { success, tasks } };
}

test('overdue and upcoming lists are built from the parsed projects', () => {
    const { collectLookAheadTasks } = load();
    const result = plain(collectLookAheadTasks([
        project('p1', 'Alpha', [
            { name: 'Phase', is_summary: true, start: iso(day(-30)), finish: iso(day(30)) },
            { name: 'Late', start: iso(day(-10)), finish: iso(day(-2)), percent: '40', resources: '@kev' },
            { name: 'Soon', start: iso(day(3)), finish: iso(day(6)), percent: 0, duration_days: 3 },
            { name: 'Far', start: iso(day(20)), finish: iso(day(25)), percent: 0 },
            { name: 'Done', start: iso(day(-5)), finish: iso(day(2)), percent: 100 },
        ]),
    ]));
    assert.deepEqual(result.overdue.map((t) => t.taskName), ['Late']);
    assert.equal(result.overdue[0].status, 'Task Overdue');
    assert.equal(result.overdue[0].daysLate, 2);
    assert.equal(result.overdue[0].percent, 40);
    assert.equal(result.overdue[0].projectName, 'Alpha');
    assert.equal(result.overdue[0].resources, '@kev');
    // "Done" finishes inside the window so it is upcoming, but Complete;
    // "Far" is outside the window and the summary phase is skipped.
    assert.deepEqual(result.upcoming.map((t) => [t.taskName, t.status]), [
        ['Done', 'Complete'], ['Soon', 'Not Started'],
    ]);
    assert.equal(result.upcoming[1].durationDays, 3);
    assert.equal(result.upcoming[1].resources, '-');
});

test('a task overdue for not having started counts days late from its start', () => {
    const { collectLookAheadTasks } = load();
    const { overdue } = plain(collectLookAheadTasks([
        project('p', 'P', [{ name: 'Idle', start: iso(day(-4)), finish: iso(day(4)), percent: 0 }]),
    ]));
    assert.equal(overdue[0].daysLate, 4);
    assert.equal(overdue[0].status, 'Task Overdue');
});

test('the two-week window is inclusive at both ends', () => {
    const { collectLookAheadTasks } = load();
    const { upcoming } = plain(collectLookAheadTasks([
        project('p', 'P', [
            { name: 'Edge start', start: iso(day(14)), finish: iso(day(20)), percent: 0 },
            { name: 'Just outside', start: iso(day(15)), finish: iso(day(20)), percent: 0 },
            { name: 'Edge finish', start: iso(day(-3)), finish: iso(day(0)), percent: 50 },
        ]),
    ]));
    assert.deepEqual(upcoming.map((t) => t.taskName), ['Edge finish', 'Edge start']);
});

test('failed parses and projects without tasks are skipped', () => {
    const { collectLookAheadTasks } = load();
    const result = plain(collectLookAheadTasks([
        project('a', 'A', [{ name: 'X', start: iso(day(-1)), finish: iso(day(1)), percent: 0 }], false),
        { project: { id: 'b', name: 'B' }, parsedResult: null },
        { project: { id: 'c', name: 'C' }, parsedResult: { success: true } },
    ]));
    assert.deepEqual(result, { overdue: [], upcoming: [] });
});

test('overdue sorts most overdue first and upcoming soonest first, across projects', () => {
    const { collectLookAheadTasks } = load();
    const result = plain(collectLookAheadTasks([
        project('a', 'A', [
            { name: 'A late', start: iso(day(-10)), finish: iso(day(-1)), percent: 10 },
            { name: 'A soon', start: iso(day(5)), finish: iso(day(6)), percent: 0 },
        ]),
        project('b', 'B', [
            { name: 'B later', start: iso(day(-20)), finish: iso(day(-8)), percent: 10 },
            { name: 'B sooner', start: iso(day(1)), finish: iso(day(2)), percent: 0 },
        ]),
    ]));
    assert.deepEqual(result.overdue.map((t) => t.taskName), ['B later', 'A late']);
    assert.deepEqual(result.upcoming.map((t) => t.taskName), ['B sooner', 'A soon']);
});

// ── countLookAheadTasksByStatus ─────────────────────────────────────────

test('status counts cover both lists and ignore unknown statuses', () => {
    const { countLookAheadTasksByStatus } = load();
    const counts = plain(countLookAheadTasksByStatus(
        [{ status: 'Task Overdue' }, { status: 'Task Overdue' }],
        [{ status: 'On Track' }, { status: 'Complete' }, { status: 'Weird' }],
    ));
    assert.deepEqual(counts, {
        'Task Overdue': 2, 'Behind Schedule': 0, 'On Track': 1,
        'Complete': 1, 'Not Started': 0, 'Ahead of Schedule': 0,
    });
});

// ── row markup ──────────────────────────────────────────────────────────

const overdueTask = {
    projectId: 'p<1>', projectName: 'Alpha & "Co"', taskName: 'Fix <it>',
    start: '2026-06-01', finish: '2026-06-08', percent: 25, status: 'Task Overdue',
    daysLate: 2, resources: '@kev, @sam', durationDays: 5,
};

test('overdue rows carry the data-* attributes the filter reads, escaped', () => {
    const { buildOverdueRows } = load();
    const html = buildOverdueRows([overdueTask]);
    assert.match(html, /^<np-task-row role="listitem" readonly class="portfolio-lookahead-row"/);
    assert.ok(html.includes('data-project="Alpha &amp; &quot;Co&quot;"'));
    assert.ok(html.includes('data-project-id="p&lt;1&gt;"'));
    assert.ok(html.includes('data-task-name="Fix &lt;it&gt;"'));
    assert.ok(html.includes('data-status="Task Overdue"'));
    assert.ok(html.includes(' rag="Task Overdue"'));
    assert.ok(html.includes(' percent="25"'));
    assert.ok(html.includes(' resources="kev, sam"'));
    assert.ok(html.includes('meta="Alpha &amp; &quot;Co&quot; · due 8 Jun 26 · 2 days late"'));
    assert.ok(html.endsWith('></np-task-row>'));
});

test('overdue rows say "1 day late" in the singular and fall back to the start date', () => {
    const { buildOverdueRows } = load();
    const html = buildOverdueRows([{ ...overdueTask, finish: null, daysLate: 1, resources: '-' }]);
    assert.ok(html.includes('due 1 Jun 26 · 1 day late"'));
    assert.ok(!html.includes(' resources='));
});

test('upcoming rows show the date range and duration, one row per task', () => {
    const { buildUpcomingRows } = load();
    const html = buildUpcomingRows([
        { ...overdueTask, status: 'Not Started', percent: 0 },
        { ...overdueTask, taskName: 'Same day', start: '2026-06-12', finish: '2026-06-12', durationDays: null },
    ]);
    const rows = html.split('</np-task-row>').filter(Boolean);
    assert.equal(rows.length, 2);
    assert.ok(rows[0].includes('meta="Alpha &amp; &quot;Co&quot; · 1 Jun 26 – 8 Jun 26 · 5d"'));
    assert.ok(rows[1].includes('meta="Alpha &amp; &quot;Co&quot; · 12 Jun 26"'));
    assert.ok(rows[0].includes(' percent="0"'));
});

test('the sort control names the section and its options', () => {
    const { lookAheadSortHtml } = load();
    const html = lookAheadSortHtml('overdue', [['finish', 'Due date'], ['daysLate:desc', 'Days late']]);
    assert.ok(html.includes('<label for="portfolioOverdueSort">Sort by</label>'));
    assert.ok(html.includes('onchange="sortPortfolioLookAhead(this.value, \'overdue\')"'));
    assert.ok(html.includes('<option value="daysLate:desc">Days late</option>'));
    assert.ok(lookAheadSortHtml('upcoming', []).includes('id="portfolioUpcomingSort"'));
});

test('sortPortfolioLookAhead reorders the stored list by the chosen key and direction', () => {
    const sandbox = load();
    const { collectLookAheadTasks, sortPortfolioLookAhead } = sandbox;
    sandbox.document = { getElementById: () => null, querySelectorAll: () => [] };
    sandbox.window.portfolioLookAheadData = collectLookAheadTasks([
        project('a', 'Zeta', [{ name: 'b', start: iso(day(-10)), finish: iso(day(-1)), percent: 10 }]),
        project('b', 'Alpha', [{ name: 'a', start: iso(day(-10)), finish: iso(day(-5)), percent: 20 }]),
    ]);
    sortPortfolioLookAhead('project', 'overdue');
    assert.deepEqual(plain(sandbox.window.portfolioLookAheadData.overdue.map((t) => t.projectName)), ['Alpha', 'Zeta']);
    sortPortfolioLookAhead('daysLate:desc', 'overdue');
    assert.deepEqual(plain(sandbox.window.portfolioLookAheadData.overdue.map((t) => t.daysLate)), [5, 1]);
    sortPortfolioLookAhead('percent', 'overdue');
    assert.deepEqual(plain(sandbox.window.portfolioLookAheadData.overdue.map((t) => t.percent)), [10, 20]);
});
