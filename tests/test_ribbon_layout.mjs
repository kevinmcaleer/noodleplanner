/**
 * ribbon-layout.js -- the ribbon's "» More" overflow fit calculation
 * (#833 follow-up, design handoff "Ribbon Toolbar option 2a").
 *
 *   node --test tests/test_ribbon_layout.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";

import { fitGroups } from "../packages/noodle-web/src/noodle_web/static/ribbon-layout.js";

test("everything fits: no overflow, More tile not needed", () => {
  const { visible, overflow } = fitGroups([100, 120, 90], 400, 74);
  assert.deepEqual(visible, [0, 1, 2]);
  assert.deepEqual(overflow, []);
});

test("exact fit at the container edge counts as fitting", () => {
  const { visible, overflow } = fitGroups([100, 100, 100], 300, 74);
  assert.deepEqual(visible, [0, 1, 2]);
  assert.deepEqual(overflow, []);
});

test("overflow collapses trailing groups into More, budget excludes the More tile itself", () => {
  // container 400, More tile 74 -> budget 326. Groups 100+100+100=300 fits, +120 would not (420 > 326).
  const { visible, overflow } = fitGroups([100, 100, 100, 120], 400, 74);
  assert.deepEqual(visible, [0, 1, 2]);
  assert.deepEqual(overflow, [3]);
});

test("a single group wider than the whole container is still shown, not hidden behind an empty ribbon", () => {
  const { visible, overflow } = fitGroups([500], 400, 74);
  assert.deepEqual(visible, [0]);
  assert.deepEqual(overflow, []);
});

test("first group too wide for the budget but nothing else fits either: first group still wins", () => {
  const { visible, overflow } = fitGroups([500, 50], 400, 74);
  assert.deepEqual(visible, [0]);
  assert.deepEqual(overflow, [1]);
});

test("empty input fits trivially", () => {
  assert.deepEqual(fitGroups([], 400, 74), { visible: [], overflow: [] });
});

test("order is preserved: a later, narrower group does not jump ahead of an earlier one that overflowed", () => {
  const { visible, overflow } = fitGroups([200, 200, 50], 300, 74);
  // budget = 226; group 0 (200) fits, group 1 (200) does not (400 > 226),
  // group 2 (50) does fit on its own but must not be pulled forward.
  assert.deepEqual(visible, [0]);
  assert.deepEqual(overflow, [1, 2]);
});
