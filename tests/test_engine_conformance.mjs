/**
 * The browser engine against the conformance corpus (issue #793).
 *
 * scripts/build_conformance_corpus.py records what the Python engine
 * schedules for each plan in tests/fixtures/conformance/. This holds the
 * JavaScript engine to the same answers, task by task and field by field.
 *
 *   node --test tests/test_engine_conformance.mjs
 *
 * The corpus is generated at a fixed date because an undated task starts
 * from today; the engine takes that date as `today`, so nothing here depends
 * on when it runs.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { dayOf, scheduleTasksFromText } from "../packages/noodle-web/src/noodle_web/static/engine/scheduler.js";
import { planBody } from "../packages/noodle-web/src/noodle_web/static/engine/local-parse.js";
import { activeCalendar } from "../packages/noodle-web/src/noodle_web/static/engine/calendar.js";

const repo = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const CORPUS = join(repo, "tests", "fixtures", "conformance");

/** Must match FROZEN_TODAY in scripts/build_conformance_corpus.py. */
const FROZEN_TODAY = "2026-06-01";

const PLANS = readdirSync(CORPUS).filter((n) => n.endsWith(".md")).sort();
assert.ok(PLANS.length, "the conformance corpus is empty");

/** Front-matter holidays and per-resource non-working days, as day numbers. */
function calendarFrom(planText) {
  const holidays = new Set();
  const resourceNonWorkingDays = new Map();
  const resourceMap = {};

  const fm = /^---\n([\s\S]*?)\n---/.exec(planText);
  if (!fm) return { holidays, resourceNonWorkingDays, resourceMap };

  let inList = false;
  for (const raw of fm[1].split("\n")) {
    const line = raw.trim();
    const lower = line.toLowerCase();

    if (lower === "non-working-days:" || lower === "holidays:") { inList = true; continue; }
    if (inList && line.startsWith("- ")) {
      const entry = line.slice(2).trim();
      const named = /^(.+?):\s*(\d{4}-\d{2}-\d{2})(?::(\d{4}-\d{2}-\d{2}))?$/.exec(entry);
      if (named) {
        const start = dayOf(named[2]);
        const end = named[3] ? dayOf(named[3]) : start;
        for (let d = start; d <= end; d++) holidays.add(d);
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(entry)) {
        holidays.add(dayOf(entry));
      }
      continue;
    }
    if (inList && !line.startsWith("- ")) inList = false;

    // "- @kev: Kevin McAleer, PM non-working [2026-06-10, 2026-06-15:2026-06-17]"
    const resource = /^-\s*@(\S+?):\s*(.*)$/.exec(line);
    if (resource) {
      const short = resource[1].toLowerCase();
      let rest = resource[2];
      const nwd = /,?\s*non-working\s*\[([^\]]*)\]\s*$/.exec(rest);
      if (nwd) {
        rest = rest.slice(0, nwd.index);
        const days = new Set();
        for (const part of nwd[1].split(",")) {
          const span = part.trim();
          const range = /^(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/.exec(span);
          if (range) {
            for (let d = dayOf(range[1]); d <= dayOf(range[2]); d++) days.add(d);
          } else if (/^\d{4}-\d{2}-\d{2}$/.test(span)) {
            days.add(dayOf(span));
          }
        }
        resourceNonWorkingDays.set(short, days);
      }
      resourceMap[short] = rest.split(",")[0].trim();
    }
  }
  return { holidays, resourceNonWorkingDays, resourceMap };
}

/** Fields both engines compute; the rest of the payload is not this engine's. */
const COMPARED = [
  "id", "name", "key", "start", "finish", "duration_days", "resources", "percent",
  "comment", "priority", "bucket", "level", "is_summary", "phase", "depends",
  "lag_lead", "dependency_types", "inherited_resource", "deliverable",
  "product_type", "parent", "quality_roles", "total_float", "critical",
  "loop_warning", "circular_dependencies", "recurrence",
  "effort_completed", "effort_total", "effort_remaining",
];

function comparable(task) {
  const out = {};
  for (const key of COMPARED) out[key] = task[key];
  return out;
}

let matchedTasks = 0;

for (const plan of PLANS) {
  const expectedPath = join(CORPUS, plan.replace(/\.md$/, ".expected.json"));

  test(`${plan}: the browser engine schedules as the Python does`, { skip: !existsSync(expectedPath) }, () => {
    const planText = readFileSync(join(CORPUS, plan), "utf8");
    const expected = JSON.parse(readFileSync(expectedPath, "utf8")).tasks;

    const { holidays, resourceNonWorkingDays, resourceMap } = calendarFrom(planText);
    // The calendar is passed, because /api/parse does too (issues #837,
    // #1132): PlanService._schedule_and_build_tasks calls schedule_tasks
    // with the front matter's holidays, per-resource non-working days, and
    // active named calendar.
    const actual = scheduleTasksFromText(planBody(planText), {
      today: FROZEN_TODAY,
      resourceMap,
      holidays,
      resourceNonWorkingDays,
      calendar: activeCalendar(planText),
    });

    assert.deepEqual(
      actual.map((t) => t.key),
      expected.map((t) => t.key),
      "task order or naming differs",
    );

    expected.forEach((want, i) => {
      assert.deepEqual(comparable(actual[i]), comparable(want), `${plan}: task "${want.key}" differs`);
      matchedTasks++;
    });
  });
}

test("the corpus was actually compared", () => {
  assert.ok(matchedTasks > 40, `only ${matchedTasks} tasks were compared`);
  console.log(`      ${matchedTasks} tasks matched across ${PLANS.length} plans`);
});

test("the engine honours a calendar when it is given one", () => {
  // A week-long shutdown pushes the finish out when a calendar is supplied,
  // versus scheduling straight through it when one is not.
  const planText = readFileSync(join(CORPUS, "non-working-days.md"), "utf8");
  const { holidays, resourceNonWorkingDays } = calendarFrom(planText);

  assert.ok(holidays.size >= 6, "the fixture should declare project-wide non-working days");
  assert.ok(resourceNonWorkingDays.has("kev"), "the fixture should declare per-resource non-working days");

  const withCalendar = scheduleTasksFromText(planBody(planText), {
    today: FROZEN_TODAY, holidays, resourceNonWorkingDays,
  });
  const without = scheduleTasksFromText(planBody(planText), { today: FROZEN_TODAY });

  const finish = (tasks, key) => tasks.find((t) => t.key === key).finish;
  assert.ok(
    finish(withCalendar, "Over shutdown") > finish(without, "Over shutdown"),
    "the shutdown week should push the finish out when a calendar is supplied",
  );
  assert.equal(finish(without, "Over shutdown"), "2026-08-19", "the no-calendar answer schedules straight through the shutdown");
});
