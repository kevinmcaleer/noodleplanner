/**
 * ribbon-commands.js -- the central command registry for the project
 * ribbon (#833, #891, #897). Pure data/logic, no DOM, so it is exercised
 * directly here rather than through Selenium.
 *
 *   node --test tests/test_ribbon_commands.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  RIBBON_GROUPS,
  isCommandVisible,
  isCommandEnabled,
  isCommandActive,
  isGroupVisible,
  visibleGroups,
} from "../packages/noodle-web/src/noodle_web/static/ribbon-commands.js";

const BASE_STATE = {
  view: "editor",
  canUndo: false,
  canRedo: false,
  kanbanViewMode: null,
  kanbanHideCompleted: false,
  kanbanSortPriority: false,
  pbsRagMode: false,
  productFlowHideCompleted: false,
  ganttShowDependencies: false,
  ganttShowCriticalPath: false,
  ganttShowBaseline: false,
};

function allCommands() {
  return RIBBON_GROUPS.flatMap((g) => g.commands);
}

test("every group has an id, a label and at least one command", () => {
  for (const group of RIBBON_GROUPS) {
    assert.ok(group.id, "group missing id");
    assert.ok(group.label, `group ${group.id} missing label`);
    assert.ok(group.commands.length > 0, `group ${group.id} has no commands`);
  }
});

test("every command has an id, label, icon and a run function", () => {
  for (const cmd of allCommands()) {
    assert.ok(cmd.id, "command missing id");
    assert.ok(cmd.label, `command ${cmd.id} missing label`);
    assert.ok(cmd.icon, `command ${cmd.id} missing icon`);
    assert.equal(typeof cmd.run, "function", `command ${cmd.id} has no run()`);
  }
});

test("command ids are unique across the whole registry", () => {
  const ids = allCommands().map((c) => c.id);
  assert.deepEqual(ids, [...new Set(ids)], "duplicate command id found");
});

test("group ids are unique", () => {
  const ids = RIBBON_GROUPS.map((g) => g.id);
  assert.deepEqual(ids, [...new Set(ids)]);
});

test("a command with no isVisible/isEnabled/isActive defaults to visible, enabled, inactive", () => {
  const plain = { id: "x" };
  assert.equal(isCommandVisible(plain, BASE_STATE), true);
  assert.equal(isCommandEnabled(plain, BASE_STATE), true);
  assert.equal(isCommandActive(plain, BASE_STATE), false);
});

test("a group with no isVisible defaults to visible", () => {
  assert.equal(isGroupVisible({ id: "x" }, BASE_STATE), true);
});

test("Edit/File/Format are visible on a normal project view, absent on Portfolio", () => {
  const onEditor = visibleGroups({ ...BASE_STATE, view: "editor" }).map((g) => g.id);
  assert.ok(onEditor.includes("edit"));
  assert.ok(onEditor.includes("file"));
  assert.ok(onEditor.includes("format"));

  const onPortfolio = visibleGroups({ ...BASE_STATE, view: "portfolio" }).map((g) => g.id);
  assert.ok(!onPortfolio.includes("edit"), "Portfolio has no single editor to undo/redo/save");
  assert.ok(!onPortfolio.includes("file"));
  assert.ok(!onPortfolio.includes("format"));
});

test("undo/redo enabled state follows canUndo/canRedo (#891 contextual enable/disable)", () => {
  const undo = allCommands().find((c) => c.id === "undo");
  const redo = allCommands().find((c) => c.id === "redo");
  assert.equal(isCommandEnabled(undo, { ...BASE_STATE, canUndo: false }), false);
  assert.equal(isCommandEnabled(undo, { ...BASE_STATE, canUndo: true }), true);
  assert.equal(isCommandEnabled(redo, { ...BASE_STATE, canRedo: false }), false);
  assert.equal(isCommandEnabled(redo, { ...BASE_STATE, canRedo: true }), true);
});

test("Mind Map groups appear only while the Mind Map view is active (#893)", () => {
  const elsewhere = visibleGroups({ ...BASE_STATE, view: "gantt" }).map((g) => g.id);
  assert.ok(!elsewhere.includes("mindmap-view"));
  assert.ok(!elsewhere.includes("mindmap-structure"));

  const onMindmap = visibleGroups({ ...BASE_STATE, view: "mindmap" }).map((g) => g.id);
  assert.ok(onMindmap.includes("mindmap-view"));
  assert.ok(onMindmap.includes("mindmap-structure"));
});

test("Board groups (group-by, options) appear only on the Board view (#894)", () => {
  const elsewhere = visibleGroups({ ...BASE_STATE, view: "editor" }).map((g) => g.id);
  assert.ok(!elsewhere.includes("board-group-by"));
  assert.ok(!elsewhere.includes("board-options"));

  const onBoard = visibleGroups({ ...BASE_STATE, view: "kanban" });
  const ids = onBoard.map((g) => g.id);
  assert.ok(ids.includes("board-group-by"));
  assert.ok(ids.includes("board-options"));

  const groupBy = onBoard.find((g) => g.id === "board-group-by").commands;
  assert.deepEqual(groupBy.map((c) => c.id), [
    "kanban-group-phase", "kanban-group-resource", "kanban-group-progress",
    "kanban-group-label", "kanban-group-bucket",
  ]);
});

test("the active group-by button matches kanbanViewMode", () => {
  const groupBy = visibleGroups({ ...BASE_STATE, view: "kanban", kanbanViewMode: "resource" })
    .find((g) => g.id === "board-group-by").commands;
  for (const cmd of groupBy) {
    const shouldBeActive = cmd.id === "kanban-group-resource";
    assert.equal(isCommandActive(cmd, { ...BASE_STATE, view: "kanban", kanbanViewMode: "resource" }), shouldBeActive,
      `${cmd.id} active state wrong`);
  }
});

test("kanban option toggles reflect hideCompleted/sortByPriority", () => {
  const options = visibleGroups({ ...BASE_STATE, view: "kanban" })
    .find((g) => g.id === "board-options").commands;
  const hide = options.find((c) => c.id === "kanban-hide-completed");
  const sort = options.find((c) => c.id === "kanban-sort-priority");

  assert.equal(isCommandActive(hide, { ...BASE_STATE, view: "kanban", kanbanHideCompleted: true }), true);
  assert.equal(isCommandActive(hide, { ...BASE_STATE, view: "kanban", kanbanHideCompleted: false }), false);
  assert.equal(isCommandActive(sort, { ...BASE_STATE, view: "kanban", kanbanSortPriority: true }), true);
});

test("Gantt group appears for both gantt and tasks views, and toggles reflect checkbox state (#896)", () => {
  for (const view of ["gantt", "tasks"]) {
    const ids = visibleGroups({ ...BASE_STATE, view }).map((g) => g.id);
    assert.ok(ids.includes("gantt-options"), `${view} should show gantt-options`);
  }
  assert.ok(!visibleGroups({ ...BASE_STATE, view: "kanban" }).map((g) => g.id).includes("gantt-options"));

  const cmds = visibleGroups({ ...BASE_STATE, view: "gantt", ganttShowCriticalPath: true })
    .find((g) => g.id === "gantt-options").commands;
  const cp = cmds.find((c) => c.id === "gantt-critical-path");
  const deps = cmds.find((c) => c.id === "gantt-dependencies");
  assert.equal(isCommandActive(cp, { ...BASE_STATE, view: "gantt", ganttShowCriticalPath: true }), true);
  assert.equal(isCommandActive(deps, { ...BASE_STATE, view: "gantt", ganttShowDependencies: false }), false);
});

test("RAID and Comms groups appear only on their own view, with the real add-item actions (#896)", () => {
  const raid = visibleGroups({ ...BASE_STATE, view: "raid" }).find((g) => g.id === "raid-actions");
  assert.ok(raid, "raid-actions should show on the RAID view");
  assert.deepEqual(raid.commands.map((c) => c.id), ["raid-add-item"]);
  assert.ok(!visibleGroups({ ...BASE_STATE, view: "comms" }).map((g) => g.id).includes("raid-actions"));

  const comms = visibleGroups({ ...BASE_STATE, view: "comms" }).find((g) => g.id === "comms-actions");
  assert.ok(comms, "comms-actions should show on the Comms view");
  assert.deepEqual(comms.commands.map((c) => c.id), ["comms-add-item", "comms-export-word"]);
  assert.ok(!visibleGroups({ ...BASE_STATE, view: "raid" }).map((g) => g.id).includes("comms-actions"));
});

test("Product view groups appear for PBS and Product Flow, not elsewhere (#895)", () => {
  for (const view of ["pbs", "product-flow"]) {
    const ids = visibleGroups({ ...BASE_STATE, view }).map((g) => g.id);
    assert.ok(ids.includes("products-view"), `${view} should show products-view`);
    assert.ok(ids.includes("products-export"), `${view} should show products-export`);
    assert.ok(ids.includes("products-options"), `${view} should show products-options`);
  }
  const elsewhere = visibleGroups({ ...BASE_STATE, view: "deliverables" }).map((g) => g.id);
  assert.ok(!elsewhere.includes("products-view"), "the deliverables matrix has no pbs-toolbar to migrate");
});

test("expand/collapse and hide-completed are Product Flow-only; PBS has neither", () => {
  const pbsView = visibleGroups({ ...BASE_STATE, view: "pbs" }).find((g) => g.id === "products-view");
  const pbsOptions = visibleGroups({ ...BASE_STATE, view: "pbs" }).find((g) => g.id === "products-options");
  assert.ok(!pbsView.commands.some((c) => c.id === "product-expand-all"));
  assert.ok(!pbsView.commands.some((c) => c.id === "product-collapse-all"));
  assert.ok(!pbsOptions.commands.some((c) => c.id === "product-hide-completed"));

  const flowView = visibleGroups({ ...BASE_STATE, view: "product-flow" }).find((g) => g.id === "products-view");
  const flowOptions = visibleGroups({ ...BASE_STATE, view: "product-flow" }).find((g) => g.id === "products-options");
  assert.ok(flowView.commands.some((c) => c.id === "product-expand-all"));
  assert.ok(flowView.commands.some((c) => c.id === "product-collapse-all"));
  assert.ok(flowOptions.commands.some((c) => c.id === "product-hide-completed"));
});

test("a group with a group-level isVisible but zero visible commands does not render", () => {
  // Every command in 'board-group-by' is unconditionally visible once the
  // group itself is, so this asserts the filtering machinery rather than
  // a specific command -- if that ever changes, this documents the contract.
  const groups = visibleGroups({ ...BASE_STATE, view: "kanban" });
  for (const g of groups) {
    assert.ok(g.commands.length > 0, `${g.id} rendered with no commands`);
  }
});

test("run() calls the expected action by name", () => {
  const calls = [];
  const actions = new Proxy({}, {
    get: (_target, prop) => (...args) => calls.push([prop, ...args]),
  });

  allCommands().find((c) => c.id === "undo").run(actions);
  assert.deepEqual(calls.at(-1), ["undo"]);

  allCommands().find((c) => c.id === "kanban-group-resource").run(actions);
  assert.deepEqual(calls.at(-1), ["switchKanbanView", "resource"]);
});
