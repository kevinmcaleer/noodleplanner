/**
 * The scheduling engine — a port of noodle_core/scheduling_engine.py and the
 * payload builder in noodle_web/plan_service.py (issue #793).
 *
 * `schedulePlan(planText, options)` returns the same object `/api/parse`
 * returns, so `updateAllViews` can be handed either one.
 *
 * Faithfulness over tidiness: where the Python does something surprising,
 * this reproduces it rather than improving on it, because the conformance
 * corpus pins both engines to the same answers. One example worth knowing:
 *
 * * Dependency lookup is case-insensitive and first-definition-wins (see
 *   taskNameLookup).
 *
 * (Two siblings sharing a name used to collapse into one while the tree was
 * built -- see the _uid/_parentUid note above buildTasks. That was a real,
 * reported bug (#838), fixed in the Python first with a corpus update, and
 * mirrored here.)
 */
import {
  addWorkingDays,
  countWorkingDays,
  dayOf,
  getNextWorkingDay,
  isoOf,
  parseDurationToDays,
  todayWorkingDay,
} from "./date-math.js";
import { extractMetadata, splitStarLag } from "./tokeniser.js";
import { STANDARD_CALENDAR } from "./calendar.js";

export const MAX_NESTING_DEPTH = 20;
export const MAX_TASK_NAME_LENGTH = 500;
export const MAX_TASK_COUNT = 5000;

// --- the outline tree (natural_language_to_yaml) ------------------------------

const HAS_DURATION = /\b\d+[dwmy]\b/;
const HAS_DELIVERABLE = /[/^]?\$[A-Za-z_]/;
const DATE_ANY = /\d{4}-\d{2}-\d{2}/;
const DURATION_AT = /\d+[dwmy]/;
const PERCENT_AT = /\b(\d{1,3})%/;
const PERCENT_STRIP = /\s*\b\d{1,3}%/g;

/** Whether a line carries metadata, and so is a leaf rather than a heading. */
function hasDetails(stripped) {
  return (
    stripped.includes("@") || stripped.includes("%") || stripped.includes("!") ||
    stripped.includes("#") || stripped.includes("2025-") || stripped.includes("2024-") ||
    stripped.includes("2026-") || HAS_DURATION.test(stripped) ||
    stripped.includes('"') || stripped.includes("'") ||
    HAS_DELIVERABLE.test(stripped) || stripped.includes("[")
  );
}

/** The task name: everything before the first metadata token.
 *
 * `"` is one of these boundary characters (matching tokeniser.js's own
 * DESCRIPTION regex, which already stops there) -- found while
 * implementing issue #1020: this list used to omit it, so a line whose
 * only metadata was a quoted comment (e.g. `Phase "note"`) kept the whole
 * line, quotes and all, as its tree-level `name`. That was invisible for a
 * *leaf* task (taskToData() below prefers extractMetadata()'s own,
 * already-correctly-quote-stopped `description` over this raw `name`), but
 * a *summary* task's `description` is this function's output directly
 * (`description: child.name` in buildTasks() below) with no such rescue --
 * so a task with an inline comment lost its clean name, and any whiteboard
 * row keyed on it (or anything else keyed on the task name) silently
 * orphaned, the moment it gained a child. */
function taskNameOf(line) {
  if (!hasDetails(line)) return line.replace(/^\*+/, "");
  // A sequential lag (`* +2d Build 3d`) is blanked first, so neither the
  // `+` nor the `2d` is mistaken for the name or its end.
  const [stripped] = splitStarLag(line);

  let metadataStart = stripped.length;
  for (const ch of ["@", "#", "!", "$", "[", '"']) {
    const pos = stripped.indexOf(ch);
    if (pos > 0) metadataStart = Math.min(metadataStart, pos);
  }
  for (const prefix of ["/$", "^$"]) {
    const pos = stripped.indexOf(prefix);
    if (pos > 0) metadataStart = Math.min(metadataStart, pos);
  }
  const percent = PERCENT_AT.exec(stripped);
  if (percent && percent.index > 0) metadataStart = Math.min(metadataStart, percent.index);
  const date = DATE_ANY.exec(stripped);
  if (date && date.index > 0) metadataStart = Math.min(metadataStart, date.index);
  const duration = DURATION_AT.exec(stripped);
  if (duration && duration.index > 0) metadataStart = Math.min(metadataStart, duration.index);

  return stripped.slice(0, metadataStart).trim().replace(/^\*+/, "").replace(PERCENT_STRIP, "").trim();
}

/**
 * Build the outline tree, then walk it into a flat task list — the Python's
 * natural_language_to_yaml followed by schedule_tasks' traversal, fused.
 */
export function buildTasks(text) {
  const root = { indent: -1, name: "", fullName: "", text: "", hasDetails: false, children: [], level: 0 };
  const stack = [root];

  for (const line of String(text || "").split("\n")) {
    if (!line.trim()) continue;
    if (line.trimStart().startsWith("//")) continue;

    const indent = line.length - line.trimStart().length;
    const stripped = line.trim();
    const name = taskNameOf(stripped);

    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1];
    const node = {
      indent, name, fullName: name, text: stripped,
      hasDetails: hasDetails(stripped),
      children: [], level: Math.min(parent.level + 1, MAX_NESTING_DEPTH),
    };
    parent.children.push(node);
    stack.push(node);
  }

  // Each task gets an internal identity (_uid) distinct from its display
  // name, plus its parent's identity (_parentUid). Two siblings -- or any
  // two tasks anywhere in the plan -- can share a display name; grouping or
  // de-duplicating by name (as an earlier version of this file did, via a
  // Map keyed by child.name) silently merges or drops one of them. That was
  // a real, reported bug in the Python (#838), fixed there first with the
  // same _uid/_parentUid approach; this mirrors it so both engines agree on
  // every fixture, including ones with duplicate sibling/phase names.
  const tasks = [];
  const walk = (node, parentName, depth, parentUid) => {
    if (depth > MAX_NESTING_DEPTH) {
      throw new Error(`Task nesting depth exceeds maximum of ${MAX_NESTING_DEPTH}`);
    }
    for (const child of node.children) {
      if (child.name.length > MAX_TASK_NAME_LENGTH) {
        throw new Error(`Task name '${child.name.slice(0, 50)}...' exceeds maximum length`);
      }
      if (tasks.length >= MAX_TASK_COUNT) {
        throw new Error(`Task count exceeds maximum of ${MAX_TASK_COUNT}`);
      }

      if (child.children.length === 0) {
        const meta = extractMetadata(child.text, child.name);
        // The tokeniser reports an explicit date as an ISO string (the Python
        // returns a datetime); the scheduler works in day numbers throughout.
        if (meta.start !== undefined) meta.start = dayOf(meta.start);
        meta.level = child.level;
        meta.parent = parentName;
        meta.phase = parentName || "";
        meta.summary = false;
        meta._uid = tasks.length;
        meta._parentUid = parentUid;
        tasks.push(meta);
      } else {
        // A summary: its own line may still carry resources, depends, a comment
        const summaryMeta = child.hasDetails ? extractMetadata(child.text, child.name) : {};
        const summary = {
          name: child.name,
          description: child.name,
          level: child.level,
          parent: parentName,
          phase: parentName || "",
          summary: true,
          resources: summaryMeta.resources || "",
          percent: 0,
          comment: summaryMeta.comment || "",
        };
        if (summaryMeta.deliverable) {
          summary.deliverable = summaryMeta.deliverable;
          summary.product_type = summaryMeta.product_type || "internal";
        }
        if (summaryMeta.depends) summary.depends = summaryMeta.depends;
        if (summaryMeta.quality_roles) summary.quality_roles = summaryMeta.quality_roles;
        if (summaryMeta.dependency_types) summary.dependency_types = summaryMeta.dependency_types;
        if (summaryMeta.lag_lead) summary.lag_lead = summaryMeta.lag_lead;
        summary._uid = tasks.length;
        summary._parentUid = parentUid;
        tasks.push(summary);
        walk(child, child.name, depth + 1, summary._uid);
      }
    }
  };
  walk(root, null, 0, null);
  return tasks;
}

// --- scheduling (schedule_tasks) ---------------------------------------------

function durationDaysOf(task) {
  return task.duration_days === undefined || task.duration_days === null ? 1 : task.duration_days;
}

function computeFinish(task, holidays) {
  task.finish = addWorkingDays(task.start, durationDaysOf(task), holidays);
}

/** A task's resource shortnames, lowercased, in task-line order. */
function taskResourceKeys(task) {
  return String(task.resources || "")
    .split(",")
    .map((r) => r.trim().replace(/^@/, "").toLowerCase())
    .filter(Boolean);
}

/**
 * The value to pass as `holidays` to date-math for one task: a plain Set
 * when no calendar is in play at all (unchanged historical behaviour), or
 * a Calendar (issue #1132) -- the task's first resource with an assigned
 * calendar, falling back to the project's `calendar` (or Standard), with
 * the project-wide and resource-specific exception days layered on top.
 */
export function calendarOrHolidaysForTask(task, holidays, resourceNwd, calendar, resourceCalendars) {
  const resourceKeys = taskResourceKeys(task);

  if (!calendar && (!resourceCalendars || !resourceCalendars.size)) {
    let taskHolidays = holidays;
    if (task.resources && resourceNwd.size) {
      taskHolidays = new Set(holidays);
      for (const key of resourceKeys) {
        const days = resourceNwd.get(key);
        if (days) for (const day of days) taskHolidays.add(day);
      }
    }
    return taskHolidays;
  }

  let base = calendar || STANDARD_CALENDAR;
  if (resourceCalendars) {
    for (const key of resourceKeys) {
      if (resourceCalendars.has(key)) { base = resourceCalendars.get(key); break; }
    }
  }

  const extraExceptions = new Set(holidays);
  if (resourceNwd.size) {
    for (const key of resourceKeys) {
      const days = resourceNwd.get(key);
      if (days) for (const day of days) extraExceptions.add(day);
    }
  }
  return base.withExtraExceptions(extraExceptions);
}

/**
 * Schedule a task list in place, exactly as schedule_tasks does.
 *
 * @param {Array} allTasks from buildTasks
 * @param {object} options { holidays: Set, resourceNonWorkingDays: Map, today,
 *   calendar: Calendar, resourceCalendars: Map<string, Calendar> }
 */
export function scheduleTasks(allTasks, options = {}) {
  const holidays = options.holidays || new Set();
  const resourceNwd = options.resourceNonWorkingDays || new Map();
  const calendar = options.calendar || null;
  const resourceCalendars = options.resourceCalendars || null;
  const today = options.today ?? null;

  // Resolve $product references to the task that declares them
  const deliverableLookup = new Map();
  for (const t of allTasks) {
    if (t.deliverable && t.name) deliverableLookup.set(t.deliverable.toLowerCase(), t.name);
  }
  for (const t of allTasks) {
    if (!t.depends || !t.depends.length) continue;
    t.depends = t.depends.map((dep) => {
      if (!dep.startsWith("$")) return dep;
      const resolved = deliverableLookup.get(dep.slice(1).toLowerCase());
      return resolved === undefined ? dep : resolved;
    });
    // the type and lag maps are keyed by the name as written
    for (const map of ["dependency_types", "lag_lead"]) {
      if (!t[map]) continue;
      const rebuilt = {};
      for (const [key, value] of Object.entries(t[map])) {
        const resolved = key.startsWith("$") ? deliverableLookup.get(key.slice(1).toLowerCase()) : undefined;
        rebuilt[resolved === undefined ? key : resolved] = value;
      }
      t[map] = rebuilt;
    }
  }

  const nameLookup = taskNameLookup(allTasks);

  allTasks.forEach((t, idx) => {
    if (t.summary) return;

    // project holidays plus this task's resources' non-working days, and
    // (issue #1132) whichever calendar applies to this task
    const taskHolidays = calendarOrHolidaysForTask(t, holidays, resourceNwd, calendar, resourceCalendars);

    const durationDays = durationDaysOf(t);
    const isMilestone = durationDays === 0;

    if (t.sequential) {
      let prev = null;
      for (let j = idx - 1; j >= 0; j--) {
        if (!allTasks[j].summary) { prev = allTasks[j]; break; }
      }
      if (prev && prev.finish !== undefined) {
        const prevName = prev.name || "";
        if (prevName) {
          if (!t.depends || !t.depends.length) t.depends = [];
          if (!t.depends.includes(prevName)) t.depends.push(prevName);
        }
        // A lag or lead on the star (`* +2d`, `* -1d`) shifts the
        // predecessor's finish by that many working days first -- exactly
        // as `[depends Prev +2d]` would, and it is recorded the same way so
        // exports and the Gantt see the offset.
        let ref = prev.finish;
        if (t.sequential_lag) {
          ref = addWorkingDays(ref, parseDurationToDays(t.sequential_lag), taskHolidays);
          if (prevName) {
            if (!t.lag_lead) t.lag_lead = {};
            if (t.lag_lead[prevName] === undefined) t.lag_lead[prevName] = t.sequential_lag;
          }
        }
        const seqStart = isMilestone ? ref : getNextWorkingDay(ref, taskHolidays);
        const explicit = t.start;
        t.start = explicit && explicit > seqStart ? explicit : seqStart;
        if (isMilestone) t.finish = t.start;
      } else {
        t.start = todayWorkingDay(taskHolidays, today);
      }
      if (!isMilestone || t.finish === undefined) computeFinish(t, taskHolidays);
      return;
    }

    if (t.depends && t.depends.length) {
      const lagLead = t.lag_lead || {};
      const depTypes = t.dependency_types || {};
      const starts = [];

      for (const depName of t.depends) {
        const depTask = nameLookup.get(depName.toLowerCase());
        if (!depTask || depTask.finish === undefined || depTask.start === undefined) continue;

        const depType = depTypes[depName] || "FS";

        if (depType === "FF" || depType === "SF") {
          let anchor = depType === "FF" ? depTask.finish : depTask.start;
          if (lagLead[depName] !== undefined) {
            anchor = addWorkingDays(anchor, parseDurationToDays(lagLead[depName]), taskHolidays);
          }
          if (isMilestone) starts.push(anchor);
          else starts.push(getNextWorkingDay(addWorkingDays(anchor, -durationDays, taskHolidays), taskHolidays));
          continue;
        }

        let ref = depType === "SS" ? depTask.start : depTask.finish;
        if (lagLead[depName] !== undefined) {
          ref = addWorkingDays(ref, parseDurationToDays(lagLead[depName]), taskHolidays);
        }
        if (depType === "SS") starts.push(getNextWorkingDay(ref, taskHolidays));
        else if (isMilestone) starts.push(ref);
        else starts.push(getNextWorkingDay(ref, taskHolidays));
      }

      if (starts.length) {
        const latest = Math.max(...starts);
        const explicit = t.start;
        t.start = explicit && explicit > latest ? explicit : latest;
        if (isMilestone) t.finish = t.start;
      } else if (t.start === undefined || t.start === null) {
        t.start = todayWorkingDay(taskHolidays, today);
      }
      if (!isMilestone || t.finish === undefined) computeFinish(t, taskHolidays);
      return;
    }

    if (t.start !== undefined && t.start !== null) {
      computeFinish(t, taskHolidays);
      return;
    }

    // Default: alongside the first dated sibling, else today.
    // Matched by parent identity (_parentUid), not parent name, so two
    // same-named phases elsewhere in the plan don't bleed their children's
    // default start dates into each other (#838).
    const parentUid = t._parentUid;
    let start = null;
    if (parentUid !== null) {
      const sibling = allTasks.find((o) => o._parentUid === parentUid && !o.summary && o.start !== undefined && o.start !== null);
      if (sibling) start = sibling.start;
    }
    t.start = start === null ? todayWorkingDay(taskHolidays, today) : start;
    computeFinish(t, taskHolidays);
  });

  // A task with no duration token is one day long, as the Python's
  // "ensure duration is set" step has it. Milestones keep their 0.
  for (const t of allTasks) {
    if (!t.summary && (t.duration_days === undefined || t.duration_days === null)) {
      t.duration_days = 1;
    }
  }

  // --- summary roll-up, indexed once (#789) ---
  //
  // Grouped by _uid/_parentUid, not by name -- see the note above buildTasks.
  // Two summaries (or two of anything) can share a name; a name-keyed
  // "first one wins" map would merge or drop one of their subtrees (#838).
  // _uid is unique per task by construction, so no such tie-break is needed.
  const childrenByParent = new Map();
  const summaryByUid = new Map();
  for (const t of allTasks) {
    if (t._parentUid !== null) {
      if (!childrenByParent.has(t._parentUid)) childrenByParent.set(t._parentUid, []);
      childrenByParent.get(t._parentUid).push(t);
    }
    if (t.summary) summaryByUid.set(t._uid, t);
  }
  const done = new Set();
  const rollUp = (uid) => {
    if (done.has(uid)) return;
    done.add(uid);
    const children = childrenByParent.get(uid) || [];
    if (!children.length) return;
    for (const child of children) if (child.summary) rollUp(child._uid);

    const summary = summaryByUid.get(uid);
    if (!summary) return;
    const starts = children.filter((c) => c.start !== undefined).map((c) => c.start);
    const finishes = children.filter((c) => c.finish !== undefined).map((c) => c.finish);
    if (starts.length && finishes.length) {
      summary.start = Math.min(...starts);
      summary.finish = Math.max(...finishes);
      summary.duration_days = summary.finish - summary.start;
    }
    let percents = children.filter((c) => !c.summary).map((c) => c.percent || 0);
    if (!percents.length) percents = children.map((c) => c.percent || 0);
    if (percents.length) {
      summary.percent = Math.trunc(percents.reduce((a, b) => a + b, 0) / percents.length);
    }
  };
  for (const t of allTasks) if (t.summary) rollUp(t._uid);

  // --- ordering: a summary immediately before its children ---
  const ordered = [];
  const processed = new Set();
  const addTask = (task) => {
    if (task._uid === undefined || processed.has(task._uid)) return;
    processed.add(task._uid);
    ordered.push(task);
    if (task.summary) for (const child of childrenByParent.get(task._uid) || []) addTask(child);
  };
  for (const t of allTasks) if (t._parentUid === null) addTask(t);

  inheritSummaryResources(ordered);
  flagCircularDependencies(ordered);
  // Project-wide calendar only -- per-resource calendars vary float
  // differently per task, which the current float model doesn't represent.
  const projectCalendarOrHolidays = calendar ? calendar.withExtraExceptions(holidays) : holidays;
  calculateCriticalPath(ordered, projectCalendarOrHolidays);
  return ordered;
}

/**
 * inherit_summary_resources: a summary's resource fills in its children's.
 *
 * Grouped by _parentUid, not by parent name -- two summaries can share a
 * name (#838), and matching by name would leak a resource into an unrelated
 * same-named phase's children.
 */
function inheritSummaryResources(tasks) {
  const byParent = new Map();
  for (const t of tasks) {
    if (t._parentUid === null || t._parentUid === undefined) continue;
    if (!byParent.has(t._parentUid)) byParent.set(t._parentUid, []);
    byParent.get(t._parentUid).push(t);
  }
  const propagate = (parentUid, resource) => {
    for (const child of byParent.get(parentUid) || []) {
      if (!child.resources) {
        child.resources = resource;
        child.inherited_resource = true;
      }
      if (child.summary) propagate(child._uid, child.resources || resource);
    }
  };
  for (const t of tasks) {
    if (t.summary && t.resources) propagate(t._uid, t.resources);
  }
}

/**
 * task_name_lookup: lowercased name to the task a dependency on it means.
 * When a name is defined more than once the first definition wins, because
 * the single-pass scheduler has always reached it by the time a later
 * dependant asks for its dates; a later namesake may not have been
 * scheduled yet.
 */
export function taskNameLookup(tasks) {
  const lookup = new Map();
  for (const t of tasks) {
    if (!t.name) continue;
    const key = t.name.toLowerCase();
    if (!lookup.has(key)) lookup.set(key, t);
  }
  return lookup;
}

/** detect_dependency_loops plus detect_hierarchy_dependency_conflicts. */
function flagCircularDependencies(tasks) {
  const taskMap = taskNameLookup(tasks);

  // name-to-name cycles
  const graph = new Map();
  for (const t of tasks) {
    if (!t.name) continue;
    const key = t.name.toLowerCase();
    const edges = new Set();
    for (const dep of t.depends || []) {
      const depKey = dep.trim().toLowerCase();
      if (taskMap.has(depKey)) edges.add(depKey);
    }
    graph.set(key, edges);
  }

  const affected = new Set();
  const loops = [];
  const visited = new Set();
  const stack = new Set();
  const dfs = (node, path) => {
    visited.add(node);
    stack.add(node);
    path.push(node);
    for (const next of graph.get(node) || []) {
      if (!visited.has(next)) dfs(next, path.slice());
      else if (stack.has(next)) {
        const cycle = path.slice(path.indexOf(next)).concat(next);
        loops.push(cycle.join(" -> "));
        for (const member of cycle.slice(0, -1)) affected.add(member);
      }
    }
    stack.delete(node);
  };
  for (const node of graph.keys()) if (!visited.has(node)) dfs(node, []);

  if (affected.size) {
    for (const t of tasks) {
      const key = (t.name || "").toLowerCase();
      if (!affected.has(key)) continue;
      const involved = loops.find((loop) => loop.includes(key));
      t.loop_warning = involved
        ? `Circular dependency detected. Part of cycle: ${involved}`
        : "Circular dependency detected";
      for (const dep of t.depends || []) {
        if (!affected.has(dep.trim().toLowerCase())) continue;
        const pred = taskMap.get(dep.trim().toLowerCase()) || {};
        (t.circular_dependencies ||= []).push({
          name: pred.name || dep,
          deliverable: pred.deliverable || "",
          reason: "cycle",
          message: t.loop_warning,
          fixable: false,
        });
      }
    }
  }

  // hierarchy conflicts: a task depending on its own phase, or the reverse
  const levels = tasks.map((t) => Math.max(1, t.level || 1));
  const parent = new Map();
  const parentStack = [];
  levels.forEach((level, i) => {
    while (parentStack.length && levels[parentStack[parentStack.length - 1]] >= level) parentStack.pop();
    parent.set(i, parentStack.length ? parentStack[parentStack.length - 1] : null);
    parentStack.push(i);
  });
  const isAncestor = (candidate, idx) => {
    let node = parent.get(idx);
    while (node !== null && node !== undefined) {
      if (node === candidate) return true;
      node = parent.get(node);
    }
    return false;
  };
  const indexByName = new Map();
  tasks.forEach((t, i) => {
    // first occurrence wins, matching taskNameLookup
    if (t.name && !indexByName.has(t.name.toLowerCase())) indexByName.set(t.name.toLowerCase(), i);
  });
  const display = (t) => t.description || t.name || "";

  tasks.forEach((t, idx) => {
    const conflicts = [];
    for (const dep of t.depends || []) {
      const predIdx = indexByName.get(dep.trim().toLowerCase());
      if (predIdx === undefined) continue;
      const pred = tasks[predIdx];
      let reason = null;
      let message = null;
      if (predIdx === idx) {
        reason = "self";
        message = `"${display(t)}" depends on itself`;
      } else if (isAncestor(predIdx, idx)) {
        reason = "own_phase";
        message = `"${display(t)}" depends on its own phase "${display(pred)}"`;
      } else if (isAncestor(idx, predIdx)) {
        reason = "own_subtask";
        message = `Phase "${display(t)}" depends on its own subtask "${display(pred)}"`;
      }
      if (reason) {
        conflicts.push({ name: pred.name || "", deliverable: pred.deliverable || "", reason, message, fixable: true });
      }
    }
    if (!conflicts.length) return;
    const names = new Set(conflicts.map((c) => c.name.toLowerCase()));
    t.circular_dependencies = (t.circular_dependencies || []).filter((c) => !names.has(c.name.toLowerCase())).concat(conflicts);
    t.loop_warning = conflicts[0].message;
  });
}

/**
 * _late_finish_allowed_by: the latest a predecessor may finish without
 * delaying the link's successor -- the forward pass run backwards. The
 * successor's late start (FS, SS) or finish (FF, SF) is shifted back by the
 * lag, and a start-anchored link (SS, SF) becomes a finish by adding the
 * predecessor's own duration.
 */
function lateFinishAllowedBy({ succ, type, lag }, duration, holidays) {
  let ref = type === "FS" || type === "SS" ? succ.late_start : succ.late_finish;
  if (lag) ref = addWorkingDays(ref, -lag, holidays);
  if ((type === "SS" || type === "SF") && duration) return addWorkingDays(ref, duration, holidays);
  return ref;
}

/** calculate_critical_path: float and the critical flag, on leaf tasks. */
function calculateCriticalPath(tasks, holidays) {
  const leaves = tasks.filter((t) => !t.summary && t.start !== undefined && t.finish !== undefined);
  if (!leaves.length) return;

  // resolved over every task, as scheduling resolved them
  const byName = taskNameLookup(tasks);

  for (const t of leaves) {
    t.early_start = t.start;
    t.early_finish = t.finish;
  }
  const projectEnd = Math.max(...leaves.map((t) => t.finish));

  // keyed by task: a dependency on a duplicated name belongs to its first
  // definition only. Each link keeps its type and lag/lead, looked up by the
  // name as written -- exactly as scheduleTasks looked them up going forward.
  const successors = new Map();
  for (const t of leaves) successors.set(t, []);
  for (const t of leaves) {
    const depTypes = t.dependency_types || {};
    const lags = t.lag_lead || {};
    for (const dep of t.depends || []) {
      const pred = byName.get(dep.toLowerCase());
      if (!pred || !successors.has(pred)) continue;
      const lag = lags[dep] !== undefined ? parseDurationToDays(lags[dep]) : 0;
      successors.get(pred).push({ succ: t, type: depTypes[dep] || "FS", lag });
    }
  }

  for (const t of leaves) {
    t.late_finish = projectEnd;
    t.late_start = projectEnd;
  }
  for (let i = leaves.length - 1; i >= 0; i--) {
    const t = leaves[i];
    const duration = durationDaysOf(t);
    t.late_finish = projectEnd;
    for (const link of successors.get(t)) {
      t.late_finish = Math.min(t.late_finish, lateFinishAllowedBy(link, duration, holidays));
    }

    if (duration === 0) {
      t.late_start = t.late_finish;
    } else {
      t.late_start = getNextWorkingDay(addWorkingDays(t.late_finish, -duration, holidays), holidays);
    }
  }
  for (const t of leaves) {
    t.total_float = countWorkingDays(t.early_start, t.late_start, holidays);
    t.critical = t.total_float === 0;
  }
}

// --- the /api/parse payload (PlanService._tasks_to_data) ----------------------

/**
 * calculate_rag_status, from noodle_core/exporters.py: the descriptive status
 * the views colour a task by. Leaf tasks only; summaries carry "".
 *
 * @param {object} task with day-number start/finish and a percent
 * @param {number} currentDay today, as a day number
 */
export function calculateRagStatus(task, currentDay) {
  const percent = task.percent;
  const hasPercent = percent !== undefined && percent !== null && percent !== "";

  if (percent === 100) return "Complete";

  // Red: deadline slippage (#877). A deadline is a fixed marker, distinct
  // from the on-track/behind-schedule comparison below and from
  // task.start/finish, which it never moves. Mirrors
  // exporters.calculate_rag_status in noodle_core.
  if (task.deadline) {
    const deadlineDay = dayOf(task.deadline);
    if (deadlineDay !== null && (deadlineDay < currentDay || (task.finish !== undefined && task.finish > deadlineDay))) {
      return "Task Overdue";
    }
  }

  if (task.start === undefined || task.finish === undefined) {
    if (!hasPercent || percent === 0) return "Task Overdue";
    if (percent < 50) return "Task Overdue";
    if (percent < 80) return "Behind Schedule";
    return "On Track";
  }

  if (task.start > currentDay) {
    return hasPercent && percent > 0 ? "Ahead of Schedule" : "Not Started";
  }
  if (task.start <= currentDay && (!hasPercent || percent === 0)) return "Task Overdue";

  let totalDuration = task.finish - task.start;
  if (totalDuration <= 0) totalDuration = 1;
  const elapsed = Math.max(0, currentDay - task.start);
  const expected = Math.min(100, (elapsed / totalDuration) * 100);

  return percent < expected ? "Behind Schedule" : "On Track";
}

/** One task, in the shape the frontend reads. */
function taskToData(task, idx, resourceMap, currentDay) {
  let resources = task.resources || "";
  if (resources) {
    resources = String(resources).split(",").map((r) => r.replace(/^@/, "").trim()).join(", ");
    if (resourceMap && Object.keys(resourceMap).length) {
      resources = resources.split(",").map((r) => {
        const key = r.trim().toLowerCase();
        return resourceMap[key] || r.trim();
      }).join(", ");
    }
  }

  const name = String(task.description || task.name || "").replace(/\s*\b\d{1,3}%/g, "").trim();

  return {
    id: idx + 1,
    name,
    key: task.name || "",
    start: task.start !== undefined ? isoOf(task.start) : "",
    finish: task.finish !== undefined ? isoOf(task.finish) : "",
    duration_days: task.duration_days ?? 0,
    resources,
    percent: task.percent ?? "",
    rag: task.summary ? "" : calculateRagStatus(task, currentDay),
    deadline: task.deadline || "",
    comment: task.comment || "",
    priority: task.priority || "Low",
    bucket: task.bucket || "",
    level: task.level || 0,
    is_summary: Boolean(task.summary),
    phase: task.phase || "",
    depends: task.depends || [],
    lag_lead: task.lag_lead || {},
    dependency_types: task.dependency_types || {},
    inherited_resource: Boolean(task.inherited_resource),
    effort_completed: task.effort_completed ?? "",
    effort_completed_unit: task.effort_completed_unit ?? "",
    effort_total: task.effort_total ?? "",
    effort_total_unit: task.effort_total_unit ?? "",
    effort_remaining: task.effort_remaining ?? "",
    effort_remaining_unit: task.effort_remaining_unit ?? "",
    recurrence: task.recurrence ?? null,
    deliverable: task.deliverable || "",
    product_type: task.product_type || "internal",
    parent: task.parent ?? null,
    quality_roles: task.quality_roles || {},
    total_float: task.total_float ?? null,
    critical: Boolean(task.critical),
    loop_warning: task.loop_warning || "",
    circular_dependencies: task.circular_dependencies || [],
    _uid: task._uid,
    _parent_uid: task._parentUid,
  };
}

/**
 * Schedule a plan and return the `/api/parse` task list.
 *
 * @param {string} planText
 * @param {object} options { today, holidays, resourceNonWorkingDays, resourceMap,
 *   calendar: Calendar, resourceCalendars: Map<string, Calendar> }
 */
export function scheduleTasksFromText(planText, options = {}) {
  const tasks = buildTasks(planText);
  const ordered = scheduleTasks(tasks, options);
  const currentDay = options.today === undefined || options.today === null
    ? dayOf(new Date())
    : dayOf(options.today);
  return ordered.map((task, idx) => taskToData(task, idx, options.resourceMap || {}, currentDay));
}

export { dayOf, isoOf };

if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildTasks, scheduleTasks, scheduleTasksFromText, dayOf, isoOf };
}
