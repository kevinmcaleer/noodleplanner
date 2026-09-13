/**
 * #783's headline acceptance criterion, end to end:
 *
 *   "A first-time user can produce a valid, schedulable 20-task plan
 *    without ever seeing Markdown syntax."
 *
 * Every other test in this epic covers one surface in isolation. This one
 * covers the claim the epic is actually judged on, by building a real
 * 20-task plan the way a first-time user would and then scheduling it:
 *
 *  1. Tasks are typed into the notepad list surface (#1049) as plain
 *     prose -- "Kick-off workshop", not "Kick-off workshop 2d" -- with
 *     Enter to commit a line and Tab/Shift+Tab to build the outline. The
 *     surface is driven through the same DOM stub test_notepad_surface.mjs
 *     uses, so the keystrokes go through notepad.js's real handlers.
 *  2. Durations come from the three-point estimating popup (#1053) via
 *     EstimatingTool.applyEstimate() -- the PERT maths writes the duration
 *     token, the user never types one.
 *  3. A deadline is set the way the task form's #taskDeadline field writes
 *     one (#877), and the Scheduling stage's report (#1054) is run over
 *     the result to show what breaks.
 *  4. The finished document is scheduled with the browser's own scheduler
 *     (engine/scheduler.js) and every task must come out with real dates.
 *
 * The "without ever seeing Markdown syntax" half is not just narrative:
 * the test asserts that no input handed to the surface ever contains a
 * duration, resource, tag, dependency or deadline token, so the plan's
 * syntax can only have come from the tools, never from the typing.
 *
 * The same finished plan is checked against the *server* scheduler in
 * tests/test_first_time_plan.py, through the fixture both files share
 * (tests/fixtures/first_time_plan.md), so a divergence between the two
 * schedulers on this plan fails one of the two.
 *
 * Run with: node --test tests/test_first_time_plan.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

import { buildSurface, keydown } from './helpers/notepad_dom_stub.mjs';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const staticDir = join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'static');

// estimating.js reads TaskLineTokenizer and NoodlePlanModel off the global
// the page gives it; test_estimating.mjs sets them up the same way.
function loadTokenizer() {
    const sandbox = {};
    vm.createContext(sandbox);
    vm.runInContext(
        readFileSync(join(staticDir, 'task-tokenizer.js'), 'utf8')
        + '\nthis.TaskLineTokenizer = TaskLineTokenizer;',
        sandbox,
    );
    return sandbox.TaskLineTokenizer;
}
globalThis.TaskLineTokenizer = loadTokenizer();
globalThis.NoodlePlanModel = (await import(join(staticDir, 'plan-model.js'))).default;

const estimating = (await import(join(staticDir, 'estimating.js'))).default;
const scheduleCheck = (await import(join(staticDir, 'schedule-check.js'))).default;
const { scheduleTasksFromText } = await import(join(staticDir, 'engine', 'scheduler.js'));
// planBody() strips front matter and back matter; the scheduler takes the
// task outline alone, exactly as test_engine_conformance.mjs feeds it.
const { planBody } = await import(join(staticDir, 'engine', 'local-parse.js'));

/**
 * What a first-time planner types: four phases, sixteen tasks under them.
 * Plain prose only -- no durations, no @resources, no #tags, no
 * [depends], no dates. `indent` is how many Tabs to press before
 * committing the line, relative to the top level.
 */
const TYPED_PLAN = [
    { text: 'Discovery', indent: 0 },
    { text: 'Kick-off workshop', indent: 1 },
    { text: 'Interview the team', indent: 1 },
    { text: 'Write up what we found', indent: 1 },
    { text: 'Agree the scope', indent: 1 },
    { text: 'Design', indent: 0 },
    { text: 'Draft the approach', indent: 1 },
    { text: 'Review with stakeholders', indent: 1 },
    { text: 'Revise the approach', indent: 1 },
    { text: 'Sign off the design', indent: 1 },
    { text: 'Build', indent: 0 },
    { text: 'Set up the environment', indent: 1 },
    { text: 'Build the first slice', indent: 1 },
    { text: 'Build the rest', indent: 1 },
    { text: 'Internal demo', indent: 1 },
    { text: 'Launch', indent: 0 },
    { text: 'User testing', indent: 1 },
    { text: 'Fix what testing found', indent: 1 },
    { text: 'Train the users', indent: 1 },
    { text: 'Go live', indent: 1 },
];

/** Syntax a first-time user is not supposed to have to type. */
const MARKDOWN_TOKENS = [
    /\b\d+\s*(d|day|days|w|week|weeks|h|hour|hours|m|mo|month|months)\b/i, // durations
    /@\w/,            // resources
    /#\w/,            // tags
    /\[depends/i,     // dependencies
    /\bD\d{4}-\d{2}-\d{2}\b/, // deadline markers
    /\d{4}-\d{2}-\d{2}/,      // any explicit date
    /^\s*-\s/,        // list bullets
    /---/,            // front/back matter fences
];

/** String.replace, but loudly wrong if the text it expected has moved. */
function replaceOnce(text, from, to) {
    assert.ok(text.includes(from), `fixture no longer contains "${from}"`);
    return text.replace(from, to);
}

function assertNoMarkdown(value, what) {
    for (const token of MARKDOWN_TOKENS) {
        assert.ok(!token.test(value), `${what} should contain no Markdown syntax, got: ${value}`);
    }
}

/**
 * Estimate every leaf task through the popup's own maths: optimistic 1,
 * most likely 3, pessimistic 8 -> (1 + 12 + 8) / 6 = 3.5 days, which
 * daysToDurationText() rounds to the whole day the plan syntax carries.
 */
function estimateEveryTask(planText) {
    let text = planText;
    for (const line of TYPED_PLAN.filter(entry => entry.indent === 1)) {
        text = estimating.applyEstimate(text, line.text, {
            mode: 'duration', optimistic: 1, mostLikely: 3, pessimistic: 8,
        }).text;
    }
    return text;
}

/** Type the whole plan into a fresh notepad surface and return the text. */
function typeThePlan() {
    const { flushRAF, getText, inputs } = buildSurface('');
    let currentIndent = 0;

    for (const line of TYPED_PLAN) {
        assertNoMarkdown(line.text, 'typed task name');

        let draft = inputs()[inputs().length - 1];
        draft.value = line.text;

        // Tab indents, Shift+Tab outdents -- exactly the two keys the
        // issue names. Each keypress re-renders the row, so the draft is
        // re-queried after every dispatch, as a real browser would.
        while (currentIndent < line.indent) {
            draft.dispatchEvent(keydown('Tab'));
            draft = inputs()[inputs().length - 1];
            currentIndent += 1;
        }
        while (currentIndent > line.indent) {
            draft.dispatchEvent(keydown('Tab', { shiftKey: true }));
            draft = inputs()[inputs().length - 1];
            currentIndent -= 1;
        }

        assert.equal(draft.value, line.text, `Tab must not lose "${line.text}"`);
        draft.dispatchEvent(keydown('Enter'));
        flushRAF();
    }

    return getText();
}

test('typing twenty plain lines into the notepad builds a twenty-task outline', () => {
    const planText = typeThePlan();
    const lines = planText.split('\n').filter(line => line.trim());
    assert.equal(lines.length, 20);
    assert.equal(lines.filter(line => !line.startsWith(' ')).length, 4, 'four phases at the top level');
    assert.equal(lines.filter(line => line.startsWith('  ')).length, 16, 'sixteen tasks nested under them');
    // Nothing the user typed was syntax, so nothing in the document is yet.
    assertNoMarkdown(planText, 'the plan the notepad produced');
});

test('three-point estimating puts durations on every task without typing one', () => {
    // What the estimating popup does with optimistic/most likely/
    // pessimistic: (O + 4M + P) / 6, written back as a duration token.
    const planText = estimateEveryTask(typeThePlan());

    const leafLines = planText.split('\n').filter(line => line.startsWith('  ') && line.trim());
    assert.equal(leafLines.length, 16);
    for (const line of leafLines) {
        assert.match(line, /\b\d+(\.\d+)?d\b/, `estimating should have written a duration: ${line}`);
    }
    // (1 + 12 + 8) / 6 = 3.5 days, rounded to 4d by daysToDurationText.
    // The three raw inputs are kept verbatim in the ---estimates---
    // section, so reopening the popup still shows 1 / 3 / 8.
    assert.match(leafLines[0], /\b4d\b/);
    assert.match(planText, /\| Kick-off workshop\s+\| 1\s+\| 3\s+\| 8\s+\| duration/);
});

test('the finished plan schedules: every task comes out with real dates', () => {
    const planText = `---\ntitle: My first plan\n---\n${estimateEveryTask(typeThePlan())}`;

    const scheduled = scheduleTasksFromText(planBody(planText));
    const tasks = scheduled.tasks || scheduled;
    assert.equal(tasks.length, 20, 'all twenty tasks survive scheduling');
    for (const task of tasks) {
        assert.match(task.start, /^\d{4}-\d{2}-\d{2}$/, `${task.name} should have a start date`);
        assert.match(task.finish, /^\d{4}-\d{2}-\d{2}$/, `${task.name} should have a finish date`);
    }
});

test('the committed fixture is exactly what this flow produces', () => {
    // test_first_time_plan.py schedules the same file with the *server*
    // scheduler. Regenerating one without the other would let the two
    // drift apart silently, so the fixture is asserted here rather than
    // written out.
    const planText = estimateEveryTask(typeThePlan());
    const fixture = readFileSync(join(repo, 'tests', 'fixtures', 'first_time_plan.md'), 'utf8');
    assert.equal(`---\ntitle: My first plan\n---\n${planText}`, fixture);
});

/**
 * Schedule the fixture with `Go live` carrying a deadline `offsetDays`
 * from that task's own scheduled finish. Nothing here is pinned to a
 * wall-clock date: the plan has no explicit start, so it schedules from
 * today, and a hard-coded deadline would mean something different every
 * time the suite ran.
 */
function scheduleWithGoLiveDeadline(offsetDays) {
    const fixture = readFileSync(join(repo, 'tests', 'fixtures', 'first_time_plan.md'), 'utf8');
    const baseline = scheduleTasksFromText(planBody(fixture));
    const finish = baseline.find(task => task.name === 'Go live').finish;
    const deadline = new Date(`${finish}T00:00:00Z`);
    deadline.setUTCDate(deadline.getUTCDate() + offsetDays);
    const deadlineIso = deadline.toISOString().slice(0, 10);

    const withDeadline = replaceOnce(fixture, '  Go live 4d', `  Go live 4d D${deadlineIso}`);
    return { tasks: scheduleTasksFromText(planBody(withDeadline)), deadlineIso, finish };
}

test('a deadline the plan cannot meet is reported by the Scheduling stage', () => {
    // The last stage of the flow: the user sets a hard deadline on a task
    // (the task form writes `D2026-01-20`, #877) and the wizard's
    // Scheduling stage says what breaks (#1054). Two days before the task
    // can possibly finish, so the plan genuinely misses it.
    const { tasks, deadlineIso } = scheduleWithGoLiveDeadline(-2);
    const goLive = tasks.find(task => task.name === 'Go live');
    assert.equal(goLive.deadline, deadlineIso);
    assert.ok(goLive.finish > deadlineIso, 'this plan genuinely cannot hit that deadline');

    // "today" pinned to the plan's own first day, so this reads as a
    // missed deadline rather than one that has already passed.
    const report = scheduleCheck.analyse(tasks, { today: tasks[0].start });
    assert.equal(report.ok, false);
    const issue = report.issues.find(entry => entry.task === 'Go live');
    assert.equal(issue.kind, 'deadline-missed');
    assert.match(issue.message, new RegExp(`past its deadline of ${deadlineIso}`));
    assert.match(report.summary, /1 deadline missed/);
});

test('the same plan with an achievable deadline reports nothing broken', () => {
    const { tasks } = scheduleWithGoLiveDeadline(30);
    const report = scheduleCheck.analyse(tasks, { today: tasks[0].start });
    assert.equal(report.ok, true, JSON.stringify(report.issues));
});
