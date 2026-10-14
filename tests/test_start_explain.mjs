/**
 * engine/start-explain.js: why a task starts when it does, as the Task
 * Inspector shows it. Run with: node --test tests/test_start_explain.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { scheduleTasksFromText } from '../packages/noodle-web/src/noodle_web/static/engine/scheduler.js';
import { explainStart } from '../packages/noodle-web/src/noodle_web/static/engine/start-explain.js';

const PLAN = `Awareness $awareness [depends $ability]
  placeholder 70d 2026-07-29
  *Comms Plan
    draft 2026-07-28 @kev
    *approve @julian
  *roadshows @kev
    *Bradford @kev 2026-09-30
  *Awareness phase complete 0d @kev

*Desire $desire
  *develop use-cases 50% @kev
  *webinar 1d @joel
  *slt training 1d @joel
    Draft slt Training 25d @joel 2026-09-11
    *Review SLT training 1d @kev [depends webinar]
  *Desire phase complete 0d @kev

*Knowledge $knowledge [depends $desire]
  *AI fundamentals Training @joel

*Reinforcement $reinforcement [depends $awareness]
  Business updates 1d @kev 2026-10-15
  Monthly showcase 1d [depends Business updates +2d]
  Fixed 2026-12-01 [depends Business updates]
`;

const tasks = scheduleTasksFromText(PLAN, { today: '2026-10-14' });
const find = (name) => tasks.find((t) => t.name === name);
const lines = PLAN.split('\n');
const explain = (name, explicitStart = '') => {
  const line = lines.find((l) => l.includes(name)) || '';
  return explainStart(tasks, find(name), { explicitStart, sequential: /^\s*\*/.test(line) && !find(name).is_summary });
};

test('a starred task follows the task above it', () => {
  const why = explain('develop use-cases');
  assert.equal(why.kind, 'sequential');
  assert.match(why.headline, /“Awareness phase complete” finishes/);
  assert.ok(why.steps[0].driving);
});

test('a [depends] on a starred task is reported as ignored', () => {
  const why = explain('Review SLT training');
  assert.equal(why.kind, 'sequential');
  assert.ok(why.notes.some((n) => /\[depends webinar\] .* ignored/.test(n)));
});

test('a group starts with its earliest task, and says which one', () => {
  const why = explain('Desire');
  assert.equal(why.kind, 'group');
  assert.match(why.headline, /“Draft slt Training” on 2026-09-11/);
  assert.ok(why.notes.some((n) => /“develop use-cases”.*starts earlier/.test(n)));
});

test('a [depends] on a group is flagged as not moving its tasks', () => {
  const why = explain('Reinforcement');
  assert.ok(why.notes.some((n) => /does not move the tasks inside it/.test(n)));
  assert.ok(why.notes.some((n) => /before “Awareness” finishes/.test(n)));
});

test('an explicit date on a task with no dependencies', () => {
  const why = explain('Draft slt Training', '2026-09-11');
  assert.equal(why.kind, 'explicit');
});

test('a plain dependency with a lag names the driver', () => {
  const why = explain('Monthly showcase');
  assert.equal(why.kind, 'depends');
  assert.match(why.headline, /“Business updates” finishes/);
  assert.match(why.headline, /\+2d/);
});

test('an explicit date later than its dependency wins', () => {
  const why = explain('Fixed', '2026-12-01');
  assert.equal(why.kind, 'explicit');
  assert.ok(why.steps.some((s) => /later than the dependencies/.test(s.text)));
});
