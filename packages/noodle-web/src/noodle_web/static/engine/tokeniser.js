/**
 * The task-line grammar — a port of noodle_core/metadata.py's
 * extract_metadata (issue #793).
 *
 * This is the single semantic reading of a task line. The lexer in
 * static/task-tokenizer.js spans a line for syntax colouring; this turns one
 * into the fields the scheduler needs (duration, dependencies and their types
 * and lags, resources, percent, effort, and the rest), matching the Python
 * field for field so the two engines schedule identically.
 *
 * The patterns below are the same expressions, in the same order, as the
 * module-level constants in metadata.py. Order matters: the description is
 * whatever precedes the first metadata token, so a change in what counts as
 * a token changes task names.
 */
import { durationToDays, parseDurationToDays } from "./date-math.js";

// Mirrors metadata.py's compiled patterns, one for one.
const TOKEN_SPLIT = /(?<!\\)\s+/;
const QUALITY_ROLE = /^(.+?):(P|R|A)$/i;
const DEPENDS_BLOCK = /\[depends[^\]]*\]/gi;
const DELIVERABLE = /([/^])?\$([A-Za-z_][A-Za-z0-9_-]*)/;
const LABEL = /#([^@%#!\s]+)/g;
const BRACKET_DEP = /\[depends\s*:?\s*([^\]]*)\]/i;
const LAG_LEAD = /^(.+?)\s+([+-]\d+[dwmy])$/;
const DEP_TYPE = /^(.+?):(FS|SS|FF|SF)$/i;
const RECURRENCE = /\[repeats\s+([^\]]+)\]/i;
const BUCKET = /\{([^}]+)\}/;
const PRIORITY = /(?<!\w)(!!!|!!|!)(?!["'])/;
const BANG_COMMENT = /!(?:"([^"]+)"|'([^']+)')/;
const DQ_COMMENT = /"([^"]+)"/;
const SQ_COMMENT = /'([^']+)'/;
const EFFORT = /~(\d+(?:\.\d+)?)(h|d)(?:\/(\d+(?:\.\d+)?)(h|d))?/;
const PERCENT = /(\d{1,3})%/;
const LEGACY_PERCENT = /\bp(\d{1,3})\b/;
const LEVELLED = /\[levelled\s+@?(\S+)\s+(\d{4}-\d{2}-\d{2})\s*\]/i;
const DATE = /(\d{4}-\d{2}-\d{2})/;
const DURATION = /(?<!~)(?<![~/])\b(\d+)([dwmy])\b/;
const LEGACY_DURATION = /:p(\d+)d/;
const DESCRIPTION = /\*?(.*?)([/^]?\$[A-Za-z]|@|#|!|"|\{|\[|\d{4}-\d{2}-\d{2}|:p\d+d|\d+[dwmy]|\d+%|~\d|$)/;
const PERCENT_TOKEN = /\s*\b\d{1,3}%/g;

/** parse_recurrence: "weekly mon,wed" and friends. */
export function parseRecurrence(text) {
  const s = String(text || "").trim().toLowerCase();
  const result = { raw: s };

  if (s === "daily") {
    result.frequency = "daily";
  } else if (s === "yearly") {
    result.frequency = "yearly";
  } else if (s.startsWith("weekly")) {
    result.frequency = "weekly";
    const days = s.slice("weekly".length).trim();
    result.days = days ? days.split(",").map((d) => d.trim()).filter(Boolean) : [];
  } else if (s.startsWith("monthly")) {
    result.frequency = "monthly";
    const rest = s.slice("monthly".length).trim();
    const ordinals = { "1st": 1, "2nd": 2, "3rd": 3, "4th": 4, "5th": 5 };
    const match = /(\d+(?:st|nd|rd|th))\s+(\w+)/.exec(rest);
    if (match) {
      result.week_of_month = ordinals[match[1]] ?? 1;
      result.day_of_week = match[2];
    }
  } else {
    result.frequency = s;
  }
  return result;
}

/**
 * Every field metadata.extract_metadata pulls out of one task line.
 *
 * @param {string} taskStr the line, including any `*` prefix
 * @param {string} [taskName] the name the tree builder assigned
 * @returns {object} the same keys the Python returns, omitted the same way
 */
export function extractMetadata(taskStr, taskName = null) {
  const line = String(taskStr ?? "");
  const meta = {};

  // --- resources and quality roles ---
  const tokens = line.split(TOKEN_SPLIT);
  const qualityRoles = {};
  const regular = [];
  for (const token of tokens) {
    if (!token.startsWith("@")) continue;
    const name = token.replace(/^@+/, "");
    const qr = QUALITY_ROLE.exec(name);
    if (qr) qualityRoles[qr[1]] = qr[2].toUpperCase();
    else regular.push(name);
  }
  if (regular.length) meta.resources = regular.join(", ");
  if (Object.keys(qualityRoles).length) meta.quality_roles = qualityRoles;

  // --- the task's own deliverable ---
  // A $token inside [depends ...] references another product, so it is
  // removed before looking (the bug the Python comment describes).
  const outsideDepends = line.replace(DEPENDS_BLOCK, "");
  const deliverable = DELIVERABLE.exec(outsideDepends);
  if (deliverable) {
    meta.deliverable = deliverable[2];
    meta.product_type = deliverable[1] === "/" ? "group"
      : deliverable[1] === "^" ? "external"
      : "internal";
  }

  // --- labels ---
  const labels = [...line.matchAll(LABEL)].map((m) => m[1].trim());
  if (labels.length) meta.labels = labels;

  // --- dependencies, with types and lag/lead ---
  const bracket = BRACKET_DEP.exec(line);
  if (bracket) {
    const raw = bracket[1].trim();
    const depList = [];
    const lagLead = {};
    const depTypes = {};

    if (raw) {
      for (const spec of raw.split(",")) {
        const trimmed = spec.trim();
        if (!trimmed) continue;

        const lag = LAG_LEAD.exec(trimmed);
        if (lag) {
          let depName = lag[1].trim();
          const typed = DEP_TYPE.exec(depName);
          if (typed) {
            depName = typed[1].trim();
            const type = typed[2].toUpperCase();
            if (type !== "FS") depTypes[depName] = type;
          }
          depList.push(depName);
          lagLead[depName] = lag[2];
        } else {
          const typed = DEP_TYPE.exec(trimmed);
          if (typed) {
            const depName = typed[1].trim();
            const type = typed[2].toUpperCase();
            if (type !== "FS") depTypes[depName] = type;
            depList.push(depName);
          } else {
            depList.push(trimmed);
          }
        }
      }
    }

    if (Object.keys(lagLead).length) meta.lag_lead = lagLead;
    if (Object.keys(depTypes).length) meta.dependency_types = depTypes;
    meta.depends = depList;
  }

  // --- recurrence ---
  const recurrence = RECURRENCE.exec(line);
  if (recurrence) meta.recurrence = parseRecurrence(recurrence[1]);

  if (taskName) meta.name = taskName;
  if (line.startsWith("*")) meta.sequential = true;

  // --- bucket ---
  const bucket = BUCKET.exec(line);
  if (bucket) meta.bucket = bucket[1].trim();

  // --- priority ---
  const priority = PRIORITY.exec(line);
  if (priority) {
    meta.priority = priority[1] === "!!!" ? "Urgent" : priority[1] === "!!" ? "Important" : "Medium";
  } else {
    meta.priority = "Low";
  }

  // --- comment: !"…", then "…", then '…' ---
  const bang = BANG_COMMENT.exec(line);
  if (bang) {
    meta.comment = bang[1] !== undefined ? bang[1] : bang[2];
  } else {
    const dq = DQ_COMMENT.exec(line);
    if (dq) {
      meta.comment = dq[1];
    } else {
      const sq = SQ_COMMENT.exec(line);
      if (sq) meta.comment = sq[1];
    }
  }

  // --- effort, and the percent it implies ---
  const effort = EFFORT.exec(line);
  if (effort) {
    const completedVal = parseFloat(effort[1]);
    const completedUnit = effort[2];
    if (effort[3] !== undefined) {
      const totalVal = parseFloat(effort[3]);
      const totalUnit = effort[4];
      meta.effort_completed = completedVal;
      meta.effort_completed_unit = completedUnit;
      meta.effort_total = totalVal;
      meta.effort_total_unit = totalUnit;
      meta.effort_remaining = totalVal - completedVal;
      meta.effort_remaining_unit = totalUnit;
    } else {
      meta.effort_completed = 0;
      meta.effort_completed_unit = completedUnit;
      meta.effort_total = completedVal;
      meta.effort_total_unit = completedUnit;
      meta.effort_remaining = completedVal;
      meta.effort_remaining_unit = completedUnit;
    }
  }

  // --- percent complete ---
  const percent = PERCENT.exec(line);
  if (percent) {
    meta.percent = Math.max(0, Math.min(100, parseInt(percent[1], 10)));
  } else {
    const legacy = LEGACY_PERCENT.exec(line);
    if (legacy) meta.percent = Math.max(0, Math.min(100, parseInt(legacy[1], 10)));
  }

  // effort overrides the stated percent when both parts are present
  if (meta.effort_completed !== undefined && meta.effort_total !== undefined && meta.effort_total > 0) {
    const completedUnit = meta.effort_completed_unit || "h";
    const totalUnit = meta.effort_total_unit || "h";
    let completedHours = meta.effort_completed;
    let totalHours = meta.effort_total;
    if (completedUnit !== totalUnit) {
      completedHours = completedUnit === "d" ? meta.effort_completed * 8 : meta.effort_completed;
      totalHours = totalUnit === "d" ? meta.effort_total * 8 : meta.effort_total;
    }
    if (totalHours > 0) {
      // Python's round() is banker's rounding; JS Math.round is not, so the
      // half-way case is matched explicitly.
      meta.percent = Math.max(0, Math.min(100, bankersRound((completedHours / totalHours) * 100)));
    }
  }

  // --- levelled flag, which fixes the start, then any explicit date ---
  const levelled = LEVELLED.exec(line);
  let lineForDates = line;
  if (levelled) {
    meta.levelled = { resource: levelled[1].replace(/^@/, ""), start: levelled[2] };
    lineForDates = line.slice(0, levelled.index) + line.slice(levelled.index + levelled[0].length);
    meta.start = levelled[2];
    meta.due = levelled[2];
  } else {
    const date = DATE.exec(lineForDates);
    if (date) {
      meta.due = date[1];
      meta.start = date[1];
    }
  }

  // --- duration ---
  const duration = DURATION.exec(line);
  if (duration) {
    meta.duration_days = durationToDays(parseInt(duration[1], 10), duration[2]);
  } else {
    const legacy = LEGACY_DURATION.exec(line);
    if (legacy) meta.duration_days = parseInt(legacy[1], 10);
  }

  // --- description: everything before the first metadata token ---
  const desc = DESCRIPTION.exec(line);
  if (desc) {
    meta.description = desc[1].trim().replace(PERCENT_TOKEN, "").trim();
  }

  return meta;
}

/** Python's round(): halves go to the nearest even number. */
export function bankersRound(value) {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

export { parseDurationToDays };

if (typeof module !== "undefined" && module.exports) {
  module.exports = { extractMetadata, parseRecurrence, bankersRound, parseDurationToDays };
}
