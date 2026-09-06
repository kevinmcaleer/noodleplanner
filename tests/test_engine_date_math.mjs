/**
 * static/engine/date-math.js against noodle_core/date_math.py (issue #793).
 *
 * The working-day arithmetic is the foundation every scheduled date rests
 * on, so it is checked against the Python directly rather than only through
 * the conformance corpus: the same inputs go to both and the answers must
 * agree exactly.
 *
 *   node --test tests/test_engine_date_math.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

import {
  addWorkingDays,
  countWorkingDays,
  dayOf,
  getNextWorkingDay,
  isoOf,
  parseDurationToDays,
  weekday,
} from "../packages/noodle-web/src/noodle_web/static/engine/date-math.js";

const repo = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const python = `${repo}/.venv/bin/python`;
const hasPython = existsSync(python);

/** Run the Python date_math over a batch of cases and return its answers. */
function pythonAnswers(cases) {
  const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(`${repo}/packages/noodle-core/src`)})
from datetime import datetime, timedelta
from noodle_core.date_math import (
    add_working_days, count_working_days, get_next_working_day, parse_duration_to_days,
)

def d(iso):
    return datetime.strptime(iso, "%Y-%m-%d")

out = []
for case in json.loads(${JSON.stringify(JSON.stringify(cases))}):
    kind = case["kind"]
    holidays = {d(h) for h in case.get("holidays", [])}
    if kind == "next_working":
        out.append(get_next_working_day(d(case["date"]), holidays).strftime("%Y-%m-%d"))
    elif kind == "add":
        out.append(add_working_days(d(case["date"]), case["days"], holidays).strftime("%Y-%m-%d"))
    elif kind == "count":
        out.append(count_working_days(d(case["start"]), d(case["end"]), holidays))
    elif kind == "lag":
        out.append(parse_duration_to_days(case["text"]))
    elif kind == "weekday":
        out.append(d(case["date"]).weekday())
print(json.dumps(out))
`;
  return JSON.parse(execFileSync(python, ["-c", script], { cwd: repo }).toString());
}

/** Every date in a span, so the comparisons cover weekends and boundaries. */
function datesFrom(startIso, count) {
  const start = dayOf(startIso);
  return Array.from({ length: count }, (_, i) => isoOf(start + i));
}

test("weekday numbering matches Python's date.weekday()", { skip: !hasPython }, () => {
  const dates = datesFrom("2026-05-25", 21); // three whole weeks
  const cases = dates.map((date) => ({ kind: "weekday", date }));
  const expected = pythonAnswers(cases);
  assert.deepEqual(dates.map((d) => weekday(dayOf(d))), expected);
});

test("get_next_working_day agrees over a month, weekends included", { skip: !hasPython }, () => {
  const dates = datesFrom("2026-05-25", 40);
  const cases = dates.map((date) => ({ kind: "next_working", date }));
  const expected = pythonAnswers(cases);
  assert.deepEqual(dates.map((d) => isoOf(getNextWorkingDay(dayOf(d)))), expected);
});

test("get_next_working_day agrees when holidays block the way", { skip: !hasPython }, () => {
  // a whole week off, so the search has to run past it
  const holidays = ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14"];
  const dates = datesFrom("2026-08-05", 14);
  const cases = dates.map((date) => ({ kind: "next_working", date, holidays }));
  const expected = pythonAnswers(cases);
  const holidaySet = new Set(holidays.map(dayOf));
  assert.deepEqual(dates.map((d) => isoOf(getNextWorkingDay(dayOf(d), holidaySet))), expected);
});

test("add_working_days agrees across durations, directions and weekends", { skip: !hasPython }, () => {
  const dates = datesFrom("2026-05-29", 10); // starts on a Friday
  const durations = [0, 1, 2, 3, 5, 10, 20, -1, -3, -10];
  const cases = [];
  for (const date of dates) for (const days of durations) cases.push({ kind: "add", date, days });

  const expected = pythonAnswers(cases);
  const actual = cases.map((c) => isoOf(addWorkingDays(dayOf(c.date), c.days)));
  assert.deepEqual(actual, expected);
});

test("add_working_days agrees with holidays in the span", { skip: !hasPython }, () => {
  const holidays = ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-12-25"];
  const holidaySet = new Set(holidays.map(dayOf));
  const cases = [];
  for (const date of datesFrom("2026-08-05", 12)) {
    for (const days of [1, 3, 5, 10, -5]) cases.push({ kind: "add", date, days, holidays });
  }
  cases.push({ kind: "add", date: "2026-12-22", days: 5, holidays });

  const expected = pythonAnswers(cases);
  const actual = cases.map((c) => isoOf(addWorkingDays(dayOf(c.date), c.days, holidaySet)));
  assert.deepEqual(actual, expected);
});

test("the finish date is exclusive, as the Python convention has it", () => {
  // a 1-day task starting Monday finishes Tuesday
  assert.equal(isoOf(addWorkingDays(dayOf("2026-06-01"), 1)), "2026-06-02");
  // a 5-day task starting Monday finishes the following Saturday
  assert.equal(isoOf(addWorkingDays(dayOf("2026-06-01"), 5)), "2026-06-06");
  // a milestone finishes where it starts
  assert.equal(isoOf(addWorkingDays(dayOf("2026-06-01"), 0)), "2026-06-01");
});

test("count_working_days agrees over spans that cross weekends", { skip: !hasPython }, () => {
  const cases = [];
  for (const start of datesFrom("2026-05-29", 8)) {
    for (const offset of [0, 1, 5, 10, 30]) {
      cases.push({ kind: "count", start, end: isoOf(dayOf(start) + offset) });
    }
  }
  const expected = pythonAnswers(cases);
  const actual = cases.map((c) => countWorkingDays(dayOf(c.start), dayOf(c.end)));
  assert.deepEqual(actual, expected);
});

test("lag and lead parsing agrees, including the odd units", { skip: !hasPython }, () => {
  const texts = ["+2d", "-1d", "+1w", "-2w", "+3m", "-1y", "+0d", "2d", "", "junk", "+5x"];
  const expected = pythonAnswers(texts.map((text) => ({ kind: "lag", text })));
  assert.deepEqual(texts.map(parseDurationToDays), expected);
});

test("day numbers round-trip through ISO", () => {
  for (const iso of ["2026-01-01", "2026-06-01", "2026-12-31", "2027-02-28", "2028-02-29"]) {
    assert.equal(isoOf(dayOf(iso)), iso);
  }
  assert.equal(dayOf(""), null);
});

test("a year with no working day is refused rather than looping", () => {
  const everyDay = new Set();
  const start = dayOf("2026-06-01");
  for (let i = 0; i < 400; i++) everyDay.add(start + i);
  assert.throws(() => getNextWorkingDay(start, everyDay), /Could not find a working day/);
});
