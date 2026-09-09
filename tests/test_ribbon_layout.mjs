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

// ── fitLabels() -- simple ribbon (#955) text-fits-or-icon-only ─────────────

test("fitLabels: every label fits -- all buttons keep their text", () => {
  const buttons = [
    { iconWidth: 28, fullWidth: 60 },
    { iconWidth: 28, fullWidth: 70 },
    { iconWidth: 28, fullWidth: 50 },
  ];
  assert.deepEqual(fitLabels(buttons, 300), [true, true, true]);
});

test("fitLabels: nothing fits even icon-only-wide -- every button still renders icon-only, none dropped", () => {
  const buttons = [
    { iconWidth: 28, fullWidth: 60 },
    { iconWidth: 28, fullWidth: 70 },
  ];
  const result = fitLabels(buttons, 10);
  assert.equal(result.length, 2, "a button is never dropped -- only its label is");
  assert.deepEqual(result, [false, false]);
});

test("fitLabels: labels shrink left-to-right once the running total stops fitting", () => {
  // container 150: button 0 (60) fits (used=60), button 1 (70) fits (used=130),
  // button 2 (50) would put used at 180 > 150 -- goes icon-only instead.
  const buttons = [
    { iconWidth: 28, fullWidth: 60 },
    { iconWidth: 28, fullWidth: 70 },
    { iconWidth: 28, fullWidth: 50 },
  ];
  assert.deepEqual(fitLabels(buttons, 150), [true, true, false]);
});

test("fitLabels: once a label doesn't fit, every later button is icon-only too -- a later, narrower label never jumps ahead", () => {
  // container 100: button 0 (60) fits (used=60). button 1 (70) would put
  // used at 130 > 100 -- icon-only (used=60+28=88). button 2's label (10)
  // would easily fit the 12 remaining, but must not jump ahead of button 1.
  const buttons = [
    { iconWidth: 28, fullWidth: 60 },
    { iconWidth: 28, fullWidth: 70 },
    { iconWidth: 28, fullWidth: 10 },
  ];
  assert.deepEqual(fitLabels(buttons, 100), [true, false, false]);
});

test("fitLabels: empty input fits trivially", () => {
  assert.deepEqual(fitLabels([], 300), []);
});

test("fitLabels: exact fit at the container edge counts as fitting", () => {
  const buttons = [{ iconWidth: 28, fullWidth: 100 }, { iconWidth: 28, fullWidth: 100 }];
  assert.deepEqual(fitLabels(buttons, 200), [true, true]);
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

test("fitSimpleGroups: a single group always stays visible even far over budget", () => {
  const { visible, collapsed } = fitSimpleGroups([500], 100, 64);
  assert.deepEqual(visible, [0]);
  assert.deepEqual(collapsed, []);
});
