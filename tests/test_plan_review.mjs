/**
 * The Analysis view's plan review (#782): the pure filtering and grouping
 * in plan-review.js, and the browser engine's handling of long-form
 * durations that the review's template audit uncovered.
 *
 * Run with: node --test tests/test_plan_review.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import PlanReview from '../packages/noodle-web/src/noodle_web/static/plan-review.js';
import { localParse, normaliseDurationWords } from '../packages/noodle-web/src/noodle_web/static/engine/local-parse.js';

const findings = [
    { id: 'a', check: 'dangling-dependency', severity: 'error', title: 'Dependency on a missing task', message: "'Build' depends on 'Desing'", task: 'Build' },
    { id: 'b', check: 'no-duration', severity: 'warning', title: 'No duration', message: "'Test' has no duration", task: 'Test' },
    { id: 'c', check: 'no-raid', severity: 'suggestion', title: 'No RAID log', message: 'No RAID entries', task: null },
    { id: 'd', check: 'over-allocation', severity: 'warning', title: 'Resource over-allocated', message: 'Alex is booked twice', task: null },
];

test('filterFindings by severity', () => {
    assert.deepEqual(PlanReview.filterFindings(findings, { severity: 'warning' }).map(f => f.id), ['b', 'd']);
    assert.equal(PlanReview.filterFindings(findings, { severity: 'all' }).length, 4);
    assert.equal(PlanReview.filterFindings(findings, {}).length, 4);
});

test('filterFindings by text matches title, message, task and check id', () => {
    assert.deepEqual(PlanReview.filterFindings(findings, { query: 'build' }).map(f => f.id), ['a']);
    assert.deepEqual(PlanReview.filterFindings(findings, { query: 'RAID' }).map(f => f.id), ['c']);
    assert.deepEqual(PlanReview.filterFindings(findings, { query: 'over-allocation' }).map(f => f.id), ['d']);
    assert.deepEqual(PlanReview.filterFindings(findings, { query: 'alex', severity: 'error' }), []);
});

test('groupFindings orders error, warning, suggestion and drops empty groups', () => {
    const groups = PlanReview.groupFindings([findings[2], findings[1], findings[3]]);
    assert.deepEqual(groups.map(g => g.severity), ['warning', 'suggestion']);
    assert.deepEqual(groups[0].findings.map(f => f.id), ['b', 'd']);
});

test('the browser engine reads long-form durations as the server does', () => {
    assert.equal(normaliseDurationWords('A 5days\nB 2weeks\nC 1month\nD 1day'), 'A 5d\nB 2w\nC 1m\nD 1d');
    const tasks = localParse('---\ntitle: x\n---\n\nP\n  A 5days 2026-01-05\n  B 2weeks [depends A]\n').tasks;
    const a = tasks.find(t => t.name === 'A');
    const b = tasks.find(t => t.name === 'B');
    assert.equal(a.duration_days, 5);
    assert.equal(b.duration_days, 14);
    assert.equal(b.start, '2026-01-12');
});

test('currentLine follows a task that moved since the review', () => {
    const finding = { line: 3, task: 'Build' };
    PlanReview._state.reviewedText = 'a\nb\nBuild\n';
    assert.equal(PlanReview.currentLine(finding, 'a\nb\nBuild\n'), 3);
    assert.equal(PlanReview.currentLine(finding, 'a\nrag: red\nb\nBuild\n'), 4);
    assert.equal(PlanReview.currentLine({ line: 3, task: null }, 'x\ny\nz\nw\n'), 3);
});
