/**
 * Detection and fix logic for the Microsoft Project "resource is assigned
 * outside dates ... duration of this fixed duration task will change to
 * accommodate the resource assignment" warning (kevinmcaleer/Snakie#975).
 *
 * pymppwriter/mppwriter write an assignment's Work as a single aggregate
 * value rather than a true timephased actual/remaining contour; per the
 * library's own docs/FORMAT_NOTES.md ("Progress on assigned tasks"), that is
 * verified safe at 0% complete and at 100% complete, but not for a task with
 * an assignment and a percent strictly between 1 and 99 -- exactly the shape
 * reported for task 81 ("Bradford optimisation 15d @Jack 53% 2026-08-24").
 *
 * findAssignmentDateRiskTasks() is the pure detector the status bar uses
 * (status-bar.js) and that the browser .mpp export also folds into its own
 * warnings list (mpp-export.js exportMppInBrowser); this file exercises it
 * directly, mirroring the Node-testable pattern used for the rest of
 * mpp-export.js in tests/test_mpp_browser_export.mjs.
 *
 *   node --test tests/test_mpp_assignment_warning.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  assignmentDateRiskMessage,
  findAssignmentDateRiskTasks,
  safeAssignmentPercent,
} from "../packages/noodle-web/src/noodle_web/static/mpp-export.js";

function parseWith(tasks) {
  return { tasks };
}

test("flags a fixed-duration subtask with an assigned resource and partial percent complete", () => {
  const parse = parseWith([
    {
      name: "Bradford optimisation",
      is_summary: false,
      duration_days: 15,
      resources: "Jack",
      percent: 53,
    },
  ]);
  const risky = findAssignmentDateRiskTasks(parse);
  assert.deepEqual(risky, [{ name: "Bradford optimisation", percent: 53 }]);
});

test("does not flag a task with no resource assigned", () => {
  const parse = parseWith([
    { name: "Unassigned", is_summary: false, duration_days: 5, resources: "", percent: 50 },
  ]);
  assert.deepEqual(findAssignmentDateRiskTasks(parse), []);
});

test("does not flag 0% or 100% complete (both are verified safe)", () => {
  const parse = parseWith([
    { name: "Not started", is_summary: false, duration_days: 5, resources: "Jack", percent: 0 },
    { name: "Finished", is_summary: false, duration_days: 5, resources: "Jack", percent: 100 },
  ]);
  assert.deepEqual(findAssignmentDateRiskTasks(parse), []);
});

test("does not flag summary rows or milestones", () => {
  const parse = parseWith([
    { name: "Phase", is_summary: true, duration_days: 15, resources: "Jack", percent: 50 },
    { name: "Kickoff", is_summary: false, duration_days: 0, resources: "Jack", percent: 50 },
  ]);
  assert.deepEqual(findAssignmentDateRiskTasks(parse), []);
});

test("flags every at-risk task, in task order", () => {
  const parse = parseWith([
    { name: "A", is_summary: false, duration_days: 5, resources: "Jack", percent: 30 },
    { name: "B", is_summary: false, duration_days: 5, resources: "", percent: 40 },
    { name: "C", is_summary: false, duration_days: 5, resources: "Jack, Adam", percent: 75 },
  ]);
  assert.deepEqual(findAssignmentDateRiskTasks(parse), [
    { name: "A", percent: 30 },
    { name: "C", percent: 75 },
  ]);
});

test("safeAssignmentPercent rounds to the nearer of 0 or 100", () => {
  assert.equal(safeAssignmentPercent(1), 0);
  assert.equal(safeAssignmentPercent(49), 0);
  assert.equal(safeAssignmentPercent(50), 100);
  assert.equal(safeAssignmentPercent(53), 100);
  assert.equal(safeAssignmentPercent(99), 100);
});

test("assignmentDateRiskMessage names the task and its percent", () => {
  const message = assignmentDateRiskMessage({ name: "Bradford optimisation", percent: 53 });
  assert.match(message, /Bradford optimisation/);
  assert.match(message, /53%/);
  assert.match(message, /outside/i);
});
