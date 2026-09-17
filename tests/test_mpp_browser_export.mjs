/**
 * The browser's native .mpp path (static/mpp-export.js), exercised in Node.
 *
 * Export and import of .mpp files happen entirely in the browser (issue #770):
 * the model is built from the `/api/parse` payload the page already holds,
 * the file is written and read with the vendored mppwriter, and the only
 * request export makes is for the template asset. mpp-export.js keeps all of
 * that pure, so the exact code the browser runs is what these tests run.
 *
 *   node --test tests/test_mpp_browser_export.mjs
 *
 * The drift check and the round trips need the repo's Python venv (to obtain
 * a parse payload and the reference model); they skip without it. The
 * Microsoft Project template ships with the app (static/mpp-template.mpp);
 * $NOODLE_MPP_TEMPLATE points the tests at a different one.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  TEMPLATE_URL,
  TEMPLATE_MISSING_MESSAGE,
  buildMpp,
  buildProjectFromParse,
  exportMppInBrowser,
  filenameStem,
  generateShortname,
  importMppBytes,
  inclusiveFinish,
  parseResourceShortnames,
  projectToMarkdown,
  resolvePredecessorLinks,
} from "../packages/noodle-web/src/noodle_web/static/mpp-export.js";
import { readProject } from "../packages/noodle-web/src/noodle_web/static/vendor/mppwriter/index.js";

const repo = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const python = `${repo}/.venv/bin/python`;
const template = process.env.NOODLE_MPP_TEMPLATE || join(staticDir(), "mpp-template.mpp");
function staticDir() {
  return join(repo, "packages", "noodle-web", "src", "noodle_web", "static");
}
const hasPython = existsSync(python);
const hasTemplate = existsSync(template);

const PLAN = `---
title: Browser export
Resources:
- @kevin: Kevin McAleer
- @adam: Adam Reid
---
Phase 1
  Proposal 1d @kevin 2026-07-01 100% "Signed off by the board"
  *Approval 0d @kevin
  Build 5d @adam, @kevin 50% [depends Approval +2d]
Phase 2 [depends Phase 1]
  Review 2d @kevin [depends Build:SS -1w]
  Ship 1d
`;

function py(script) {
  return JSON.parse(execFileSync(python, ["-c", script], { cwd: repo }).toString());
}

/** What /api/parse returns for the plan, straight from PlanService. */
function parsePayload(plan = PLAN) {
  return py(`
import json, sys, dataclasses
sys.path.insert(0, ${JSON.stringify(`${repo}/packages/noodle-core/src`)})
sys.path.insert(0, ${JSON.stringify(`${repo}/packages/noodle-web/src`)})
from noodle_web.plan_service import PlanService
r = PlanService().parse(${JSON.stringify(plan)}, project_name="Browser export")
print(json.dumps({"success": r.success, "project_name": r.project_name, "tasks": r.tasks,
                  "front_matter": r.front_matter, "resource_map": r.resource_map}))
`);
}

/** The Python model the JS one must match. */
function pythonModel(plan = PLAN) {
  return py(`
import json, sys
sys.path.insert(0, ${JSON.stringify(`${repo}/packages/noodle-core/src`)})
from noodle_core.mpp_writer import build_project_model
print(json.dumps(build_project_model(${JSON.stringify(plan)}, "Browser export")))
`);
}

/** A JS Date as the wall-clock ISO string the Python model uses. */
const iso = (d) => d.toISOString().replace(/\.000Z$/, "");

// --- the model matches the Python one -----------------------------------------

test("the browser model is the Python model, field for field", { skip: !hasPython }, () => {
  const expected = pythonModel();
  const actual = buildProjectFromParse(parsePayload(), "Browser export");

  assert.equal(actual.title, expected.title);
  assert.equal(iso(actual.start), expected.start);
  assert.deepEqual(
    actual.tasks.map((t) => ({ ...t, start: iso(t.start), finish: iso(t.finish) })),
    expected.tasks,
  );
  assert.deepEqual(actual.relations, expected.relations);
  assert.deepEqual(actual.resources, expected.resources);
  assert.deepEqual(actual.assignments, expected.assignments);
  assert.equal(actual.comments, expected.comments);
});

test("dependency type and lag are carried, not zeroed", { skip: !hasPython }, () => {
  const project = buildProjectFromParse(parsePayload(), "Browser export");
  const uid = Object.fromEntries(project.tasks.map((t) => [t.name, t.uid]));
  const bySucc = Object.fromEntries(project.relations.map((r) => [r.succUid, r]));
  assert.deepEqual(bySucc[uid.Build], { predUid: uid.Approval, succUid: uid.Build, type: "FS", lagDays: 2 });
  assert.deepEqual(bySucc[uid.Review], { predUid: uid.Build, succUid: uid.Review, type: "SS", lagDays: -7 });
  // the phase-to-phase link is legitimate and kept
  assert.deepEqual(bySucc[uid["Phase 2"]], { predUid: uid["Phase 1"], succUid: uid["Phase 2"], type: "FS", lagDays: 0 });
});

test("export model marks assigned 100% leaf tasks for round-trip preservation", () => {
  const parse = {
    success: true,
    tasks: [{
      key: "Done",
      name: "Done",
      start: "2026-07-01",
      finish: "2026-07-08",
      duration_days: 5,
      level: 1,
      resources: "Kevin",
      percent: 100,
      is_summary: false,
      comment: "",
    }],
  };
  const project = buildProjectFromParse(parse, "Plan");
  assert.equal(project.tasks[0].notes, "NoodlePlanner export: task was 100% complete");
});

test("links MS Project would reject are dropped with a note, as the XML export does", () => {
  const tasks = [
    { key: "Definition", name: "Definition", level: 1, is_summary: true, depends: [] },
    { key: "Charter", name: "Charter", level: 2, depends: [] },
    { key: "GW2", name: "GW2", level: 2, depends: ["Definition", "Charter"] },
  ];
  const keyToUid = new Map(tasks.map((t, i) => [t.key.toLowerCase(), i + 1]));
  const { links, dropped } = resolvePredecessorLinks(tasks, keyToUid);
  assert.deepEqual(links.get(3), [{ predUid: 2, type: "FS", lagDays: 0 }]);
  assert.deepEqual(dropped.get(3), [
    'Dependency on "Definition" was not exported: MS Project cannot link a task to its own summary task.',
  ]);
});

test("the exclusive finish becomes the last working day", () => {
  assert.equal(inclusiveFinish("2026-07-06", "2026-07-11"), "2026-07-10"); // Mon..Sat -> Fri
  assert.equal(inclusiveFinish("2026-07-06", "2026-07-13"), "2026-07-10"); // finish on Mon -> Fri
  assert.equal(inclusiveFinish("2026-07-06", "2026-07-06"), "2026-07-06"); // milestone
});

// --- round trips through a real file --------------------------------------------

const roundTrip = hasPython && hasTemplate;

test("the browser writes a real .mpp that reads back as the plan", { skip: !roundTrip }, () => {
  const project = buildProjectFromParse(parsePayload(), "Browser export");
  const bytes = buildMpp(project, new Uint8Array(readFileSync(template)), () => {});
  assert.deepEqual([...bytes.subarray(0, 8)], [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

  const back = readProject(bytes);
  const byName = Object.fromEntries(back.tasks.map((t) => [t.name, t]));
  for (const name of ["Phase 1", "Proposal", "Approval", "Build", "Phase 2", "Review", "Ship"]) {
    assert.ok(byName[name], `${name} missing from the exported file`);
  }
  // outline, durations, progress, milestones, notes
  assert.equal(byName["Phase 1"].outlineLevel, 1);
  assert.equal(byName.Proposal.outlineLevel, 2);
  assert.equal(byName.Proposal.parentUid, byName["Phase 1"].uid);
  assert.equal(byName.Build.durationDays, 5);
  assert.equal(byName.Build.percentComplete, 50);
  assert.equal(byName.Approval.durationDays, 0);
  assert.equal(byName.Proposal.percentComplete, 100);
  // Proposal is a leaf, 1d, @kevin, 100% -- the shape that hits Project's
  // 99%-on-reopen quirk, so the file carries the breadcrumb alongside the
  // comment. This is the raw .mpp field; the test below reads the same bytes
  // through importMppBytes() and asserts the breadcrumb is gone from the
  // markdown, which is where it must not appear.
  assert.equal(
    byName.Proposal.notes,
    "Signed off by the board\nNoodlePlanner export: task was 100% complete",
  );
  // resources and assignments
  assert.deepEqual(back.resources.map((r) => r.name).sort(), ["Adam Reid", "Kevin McAleer"]);
  const kevin = back.resources.find((r) => r.name === "Kevin McAleer").uid;
  assert.ok(back.assignments.some((a) => a.taskUid === byName.Build.uid && a.resourceUid === kevin));
  // dependency type and lag
  const rel = (succ) => back.relations.find((r) => r.succUid === byName[succ].uid);
  assert.equal(rel("Build").type, "FS");
  assert.equal(rel("Build").lagDays, 2);
  assert.equal(rel("Review").type, "SS");
  assert.equal(rel("Review").lagDays, -7);
});

test("a file exported by the browser imports back as plan markdown", { skip: !roundTrip }, () => {
  const project = buildProjectFromParse(parsePayload(), "Browser export");
  const bytes = buildMpp(project, new Uint8Array(readFileSync(template)), () => {});
  const markdown = importMppBytes(bytes);

  const lines = markdown.split("\n");
  assert.equal(lines[0], "---");
  assert.equal(lines[1], "title: Browser export");
  assert.ok(lines.includes("- @kmcaleer: Kevin McAleer"));
  assert.ok(lines.includes("- @areid: Adam Reid"));

  const line = (name) => lines.find((l) => l.trim().replace(/^\*/, "").startsWith(name + " ") || l.trim() === name);
  assert.equal(line("Phase 1"), "Phase 1");
  assert.equal(line("Proposal"), '  Proposal 1d @kmcaleer 100% "Signed off by the board"');
  assert.equal(line("Approval"), "  *Approval 0d @kmcaleer");
  assert.equal(line("Build"), "  Build 5d @areid @kmcaleer 50% [depends Approval +2d]");
  assert.equal(line("Phase 2"), "Phase 2 [depends Phase 1]");
  assert.equal(line("Review"), "  Review 2d @kmcaleer [depends Build:SS -7d]");
  assert.equal(line("Ship"), "  Ship 1d");

  // and the plan schedules again with the same outline and leaf durations
  const again = parsePayload(markdown);
  assert.ok(again.success);
  const isSummary = (t) => project.tasks.some((c) => c.parentUid === t.uid);
  assert.deepEqual(
    again.tasks.map((t) => [t.name, t.level, Boolean(t.is_summary), t.is_summary ? null : t.duration_days]),
    project.tasks.map((t) => [t.name, t.outlineLevel, isSummary(t), isSummary(t) ? null : t.durationDays]),
  );
});

// --- import ---------------------------------------------------------------------

test("markdown from a read project mirrors the Python importer's shape", () => {
  const D = (y, m, d, h = 8) => new Date(Date.UTC(y, m - 1, d, h));
  const project = {
    title: "Read back",
    start: D(2026, 3, 2),
    tasks: [
      { uid: 1, name: "Phase", start: D(2026, 3, 2), finish: D(2026, 3, 6, 17), durationDays: 5, outlineLevel: 1, parentUid: 0 },
      { uid: 2, name: "Design", start: D(2026, 3, 2), finish: D(2026, 3, 3, 17), durationDays: 2, outlineLevel: 2, parentUid: 1, percentComplete: 25 },
      { uid: 3, name: "Build", start: D(2026, 3, 4), finish: D(2026, 3, 6, 17), durationDays: 3, outlineLevel: 2, parentUid: 1, notes: 'Has "quotes" so no comment' },
      { uid: 4, name: "Done", start: D(2026, 3, 6, 17), finish: D(2026, 3, 6, 17), durationDays: 0, outlineLevel: 2, parentUid: 1 },
    ],
    relations: [
      { predUid: 2, succUid: 3, type: "FS", lagDays: 0 },
      { predUid: 3, succUid: 4, type: "FF", lagDays: 1 },
    ],
    resources: [{ uid: 1, name: "Alice" }, { uid: 2, name: "Bob Jones" }, { uid: 3, name: "Bill Jones" }],
    assignments: [{ taskUid: 2, resourceUid: 1, units: 1 }, { taskUid: 3, resourceUid: 2 }, { taskUid: 3, resourceUid: 3 }],
  };
  assert.equal(
    projectToMarkdown(project),
    [
      "---",
      "title: Read back",
      "Resources:",
      "- @alice: Alice",
      "- @bjones: Bob Jones",
      "- @bjones2: Bill Jones",
      "---",
      "",
      "Phase",
      "  Design 2d @alice 25%",
      "  *Build 3d @bjones @bjones2",
      "  Done 0d [depends Build:FF +1d]",
      "",
    ].join("\n"),
  );
});

test("shortnames follow the Python rule", () => {
  assert.equal(generateShortname("Kevin McAleer"), "kmcaleer");
  assert.equal(generateShortname("Alice"), "alice");
  assert.equal(generateShortname("Bob J. Jones"), "bjones");
  assert.equal(generateShortname(""), "");
});

// #912: a .mpp file's resource table only ever carries the full name, so a
// sync reimport re-deriving "Kevin McAleer" -> "kmcaleer" from scratch
// disagreed with a plan that had chosen "@kevin" -- reporting every task
// referencing that resource as spuriously changed, on every sync.
test("parseResourceShortnames reads the plan's own @shortname: Full Name mapping", () => {
  const plan = [
    "---",
    "title: Plan",
    "Resources:",
    "- @kevin: Kevin McAleer",
    "- @adam: Adam Reid, Designer",
    "---",
    "",
    "Task 1d @kevin",
  ].join("\n");
  const map = parseResourceShortnames(plan);
  assert.equal(map.get("kevin mcaleer"), "kevin");
  assert.equal(map.get("adam reid"), "adam");
  assert.equal(map.size, 2);
});

test("parseResourceShortnames returns an empty map for a plan with no Resources section", () => {
  assert.equal(parseResourceShortnames("---\ntitle: Plan\n---\nTask 1d").size, 0);
  assert.equal(parseResourceShortnames("").size, 0);
});

test("projectToMarkdown prefers the plan's existing shortname over generateShortname's guess", () => {
  const project = {
    title: "Plan",
    tasks: [{ uid: 1, name: "Task", start: new Date(), finish: new Date(), durationDays: 1, outlineLevel: 1, parentUid: 0 }],
    relations: [],
    resources: [{ uid: 1, name: "Kevin McAleer" }],
    assignments: [{ taskUid: 1, resourceUid: 1 }],
  };
  const preferred = new Map([["kevin mcaleer", "kevin"]]);
  const markdown = projectToMarkdown(project, preferred);
  assert.ok(markdown.includes("- @kevin: Kevin McAleer"), markdown);
  assert.ok(markdown.includes("Task 1d @kevin"), markdown);
  assert.ok(!markdown.includes("kmcaleer"), markdown);
});

test("projectToMarkdown falls back to generateShortname for a resource the preferred map does not cover", () => {
  const project = {
    title: "Plan",
    tasks: [{ uid: 1, name: "Task", start: new Date(), finish: new Date(), durationDays: 1, outlineLevel: 1, parentUid: 0 }],
    relations: [],
    resources: [{ uid: 1, name: "Kevin McAleer" }, { uid: 2, name: "New Person" }],
    assignments: [{ taskUid: 1, resourceUid: 1 }, { taskUid: 1, resourceUid: 2 }],
  };
  const preferred = new Map([["kevin mcaleer", "kevin"]]);
  const markdown = projectToMarkdown(project, preferred);
  assert.ok(markdown.includes("- @kevin: Kevin McAleer"), markdown);
  assert.ok(markdown.includes("- @nperson: New Person"), markdown);
});

test("projectToMarkdown restores exported 100% tasks if Project reports 99% on reopen", () => {
  const project = {
    title: "Plan",
    tasks: [{
      uid: 1,
      name: "Done",
      start: new Date(),
      finish: new Date(),
      durationDays: 5,
      outlineLevel: 1,
      parentUid: 0,
      percentComplete: 99,
      notes: "NoodlePlanner export: task was 100% complete",
    }],
    relations: [],
    resources: [],
    assignments: [],
  };
  const markdown = projectToMarkdown(project);
  assert.ok(markdown.includes("Done 5d 100%"), markdown);
  assert.ok(!markdown.includes("NoodlePlanner export: task was 100% complete"), markdown);
});

test("a synced .mpp with nothing changed reimports with no diff against the current plan", { skip: !roundTrip }, () => {
  const currentPlan = PLAN; // uses @kevin / @adam, not generateShortname's own guesses
  const parse = parsePayload(currentPlan);
  const project = buildProjectFromParse(parse, "Browser export");
  const bytes = buildMpp(project, new Uint8Array(readFileSync(template)), () => {});

  // Without the plan's own shortnames, the reimport disagrees with itself.
  const naiveMarkdown = importMppBytes(bytes);
  assert.ok(naiveMarkdown.includes("@kmcaleer"), naiveMarkdown);
  assert.ok(!naiveMarkdown.includes("@kevin "), naiveMarkdown);

  // With them (as the real sync flow now passes), reimporting an unchanged
  // export reuses the exact shortcodes the current plan already has.
  const preferred = parseResourceShortnames(currentPlan);
  const syncedMarkdown = importMppBytes(bytes, preferred);
  assert.ok(syncedMarkdown.includes("- @kevin: Kevin McAleer"), syncedMarkdown);
  assert.ok(syncedMarkdown.includes("- @adam: Adam Reid"), syncedMarkdown);
  assert.ok(syncedMarkdown.includes("Build 5d @adam @kevin 50%"), syncedMarkdown);
});

// --- no request but the template -------------------------------------------------

test("export asks the network for nothing but the template", { skip: !hasTemplate }, async () => {
  const requested = [];
  const fakeFetch = async (url) => {
    requested.push(String(url));
    return { ok: true, arrayBuffer: async () => readFileSync(template).buffer.slice(0) };
  };
  const downloads = [];
  const parse = hasPython ? parsePayload() : {
    success: true, project_name: "Browser export", front_matter: {}, resource_map: {},
    tasks: [{ key: "Only", name: "Only", start: "2026-07-01", finish: "2026-07-02", duration_days: 1, level: 1 }],
  };
  const { filename, bytes } = await exportMppInBrowser(parse, "Browser export", {
    fetch: fakeFetch,
    download: (b, name) => downloads.push([name, b.length]),
  });
  assert.deepEqual(requested, [TEMPLATE_URL]);
  assert.equal(filename, "Browser-export.mpp");
  assert.deepEqual(downloads, [[filename, bytes.length]]);
});

test("a missing template is reported, never sent to a server", async () => {
  const requested = [];
  const fakeFetch = async (url) => {
    requested.push(String(url));
    return { ok: false };
  };
  await assert.rejects(
    exportMppInBrowser({ success: true, tasks: [] }, "x", { fetch: fakeFetch, download: () => {} }),
    { message: TEMPLATE_MISSING_MESSAGE },
  );
  assert.deepEqual(requested, [TEMPLATE_URL]);
});

test("file names are safe", () => {
  assert.equal(filenameStem('Project "Silverfort" / v1.8'), "Project-Silverfort-v1.8");
  assert.equal(filenameStem(""), "project");
});

// --- the vendored library is the pinned release --------------------------------

test("the vendored mppwriter is the release package.json pins", () => {
  const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
  const pinned = pkg.devDependencies.mppwriter;
  const vendor = join(repo, "packages", "noodle-web", "src", "noodle_web", "static", "vendor", "mppwriter");
  assert.equal(readFileSync(join(vendor, "VERSION"), "utf8").trim(), pinned, "run `npm run vendor:mppwriter`");

  const installed = join(repo, "node_modules", "mppwriter");
  if (!existsSync(join(installed, "dist"))) return; // `npm install` not run here; VERSION is the check
  const installedVersion = JSON.parse(readFileSync(join(installed, "package.json"), "utf8")).version;
  assert.equal(installedVersion, pinned, "run `npm install`");
  for (const name of readdirSync(join(installed, "dist")).filter((n) => n.endsWith(".js"))) {
    assert.ok(
      readFileSync(join(installed, "dist", name)).equals(readFileSync(join(vendor, name))),
      `${name} in static/vendor/mppwriter differs from mppwriter@${pinned}; run \`npm run vendor:mppwriter\``,
    );
  }
});
