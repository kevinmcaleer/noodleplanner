/**
 * Regression test for issue #974: switching projects via the project
 * switcher (multi-plan-loader.js's loadProjectIntoEditor()) updated both
 * editors' *text* correctly, but their line-number gutters and syntax-
 * highlight overlays did not refresh -- they kept showing whatever the
 * previous project (or, before any project was ever loaded, the textarea's
 * placeholder) looked like.
 *
 * Root cause: the function called a global `updateLineNumbers()` "if
 * available" right after setting each editor's `.value`, but no such global
 * exists -- editor.js's setupEditor() defines updateLineNumbers as a
 * per-editor closure and exposes it as `editor._updateLineNumbers`, so the
 * `typeof updateLineNumbers === 'function'` guard was always false and the
 * call was silent dead code. The main editor's gutter still got refreshed
 * as a side effect of the 'input' event dispatched further down (its own
 * setupEditor() listener calls the closure directly), but the Kanban view's
 * plan editor pane has no such listener wired to that dispatch, so its
 * gutter/highlighting only ever updated by accident -- when the server's
 * plan-text normalization happened to make it differ from the main editor,
 * tripping the separate main->kanban sync listener into re-firing 'input'
 * on it. Whenever normalization was a no-op (e.g. the plan already had
 * every front-matter field the server would add), the Kanban editor pane
 * was left completely stale.
 *
 * This drives loadProjectIntoEditor() directly (no browser) using the same
 * vm-sandbox technique as tests/test_kanban_label_drop_refresh.mjs.
 *
 * Run with: node --test tests/test_project_switch_editor_refresh.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const staticDir = join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'static');

function makeEditorStub(initialValue) {
  return {
    value: initialValue,
    updateLineNumbersCalls: 0,
    _updateLineNumbers() { this.updateLineNumbersCalls++; },
    listeners: {},
    addEventListener(type, fn) {
      (this.listeners[type] ||= []).push(fn);
    },
    dispatchEvent(event) {
      for (const fn of this.listeners[event.type] || []) fn(event);
      return true;
    },
    classList: { contains: () => false },
  };
}

function buildSandbox({ project, kanbanActive }) {
  const planEditor = makeEditorStub('');
  const kanbanEditor = makeEditorStub('');
  const kanbanTab = { classList: { contains: (c) => c === 'active' && kanbanActive } };
  const elements = { planEditor, kanbanPlanEditor: kanbanEditor, 'kanban-tab': kanbanTab };

  let currentProjectId = null;
  const documentStub = {
    getElementById: (id) => elements[id] || null,
  };

  const sandbox = {
    console,
    document: documentStub,
    window: { dispatchEvent() {}, addEventListener() {} },
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    Event: class Event { constructor(type) { this.type = type; } },
    // Dependencies loadProjectIntoEditor calls unconditionally or via typeof guards.
    loadProject: () => project,
    getAllProjects: () => ({}),
    saveAllProjects: () => true,
    setCurrentProjectId: (id) => { currentProjectId = id; },
    getCurrentProjectId: () => currentProjectId,
    updateAllViews: async () => {},
    syncKanbanFromEditor: () => {},
    updateProjectBreadcrumb: () => {},
  };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(staticDir, 'multi-plan-loader.js'), 'utf8'), sandbox);
  return { sandbox, planEditor, kanbanEditor };
}

test('switching projects refreshes both editors\' line numbers/highlighting, not just their text', async () => {
  const project = { id: 'p2', name: 'Project Beta', planText: 'Task Beta One 0%\nTask Beta Two 0%', createdAt: 1, updatedAt: 1 };
  const { sandbox, planEditor, kanbanEditor } = buildSandbox({ project, kanbanActive: true });

  const ok = await sandbox.loadProjectIntoEditor('p2');

  assert.equal(ok, true);
  assert.equal(planEditor.value, project.planText, 'main editor text should reflect the newly loaded project');
  assert.equal(kanbanEditor.value, project.planText, 'kanban editor text should reflect the newly loaded project');

  assert.ok(
    planEditor.updateLineNumbersCalls >= 1,
    'main editor gutter/highlighting must be refreshed, not left showing the previous project'
  );
  assert.ok(
    kanbanEditor.updateLineNumbersCalls >= 1,
    'kanban editor gutter/highlighting must be refreshed too -- this must not depend on the ' +
    'main->kanban sync listener happening to fire (#974)'
  );
});

test('the kanban editor gutter refreshes even when the Kanban tab is not the active view', async () => {
  const project = { id: 'p3', name: 'Project Gamma', planText: 'Task Gamma One 0%', createdAt: 1, updatedAt: 1 };
  const { sandbox, kanbanEditor } = buildSandbox({ project, kanbanActive: false });

  await sandbox.loadProjectIntoEditor('p3');

  assert.equal(kanbanEditor.value, project.planText);
  assert.ok(
    kanbanEditor.updateLineNumbersCalls >= 1,
    'the Kanban plan editor pane should not be left stale just because the user is not currently viewing it'
  );
});
