/**
 * Plan text: the back-matter sections, the conversion the parser runs first,
 * and the one edit the parser is allowed to make (issue #793).
 *
 * A port of the parts of noodle_core/format_converter.py and
 * noodle_web/plan_service.py that turn the markdown a user wrote into the
 * text the scheduler reads. Nothing here touches the DOM, and nothing here
 * mutates its input: `updateFrontMatterWithLabels` returns a new string, the
 * way the server does, so the markdown on disk stays byte-identical until
 * the caller decides to write the result back.
 */

export const HIGHLIGHTS_START = "---highlights---";
export const HIGHLIGHTS_END = "---end-highlights---";
export const BUDGET_START = "---budget---";
export const RAID_LOG_START = "---raid log---";
export const COMMS_START = "---comms---";
export const BENEFITS_START = "---benefits---";
export const BASELINE_START = "---baseline---";
export const LESSONS_START = "---lessons learned---";

/** Python's str.rstrip("\n") / lstrip("\n"). */
const rstripNewlines = (text) => text.replace(/\n+$/, "");
const lstripNewlines = (text) => text.replace(/^\n+/, "");

/** The first of `markers` that appears at or after `from`, or text.length. */
function firstMarkerIndex(text, markers, from) {
  let end = text.length;
  for (const marker of markers) {
    const idx = text.indexOf(marker, from);
    if (idx !== -1 && idx < end) end = idx;
  }
  return end;
}

/**
 * Remove a back-matter section, keeping the sections that may follow it.
 * This is the shape every strip_* function in format_converter.py has.
 */
function stripSection(text, marker, following) {
  const start = text.indexOf(marker);
  if (start === -1) return text;
  const before = rstripNewlines(text.slice(0, start));
  for (const next of following) {
    const idx = text.indexOf(next, start);
    if (idx !== -1) return `${before}\n\n${text.slice(idx)}`;
  }
  return before;
}

/** The raw text of a back-matter section, trimmed, or "". */
function extractSection(text, marker, enders) {
  const start = text.indexOf(marker);
  if (start === -1) return "";
  const afterStart = start + marker.length;
  return text.slice(afterStart, firstMarkerIndex(text, enders, afterStart)).trim();
}

export function stripHighlights(text) {
  const start = text.indexOf(HIGHLIGHTS_START);
  if (start === -1) return text;

  const afterStart = start + HIGHLIGHTS_START.length;
  let end = text.length;
  let endLen = 0;
  for (const marker of [HIGHLIGHTS_END, BUDGET_START, BENEFITS_START, RAID_LOG_START, COMMS_START, BASELINE_START]) {
    const idx = text.indexOf(marker, afterStart);
    if (idx !== -1 && idx < end) {
      end = idx;
      // Only the end-highlights marker is consumed; the others have to
      // survive for their own strippers to find them.
      endLen = marker === HIGHLIGHTS_END ? marker.length : 0;
    }
  }

  let before = rstripNewlines(text.slice(0, start));
  const after = lstripNewlines(text.slice(end + endLen));

  // Drop the trailing --- separator that introduces the section
  const lines = before.split("\n");
  while (lines.length && lines[lines.length - 1].trim() === "---") lines.pop();
  before = rstripNewlines(lines.join("\n"));

  return after ? `${before}\n${after}` : before;
}

export const stripBudget = (text) =>
  stripSection(text, BUDGET_START, [BENEFITS_START, RAID_LOG_START, COMMS_START, LESSONS_START, BASELINE_START]);
export const stripBenefits = (text) =>
  stripSection(text, BENEFITS_START, [RAID_LOG_START, COMMS_START, LESSONS_START, BASELINE_START]);
export const stripRaidLog = (text) =>
  stripSection(text, RAID_LOG_START, [BUDGET_START, COMMS_START, LESSONS_START, BASELINE_START]);
export const stripComms = (text) => stripSection(text, COMMS_START, [LESSONS_START, BASELINE_START]);
export const stripLessons = (text) => stripSection(text, LESSONS_START, [BASELINE_START]);
export const stripBaseline = (text) => stripSection(text, BASELINE_START, []);

export const extractBudget = (text) =>
  extractSection(text, BUDGET_START, [BENEFITS_START, RAID_LOG_START, COMMS_START, LESSONS_START, BASELINE_START]);
export const extractBenefits = (text) =>
  extractSection(text, BENEFITS_START, [RAID_LOG_START, COMMS_START, LESSONS_START, BASELINE_START]);
export const extractRaidLog = (text) =>
  extractSection(text, RAID_LOG_START, [BUDGET_START, COMMS_START, LESSONS_START, BASELINE_START]);
export const extractCommsPlan = (text) => extractSection(text, COMMS_START, [LESSONS_START, BASELINE_START]);
export const extractLessons = (text) => extractSection(text, LESSONS_START, [BASELINE_START]);
export const extractBaseline = (text) => extractSection(text, BASELINE_START, []);

const HIGHLIGHT_HEADING = /^##\s+(\d{4}-\d{2}-\d{2})\s+@(\S+)\s*$/;

/** extract_highlights: the ## date @author blocks of the highlights section. */
export function extractHighlights(text) {
  const source = String(text || "");
  const start = source.indexOf(HIGHLIGHTS_START);
  if (start === -1) return [];

  const afterStart = start + HIGHLIGHTS_START.length;
  const end = firstMarkerIndex(
    source,
    [HIGHLIGHTS_END, BUDGET_START, BENEFITS_START, RAID_LOG_START, COMMS_START, BASELINE_START],
    afterStart,
  );

  const highlights = [];
  let current = null;
  for (const line of source.slice(afterStart, end).split("\n")) {
    const stripped = line.trim();
    if (!stripped && current === null) continue;

    const heading = HIGHLIGHT_HEADING.exec(stripped);
    if (heading) {
      if (current !== null) {
        current.content = current.content.trim();
        highlights.push(current);
      }
      current = { date: heading[1], author: heading[2], content: "" };
      continue;
    }
    if (current !== null) current.content += `${line.replace(/\s+$/, "")}\n`;
  }
  if (current !== null) {
    current.content = current.content.trim();
    highlights.push(current);
  }
  return highlights;
}

/**
 * Which back-matter sections a plan carries that this engine does not parse
 * into structured items yet (the RAID, comms, benefits, lessons and baseline
 * markdown tables). The caller can use it to decide whether the payload from
 * `parsePlan` is complete or whether those lists have to come from elsewhere.
 */
export function unsupportedSections(planText) {
  const text = String(planText || "");
  const found = [];
  if (extractRaidLog(text)) found.push("raid_items");
  if (extractCommsPlan(text)) found.push("comms_items");
  if (extractBenefits(text)) found.push("benefits_items");
  if (extractLessons(text)) found.push("lessons_items");
  if (extractBaseline(text)) found.push("baseline_items");
  return found;
}

const PERCENT_TOKEN = /\b(\d{1,3})%/;
const DATE_TOKEN = /\d{4}-\d{2}-\d{2}/;
const DURATION_TOKEN = /\d+[dwmy]/;

/**
 * convert_plan_format_to_standard: strip the front matter and every
 * back-matter section, drop commented-out lines, table rows and headings,
 * spell durations the short way, and put a single space between a task name
 * and its metadata.
 *
 * The last of those is not cosmetic: the Python parses the *converted* text,
 * so it is what decides where a name ends. `*+2d Fourth 2d` becomes
 * `*+ 2d Fourth 2d` and the task really is called "+".
 */
export function convertPlanFormatToStandard(text) {
  let source = String(text || "");
  source = stripHighlights(source);
  source = stripBudget(source);
  source = stripRaidLog(source);
  source = stripComms(source);
  source = stripBenefits(source);
  source = stripLessons(source);
  source = stripBaseline(source);

  const output = [];
  let inFrontMatter = false;

  for (let line of source.split("\n")) {
    if (line.trim() === "---") {
      inFrontMatter = !inFrontMatter;
      continue;
    }
    if (inFrontMatter) continue;
    if (line.trimStart().startsWith("//")) continue;

    // A table row or a heading is content from a mistyped section marker,
    // never a task.
    const strippedLine = line.trimStart();
    if (strippedLine.startsWith("|")) continue;
    if (/^#+\s+\S/.test(strippedLine)) continue;

    line = line.replace(/(\d+)days?/g, "$1d")
      .replace(/(\d+)weeks?/g, "$1w")
      .replace(/(\d+)months?/g, "$1m");

    let stripped = line.trimStart();
    if (stripped && ["@", "%", "#", "d", "w", "m"].some((c) => stripped.includes(c))) {
      const leadingWs = line.slice(0, line.length - stripped.length);
      const isSequential = stripped.startsWith("*");
      if (isSequential) stripped = stripped.slice(1).trimStart();

      let metadataStart = stripped.length;
      for (const char of ["@", "#", "!"]) {
        const pos = stripped.indexOf(char);
        if (pos > 0) metadataStart = Math.min(metadataStart, pos);
      }
      const percent = PERCENT_TOKEN.exec(stripped);
      if (percent && percent.index > 0) metadataStart = Math.min(metadataStart, percent.index);
      const date = DATE_TOKEN.exec(stripped);
      if (date && date.index > 0) metadataStart = Math.min(metadataStart, date.index);
      const duration = DURATION_TOKEN.exec(stripped);
      if (duration && duration.index > 0) metadataStart = Math.min(metadataStart, duration.index);

      const taskName = stripped.slice(0, metadataStart).trim();
      const metadata = stripped.slice(metadataStart).trim();
      const seqPrefix = isSequential ? "*" : "";
      line = metadata
        ? `${leadingWs}${seqPrefix}${taskName} ${metadata}`
        : `${leadingWs}${seqPrefix}${taskName}`;
    }

    output.push(line);
  }

  return output.join("\n");
}

/**
 * collect_labels_from_plan: every #tag on a task line, lowercased.
 * The back-matter sections are stripped first so their prose does not
 * become labels.
 */
export function collectLabelsFromPlan(planText) {
  let text = String(planText || "");
  text = stripHighlights(text);
  text = stripBudget(text);
  text = stripRaidLog(text);
  text = stripComms(text);
  text = stripBenefits(text);

  const labels = new Set();
  let inFrontMatter = false;
  for (const line of text.split("\n")) {
    if (line.trim() === "---") {
      inFrontMatter = !inFrontMatter;
      continue;
    }
    if (inFrontMatter) continue;
    if (!line.trim()) continue;
    for (const match of line.matchAll(/#(\w+)/g)) labels.add(match[1].toLowerCase());
  }
  return labels;
}

/**
 * update_front_matter_with_labels: the one edit the parser makes, and the
 * only reason `updated_plan_text` is ever set.
 *
 * A `labels:` line that already lists every tag is left byte-for-byte as the
 * author wrote it, whatever its order, case or spacing; one that is missing
 * tags gains only the missing ones; a plan with no `labels:` line gets one as
 * the last front-matter key; a plan with no front matter gets a block holding
 * just that key. Applying it twice changes nothing.
 *
 * @param {string} planText
 * @param {Set<string>|string[]} labels
 * @returns {string} a new string; `planText` is never modified
 */
export function updateFrontMatterWithLabels(planText, labels) {
  const wanted = new Set([...labels].map((label) => String(label).toLowerCase()));
  const text = String(planText || "");
  if (!wanted.size) return text;

  const lines = text.split("\n");
  let hasFrontMatter = false;
  let frontMatterEndIndex = -1;
  let labelsLineIndex = -1;

  if (lines.length && lines[0].trim() === "---") {
    hasFrontMatter = true;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === "---") {
        frontMatterEndIndex = i;
        break;
      }
      if (lines[i].trim().toLowerCase().startsWith("labels:")) labelsLineIndex = i;
    }
  }

  const sorted = (values) => [...values].sort();

  if (!hasFrontMatter) {
    return `---\nlabels: [${sorted(wanted).join(", ")}]\n---\n${text}`;
  }

  if (labelsLineIndex >= 0) {
    const existingLine = lines[labelsLineIndex];
    const open = existingLine.indexOf("[");
    const close = existingLine.lastIndexOf("]");
    const existing = new Set();
    if (open !== -1 && close !== -1) {
      for (const label of existingLine.slice(open + 1, close).split(",")) {
        if (label.trim()) existing.add(label.trim().toLowerCase());
      }
    }
    const missing = sorted([...wanted].filter((label) => !existing.has(label)));
    if (!missing.length) return text;

    if (open !== -1 && close !== -1) {
      const inner = existingLine.slice(open + 1, close).trim();
      const joined = inner ? `${inner}, ${missing.join(", ")}` : missing.join(", ");
      lines[labelsLineIndex] = existingLine.slice(0, open + 1) + joined + existingLine.slice(close);
    } else {
      lines[labelsLineIndex] = `labels: [${sorted(new Set([...existing, ...wanted])).join(", ")}]`;
    }
  } else {
    lines.splice(frontMatterEndIndex, 0, `labels: [${sorted(wanted).join(", ")}]`);
  }

  return lines.join("\n");
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    HIGHLIGHTS_START, HIGHLIGHTS_END, BUDGET_START, RAID_LOG_START, COMMS_START,
    BENEFITS_START, BASELINE_START, LESSONS_START,
    stripHighlights, stripBudget, stripBenefits, stripRaidLog, stripComms,
    stripLessons, stripBaseline, extractBudget, extractBenefits, extractRaidLog,
    extractCommsPlan, extractLessons, extractBaseline, extractHighlights,
    unsupportedSections, convertPlanFormatToStandard, collectLabelsFromPlan,
    updateFrontMatterWithLabels,
  };
}
