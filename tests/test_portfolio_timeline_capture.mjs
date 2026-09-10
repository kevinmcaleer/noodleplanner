/**
 * The batched timeline capture produces the same images as the per-project
 * capture it replaced (issue #778).
 *
 * #778 found that html2canvas costs ~2.2 s per call on this page before it
 * draws anything -- it clones the whole document and re-resolves every
 * stylesheet -- and the export was paying that once per project. The export
 * now stacks every project's timeline block in one offscreen container,
 * rasterises them in a single call, and crops them apart.
 *
 * That is only a safe trade if the crops are the images the old code made, so
 * this drives a real browser against the real page and compares them. The
 * reference implementation below is the pre-#778 `captureProjectTimelineImage`
 * body, kept verbatim so the comparison is against what actually shipped.
 *
 *   uv run uvicorn noodle_web.app:app --host 127.0.0.1 --port 8007 &
 *   node --test tests/test_portfolio_timeline_capture.mjs
 *
 * Skips when Playwright is not installed or no app is listening -- the same
 * arrangement as the Python-comparison tests in test_pptx_browser_export.mjs.
 * Set NOODLE_BASE_URL to point at an instance on another port.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { makePortfolio } from "./benchmarks/portfolio_fixture.mjs";

const require = createRequire(import.meta.url);
const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = process.env.NOODLE_BASE_URL || "http://127.0.0.1:8007";

// The page loads html2canvas from a CDN. Serve the same pinned version from
// node_modules so the test does not depend on reaching the internet.
const HTML2CANVAS_URL = "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js";
const html2canvasPath = join(repo, "node_modules", "html2canvas", "dist", "html2canvas.min.js");

function loadPlaywright() {
  for (const name of ["playwright", "playwright-core", "/opt/node22/lib/node_modules/playwright"]) {
    try {
      return require(name);
    } catch (e) { /* try the next one */ }
  }
  return null;
}

async function appIsUp() {
  try {
    const response = await fetch(baseUrl, { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch (e) {
    return false;
  }
}

const playwright = loadPlaywright();
const reasons = [];
if (!playwright) reasons.push("playwright is not installed");
if (!existsSync(html2canvasPath)) reasons.push("html2canvas is not in node_modules (npm install)");
const up = await appIsUp();
if (!up) reasons.push(`no app listening on ${baseUrl}`);
const skip = reasons.length ? reasons.join("; ") : false;

/**
 * Runs in the page. Captures each project's timeline both ways and returns
 * the two base64 PNGs per project for comparison.
 */
async function captureBothWays() {
  // Freeze "now": the timeline draws a "today" marker from `new Date()`, and
  // the two captures happen seconds apart, which would move the marker's
  // antialiased edge for a reason that has nothing to do with batching.
  const RealDate = Date;
  const FROZEN = RealDate.UTC(2026, 4, 20, 12, 0, 0);
  window.Date = class extends RealDate {
    constructor(...rest) { super(...(rest.length ? rest : [FROZEN])); }
    static now() { return FROZEN; }
  };

  const parsed = await parseAllProjects();
  const specs = parsed.map(({ project, parsedResult }) => ({
    tasks: (parsedResult && parsedResult.success) ? (parsedResult.tasks || []) : [],
    name: project.name,
  }));

  /** The pre-#778 capture: one offscreen container, one html2canvas call. */
  async function captureOne(tasks, projectName) {
    const innerHtml = buildProjectTimelineHtml(tasks, projectName);
    if (!innerHtml) return null;
    const container = document.createElement("div");
    container.style.position = "absolute";
    container.style.left = "-9999px";
    container.style.width = "1200px";
    container.className = "portfolio-timeline-container";
    container.style.background = "#ffffff";
    container.innerHTML = innerHtml;
    document.body.appendChild(container);
    const canvas = await html2canvas(container, { backgroundColor: "#ffffff", scale: 2 });
    const dataUrl = canvas.toDataURL("image/png");
    container.remove();
    return { image: dataUrl.split(",")[1] || null, width: canvas.width, height: canvas.height };
  }

  const oneAtATime = [];
  for (const spec of specs) oneAtATime.push(await captureOne(spec.tasks, spec.name));

  const batched = await captureProjectTimelineImages(specs);

  return specs.map((spec, i) => ({
    name: spec.name,
    solo: oneAtATime[i],
    batched: batched[i],
  }));
}

async function runCaptures(projectCount) {
  const { chromium } = playwright;
  const html2canvasSource = readFileSync(html2canvasPath, "utf8");
  const projects = makePortfolio(projectCount);

  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext();
    await context.route(HTML2CANVAS_URL, (route) =>
      route.fulfill({ status: 200, contentType: "text/javascript", body: html2canvasSource })
    );
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.addInitScript((seed) => {
      localStorage.setItem("noodleplanner_projects", JSON.stringify(seed));
      localStorage.setItem("noodleplanner_current_project", Object.keys(seed)[0]);
    }, projects);
    await page.goto(baseUrl, { waitUntil: "load" });
    await page.waitForFunction(
      () => typeof window.captureProjectTimelineImages === "function" && typeof window.html2canvas === "function"
    );

    const results = await page.evaluate(captureBothWays);
    return { results, pageErrors };
  } finally {
    await browser.close();
  }
}

test("batched timeline capture is byte-identical to capturing one at a time", { skip }, async () => {
  const { results } = await runCaptures(3);

  assert.equal(results.length, 3, "expected one result per project");
  for (const { name, solo, batched } of results) {
    assert.ok(solo && solo.image, `${name}: the reference capture produced no image`);
    assert.ok(batched, `${name}: the batched capture produced no image`);
    assert.equal(
      batched,
      solo.image,
      `${name}: the batched capture differs from the per-project capture ` +
        `(${solo.width}x${solo.height}, ${solo.image.length} vs ${batched.length} base64 chars)`
    );
  }
});

test("a project with nothing to draw yields no image, and does not shift the others", { skip }, async () => {
  const { chromium } = playwright;
  const html2canvasSource = readFileSync(html2canvasPath, "utf8");
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext();
    await context.route(HTML2CANVAS_URL, (route) =>
      route.fulfill({ status: 200, contentType: "text/javascript", body: html2canvasSource })
    );
    const page = await context.newPage();
    await page.goto(baseUrl, { waitUntil: "load" });
    await page.waitForFunction(() => typeof window.captureProjectTimelineImages === "function");

    const images = await page.evaluate(async () => {
      const withContent = [
        { name: "Phase A", start: "2026-01-05", finish: "2026-02-06", is_summary: true, duration_days: 24, percent: 50 },
        { name: "Gate", start: "2026-02-06", finish: "2026-02-06", is_summary: false, duration_days: 0, percent: 0 },
      ];
      const result = await captureProjectTimelineImages([
        { tasks: withContent, name: "Has a timeline" },
        { tasks: [], name: "Empty project" },
        { tasks: withContent, name: "Also has a timeline" },
      ]);
      return result.map((image) => (image ? image.length : null));
    });

    assert.equal(images.length, 3);
    assert.ok(images[0] > 0, "the first project should have an image");
    assert.equal(images[1], null, "a project with no phases or milestones should have no image");
    assert.ok(images[2] > 0, "the third project should still have an image");
  } finally {
    await browser.close();
  }
});
