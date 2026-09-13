/**
 * schedule-check.js -- the Scheduling stage's "what breaks" report (#1054).
 *
 * analyse() is pure and DOM-free, so it is tested directly here; the
 * render() half is DOM-facing and covered by browser verification, the
 * same split test_plan_wizard.mjs, test_estimating.mjs and test_cards.mjs
 * already use.
 *
 * Every task object below is shaped exactly as /api/parse returns one
 * (plan_service.py's task payload): ISO date strings, percent as a string
 * or number, is_summary, loop_warning, circular_dependencies, depends.
 *
 * Run with: node --test tests/test_schedule_check.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const check = (await import('../packages/noodle-web/src/noodle_web/static/schedule-check.js')).default;

const TODAY = '2026-06-15';

function task(overrides) {
    return {
        id: 1, name: 'Task', key: 'Task', start: '2026-06-01', finish: '2026-06-10',
        duration_days: 8, resources: '', percent: '', rag: 'On Track', deadline: '',
        is_summary: false, depends: [], loop_warning: '', circular_dependencies: [],
        ...overrides,
    };
}

// ---- daysBetween / todayIso ----

test('daysBetween counts whole days between two ISO dates', () => {
    assert.equal(check.daysBetween('2026-06-01', '2026-06-10'), 9);
    assert.equal(check.daysBetween('2026-06-10', '2026-06-01'), -9);
    assert.equal(check.daysBetween('2026-06-10', '2026-06-10'), 0);
});

test('daysBetween is unaffected by a DST boundary between the dates', () => {
    // Europe/London springs forward on 2026-03-29; a local-time subtraction
    // would give 30.958... days here and round to 31.
    assert.equal(check.daysBetween('2026-03-01', '2026-04-01'), 31);
});

test('daysBetween rejects anything that is not a plain ISO date', () => {
    assert.equal(check.daysBetween('', '2026-06-10'), null);
    assert.equal(check.daysBetween('next Tuesday', '2026-06-10'), null);
    assert.equal(check.daysBetween('2026-06-01', undefined), null);
});

test('todayIso formats the given instant as a plain ISO date', () => {
    assert.equal(check.todayIso(new Date(2026, 5, 15, 23, 30)), '2026-06-15');
});

// ---- deadline breaches ----

test('a task scheduled to finish past its deadline is reported as missed', () => {
    const result = check.analyse([task({ name: 'Write report', finish: '2026-06-20', deadline: '2026-06-18' })], { today: TODAY });
    assert.equal(result.ok, false);
    assert.equal(result.issues.length, 1);
    assert.equal(result.issues[0].kind, 'deadline-missed');
    assert.equal(result.issues[0].task, 'Write report');
    assert.equal(result.issues[0].days, 2);
    assert.match(result.issues[0].message, /2 days past its deadline of 2026-06-18/);
});

test('a deadline already in the past on an incomplete task is reported as passed', () => {
    const result = check.analyse([task({ name: 'Sign off', finish: '2026-06-10', deadline: '2026-06-05', percent: 40 })], { today: TODAY });
    assert.equal(result.issues[0].kind, 'deadline-passed');
    assert.equal(result.issues[0].days, 10);
    assert.match(result.issues[0].message, /40% complete/);
});

test('passed takes precedence over missed, matching calculate_rag_status', () => {
    // Both conditions hold: deadline is in the past *and* finish is beyond
    // it. exporters.calculate_rag_status checks the same two in this order.
    const result = check.analyse([task({ finish: '2026-06-20', deadline: '2026-06-05' })], { today: TODAY });
    assert.equal(result.issues.length, 1);
    assert.equal(result.issues[0].kind, 'deadline-passed');
});

test('a completed task never breaches its deadline', () => {
    const result = check.analyse([task({ finish: '2026-06-20', deadline: '2026-06-01', percent: 100 })], { today: TODAY });
    assert.equal(result.ok, true);
    assert.equal(result.issues.length, 0);
});

test('a met deadline is not reported', () => {
    const result = check.analyse([task({ finish: '2026-06-10', deadline: '2026-06-30' })], { today: TODAY });
    assert.equal(result.ok, true);
    assert.match(result.summary, /the 1 deadline set is met/);
});

test('a deadline exactly on the finish date is met, not missed', () => {
    const result = check.analyse([task({ finish: '2026-06-20', deadline: '2026-06-20' })], { today: TODAY });
    assert.equal(result.ok, true);
});

test('a non-ISO deadline is ignored rather than mis-reported', () => {
    const result = check.analyse([task({ deadline: 'end of June', finish: '2026-06-20' })], { today: TODAY });
    assert.equal(result.ok, true);
    assert.equal(result.withDeadlines, 0);
});

test('a summary task with a missed deadline is still reported', () => {
    const result = check.analyse(
        [task({ name: 'Phase 1', is_summary: true, finish: '2026-06-25', deadline: '2026-06-20' })],
        { today: TODAY },
    );
    assert.equal(result.issues.length, 1);
    assert.equal(result.issues[0].kind, 'deadline-missed');
});

// ---- dependency conflicts ----

test('a scheduler loop warning is reported as a dependency conflict', () => {
    const result = check.analyse(
        [task({ name: 'Build', loop_warning: 'Build depends on its own parent Phase 1' })],
        { today: TODAY },
    );
    assert.equal(result.issues.length, 1);
    assert.equal(result.issues[0].kind, 'dependency-conflict');
    assert.equal(result.issues[0].message, 'Build depends on its own parent Phase 1');
});

test('circular dependencies are reported even without a loop warning string', () => {
    const result = check.analyse([task({ name: 'A', circular_dependencies: ['B', 'C'] })], { today: TODAY });
    assert.equal(result.issues[0].kind, 'dependency-conflict');
    assert.match(result.issues[0].message, /B, C/);
});

test('a task can break in two ways at once and both are reported', () => {
    const result = check.analyse(
        [task({ name: 'Both', finish: '2026-06-25', deadline: '2026-06-20', loop_warning: 'Cycle' })],
        { today: TODAY },
    );
    assert.deepEqual(result.issues.map(i => i.kind), ['deadline-missed', 'dependency-conflict']);
});

// ---- unplaceable tasks ----

test('a task with a deadline but no dates is reported as unscheduled', () => {
    const result = check.analyse([task({ name: 'Vague', start: '', finish: '', deadline: '2026-07-01' })], { today: TODAY });
    assert.equal(result.issues.length, 1);
    assert.equal(result.issues[0].kind, 'unscheduled');
    assert.match(result.issues[0].message, /deadline but no scheduled dates/);
});

test('a dependent task with no dates is reported as unscheduled', () => {
    const result = check.analyse([task({ name: 'Later', start: '', finish: '', depends: ['Earlier'] })], { today: TODAY });
    assert.equal(result.issues[0].kind, 'unscheduled');
    assert.match(result.issues[0].message, /dependencies but no scheduled dates/);
});

test('an undated task with nothing riding on it is left alone', () => {
    // Half-written plans are normal -- an undated task only "breaks"
    // once a deadline or a dependency depends on where it lands.
    const result = check.analyse([task({ start: '', finish: '' })], { today: TODAY });
    assert.equal(result.ok, true);
});

test('an undated summary task is never reported', () => {
    const result = check.analyse(
        [task({ is_summary: true, start: '', finish: '', depends: ['X'] })],
        { today: TODAY },
    );
    assert.equal(result.ok, true);
});

// ---- ordering, counts and summary ----

test('breaches sort ahead of conflicts, which sort ahead of gaps', () => {
    const result = check.analyse([
        task({ name: 'Gap', start: '', finish: '', deadline: '2026-07-01' }),
        task({ name: 'Conflict', loop_warning: 'Cycle' }),
        task({ name: 'Breach', finish: '2026-06-30', deadline: '2026-06-20' }),
    ], { today: TODAY });
    assert.deepEqual(result.issues.map(i => i.severity), ['breach', 'conflict', 'gap']);
});

test('the worst slip is listed first among breaches', () => {
    const result = check.analyse([
        task({ name: 'Small', finish: '2026-06-21', deadline: '2026-06-20' }),
        task({ name: 'Big', finish: '2026-07-20', deadline: '2026-06-20' }),
    ], { today: TODAY });
    assert.deepEqual(result.issues.map(i => i.task), ['Big', 'Small']);
});

test('counts are broken down by kind', () => {
    const result = check.analyse([
        task({ name: 'A', finish: '2026-06-30', deadline: '2026-06-20' }),
        task({ name: 'B', finish: '2026-06-30', deadline: '2026-06-25' }),
        task({ name: 'C', loop_warning: 'Cycle' }),
    ], { today: TODAY });
    assert.deepEqual(result.counts, { 'deadline-missed': 2, 'dependency-conflict': 1 });
});

test('the summary distinguishes a clean plan with and without deadlines', () => {
    assert.match(check.analyse([task({})], { today: TODAY }).summary, /No deadlines set yet/);
    assert.match(
        check.analyse([task({ deadline: '2026-12-01' })], { today: TODAY }).summary,
        /the 1 deadline set is met/,
    );
    assert.match(
        check.analyse([task({ deadline: '2026-12-01' }), task({ deadline: '2026-12-02' })], { today: TODAY }).summary,
        /all 2 deadlines are met/,
    );
});

test('the summary counts breaches and other problems separately', () => {
    const result = check.analyse([
        task({ name: 'A', finish: '2026-06-30', deadline: '2026-06-20' }),
        task({ name: 'C', loop_warning: 'Cycle' }),
    ], { today: TODAY });
    assert.equal(result.summary, '1 deadline missed, and 1 other problem in the schedule.');
});

test('an empty plan says so rather than claiming everything is fine', () => {
    const result = check.analyse([], { today: TODAY });
    assert.equal(result.ok, true);
    assert.match(result.summary, /No plan loaded yet/);
});

test('analyse tolerates junk input instead of throwing', () => {
    assert.equal(check.analyse(null).taskCount, 0);
    assert.equal(check.analyse(undefined).taskCount, 0);
    assert.equal(check.analyse([null, undefined]).issues.length, 0);
});

test('analyse never mutates the tasks it is handed', () => {
    const tasks = [task({ name: 'A', finish: '2026-06-30', deadline: '2026-06-20' })];
    const before = JSON.stringify(tasks);
    check.analyse(tasks, { today: TODAY });
    assert.equal(JSON.stringify(tasks), before);
});

test('the report scales to a 500-task plan without noticeable cost', () => {
    const tasks = Array.from({ length: 500 }, (_, i) => task({
        name: `Task ${i}`, finish: '2026-06-30', deadline: i % 10 === 0 ? '2026-06-20' : '2026-12-31',
    }));
    const started = Date.now();
    const result = check.analyse(tasks, { today: TODAY });
    assert.equal(result.issues.length, 50);
    assert.ok(Date.now() - started < 100, 'analyse should stay well under a frame budget');
});
