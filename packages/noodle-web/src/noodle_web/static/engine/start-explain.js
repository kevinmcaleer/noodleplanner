/**
 * Why does a task start when it does?
 *
 * `explainStart(tasks, task, options)` reads the scheduled task list (the
 * `/api/parse` shape, from either engine) and returns a plain description of
 * what set `task.start`, so the Task Inspector can show it. It never
 * reschedules anything: it reads the dates the scheduler already produced and
 * works out which input they trace back to.
 *
 * Result: { kind, headline, steps: [{ text, driving? }], notes: [string] }
 *
 *   kind  "group"      a group: starts with its earliest task
 *         "sequential" a `*` task: follows the task above it
 *         "depends"    one or more [depends ...] entries
 *         "explicit"   a start date written on the line
 *         "default"    neither: alongside a dated sibling, else today
 *
 * Only plain data goes in and out, so it runs under node for the tests.
 */

const TYPE_LABEL = {
  FS: "finish-to-start",
  SS: "start-to-start",
  FF: "finish-to-finish",
  SF: "start-to-finish",
};

const DAY_MS = 86400000;

function dayNumber(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

function byName(tasks) {
  const lookup = new Map();
  for (const t of tasks) {
    for (const key of [t.key, t.name]) {
      if (key && !lookup.has(key.toLowerCase())) lookup.set(key.toLowerCase(), t);
    }
  }
  return lookup;
}

/** The tasks beneath a group, however deeply nested. */
function descendants(tasks, group) {
  const kids = tasks.filter((t) => t._parent_uid === group._uid);
  return kids.flatMap((k) => (k.is_summary ? [k, ...descendants(tasks, k)] : [k]));
}

/** What a dependency entry anchors on, in words and as a day number. */
function anchorOf(dep, type, lag) {
  const useStart = type === "SS" || type === "SF";
  const iso = useStart ? dep.start : dep.finish;
  return {
    iso,
    day: dayNumber(iso),
    word: useStart ? "starts" : "finishes",
    lag: lag || "",
  };
}

/**
 * @param {object[]} tasks   the scheduled list (`result.tasks`)
 * @param {object}   task    the scheduled task to explain
 * @param {object}   options { explicitStart: ISO date written on the line (or ""),
 *                             sequential: true when the line starts with `*` }
 */
export function explainStart(tasks, task, options = {}) {
  const lookup = byName(tasks);
  const explicit = options.explicitStart || "";
  const steps = [];
  const notes = [];

  if (task.is_summary) {
    const kids = descendants(tasks, task).filter((t) => !t.is_summary && t.start);
    const first = kids.reduce((best, t) => (!best || t.start < best.start ? t : best), null);
    const result = {
      kind: "group",
      headline: first
        ? `A group starts when its earliest task starts. That is “${first.name}” on ${first.start}.`
        : "A group starts when its earliest task starts, and this group has no dated tasks.",
      steps,
      notes,
    };
    if (first) {
      const sameDay = kids.filter((t) => t.start === first.start && t !== first);
      steps.push({ text: `“${first.name}” starts ${first.start}${sameDay.length ? ` (as do ${sameDay.length} other${sameDay.length > 1 ? "s" : ""})` : ""}`, driving: true });
      // A task deeper in the group with an earlier date can pull the whole
      // group back before the task listed first.
      const listedFirst = kids[0];
      if (listedFirst && listedFirst.start > first.start) {
        notes.push(`The first task listed, “${listedFirst.name}”, starts ${listedFirst.start}, but “${first.name}” starts earlier, on ${first.start}, so the group begins then.`);
      }
    }
    for (const depName of task.depends || []) {
      const dep = lookup.get(String(depName).toLowerCase());
      const when = dep && dep.finish ? ` (it finishes ${dep.finish})` : "";
      notes.push(`This group is set to depend on “${depName}”${when}, but a dependency written on a group does not move the tasks inside it. Put the dependency on the group’s first task to make it wait.`);
      if (dep && dep.finish && first && first.start < dep.finish) {
        notes.push(`Right now the group starts ${first.start}, before “${depName}” finishes on ${dep.finish}.`);
      }
    }
    return result;
  }

  const start = task.start;
  const depends = task.depends || [];
  const lagLead = task.lag_lead || {};
  const depTypes = task.dependency_types || {};

  // The star's predecessor is the nearest non-group task above this one.
  let starPred = null;
  if (options.sequential) {
    const at = tasks.indexOf(task);
    for (let j = at - 1; j >= 0; j--) {
      if (!tasks[j].is_summary) { starPred = tasks[j]; break; }
    }
  }

  const candidates = [];
  const considered = starPred ? [starPred.key || starPred.name] : depends;
  if (starPred) {
    // A star ignores [depends] on the same line.
    for (const depName of depends) {
      if (depName.toLowerCase() !== (starPred.key || starPred.name).toLowerCase()) {
        notes.push(`The [depends ${depName}] on this line is ignored because the * already makes it follow the task above.`);
      }
    }
  }
  for (const depName of considered) {
    const dep = lookup.get(String(depName).toLowerCase());
    if (!dep) {
      notes.push(`Dependency “${depName}” does not match any task, so it has no effect.`);
      continue;
    }
    const type = (depTypes[depName] || "FS").toUpperCase();
    const lag = lagLead[depName] || "";
    const anchor = anchorOf(dep, type, lag);
    if (anchor.day === null) continue;
    candidates.push({ dep, depName, type, anchor, group: dep.is_summary });
  }

  // The driving entry is the one that anchors latest (lag nudges the
  // ranking only when it is a whole number of days, which is what the
  // scheduler works in too).
  const rank = (c) => c.anchor.day + (parseInt(c.anchor.lag, 10) || 0);
  const driving = candidates.reduce((best, c) => (!best || rank(c) > rank(best) ? c : best), null);

  const label = (c) => {
    const lag = c.anchor.lag ? `, ${c.anchor.lag}` : "";
    const how = starPred ? "follows the * above" : TYPE_LABEL[c.type];
    return `“${c.depName}” ${c.anchor.word} ${c.anchor.iso} (${how}${lag})`;
  };
  for (const c of candidates) steps.push({ text: label(c), driving: c === driving });
  for (const c of candidates) {
    if (c.group) {
      notes.push(`“${c.depName}” is a group, so it counts from the group’s ${c.anchor.word === "finishes" ? "last" : "first"} task.`);
    }
  }

  if (explicit) {
    const explicitDay = dayNumber(explicit);
    const latest = driving ? rank(driving) : null;
    if (driving && explicitDay !== null && explicitDay > latest) {
      steps.push({ text: `Your start date ${explicit} is later than the dependencies, so it wins`, driving: true });
      steps.forEach((s) => { if (s.text.startsWith("“")) s.driving = false; });
    } else if (driving) {
      steps.push({ text: `Your start date ${explicit} is earlier than the dependencies, so it is overridden` });
    }
  }

  if (driving && !(explicit && steps.some((s) => s.driving && s.text.startsWith("Your start date")))) {
    const verb = starPred ? "Follows the task above it" : "Waits for its dependencies";
    const lagWord = driving.anchor.lag ? ` ${driving.anchor.lag}` : "";
    const isMilestone = task.duration_days === 0;
    const next = driving.type === "FF" || driving.type === "SF"
      ? "so its finish lines up with that, which sets this start"
      : isMilestone ? "so this milestone falls on that day" : "so this starts on the next working day";
    return {
      kind: starPred ? "sequential" : "depends",
      headline: `${verb}. “${driving.depName}” ${driving.anchor.word} ${driving.anchor.iso}${lagWord}, ${next} (${start}).`,
      steps,
      notes,
    };
  }

  if (explicit) {
    return {
      kind: "explicit",
      headline: `Starts on ${start}, the date written on the task line.`,
      steps: steps.length ? steps : [{ text: `Start date ${explicit} on the task line`, driving: true }],
      notes,
    };
  }

  // Neither: the scheduler places it alongside a dated sibling, or today.
  const sibling = tasks.find((t) => t !== task && t._parent_uid === task._parent_uid && !t.is_summary && t.start === start);
  return {
    kind: "default",
    headline: sibling
      ? `No dependency or date, so it starts alongside its sibling “${sibling.name}” on ${start}.`
      : `No dependency or start date, so it defaults to ${start} (today, or the next working day).`,
    steps,
    notes,
  };
}
