/**
 * PowerPoint decks, built in the browser (issue #791).
 *
 * A port of the python-pptx exporters in noodle_core/exporters.py:
 *
 *   export_report_to_powerpoint    -> buildReportDeck
 *     _add_report_slide            -> addReportSlide
 *     _add_highlight_slide         -> addHighlightSlide
 *   export_portfolio_to_powerpoint -> buildPortfolioDeck
 *     _add_portfolio_overview_slide-> addPortfolioOverviewSlide
 *     _add_portfolio_risk_slides   -> addPortfolioRiskSlides
 *
 * The page already assembles the exact payloads the server routes take
 * (static/portfolio-report.js and the report view), so this module is a
 * straight substitution: same data in, the same deck out, without the round
 * trip. The Python exporters stay for the CLI.
 *
 * Units. python-pptx is explicit — `Inches(0.4)`, `Pt(9)`. PptxGenJS takes
 * inches for geometry and points for type, so the numbers below are the same
 * numbers as the Python, and `IN`/`PT` exist to make that obvious at each
 * call site rather than to convert anything.
 *
 * Everything except `exportReportPptxInBrowser` / `exportPortfolioPptxInBrowser`
 * is pure — no fetch, no DOM — so tests/test_pptx_browser_export.mjs drives
 * the same code the browser runs.
 */
import PptxGenJS from "./vendor/pptxgenjs/pptxgen.es.js";

/** Slide geometry, matching prs.slide_width/height in the Python. */
export const SLIDE_WIDTH = 13.333;
export const SLIDE_HEIGHT = 7.5;

/** python-pptx Inches()/Pt() are identity here; kept for readability. */
export const IN = (v) => v;
export const PT = (v) => v;

// The exporters' palette, as RGBColor(...) in the Python.
export const COLOURS = {
  DARK_BLUE: "213C72",
  MID_BLUE: "366092",
  LIGHT_BLUE: "B4C6E7",
  WHITE: "FFFFFF",
  BLACK: "000000",
  LIGHT_GREY: "F2F2F2",
  RED: "C00000",
  AMBER: "DAA520",
  GREEN: "008000",
  COMPLETE_BLUE: "1976D2",
  GREY: "808080",
  MUTED: "646464",
  FOOTER: "A0A0A0",
};

/** noodle_core.exporters.rag_status_to_colour, verbatim. */
export const RAG_STATUS_TO_COLOUR = {
  "not started": "green",
  "on track": "green",
  "ahead of schedule": "green",
  complete: "blue",
  "behind schedule": "amber",
  "task overdue": "red",
  green: "green",
  amber: "amber",
  red: "red",
};

export function ragStatusToColour(status) {
  return RAG_STATUS_TO_COLOUR[String(status || "").toLowerCase()] || "grey";
}

/** The hex the report slides paint a RAG string in (_rag_colour). */
export function ragColour(status) {
  switch (ragStatusToColour(status)) {
    case "red":
      return COLOURS.RED;
    case "amber":
      return COLOURS.AMBER;
    case "green":
      return COLOURS.GREEN;
    case "blue":
      return COLOURS.COMPLETE_BLUE;
    default:
      return COLOURS.BLACK;
  }
}

/**
 * Strip the control characters python-pptx rejects (_sanitise_text). The XML
 * PowerPoint accepts excludes them, so a stray one corrupts the whole file.
 */
export function sanitise(text) {
  // eslint-disable-next-line no-control-regex
  return String(text ?? "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
}

/** Cell options shared by every table cell the Python writes. */
function cellOptions({ fontSize = 8, bold = false, colour = null, align = "left", fill = null } = {}) {
  const options = {
    fontSize: PT(fontSize),
    bold,
    align,
    valign: "top",
    // _set_cell_text's margins, in inches, as PptxGenJS's [T, R, B, L] points
    margin: [PT(1.44), PT(2.88), PT(1.44), PT(2.88)],
  };
  if (colour) options.color = colour;
  if (fill) options.fill = { color: fill };
  return options;
}

function headerCell(text, { align = "left" } = {}) {
  return { text: sanitise(text), options: cellOptions({ fontSize: 9, bold: true, colour: COLOURS.WHITE, align, fill: COLOURS.DARK_BLUE }) };
}

function bodyCell(text, options = {}) {
  return { text: sanitise(text), options: cellOptions(options) };
}

/** The Python shades even-numbered body rows LIGHT_GREY. */
function rowFill(rowIndex) {
  return rowIndex % 2 === 0 ? COLOURS.LIGHT_GREY : null;
}

function placeholderText(slide, text, x, y, w) {
  slide.addText(sanitise(text), {
    x, y, w, h: IN(0.3),
    fontSize: PT(9),
    color: COLOURS.GREY,
  });
}

function sectionHeading(slide, text, x, y, w) {
  slide.addText(sanitise(text), {
    x, y, w, h: IN(0.3),
    fontSize: PT(13),
    bold: true,
    color: COLOURS.MID_BLUE,
  });
}

/**
 * Highlight body lines, as both highlight renderers prepare them: markdown
 * bold stripped, "- " turned into a bullet, headings detected.
 */
export function highlightLines(content) {
  return String(content || "").split("\n").map((line) => {
    const trimmed = line.trim();
    const isHeading = trimmed.startsWith("**") && trimmed.endsWith("**") && trimmed.length > 4;
    let clean = trimmed.replace(/\*\*(.+?)\*\*/g, "$1");
    if (clean.startsWith("- ")) clean = "• " + clean.slice(2);
    return { text: sanitise(clean), isHeading };
  });
}

/** The meta line under a highlight: "date  @author". */
export function highlightMeta(highlight) {
  const parts = [];
  if (highlight?.date) parts.push(highlight.date);
  if (highlight?.author) parts.push(`@${highlight.author}`);
  return parts.join("  ");
}

// --- the report deck ---------------------------------------------------------

/**
 * The four-quadrant project report slide (_add_report_slide).
 *
 * @param {object} pptx PptxGenJS presentation
 * @param {object} reportData the payload /api/export-report-pptx takes
 * @param {boolean} includeFooter
 */
export function addReportSlide(pptx, reportData, includeFooter = true) {
  const slide = pptx.addSlide();
  const data = reportData || {};
  const projectName = data.project_name || "Project";
  const reportDate = data.date || "";

  // Title bar
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: SLIDE_WIDTH, h: IN(0.85),
    fill: { color: COLOURS.DARK_BLUE },
    line: { type: "none" },
  });
  slide.addText(sanitise(projectName), {
    x: IN(0.4), y: IN(0.08), w: IN(6), h: IN(0.45),
    fontSize: PT(22), bold: true, color: COLOURS.WHITE,
  });

  const details = [];
  if (data.manager) details.push(`PM: ${data.manager}`);
  if (data.sponsor) details.push(`Sponsor: ${data.sponsor}`);
  if (data.budget) details.push(`Budget: ${data.budget}`);
  if (reportDate) details.push(`Date: ${reportDate}`);
  if (data.percent_complete !== undefined && data.percent_complete !== null) {
    details.push(`${data.percent_complete}% complete`);
  }
  if (details.length) {
    slide.addText(sanitise(details.join("   |   ")), {
      x: IN(0.4), y: IN(0.5), w: IN(10), h: IN(0.3),
      fontSize: PT(10), color: COLOURS.WHITE,
    });
  }

  if (data.status) {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: IN(11.5), y: IN(0.15), w: IN(1.6), h: IN(0.55),
      fill: { color: COLOURS.WHITE },
      line: { type: "none" },
      rectRadius: 0.06,
    });
    slide.addText(sanitise(String(data.status).toUpperCase()), {
      x: IN(11.5), y: IN(0.15), w: IN(1.6), h: IN(0.55),
      fontSize: PT(16), bold: true, align: "center",
      color: ragColour(data.status),
    });
  }

  // The timeline image, when the page captured one
  let timelineUsed = 0;
  if (data.timeline_image) {
    const maxHeight = IN(1.8);
    slide.addImage({
      data: `image/png;base64,${data.timeline_image}`,
      x: IN(0.4), y: IN(1.05), w: IN(12.533), h: maxHeight,
    });
    timelineUsed = maxHeight + IN(0.15);
  }

  const leftMargin = IN(0.4);
  const gap = IN(0.3);
  const colWidth = (SLIDE_WIDTH - leftMargin * 2 - gap) / 2;
  const topRow = IN(1.05) + timelineUsed;
  const bottomRow = topRow + IN(3.0) + gap;
  const rightCol = leftMargin + colWidth + gap;

  // TOP-LEFT: Milestones
  sectionHeading(slide, "Milestones", leftMargin, topRow, colWidth);
  const milestones = (data.milestones || []).slice(0, 10);
  if (milestones.length) {
    const rows = [[headerCell("Milestone"), headerCell("Date", { align: "center" }), headerCell("RAG", { align: "center" })]];
    milestones.forEach((ms, i) => {
      const fill = rowFill(i + 1);
      rows.push([
        bodyCell(ms.name || "", { fill }),
        bodyCell(ms.date || "", { align: "center", fill }),
        bodyCell(ms.rag || "", { bold: true, colour: ragColour(ms.rag), align: "center", fill }),
      ]);
    });
    slide.addTable(rows, {
      x: leftMargin, y: topRow + IN(0.35), w: colWidth,
      colW: [colWidth * 0.55, colWidth * 0.3, colWidth * 0.15],
      rowH: IN(0.26), border: { type: "none" },
    });
  } else {
    placeholderText(slide, "No upcoming milestones.", leftMargin, topRow + IN(0.35), colWidth);
  }

  // TOP-RIGHT: Up Next
  sectionHeading(slide, "Up Next", rightCol, topRow, colWidth);
  const upNext = (data.up_next || []).slice(0, 10);
  if (upNext.length) {
    const rows = [[
      headerCell("Task"),
      headerCell("Start", { align: "center" }),
      headerCell("Finish", { align: "center" }),
      headerCell("RAG", { align: "center" }),
    ]];
    upNext.forEach((item, i) => {
      const fill = rowFill(i + 1);
      rows.push([
        bodyCell(item.name || "", { fill }),
        bodyCell(item.start || "", { align: "center", fill }),
        bodyCell(item.finish || "", { align: "center", fill }),
        bodyCell(item.rag || "", { bold: true, colour: ragColour(item.rag), align: "center", fill }),
      ]);
    });
    slide.addTable(rows, {
      x: rightCol, y: topRow + IN(0.35), w: colWidth,
      colW: [colWidth * 0.4, colWidth * 0.18, colWidth * 0.18, colWidth * 0.24],
      rowH: IN(0.26), border: { type: "none" },
    });
  } else {
    placeholderText(slide, "No upcoming tasks in the next 2 weeks.", rightCol, topRow + IN(0.35), colWidth);
  }

  // BOTTOM-LEFT: Latest Highlight
  sectionHeading(slide, "Latest Highlight", leftMargin, bottomRow, colWidth);
  const highlight = data.highlight;
  let highlightTop = bottomRow + IN(0.35);
  if (highlight && highlight.content) {
    const meta = highlightMeta(highlight);
    if (meta) {
      slide.addText(sanitise(meta), {
        x: leftMargin, y: highlightTop, w: colWidth, h: IN(0.25),
        fontSize: PT(8), color: COLOURS.MUTED, italic: true,
      });
      highlightTop += IN(0.25);
    }
    slide.addText(
      highlightLines(highlight.content).map((line) => ({
        text: line.text + "\n",
        options: { fontSize: PT(9), color: COLOURS.BLACK },
      })),
      { x: leftMargin, y: highlightTop, w: colWidth, h: IN(2.3), valign: "top" },
    );
  } else {
    placeholderText(slide, "No highlights recorded yet.", leftMargin, highlightTop, colWidth);
  }

  // BOTTOM-RIGHT: Risks & Issues
  sectionHeading(slide, "Risks & Issues", rightCol, bottomRow, colWidth);
  const risks = (data.risks_issues || []).slice(0, 10);
  if (risks.length) {
    const rows = [[
      headerCell("Type", { align: "center" }),
      headerCell("Title"),
      headerCell("Description"),
      headerCell("Mitigation"),
      headerCell("Score", { align: "center" }),
    ]];
    risks.forEach((item, i) => {
      const fill = rowFill(i + 1);
      const score = Number(item.score || 0);
      const scoreColour = score >= 16 ? COLOURS.RED : score >= 6 ? COLOURS.AMBER : COLOURS.GREEN;
      const type = String(item.type || "");
      rows.push([
        bodyCell(type ? type.charAt(0).toUpperCase() + type.slice(1) : "", { bold: true, align: "center", fill }),
        bodyCell(item.title || "", { fill }),
        bodyCell(item.description || "", { fill }),
        bodyCell(item.mitigation || "", { fill }),
        bodyCell(String(score), { bold: true, colour: scoreColour, align: "center", fill }),
      ]);
    });
    slide.addTable(rows, {
      x: rightCol, y: bottomRow + IN(0.35), w: colWidth,
      colW: [colWidth * 0.1, colWidth * 0.2, colWidth * 0.28, colWidth * 0.28, colWidth * 0.14],
      rowH: IN(0.26), border: { type: "none" },
    });
  } else {
    placeholderText(slide, "No open risks or issues.", rightCol, bottomRow + IN(0.35), colWidth);
  }

  if (includeFooter) {
    slide.addText(`Generated by Noodle Planner  |  ${reportDate}`, {
      x: IN(0.4), y: IN(7.1), w: IN(4), h: IN(0.25),
      fontSize: PT(7), color: COLOURS.FOOTER,
    });
  }

  return slide;
}

/** The dedicated latest-highlight slide (_add_highlight_slide). */
export function addHighlightSlide(pptx, reportData) {
  const highlight = reportData?.highlight;
  if (!highlight || !highlight.content) return null; // no highlight — skip the slide

  const slide = pptx.addSlide();
  const projectName = reportData.project_name || "Project";

  slide.addText(sanitise(`${projectName} — Latest Highlight`), {
    x: IN(0.5), y: IN(0.3), w: IN(12), h: IN(0.6),
    fontSize: PT(24), bold: true, color: COLOURS.DARK_BLUE,
  });

  const meta = highlightMeta(highlight);
  if (meta) {
    slide.addText(sanitise(meta), {
      x: IN(0.5), y: IN(1.0), w: IN(12), h: IN(0.3),
      fontSize: PT(11), color: COLOURS.MUTED, italic: true,
    });
  }

  slide.addText(
    highlightLines(highlight.content).map((line) => ({
      text: line.text + "\n",
      options: {
        fontSize: PT(line.isHeading ? 14 : 12),
        bold: line.isHeading,
        color: line.isHeading ? COLOURS.DARK_BLUE : COLOURS.BLACK,
        paraSpaceAfter: PT(4),
      },
    })),
    { x: IN(0.5), y: IN(1.4), w: IN(12), h: IN(5.5), valign: "top" },
  );

  return slide;
}

function newPresentation() {
  const pptx = new PptxGenJS();
  // prs.slide_width / slide_height in the Python
  pptx.defineLayout({ name: "NP_WIDE", width: SLIDE_WIDTH, height: SLIDE_HEIGHT });
  pptx.layout = "NP_WIDE";
  return pptx;
}

/** The weekly report deck: the report slide, then the highlight slide. */
export function buildReportDeck(reportData) {
  const pptx = newPresentation();
  addReportSlide(pptx, reportData);
  addHighlightSlide(pptx, reportData);
  return pptx;
}

// --- the portfolio deck ------------------------------------------------------

/** The portfolio overview slide: a table of every project. */
export function addPortfolioOverviewSlide(pptx, portfolioData) {
  const slide = pptx.addSlide();
  const data = portfolioData || {};
  const name = data.portfolio_name || "Portfolio";

  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: SLIDE_WIDTH, h: IN(0.85),
    fill: { color: COLOURS.DARK_BLUE },
    line: { type: "none" },
  });
  slide.addText(sanitise(name), {
    x: IN(0.4), y: IN(0.08), w: IN(8), h: IN(0.45),
    fontSize: PT(22), bold: true, color: COLOURS.WHITE,
  });
  if (data.date) {
    slide.addText(sanitise(`Date: ${data.date}`), {
      x: IN(0.4), y: IN(0.5), w: IN(8), h: IN(0.3),
      fontSize: PT(10), color: COLOURS.WHITE,
    });
  }

  let top = IN(1.05);
  if (data.timeline_image) {
    const maxHeight = IN(1.8);
    slide.addImage({
      data: `image/png;base64,${data.timeline_image}`,
      x: IN(0.4), y: top, w: IN(12.533), h: maxHeight,
    });
    top += maxHeight + IN(0.15);
  }

  sectionHeading(slide, "Projects", IN(0.4), top, IN(12.533));
  const projects = data.projects || [];
  if (!projects.length) {
    placeholderText(slide, "No projects in this portfolio.", IN(0.4), top + IN(0.35), IN(12.533));
    return slide;
  }

  const width = IN(12.533);
  const rows = [[
    headerCell("Project"),
    headerCell("Status"),
    headerCell("RAG", { align: "center" }),
    headerCell("Complete", { align: "center" }),
    headerCell("Risks", { align: "center" }),
    headerCell("Budget"),
    headerCell("Start", { align: "center" }),
    headerCell("End", { align: "center" }),
  ]];
  projects.slice(0, 15).forEach((p, i) => {
    const fill = rowFill(i + 1);
    rows.push([
      bodyCell(p.name || "", { fill }),
      bodyCell(p.status || "", { fill }),
      bodyCell(p.rag || "", { bold: true, colour: ragColour(p.rag), align: "center", fill }),
      bodyCell(`${p.completion ?? 0}%`, { align: "center", fill }),
      bodyCell(String(p.risk_count ?? 0), { align: "center", fill }),
      bodyCell(p.budget || "", { fill }),
      bodyCell(p.start_date || "", { align: "center", fill }),
      bodyCell(p.end_date || "", { align: "center", fill }),
    ]);
  });
  slide.addTable(rows, {
    x: IN(0.4), y: top + IN(0.35), w: width,
    colW: [width * 0.24, width * 0.14, width * 0.08, width * 0.1, width * 0.08, width * 0.14, width * 0.11, width * 0.11],
    rowH: IN(0.26), border: { type: "none" },
  });
  return slide;
}

/** One slide listing the portfolio's open risks and issues. */
export function addPortfolioRiskSlides(pptx, portfolioData, risks) {
  const items = risks || [];
  if (!items.length) return [];

  const slide = pptx.addSlide();
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: SLIDE_WIDTH, h: IN(0.85),
    fill: { color: COLOURS.DARK_BLUE },
    line: { type: "none" },
  });
  slide.addText(sanitise(`${portfolioData?.portfolio_name || "Portfolio"} — Risks & Issues`), {
    x: IN(0.4), y: IN(0.2), w: IN(12), h: IN(0.45),
    fontSize: PT(22), bold: true, color: COLOURS.WHITE,
  });

  const width = IN(12.533);
  const rows = [[
    headerCell("Project"),
    headerCell("Type", { align: "center" }),
    headerCell("Title"),
    headerCell("Description"),
    headerCell("Mitigation"),
    headerCell("Score", { align: "center" }),
  ]];
  items.slice(0, 15).forEach((item, i) => {
    const fill = rowFill(i + 1);
    const score = Number(item.score || 0);
    const scoreColour = score >= 16 ? COLOURS.RED : score >= 6 ? COLOURS.AMBER : COLOURS.GREEN;
    const type = String(item.type || "");
    rows.push([
      bodyCell(item.project || "", { fill }),
      bodyCell(type ? type.charAt(0).toUpperCase() + type.slice(1) : "", { bold: true, align: "center", fill }),
      bodyCell(item.title || "", { fill }),
      bodyCell(item.description || "", { fill }),
      bodyCell(item.mitigation || "", { fill }),
      bodyCell(String(score), { bold: true, colour: scoreColour, align: "center", fill }),
    ]);
  });
  slide.addTable(rows, {
    x: IN(0.4), y: IN(1.05), w: width,
    colW: [width * 0.16, width * 0.1, width * 0.18, width * 0.24, width * 0.24, width * 0.08],
    rowH: IN(0.26), border: { type: "none" },
  });
  return [slide];
}

/**
 * The portfolio deck: an overview slide, a risks slide, then one report slide
 * per project (export_portfolio_to_powerpoint).
 *
 * @param {object} portfolioData
 * @param {Array} projectReports
 * @param {(done: number, total: number, label: string) => void} [onProgress]
 *   Called after each slide is added, so a caller (e.g. a Web Worker) can
 *   report build progress back without needing to know the deck's internals.
 */
export function buildPortfolioDeck(portfolioData, projectReports, onProgress) {
  const reports = projectReports || [];
  const total = 2 + reports.length; // overview + risks + one per project
  let done = 0;
  const report = (label) => { if (onProgress) onProgress(++done, total, label); };

  const pptx = newPresentation();
  addPortfolioOverviewSlide(pptx, portfolioData);
  report("Portfolio overview");

  // Every project's open risks, tagged with the project they came from
  const risks = [];
  for (const r of reports) {
    for (const item of r.risks_issues || []) {
      risks.push({ ...item, project: r.project_name || "" });
    }
  }
  addPortfolioRiskSlides(pptx, portfolioData, risks);
  report("Risks & issues");

  for (const r of reports) {
    addReportSlide(pptx, r, false);
    report(r.project_name || "Project");
  }
  return pptx;
}

// --- file names and the browser entry points ---------------------------------

/** A safe file-name stem, as the server's Content-Disposition produced. */
export function pptxFilename(name, suffix = "") {
  const stem = String(name || "Project").replace(/[\\/:*?"<>| -]+/g, "-").trim() || "Project";
  return `${stem}${suffix}.pptx`;
}

function downloadBytes(bytes, filename) {
  const url = URL.createObjectURL(new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** The deck as bytes, in Node and in the browser alike. */
export async function deckBytes(pptx) {
  const out = await pptx.write({ outputType: "arraybuffer" });
  return new Uint8Array(out);
}

/**
 * Export the weekly report deck. Nothing is sent to the server.
 * @returns {Promise<{filename: string, bytes: Uint8Array}>}
 */
export async function exportReportPptxInBrowser(reportData, io = {}) {
  const bytes = await deckBytes(buildReportDeck(reportData));
  const filename = pptxFilename(reportData?.project_name, " - Report");
  (io.download || downloadBytes)(bytes, filename);
  return { filename, bytes };
}

/** Export the portfolio deck. Nothing is sent to the server. */
export async function exportPortfolioPptxInBrowser(portfolioData, projectReports, io = {}) {
  const bytes = await deckBytes(buildPortfolioDeck(portfolioData, projectReports));
  const filename = pptxFilename(portfolioData?.portfolio_name, " - Portfolio Report");
  (io.download || downloadBytes)(bytes, filename);
  return { filename, bytes };
}
