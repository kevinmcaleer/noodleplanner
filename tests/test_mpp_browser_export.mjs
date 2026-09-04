/**
 * The browser export path, exercised in Node.
 *
 * mpp-export.js keeps its file building pure — no fetch, no DOM — so the exact
 * code a browser runs can be tested here: model JSON in, a real .mpp out.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { buildMpp, modelToProject } from "../packages/noodle-web/src/noodle_web/static/mpp-export.js";
import { readProject } from "../packages/noodle-web/src/noodle_web/static/vendor/mppwriter/index.js";

const repo = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const python = `${repo}/.venv/bin/python`;
const template = process.env.NOODLE_MPP_TEMPLATE || `${repo}/templates/mpp-template.mpp`;
const runnable = existsSync(python) && existsSync(template);

const PLAN = `Phase 1
  Proposal 1d @kevin 2026-07-01
  *Approval 0d @kevin
  Build 5d @adam, @kevin 50%
Phase 2
  Review 2d @kevin
  Ship 1d
`;

/** The model the /api/mpp/model endpoint would return. */
function serverModel() {
  const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(`${repo}/packages/noodle-core/src`)})
from noodle_core.mpp_writer import build_project_model
print(json.dumps(build_project_model(${JSON.stringify(PLAN)}, "Browser export")))
`;
  return JSON.parse(execFileSync(python, ["-c", script], { cwd: repo }).toString());
}

test("the browser builds a real .mpp from the server's model", { skip: !runnable }, () => {
  const model = serverModel();
  assert.ok(model.tasks.length >= 6, "the model should carry every task");

  const bytes = buildMpp(model, new Uint8Array(readFileSync(template)), () => {});
  assert.deepEqual([...bytes.subarray(0, 8)], [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

  // and it describes the plan that went in
  const back = readProject(bytes);
  const names = back.tasks.map((t) => t.name);
  for (const name of ["Proposal", "Approval", "Build", "Review", "Ship"]) {
    assert.ok(names.includes(name), `${name} missing from the exported file: ${names.join(", ")}`);
  }
  assert.ok(back.resources.length >= 2, "resources should carry across");
  assert.ok(back.assignments.length >= 3, "assignments should carry across");
});

test("the model maps onto the writer's project shape", { skip: !runnable }, () => {
  const project = modelToProject(serverModel());
  assert.equal(project.title, "Browser export");
  assert.ok(project.start instanceof Date && !Number.isNaN(project.start.getTime()));
  for (const t of project.tasks) {
    assert.ok(t.start instanceof Date && t.finish instanceof Date, `${t.name} has bad dates`);
    assert.ok(t.finish.getTime() >= t.start.getTime(), `${t.name} finishes before it starts`);
  }
});
