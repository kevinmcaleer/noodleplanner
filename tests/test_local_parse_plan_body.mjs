// Regression tests for local-parse.js's planBody().
//
// A bare `---` divider line -- the visual lead-in to a back-matter section,
// or a hand-typed separator with nothing after it -- was never stripped from
// the plan body the local (browser) scheduling engine parses. Since the
// local engine is on by default, this meant `---` was silently scheduled as
// a phantom task everywhere the local engine runs: the Gantt/task list, and
// anywhere aggregating tasks across projects such as the portfolio "Up
// Next" view. The server-side equivalent (format_converter.py's
// _strip_trailing_bare_separator, used by convert_plan_format_to_standard)
// already handled this; this file is the JS-side counterpart.
//
// planBody may leave a single trailing blank line where the separator used
// to be (it pops lines that are exactly "---", not the blank line before
// them) -- that matches the Python implementation's identical behaviour and
// is harmless, since the outline parser skips blank lines. Assertions below
// check for that with .trim()/doesNotMatch rather than byte-exact equality.
//
// Run with: node tests/test_local_parse_plan_body.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { planBody } from '../packages/noodle-web/src/noodle_web/static/engine/local-parse.js';
import { scheduleTasksFromText } from '../packages/noodle-web/src/noodle_web/static/engine/scheduler.js';

test('planBody strips a trailing bare separator before a back-matter marker', () => {
  const plan = [
    '---',
    'title: Test',
    '---',
    'Task A 2d',
    'Task B 3d',
    '',
    '---',
    '',
    '---raid log---',
    '| ID | Type |',
    '|----|------|',
  ].join('\n');
  const body = planBody(plan);
  assert.equal(body.trim(), 'Task A 2d\nTask B 3d');
  assert.doesNotMatch(body, /^---$/m);
});

test('planBody strips a trailing bare separator with no back-matter section after it', () => {
  const plan = ['---', 'title: Test', '---', 'Task A 2d', 'Task B 3d', '', '---'].join('\n');
  const body = planBody(plan);
  assert.equal(body.trim(), 'Task A 2d\nTask B 3d');
  assert.doesNotMatch(body, /^---$/m);
});

test('planBody strips multiple stacked trailing bare separators', () => {
  const plan = ['---', 'title: Test', '---', 'Task A 2d', '', '---', '---', ''].join('\n');
  const body = planBody(plan);
  assert.doesNotMatch(body, /^---$/m);
});

test('planBody leaves a plan with no separator at all unaffected', () => {
  const plan = ['---', 'title: Test', '---', 'Task A 2d', 'Task B 3d'].join('\n');
  const body = planBody(plan);
  assert.equal(body, 'Task A 2d\nTask B 3d');
});

test('planBody with multiple back-matter sections and a divider: no phantom task line', () => {
  const plan = [
    '---',
    'title: Test',
    '---',
    'Phase A',
    '  Task A1 2d @jd',
    '  Task A2 3d',
    '',
    '---',
    '',
    '---raid log---',
    '| ID | Type | Title | Description | Raised By | Owner | Mitigation Actions | Impact | Likelihood | Score | Status |',
    '|----|------|-------|-------------|-----------|-------|--------------------|--------|------------|-------|--------|',
    '| 1  | risk | A risk | desc        | PM        | PM    |                    | 3      | 3          | 9     | open   |',
    '',
    '---comms---',
    '| ID | Activity | Audience | Content | Frequency | Channel | Owner | Status |',
    '|----|----------|----------|---------|-----------|---------|-------|--------|',
    '| 1  | Update   | Team     | Weekly  | Weekly    | Email   | PM    | Active |',
  ].join('\n');
  const body = planBody(plan);
  assert.equal(body.trim(), 'Phase A\n  Task A1 2d @jd\n  Task A2 3d');
  assert.ok(!body.split('\n').some((line) => line.trim() === '---'));
});

test('end-to-end: the local scheduler never produces a task named "---"', () => {
  const plan = [
    '---',
    'title: Test',
    '---',
    'Task A 2d',
    'Task B 3d',
    '',
    '---',
    '',
    '---raid log---',
    '| ID | Type |',
    '|----|------|',
  ].join('\n');
  const tasks = scheduleTasksFromText(planBody(plan), { today: '2026-06-01' });
  const names = tasks.map((t) => t.name);
  assert.ok(!names.includes('---'), `expected no "---" task, got: ${JSON.stringify(names)}`);
  assert.deepEqual(names, ['Task A', 'Task B']);
});
