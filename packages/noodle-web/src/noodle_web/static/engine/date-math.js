/**
 * Working-day arithmetic — a port of noodle_core/date_math.py (issue #793).
 *
 * Dates are represented as **plain day numbers**: days since the epoch, in
 * local terms, with no time component. The Python side uses midnight
 * datetimes and only ever compares and adds whole days, so an integer is the
 * honest representation and it sidesteps every timezone and daylight-saving
 * trap a Date would bring. `dayOf`/`isoOf` convert at the edges.
 *
 * Holidays are a Set of the same day numbers.
 *
 * The finish date is **exclusive**, matching the Python: a 1-day task
 * starting Monday finishes Tuesday, a 5-day task starting Monday finishes
 * Saturday. That is what lets a Gantt bar's width be finish - start.
 */

const MS_PER_DAY = 86400000;

/** The day number for an ISO date ("2026-06-01"), or for a Date. */
export function dayOf(value) {
  if (typeof value === "number") return value;
  if (value instanceof Date) {
    return Math.floor(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / MS_PER_DAY);
  }
  const text = String(value || "").slice(0, 10);
  const [y, m, d] = text.split("-").map(Number);
  if (!y || !m || !d) return null;
  return Math.floor(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

/** The ISO date ("2026-06-01") for a day number. */
export function isoOf(day) {
  if (day === null || day === undefined) return "";
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/** 0 = Monday … 6 = Sunday, matching Python's date.weekday(). */
export function weekday(day) {
  // 1970-01-01 (day 0) was a Thursday, which is weekday 3 in Python terms.
  return (((day % 7) + 7) % 7 + 3) % 7;
}

/**
 * `holidays` is either the historical shape -- a Set of exception day
 * numbers, Mon-Fri assumed working -- or a Calendar-like object (see
 * ./calendar.js, issue #1132) whose own week pattern decides instead,
 * duck-typed via `.isWorkingDay` rather than `instanceof` so this module
 * doesn't need to import calendar.js.
 */
export function isWorkingDay(day, holidays) {
  if (holidays && typeof holidays.isWorkingDay === "function") {
    return holidays.isWorkingDay(day);
  }
  return weekday(day) < 5 && !(holidays && holidays.has(day));
}

/**
 * The next working day on or after `day` (get_next_working_day).
 * Returns `day` itself when it is already a working day.
 */
export function getNextWorkingDay(day, holidays = null) {
  let current = day;
  for (let i = 0; i < 366; i++) {
    if (isWorkingDay(current, holidays)) return current;
    current += 1;
  }
  throw new Error(`Could not find a working day within 366 days of ${isoOf(day)}`);
}

/** Today, snapped to the next working day (today_working_day). */
export function todayWorkingDay(holidays = null, today = null) {
  const base = today === null || today === undefined
    ? dayOf(new Date())
    : dayOf(today);
  return getNextWorkingDay(base, holidays);
}

/**
 * Add working days to a start day, skipping weekends and holidays
 * (add_working_days). The result is exclusive; see the module note.
 */
export function addWorkingDays(startDay, numDays, holidays = null) {
  if (numDays === 0) return startDay; // milestones finish where they start

  const maxWorkingDays = 5000;
  if (Math.abs(numDays) > maxWorkingDays) {
    throw new Error(`Number of working days (${numDays}) exceeds maximum allowed (${maxWorkingDays})`);
  }

  if (numDays < 0) {
    let current = startDay;
    let subtracted = 0;
    const target = Math.abs(numDays);
    while (subtracted < target) {
      current -= 1;
      if (isWorkingDay(current, holidays)) subtracted += 1;
    }
    return current;
  }

  let current = getNextWorkingDay(startDay, holidays);
  let added = 1; // the start day counts as day 1
  while (added < numDays) {
    current += 1;
    if (isWorkingDay(current, holidays)) added += 1;
  }
  return current + 1; // the day after the last working day
}

/** Working days between two day numbers, start inclusive, end exclusive. */
export function countWorkingDays(startDay, endDay, holidays = null) {
  if (startDay >= endDay) return 0;
  let count = 0;
  for (let current = startDay; current < endDay; current++) {
    if (isWorkingDay(current, holidays)) count += 1;
  }
  return count;
}

/**
 * "+2d", "-1w", "+3m" as a number of days (parse_duration_to_days).
 * Positive is lag (wait after), negative is lead (start before).
 */
export const LAG_MULTIPLIERS = { d: 1, w: 7, m: 30, y: 365 };

export function parseDurationToDays(text) {
  const match = /^([+-])(\d+)([dwmy])/.exec(String(text || ""));
  if (!match) return 0;
  const days = Number(match[2]) * (LAG_MULTIPLIERS[match[3]] ?? 1);
  return match[1] === "+" ? days : -days;
}

/** A duration token ("3d", "2w", "1m", "1y") as a number of days. */
export const DURATION_MULTIPLIERS = { d: 1, w: 7, m: 30, y: 365 };

export function durationToDays(value, unit) {
  return Number(value) * (DURATION_MULTIPLIERS[unit] ?? 1);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    dayOf, isoOf, weekday, isWorkingDay, getNextWorkingDay, todayWorkingDay,
    addWorkingDays, countWorkingDays, parseDurationToDays, durationToDays,
    LAG_MULTIPLIERS, DURATION_MULTIPLIERS,
  };
}
