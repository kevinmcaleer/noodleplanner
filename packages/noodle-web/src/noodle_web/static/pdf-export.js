/**
 * Project-plan PDF export, entirely in the browser (issue #792).
 *
 * The server's PDF (`noodle_core.exporters.export_to_pdf`) is a title over
 * the monospace report that `text_to_markdown_table()` builds: the task
 * table, the milestone table and timeline, the Gantt chart and the resource
 * sheet, 120 columns wide. This module builds the same report from the plan
 * the page has already had scheduled (`/api/parse`, held in
 * `lastParseResult`) and lays it out with the vendored jsPDF. The only
 * request it makes is for the font the PDF embeds; no plan text goes to the
 * backend.
 *
 * `buildReportText` is a port of `text_to_markdown_table` and of
 * `render_gantt_chart`, `render_resource_sheet` and `render_custom_timeline`
 * in noodle_core.renderers; tests/test_pdf_docx_browser_export.mjs asserts
 * its output is byte-identical to the Python one for the template plans, so
 * the two cannot drift apart. Everything but `exportPdfInBrowser` is pure
 * (no fetch, no DOM), which is what lets Node run the same code the browser
 * does.
 *
 * Why jsPDF and not pdfmake: the document is preformatted text, one font,
 * one size, so jsPDF's `text()` and a manual page break are the whole
 * layout; pdfmake's flowing layout engine would add ~400 KB for nothing
 * used. Neither library's built-in fonts can draw the report — jsPDF's
 * standard fonts are Latin-1 only and pdfmake's Roboto is proportional —
 * so a monospace TrueType font is embedded either way; see
 * docs/reference/export-formats.rst.
 */
import { jsPDF } from "./vendor/jspdf/jspdf.es.min.js";

/** Where the deployment serves the font the PDF embeds. */
export const FONT_URL = "/static/vendor/dejavu/DejaVuSansMono.ttf";

/** Shown when the font cannot be loaded (a broken deployment). */
export const FONT_MISSING_MESSAGE =
  "Export to PDF could not load the font the app ships at " + FONT_URL +
  ". The deployment is missing or blocking that file; see \"Export your plan\" in the docs.";

/** Columns the server report is built for (PlanService uses 120). */
export const TERMINAL_WIDTH = 120;

/** The character drawn in place of one the embedded font has no glyph for. */
export const MISSING_GLYPH = "□"; // WHITE SQUARE

/** Page sizes the export understands; keys are what the setting stores. */
export const PAGE_SIZES = { a4: "a4", letter: "letter" };

/** localStorage key that selects the paper size ("a4" or "letter"). */
export const PAGE_SIZE_SETTING = "np-pdf-page-size";

// reportlab's SimpleDocTemplate margins and styles in export_to_pdf
const MARGIN = 30;
const TITLE_SIZE = 24;
const TITLE_LEADING = TITLE_SIZE * 1.2;
const TITLE_COLOUR = [0x10, 0x8b, 0xb9];
const TITLE_SPACE_AFTER = 30 + 12; // spaceAfter plus the Spacer that follows
const BODY_SIZE = 8;
const BODY_LEADING_RATIO = 10 / 8;

const FONT_NAME = "DejaVuSansMono";
const FONT_FILE = "DejaVuSansMono.ttf";

// --- Python string formatting ------------------------------------------------
//
// Python's len() and slicing count code points, so every width here goes
// through Array.from rather than String.length (which counts UTF-16 units).

const chars = (s) => Array.from(String(s ?? ""));
const strLen = (s) => chars(s).length;
const head = (s, n) => chars(s).slice(0, Math.max(0, n)).join("");
const repeat = (ch, n) => (n > 0 ? ch.repeat(n) : "");

/** `f"{s:<{w}}"` */
function padRight(s, w) {
  s = String(s ?? "");
  return s + repeat(" ", w - strLen(s));
}

/** `f"{s:>{w}}"` */
function padLeft(s, w) {
  s = String(s ?? "");
  return repeat(" ", w - strLen(s)) + s;
}

/** `f"{s:^{w}}"`: Python puts the odd space on the right. */
function center(s, w) {
  s = String(s ?? "");
  const pad = Math.max(0, w - strLen(s));
  const left = Math.floor(pad / 2);
  return repeat(" ", left) + s + repeat(" ", pad - left);
}

// --- dates ---------------------------------------------------------------------
//
// Dates are whole days (days since the epoch), which is what the Python
// code's midnight datetimes reduce to when subtracted.

const DAY_MS = 86400000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A "YYYY-MM-DD" string as a day number, or null when it is not a date. */
export function dayOf(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  if (!m) return null;
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS);
}

/** Today's local calendar date as a day number (Python's datetime.today()). */
export function todayDay() {
  const n = new Date();
  return Math.floor(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / DAY_MS);
}

function parts(day) {
  const d = new Date(day * DAY_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), wd: (d.getUTCDay() + 6) % 7 };
}

const two = (n) => String(n).padStart(2, "0");

/** strftime('%Y-%m-%d') */
export function fmtIso(day) {
  const p = parts(day);
  return `${p.y}-${two(p.m + 1)}-${two(p.d)}`;
}

/** strftime('%d %b ').lower() */
function fmtDdMon(day) {
  const p = parts(day);
  return `${two(p.d)} ${MONTHS[p.m].toLowerCase()} `;
}

/** strftime('%-d %b') or strftime('%-d %b %Y') */
function fmtDMon(day, withYear) {
  const p = parts(day);
  return `${p.d} ${MONTHS[p.m]}${withYear ? " " + p.y : ""}`;
}

/** strftime('%b') */
function fmtMon(day) {
  return MONTHS[parts(day).m];
}

// --- front matter: project non-working days ---------------------------------

/**
 * Project-wide non-working days from the plan's front matter, as day
 * numbers. A port of FrontMatterParser.parse_non_working_days: the named
 * list form (`- Christmas: 2026-12-25:2026-12-26`) first, else the flat
 * `non-working-days: 2026-12-25, 2026-12-26` form. The resource sheet marks
 * these days.
 */
export function parseNonWorkingDays(planText) {
  const dates = new Set();
  const text = String(planText ?? "");
  const lines = text.split(/\r?\n/);
  if (lines.length === 0 || lines[0].trim() !== "---") return dates;
  const fm = [];
  for (const line of lines.slice(1)) {
    if (line.trim() === "---") break;
    fm.push(line);
  }

  const addRange = (a, b) => {
    const start = dayOf(a);
    const end = b ? dayOf(b) : start;
    if (start === null || end === null) return;
    for (let d = start; d <= end; d++) dates.add(d);
  };

  let inList = false;
  let foundList = false;
  for (const line of fm) {
    const stripped = line.trim();
    if (["non-working-days:", "holidays:"].includes(stripped.toLowerCase())) {
      inList = true;
      continue;
    }
    if (!inList) continue;
    if (stripped.startsWith("- ")) {
      foundList = true;
      const entry = stripped.slice(2).trim();
      const named = /^(.+?):\s*(\d{4}-\d{2}-\d{2})(?::(\d{4}-\d{2}-\d{2}))?\s*$/.exec(entry);
      if (named) {
        addRange(named[2], named[3]);
      } else {
        const bare = /^(\d{4}-\d{2}-\d{2})\s*$/.exec(entry);
        if (bare) addRange(bare[1]);
      }
    } else if (stripped && !stripped.startsWith("#")) {
      inList = false;
    }
  }

  if (!foundList) {
    for (const line of fm) {
      const m = /^\s*(non-working-days|holidays)\s*:\s*(.+)$/i.exec(line);
      if (!m) continue;
      for (const iso of m[2].match(/\d{4}-\d{2}-\d{2}/g) || []) addRange(iso);
    }
  }
  return dates;
}

// --- the report --------------------------------------------------------------

/** The task dictionaries as the Python renderers see them. */
function normaliseTasks(tasks, today) {
  return (tasks || []).map((t) => {
    const start = dayOf(t.start);
    const finish = dayOf(t.finish);
    const hasDuration = t.duration_days !== undefined && t.duration_days !== null;
    return {
      name: String(t.name ?? ""),
      start,
      finish,
      durationDays: hasDuration ? Math.trunc(Number(t.duration_days) || 0) : 1,
      hasDuration,
      resources: String(t.resources ?? ""),
      // '' means the plan gave no percentage, as the payload does
      percent: t.percent === "" || t.percent === null || t.percent === undefined ? null : Number(t.percent),
      rag: String(t.rag ?? ""),
      comment: String(t.comment ?? ""),
      level: Number(t.level) || 0,
      summary: Boolean(t.is_summary),
      phase: String(t.phase ?? ""),
      // fallbacks text_to_markdown_table applies when dates are missing
      startOrToday: start ?? today,
    };
  });
}

/** `', '.join(r.lstrip('@').strip() for r in resources.split(','))` */
function tidyResources(resources) {
  return resources
    .split(",")
    .map((r) => r.replace(/^@+/, "").trim())
    .join(", ");
}

/**
 * Port of noodle_core.renderers.render_custom_timeline.
 * @returns {[string, string[], string, string[], number[]]}
 */
export function renderCustomTimeline(phases, milestones, startDate, finishDate, width) {
  const timeline = new Array(width).fill("─");
  const positions = [];
  const data = [];
  const items = [{ type: "milestone", name: "Start", date: startDate }];
  for (const phase of phases) items.push({ type: "phase", name: phase.name, date: phase.start });
  for (const m of milestones) items.push({ type: "milestone", name: m.name, date: m.date ?? startDate });
  items.push({ type: "milestone", name: "Finish", date: finishDate });
  items.sort((a, b) => a.date - b.date); // stable, like Python's sort

  let durationDays = finishDate - startDate;
  if (durationDays === 0) durationDays = 1;
  const sameYear = parts(startDate).y === parts(finishDate).y;

  for (const item of items) {
    const pos = Math.trunc(((item.date - startDate) / durationDays) * (width - 1));
    if (item.type !== "milestone") continue;
    timeline[pos] = "◆";
    positions.push(pos);
    const withYear = !(sameYear && parts(item.date).y === parts(startDate).y);
    data.push({ name: item.name, pos, date: fmtDMon(item.date, withYear) });
  }

  const maxLines = 10;
  const lines = Array.from({ length: maxLines }, () => new Array(width).fill(" "));

  const titles = [];
  const reserved = [];
  for (const m of data) {
    if (m.name === "Start" || m.name === "Finish") continue;
    titles.push({ title: m.name, pos: m.pos, start: Math.max(0, m.pos - strLen(m.name) + 1), end: m.pos });
  }
  titles.sort((a, b) => a.pos - b.pos);

  const buffer = 2;
  for (const item of titles) {
    const { title, pos, start: startPos, end: endPos } = item;
    let overlaps = false;
    for (const [cs, ce] of reserved) {
      if (!(endPos + buffer < cs || startPos > ce + buffer)) {
        overlaps = true;
        break;
      }
    }
    const available = endPos - startPos + 1;
    if (available < strLen(title) * 0.7) overlaps = true;

    if (overlaps) {
      const words = title.split(/\s+/).filter(Boolean);
      let longest = words.length ? words[0] : title;
      for (const w of words) if (strLen(w) > strLen(longest)) longest = w; // first max, as Python's max()
      const idealStart = Math.max(0, pos - strLen(longest) + 1);
      const idealEnd = pos;
      let actualStart = idealStart;
      for (const [cs, ce] of reserved) {
        if (!(idealEnd + buffer < cs || idealStart > ce + buffer)) {
          actualStart = Math.max(actualStart, ce + buffer + 1);
        }
      }
      actualStart = Math.min(actualStart, pos);
      reserved.push([actualStart, pos]);
      item.needsWrap = true;
      item.column = [actualStart, pos];
    } else {
      item.needsWrap = false;
      reserved.push([startPos, endPos]);
    }
  }

  const usage = Array.from({ length: maxLines }, () => []);
  for (const item of titles) {
    const { title, pos } = item;
    if (!item.needsWrap) {
      const startPos = item.start;
      chars(title).forEach((c, i) => {
        const cp = startPos + i;
        if (cp >= 0 && cp <= pos && cp < width) lines[0][cp] = c;
      });
      usage[0].push([startPos, pos]);
      continue;
    }
    const words = title.split(/\s+/).filter(Boolean);
    const [colStart, colEnd] = item.column;
    const colWidth = colEnd - colStart + 1;
    words.reverse().forEach((word, wordIdx) => {
      let lineIdx = wordIdx;
      let placed = false;
      while (lineIdx < maxLines && !placed) {
        let display = word;
        if (strLen(word) > colWidth) {
          if (colWidth < 3) break;
          display = head(word, Math.max(3, colWidth - 1)) + ".";
        }
        const wordLen = strLen(display);
        const wordStart = Math.max(colStart, pos - wordLen + 1);
        const wordEnd = wordStart + wordLen - 1;
        let conflicts = false;
        for (const [us, ue] of usage[lineIdx]) {
          if (!(wordEnd + 1 < us || wordStart > ue + 1)) {
            conflicts = true;
            break;
          }
        }
        if (!conflicts) {
          chars(display).forEach((c, i) => {
            const cp = wordStart + i;
            if (cp >= colStart && cp <= pos && cp < width) lines[lineIdx][cp] = c;
          });
          usage[lineIdx].push([wordStart, wordEnd]);
          placed = true;
        } else {
          lineIdx += 1;
        }
      }
    });
  }

  const titleLines = lines.map((l) => l.join("")).filter((l) => l.trim());

  const dateLine = new Array(width).fill(" ");
  const dateUsed = [];
  for (const m of data) {
    if (m.name === "Start" || m.name === "Finish") continue;
    const startPos = Math.max(0, m.pos - strLen(m.date) + 1);
    const endPos = m.pos;
    let overlaps = false;
    for (const [us, ue] of dateUsed) {
      if (!(endPos + 1 < us || startPos > ue + 1)) {
        overlaps = true;
        break;
      }
    }
    if (overlaps) continue;
    chars(m.date).forEach((c, i) => {
      const cp = startPos + i;
      if (cp >= 0 && cp < width) dateLine[cp] = c;
    });
    dateUsed.push([startPos, endPos]);
  }

  return [timeline.join(""), titleLines, dateLine.join(""), data.map((m) => m.date), positions];
}

/** Port of noodle_core.renderers.render_gantt_chart. */
export function renderGanttChart(tasks, startDate, finishDate, terminalWidth) {
  let chart = "# Gantt Chart\n\n";
  const totalDays = finishDate - startDate || 1;
  const maxIdWidth = Math.max(String(tasks.length).length, 2);
  let maxNameWidth = Math.max(20, ...tasks.map((t) => strLen(t.name)));

  const overhead = maxIdWidth + 2 + maxNameWidth + 3;
  const chartWidth = Math.max(20, terminalWidth - overhead);

  const availableForName = terminalWidth - maxIdWidth - 2 - 3 - 20;
  if (maxNameWidth > availableForName && availableForName > 10) maxNameWidth = availableForName;

  const tryPlaceDates = (interval) => {
    const row = new Array(chartWidth).fill(" ");
    const placed = [];
    for (let current = startDate; current <= finishDate; current += interval) {
      const pos = Math.trunc(((current - startDate) / totalDays) * (chartWidth - 1));
      const dateStr = fmtDdMon(current);
      if (pos + dateStr.length > chartWidth) continue;
      let overlaps = false;
      for (const [pp, pl] of placed) {
        if (pos < pp + pl && pos + dateStr.length > pp) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) continue;
      chars(dateStr).forEach((c, i) => {
        if (pos + i < chartWidth) row[pos + i] = c;
      });
      placed.push([pos, dateStr.length]);
    }
    return [row, placed.length > 0];
  };

  let dateRow = null;
  for (const interval of [1, 2, 7]) {
    const [row, ok] = tryPlaceDates(interval);
    dateRow = row;
    if (ok) break;
  }
  if (dateRow === null) dateRow = new Array(chartWidth).fill(" ");

  chart += `${padRight("ID", maxIdWidth)}  ${padRight("Task Name", maxNameWidth)} |` + dateRow.join("") + "|\n";
  chart += repeat("-", maxIdWidth + 2 + maxNameWidth + 1 + chartWidth + 2) + "\n";

  tasks.forEach((t, i) => {
    if (t.start === null || t.finish === null) return;
    const barStart = Math.trunc(((t.start - startDate) / totalDays) * (chartWidth - 1));
    const barEnd = Math.trunc(((t.finish - startDate) / totalDays) * (chartWidth - 1));
    const line = new Array(chartWidth).fill(" ");
    const percent = t.percent ?? 0;
    const indent = t.level > 0 ? repeat("    ", t.level - 1) : "";
    const isMilestone = t.durationDays === 0;

    if (isMilestone) {
      if (barStart < chartWidth) line[barStart] = "◆";
    } else if (t.summary) {
      if (barStart < chartWidth) line[barStart] = "[";
      if (barEnd < chartWidth) line[barEnd] = "]";
      const progressEnd = barStart + Math.trunc(((barEnd - barStart + 1) * percent) / 100);
      for (let j = barStart + 1; j < barEnd; j++) line[j] = j < progressEnd ? "═" : "─";
    } else {
      const progressEnd = barStart + Math.trunc(((barEnd - barStart + 1) * percent) / 100);
      for (let j = barStart; j <= barEnd; j++) {
        if (j < chartWidth) line[j] = j < progressEnd ? "═" : "─";
      }
    }

    let label = `${indent}${t.name}`;
    if (t.summary) label = label.toUpperCase();
    if (strLen(label) > maxNameWidth) label = head(label, maxNameWidth - 1) + ".";
    chart += `${padRight(String(i + 1), maxIdWidth)}  ${padRight(label, maxNameWidth)} |${line.join("")}|\n`;
  });
  return chart;
}

/**
 * Port of noodle_core.renderers.render_resource_sheet.
 *
 * The Python groups and sorts resources by the short name written in the
 * plan (`@kev`) and shows the full name from the front matter. The parse
 * payload carries full names only, so the resource map is inverted to
 * recover the short-name key and keep the same row order.
 */
export function renderResourceSheet(tasks, startDate, finishDate, holidays, terminalWidth, resourceMap) {
  let sheet = "# Resource Sheet\n\n";
  const shortNameOf = new Map();
  for (const [short, full] of Object.entries(resourceMap || {})) {
    const key = String(full).toLowerCase();
    if (!shortNameOf.has(key)) shortNameOf.set(key, String(short).toLowerCase());
  }

  const workload = new Map();
  const hours = new Map();
  const displayNames = new Map();

  for (const t of tasks) {
    if (!t.resources || t.summary) continue;
    const list = t.resources
      .split(",")
      .filter((r) => r.trim())
      .map((r) => r.trim().replace(/^@+/, ""));
    if (t.start === null || t.finish === null) continue;
    const taskHours = (t.hasDuration ? t.durationDays : t.finish - t.start) * 8;
    for (const resource of list) {
      const lower = resource.toLowerCase();
      const key = shortNameOf.get(lower) ?? lower;
      if (!displayNames.has(key)) displayNames.set(key, resource);
      if (!workload.has(key)) {
        workload.set(key, []);
        hours.set(key, 0);
      }
      workload.get(key).push([t.start, t.finish, t.durationDays]);
      hours.set(key, hours.get(key) + taskHours);
    }
  }

  if (workload.size === 0) return "";

  const totalDays = finishDate - startDate || 1;
  const fullName = (key) => resourceMap?.[key] ?? displayNames.get(key) ?? key;
  const maxNameWidth = Math.max(8, ...[...workload.keys()].map((k) => strLen(fullName(k))));
  const hoursWidth = 5;
  const overhead = maxNameWidth + hoursWidth + 5;
  let chartWidth = Math.max(20, terminalWidth - overhead);

  let scale;
  let numPeriods;
  if (totalDays <= chartWidth) {
    scale = "day";
    numPeriods = totalDays;
  } else if (totalDays <= chartWidth * 7) {
    scale = "week";
    numPeriods = Math.floor((totalDays + 6) / 7);
  } else if (totalDays <= chartWidth * 30) {
    scale = "month";
    numPeriods = Math.floor((totalDays + 29) / 30);
  } else {
    scale = "quarter";
    numPeriods = Math.floor((totalDays + 89) / 90);
  }
  chartWidth = Math.min(chartWidth, numPeriods);

  const headerRow = new Array(chartWidth).fill(" ");
  if (scale === "day") {
    const datePositions = [];
    for (let i = 0; i < chartWidth; i++) {
      const p = parts(startDate + i);
      if (i === 0 || p.d === 1 || (p.wd === 0 && i > 0)) datePositions.push(i);
    }
    let lastEnd = -7;
    for (const pos of datePositions) {
      const dateStr = fmtDdMon(startDate + pos);
      if (pos > lastEnd) {
        chars(dateStr).forEach((c, j) => {
          if (pos + j < chartWidth) headerRow[pos + j] = c;
        });
        lastEnd = pos + dateStr.length - 1;
      }
    }
  } else {
    let current = startDate;
    for (let i = 0; i < chartWidth; i++) {
      let dateStr;
      let periodDays;
      if (scale === "week") {
        dateStr = fmtDdMon(current);
        periodDays = 7;
      } else if (scale === "month") {
        dateStr = fmtMon(current);
        periodDays = 30;
      } else {
        dateStr = `Q${Math.floor(parts(current).m / 3) + 1}`;
        periodDays = 90;
      }
      chars(dateStr).forEach((c, j) => {
        if (i + j < chartWidth) headerRow[i + j] = c;
      });
      current += periodDays;
    }
  }

  const isNonWorking = (day) => parts(day).wd >= 5 || holidays.has(day);

  sheet += `${padRight("Resource", maxNameWidth)} | ${padLeft("Hours", hoursWidth)} |` + headerRow.join("") + "|\n";
  sheet += repeat("-", maxNameWidth + 1 + hoursWidth + 2 + chartWidth + 2) + "\n";

  for (const key of [...workload.keys()].sort()) {
    const line = new Array(chartWidth).fill(" ");
    for (const [taskStart, taskFinish] of workload.get(key)) {
      if (scale === "day") {
        for (let day = taskStart; day < taskFinish; day++) {
          if (day > finishDate) break;
          const pos = day - startDate;
          if (pos >= 0 && pos < chartWidth) line[pos] = isNonWorking(day) ? "░" : "█";
        }
      } else {
        const startPeriod = Math.trunc(((taskStart - startDate) * chartWidth) / totalDays);
        const endPeriod = Math.trunc(((taskFinish - startDate) * chartWidth) / totalDays);
        for (let pos = startPeriod; pos < Math.min(endPeriod + 1, chartWidth); pos++) {
          if (line[pos] === " ") line[pos] = "█";
        }
      }
    }
    if (scale === "day") {
      for (let pos = 0; pos < chartWidth; pos++) {
        if (line[pos] === " " && isNonWorking(startDate + pos)) line[pos] = "░";
      }
    }
    sheet += `${padRight(fullName(key), maxNameWidth)} | ${padLeft(hours.get(key) ?? 0, hoursWidth - 1)}h |${line.join("")}|\n`;
  }
  return sheet;
}

/**
 * The report text: a port of noodle_core.exporters.text_to_markdown_table
 * fed from the `/api/parse` payload instead of scheduling again.
 *
 * @param {object} parse the `/api/parse` payload for the current plan
 * @param {{projectName?: string, terminalWidth?: number, holidays?: Set<number>, today?: number}} [options]
 */
export function buildReportText(parse, options = {}) {
  const today = options.today ?? todayDay();
  const tw = options.terminalWidth ?? TERMINAL_WIDTH;
  const projectName = options.projectName || parse?.project_name || "Project";
  const resourceMap = parse?.resource_map || {};
  const holidays = options.holidays ?? new Set();
  const tasks = normaliseTasks(parse?.tasks, today);

  const phaseDates = new Map();
  for (const t of tasks) {
    const start = t.startOrToday;
    const finish = t.finish ?? start + t.durationDays;
    if (!t.phase) continue;
    const d = phaseDates.get(t.phase);
    if (!d) phaseDates.set(t.phase, { start, end: finish });
    else {
      if (start < d.start) d.start = start;
      if (finish > d.end) d.end = finish;
    }
  }

  const cols = { id: 2, task_name: 9, start: 5, finish: 6, duration: 3, resources: 3, percent: 1, rag: 3, comment: 7 };
  // '%d %b' below 100 columns, '%Y-%m-%d' otherwise
  const fmtDate = tw < 100 ? (d) => `${two(parts(d).d)} ${MONTHS[parts(d).m]}` : fmtIso;

  const rows = tasks.map((t, i) => {
    const start = t.startOrToday;
    const finish = t.finish ?? start + t.durationDays;
    const resources = t.resources ? tidyResources(t.resources) : "";
    let taskName = t.name;
    if (t.level > 0) taskName = repeat("  ", t.level) + taskName;
    const row = {
      id: String(i + 1),
      task_name: taskName,
      start: fmtDate(start),
      finish: fmtDate(finish),
      duration: `${t.durationDays}d`,
      resources,
      percent: t.percent === null ? "" : String(t.percent),
      rag: t.summary ? "" : t.rag,
      comment: t.comment,
    };
    for (const key of Object.keys(row)) {
      if (key !== "comment") cols[key] = Math.max(cols[key], strLen(row[key]));
    }
    return row;
  });

  const fixedWidth = cols.id + cols.task_name + cols.start + cols.finish + cols.duration + cols.resources + cols.percent + cols.rag;
  const availableForComment = tw - fixedWidth - 7 * 3 - 5;
  const maxCommentWidth = Math.max(7, Math.min(50, availableForComment));
  cols.comment = maxCommentWidth;
  for (const row of rows) {
    if (strLen(row.comment) > maxCommentWidth) row.comment = head(row.comment, maxCommentWidth - 3) + "...";
  }

  let md = `# ${projectName}\n\n`;
  md += `${padRight("ID", cols.id)} | ${padRight("Task Name", cols.task_name)} | ${padRight("Start", cols.start)} | ${padRight("Finish", cols.finish)} | ${padLeft("Dur", cols.duration)} | ${center("Res", cols.resources)} | ${center("%", cols.percent)} | ${center("RAG", cols.rag)} | ${padRight("Comment", cols.comment)}\n`;
  md += `${repeat("-", cols.id + 1)}|${repeat("-", cols.task_name + 2)}|${repeat("-", cols.start + 2)}|${repeat("-", cols.finish + 2)}|${repeat("-", cols.duration + 2)}|${repeat("-", cols.resources + 2)}|${repeat("-", cols.percent + 2)}|${repeat("-", cols.rag + 2)}|${repeat("-", cols.comment)}\n`;
  for (const r of rows) {
    md += `${padRight(r.id, cols.id)} | ${padRight(r.task_name, cols.task_name)} | ${padRight(r.start, cols.start)} | ${padRight(r.finish, cols.finish)} | ${padLeft(r.duration, cols.duration)} | ${center(r.resources, cols.resources)} | ${center(r.percent, cols.percent)} | ${center(r.rag, cols.rag)} | ${padRight(r.comment, cols.comment)}\n`;
  }

  const projectStart = tasks.length ? Math.min(...tasks.map((t) => t.start ?? today)) : today;
  const projectFinish = tasks.length ? Math.max(...tasks.map((t) => t.finish ?? today)) : today;

  const milestones = [];
  if (phaseDates.size || tasks.length) {
    let entries = [];
    for (const [phase, d] of phaseDates) entries.push({ name: phase, start: d.start, end: d.end });
    for (const t of tasks) {
      if (t.summary) entries.push({ name: t.name, start: t.start, end: t.finish });
    }
    for (const t of tasks) {
      if (t.durationDays !== 0) continue;
      const display = t.name.replaceAll("_", " ");
      entries.push({ name: display, start: t.start, end: t.start });
      milestones.push({ name: display, date: t.start });
    }
    if (phaseDates.size === 0) {
      for (const t of tasks) {
        if (t.summary) continue;
        const display = t.name.replaceAll("_", " ");
        entries.push({ name: display, start: t.start, end: t.finish });
        milestones.push({ name: display, date: t.finish });
      }
    }

    const seen = new Set();
    entries = entries.filter((e) => {
      const key = `${e.name}\u0000${e.start}\u0000${e.end}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    // None sorts as datetime.now(): after every midnight date of today
    entries.sort((a, b) => (a.start ?? today + 0.5) - (b.start ?? today + 0.5));

    const tl = { name: 9, start: 5, end: 3 };
    for (const e of entries) {
      tl.name = Math.max(tl.name, strLen(e.name));
      if (e.start !== null) tl.start = Math.max(tl.start, fmtDate(e.start).length);
      if (e.end !== null) tl.end = Math.max(tl.end, fmtDate(e.end).length);
    }
    md += `\n# Project Milestones\n\n${padRight("Milestone", tl.name)} | ${padRight("Start", tl.start)} | ${padRight("End", tl.end)}\n`;
    md += `${repeat("-", tl.name + 1)}|${repeat("-", tl.start + 2)}|${repeat("-", tl.end + 1)}\n`;
    for (const e of entries) {
      const s = e.start !== null ? fmtDate(e.start) : "";
      const f = e.end !== null ? fmtDate(e.end) : "";
      md += `${padRight(e.name, tl.name)} | ${padRight(s, tl.start)} | ${padRight(f, tl.end)}\n`;
    }

    for (const [phase, d] of phaseDates) {
      milestones.push({ name: `End of ${phase.replaceAll("_", " ")}`, date: d.end });
    }
    const phaseObjs = [...phaseDates].map(([name, d]) => ({ name, start: d.start }));
    const [timelineRow, labels, datesStr, fullDates, positions] = renderCustomTimeline(
      phaseObjs, milestones, projectStart, projectFinish, tw,
    );
    const startStr = fullDates.length ? fullDates[0] : "";
    const finishStr = fullDates.length ? fullDates[fullDates.length - 1] : "";

    const connectorLine = () => {
      const c = new Array(tw).fill(" ");
      for (const pos of positions) if (pos >= 0 && pos < tw) c[pos] = "│";
      return c.join("");
    };

    md += `Project: ${projectName}\n`;
    md += `Start${repeat(" ", tw - 11)}Finish\n`;
    md += `${startStr}${repeat(" ", tw - startStr.length - finishStr.length)}${finishStr}\n`;
    for (const line of [...labels].reverse()) md += `${line}\n`;
    if (labels.length) md += `${connectorLine()}\n`;

    const combined = chars(timelineRow);
    const totalDays = projectFinish - projectStart || 1;
    const paint = (from, to, progress) => {
      for (let j = from; j <= to; j++) {
        if (j < tw && combined[j] !== "◆") combined[j] = j < from + progress ? "═" : "─";
      }
    };
    if (phaseDates.size) {
      for (const [phase, d] of phaseDates) {
        const phaseTasks = tasks.filter((t) => t.phase === phase && !t.summary);
        if (!phaseTasks.length) continue;
        const avg = phaseTasks.reduce((sum, t) => sum + (t.percent ?? 0), 0) / phaseTasks.length;
        const ps = Math.trunc(((d.start - projectStart) / totalDays) * (tw - 1));
        const pe = Math.trunc(((d.end - projectStart) / totalDays) * (tw - 1));
        paint(ps, pe, Math.trunc(((pe - ps + 1) * avg) / 100));
      }
    } else {
      for (const t of tasks) {
        if (t.summary || t.durationDays === 0 || t.start === null || t.finish === null) continue;
        const ts = Math.trunc(((t.start - projectStart) / totalDays) * (tw - 1));
        const te = Math.trunc(((t.finish - projectStart) / totalDays) * (tw - 1));
        paint(ts, te, Math.trunc(((te - ts + 1) * (t.percent ?? 0)) / 100));
      }
    }
    combined[0] = "├";
    combined[combined.length - 1] = "┤";
    md += `${combined.join("")}\n`;
    md += `${connectorLine()}\n`;
    md += `${datesStr}\n`;
  }

  md += "\n";
  md += renderGanttChart(tasks, projectStart, projectFinish, tw);
  md += "\n";
  md += renderResourceSheet(tasks, projectStart, projectFinish, holidays, tw, resourceMap);
  return md;
}

// --- font coverage -----------------------------------------------------------
//
// jsPDF silently drops any character the embedded font has no glyph for,
// which would shift the report's columns. The font's cmap says what it
// covers, so uncovered characters are replaced with a visible placeholder
// and reported instead.

/** The set of code points a TrueType font has glyphs for (format 4 and 12 cmaps). */
export function fontCoverage(ttfBytes) {
  const view = new DataView(ttfBytes.buffer, ttfBytes.byteOffset, ttfBytes.byteLength);
  const covered = new Set();
  const numTables = view.getUint16(4);
  let cmapOffset = -1;
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    const tag = String.fromCharCode(view.getUint8(rec), view.getUint8(rec + 1), view.getUint8(rec + 2), view.getUint8(rec + 3));
    if (tag === "cmap") cmapOffset = view.getUint32(rec + 8);
  }
  if (cmapOffset < 0) return covered;
  const subtables = view.getUint16(cmapOffset + 2);
  for (let i = 0; i < subtables; i++) {
    const rec = cmapOffset + 4 + i * 8;
    const platform = view.getUint16(rec);
    const encoding = view.getUint16(rec + 2);
    const isUnicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!isUnicode) continue;
    const off = cmapOffset + view.getUint32(rec + 4);
    const format = view.getUint16(off);
    if (format === 4) {
      const segX2 = view.getUint16(off + 6);
      const ends = off + 14;
      const starts = ends + segX2 + 2;
      const deltas = starts + segX2;
      const rangeOffsets = deltas + segX2;
      for (let s = 0; s < segX2 / 2; s++) {
        const end = view.getUint16(ends + s * 2);
        const start = view.getUint16(starts + s * 2);
        const delta = view.getUint16(deltas + s * 2);
        const rangeOffset = view.getUint16(rangeOffsets + s * 2);
        if (start === 0xffff) continue;
        for (let c = start; c <= end; c++) {
          let glyph;
          if (rangeOffset === 0) glyph = (c + delta) & 0xffff;
          else {
            const addr = rangeOffsets + s * 2 + rangeOffset + (c - start) * 2;
            if (addr + 2 > view.byteLength) continue;
            glyph = view.getUint16(addr);
            if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
          }
          if (glyph !== 0) covered.add(c);
        }
      }
    } else if (format === 12) {
      const groups = view.getUint32(off + 12);
      for (let g = 0; g < groups; g++) {
        const rec12 = off + 16 + g * 12;
        const start = view.getUint32(rec12);
        const end = view.getUint32(rec12 + 4);
        for (let c = start; c <= end && c - start < 0x20000; c++) covered.add(c);
      }
    }
  }
  return covered;
}

/**
 * The text with every character the font lacks replaced by MISSING_GLYPH.
 * @returns {{text: string, missing: string[]}} the distinct characters replaced
 */
export function substituteUncovered(text, covered) {
  const missing = new Set();
  const out = chars(text).map((c) => {
    if (c === "\n" || c === " " || covered.has(c.codePointAt(0))) return c;
    missing.add(c);
    return MISSING_GLYPH;
  });
  return { text: out.join(""), missing: [...missing] };
}

// --- the PDF -----------------------------------------------------------------

function toBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** True when every character is one jsPDF's built-in Helvetica can show. */
function isWinAnsi(text) {
  return /^[ -ÿŒœŠšŸŽžƒˆ˜–—‘-‚“-„†-•…‰‹›€™]*$/.test(text);
}

/**
 * Lay the report out as a PDF. Pure: no fetch, no DOM.
 *
 * Follows export_to_pdf: 30pt margins, a 24pt centred title in the app's
 * blue, then the report in the monospace font at 8pt — reduced, where a
 * page is narrower than 120 columns at that size, to the largest size that
 * fits the longest line, so no column is cut off at the right edge as it is
 * in the reportlab output. Lines flow onto further pages as needed.
 *
 * @param {string} title
 * @param {string} report from buildReportText
 * @param {Uint8Array} fontBytes the TrueType font to embed
 * @param {{pageSize?: string}} [options] "a4" (default) or "letter"
 * @returns {{doc: object, warnings: string[]}}
 */
export function buildPdf(title, report, fontBytes, options = {}) {
  const format = PAGE_SIZES[String(options.pageSize || "a4").toLowerCase()] || PAGE_SIZES.a4;
  const doc = new jsPDF({ unit: "pt", format, orientation: "portrait" });
  doc.addFileToVFS(FONT_FILE, toBase64(fontBytes));
  doc.addFont(FONT_FILE, FONT_NAME, "normal");

  const covered = fontCoverage(fontBytes);
  const body = substituteUncovered(report, covered);
  const heading = substituteUncovered(title, covered);
  const warnings = [];
  const missing = [...new Set([...heading.missing, ...body.missing])];
  if (missing.length) {
    warnings.push(
      `${missing.length} character${missing.length === 1 ? "" : "s"} (${missing.join("")}) ` +
        `are outside the embedded font's coverage and were drawn as ${MISSING_GLYPH}.`,
    );
  }

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const usableWidth = pageWidth - 2 * MARGIN;

  // title: Helvetica-Bold as reportlab's Heading1, unless it needs the embedded font
  if (isWinAnsi(title)) doc.setFont("helvetica", "bold");
  else doc.setFont(FONT_NAME, "normal");
  doc.setFontSize(TITLE_SIZE);
  doc.setTextColor(...TITLE_COLOUR);
  const titleLines = doc.splitTextToSize(isWinAnsi(title) ? title : heading.text, usableWidth);
  let y = MARGIN + TITLE_SIZE;
  for (const line of titleLines) {
    doc.text(line, pageWidth / 2, y, { align: "center" });
    y += TITLE_LEADING;
  }
  y += TITLE_SPACE_AFTER - TITLE_LEADING + TITLE_SIZE * 0.2;

  // body
  doc.setFont(FONT_NAME, "normal");
  doc.setTextColor(0, 0, 0);
  const lines = body.text.replace(/\n$/, "").split("\n");
  const longest = Math.max(1, ...lines.map((l) => strLen(l)));
  doc.setFontSize(BODY_SIZE);
  const advance = doc.getStringUnitWidth("M"); // em fraction per character
  const fontSize = Math.min(BODY_SIZE, usableWidth / (longest * advance));
  const leading = fontSize * BODY_LEADING_RATIO;
  doc.setFontSize(fontSize);

  y += fontSize;
  for (const line of lines) {
    if (y > pageHeight - MARGIN) {
      doc.addPage();
      y = MARGIN + fontSize;
    }
    if (line) doc.text(line, MARGIN, y);
    y += leading;
  }

  return { doc, warnings, fontSize };
}

/** The font, or null when the deployment has not provided one. */
export async function fetchFont(url = FONT_URL, fetchImpl = globalThis.fetch) {
  try {
    const response = await fetchImpl(url);
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    // a TrueType font starts with 0x00010000 or 'true'; anything else is an
    // error page served with a 200
    const tag = bytes.length > 4 ? [...bytes.subarray(0, 4)] : [];
    const ok = String(tag) === String([0, 1, 0, 0]) || String(tag) === String([0x74, 0x72, 0x75, 0x65]);
    return ok ? bytes : null;
  } catch {
    return null;
  }
}

/** The paper size the user chose in localStorage, "a4" when unset. */
export function pageSizeSetting() {
  try {
    const value = String(globalThis.localStorage?.getItem(PAGE_SIZE_SETTING) || "").toLowerCase();
    return PAGE_SIZES[value] ? value : "a4";
  } catch {
    return "a4";
  }
}

/** `{name} v{version}.pdf` as PlanService names it, made safe for a file name. */
export function pdfFilename(parse, projectName) {
  const name = projectName || parse?.project_name || "Project";
  const version = parse?.front_matter?.version;
  const stem = version ? `${name} v${version}` : name;
  return `${stem.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").trim() || "project"}.pdf`;
}

function downloadBytes(bytes, filename) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
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
 * The only request is for the font asset; a missing one throws
 * FONT_MISSING_MESSAGE rather than falling back to a server export.
 *
 * @param {object} parse the `/api/parse` payload for the current plan
 * @param {string} planText the plan the payload was parsed from (for the
 *   front matter's non-working days)
 * @param {{projectName?: string, pageSize?: string, fetch?: Function, download?: Function}} [io]
 *   overridable for tests
 * @returns {Promise<{filename: string, bytes: Uint8Array, warnings: string[]}>}
 */
export async function exportPdfInBrowser(parse, planText, io = {}) {
  const font = await fetchFont(FONT_URL, io.fetch || globalThis.fetch);
  if (!font) throw new Error(FONT_MISSING_MESSAGE);

  const projectName = io.projectName || parse?.project_name || "Project";
  const report = buildReportText(parse, { projectName, holidays: parseNonWorkingDays(planText) });
  const { doc, warnings } = buildPdf(`${projectName} - Project Plan`, report, font, {
    pageSize: io.pageSize || pageSizeSetting(),
  });
  for (const message of warnings) console.warn("[pdf]", message);

  const bytes = new Uint8Array(doc.output("arraybuffer"));
  const filename = pdfFilename(parse, projectName);
  (io.download || downloadBytes)(bytes, filename);
  return { filename, bytes, warnings };
}
