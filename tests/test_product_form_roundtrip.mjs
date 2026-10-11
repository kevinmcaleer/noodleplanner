/**
 * The product (deliverable) form's save keeps what it does not edit (issue
 * #1569 under epic #1563).
 *
 * `saveProductForm()` in views-products.js rebuilds a product's line from the
 * Title, Identifier and Purpose fields and the dependency tags, keeping the
 * original line's other tokens by shape. This opens a product in a Node
 * sandbox (tests/helpers/task_form_sandbox.mjs), saves it with no edits, and
 * checks the browser engine reads the same thing back.
 *
 *   node --test tests/test_product_form_roundtrip.mjs
 *
 * Defects carry their issue through `known()`, which fails once they are
 * fixed so the marker is removed with the fix.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { extractMetadata } from "../packages/noodle-web/src/noodle_web/static/engine/tokeniser.js";
import { makeProductForm } from "./helpers/task_form_sandbox.mjs";

const form = makeProductForm();

/** Open the product on `line`, type `edits`, save; the line as rewritten. */
function saveWith(line, { purpose = "", edits = {}, deps = [] } = {}) {
  const meta = extractMetadata(line);
  form.open(`# Plan\nOther $other 1d\n${line}\n`, 2, {
    name: meta.description, deliverable: meta.deliverable, type: meta.product_type, purpose, deps,
  });
  for (const [field, value] of Object.entries(edits)) form.type(field, value);
  return form.save().split("\n")[2];
}

function known(issue, check) {
  let failed = false;
  try { check(); } catch { failed = true; }
  assert.ok(failed, `${issue} seems fixed: remove the known() marker from this test`);
}

function sameMeaning(before, after) {
  assert.deepEqual(extractMetadata(after), extractMetadata(before), `${before}\n -> ${after}`);
}

// --- what works today ---------------------------------------------------------

test("the tokens the form keeps by shape survive an unedited save", () => {
  const line = "Build $core 3d @alex 50% 2026-03-02 #tag";
  sameMeaning(line, saveWith(line));
});

test("the purpose is written as the line's comment", () => {
  const line = saveWith("Build $core 3d", { purpose: "what it is for" });
  assert.equal(extractMetadata(line).comment, "what it is for");
});

test("renaming the identifier rewrites the dependants that point at it", () => {
  form.open("# Plan\nBuild $core 1d\nTest 1d [depends $core]\n", 1, { name: "Build", deliverable: "core" });
  form.type("productIdentifier", "engine");
  const text = form.save();
  assert.equal(text.split("\n")[1], "Build $engine 1d");
  assert.deepEqual(extractMetadata(text.split("\n")[2]).depends, ["$engine"]);
});

test("group and external products keep their prefix", () => {
  assert.equal(saveWith("Build /$grp 3d"), "Build /$grp 3d");
  assert.equal(saveWith("Build ^$ext 3d"), "Build ^$ext 3d");
});

test("a leading star survives", () => {
  assert.equal(saveWith("* Build $core 3d"), "* Build $core 3d");
});

// --- #1569: tokens the save drops -----------------------------------------------

for (const [token, field] of [
  ["D2026-09-10", "deadline"],
  ["~4h/8h", "effort_total"],
  ["!!", "priority"],
  ["{Backlog}", "bucket"],
  ["[repeats weekly mon]", "recurrence"],
  ["[levelled @alex 2026-04-01]", "levelled"],
  ["[pin top]", "pin"],
  ["[relates Other]", "relates"],
]) {
  test(`${token} survives an unedited save`, () => {
    const line = `Build $core 3d ${token}`;
    const after = saveWith(line);
    known("#1569", () => assert.deepEqual(extractMetadata(after)[field], extractMetadata(line)[field], after));
  });
}

test("a levelled resource is not turned into a plain assignment", () => {
  const after = saveWith("Build $core 3d [levelled @alex 2026-04-01]");
  known("#1569", () => assert.equal(extractMetadata(after).resources, undefined, after));
});

test("a quality role keeps its role", () => {
  const after = saveWith("Build $core 3d @alex:P");
  assert.deepEqual(extractMetadata(after).quality_roles, { alex: "P" }, after);
});

test("a two-line purpose stays on one markdown line", () => {
  form.open("# Plan\nBuild $core 3d\n", 1, { name: "Build", deliverable: "core", purpose: 'line one\nline "two"' });
  const text = form.save();
  known("#1569", () => {
    assert.equal(text.split("\n").length, 3, text);
    assert.equal(extractMetadata(text.split("\n")[1]).comment, 'line one\nline "two"');
  });
});
