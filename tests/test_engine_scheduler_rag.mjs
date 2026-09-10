/**
 * calculateRagStatus's deadline slippage flag (#877, #1152).
 *
 * Mirrors TestCalculateRAGStatusDeadline in tests/test_scheduling_engine.py --
 * scheduler.js's calculateRagStatus is a day-number port of
 * noodle_core/exporters.py's calculate_rag_status, and the two must agree.
 *
 *   node --test tests/test_engine_scheduler_rag.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";

import { calculateRagStatus } from "../packages/noodle-web/src/noodle_web/static/engine/scheduler.js";
import { dayOf } from "../packages/noodle-web/src/noodle_web/static/engine/date-math.js";

test("deadline already passed and incomplete is overdue", () => {
  const task = { start: dayOf("2025-11-01"), finish: dayOf("2025-11-10"), percent: 80, deadline: "2025-11-15" };
  assert.equal(calculateRagStatus(task, dayOf("2025-11-20")), "Task Overdue");
});

test("projected finish after deadline is overdue even before the deadline", () => {
  const task = { start: dayOf("2025-11-01"), finish: dayOf("2025-11-20"), percent: 10, deadline: "2025-11-15" };
  assert.equal(calculateRagStatus(task, dayOf("2025-11-05")), "Task Overdue");
});

test("on track to meet the deadline is not flagged", () => {
  const task = { start: dayOf("2025-11-01"), finish: dayOf("2025-11-10"), percent: 50, deadline: "2025-11-15" };
  assert.equal(calculateRagStatus(task, dayOf("2025-11-05")), "On Track");
});

test("a completed task is never flagged for a missed deadline", () => {
  const task = { start: dayOf("2025-11-01"), finish: dayOf("2025-11-10"), percent: 100, deadline: "2025-11-05" };
  assert.equal(calculateRagStatus(task, dayOf("2025-11-20")), "Complete");
});

test("a task with no deadline is never flagged by the deadline logic", () => {
  const task = { start: dayOf("2025-11-01"), finish: dayOf("2025-11-10"), percent: 100 };
  assert.equal(calculateRagStatus(task, dayOf("2025-11-20")), "Complete");
});
