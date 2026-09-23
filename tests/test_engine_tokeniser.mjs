/**
 * static/engine/tokeniser.js against noodle_core/metadata.py's
 * extract_metadata (issue #793).
 *
 * The task-line grammar decides what a task is called, how long it takes and
 * what it waits for, so it is compared against the Python field by field —
 * over every task line in the conformance corpus and the bundled templates,
 * plus the awkward cases those do not reach.
 *
 *   node --test tests/test_engine_tokeniser.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { extractMetadata, parseRecurrence, bankersRound } from "../packages/noodle-web/src/noodle_web/static/engine/tokeniser.js";

const repo = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const python = `${repo}/.venv/bin/python`;
const hasPython = existsSync(python);

/** What the Python extract_metadata returns for each line. */
function pythonMetadata(lines) {
  const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(`${repo}/packages/noodle-core/src`)})
from datetime import timedelta, datetime
from noodle_core.metadata import extract_metadata

def encode(meta):
    out = {}
    for key, value in meta.items():
        if isinstance(value, timedelta):
            out["duration_days"] = value.days
        elif isinstance(value, datetime):
            out[key] = value.strftime("%Y-%m-%d")
        else:
            out[key] = value
    out.pop("duration", None)
    return out

print(json.dumps([encode(extract_metadata(line)) for line in json.loads(${JSON.stringify(JSON.stringify(lines))})]))
`;
  return JSON.parse(execFileSync(python, ["-c", script], { cwd: repo, maxBuffer: 32 * 1024 * 1024 }).toString());
}

/** Task lines from a plan: everything that is not front matter or back matter. */
function taskLines(planText) {
  const lines = [];
  let inFrontMatter = false;
  let seenFrontMatter = false;
  for (const [i, raw] of planText.split("\n").entries()) {
    const trimmed = raw.trim();
    if (trimmed === "---" && (i === 0 || !seenFrontMatter)) {
      inFrontMatter = !inFrontMatter;
      if (!inFrontMatter) seenFrontMatter = true;
      continue;
    }
    if (inFrontMatter) continue;
    if (/^---[a-z].*---$/.test(trimmed)) break; // back matter starts here
    if (!trimmed || trimmed.startsWith("//")) continue;
    lines.push(raw.trim());
  }
  return lines;
}

const CORPUS_LINES = [];
for (const dir of ["tests/fixtures/conformance", "templates"]) {
  const base = join(repo, dir);
  const files = dir === "templates"
    ? readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => join(base, d.name, "plan.md"))
    : readdirSync(base).filter((n) => n.endsWith(".md")).map((n) => join(base, n));
  for (const file of files) {
    if (existsSync(file)) CORPUS_LINES.push(...taskLines(readFileSync(file, "utf8")));
  }
}

/** Lines the corpus does not reach: the awkward corners of the grammar. */
const EDGE_LINES = [
  "Task",
  "*Task",
  "Task 3d",
  "Task 3d @alice",
  "Task @alice, @bob 5d",
  "Task @alice:P @bob:R @carol:A",
  "Task 2w",
  "Task 1m",
  "Task 1y",
  "Task 0d",
  "Task :p10d",
  "Task p50",
  "Task 50%",
  "Task 150%",
  "Task 0%",
  "Task @dev[30%] 0%",
  "Task @dev[30%]",
  "Task 5d @dev[30%] 40%",
  'Task "a comment"',
  "Task 'a comment'",
  'Task !"a bang comment"',
  "Task !!! urgent",
  "Task !! important",
  "Task ! medium",
  "Task {Bucket Name}",
  "Task ~8h",
  "Task ~8h/16h",
  "Task ~2d/5d",
  "Task ~1d/3d",
  "Task #one #two",
  "Task $product",
  "Task /$group",
  "Task ^$external",
  "Build [depends $GW2]",
  "Task [depends A]",
  "Task [depends: A]",
  "Task [depends A, B]",
  "Task [depends A:SS]",
  "Task [depends A:FF +2d]",
  "Task [depends A +2d, B:SS -1w]",
  "Task [depends A:FS]",
  "Task [depends ]",
  "Task [repeats weekly mon,wed]",
  "Task [repeats monthly 3rd thu]",
  "Task [repeats daily]",
  "Task 2026-07-01",
  "Task [levelled @kev 2026-08-03]",
  "Task 3d @alice 50% 2026-07-01 #tag $prod {B} !! \"note\"",
  "Task 5d D2026-09-10",
  "Task D2026-09-10 5d",
  "Task D2026-09-10",
  "Task 2026-07-01 5d D2026-09-10",
  "Task [levelled @kev 2026-08-03] 5d D2026-09-10",
  "Task 3d @alice 50% 2026-07-01 D2026-09-10 #tag $prod {B} !! \"note\"",
  "*+2d Task 3d",
  "*-1d Task 3d",
  "* +2d Task 3d",
  "* -1d Task 3d",
  "*+1w Task 0d",
  "Task with a very long name that goes on 3d",
  "Kévin's task 2d @kévin",
];

test("the tokeniser matches Python over the whole corpus", { skip: !hasPython }, () => {
  assert.ok(CORPUS_LINES.length > 100, `expected a real corpus, got ${CORPUS_LINES.length} lines`);
  const expected = pythonMetadata(CORPUS_LINES);

  let compared = 0;
  CORPUS_LINES.forEach((line, i) => {
    const actual = extractMetadata(line);
    assert.deepEqual(actual, expected[i], `line ${i + 1} differs: ${JSON.stringify(line)}`);
    compared++;
  });
  console.log(`      ${compared} corpus task lines matched`);
});

test("the tokeniser matches Python on the awkward cases", { skip: !hasPython }, () => {
  const expected = pythonMetadata(EDGE_LINES);
  EDGE_LINES.forEach((line, i) => {
    assert.deepEqual(extractMetadata(line), expected[i], `differs: ${JSON.stringify(line)}`);
  });
  console.log(`      ${EDGE_LINES.length} edge-case lines matched`);
});

test("a $token inside [depends ...] is a reference, not a deliverable", () => {
  // the bug the Python comment records: Build must not become $GW2
  const meta = extractMetadata("Build [depends $GW2]");
  assert.equal(meta.deliverable, undefined);
  assert.deepEqual(meta.depends, ["$GW2"]);

  const own = extractMetadata("Build $build [depends $GW2]");
  assert.equal(own.deliverable, "build");
});

test("dependency types and lags are keyed by the name they were written on", () => {
  const meta = extractMetadata("Task [depends Design:SS +3d, Build:FF -2d, Plain]");
  assert.deepEqual(meta.depends, ["Design", "Build", "Plain"]);
  assert.deepEqual(meta.dependency_types, { Design: "SS", Build: "FF" });
  assert.deepEqual(meta.lag_lead, { Design: "+3d", Build: "-2d" });
});

test("FS is the default and is not recorded", () => {
  const meta = extractMetadata("Task [depends A:FS]");
  assert.deepEqual(meta.depends, ["A"]);
  assert.equal(meta.dependency_types, undefined);
});

test("effort drives percent when both halves are given", () => {
  assert.equal(extractMetadata("Task ~8h/16h").percent, 50);
  assert.equal(extractMetadata("Task ~1d/2d").percent, 50);
  assert.equal(extractMetadata("Task ~4h/1d").percent, 50); // units differ: 1d = 8h
  // a total on its own means none of it is done yet, so 0% — not "unset"
  assert.equal(extractMetadata("Task ~8h").percent, 0);
  assert.equal(extractMetadata("Task ~8h").effort_total, 8);
});

test("a resource allocation is not percent complete", () => {
  assert.equal(extractMetadata("Design @dev[30%] 5d 0%").percent, 0);
  assert.equal(extractMetadata("Design @dev[30%] 5d").percent, undefined);
  assert.equal(extractMetadata("Design @dev[30%] 5d").resources, "dev[30%]");
});

test("Python's banker's rounding is reproduced", () => {
  assert.equal(bankersRound(0.5), 0);
  assert.equal(bankersRound(1.5), 2);
  assert.equal(bankersRound(2.5), 2);
  assert.equal(bankersRound(49.5), 50);
  assert.equal(bankersRound(50.4), 50);
  assert.equal(bankersRound(50.6), 51);
});

test("recurrence parses as the Python does", () => {
  assert.deepEqual(parseRecurrence("weekly mon,wed"), { raw: "weekly mon,wed", frequency: "weekly", days: ["mon", "wed"] });
  assert.deepEqual(parseRecurrence("weekly"), { raw: "weekly", frequency: "weekly", days: [] });
  assert.deepEqual(parseRecurrence("daily"), { raw: "daily", frequency: "daily" });
  assert.deepEqual(parseRecurrence("monthly 3rd thu"), { raw: "monthly 3rd thu", frequency: "monthly", week_of_month: 3, day_of_week: "thu" });
});

test("the sequential marker and its lag are read", () => {
  assert.equal(extractMetadata("*Task 3d").sequential, true);
  assert.equal(extractMetadata("Task 3d").sequential, undefined);
});

test("a sequential lag is neither the duration nor part of the name", () => {
  for (const [line, lag] of [["* +2d Build 3d", "+2d"], ["*+2d Build 3d", "+2d"], ["* -1d Build 3d", "-1d"]]) {
    const meta = extractMetadata(line);
    assert.equal(meta.sequential, true, line);
    assert.equal(meta.sequential_lag, lag, line);
    assert.equal(meta.description, "Build", line);
    assert.equal(meta.duration_days, 3, line);
  }
  assert.equal(extractMetadata("*Build 3d").sequential_lag, undefined);
  assert.equal(extractMetadata("Build [depends A +2d] 3d").sequential_lag, undefined);
});
