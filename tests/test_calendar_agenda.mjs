/**
 * The calendar's agenda on a phone (#1387, epic #1376): static/calendar-agenda.js
 * turns the calendar's tasks into what is on today and what starts or is due
 * on each of the next seven days.
 *
 * It is a classic script; agenda() is pure and runs here in a vm sandbox. The
 * agenda on the page, and its Agenda / Month switch, are covered by the
 * browser suite (tests/ui/test_phone_views.py).
 *
 * Run with: node --test tests/test_calendar_agenda.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(
    path.join(here, '..', 'packages/noodle-web/src/noodle_web/static/calendar-agenda.js'), 'utf8');

function load() {
    const sandbox = { console };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    return sandbox.NoodleCalendarAgenda;
}

const { agenda: sandboxed } = load();
// The sandbox's arrays are another realm's; compare plain copies.
const agenda = (tasks, today) => JSON.parse(JSON.stringify(sandboxed(tasks, today)));
const TODAY = new Date(2026, 2, 10); // Tuesday 10 March 2026, local time

const task = (name, start, finish, extra = {}) => ({ name, start, finish, ...extra });

test('what is on today: due, starting, and in progress, in that order', () => {
    const { today } = agenda([
        task('Running', '2026-03-02', '2026-03-20'),
        task('Starts today', '2026-03-10', '2026-03-12'),
        task('Due today', '2026-03-05', '2026-03-10'),
        task('Finished', '2026-03-01', '2026-03-09'),
        task('Later', '2026-03-11', '2026-03-14'),
    ], TODAY);
    assert.deepEqual(today.map((i) => [i.task.name, i.kind]), [
        ['Due today', 'due'],
        ['Starts today', 'starts'],
        ['Running', 'on'],
    ]);
});

test('a one-day task on today is due, not starting', () => {
    const { today } = agenda([task('Launch', '2026-03-10', '2026-03-10')], TODAY);
    assert.deepEqual(today.map((i) => i.kind), ['due']);
});

test('the next seven days list what starts or is due, and leave out a quiet day', () => {
    const { days } = agenda([
        task('Tomorrow start', '2026-03-11', '2026-03-20'),
        task('Due Friday', '2026-03-02', '2026-03-13'),
        task('Starts Friday', '2026-03-13', '2026-03-30'),
        task('Next Tuesday', '2026-03-17', '2026-03-18'),
        task('Too far', '2026-03-18', '2026-03-19'),
    ], TODAY);
    assert.deepEqual(days.map((d) => d.date), ['2026-03-11', '2026-03-13', '2026-03-17']);
    assert.deepEqual(days[1].items.map((i) => [i.task.name, i.kind]), [
        ['Due Friday', 'due'],
        ['Starts Friday', 'starts'],
    ]);
    assert.deepEqual(days[2].items.map((i) => [i.task.name, i.kind]), [['Next Tuesday', 'starts']]);
});

test('a task that starts and finishes on the same later day is listed once, as due', () => {
    const { days } = agenda([task('Review', '2026-03-12', '2026-03-12')], TODAY);
    assert.equal(days.length, 1);
    assert.deepEqual(days[0].items.map((i) => i.kind), ['due']);
});

test('datetimes are read by their date, and a task without dates is skipped', () => {
    const { today, days } = agenda([
        task('Timed', '2026-03-10T09:00:00', '2026-03-11T17:00:00'),
        task('No dates', '', ''),
        { name: 'Missing' },
    ], TODAY);
    assert.deepEqual(today.map((i) => [i.task.name, i.kind]), [['Timed', 'starts']]);
    assert.deepEqual(days.map((d) => [d.date, d.items.map((i) => i.kind)]), [['2026-03-11', ['due']]]);
});

test('no tasks is an empty agenda', () => {
    assert.deepEqual(agenda([], TODAY), { today: [], days: [] });
    assert.deepEqual(agenda(null, TODAY), { today: [], days: [] });
});
