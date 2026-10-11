/**
 * The task details form writes back what the user typed (issue #1568 under
 * epic #1563), and only that.
 *
 * `openTaskForm()` and `saveTask()` from script.js run in a Node sandbox
 * (tests/helpers/task_form_sandbox.mjs), so this is the real write path with
 * no browser. Each case opens a line, types into one field, saves, and checks
 * what the browser engine reads back from the new line -- because the engine
 * is what schedules it. The unedited open → save round trip over the whole
 * corpus is tests/test_task_line_contract.py.
 *
 *   node --test tests/test_task_form_roundtrip.mjs
 *
 * Known defects carry the issue that tracks them through `known()`, which
 * fails the test if the defect has gone away, so the marker cannot outlive the
 * fix.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { extractMetadata } from "../packages/noodle-web/src/noodle_web/static/engine/tokeniser.js";
import { makeTaskForm } from "./helpers/task_form_sandbox.mjs";

const form = makeTaskForm();

/** Open `line` as the third line of a small plan, type `edits`, save; the new line. */
function saveWith(line, edits) {
  form.open(`# Plan\nFirst 1d\n${line}\n`, 3);
  for (const [field, value] of Object.entries(edits)) form.type(field, value);
  return form.save().split("\n")[2];
}

/** A defect pinned to its issue: the test passes while `check` throws, and fails once it stops. */
function known(issue, check) {
  let failed = false;
  try { check(); } catch { failed = true; }
  assert.ok(failed, `${issue} seems fixed: remove the known() marker from this test`);
}

// --- what works today, and must keep working ------------------------------

test("typing a comment stores it on the task's own line, escaped (#1562)", () => {
  const line = saveWith("Build 3d", { taskComment: "first\nsecond \\ slash" });
  assert.equal(line, 'Build 3d "first\\nsecond \\\\ slash"');
  assert.equal(extractMetadata(line).comment, "first\nsecond \\ slash");
});

test("typing a name, duration, resources and labels writes each token once", () => {
  const line = saveWith("Build 3d", {
    taskName: "Design", taskDuration: "5", taskResources: "alex, bob", taskLabels: "ui, ux",
  });
  assert.equal(line, "Design 5d @alex @bob #ui #ux");
  assert.deepEqual(extractMetadata(line), {
    description: "Design", duration_days: 5, resources: "alex, bob", labels: ["ui", "ux"], priority: "Low",
  });
});

test("the deadline, bucket and priority fields map to their tokens", () => {
  const line = saveWith("Build 3d", { taskDeadline: "2026-09-10", taskBucket: "Backlog", taskPriority: "Important" });
  const meta = extractMetadata(line);
  assert.equal(meta.deadline, "2026-09-10");
  assert.equal(meta.bucket, "Backlog");
  assert.equal(meta.priority, "Important");
  assert.equal(meta.start, undefined, "a deadline is not a start date");
});

test("clearing the comment removes the quotes entirely", () => {
  assert.equal(saveWith('Build 3d "old"', { taskComment: "" }), "Build 3d");
  assert.equal(saveWith('Build 3d "old"', { taskComment: "   " }), "Build 3d");
});

test("the $deliverable on the line survives a save the form knows nothing about", () => {
  assert.equal(saveWith("Build $core 3d", { taskName: "Assemble" }), "Assemble $core 3d");
});

test("an indented subtask keeps its indentation", () => {
  assert.equal(saveWith("    Build 3d", { taskName: "Assemble" }), "    Assemble 3d");
});

// --- #1568: field values are written unescaped --------------------------------

test("a double quote in the comment", () => {
  const line = saveWith("Build 3d", { taskComment: 'say "hi"' });
  known("#1568", () => assert.equal(extractMetadata(line).comment, 'say "hi"'));
});

test("a closing brace in the bucket", () => {
  const line = saveWith("Build 3d", { taskBucket: "To} do" });
  known("#1568", () => assert.equal(extractMetadata(line).bucket, "To} do"));
});

test("a name that contains a duration", () => {
  const line = saveWith("Build 3d", { taskName: "Takes 2d" });
  known("#1568", () => {
    const meta = extractMetadata(line);
    assert.equal(meta.description, "Takes 2d");
    assert.equal(meta.duration_days, 3);
  });
});

test("a name that contains a label and a resource", () => {
  const line = saveWith("Build 3d", { taskName: "Fix #42 for @bob" });
  known("#1568", () => {
    const meta = extractMetadata(line);
    assert.equal(meta.description, "Fix #42 for @bob");
    assert.equal(meta.labels, undefined);
    assert.equal(meta.resources, undefined);
  });
});

test("a name that contains a date", () => {
  const line = saveWith("Build 3d", { taskName: "Due 2026-01-01" });
  known("#1568", () => assert.equal(extractMetadata(line).start, undefined));
});

test("a name that starts with a star", () => {
  const line = saveWith("Build 3d", { taskName: "* Star" });
  known("#1568", () => assert.equal(extractMetadata(line).sequential, undefined));
});

test("a name that contains braces", () => {
  const line = saveWith("Build 3d", { taskName: "Note {x}" });
  known("#1568", () => assert.equal(extractMetadata(line).bucket, undefined));
});

test("an empty name is refused rather than written", () => {
  const line = saveWith("Build 3d", { taskName: "" });
  known("#1568", () => assert.notEqual(extractMetadata(line).description, ""));
});

test("a hash typed into the labels field is not doubled", () => {
  // The engine still reads `##tag` as the label `tag`; the form's tokenizer
  // reads the first `#` as part of the name on the next open.
  const line = saveWith("Build 3d", { taskLabels: "#tag" });
  known("#1568", () => assert.equal(line, "Build 3d #tag"));
});

test("an at-sign typed into the resources field is not doubled", () => {
  const line = saveWith("Build 3d", { taskResources: "@alex, @bob" });
  known("#1568", () => assert.equal(line, "Build 3d @alex @bob"));
});

test("a space in a resource name", () => {
  // The engine's description stops at the `@`; the form's own tokenizer
  // reads the stray word back into the name on the next open.
  const line = saveWith("Build 3d", { taskResources: "alex smith" });
  known("#1568", () => assert.equal(form.parseTaskLine(line).name, "Build"));
});

test("a space in a label", () => {
  const line = saveWith("Build 3d", { taskLabels: "front end" });
  known("#1568", () => assert.equal(form.parseTaskLine(line).name, "Build"));
});

// --- #1567: tokens the form has no field for ---------------------------------

test("a dependency on a product is not turned into this task's own product", () => {
  const line = saveWith("Build 3d [depends $core]", { taskDuration: "4" });
  known("#1567", () => {
    const meta = extractMetadata(line);
    assert.equal(meta.deliverable, undefined, line);
    assert.deepEqual(meta.depends, ["$core"]);
  });
});

test("the levelling flag survives a save", () => {
  const line = saveWith("Build 3d [levelled @alex 2026-04-01]", { taskDuration: "4" });
  known("#1567", () => {
    const meta = extractMetadata(line);
    assert.deepEqual(meta.levelled, { resource: "alex", start: "2026-04-01" });
    assert.equal(meta.resources, undefined, "the levelled resource is not also an assignment");
  });
});

test("a noodle-view pin and link stay out of the name", () => {
  const line = saveWith("Build 3d [pin top-left] [relates Research]", { taskDuration: "4" });
  known("#1567", () => assert.equal(form.parseTaskLine(line).name, "Build"));
});

test("a duration in weeks keeps its unit when no render data is available", () => {
  const line = saveWith("Build 2w", { taskName: "Assemble" });
  known("#1567", () => assert.equal(extractMetadata(line).duration_days, 14));
});
