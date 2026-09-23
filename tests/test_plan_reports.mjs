/**
 * Tasks by Assignment and Slippage (#776): the report logic in
 * plan-reports.js, run against tasks scheduled by the real browser engine,
 * plus the view's wiring (ribbon, PLAN_VIEWS, OUTPUT_VIEWS, updaters, markup).
 *
 * Run with: node --test tests/test_plan_reports.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import PlanReports from '../packages/noodle-web/src/noodle_web/static/plan-reports.js';
import { localParse, projectWorkingDay } from '../packages/noodle-web/src/noodle_web/static/engine/local-parse.js';
import { TABS } from '../packages/noodle-web/src/noodle_web/static/ribbon-ia.js';

const R = PlanReports;
const STATIC = new URL('../packages/noodle-web/src/noodle_web/static/', import.meta.url);
const TEMPLATES = new URL('../packages/noodle-web/src/noodle_web/templates/', import.meta.url);

const PLAN = `---
title: Reports
Resources:
- @alex: Alex Chen, Developer
- @sam: Sam Lee, Designer
non-working-days:
  - 2026-03-18
---

Design
  Wireframes @sam 3d 2026-03-02 100%
  Review @alex @sam 1d [depends Wireframes]
Build
  API @alex[50%] 5d [depends Review]
  Docs 2d [depends Review]
  Launch 0d [depends API, Docs]
`;

function schedule(text = PLAN) {
    const result = localParse(text);
    return { tasks: result.tasks, resourceMap: result.resource_map };
}

// ----- tasks by assignment --------------------------------------------------

test('a task with several people appears under each, marked shared', () => {
    const { tasks, resourceMap } = schedule();
    const groups = R.tasksByAssignment(tasks, { today: '2026-03-10', resourceMap });
    const alex = groups.find(g => g.name === 'Alex Chen');
    const sam = groups.find(g => g.name === 'Sam Lee');
    const review = g => g.tasks.find(row => row.task.name === 'Review');
    assert.ok(review(alex) && review(sam));
    assert.equal(review(alex).shared, true);
    assert.deepEqual(review(alex).sharedWith, ['Sam Lee']);
    assert.equal(sam.tasks.find(row => row.task.name === 'Wireframes').shared, false);
});

test('shortnames and full names are one person, and shares count toward work', () => {
    const { tasks, resourceMap } = schedule();
    const groups = R.tasksByAssignment(tasks, { today: '2026-03-10', resourceMap });
    assert.equal(groups.filter(g => g.name === 'Alex Chen').length, 1);
    const alex = groups.find(g => g.name === 'Alex Chen');
    assert.equal(alex.tasks.find(row => row.task.name === 'API').share, 0.5);
    // Review 1d + half of API's 5d
    assert.equal(alex.totals.workDays, 3.5);
});

test('unassigned tasks get their own group, first', () => {
    const { tasks, resourceMap } = schedule();
    const groups = R.tasksByAssignment(tasks, { today: '2026-03-10', resourceMap });
    assert.equal(groups[0].unassigned, true);
    assert.deepEqual(groups[0].tasks.map(r => r.task.name), ['Docs', 'Launch']);
    // still first when sorted by anything else
    assert.equal(R.sortAssignments(groups, 'tasks')[0].unassigned, true);
});

test('totals: open/complete split, next due and overdue', () => {
    const { tasks, resourceMap } = schedule();
    // Wireframes Mon 2 - Wed 4 March (done); Review is Thu 5 March
    const sam = R.tasksByAssignment(tasks, { today: '2026-03-04', resourceMap }).find(g => g.name === 'Sam Lee');
    assert.equal(sam.totals.tasks, 2);
    assert.equal(sam.totals.complete, 1);          // Wireframes 100%
    assert.equal(sam.totals.open, 1);
    assert.equal(sam.totals.nextDue, '2026-03-05');
    assert.equal(sam.totals.overdue, 0);
    const later = R.tasksByAssignment(tasks, { today: '2026-04-01', resourceMap }).find(g => g.name === 'Sam Lee');
    assert.equal(later.totals.overdue, 1);          // Review, not done
    assert.equal(later.tasks.find(r => r.task.name === 'Review').status, 'overdue');
});

test('filters: person, phase, status and date range; totals follow', () => {
    const { tasks, resourceMap } = schedule();
    const groups = R.tasksByAssignment(tasks, { today: '2026-03-10', resourceMap });
    const alexKey = R.resourceKey('Alex Chen');
    assert.deepEqual(R.filterAssignments(groups, { person: alexKey }, '2026-03-10').map(g => g.name), ['Alex Chen']);
    const build = R.filterAssignments(groups, { phase: 'Build' }, '2026-03-10');
    assert.ok(build.every(g => g.tasks.every(r => r.task.phase === 'Build')));
    const done = R.filterAssignments(groups, { status: 'complete' }, '2026-03-10');
    assert.deepEqual(done.map(g => g.name), ['Sam Lee']);
    assert.equal(done[0].totals.tasks, 1);
    const early = R.filterAssignments(groups, { to: '2026-03-04' }, '2026-03-10');
    assert.deepEqual(early.flatMap(g => g.tasks.map(r => r.task.name)), ['Wireframes']);
});

// ----- slippage ----------------------------------------------------------------

function baselineOf(tasks) {
    return tasks.filter(t => t.start && t.finish).map(t => ({
        name: t.name, start: t.start, finish: t.finish, duration: `${t.duration_days}d`,
    }));
}

test('an unchanged plan is on track everywhere', () => {
    const { tasks } = schedule();
    const report = R.slippageReport(tasks, baselineOf(tasks));
    assert.equal(report.counts.slipped, 0);
    assert.equal(report.project.variance, 0);
    assert.ok(report.rows.every(r => r.status === 'on-track'));
});

test('variance is in working days and honours non-working days', () => {
    const { tasks } = schedule();
    const baseline = baselineOf(tasks);
    // Wireframes grows 3d -> 5d: its finish moves Thu 5 -> Mon 9 March,
    // two working days (the weekend is not counted)
    const slipped = schedule(PLAN.replace('Wireframes @sam 3d', 'Wireframes @sam 5d')).tasks;
    const isWorkingDay = projectWorkingDay(PLAN);
    const report = R.slippageReport(slipped, baseline, { isWorkingDay });
    const wf = report.rows.find(r => r.name === 'Wireframes');
    assert.equal(wf.finishVariance, 2);
    assert.equal(wf.status, 'slipped');
});

test('a finish that moves across a holiday does not count the holiday', () => {
    const { tasks } = schedule();
    const baseline = baselineOf(tasks);
    // API grows 5d -> 9d: its finish moves from Fri 13 to Fri 20 March,
    // across the weekend and the Wed 18 holiday: 13, 16, 17, 19 = 4 working days
    const longer = schedule(PLAN.replace('API @alex[50%] 5d', 'API @alex[50%] 9d')).tasks;
    const api = R.slippageReport(longer, baseline, { isWorkingDay: projectWorkingDay(PLAN) })
        .rows.find(r => r.name === 'API');
    assert.equal(api.baselineFinish, '2026-03-13');
    assert.equal(api.finish, '2026-03-20');
    assert.equal(api.finishVariance, 4);
    // counted Monday-Friday only, the holiday would be a fifth day
    const naive = R.slippageReport(longer, baseline).rows.find(r => r.name === 'API');
    assert.equal(naive.finishVariance, 5);
});

test('workingDaysBetween is signed and skips non-working days', () => {
    const mon = R.dayOf('2026-03-16'), fri = R.dayOf('2026-03-20'), nextMon = R.dayOf('2026-03-23');
    assert.equal(R.workingDaysBetween(mon, fri), 4);
    assert.equal(R.workingDaysBetween(fri, mon), -4);
    assert.equal(R.workingDaysBetween(fri, nextMon), 1);          // over a weekend
    const holiday = R.dayOf('2026-03-18');
    assert.equal(R.workingDaysBetween(mon, fri, d => R.weekday(d) && d !== holiday), 3);
});

test('tasks added and removed since the baseline', () => {
    const { tasks } = schedule();
    const baseline = baselineOf(tasks).concat([{ name: 'Old task', start: '2026-03-02', finish: '2026-03-03', duration: '1d' }]);
    const grown = schedule(PLAN.replace('  Launch 0d', '  Training @sam 2d [depends Review]\n  Launch 0d')).tasks;
    const report = R.slippageReport(grown, baseline);
    assert.deepEqual(report.added.map(t => t.name), ['Training']);
    assert.deepEqual(report.removed.map(b => b.name), ['Old task']);
    assert.equal(report.counts.added, 1);
    assert.equal(report.counts.removed, 1);
});

test('duplicate names are matched occurrence by occurrence', () => {
    const tasks = [
        { name: 'Review', start: '2026-03-02', finish: '2026-03-03', duration_days: 1 },
        { name: 'Review', start: '2026-03-09', finish: '2026-03-11', duration_days: 2 },
    ];
    const baseline = [
        { name: 'Review', start: '2026-03-02', finish: '2026-03-03' },
        { name: 'Review', start: '2026-03-09', finish: '2026-03-10' },
    ];
    const report = R.slippageReport(tasks, baseline);
    assert.deepEqual(report.rows.map(r => r.finishVariance).sort(), [0, 1]);
    assert.equal(report.removed.length, 0);
});

test('rows sort by variance, phases roll up, critical slips are singled out', () => {
    const { tasks } = schedule();
    const baseline = baselineOf(tasks);
    const later = schedule(PLAN.replace('API @alex[50%] 5d', 'API @alex[50%] 8d')).tasks;
    const report = R.slippageReport(later, baseline);
    const variances = report.rows.map(r => r.finishVariance);
    assert.deepEqual(variances, [...variances].sort((a, b) => b - a));
    const build = report.phases.find(p => p.name === 'Build');
    assert.equal(build.status, 'slipped');
    assert.ok(build.slippedTasks >= 1);
    assert.equal(build.worstSlip, 3);
    assert.equal(report.phases.find(p => p.name === 'Design').slippedTasks, 0);
    assert.ok(report.critical.some(r => r.name === 'API'));
    assert.equal(report.project.variance, 3);
    assert.equal(report.project.status, 'slipped');
});

test('pulled forward', () => {
    const { tasks } = schedule();
    const earlier = schedule(PLAN.replace('API @alex[50%] 5d', 'API @alex[50%] 3d')).tasks;
    const report = R.slippageReport(earlier, baselineOf(tasks));
    assert.equal(report.rows.find(r => r.name === 'API').status, 'pulled-forward');
    assert.equal(report.project.status, 'pulled-forward');
});

// ----- wiring ----------------------------------------------------------------

test('both reports are registered views with ribbon and nav entries', () => {
    const state = readFileSync(new URL('state.js', STATIC), 'utf8');
    const planViews = /const PLAN_VIEWS = \[([^\]]*)\]/.exec(state)[1];
    assert.match(planViews, /'assignments'/);
    assert.match(planViews, /'slippage'/);

    const script = readFileSync(new URL('script.js', STATIC), 'utf8');
    assert.match(script, /'assignments': 'planTab'/);
    assert.match(script, /'slippage': 'planTab'/);
    assert.match(script, /name: 'assignments',\s+fn: \(\) => updateAssignmentsView\(result, planText\)/);
    assert.match(script, /name: 'slippage',\s+fn: \(\) => updateSlippageView\(result, planText\)/);

    const ribbon = readFileSync(new URL('ribbon.js', STATIC), 'utf8');
    assert.match(ribbon, /'By Assignment': 'assignments'/);
    assert.match(ribbon, /Slippage: 'slippage'/);
    const reports = TABS.find(t => t.id === 'report').groups.find(g => g.name === 'Reports');
    const labels = reports.cols.flat().map(([, label]) => label);
    assert.ok(labels.includes('By Assignment') && labels.includes('Slippage'));

    const html = readFileSync(new URL('index.html', TEMPLATES), 'utf8');
    for (const id of ['assignments-view', 'slippage-view', 'assignmentsGroups', 'slippageReport', 'slippageEmpty']) {
        assert.ok(html.includes(`id="${id}"`), id);
    }
    assert.match(html, /data-view="assignments"/);
    assert.match(html, /data-view="slippage"/);
    assert.match(html, /\/static\/plan-reports\.js/);
    assert.match(html, /\/static\/views-reports\.js/);
});
