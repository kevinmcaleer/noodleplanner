/**
 * scheduler.js's calendar-aware scheduling (#1047, #1132, mirroring
 * tests/test_calendar_scheduling.py). scheduleTasksFromText is exercised
 * directly here; tests/test_engine_conformance.mjs's named-calendar.md
 * fixture cross-checks the same mechanism against the Python engine.
 *
 *   node --test tests/test_calendar_scheduling.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";

import { scheduleTasksFromText, dayOf, isoOf } from "../packages/noodle-web/src/noodle_web/static/engine/scheduler.js";
import { Calendar, parseWeekPattern } from "../packages/noodle-web/src/noodle_web/static/engine/calendar.js";

function finishOf(tasks, name) {
  return tasks.find((t) => t.name === name).finish;
}

test("no calendar: matches scheduling without the option at all", () => {
  const text = "Task 1 @john 10d 2026-08-05";
  const withNull = scheduleTasksFromText(text, { calendar: null });
  const without = scheduleTasksFromText(text, {});
  assert.equal(withNull[0].finish, without[0].finish);
  assert.equal(withNull[0].finish, "2026-08-19");
});

test("a Sun-Thu calendar schedules through what would be a weekend on Mon-Fri", () => {
  const cal = new Calendar({ name: "Gulf", weekPattern: parseWeekPattern("Sun-Thu") });
  const text = "Task 1 2026-08-02 5d"; // Sunday start
  const onGulf = scheduleTasksFromText(text, { calendar: cal });
  const onStandard = scheduleTasksFromText(text, {});
  assert.equal(onGulf[0].finish, "2026-08-07");
  assert.equal(onStandard[0].finish, "2026-08-08");
});

test("a fortnight rotation produces a later finish than a plain work week", () => {
  const cal = new Calendar({ name: "Fortnight", weekPattern: parseWeekPattern("[Mon-Fri; Mon-Wed]") });
  const shortWeekMonday = dayOf("2001-01-01") + 7; // rotation week index 1 (Mon-Wed)
  const text = `Task 1 ${isoOf(shortWeekMonday)} 6d`;

  const rotated = scheduleTasksFromText(text, { calendar: cal });
  const straight = scheduleTasksFromText(text, { calendar: new Calendar({ name: "Standard" }) });
  assert.ok(rotated[0].finish > straight[0].finish);
});

test("a resource's own calendar overrides the project calendar for its tasks", () => {
  const gulf = new Calendar({ name: "Gulf", weekPattern: parseWeekPattern("Sun-Thu") });
  const text = "Task 1 @kev 2026-08-02 5d";
  const tasks = scheduleTasksFromText(text, { resourceCalendars: new Map([["kev", gulf]]) });
  assert.equal(tasks[0].finish, "2026-08-07");
});

test("a resource with no assigned calendar falls back to the project's (Standard)", () => {
  const gulf = new Calendar({ name: "Gulf", weekPattern: parseWeekPattern("Sun-Thu") });
  const text = "Task 1 @sam 2026-08-02 5d";
  const tasks = scheduleTasksFromText(text, { resourceCalendars: new Map([["kev", gulf]]) });
  assert.equal(tasks[0].finish, "2026-08-08");
});

test("project-wide holidays still apply on top of a calendar", () => {
  const cal = new Calendar({ name: "Standard" });
  const text = "Task 1 2026-08-10 1d";
  const tasks = scheduleTasksFromText(text, { calendar: cal, holidays: new Set([dayOf("2026-08-10")]) });
  assert.equal(tasks[0].finish, "2026-08-12");
});

test("resource non-working days still apply on top of a calendar", () => {
  const cal = new Calendar({ name: "Standard" });
  const text = "Task 1 @kev 2026-08-10 1d";
  const tasks = scheduleTasksFromText(text, {
    calendar: cal,
    resourceNonWorkingDays: new Map([["kev", new Set([dayOf("2026-08-10")])]]),
  });
  assert.equal(tasks[0].finish, "2026-08-12");
});

test("scheduling does not mutate the Calendar instance passed in", () => {
  const cal = new Calendar({ name: "Standard" });
  scheduleTasksFromText("Task 1 2026-08-10 1d", { calendar: cal, holidays: new Set([dayOf("2026-08-10")]) });
  assert.equal(cal.exceptions.size, 0);
});

test("critical-path float honours the active calendar", () => {
  const cal = new Calendar({ name: "Gulf", weekPattern: parseWeekPattern("Sun-Thu") });
  const text = [
    "Short 2026-08-02 2d",
    "Long 2026-08-02 5d",
    "[depends: Short, Long] Final 1d",
  ].join("\n");
  const tasks = scheduleTasksFromText(text, { calendar: cal });
  const byName = Object.fromEntries(tasks.map((t) => [t.name, t]));
  assert.equal(byName.Long.critical, true);
  assert.equal(byName.Long.total_float, 0);
  assert.ok(byName.Short.total_float > 0);
});
