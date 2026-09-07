/**
 * The local stand-in for `POST /api/parse` (issue #793).
 *
 * `localParse(planText, projectName)` returns the same object the endpoint
 * returns, so `updateAllViews` can be handed either one. The payload itself
 * is built by ./plan-engine.js, which is held to the Python engine field for
 * field by tests/test_engine_conformance.mjs; this module adds only what is
 * particular to running inside the page:
 *
 *   - the localStorage switch that chooses engine or server, and
 *   - the back-matter tables (RAID, comms, benefits, lessons, baseline) that
 *     the engine does not read yet, which come from the extractors script.js
 *     already carries — where they were parsed client-side even before this.
 *
 * On by default, now that the browser engine matches the Python one across
 * the whole conformance corpus. Set `np-local-engine` to "0" in localStorage
 * to force the server, or "1" to be explicit. `useLocalEngine()` is what
 * script.js asks.
 */
import { parsePlan, unsupportedSections } from "./plan-engine.js";
import {
  frontMatterLines,
  parseFrontMatter,
  parseNonWorkingDays,
  parseResourceMappings,
} from "./front-matter.js";
import { convertPlanFormatToStandard } from "./plan-text.js";

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
  return frontMatterLines(planText).join("\n");
}

/** The plan as the scheduler reads it: no front matter, no back matter. */
export function planBody(planText) {
  return convertPlanFormatToStandard(planText);
}

/** Resource shortnames to display names, from the front matter's list. */
export function parseResourceMap(planText) {
  return parseResourceMappings(planText).resourceMap;
}

/** Project-wide and per-resource non-working days, as day-number sets. */
export function parseCalendar(planText) {
  return {
    holidays: parseNonWorkingDays(planText),
    resourceNonWorkingDays: parseResourceMappings(planText).resourceNonWorkingDays,
  };
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

/** The back-matter lists plan-engine.js does not read, and who can. */
const PAGE_EXTRACTORS = {
  raid_items: "extractRaidItemsFromPlanText",
  comms_items: "extractCommsItemsFromPlanText",
  benefits_items: "extractBenefitsItemsFromPlanText",
  lessons_items: "extractLessonsItemsFromPlanText",
  baseline_items: "extractBaselineItemsFromPlanText",
};

/**
 * The `/api/parse` payload, computed locally.
 *
 * @param {string} planText
 * @param {string} [projectName]
 * @param {object} [options] { today, applyCalendar } — the server ignores the
 *   front-matter calendar (see tests/test_engine_conformance.mjs), so this
 *   does too unless asked, to keep the two engines answering alike.
 */
export function localParse(planText, projectName = null, options = {}) {
  const text = String(planText || "");
  const result = parsePlan(text, {
    projectName,
    today: options.today,
    applyCalendar: options.applyCalendar,
  });

  // /api/parse only fills this in when asked (#789), and no caller reads it.
  result.ascii_output = "";

  for (const [key, extractor] of Object.entries(PAGE_EXTRACTORS)) {
    if (!result[key] || !result[key].length) result[key] = fromPage(extractor, text);
  }

  return result;
}

export { parseFrontMatter, parsePlan, unsupportedSections };

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    localParse, useLocalEngine, parseFrontMatter, parseResourceMap,
    parseCalendar, planBody, frontMatterText, unsupportedSections,
    LOCAL_ENGINE_KEY,
  };
}
