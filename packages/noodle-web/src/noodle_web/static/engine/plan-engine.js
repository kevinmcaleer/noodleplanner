/**
 * The browser plan engine's public entry point (issue #793).
 *
 * `parsePlan(planText, { projectName, today })` returns the same object
 * `POST /api/parse` returns — the same keys, the same shapes, the same
 * quirks — computed entirely in the browser. It is the one call the rest of
 * the app should need:
 *
 *     import { parsePlan } from "./engine/plan-engine.js";
 *     const result = parsePlan(editor.value);
 *
 * Nothing here touches the DOM, `localStorage`, `fetch` or the clock unless
 * asked, so it runs unchanged inside a Web Worker; `today` is a parameter so
 * a caller (the conformance test, a "what if" view) can schedule from any
 * date.
 *
 * Two things are deliberately faithful rather than better:
 *
 * * The project calendar is parsed but **not applied** by default, because
 *   `/api/parse` calls `schedule_tasks(phases)` with no holidays. Pass
 *   `applyCalendar: true` to schedule with the front matter's non-working
 *   days and each resource's own.
 * * The RAID, comms, benefits, lessons and baseline markdown tables are not
 *   parsed into items here: those lists come back empty, exactly as they do
 *   for a plan without those sections. `unsupportedSections(planText)` says
 *   whether a given plan has any, so a caller can fall back to the server or
 *   to the page's own extractors for them.
 */
import { dayOf } from "./date-math.js";
import { scheduleTasksFromText } from "./scheduler.js";
import {
  collectLabelsFromPlan,
  convertPlanFormatToStandard,
  extractHighlights,
  unsupportedSections,
  updateFrontMatterWithLabels,
} from "./plan-text.js";
import {
  extractTitleFromFrontMatter,
  parseFrontMatter,
  parseNonWorkingDays,
  parseProgrammeDependencies,
  parseResourceMappings,
  parseResourceRoles,
  parseStakeholders,
} from "./front-matter.js";

/** The project name the server would resolve: the request, the title, or "Project". */
export function resolveProjectName(planText, projectName = null) {
  return projectName || extractTitleFromFrontMatter(planText) || "Project";
}

/**
 * Parse and schedule a plan.
 *
 * @param {string} planText the markdown the user wrote, front matter and all
 * @param {object} [options]
 * @param {string} [options.projectName] overrides the front matter's title
 * @param {string|Date|number} [options.today] the date undated tasks start
 *   from, and the date progress is judged against; defaults to the real one
 * @param {boolean} [options.applyCalendar] schedule around the front
 *   matter's non-working days (the server does not; see the module note)
 * @returns {object} the `/api/parse` payload
 */
export function parsePlan(planText, options = {}) {
  const text = String(planText === null || planText === undefined ? "" : planText);
  const today = options.today === undefined || options.today === null
    ? dayOf(new Date())
    : dayOf(options.today);

  // These are available whether or not the tasks parse, as they are on the
  // server: a plan that fails to schedule still shows its highlights.
  const highlights = extractHighlights(text);
  const stakeholders = parseStakeholders(text);
  const dependencies = parseProgrammeDependencies(text);

  const base = {
    highlights,
    raid_items: [],
    comms_items: [],
    baseline_items: [],
    benefits_items: [],
    lessons_items: [],
    dependencies,
    stakeholders,
  };

  try {
    const projectName = resolveProjectName(text, options.projectName);
    const converted = convertPlanFormatToStandard(text);
    const { resourceMap, resourceNonWorkingDays } = parseResourceMappings(text);
    const resourceRoles = parseResourceRoles(text);
    const frontMatter = parseFrontMatter(text);

    const scheduleOptions = { today, resourceMap };
    if (options.applyCalendar) {
      scheduleOptions.holidays = parseNonWorkingDays(text);
      scheduleOptions.resourceNonWorkingDays = resourceNonWorkingDays;
    }
    const tasks = scheduleTasksFromText(converted, scheduleOptions);

    const labels = collectLabelsFromPlan(text);
    const updatedPlanText = labels.size ? updateFrontMatterWithLabels(text, labels) : null;

    return {
      success: true,
      project_name: projectName,
      front_matter: frontMatter,
      resource_map: resourceMap,
      resource_roles: resourceRoles,
      tasks,
      updated_plan_text: updatedPlanText,
      error: null,
      ...base,
    };
  } catch (error) {
    return {
      success: false,
      project_name: options.projectName || "Project",
      front_matter: {},
      resource_map: {},
      resource_roles: {},
      tasks: [],
      updated_plan_text: null,
      error: error && error.message ? error.message : String(error),
      ...base,
    };
  }
}

export { unsupportedSections };

if (typeof module !== "undefined" && module.exports) {
  module.exports = { parsePlan, resolveProjectName, unsupportedSections };
}
