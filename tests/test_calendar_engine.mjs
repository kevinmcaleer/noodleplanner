/**
 * static/engine/calendar.js — named calendars in the browser engine
 * (#1047, #1132, mirroring tests/test_calendar_model.py).
 *
 *   node --test tests/test_calendar_engine.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  Calendar,
  CalendarFormatError,
  STANDARD_CALENDAR,
  parseWeekPattern,
  weekPatternText,
  parseCalendarEntry,
  parseCalendars,
  parseActiveCalendarName,
  activeCalendar,
} from "../packages/noodle-web/src/noodle_web/static/engine/calendar.js";
import { dayOf } from "../packages/noodle-web/src/noodle_web/static/engine/date-math.js";

test("parseWeekPattern: a simple range", () => {
  assert.deepEqual(parseWeekPattern("Mon-Fri"), [new Set([0, 1, 2, 3, 4])]);
});

test("parseWeekPattern: a wrapping range is a Fri/Sat weekend, not empty", () => {
  assert.deepEqual(parseWeekPattern("Sun-Thu"), [new Set([6, 0, 1, 2, 3])]);
});

test("parseWeekPattern: a two-week rotation", () => {
  assert.deepEqual(parseWeekPattern("[Mon-Fri; Mon-Wed]"), [
    new Set([0, 1, 2, 3, 4]),
    new Set([0, 1, 2]),
  ]);
});

test("parseWeekPattern: an unknown day name throws", () => {
  assert.throws(() => parseWeekPattern("Munday-Fri"), CalendarFormatError);
});

test("weekPatternText round-trips a simple pattern", () => {
  assert.equal(weekPatternText(parseWeekPattern("Mon-Fri")), "Mon-Fri");
});

test("weekPatternText round-trips a rotation", () => {
  const text = "[Mon-Fri; Mon-Wed]";
  assert.equal(weekPatternText(parseWeekPattern(text)), text);
});

test("parseCalendarEntry: hours and exceptions, order-independent", () => {
  const a = parseCalendarEntry("X", "Mon-Fri hours 08:00-16:30 exceptions [2026-12-25]");
  const b = parseCalendarEntry("X", "Mon-Fri exceptions [2026-12-25] hours 08:00-16:30");
  assert.deepEqual(a.weekPattern, b.weekPattern);
  assert.deepEqual(a.hours, b.hours);
  assert.deepEqual(a.exceptions, b.exceptions);
  assert.deepEqual(a.hours, ["08:00", "16:30"]);
  assert.ok(a.exceptions.has(dayOf("2026-12-25")));
});

test("parseCalendarEntry: named and ranged exceptions", () => {
  const cal = parseCalendarEntry(
    "Standard",
    "Mon-Fri exceptions [Christmas: 2026-12-25:2026-12-26, Training Day: 2026-03-10]",
  );
  assert.deepEqual(
    [...cal.exceptions].sort((a, b) => a - b),
    [dayOf("2026-03-10"), dayOf("2026-12-25"), dayOf("2026-12-26")].sort((a, b) => a - b),
  );
});

test("Calendar.isWorkingDay matches the implicit Mon-Fri default", () => {
  assert.equal(STANDARD_CALENDAR.isWorkingDay(dayOf("2026-08-05")), true); // Wed
  assert.equal(STANDARD_CALENDAR.isWorkingDay(dayOf("2026-08-08")), false); // Sat
  assert.equal(STANDARD_CALENDAR.isWorkingDay(dayOf("2026-08-09")), false); // Sun
});

test("Calendar.isWorkingDay: exceptions override the week pattern", () => {
  const cal = new Calendar({ name: "X", exceptions: new Set([dayOf("2026-08-05")]) });
  assert.equal(cal.isWorkingDay(dayOf("2026-08-05")), false);
});

test("Calendar.isWorkingDay: a fortnight rotation alternates by week", () => {
  const cal = new Calendar({ name: "Fortnight", weekPattern: parseWeekPattern("[Mon-Fri; Mon-Wed]") });
  const epochThursday = dayOf("2001-01-01") + 3; // week 0 (Mon-Fri): Thursday works
  const week1Thursday = epochThursday + 7; // week 1 (Mon-Wed): Thursday doesn't

  assert.equal(cal.isWorkingDay(epochThursday), true);
  assert.equal(cal.isWorkingDay(week1Thursday), false);
});

test("Calendar.withExtraExceptions does not mutate the original", () => {
  const cal = new Calendar({ name: "X" });
  const extended = cal.withExtraExceptions(new Set([dayOf("2026-08-05")]));
  assert.equal(cal.exceptions.size, 0);
  assert.equal(extended.exceptions.size, 1);
  assert.equal(extended.name, "X");
});

const PLAN_WITH_CALENDARS = `---
title: Calendar Test
calendar: Fortnight Ops
calendars:
- Standard: Mon-Fri
- Night Shift: Sun-Thu hours 22:00-06:00
- Fortnight Ops: [Mon-Fri; Mon-Wed] hours 08:00-16:30 exceptions [Christmas: 2026-12-25:2026-12-26]
---
Phase 1
  Task A 3d
`;

test("parseCalendars finds every named calendar", () => {
  const calendars = parseCalendars(PLAN_WITH_CALENDARS);
  assert.deepEqual([...calendars.keys()].sort(), ["Fortnight Ops", "Night Shift", "Standard"]);
  assert.deepEqual(calendars.get("Night Shift").hours, ["22:00", "06:00"]);
});

test("parseActiveCalendarName reads the calendar: key", () => {
  assert.equal(parseActiveCalendarName(PLAN_WITH_CALENDARS), "Fortnight Ops");
});

test("activeCalendar resolves the named object", () => {
  const active = activeCalendar(PLAN_WITH_CALENDARS);
  assert.equal(active.name, "Fortnight Ops");
  assert.deepEqual(active.hours, ["08:00", "16:30"]);
});

test("no calendars: block defaults to Standard", () => {
  const plan = "---\ntitle: No Calendars\n---\nTask A 1d\n";
  const calendars = parseCalendars(plan);
  assert.deepEqual([...calendars.keys()], ["Standard"]);
  assert.equal(activeCalendar(plan).name, "Standard");
});

test("calendar: naming an undefined calendar falls back to Standard", () => {
  const plan = "---\ntitle: X\ncalendar: Nonexistent\n---\nTask A 1d\n";
  assert.equal(activeCalendar(plan).name, "Standard");
});

test("an invalid calendar entry is skipped, not fatal", () => {
  const plan = "---\ntitle: X\ncalendars:\n- Bad: Notaday-Fri\n- Good: Mon-Fri\n---\nTask A 1d\n";
  const calendars = parseCalendars(plan);
  assert.deepEqual([...calendars.keys()], ["Good"]);
});
