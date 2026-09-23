// A dependency on a duplicated task name means its first definition.
//
// The lookup used to keep the *last* definition. The scheduler walks the
// plan once, so when that definition came after the dependant it had no
// dates yet, the dependency was skipped, and the dependant started today.
// tests/test_duplicate_dependency_names.py holds the Python engine to the
// same rule, and tests/fixtures/conformance/duplicate-dependency-names.md
// holds the two engines to each other.
//
// Run with: node --test tests/test_duplicate_dependency_names.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { localParse } from '../packages/noodle-web/src/noodle_web/static/engine/local-parse.js';
import { taskNameLookup } from '../packages/noodle-web/src/noodle_web/static/engine/scheduler.js';

const PLAN = [
  '---',
  'title: x',
  '---',
  '',
  'Phase',
  '  Design 3d 2026-01-05',
  '  Design UI 2d [depends Design]',
  'Other',
  '  Design 4d 2026-01-05',
].join('\n');

const task = (result, name, parent) =>
  result.tasks.find((t) => t.name === name && t.parent === parent);

test('taskNameLookup keeps the first definition of a name', () => {
  const first = { name: 'Design' };
  const second = { name: 'design' };
  const lookup = taskNameLookup([first, second, { name: '' }, {}]);
  assert.equal(lookup.size, 1);
  assert.equal(lookup.get('design'), first);
});

test('a dependant follows the first definition, not today', () => {
  assert.equal(task(localParse(PLAN), 'Design UI', 'Phase').start, '2026-01-08');
});

test('a later namesake does not move the dependant', () => {
  const without = PLAN.replace('  Design 4d 2026-01-05\n', '').replace(/\n {2}Design 4d 2026-01-05$/, '');
  assert.equal(
    task(localParse(PLAN), 'Design UI', 'Phase').start,
    task(localParse(without), 'Design UI', 'Phase').start,
  );
});

test('a dependant after both definitions still means the first', () => {
  const result = localParse(`${PLAN}\n  Build 2d [depends design]`);
  assert.equal(task(result, 'Build', 'Other').start, '2026-01-08');
});
