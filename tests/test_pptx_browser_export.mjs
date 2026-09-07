/**
 * The browser's PowerPoint decks (static/pptx-export.js), exercised in Node
 * (issue #791).
 *
 * The decks are built in the browser from the payloads the page already
 * assembles for /api/export-report-pptx and /api/portfolio/export-pptx, so
 * these tests feed the same payload to both implementations and compare the
 * result: slide count, the text on each slide, the fill colours, and the
 * table shapes.
 *
 *   node --test tests/test_pptx_browser_export.mjs
 *
 * The comparisons need the repo's Python venv; they skip without it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  COLOURS,
  addHighlightSlide,
  addReportSlide,
  buildPortfolioDeck,
  buildReportDeck,
  deckBytes,
  highlightLines,
  highlightMeta,
  pptxFilename,
  ragColour,
  ragStatusToColour,
} from "../packages/noodle-web/src/noodle_web/static/pptx-export.js";

const repo = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const python = `${repo}/.venv/bin/python`;
const hasPython = existsSync(python);

/** A report payload with every section populated, as the page sends it. */
const REPORT = {
  project_name: "Silverfort",
  manager: "Kévin McAleer",
  sponsor: "Katie Fox",
  budget: "£125,000",
  date: "2026-09-06",
  status: "Amber",
  milestones: [
    { name: "GW1 Approval", date: "2026-07-02", rag: "complete" },
    { name: "GW2 Approval", date: "2026-08-14", rag: "on track" },
    { name: "GW3 Approval", date: "2026-10-01", rag: "behind schedule" },
  ],
  up_next: [
    { name: "Resolve License issue", start: "2026-09-07", finish: "2026-09-11", rag: "on track" },
    { name: "Verify agent on MES", start: "2026-09-14", finish: "2026-09-15", rag: "task overdue" },
  ],
  highlight: {
    date: "2026-09-02",
    author: "kevin",
    content: "**Progress**\n- Licensing resolved\n- Phased deployment agreed\n\nNext: confirm RFDC outcome.",
  },
  risks_issues: [
    { type: "issue", title: "License", description: "Wrong licence procured", mitigation: "Renegotiated", score: 15 },
    { type: "risk", title: "Slippage", description: "Spec may slip", mitigation: "Weekly check-in", score: 6 },
    { type: "risk", title: "Minor", description: "Low impact", mitigation: "Monitor", score: 2 },
  ],
  timeline_tasks: [],
};

const PORTFOLIO = {
  portfolio_name: "Delivery Portfolio",
  date: "2026-09-06",
  projects: [
    { name: "Silverfort", status: "In flight", rag: "amber", completion: 39, risk_count: 2, budget: "£125,000", start_date: "2026-06-25", end_date: "2026-10-28" },
    { name: "Website Redesign", status: "In flight", rag: "green", completion: 72, risk_count: 0, budget: "£40,000", start_date: "2026-05-01", end_date: "2026-09-30" },
  ],
};

const PROJECT_REPORTS = [REPORT, { ...REPORT, project_name: "Website Redesign", status: "Green", highlight: null, risks_issues: [] }];

/** The Python deck for the same payload, as raw bytes. */
function pythonDeck(kind) {
  const script = `
import base64, json, sys, tempfile, logging, os
logging.disable(logging.CRITICAL)
sys.path.insert(0, ${JSON.stringify(`${repo}/packages/noodle-core/src`)})
from noodle_core.exporters import export_report_to_powerpoint, export_portfolio_to_powerpoint
report = json.loads(${JSON.stringify(JSON.stringify(REPORT))})
portfolio = json.loads(${JSON.stringify(JSON.stringify(PORTFOLIO))})
reports = json.loads(${JSON.stringify(JSON.stringify(PROJECT_REPORTS))})
path = tempfile.mktemp(suffix=".pptx")
if ${JSON.stringify(kind)} == "report":
    export_report_to_powerpoint(path, report)
else:
    export_portfolio_to_powerpoint(path, portfolio, reports)
print(base64.b64encode(open(path, "rb").read()).decode())
os.unlink(path)
`;
  return Buffer.from(execFileSync(python, ["-c", script], { cwd: repo, maxBuffer: 64 * 1024 * 1024 }).toString().trim(), "base64");
}

/** Slide text is XML-escaped in the file ("Risks &amp; Issues"). */
function decodeEntities(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&");
}

/** Slide-by-slide text, fills and table shape, from a .pptx's XML. */
async function deckParts(bytes) {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1]));

  const slides = [];
  for (const name of names) {
    const xml = await zip.file(name).async("string");
    slides.push({
      xml,
      texts: [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => decodeEntities(m[1])),
      fills: [...xml.matchAll(/<a:srgbClr val="([0-9A-Fa-f]{6})"\/>/g)].map((m) => m[1].toUpperCase()),
      tables: (xml.match(/<a:tbl>/g) || []).length,
      rows: (xml.match(/<a:tr /g) || []).length,
      images: (xml.match(/<p:pic>/g) || []).length,
    });
  }
  return slides;
}

// --- pure helpers ------------------------------------------------------------

test("RAG mapping matches the Python exporter's", () => {
  // exactly noodle_core.exporters.rag_status_to_colour
  assert.equal(ragStatusToColour("On Track"), "green");
  assert.equal(ragStatusToColour("not started"), "green");
  assert.equal(ragStatusToColour("ahead of schedule"), "green");
  assert.equal(ragStatusToColour("Complete"), "blue");
  assert.equal(ragStatusToColour("behind schedule"), "amber");
  assert.equal(ragStatusToColour("task overdue"), "red");
  assert.equal(ragStatusToColour("something else"), "grey");
  assert.equal(ragStatusToColour(""), "grey");
  assert.equal(ragStatusToColour(null), "grey");

  assert.equal(ragColour("task overdue"), COLOURS.RED);
  assert.equal(ragColour("behind schedule"), COLOURS.AMBER);
  assert.equal(ragColour("on track"), COLOURS.GREEN);
  assert.equal(ragColour("complete"), COLOURS.COMPLETE_BLUE);
  assert.equal(ragColour("unknown"), COLOURS.BLACK);
});

test("highlight lines are prepared as the Python does", () => {
  const lines = highlightLines("**Progress**\n- One\n- Two\n\nPlain **bold** text");
  assert.deepEqual(lines.map((l) => l.text), ["Progress", "• One", "• Two", "", "Plain bold text"]);
  assert.deepEqual(lines.map((l) => l.isHeading), [true, false, false, false, false]);
  assert.equal(highlightMeta({ date: "2026-09-02", author: "kevin" }), "2026-09-02  @kevin");
  assert.equal(highlightMeta({ author: "kevin" }), "@kevin");
  assert.equal(highlightMeta({}), "");
});

test("file names are safe", () => {
  assert.equal(pptxFilename("Silverfort", " - Report"), "Silverfort - Report.pptx");
  const name = pptxFilename('Project "Q3" / plan');
  assert.match(name, /\.pptx$/);
  assert.ok(!/[\\/:*?"<>|]/.test(name), `unsafe characters in ${name}`);
});

// --- the report deck ---------------------------------------------------------

test("the report deck has the same slides as Python's", { skip: !hasPython }, async () => {
  const browser = await deckParts(await deckBytes(buildReportDeck(REPORT)));
  const py = await deckParts(pythonDeck("report"));

  assert.equal(browser.length, py.length, "slide count differs");
  assert.equal(browser.length, 2, "expected a report slide and a highlight slide");
});

test("every value Python puts on the report slide is on ours", { skip: !hasPython }, async () => {
  const browser = await deckParts(await deckBytes(buildReportDeck(REPORT)));
  const ours = browser[0].texts.join("\n");

  for (const expected of [
    "Silverfort",
    "PM: Kévin McAleer",
    "Sponsor: Katie Fox",
    "Budget: £125,000",
    "Date: 2026-09-06",
    "AMBER",
    "Milestones", "Up Next", "Latest Highlight", "Risks & Issues",
    "GW1 Approval", "GW3 Approval",
    "Resolve License issue",
    "License", "Slippage",
    "Generated by Noodle Planner",
  ]) {
    assert.ok(ours.includes(expected), `${expected} missing from the report slide`);
  }
  // Three of the four quadrants are tables; the highlight quadrant is a
  // text box, as it is in the Python.
  assert.equal(browser[0].tables, 3, "expected milestones, up-next and risks tables");
});

test("the report slide paints the palette Python paints", { skip: !hasPython }, async () => {
  const browser = await deckParts(await deckBytes(buildReportDeck(REPORT)));
  const fills = new Set(browser[0].fills);

  assert.ok(fills.has(COLOURS.DARK_BLUE), "title bar / header fill missing");
  assert.ok(fills.has(COLOURS.WHITE), "white text or status pill missing");
  assert.ok(fills.has(COLOURS.LIGHT_GREY), "banded row fill missing");
  assert.ok(fills.has(COLOURS.MID_BLUE), "section heading colour missing");
  // a red score (15 is under 16, so amber) and an overdue RAG
  assert.ok(fills.has(COLOURS.AMBER), "amber missing");
  assert.ok(fills.has(COLOURS.RED), "red missing");
  assert.ok(fills.has(COLOURS.COMPLETE_BLUE), "complete-blue missing");
});

test("the highlight slide carries the highlight, headings and all", { skip: !hasPython }, async () => {
  const browser = await deckParts(await deckBytes(buildReportDeck(REPORT)));
  const text = browser[1].texts.join("\n");

  assert.ok(text.includes("Silverfort — Latest Highlight"), "title missing");
  assert.ok(text.includes("2026-09-02  @kevin"), "meta line missing");
  assert.ok(text.includes("Progress"), "heading missing");
  assert.ok(text.includes("• Licensing resolved"), "bullet not converted");
  assert.ok(!text.includes("**"), "markdown bold survived into the deck");
});

test("no highlight means no highlight slide, as in the Python", { skip: !hasPython }, async () => {
  const without = { ...REPORT, highlight: null };
  const browser = await deckParts(await deckBytes(buildReportDeck(without)));
  const py = await deckParts(pythonDeck("report").length ? pythonDeck("report") : null);

  assert.equal(browser.length, 1, "the highlight slide should be skipped");
  assert.ok(py.length >= 1);
});

test("empty sections produce the same placeholders Python writes", async () => {
  const bare = {
    project_name: "Empty", date: "2026-09-06",
    milestones: [], up_next: [], risks_issues: [], highlight: null,
  };
  const [slide] = await deckParts(await deckBytes(buildReportDeck(bare)));
  const text = slide.texts.join("\n");

  assert.ok(text.includes("No upcoming milestones."));
  assert.ok(text.includes("No upcoming tasks in the next 2 weeks."));
  assert.ok(text.includes("No highlights recorded yet."));
  assert.ok(text.includes("No open risks or issues."));
  assert.equal(slide.tables, 0, "empty sections should not draw tables");
});

test("an embedded timeline image is embedded", async () => {
  // a 1x1 transparent PNG
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const [slide] = await deckParts(await deckBytes(buildReportDeck({ ...REPORT, timeline_image: png })));
  assert.equal(slide.images, 1, "the timeline image was not embedded");
});

// --- the portfolio deck ------------------------------------------------------

test("the portfolio deck has an overview, risks, and a slide per project", { skip: !hasPython }, async () => {
  const browser = await deckParts(await deckBytes(buildPortfolioDeck(PORTFOLIO, PROJECT_REPORTS)));

  // overview + risks + one per project
  assert.equal(browser.length, 2 + PROJECT_REPORTS.length);

  const overview = browser[0].texts.join("\n");
  assert.ok(overview.includes("Delivery Portfolio"), "portfolio name missing");
  assert.ok(overview.includes("Silverfort") && overview.includes("Website Redesign"), "projects missing");
  assert.ok(overview.includes("39%") && overview.includes("72%"), "completion missing");
  assert.equal(browser[0].tables, 1);

  const risks = browser[1].texts.join("\n");
  assert.ok(risks.includes("Risks & Issues"), "risk slide title missing");
  assert.ok(risks.includes("License"), "risk row missing");
  assert.ok(risks.includes("Silverfort"), "risks should name the project they came from");
});

test("a portfolio with no risks skips the risk slide", async () => {
  const clean = PROJECT_REPORTS.map((r) => ({ ...r, risks_issues: [] }));
  const browser = await deckParts(await deckBytes(buildPortfolioDeck(PORTFOLIO, clean)));
  assert.equal(browser.length, 1 + clean.length, "expected overview plus one slide per project");
});

test("project slides in the portfolio deck carry no per-slide footer", async () => {
  const browser = await deckParts(await deckBytes(buildPortfolioDeck(PORTFOLIO, PROJECT_REPORTS)));
  const projectSlide = browser[2].texts.join("\n");
  assert.ok(projectSlide.includes("Silverfort"), "project slide missing");
  assert.ok(!projectSlide.includes("Generated by Noodle Planner"), "footer should be suppressed in the portfolio deck");
});

test("a 10-project portfolio builds in reasonable time", async () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ ...REPORT, project_name: `Project ${i + 1}` }));
  const started = Date.now();
  const bytes = await deckBytes(buildPortfolioDeck(
    { ...PORTFOLIO, projects: many.map((r) => ({ name: r.project_name, status: "In flight", rag: "green", completion: 50, risk_count: 3, budget: "£1", start_date: "2026-01-01", end_date: "2026-12-31" })) },
    many,
  ));
  const elapsed = Date.now() - started;
  assert.deepEqual([...bytes.subarray(0, 2)], [...Buffer.from("PK")], "not a zip");
  assert.ok(elapsed < 10000, `a 10-project deck took ${elapsed} ms`);
  console.log(`      10-project portfolio deck: ${elapsed} ms, ${(bytes.length / 1024).toFixed(0)} KB`);
});

// --- the vendored library ----------------------------------------------------

test("pptxgenjs is vendored at the pinned version and loads from /static/", () => {
  const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
  const pinned = pkg.devDependencies.pptxgenjs;
  const vendored = join(repo, "packages", "noodle-web", "src", "noodle_web", "static", "vendor", "pptxgenjs");

  assert.ok(existsSync(join(vendored, "pptxgen.es.js")), "pptxgenjs is not vendored; run `npm run vendor:pptxgenjs`");
  assert.equal(readFileSync(join(vendored, "VERSION"), "utf8").trim(), pinned, "vendored copy is not the pinned release");

  const source = readFileSync(join(repo, "packages", "noodle-web", "src", "noodle_web", "static", "pptx-export.js"), "utf8");
  assert.ok(source.includes('from "./vendor/pptxgenjs/pptxgen.es.js"'), "the exporter should import the vendored copy");
  assert.ok(!/cdn\.jsdelivr|unpkg\.com/.test(source), "a CDN URL crept into the PowerPoint export");
});

test("jszip is vendored at the pinned version, for pptxgenjs's ES build to import", () => {
  const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
  const pinned = pkg.devDependencies.jszip;
  const vendored = join(repo, "packages", "noodle-web", "src", "noodle_web", "static", "vendor", "jszip");

  assert.ok(existsSync(join(vendored, "jszip.min.mjs")), "jszip is not vendored; run `npm run vendor:jszip`");
  assert.ok(existsSync(join(vendored, "jszip.esm.mjs")), "the jszip ES module shim is missing; run `npm run vendor:jszip`");
  assert.equal(readFileSync(join(vendored, "VERSION"), "utf8").trim(), pinned, "vendored copy is not the pinned release");
});

test("pptxgenjs's ES build has no bare import specifiers a browser would reject", () => {
  // pptxgenjs 4.0.1's dist/pptxgen.es.js externalizes JSZip as a bare
  // `import JSZip from 'jszip'` rather than bundling it inline. Node
  // resolves that fine against node_modules, which is exactly why a plain
  // Node test (like the ones above, which import pptx-export.js directly)
  // would not have caught the browser-only failure in issue #977 /
  // kevinmcaleer/Snakie#977: "Failed to resolve module specifier 'jszip'.
  // Relative references must start with either '/', './', or '../'." This
  // check reads the vendored file's source directly, the way a browser
  // would see it, so a future pptxgenjs (or jszip) version bump that
  // reintroduces a bare specifier fails here instead of only in a browser.
  const vendorRoot = join(repo, "packages", "noodle-web", "src", "noodle_web", "static", "vendor");
  const files = [
    join(vendorRoot, "pptxgenjs", "pptxgen.es.js"),
    join(vendorRoot, "jszip", "jszip.esm.mjs"),
  ];

  // Matches `import ... from "spec"`, `import "spec"`, and `export ... from "spec"`.
  const specifierPattern = /\b(?:import|export)\b\s+(?:[^"'();]+?\s+from\s+)?["']([^"']+)["']/g;
  const isBrowserResolvable = (specifier) => /^(\.{1,2}\/|\/|[a-zA-Z][a-zA-Z0-9+.-]*:)/.test(specifier);

  for (const file of files) {
    assert.ok(existsSync(file), `${file} is missing; run \`npm run vendor:pptxgenjs\``);
    const source = readFileSync(file, "utf8");
    const bare = [...source.matchAll(specifierPattern)].map((m) => m[1]).filter((s) => !isBrowserResolvable(s));
    assert.deepEqual(
      bare,
      [],
      `${file} has bare import specifier(s) a browser cannot resolve: ${bare.join(", ")}. ` +
        "Rewrite them to relative paths pointing at a vendored copy (see scripts/vendor-pptxgenjs.mjs " +
        "and scripts/vendor-jspdf.mjs for the established pattern).",
    );
  }
});
