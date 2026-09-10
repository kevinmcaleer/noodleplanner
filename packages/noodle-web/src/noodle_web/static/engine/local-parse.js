/**
 * The local stand-in for `POST /api/parse` (issue #793).
 *
 * `localParse(planText, projectName)` assembles the same object the endpoint
 * returns, so `updateAllViews` can be handed either one: the scheduled tasks
 * come from the browser engine, and the back-matter sections from the
 * extractors the page already carries (`extractHighlightsFromText` and
 * friends in script.js), which is where they were parsed client-side even
 * before this.
 *
 * On by default, now that the browser engine matches the Python one across
 * the whole conformance corpus. Set `np-local-engine` to "0" in localStorage
 * to force the server, or "1" to be explicit. `useLocalEngine()` is what
 * script.js asks.
 */
import { scheduleTasksFromText, dayOf } from "./scheduler.js";

export const LOCAL_ENGINE_KEY = "np-local-engine";

/** Whether this browser should schedule locally rather than call the server. */
export function useLocalEngine(defaultOn = true) {
  try {
    const setting = localStorage.getItem(LOCAL_ENGINE_KEY);
    if (setting === "1") return true;
    if (setting === "0") return false;
    return defaultOn;
  } catch {
    return defaultOn;
  }
}

/** The front-matter block's raw text, or "" when there is none. */
export function frontMatterText(planText) {
  const match = /^---\n([\s\S]*?)\n---/.exec(String(planText || ""));
  return match ? match[1] : "";
}

/**
 * Remove a trailing bare `---` separator line, if present. It's only
 * meaningful as a visual lead-in to a back-matter section; once whatever
 * followed it has been sliced away (or there was never anything there --
 * a hand-typed divider with nothing after it), the `---` marks nothing and
 * would otherwise be scheduled as a phantom task named "---". Mirrors
 * format_converter.py's `_strip_trailing_bare_separator`. Multiple stacked
 * bare lines are all removed.
 */
function stripTrailingBareSeparator(text) {
  text = text.replace(/\n+$/, "");
  const lines = text.split("\n");
  while (lines.length && lines[lines.length - 1].trim() === "---") lines.pop();
  return lines.join("\n");
}

/** The plan body: no front matter, and nothing from the first back-matter marker on. */
export function planBody(planText) {
  let text = String(planText || "");
  const fm = /^---\n[\s\S]*?\n---\n?/.exec(text);
  if (fm) text = text.slice(fm[0].length);
  const marker = /^---[a-z][a-z -]*---$/m.exec(text);
  if (marker) text = text.slice(0, marker.index);
  return stripTrailingBareSeparator(text);
}

/**
 * Front matter as the server returns it: simple `key: value` pairs, with
 * list-valued keys collected. Values are kept as written.
 */
export function parseFrontMatter(planText) {
  const out = {};
  let currentList = null;

  for (const raw of frontMatterText(planText).split("\n")) {
    if (!raw.trim()) continue;

    if (raw.trimStart().startsWith("- ")) {
      if (currentList) out[currentList].push(raw.trim().slice(2).trim());
      continue;
    }
    const kv = /^([^:]+):\s*(.*)$/.exec(raw);
    if (!kv) continue;
    const key = kv[1].trim();
    const value = kv[2].trim();
    if (value === "") {
      currentList = key;
      out[key] = [];
    } else {
      currentList = null;
      out[key] = value;
    }
  }
  return out;
}

/** Resource shortnames to display names, from the front matter's list. */
export function parseResourceMap(planText) {
  const map = {};
  for (const raw of frontMatterText(planText).split("\n")) {
    const entry = /^-\s*@(\S+?):\s*(.*)$/.exec(raw.trim());
    if (!entry) continue;
    let rest = entry[2].replace(/,?\s*non-working\s*\[[^\]]*\]\s*$/, "");
    map[entry[1].toLowerCase()] = rest.split(",")[0].trim();
  }
  return map;
}

/** Project-wide and per-resource non-working days, as day-number sets. */
export function parseCalendar(planText) {
  const holidays = new Set();
  const resourceNonWorkingDays = new Map();
  let inList = false;

  for (const raw of frontMatterText(planText).split("\n")) {
    const line = raw.trim();
    const lower = line.toLowerCase();

    if (lower === "non-working-days:" || lower === "holidays:") { inList = true; continue; }
    if (inList) {
      if (line.startsWith("- ")) {
        const entry = line.slice(2).trim();
        const named = /^(?:(.+?):\s*)?(\d{4}-\d{2}-\d{2})(?::(\d{4}-\d{2}-\d{2}))?$/.exec(entry);
        if (named) {
          const start = dayOf(named[2]);
          const end = named[3] ? dayOf(named[3]) : start;
          for (let d = start; d <= end; d++) holidays.add(d);
        }
        continue;
      }
      inList = false;
    }

    const resource = /^-\s*@(\S+?):\s*(.*)$/.exec(line);
    if (!resource) continue;
    const nwd = /non-working\s*\[([^\]]*)\]/.exec(resource[2]);
    if (!nwd) continue;
    const days = new Set();
    for (const part of nwd[1].split(",")) {
      const span = part.trim();
      const range = /^(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/.exec(span);
      if (range) for (let d = dayOf(range[1]); d <= dayOf(range[2]); d++) days.add(d);
      else if (/^\d{4}-\d{2}-\d{2}$/.test(span)) days.add(dayOf(span));
    }
    resourceNonWorkingDays.set(resource[1].toLowerCase(), days);
  }
  return { holidays, resourceNonWorkingDays };
}

/** Call a section extractor the page defines, or fall back to []. */
function fromPage(name, ...args) {
  const fn = typeof globalThis !== "undefined" ? globalThis[name] : undefined;
  if (typeof fn !== "function") return [];
  try {
    return fn(...args) || [];
  } catch (error) {
    console.warn(`[engine] ${name} failed:`, error);
    return [];
  }
}

/**
 * The `/api/parse` payload, computed locally.
 *
 * @param {string} planText
 * @param {string} [projectName]
 * @param {object} [options] { applyCalendar } — the front-matter calendar
 *   (project holidays and per-resource non-working days) is applied by
 *   default now that the server applies it too (issue #837), so the two
 *   engines keep answering alike. Pass `applyCalendar: false` to schedule
 *   without it.
 */
export function localParse(planText, projectName = null, options = {}) {
  const text = String(planText || "");
  const frontMatter = parseFrontMatter(text);
  const resourceMap = parseResourceMap(text);

  const resolvedName = projectName || frontMatter.title || "Project";

  const scheduleOptions = { resourceMap };
  if (options.applyCalendar !== false) {
    const { holidays, resourceNonWorkingDays } = parseCalendar(text);
    scheduleOptions.holidays = holidays;
    scheduleOptions.resourceNonWorkingDays = resourceNonWorkingDays;
  }

  let tasks = [];
  let success = true;
  let error = null;
  try {
    tasks = scheduleTasksFromText(planBody(text), scheduleOptions);
  } catch (e) {
    success = false;
    error = e.message;
    console.error("[engine] scheduling failed:", e);
  }

  return {
    success,
    error,
    project_name: resolvedName,
    ascii_output: "",            // opt-in on the server too (#789)
    front_matter: frontMatter,
    resource_map: resourceMap,
    tasks,
    updated_plan_text: null,     // the labels rewrite stays server-side (#771)
    highlights: fromPage("extractHighlightsFromText", text),
    raid_items: fromPage("extractRaidItemsFromPlanText", text),
    comms_items: fromPage("extractCommsItemsFromPlanText", text),
    baseline_items: fromPage("extractBaselineItemsFromPlanText", text),
    benefits_items: fromPage("extractBenefitsItemsFromPlanText", text),
    lessons_items: fromPage("extractLessonsItemsFromPlanText", text),
    stakeholders: fromPage("extractStakeholdersFromPlanText", text),
    dependencies: [],
    resource_roles: {},
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    localParse, useLocalEngine, parseFrontMatter, parseResourceMap,
    parseCalendar, planBody, frontMatterText, LOCAL_ENGINE_KEY,
  };
}
