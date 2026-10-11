/**
 * The task and product detail forms, lifted out of the browser scripts into a
 * Node sandbox with a stub DOM, so a test can open a line in the form, edit a
 * field and save it -- the whole write path of issue #1563 -- without a
 * browser.
 *
 * `script.js` and `views-products.js` are classic scripts with hundreds of
 * top-level functions, so the functions a form needs are cut out by name (the
 * same technique as tests/test_markdown_roundtrip.mjs) and evaluated with
 * `task-tokenizer.js` and `plan-model.js`, which are what they call. The DOM
 * is a map of ids to `{ value }` records plus the two `querySelectorAll`
 * shapes the forms use; anything the form merely pokes (titles, styles,
 * progress bars) is a no-op.
 *
 * What this does not reproduce: the backend-computed dates and durations the
 * real form reads from `lastRenderedTasks`. It is left empty here, which is
 * the state the real form is in when a task is opened before the first
 * render has returned, so the tests exercise the fallback path.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

const repo = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
export const staticDir = join(repo, "packages", "noodle-web", "src", "noodle_web", "static");

const sources = new Map();
function source(file) {
  if (!sources.has(file)) sources.set(file, readFileSync(join(staticDir, file), "utf8"));
  return sources.get(file);
}

/** Top-level `function name(` … `\n}` declarations, cut out of a classic script. */
function lift(file, names) {
  const text = source(file);
  let out = "";
  for (const name of names) {
    const start = text.indexOf(`\nfunction ${name}(`);
    if (start < 0) throw new Error(`${name} not found in ${file}`);
    const end = text.indexOf("\n}\n", start);
    if (end < 0) throw new Error(`${name} in ${file} has no closing brace at column 0`);
    out += text.slice(start, end + 3);
  }
  return out;
}

function stubElement(id) {
  return {
    id, value: "", checked: false, dataset: {}, style: {}, readOnly: false, title: "", textContent: "",
    innerHTML: "", children: [],
    classList: { contains: () => true, add() {}, remove() {}, toggle() {} },
    replaceChildren() { this.children = []; },
    appendChild(child) { this.children.push(child); },
    addEventListener() {}, removeAttribute() {}, setAttribute() {}, dispatchEvent() {},
  };
}

function stubRow() {
  const attrs = {};
  return {
    attrs, className: "",
    setAttribute(k, v) { attrs[k] = String(v); },
    getAttribute(k) { return attrs[k] ?? null; },
    removeAttribute(k) { delete attrs[k]; },
    addEventListener() {}, remove() {},
  };
}

function makeDocument(extraQueries = {}) {
  const elements = new Map();
  const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((value) => ({ value, checked: false }));
  const el = (id) => {
    if (!elements.has(id)) elements.set(id, stubElement(id));
    return elements.get(id);
  };
  const document = {
    getElementById(id) {
      if (id.startsWith("recDay_")) return days.find((d) => d.value === id.slice(7)) || null;
      return el(id);
    },
    createElement: () => stubRow(),
    querySelectorAll(selector) {
      if (selector === "#dependenciesList np-task-row") return el("dependenciesList").children;
      if (selector === ".recurrence-day-checkbox:checked") return days.filter((d) => d.checked);
      if (selector === ".recurrence-day-checkbox") return days;
      if (selector in extraQueries) return extraQueries[selector]();
      return [];
    },
  };
  return { document, el, days };
}

/**
 * The task details form: `openTaskForm(lineNumber)` reads a line into the
 * fields, `saveTask()` writes the fields back over it.
 */
export function makeTaskForm() {
  const { document, el } = makeDocument();
  const noop = () => {};
  const ctx = vm.createContext({
    console, document, setTimeout, clearTimeout,
    requestAnimationFrame: noop, Event: class Event { constructor(type) { this.type = type; } },
    window: {}, lastRenderedTasks: [],
    openDetailPane: noop, setTaskFormTitle: noop, updateTaskFormBackButton: noop, renderTaskResources: noop,
    updateEffortTotal: noop, updateRagDisplay: noop, updateProgressBar: noop, populateSubtasks: noop,
    calculateTaskDates: noop, drillIntoTask: noop, updateAllViews: noop,
    taskRowResourceNames: () => "", formatSubtaskDate: (d) => d,
  });
  vm.runInContext(source("task-tokenizer.js") + "\nglobalThis.TaskLineTokenizer = TaskLineTokenizer;", ctx);
  vm.runInContext(source("plan-model.js"), ctx);
  vm.runInContext(
    "let currentTaskLineNumber = null, userSetStartDate = false, userSetFinishDate = false, userSetDuration = false;\n" +
    "let _taskFormPopulating = false, _taskFormHistory = [], _saveTaskTimer = null;\n" +
    lift("editor.js", ["extractTaskNameFromEditorLine", "isEditorSeparatorLine"]) +
    lift("script.js", [
      "parseTaskLine", "getPreviousTaskName", "isSummaryLine", "parseResourceMappings",
      "openTaskForm", "saveTask", "populateDependenciesTable", "addDependencyRow",
      "collectDependenciesFromTable", "populateRecurrenceForm", "buildRecurrenceString",
    ]) +
    "\nglobalThis.api = { openTaskForm, saveTask, parseTaskLine };",
    ctx,
  );
  return {
    /** The form's current value for a field id, e.g. "taskComment". */
    field: (id) => el(id).value,
    /** Set a field as a user typing into it would. */
    type(id, value) { el(id).value = value; },
    /** Load `planText` and open the form on 1-based `lineNumber`. */
    open(planText, lineNumber) {
      el("planEditor").value = planText;
      ctx.api.openTaskForm(lineNumber);
    },
    /** Save the form; returns the whole plan text after the write. */
    save() {
      ctx.api.saveTask();
      return el("planEditor").value;
    },
    parseTaskLine: (line, lineNumber = 1) => ctx.api.parseTaskLine(line, lineNumber),
    /** TaskLineTokenizer.metadata(line): `{ tokens, values }`. */
    tokenizerValues: (line) => ctx.TaskLineTokenizer.metadata(line),
  };
}

/**
 * The product (deliverable) form's save: `saveProductForm()` rebuilds a
 * product's line from the Title / Identifier / Purpose fields and the
 * dependency tags. `openProductForm` renders those tags from the engine's
 * task list, which this sandbox does not have, so `deps` names what the real
 * form would have shown: the `$ids` the line already depends on.
 */
export function makeProductForm() {
  let tags = [];
  const { document, el } = makeDocument({
    "#productDependenciesTags .product-dep-tag": () => tags.map((id) => ({ title: `$${id}` })),
  });
  const noop = () => {};
  const ctx = vm.createContext({
    console, document, setTimeout, clearTimeout, renderText: noop,
    Event: class Event { constructor(type) { this.type = type; } },
  });
  vm.runInContext(source("task-tokenizer.js") + "\nglobalThis.TaskLineTokenizer = TaskLineTokenizer;", ctx);
  vm.runInContext(source("plan-model.js"), ctx);
  vm.runInContext(
    "let currentProductTask = null, currentProductLineNumber = null, currentProductType = 'internal', productFormSaveTimer = null;\n" +
    lift("views-products.js", ["saveProductForm", "productFindLineNumber", "productGetDepsFromTags"]) +
    "\nglobalThis.api = { saveProductForm, open(task, lineIndex, type) { currentProductTask = task; currentProductLineNumber = lineIndex; currentProductType = type; } };",
    ctx,
  );
  return {
    type(id, value) { el(id).value = value; },
    /**
     * Open the product at 0-based `lineIndex` of `planText`, as `openProductForm`
     * leaves the state: the task's name and `$id`, its product type, the
     * Title/Identifier/Purpose fields filled, and `deps` as dependency tags.
     */
    open(planText, lineIndex, { name, deliverable, type = "internal", purpose = "", deps = [] }) {
      el("planEditor").value = planText;
      tags = deps;
      ctx.api.open({ name, deliverable }, lineIndex, type);
      el("productTitle").value = name;
      el("productIdentifier").value = deliverable;
      el("productPurpose").value = purpose;
    },
    save() {
      ctx.api.saveProductForm();
      return el("planEditor").value;
    },
  };
}
