/**
 * Wall-clock profile of the portfolio PowerPoint export (issue #778, Phase 1).
 *
 * The issue says: profile before changing anything. This drives the *real*
 * export -- the real page, the real `exportPortfolioReport()`, the real
 * `/api/parse` round trips, the real html2canvas captures and the real
 * pptx-build-worker -- against a ~10-project portfolio, and reports where the
 * wall clock actually goes.
 *
 * It measures by wrapping the page's own globals rather than by editing them,
 * so the code timed here is the code that ships.
 *
 * Usage:
 *   uv run uvicorn noodle_web.app:app --host 127.0.0.1 --port 8007 &
 *   node tests/benchmarks/profile_pptx_export.mjs [--projects 10] [--runs 3] [--json out.json]
 *
 * Needs `npm install` (playwright, html2canvas) and a running app. html2canvas
 * is served from node_modules rather than the CDN the page names, so the
 * numbers do not depend on a network the profile is not trying to measure.
 */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { makePortfolio } from "./portfolio_fixture.mjs";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

const HTML2CANVAS_URL = "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js";

function parseArgs(argv) {
  const args = { projects: 10, runs: 3, baseUrl: "http://127.0.0.1:8007", json: null, label: "" };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--projects") args.projects = Number(argv[++i]);
    else if (flag === "--runs") args.runs = Number(argv[++i]);
    else if (flag === "--base-url") args.baseUrl = argv[++i];
    else if (flag === "--json") args.json = argv[++i];
    else if (flag === "--label") args.label = argv[++i];
  }
  return args;
}

/**
 * Installed in the page before its own scripts run. Everything it records
 * lands on `window.__prof`; the wrappers themselves are attached later, once
 * the app's globals exist (see `instrument` below).
 */
function seedStorage(projects) {
  localStorage.setItem("noodleplanner_projects", JSON.stringify(projects));
  localStorage.setItem("noodleplanner_current_project", Object.keys(projects)[0]);
  // Keep the in-browser path: the server routes are the fallback (#791).
  localStorage.removeItem("np-server-exports");
}

/** Wrap the page's globals so the export reports its own timings. */
function instrument() {
  const prof = {
    parse: [],          // one entry per /api/parse round trip
    capture: [],        // per-project capture calls (pre-#778 shape)
    captureBatch: 0,    // captureProjectTimelineImages(), the batched shape
    h2c: [],            // html2canvas() alone, tagged with the calling phase
    toDataURL: [],      // canvas.toDataURL('image/png') alone
    assembly: [],       // buildProjectReportData + buildDeliverablesData
    portfolioRender: 0, // renderPortfolioTimeline()
    portfolioCapture: 0,
    imageChars: [],     // base64 length of each per-project timeline image
    portfolioImageChars: 0,
    postMessageMs: 0,   // structured clone of the worker payload
    payloadChars: 0,    // JSON size of what goes to the worker
    worker: { start: 0, firstProgress: 0, compressStart: 0, done: 0, slides: [] },
    deckBytes: 0,
    total: 0,
  };
  window.__prof = prof;

  const now = () => performance.now();
  const timeAsync = async (fn, sink) => {
    const t = now();
    const value = await fn();
    sink(now() - t);
    return value;
  };

  // --- /api/parse round trips ------------------------------------------
  const realFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    if (!url.includes("/api/parse")) return realFetch(input, init);
    const t = now();
    const response = await realFetch(input, init);
    prof.parse.push({ start: t, end: now(), ms: now() - t, bytes: Number(response.headers.get("content-length") || 0) });
    return response;
  };

  // --- html2canvas, and the PNG encode that follows it ------------------
  // Which capture is running, so each html2canvas call can be attributed.
  let phase = "portfolio";
  const realHtml2canvas = window.html2canvas;
  window.html2canvas = async function (element, options) {
    const t = now();
    const canvas = await realHtml2canvas(element, options);
    prof.h2c.push({ ms: now() - t, width: canvas.width, height: canvas.height, phase });
    const realToDataURL = canvas.toDataURL.bind(canvas);
    canvas.toDataURL = function (...rest) {
      const t2 = now();
      const url = realToDataURL(...rest);
      prof.toDataURL.push(now() - t2);
      return url;
    };
    return canvas;
  };

  // --- the timeline captures, whichever shape this revision uses --------
  // Before #778 the export called captureProjectTimelineImage once per
  // project; after it, captureProjectTimelineImages once for all of them.
  // Wrapping both lets the same harness profile either revision.
  const realCapture = window.captureProjectTimelineImage;
  window.captureProjectTimelineImage = async function (tasks, name) {
    phase = "project";
    const image = await timeAsync(() => realCapture(tasks, name), (ms) => prof.capture.push({ ms, name }));
    phase = "portfolio";
    prof.imageChars.push(image ? image.length : 0);
    return image;
  };

  const realCaptureAll = window.captureProjectTimelineImages;
  if (typeof realCaptureAll === "function") {
    window.captureProjectTimelineImages = async function (projects) {
      phase = "batch";
      const images = await timeAsync(() => realCaptureAll(projects), (ms) => { prof.captureBatch += ms; });
      phase = "portfolio";
      for (const image of images) prof.imageChars.push(image ? image.length : 0);
      return images;
    };
  }

  // --- per-project data assembly ---------------------------------------
  for (const name of ["buildProjectReportData", "buildDeliverablesData"]) {
    const real = window[name];
    if (typeof real !== "function") continue;
    window[name] = function (...rest) {
      const t = now();
      const value = real.apply(this, rest);
      prof.assembly.push({ ms: now() - t, fn: name });
      return value;
    };
  }

  const realRender = window.renderPortfolioTimeline;
  if (typeof realRender === "function") {
    window.renderPortfolioTimeline = async function (...rest) {
      return timeAsync(() => realRender.apply(this, rest), (ms) => { prof.portfolioRender += ms; });
    };
  }

  // --- the deck-build worker -------------------------------------------
  const RealWorker = window.Worker;
  window.Worker = class ProfilingWorker extends RealWorker {
    postMessage(message, transfer) {
      try {
        prof.payloadChars = JSON.stringify(message).length;
        prof.portfolioImageChars = (message?.portfolioData?.timeline_image || "").length;
      } catch (e) { /* size is a nicety, never a reason to fail the run */ }
      prof.worker.start = now();
      const t = now();
      const result = super.postMessage(message, transfer);
      // postMessage structured-clones synchronously, so this is the clone cost.
      prof.postMessageMs = now() - t;
      return result;
    }
    set onmessage(handler) {
      super.onmessage = (event) => {
        const msg = event.data || {};
        const at = now();
        if (msg.type === "progress") {
          if (!prof.worker.firstProgress) prof.worker.firstProgress = at;
          if (msg.label === "Compressing PowerPoint file") prof.worker.compressStart = at;
          else prof.worker.slides.push({ at, label: msg.label });
        } else if (msg.type === "done") {
          prof.worker.done = at;
          prof.deckBytes = (msg.bytes && msg.bytes.byteLength) || 0;
        }
        handler(event);
      };
    }
  };

  // --- keep the deck in memory instead of downloading it ----------------
  const realDownload = window.downloadPptxBytes;
  window.downloadPptxBytes = function (bytes, filename) {
    window.__deck = { bytes: Array.from(bytes.slice(0, 0)), length: bytes.length, filename };
    prof.deckBytes = bytes.length;
  };
  void realDownload;
}

/**
 * Playwright, from node_modules or from a global install. Claude Code's web
 * container has it globally at /opt/node22/lib/node_modules; a normal `npm i`
 * puts it in node_modules. Either is fine.
 */
function loadPlaywright() {
  const candidates = ["playwright", "playwright-core", "/opt/node22/lib/node_modules/playwright"];
  for (const name of candidates) {
    try {
      return require(name);
    } catch (e) { /* try the next one */ }
  }
  throw new Error(`playwright not found (tried ${candidates.join(", ")}) — run \`npm install -D playwright\``);
}

function stats(values) {
  if (!values.length) return { n: 0, total: 0, mean: 0, min: 0, max: 0 };
  const total = values.reduce((a, b) => a + b, 0);
  return {
    n: values.length,
    total,
    mean: total / values.length,
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

const ms = (v) => `${v.toFixed(0)} ms`;

function report(runs, args) {
  // Report the median run, so one unlucky GC pause does not become the answer.
  const sorted = [...runs].sort((a, b) => a.total - b.total);
  const run = sorted[Math.floor(sorted.length / 2)];

  const parse = stats(run.parse.map((p) => p.ms));
  const encode = stats(run.toDataURL);
  const assembly = stats(run.assembly.map((a) => a.ms));

  const h2cBy = (name) => stats(run.h2c.filter((c) => c.phase === name).map((c) => c.ms));
  const perProject = h2cBy("project");   // pre-#778: one call per project
  const batched = h2cBy("batch");        // post-#778: one call for all of them
  const portfolio = h2cBy("portfolio");  // the portfolio timeline, either way

  // Everything captureProjectTimelineImages did that was not html2canvas:
  // building the blocks, cropping the sheet, and encoding each PNG.
  const cropAndEncode = Math.max(0, run.captureBatch - batched.total);
  const perProjectScaffold = Math.max(
    0,
    stats(run.capture.map((c) => c.ms)).total - perProject.total - encode.total
  );

  const workerAssembly = run.worker.compressStart ? run.worker.compressStart - run.worker.start : 0;
  const workerCompress = run.worker.compressStart ? run.worker.done - run.worker.compressStart : 0;
  const workerTotal = run.worker.done ? run.worker.done - run.worker.start : 0;

  const imageChars = run.imageChars.reduce((a, b) => a + b, 0) + run.portfolioImageChars;
  const blockedByH2c = perProject.total + batched.total + portfolio.total + encode.total + cropAndEncode;

  const rows = [
    ["/api/parse round trips (parallel, wall clock)", run.parseWall,
      `${parse.n} requests for ${args.projects} projects — every plan is parsed twice, mean ${ms(parse.mean)} each`],
    ["Per-project data assembly", assembly.total, `${assembly.n} calls, mean ${ms(assembly.mean)}`],
    ["html2canvas: per-project timelines (one call each)", perProject.total,
      perProject.n ? `${perProject.n} captures, mean ${ms(perProject.mean)}` : "not used on this revision"],
    ["html2canvas: project timelines (one batched call)", batched.total,
      batched.n ? `${batched.n} call for ${run.imageChars.length} timelines` : "not used on this revision"],
    ["Crop + PNG encode of the batched sheet", cropAndEncode,
      run.captureBatch ? `${run.imageChars.length} images` : "not used on this revision"],
    ["html2canvas: portfolio timeline", portfolio.total, `${portfolio.n} capture`],
    ["canvas.toDataURL (PNG encode)", encode.total, `${encode.n} encodes, mean ${ms(encode.mean)}`],
    ["Capture scaffolding (DOM build/teardown)", perProjectScaffold,
      run.capture.length ? `${run.capture.length} projects` : "not used on this revision"],
    ["renderPortfolioTimeline()", run.portfolioRender, "once"],
    ["postMessage to worker (structured clone)", run.postMessageMs, `${(run.payloadChars / 1048576).toFixed(2)} MB payload`],
    ["Worker: PptxGenJS deck assembly", workerAssembly, `${run.worker.slides.length} slides`],
    ["Worker: JSZip compression", workerCompress, `${(run.deckBytes / 1048576).toFixed(2)} MB deck`],
  ].filter(([, value, note]) => value > 0 || !note.startsWith("not used"));

  const lines = [];
  lines.push("");
  lines.push(`Portfolio PowerPoint export profile${args.label ? ` — ${args.label}` : ""}`);
  lines.push(`${args.projects} projects · ${runs.length} runs, median shown · headless Chromium`);
  lines.push("");
  const width = Math.max(...rows.map((r) => r[0].length));
  lines.push(`${"Stage".padEnd(width)} | ${"Time".padStart(9)} | ${"%".padStart(5)} | Notes`);
  lines.push(`${"-".repeat(width)} | ${"-".repeat(9)} | ${"-".repeat(5)} | -----`);
  for (const [name, value, note] of rows) {
    const pct = run.total ? ((value / run.total) * 100).toFixed(1) : "0.0";
    lines.push(`${name.padEnd(width)} | ${ms(value).padStart(9)} | ${(pct + "%").padStart(5)} | ${note}`);
  }
  lines.push(`${"-".repeat(width)} | ${"-".repeat(9)} | ${"-".repeat(5)} | -----`);
  lines.push(`${"TOTAL (exportPortfolioReport)".padEnd(width)} | ${ms(run.total).padStart(9)} | ${"100%".padStart(5)} | across ${runs.length} runs: ${runs.map((r) => r.total.toFixed(0)).join(", ")} ms`);
  lines.push("");
  lines.push(`Base64 image payload: ${(imageChars / 1048576).toFixed(2)} MB across ${run.imageChars.length + 1} images`);
  lines.push(`Worker round trip (postMessage → done): ${ms(workerTotal)}`);
  lines.push(`Main thread blocked by timeline capture: ${ms(blockedByH2c)} of ${ms(run.total)}`);
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { chromium } = loadPlaywright();

  let html2canvasSource = null;
  const vendored = join(repoRoot, "node_modules", "html2canvas", "dist", "html2canvas.min.js");
  if (existsSync(vendored)) html2canvasSource = readFileSync(vendored, "utf8");
  else console.warn(`! html2canvas not in node_modules; the page will try ${HTML2CANVAS_URL}`);

  const projects = makePortfolio(args.projects);
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const runs = [];

  try {
    for (let i = 0; i < args.runs; i++) {
      const context = await browser.newContext();
      if (html2canvasSource) {
        await context.route(HTML2CANVAS_URL, (route) =>
          route.fulfill({ status: 200, contentType: "text/javascript", body: html2canvasSource })
        );
      }
      const page = await context.newPage();
      page.on("pageerror", (err) => console.warn("! page error:", err.message));
      await page.addInitScript(seedStorage, projects);
      await page.goto(args.baseUrl, { waitUntil: "load" });
      await page.waitForFunction(() => typeof window.exportPortfolioReport === "function" && typeof window.html2canvas === "function");
      await page.evaluate(instrument);

      const result = await page.evaluate(async () => {
        const t = performance.now();
        await window.exportPortfolioReport();
        window.__prof.total = performance.now() - t;
        // parseAllProjects fires its requests in parallel, and the export
        // calls it twice (once itself, once inside renderPortfolioTimeline),
        // so the honest wall clock is the union of the busy intervals.
        const spans = window.__prof.parse.map((p) => [p.start, p.end]).sort((a, b) => a[0] - b[0]);
        let wall = 0;
        let [from, to] = spans.length ? spans[0] : [0, 0];
        for (const [s2, e2] of spans.slice(1)) {
          if (s2 > to) { wall += to - from; from = s2; to = e2; }
          else if (e2 > to) to = e2;
        }
        window.__prof.parseWall = wall + (to - from);
        return window.__prof;
      });

      if (!result.deckBytes) throw new Error("export produced no deck — check the page console output above");
      runs.push(result);
      console.log(`run ${i + 1}/${args.runs}: ${result.total.toFixed(0)} ms, deck ${(result.deckBytes / 1048576).toFixed(2)} MB`);
      await context.close();
    }
  } finally {
    await browser.close();
  }

  const text = report(runs, args);
  console.log(text);
  if (args.json) {
    writeFileSync(args.json, JSON.stringify({ args, runs }, null, 2));
    console.log(`raw timings written to ${args.json}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
