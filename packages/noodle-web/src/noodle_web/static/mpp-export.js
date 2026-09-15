/**
 * Native .mpp export and import, entirely in the browser.
 *
 * Export builds the Microsoft Project file from the plan the page has
 * already had scheduled (`/api/parse`, held in `lastParseResult`) with the
 * vendored mppwriter library. The only request it makes is for the template
 * `.mpp` the deployment serves as a static asset; no plan text, model or file
 * goes to the backend.
 *
 * Import reads a `.mpp` chosen by the user with the same library's
 * `readProject()` and turns it into plan markdown, again with no request.
 *
 * The model mapping mirrors `noodle_core.mpp_writer.build_project_model`
 * field for field; tests/test_mpp_browser_export.mjs asserts the two agree
 * so they cannot drift apart. Everything but `exportMppInBrowser` and
 * `importMppFile` is pure (no fetch, no DOM), which is what lets Node run the
 * same code the browser does.
 */
import { MppWriter, readProject } from "./vendor/mppwriter/index.js";

/** Where the deployment puts the template it saved from Microsoft Project. */
export const TEMPLATE_URL = "/static/mpp-template.mpp";

/** Shown when the bundled template cannot be loaded (a broken deployment). */
export const TEMPLATE_MISSING_MESSAGE =
  "Export to MS Project could not load the template the app ships at " + TEMPLATE_URL +
  ". The deployment is missing or blocking that file; see \"Export your plan\" in the docs.";

// Working day the scheduler assumes; the same times the XML export stamps.
const WORK_START_HOUR = 8;
const WORK_FINISH_HOUR = 17;
const FULL_COMPLETE_EXPORT_NOTE = "NoodlePlanner export: task was 100% complete";

// Lag/lead as date_math.parse_duration_to_days converts it for the scheduler.
const LAG_DAYS = { d: 1, w: 7, m: 30, y: 365 };

const REL_TYPES = new Set(["FS", "SS", "FF", "SF"]);

// --- dates ------------------------------------------------------------------
//
// The parse payload carries date-only strings ("2026-07-01"). mppwriter reads
// dates in UTC because the format stores wall-clock times with no zone, so
// the working-day times are applied with Date.UTC.

function parseYmd(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return [y, m, d];
}

function atHour(iso, hour) {
  const [y, m, d] = parseYmd(iso);
  return new Date(Date.UTC(y, m - 1, d, hour, 0));
}

function shiftDays(iso, days) {
  const [y, m, d] = parseYmd(iso);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function weekday(iso) {
  return new Date(iso + "T00:00:00Z").getUTCDay(); // 0 = Sunday
}

/**
 * The scheduler stores finish dates exclusively (a 5-day task starting
 * Monday finishes on Saturday). Microsoft Project wants the last working day
 * of the task, so step back a day and then off any weekend — the same rule
 * as noodle_core.msproject._inclusive_finish.
 */
export function inclusiveFinish(startIso, finishIso) {
  if (!finishIso) return startIso;
  if (startIso && finishIso <= startIso) return startIso;
  let last = shiftDays(finishIso, -1);
  for (let i = 0; i < 7 && (weekday(last) === 0 || weekday(last) === 6); i++) {
    last = shiftDays(last, -1);
  }
  if (startIso && last < startIso) return startIso;
  return last;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// --- dependencies -----------------------------------------------------------

function splitResources(text) {
  return String(text || "").split(",").map((r) => r.trim().replace(/^@/, "")).filter(Boolean);
}

function hasAssignedResources(text) {
  return splitResources(text).length > 0;
}

function normaliseKey(name) {
  return String(name || "").trim().toLowerCase();
}

function lagDaysOf(offset) {
  const m = /^([+-])(\d+)([dwmy])$/.exec(String(offset || "").trim());
  if (!m) return 0;
  const days = Number(m[2]) * LAG_DAYS[m[3]];
  return m[1] === "-" ? -days : days;
}

/**
 * Decide which dependencies can be written as links.
 *
 * Microsoft Project derives the hierarchy from the outline and rolls a
 * summary's dates up from its subtasks, so a link between a task and its
 * own phase, or one that closes a loop once phase links are expanded to
 * the leaf tasks, makes it refuse the file. A port of
 * noodle_core.msproject._resolve_predecessor_links, including its rule that
 * leaf links are placed first so a conflicting phase link is the one dropped.
 *
 * @returns {{links: Map<number, Array>, dropped: Map<number, string[]>}}
 */
export function resolvePredecessorLinks(tasks, keyToUid) {
  const levels = tasks.map((t) => Math.max(1, Number(t.level) || 1));

  const parent = new Map();
  const stack = [];
  levels.forEach((level, i) => {
    const uid = i + 1;
    while (stack.length && levels[stack[stack.length - 1] - 1] >= level) stack.pop();
    parent.set(uid, stack.length ? stack[stack.length - 1] : null);
    stack.push(uid);
  });

  const children = new Map();
  for (const [uid, p] of parent) {
    if (p !== null) {
      if (!children.has(p)) children.set(p, []);
      children.get(p).push(uid);
    }
  }

  const leafCache = new Map();
  const leaves = (uid) => {
    if (!leafCache.has(uid)) {
      const kids = children.get(uid);
      leafCache.set(uid, kids ? new Set(kids.flatMap((k) => [...leaves(k)])) : new Set([uid]));
    }
    return leafCache.get(uid);
  };

  const isAncestor = (candidate, uid) => {
    let node = parent.get(uid);
    while (node !== null && node !== undefined) {
      if (node === candidate) return true;
      node = parent.get(node);
    }
    return false;
  };

  const successors = new Map();
  const reaches = (sources, targets) => {
    const seen = new Set(sources);
    const frontier = [...sources];
    while (frontier.length) {
      const node = frontier.pop();
      if (targets.has(node)) return true;
      for (const next of successors.get(node) || []) {
        if (!seen.has(next)) {
          seen.add(next);
          frontier.push(next);
        }
      }
    }
    return false;
  };

  const links = new Map();
  const dropped = new Map();
  const order = [
    ...tasks.map((t, i) => (t.is_summary ? null : i + 1)).filter(Boolean),
    ...tasks.map((t, i) => (t.is_summary ? i + 1 : null)).filter(Boolean),
  ];

  for (const uid of order) {
    const task = tasks[uid - 1];
    const depTypes = task.dependency_types || {};
    const lagLead = task.lag_lead || {};
    const written = new Set();
    for (const depName of task.depends || []) {
      const predUid = keyToUid.get(normaliseKey(depName));
      if (!predUid || written.has(predUid)) continue;

      const predLeaves = leaves(predUid);
      const succLeaves = leaves(uid);
      let reason = null;
      if (predUid === uid) {
        reason = "a task cannot depend on itself";
      } else if (isAncestor(predUid, uid)) {
        reason = "MS Project cannot link a task to its own summary task";
      } else if (isAncestor(uid, predUid)) {
        reason = "MS Project cannot link a summary task to one of its own subtasks";
      } else if (reaches(succLeaves, predLeaves)) {
        reason = "together with the other links it would form a circular relationship in MS Project";
      }

      if (reason === null) {
        const rawType = String(depTypes[depName] || "FS").toUpperCase();
        if (!links.has(uid)) links.set(uid, []);
        links.get(uid).push({
          predUid,
          type: REL_TYPES.has(rawType) ? rawType : "FS",
          lagDays: lagDaysOf(lagLead[depName]),
        });
        written.add(predUid);
        for (const leaf of predLeaves) {
          if (!successors.has(leaf)) successors.set(leaf, new Set());
          for (const s of succLeaves) successors.get(leaf).add(s);
        }
        continue;
      }

      if (!dropped.has(uid)) dropped.set(uid, []);
      dropped.get(uid).push(
        `Dependency on "${tasks[predUid - 1].name}" was not exported: ${reason}.`,
      );
    }
  }

  return { links, dropped };
}

// --- model ------------------------------------------------------------------

/**
 * The scheduled plan, as mppwriter's Project, from a `/api/parse` payload.
 *
 * Same mapping as noodle_core.mpp_writer.build_project_model: task UIDs in
 * outline order, parents from the level sequence, milestone = zero duration
 * and not a summary, inclusive finish at 17:00, resources folded
 * case-insensitively to one display name, links filtered as above.
 */
export function buildProjectFromParse(parse, projectName) {
  const tasks = (parse && parse.tasks) || [];
  const frontMatter = (parse && parse.front_matter) || {};
  const title = projectName || (parse && parse.project_name) || frontMatter.title || "Project";

  // last occurrence wins, matching the scheduler's own lookup
  const keyToUid = new Map();
  tasks.forEach((t, i) => keyToUid.set(normaliseKey(t.key ?? t.name), i + 1));

  const { links, dropped } = resolvePredecessorLinks(tasks, keyToUid);

  const resourceNames = new Map(); // lower-cased → display name
  for (const t of tasks) {
    for (const r of splitResources(t.resources)) {
      const key = r.toLowerCase();
      if (!resourceNames.has(key)) resourceNames.set(key, r);
    }
  }
  const resourceUid = new Map([...resourceNames.keys()].sort().map((key, i) => [key, i + 1]));

  const fallbackStart = todayIso();
  const outTasks = [];
  const relations = [];
  const assignments = [];
  const parents = [];

  tasks.forEach((t, i) => {
    const uid = i + 1;
    const durationDays = Math.max(0, Math.trunc(Number(t.duration_days) || 0));
    const isSummary = Boolean(t.is_summary);
    const isMilestone = durationDays === 0 && !isSummary;
    const level = Math.max(1, Number(t.level) || 1);
    const startIso = t.start || fallbackStart;
    const finishIso = t.finish || startIso;

    const start = atHour(startIso, WORK_START_HOUR);
    const finish = isMilestone ? start : atHour(inclusiveFinish(startIso, finishIso), WORK_FINISH_HOUR);

    while (parents.length && parents[parents.length - 1][0] >= level) parents.pop();
    const parentUid = level > 1 && parents.length ? parents[parents.length - 1][1] : 0;

    const percentComplete = Math.trunc(Number(t.percent) || 0);
    const preserveFullComplete =
      !isSummary &&
      durationDays > 0 &&
      percentComplete >= 100 &&
      hasAssignedResources(t.resources);
    const notes = [t.comment || "", ...(dropped.get(uid) || [])].filter(Boolean).join("\n");

    outTasks.push({
      uid,
      name: String(t.name || ""),
      start,
      finish,
      durationDays,
      outlineLevel: level,
      parentUid,
      percentComplete,
      taskType: "fixed_duration",
      notes: preserveFullComplete ? [notes, FULL_COMPLETE_EXPORT_NOTE].filter(Boolean).join("\n") : notes,
    });
    parents.push([level, uid]);

    for (const r of splitResources(t.resources)) {
      const rUid = resourceUid.get(r.toLowerCase());
      if (rUid && !assignments.some((a) => a.taskUid === uid && a.resourceUid === rUid)) {
        assignments.push({ taskUid: uid, resourceUid: rUid, units: 1.0 });
      }
    }
    for (const link of links.get(uid) || []) {
      relations.push({ predUid: link.predUid, succUid: uid, type: link.type, lagDays: link.lagDays });
    }
  });

  const resources = [...resourceUid]
    .sort((a, b) => a[1] - b[1])
    .map(([key, uid]) => ({ uid, name: resourceNames.get(key) }));

  const projectStart = outTasks.length
    ? new Date(Math.min(...outTasks.map((t) => t.start.getTime())))
    : atHour(fallbackStart, WORK_START_HOUR);

  return {
    title,
    start: projectStart,
    tasks: outTasks,
    relations,
    resources,
    assignments,
    comments: "Exported by NoodlePlanner",
  };
}

// --- assignment/date consistency (Snakie#975) --------------------------------
//
// mppwriter/pymppwriter write an assignment's Work as a single aggregate
// value (assignment var entry 49) rather than a true timephased actual/
// remaining contour. Per the library's own docs/FORMAT_NOTES.md ("Progress
// on assigned tasks"), that is verified safe at 0% complete (no actual-work
// data is written at all) and at 100% (a separately tested, already-flagged
// ScheduleWarning: the task's dates hold, only the percentage reads back at
// 99% on reopen) — but a task with an assignment and a percent strictly
// between 1 and 99 has only been checked against the library's own reader,
// never against Microsoft Project's real scheduler. That gap is what lets
// Project's own reconciliation between a task's declared percent-complete
// and its assignment's incomplete progress data decide the resource's work
// no longer fits the task's stated dates, and offer to change the duration:
// "The resource is assigned outside dates for task ... The duration of this
// fixed duration task will change to accommodate the resource assignment."
// Task 81 ("Bradford optimisation 15d @Jack 53% 2026-08-24") is exactly this
// shape.

/**
 * Non-summary, non-milestone tasks with a resource assignment and a percent
 * complete strictly between 0 and 100 — the shape that risks Microsoft
 * Project's "resource is assigned outside dates" warning on open. Pure: only
 * reads the fields already in a `/api/parse` payload, so this can run ahead
 * of (or entirely without) building or opening the actual .mpp file.
 */
export function findAssignmentDateRiskTasks(parse) {
  const tasks = (parse && parse.tasks) || [];
  const risky = [];
  for (const t of tasks) {
    if (t.is_summary) continue;
    const durationDays = Math.trunc(Number(t.duration_days) || 0);
    if (durationDays <= 0) continue; // milestones carry no assignment work
    if (splitResources(t.resources).length === 0) continue;
    const percent = Math.trunc(Number(t.percent) || 0);
    if (percent > 0 && percent < 100) {
      risky.push({ name: String(t.name || ""), percent });
    }
  }
  return risky;
}

/**
 * The percent-complete this class of risk resolves to when "fixed": whichever
 * of 0% (no progress written) or 100% (a separately safe, already-flagged
 * case) is nearer the task's current percent.
 */
export function safeAssignmentPercent(percent) {
  return percent >= 50 ? 100 : 0;
}

/** The status-bar/export-log message for one task {name, percent}. */
export function assignmentDateRiskMessage(task) {
  return `"${task.name}" is ${task.percent}% complete with an assigned resource; ` +
    "Microsoft Project may report the resource as assigned outside the task's " +
    "dates and change its duration to fit when the exported .mpp is opened.";
}

/**
 * Build the file bytes. Pure: no fetch, no DOM.
 * @param {object} project from buildProjectFromParse
 * @param {Uint8Array} templateBytes a template saved by Microsoft Project
 * @param {(warning: Error) => void} [onWarning]
 */
export function buildMpp(project, templateBytes, onWarning) {
  const writer = new MppWriter(templateBytes, {
    onWarning: onWarning ?? ((w) => console.warn("[mpp]", w.message)),
  });
  return writer.build(project);
}

/** The template, or null when the deployment has not provided one. */
export async function fetchTemplate(url = TEMPLATE_URL, fetchImpl = globalThis.fetch) {
  try {
    const response = await fetchImpl(url);
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    // a compound file starts with the OLE magic; anything else is an error
    // page served with a 200
    const magic = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
    return magic.every((b, i) => bytes[i] === b) ? bytes : null;
  } catch {
    return null;
  }
}

/** A safe file-name stem from a project title. */
export function filenameStem(title) {
  const stem = String(title || "project").trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return stem || "project";
}

function downloadBytes(bytes, filename) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.ms-project" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Export in the browser from an already-scheduled plan.
 *
 * The only request is for the template asset; a missing one throws
 * TEMPLATE_MISSING_MESSAGE rather than falling back to a server export.
 *
 * @param {object} parse the `/api/parse` payload for the current plan
 * @param {string} [projectName]
 * @param {{fetch?: Function, download?: Function, onWarning?: Function}} [io]
 *   overridable for tests
 * @returns {Promise<{filename: string, bytes: Uint8Array, warnings: string[]}>}
 */
export async function exportMppInBrowser(parse, projectName, io = {}) {
  const template = await fetchTemplate(TEMPLATE_URL, io.fetch || globalThis.fetch);
  if (!template) throw new Error(TEMPLATE_MISSING_MESSAGE);

  const project = buildProjectFromParse(parse, projectName);
  const warnings = [];
  const bytes = buildMpp(project, template, (w) => warnings.push(w.message));
  for (const task of findAssignmentDateRiskTasks(parse)) {
    warnings.push(assignmentDateRiskMessage(task));
  }
  for (const message of warnings) console.warn("[mpp]", message);

  const filename = `${filenameStem(project.title)}.mpp`;
  (io.download || downloadBytes)(bytes, filename);
  return { filename, bytes, warnings };
}

// --- import -----------------------------------------------------------------

/**
 * A short resource name from a full name, as noodle_core.msproject
 * _generate_shortname does: "Kevin McAleer" → "kmcaleer", "Alice" → "alice".
 */
export function generateShortname(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].toLowerCase();
  return (parts[0][0] + parts[parts.length - 1]).toLowerCase();
}

/**
 * Map of full resource name (lower-cased) → shortname, read from a plan's
 * `Resources:` front matter (`- @jd: Jane Doe`). A .mpp file's resource
 * table only ever carries the full name -- the `@jd` shortcode is plan
 * markdown syntax with no home in the binary format -- so re-deriving a
 * shortname from scratch on every reimport (generateShortname's
 * first-initial-plus-surname heuristic) can land on something other than
 * what the plan already uses (e.g. "Jane Doe" → "jdoe", not the plan's own
 * "@jd"). That shows up as a spurious per-task diff on every field
 * referencing the resource, on every sync, forever (#912). Passing this map
 * into projectToMarkdown lets a sync reuse the plan's own shortnames instead.
 */
export function parseResourceShortnames(planText) {
  const shortnameByFullName = new Map();
  const lines = String(planText || "").split("\n");
  let inFrontMatter = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "---") {
      if (inFrontMatter) break;
      inFrontMatter = true;
      continue;
    }
    if (!inFrontMatter) continue;
    const match = trimmed.match(/^-\s*@(\w+):\s*(.+)/);
    if (!match) continue;
    const fullName = match[2].split(",")[0].trim();
    if (fullName) shortnameByFullName.set(fullName.toLowerCase(), match[1]);
  }
  return shortnameByFullName;
}

/** Notes the exporter wrote about links it left out are not plan content. */
function isExportNote(line) {
  return /^Dependency on ".*" was not exported: /.test(line) || line === FULL_COMPLETE_EXPORT_NOTE;
}

function hasFullCompleteExportNote(notes) {
  return String(notes || "")
    .split(/\r?\n/)
    .some((line) => line.trim() === FULL_COMPLETE_EXPORT_NOTE);
}

function lagToken(lagDays) {
  const days = Math.round(Number(lagDays) || 0);
  if (days === 0) return "";
  return (days > 0 ? " +" : " -") + Math.abs(days) + "d";
}

/**
 * Plan markdown from a project read back with mppwriter's `readProject()`.
 *
 * Mirrors noodle_core.msproject.import_from_mpp (front matter with resource
 * shortnames, indented outline, `*` for a single link to the previous task,
 * `[depends …]` otherwise, without the colon the Python importer wrote, #808)
 * and additionally keeps what that importer drops:
 * milestones as `0d`, dependency type and lag as `Name:SS +2d`, and task
 * notes as a quoted comment.
 *
 * `preferredShortnames` (full name, lower-cased → shortname) is consulted
 * before generateShortname's heuristic, so a sync reimport can reuse the
 * current plan's own shortcodes instead of deriving new ones (#912).
 */
export function projectToMarkdown(project, preferredShortnames) {
  const title = project.title || "Project";
  const tasks = (project.tasks || []).filter((t) => t.name);
  const resources = (project.resources || []).filter((r) => r.name);

  const shortnames = new Map(); // resource uid → shortname
  const used = new Set();
  for (const r of [...resources].sort((a, b) => a.uid - b.uid)) {
    const preferred = preferredShortnames && preferredShortnames.get(String(r.name).toLowerCase());
    const base = preferred || generateShortname(r.name);
    let short = base;
    let counter = 2;
    while (used.has(short)) short = `${base}${counter++}`;
    used.add(short);
    shortnames.set(r.uid, short);
  }

  const taskResources = new Map();
  for (const a of project.assignments || []) {
    if (shortnames.has(a.resourceUid)) {
      if (!taskResources.has(a.taskUid)) taskResources.set(a.taskUid, []);
      taskResources.get(a.taskUid).push(a.resourceUid);
    }
  }

  const nameByUid = new Map(tasks.map((t) => [t.uid, t.name]));
  const hasChildren = new Set(tasks.map((t) => t.parentUid).filter((p) => p));
  const uids = tasks.map((t) => t.uid);

  const lines = ["---", `title: ${title}`];
  if (resources.length) {
    lines.push("Resources:");
    for (const r of [...resources].sort((a, b) => a.uid - b.uid)) {
      lines.push(`- @${shortnames.get(r.uid)}: ${r.name}`);
    }
  }
  lines.push("---", "");

  tasks.forEach((task, idx) => {
    const indent = "  ".repeat(Math.max(0, (task.outlineLevel || 1) - 1));
    const summary = hasChildren.has(task.uid);
    const parts = [task.name];

    if (!summary) {
      const days = Number(task.durationDays);
      if (Number.isFinite(days)) {
        parts.push(days > 0 ? `${Math.max(1, Math.trunc(days))}d` : "0d");
      }
    }

    for (const rUid of taskResources.get(task.uid) || []) {
      parts.push(`@${shortnames.get(rUid)}`);
    }

    // A summary's percent is rolled up from its subtasks by Project and by
    // NoodlePlanner alike, so it is derived, not plan content.
    let percent = Math.trunc(Number(task.percentComplete) || 0);
    if (percent === 99 && hasFullCompleteExportNote(task.notes)) percent = 100;
    if (percent > 0 && !summary) parts.push(`${percent}%`);

    const preds = (project.relations || []).filter(
      (r) => r.succUid === task.uid && nameByUid.has(r.predUid),
    );
    let prefix = "";
    if (preds.length) {
      const plain = (r) => (!r.type || r.type === "FS") && !Math.round(Number(r.lagDays) || 0);
      if (preds.length === 1 && idx > 0 && preds[0].predUid === uids[idx - 1] && plain(preds[0])) {
        prefix = "*";
      } else {
        const refs = preds.map((r) => {
          const type = r.type && r.type !== "FS" ? `:${r.type}` : "";
          return `${nameByUid.get(r.predUid)}${type}${lagToken(r.lagDays)}`;
        });
        parts.push(`[depends ${refs.join(", ")}]`);
      }
    }

    const note = String(task.notes || "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !isExportNote(l))
      .join(" ");
    if (note && !note.includes('"')) parts.push(`"${note}"`);

    lines.push(`${indent}${prefix}${parts.join(" ")}`);
  });

  return lines.join("\n") + "\n";
}

/**
 * Markdown from the bytes of a .mpp file. Pure.
 *
 * `preferredShortnames` (see projectToMarkdown) lets a sync reimport reuse
 * the current plan's own resource shortcodes; omit it for a first-ever
 * import, where there is no existing plan to match against.
 */
export function importMppBytes(bytes, preferredShortnames) {
  return projectToMarkdown(readProject(bytes), preferredShortnames);
}

/** Markdown from a File the user chose. Reads it locally; no request. */
export async function importMppFile(file, preferredShortnames) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return importMppBytes(bytes, preferredShortnames);
}
