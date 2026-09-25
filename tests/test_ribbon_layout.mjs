/**
 * ribbon-layout.js -- the ribbon's "» More" overflow fit calculation
 * (#833 follow-up, design handoff "Ribbon Toolbar option 2a"), plus the
 * simple ribbon's (#955) text-fits-or-icon-only fit calculation.
 *
 *   node --test tests/test_ribbon_layout.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";

import { fitGroups, fitLabels, fitSimpleGroups } from "../packages/noodle-web/src/noodle_web/static/ribbon-layout.js";

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

// ── fitLabels() -- simple ribbon (#955) labels-or-icons, all or nothing ───

test("fitLabels: the whole row fits with labels -- every button keeps its text", () => {
  assert.equal(fitLabels([120, 90, 60], 300), true);
});

test("fitLabels: exact fit at the container edge counts as fitting", () => {
  assert.equal(fitLabels([100, 100], 200), true);
});

test("fitLabels: one pixel over -- every label goes, not just the rightmost ones", () => {
  // The old greedy pass would have kept the first two groups labelled and
  // stripped only the third; a half-labelled row is exactly what this
  // replaced.
  assert.equal(fitLabels([100, 100, 1], 200), false);
});

test("fitLabels: empty input fits trivially", () => {
  assert.equal(fitLabels([], 300), true);
});

// ── fitSimpleGroups() -- simple ribbon (#1026) per-group dropdown fallback ─

test("fitSimpleGroups: everything fits -- no group collapses", () => {
  const { visible, collapsed } = fitSimpleGroups([100, 120, 90], 400, 64);
  assert.deepEqual(visible, [0, 1, 2]);
  assert.deepEqual(collapsed, []);
});

test("fitSimpleGroups: exact fit at the container edge counts as fitting", () => {
  const { visible, collapsed } = fitSimpleGroups([100, 100, 100], 300, 64);
  assert.deepEqual(visible, [0, 1, 2]);
  assert.deepEqual(collapsed, []);
});

test("fitSimpleGroups: trailing groups collapse into their own trigger chips, each chip counted in the budget", () => {
  // container 300, trigger 64: group0 (100) fits alongside a reserve for the
  // 3 groups after it (3*64=192) -> 100+192=292 <= 300, stays visible
  // (used=100). group1 (100) would need used(100)+100+2*64(reserve for
  // groups 2,3)=328 > 300 -- collapses, and every group after it collapses
  // too rather than jumping ahead.
  const { visible, collapsed } = fitSimpleGroups([100, 100, 100, 90], 300, 64);
  assert.deepEqual(visible, [0]);
  assert.deepEqual(collapsed, [1, 2, 3]);
});

test("fitSimpleGroups: order is preserved -- a later, narrower group never jumps ahead of an earlier collapsed one", () => {
  const { visible, collapsed } = fitSimpleGroups([150, 150, 20], 220, 64);
  assert.deepEqual(visible, [0]);
  assert.deepEqual(collapsed, [1, 2]);
});

test("fitSimpleGroups: never collapse everything -- the first group always stays visible", () => {
  const { visible, collapsed } = fitSimpleGroups([500, 100], 50, 64);
  assert.deepEqual(visible, [0]);
  assert.deepEqual(collapsed, [1]);
});

test("fitSimpleGroups: empty input fits trivially", () => {
  assert.deepEqual(fitSimpleGroups([], 400, 64), { visible: [], collapsed: [] });
});

test("fitSimpleGroups: per-group trigger widths -- each named trigger reserves its own width", () => {
  // container 300, triggers [40, 80, 60]. Group 0 (150) needs 150+80+60=290
  // <= 300 -- visible. Group 1 (100) needs 150+100+60=310 > 300 -- collapses
  // (used=150+80=230). Group 2 collapses too, to keep the order.
  const { visible, collapsed } = fitSimpleGroups([150, 100, 60], 300, [40, 80, 60]);
  assert.deepEqual(visible, [0]);
  assert.deepEqual(collapsed, [1, 2]);
});

test("fitSimpleGroups: a wide trigger further right is what pushes a group out", () => {
  // Same groups, but group 2's trigger is narrow enough that group 1 fits.
  const { visible, collapsed } = fitSimpleGroups([150, 100, 80], 300, [40, 80, 40]);
  assert.deepEqual(visible, [0, 1]);
  assert.deepEqual(collapsed, [2]);
});

test("fitSimpleGroups: a single group always stays visible even far over budget", () => {
  const { visible, collapsed } = fitSimpleGroups([500], 100, 64);
  assert.deepEqual(visible, [0]);
  assert.deepEqual(collapsed, []);
});
