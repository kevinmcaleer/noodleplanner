/**
 * Named project calendars — a port of noodle_core/calendar_model.py (#1047,
 * #1132). See that module's docstring for the front-matter grammar; this
 * file parses and evaluates the same shape so the browser engine's
 * scheduling agrees with the Python one.
 *
 * Days are day numbers (see date-math.js), matching how the rest of the
 * browser engine represents dates.
 */
import { dayOf, weekday } from "./date-math.js";

export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_INDEX = Object.fromEntries(DAY_NAMES.map((name, i) => [name.toLowerCase(), i]));

// A fixed Monday used as week 0 of every shift rotation, matching Python's
// ROTATION_EPOCH (2001-01-01) so the two engines agree on which rotation
// week any given date falls in.
export const ROTATION_EPOCH_DAY = dayOf("2001-01-01");

export class CalendarFormatError extends Error {}

function dayIndex(name) {
  const key = name.trim().toLowerCase().slice(0, 3);
  if (!(key in DAY_INDEX)) throw new CalendarFormatError(`unrecognised day name: ${name}`);
  return DAY_INDEX[key];
}

/** One week's worth of day tokens: comma-separated names and/or A-B ranges. */
function parseDayList(text) {
  const days = new Set();
  for (const part of text.split(",")) {
    const token = part.trim();
    if (!token) continue;
    if (token.includes("-")) {
      const [startS, endS] = token.split("-");
      const start = dayIndex(startS);
      const end = dayIndex(endS);
      for (let i = start; ; i = (i + 1) % 7) {
        days.add(i);
        if (i === end) break;
      }
    } else {
      days.add(dayIndex(token));
    }
  }
  if (!days.size) throw new CalendarFormatError(`empty day pattern: ${text}`);
  return days;
}

/**
 * A work week ("Mon-Fri") or bracketed, semicolon-separated shift rotation
 * ("[Mon-Fri; Mon-Wed]") into an array of per-week working-day-index sets.
 */
export function parseWeekPattern(text) {
  const trimmed = text.trim();
  if (!trimmed) throw new CalendarFormatError("empty week pattern");
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const weeks = trimmed.slice(1, -1).split(";").map((w) => w.trim()).filter(Boolean);
    if (!weeks.length) throw new CalendarFormatError(`empty rotation: ${text}`);
    return weeks.map(parseDayList);
  }
  return [parseDayList(trimmed)];
}

function dayRanges(days) {
  const ordered = [...days].sort((a, b) => a - b);
  const ranges = [];
  for (const day of ordered) {
    const last = ranges[ranges.length - 1];
    if (last && last[1] === day - 1) last[1] = day;
    else ranges.push([day, day]);
  }
  return ranges;
}

/** The inverse of `parseWeekPattern`: day sets back to compact ranges. */
export function weekPatternText(weekPattern) {
  const rendered = weekPattern.map((days) =>
    dayRanges(days)
      .map(([start, end]) => (start === end ? DAY_NAMES[start] : `${DAY_NAMES[start]}-${DAY_NAMES[end]}`))
      .join(",")
  );
  return rendered.length === 1 ? rendered[0] : `[${rendered.join("; ")}]`;
}

const HOURS_RE = /\bhours\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\b/i;
const EXCEPTIONS_RE = /\bexceptions\s*\[([^\]]*)\]/i;
const EXCEPTION_ENTRY_RE = /^(?:(.+?):\s*)?(\d{4}-\d{2}-\d{2})(?::(\d{4}-\d{2}-\d{2}))?$/;

/** The `exceptions [...]` bracket contents: named dates and date ranges. */
function parseExceptions(text) {
  const days = new Set();
  for (const raw of text.split(",")) {
    const entry = raw.trim();
    if (!entry) continue;
    const match = EXCEPTION_ENTRY_RE.exec(entry);
    if (!match) throw new CalendarFormatError(`bad exception entry: ${entry}`);
    const start = dayOf(match[2]);
    const end = match[3] ? dayOf(match[3]) : start;
    for (let d = start; d <= end; d++) days.add(d);
  }
  return days;
}

/**
 * A named calendar: which weekdays (or rotation of weekdays) are working
 * days, optional daily working hours (informational -- day-granular
 * scheduling doesn't consume them), and dated exceptions that are always
 * non-working regardless of the week pattern.
 */
export class Calendar {
  constructor({ name, weekPattern = [new Set([0, 1, 2, 3, 4])], hours = null, exceptions = new Set() }) {
    this.name = name;
    this.weekPattern = weekPattern;
    this.hours = hours;
    this.exceptions = exceptions;
  }

  /** A copy with extra exception days merged in, without mutating this one. */
  withExtraExceptions(extra) {
    if (!extra || !extra.size) return this;
    return new Calendar({
      name: this.name,
      weekPattern: this.weekPattern,
      hours: this.hours,
      exceptions: new Set([...this.exceptions, ...extra]),
    });
  }

  isWorkingDay(day) {
    if (this.exceptions.has(day)) return false;
    const len = this.weekPattern.length;
    const weeksSinceEpoch = Math.floor((day - ROTATION_EPOCH_DAY) / 7);
    const weekIndex = ((weeksSinceEpoch % len) + len) % len;
    return this.weekPattern[weekIndex].has(weekday(day));
  }
}

//: The implicit calendar every plan has when it declares no `calendars:`
//: block -- Monday to Friday, no hours restriction, no exceptions.
export const STANDARD_CALENDAR = new Calendar({ name: "Standard" });

/** One `calendars:` list entry's value (everything after `Name:`). */
export function parseCalendarEntry(name, rest) {
  let text = rest;
  let hours = null;
  const hoursMatch = HOURS_RE.exec(text);
  if (hoursMatch) {
    hours = [hoursMatch[1], hoursMatch[2]];
    text = text.slice(0, hoursMatch.index) + text.slice(hoursMatch.index + hoursMatch[0].length);
  }

  let exceptions = new Set();
  const exceptionsMatch = EXCEPTIONS_RE.exec(text);
  if (exceptionsMatch) {
    exceptions = parseExceptions(exceptionsMatch[1]);
    text = text.slice(0, exceptionsMatch.index) + text.slice(exceptionsMatch.index + exceptionsMatch[0].length);
  }

  const weekPattern = parseWeekPattern(text.trim());
  return new Calendar({ name, weekPattern, hours, exceptions });
}

/**
 * Named project calendars from the plan's `calendars:` front-matter list,
 * and which one is active (`calendar:`). Mirrors
 * FrontMatterParser.parse_calendars()/active_calendar() closely enough
 * that the two engines agree, without depending on parseFrontMatter's
 * simple key/value/list model (a calendar entry's value has its own
 * embedded grammar that a generic list parser would mangle).
 */
export function parseCalendars(planText) {
  const calendars = new Map();
  const fm = /^---\n([\s\S]*?)\n---/.exec(String(planText || ""));
  const lines = fm ? fm[1].split("\n") : [];

  let inList = false;
  for (const raw of lines) {
    const stripped = raw.trim();
    if (stripped.toLowerCase() === "calendars:") { inList = true; continue; }
    if (!inList) continue;
    if (stripped.startsWith("- ") && stripped.slice(2).includes(":")) {
      const entry = stripped.slice(2);
      const colon = entry.indexOf(":");
      const name = entry.slice(0, colon).trim();
      const rest = entry.slice(colon + 1).trim();
      try {
        calendars.set(name, parseCalendarEntry(name, rest));
      } catch (error) {
        console.warn(`[calendar] skipping invalid calendar ${JSON.stringify(name)}:`, error.message);
      }
    } else if (stripped && !stripped.startsWith("#")) {
      inList = false;
    }
  }

  if (!calendars.size) calendars.set(STANDARD_CALENDAR.name, STANDARD_CALENDAR);
  return calendars;
}

/** The `calendar:` top-level key's value, or null. */
export function parseActiveCalendarName(planText) {
  const fm = /^---\n([\s\S]*?)\n---/.exec(String(planText || ""));
  if (!fm) return null;
  for (const raw of fm[1].split("\n")) {
    const match = /^calendar:\s*(.*)$/i.exec(raw.trim());
    if (match && match[1].trim()) return match[1].trim();
  }
  return null;
}

/** The project's active calendar: named by `calendar:`, falling back to
 * Standard when unset or when the named calendar isn't declared. */
export function activeCalendar(planText) {
  const calendars = parseCalendars(planText);
  const activeName = parseActiveCalendarName(planText);
  if (activeName) {
    if (calendars.has(activeName)) return calendars.get(activeName);
    console.warn(`[calendar] calendar: ${JSON.stringify(activeName)} not found among calendars:, falling back to Standard`);
  }
  return calendars.get(STANDARD_CALENDAR.name) || STANDARD_CALENDAR;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    DAY_NAMES, ROTATION_EPOCH_DAY, CalendarFormatError, Calendar, STANDARD_CALENDAR,
    parseWeekPattern, weekPatternText, parseCalendarEntry, parseCalendars,
    parseActiveCalendarName, activeCalendar,
  };
}
