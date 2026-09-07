/**
 * The browser engine against the conformance corpus (issue #793).
 *
 * `scripts/build_conformance_corpus.py` records the whole `/api/parse`
 * payload the Python engine produces for each plan in
 * `tests/fixtures/conformance/`, frozen at 2026-06-01.
 * `tests/test_conformance_corpus.py` holds the Python engine to that file;
 * this holds the JavaScript one to it — every plan, every field of every
 * task, and the rest of the payload with it — so the two cannot drift apart
 * without a test going red.
 *
 *   node --test tests/test_engine_conformance.mjs
 *
 * Nothing is excluded as volatile. The frozen date drives the schedule *and*
 * the progress (RAG) reading, because `freeze_time()` patches the clock the
 * Python reads in both places, and the engine takes that date as `today`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { parsePlan } from "../packages/noodle-web/src/noodle_web/static/engine/plan-engine.js";
import { unsupportedSections } from "../packages/noodle-web/src/noodle_web/static/engine/plan-text.js";
import { parseNonWorkingDays, parseResourceMappings } from "../packages/noodle-web/src/noodle_web/static/engine/front-matter.js";
import { dayOf, isoOf } from "../packages/noodle-web/src/noodle_web/static/engine/date-math.js";

const repo = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const CORPUS = join(repo, "tests", "fixtures", "conformance");

/** Must match FROZEN_TODAY in scripts/build_conformance_corpus.py. */
const FROZEN_TODAY = "2026-06-01";

const PLANS = readdirSync(CORPUS).filter((name) => name.endsWith(".md")).sort();
assert.ok(PLANS.length, "the conformance corpus is empty");

/** A readable one-line summary of a task, for failure messages. */
function describeTask(task) {
  if (!task) return "(missing)";
  return `#${task.id} ${JSON.stringify(task.key)} ${task.start}..${task.finish} ` +
    `(${task.duration_days}d, level ${task.level}${task.is_summary ? ", summary" : ""})`;
}

/** Every leaf difference between two values, as "path: got — want" lines. */
function differences(actual, expected, path = "", found = []) {
  if (found.length >= 40) return found;
  const isObject = (value) => value !== null && typeof value === "object";

  if (!isObject(actual) || !isObject(expected)) {
    if (!Object.is(actual, expected)) {
      found.push(`  ${path || "<root>"}: got ${JSON.stringify(actual)} — want ${JSON.stringify(expected)}`);
    }
    return found;
  }
  if (Array.isArray(actual) !== Array.isArray(expected)) {
    found.push(`  ${path}: got ${JSON.stringify(actual)} — want ${JSON.stringify(expected)}`);
    return found;
  }
  if (Array.isArray(expected) && actual.length !== expected.length) {
    found.push(`  ${path}.length: got ${actual.length} — want ${expected.length}`);
  }
  for (const key of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
    differences(actual[key], expected[key], path ? `${path}.${key}` : key, found);
  }
  return found;
}

/** deepStrictEqual, but the message names the fields that differ. */
function assertSame(actual, expected, what) {
  try {
    assert.deepStrictEqual(actual, expected);
  } catch (error) {
    error.message = `${what} differs from the corpus:\n${differences(actual, expected).join("\n")}\n\n` +
      "If the change is intended, regenerate the corpus with " +
      "`uv run scripts/build_conformance_corpus.py` and review the diff. " +
      "Otherwise the browser engine has drifted from noodle_core.";
    throw error;
  }
}

let matchedTasks = 0;

for (const plan of PLANS) {
  const planPath = join(CORPUS, plan);
  const expectedPath = planPath.replace(/\.md$/, ".expected.json");

  test(`${plan}: the browser engine parses as the Python does`, { skip: !existsSync(expectedPath) }, () => {
    const planText = readFileSync(planPath, "utf8");
    const expected = JSON.parse(readFileSync(expectedPath, "utf8"));

    // No calendar is applied, because /api/parse does not apply one either:
    // PlanService._schedule_and_build_tasks calls schedule_tasks(phases) with
    // no holidays, so the front matter's non-working days are parsed and then
    // ignored on the web path. The engine supports them — see the calendar
    // test below — but matching the server is what conformance means here.
    const actual = parsePlan(planText, { today: FROZEN_TODAY });

    assert.equal(actual.success, true, `${plan} failed to parse: ${actual.error}`);
    assert.deepEqual(
      unsupportedSections(planText), [],
      `${plan} carries a back-matter section the browser engine cannot parse yet`,
    );

    // Order first: get that wrong and every later field looks wrong too.
    assert.deepStrictEqual(
      actual.tasks.map((task) => `${task.id}:${task.key}`),
      expected.tasks.map((task) => `${task.id}:${task.key}`),
      `${plan} produced a different task list:\n` +
        `  got : ${actual.tasks.map(describeTask).join("\n         ")}\n` +
        `  want: ${expected.tasks.map(describeTask).join("\n         ")}`,
    );

    // Then each task in full, so a failure names one task and one field.
    expected.tasks.forEach((want, index) => {
      assertSame(actual.tasks[index], want, `${plan} task ${describeTask(want)}`);
      matchedTasks++;
    });

    // Then the rest of the payload: front matter, resources, roles, labels,
    // highlights, stakeholders, dependencies, success and error.
    for (const key of Object.keys(expected)) {
      if (key === "tasks") continue;
      assertSame(actual[key], expected[key], `${plan} ${key}`);
    }

    // And the whole thing, which also catches a key the corpus does not have.
    assertSame(actual, expected, plan);
  });
}

test("the corpus was actually compared", () => {
  assert.ok(matchedTasks > 40, `only ${matchedTasks} tasks were compared`);
  console.log(`      ${matchedTasks} tasks matched across ${PLANS.length} plans`);
});

// ---------------------------------------------------------------------------
// The corners the frozen corpus does not reach, checked against the Python
// itself rather than against a recorded answer.
// ---------------------------------------------------------------------------

const python = join(repo, ".venv", "bin", "python");
const hasPython = existsSync(python);

/** The /api/parse payload the Python produces, with its clock frozen. */
function pythonPayload(planText) {
  const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(repo, "scripts"))})
from build_conformance_corpus import build, freeze_time
import logging
logging.disable(logging.CRITICAL)
freeze_time()
print(json.dumps(build(json.loads(${JSON.stringify(JSON.stringify(planText))})), default=str))
`;
  return JSON.parse(execFileSync(python, ["-c", script], { cwd: repo, maxBuffer: 32 * 1024 * 1024 }).toString());
}

/** Plans that exercise what the corpus leaves out, one construct at a time. */
const EXTRA_PLANS = {
  "a typed, lagged product dependency": [
    "---", "title: Product Links", "---",
    "Discovery $discovery",
    "  Scoping $scope 3d",
    "  Later 2d [depends $scope:SS +2d]",
    "Build [depends $discovery] 2d",
  ].join("\n"),
  "long-hand durations and commented-out lines": [
    "---", "title: Long Hand", "---",
    "Phase",
    "  // Dropped 5d",
    "  Spelled out 3days",
    "  Two weeks 2weeks",
    "  A month 1months",
  ].join("\n"),
  "two tasks sharing a name": [
    "---", "title: Twins", "---",
    "Phase",
    "  Same 3d",
    "  Same 5d",
    "  Other 1d [depends Same]",
  ].join("\n"),
  "quality roles, buckets, effort and priorities": [
    "---", "title: Metadata", "Resources:", "- @kev: Kevin McAleer, PM", "---",
    "Phase @kev",
    "  Review 2d @adam:R @kev:A {Quality} ~2d/5d !!!",
    "  Note 1d \"a quoted comment\" #tag-with-dash",
    "  Levelled [levelled @kev 2026-07-06] 2d",
  ].join("\n"),
  "recurrence and milestones": [
    "---", "title: Repeats", "---",
    "Phase",
    "  Standup 1d [repeats weekly mon,wed,fri]",
    "  Monthly review 1d [repeats monthly 3rd thu]",
    "  Gate 0d [depends Standup]",
  ].join("\n"),
  "a phase that depends on its own subtask": [
    "---", "title: Hierarchy", "---",
    "Phase [depends Child]",
    "  Child 2d",
    "  Sibling 1d",
  ].join("\n"),
  "stakeholders and programme dependencies": [
    "---", "title: Programme",
    "Stakeholders:",
    "- @kev: Kevin McAleer, Sponsor, interest:high, influence:low",
    "dependencies:",
    "  - from: Other Plan",
    "    task: Milestone 1",
    "    to_task: Design",
    "    type: SS",
    "    lag: 3",
    "---",
    "Phase",
    "  Design 2d",
  ].join("\n"),
  "a settings block and a labels line to top up": [
    "---", "title: Settings", "labels: [one]",
    "settings:",
    "  show_weekends: true",
    "  theme: dark",
    "---",
    "Phase",
    "  Tagged 2d #one #two",
  ].join("\n"),
};

for (const [what, planText] of Object.entries(EXTRA_PLANS)) {
  test(`${what}: the browser engine matches Python`, { skip: !hasPython }, () => {
    const expected = pythonPayload(planText);
    const actual = JSON.parse(JSON.stringify(parsePlan(planText, { today: FROZEN_TODAY })));
    delete expected.ascii_output;
    assertSame(actual, expected, what);
  });
}

test("the bundled templates parse the same both ways", { skip: !hasPython }, () => {
  const templates = join(repo, "templates");
  const names = readdirSync(templates, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(templates, entry.name, "plan.md")))
    .map((entry) => entry.name)
    .sort();
  assert.ok(names.length, "no bundled templates found");

  for (const name of names) {
    const planText = readFileSync(join(templates, name, "plan.md"), "utf8");
    const expected = pythonPayload(planText);
    delete expected.ascii_output;
    const actual = JSON.parse(JSON.stringify(parsePlan(planText, { today: FROZEN_TODAY })));
    // A template with a RAID or benefits table would need the markdown-table
    // readers this engine does not have yet; none ships with one today.
    assert.deepEqual(unsupportedSections(planText), [], `${name} carries an unsupported section`);
    assertSame(actual, expected, `templates/${name}/plan.md`);
  }
  console.log(`      ${names.length} bundled templates matched`);
});

test("the schedule follows `today`, which is what makes the corpus stable", () => {
  const planText = readFileSync(join(CORPUS, "sequential-chains.md"), "utf8");
  const frozen = parsePlan(planText, { today: FROZEN_TODAY });
  assert.equal(
    frozen.tasks.find((task) => task.key === "First").start, FROZEN_TODAY,
    "an undated task starts on the day it is given",
  );

  const later = parsePlan(planText, { today: "2026-07-01" });
  assert.equal(later.tasks.find((task) => task.key === "First").start, "2026-07-01");
  assert.notDeepStrictEqual(
    later.tasks.map((task) => task.start),
    frozen.tasks.map((task) => task.start),
    "moving `today` must move the schedule, or the freeze proves nothing",
  );
});

test("parsing a plan never rewrites it", () => {
  for (const plan of PLANS) {
    const planText = readFileSync(join(CORPUS, plan), "utf8");
    const before = String(planText);
    parsePlan(planText, { today: FROZEN_TODAY });
    assert.equal(planText, before, `${plan}: parsing changed the plan text`);
  }
});

test("the label rewrite is offered, not applied", () => {
  // products-and-metadata already lists every tag, so the text comes back
  // byte-identical; a plan missing one gains only the missing tag.
  const planText = readFileSync(join(CORPUS, "products-and-metadata.md"), "utf8");
  assert.equal(parsePlan(planText, { today: FROZEN_TODAY }).updated_plan_text, planText);

  const missing = planText.replace("labels: [urgent, dev, review]", "labels: [urgent]");
  const patched = parsePlan(missing, { today: FROZEN_TODAY }).updated_plan_text;
  assert.ok(patched.includes("labels: [urgent, dev, review]"), `unexpected rewrite: ${patched}`);
  assert.equal(
    parsePlan(patched, { today: FROZEN_TODAY }).updated_plan_text, patched,
    "the rewrite has to be idempotent",
  );

  // A plan without labels is left alone entirely.
  const unlabelled = readFileSync(join(CORPUS, "sequential-chains.md"), "utf8");
  assert.equal(parsePlan(unlabelled, { today: FROZEN_TODAY }).updated_plan_text, null);
});

test("the front matter's calendar is read, and applied only when asked", () => {
  const planText = readFileSync(join(CORPUS, "non-working-days.md"), "utf8");

  const holidays = parseNonWorkingDays(planText);
  assert.ok(holidays.has(dayOf("2026-12-25")), "the named single day should be read");
  for (const day of ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14"]) {
    assert.ok(holidays.has(dayOf(day)), `the shutdown range should include ${day}`);
  }

  const { resourceNonWorkingDays } = parseResourceMappings(planText);
  assert.deepEqual(
    [...(resourceNonWorkingDays.get("kev") || [])].sort((a, b) => a - b).map(isoOf),
    ["2026-06-10", "2026-06-15", "2026-06-16", "2026-06-17"],
    "a resource's own non-working days come from their front-matter line",
  );
  assert.equal(resourceNonWorkingDays.has("adam"), false, "Adam declares none");

  const asServer = parsePlan(planText, { today: FROZEN_TODAY });
  const withCalendar = parsePlan(planText, { today: FROZEN_TODAY, applyCalendar: true });
  const finish = (result, key) => result.tasks.find((task) => task.key === key).finish;

  // Without a calendar every task runs straight through — the server's
  // answer, which the corpus records.
  assert.equal(finish(asServer, "Over shutdown"), "2026-08-19");
  assert.equal(finish(asServer, "Adam works through"), "2026-08-19");
  assert.equal(finish(asServer, "Christmas task"), "2026-12-29");

  // With it, the shutdown week and Christmas Day are skipped.
  assert.equal(finish(withCalendar, "Over shutdown"), "2026-08-26");
  assert.equal(finish(withCalendar, "Adam works through"), "2026-08-26");
  assert.equal(finish(withCalendar, "Christmas task"), "2026-12-30");
});

test("a resource's own non-working days only move that resource's tasks", () => {
  // The corpus fixture declares Kev's leave in June and gives him an August
  // task, so it cannot show the difference; this can.
  const plan = [
    "---",
    "title: Leave",
    "Resources:",
    "- @kev: Kevin McAleer, PM non-working [2026-06-10, 2026-06-15:2026-06-17]",
    "- @adam: Adam Reid, Architect",
    "---",
    "Phase",
    "  Kev works 5d @kev 2026-06-08",
    "  Adam works 5d @adam 2026-06-08",
  ].join("\n");

  const withCalendar = parsePlan(plan, { today: FROZEN_TODAY, applyCalendar: true });
  const finish = (key) => withCalendar.tasks.find((task) => task.key === key).finish;

  assert.equal(finish("Adam works"), "2026-06-13", "Adam works five straight days");
  assert.equal(finish("Kev works"), "2026-06-19", "Kev's four days off push his finish out");
});
