/**
 * test_ribbon_action_coverage.mjs -- every button label in ribbon-ia.js
 * must be either resolvable by ribbon.js's action tables, or explicitly
 * listed here as a deliberate stub (a feature that doesn't exist yet).
 *
 * Why this exists: ribbon.js is a classic script (not an ES module, so its
 * VIEW_FOR_LABEL/LABEL_ACTIONS/scopedAction tables can't be imported
 * directly), and its action resolution is keyed by label string, matched
 * against ribbon-ia.js's design data by hand. That match silently drifts:
 * building this ribbon surfaced *seven* labels the design data used that
 * the resolver had no entry for -- "Report" (the Home tab's own way back
 * to the dashboard, found because a user asked "where's the dashboard
 * button?"), "Deps", "Risk", "Issue", "Editor", "Day/Week/Month" and
 * "Group by" -- each silently falling through to a "not available yet"
 * toast instead of doing the real, already-existing thing it should.
 * ("Day/Week/Month" no longer exists: #1267 replaced that caret popover
 * with the Gantt Tools `Scale` group's five mutually exclusive buttons,
 * removing the label and its resolver entry together so it could not
 * regress into the unresolved state this header describes.)
 *
 * This test parses ribbon.js's source (a small, deliberately conservative
 * scan for the lookup tables' top-level keys -- see topLevelKeys() and
 * extractKnownLabels()) rather than executing it, since ribbon.js reaches for globals (switchToView,
 * EditorUndoManager, ...) that only exist in a loaded page. It cannot
 * verify a mapped label's *function* is correct (see #895/#896's format-
 * string bugs, caught by browser QA instead) -- only that the label was
 * consciously decided one way or the other.
 *
 *   node --test tests/test_ribbon_action_coverage.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  TABS, CONTEXTUAL_TABS, PORTFOLIO_TABS, PROGRAMME_TABS,
} from "../packages/noodle-web/src/noodle_web/static/ribbon-ia.js";

const repo = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const ribbonSrc = readFileSync(`${repo}/packages/noodle-web/src/noodle_web/static/ribbon.js`, "utf8");

/** Every (scopeId, label) pair the design actually renders a button for --
 * every scope's tab set: Project (TABS), Portfolio (PORTFOLIO_TABS),
 * Programme (PROGRAMME_TABS), plus the contextual tabs shared across all
 * three scopes. */
function allButtons() {
  const out = [];
  for (const scope of [...TABS, ...PORTFOLIO_TABS, ...PROGRAMME_TABS, ...CONTEXTUAL_TABS]) {
    for (const g of scope.groups) {
      for (const b of g.lg || []) out.push({ scopeId: scope.id, label: b[1], flag: b[2] });
      for (const col of g.cols || []) for (const b of col) out.push({ scopeId: scope.id, label: b[1], flag: b[2] });
    }
  }
  return out;
}

/** A 'link:<url>' 3rd tuple element (#909 ribbon-parity follow-up) marks a
 * button as a plain external <a>, rendered and clicked without ever going
 * through resolveAction()/the tables below by design -- see ribbon.js's
 * renderButton()/linkHrefFor(). Not a stub: it already does the real thing
 * (opens the URL), it just isn't -- and shouldn't be -- in these tables. */
function isLinkButton(flag) {
  return typeof flag === "string" && flag.startsWith("link:");
}

/**
 * The top-level keys of an object literal's body, in order.
 *
 * A small scanner rather than a regex over the text: it steps over string
 * literals and `//`/`/* *\/` comments, and tracks bracket depth, so a key
 * is only ever a string or identifier at depth 0, directly followed by a
 * `:`. The regexes this replaced read the source as plain text, so an
 * apostrophe or a colon in a comment ("the board's panels: ...") could
 * pair up with a later quote and swallow a real key -- a correctly wired
 * button then failed this test -- and a word before a colon in a comment
 * could count as a key, which could hide a genuinely unwired one.
 *
 * Assumes the body has no regex literals (the three tables below have
 * none -- a `/` that is not a comment is just skipped).
 */
function topLevelKeys(body) {
  const keys = [];
  let depth = 0;
  let expectKey = true;
  let pending = null; // a string/identifier at depth 0 that may be a key
  let i = 0;
  const n = body.length;
  const skipString = (quote) => {
    let text = "";
    i++; // opening quote
    while (i < n && body[i] !== quote) {
      if (body[i] === "\\") { text += body[i + 1] ?? ""; i += 2; continue; }
      text += body[i++];
    }
    i++; // closing quote
    return text;
  };
  while (i < n) {
    const c = body[i];
    if (c === "/" && body[i + 1] === "/") { while (i < n && body[i] !== "\n") i++; continue; }
    if (c === "/" && body[i + 1] === "*") { const end = body.indexOf("*/", i + 2); i = end < 0 ? n : end + 2; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === "'" || c === '"' || c === "`") {
      const text = skipString(c);
      pending = (depth === 0 && expectKey && c !== "`") ? text : null;
      if (pending === null && depth === 0) expectKey = false;
      continue;
    }
    if (depth === 0 && expectKey && /[A-Za-z_$]/.test(c)) {
      const start = i;
      while (i < n && /[\w$]/.test(body[i])) i++;
      pending = body.slice(start, i);
      continue;
    }
    if (c === ":" && depth === 0 && pending !== null) {
      keys.push(pending);
      pending = null;
      expectKey = false;
      i++;
      continue;
    }
    pending = null;
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) expectKey = true;
    if (depth === 0 && c !== ",") expectKey = expectKey && c === ",";
    i++;
  }
  return keys;
}

/** Labels ribbon.js's resolver can currently handle, extracted from its
 * source. Deliberately conservative: a label only counts as "known" if it
 * is a key in one of the three lookup tables, or is one of the hard-coded
 * special cases in resolveAction(). */
function extractKnownLabels() {
  const known = new Set();

  const viewBlock = ribbonSrc.match(/const VIEW_FOR_LABEL = \{([\s\S]*?)\n\};/)[1];
  for (const key of topLevelKeys(viewBlock)) known.add(key);

  const labelActionsBlock = ribbonSrc.match(/const LABEL_ACTIONS = \{([\s\S]*?)\n\};/)[1];
  for (const key of topLevelKeys(labelActionsBlock)) known.add(key);

  // scopedAction()'s table keys are "scope:Label" -- collect the bare
  // labels too, since resolveAction() only needs *a* match to exist, and
  // several of these are scope-specific overrides of an otherwise-known label.
  const scopedBlock = ribbonSrc.match(/function scopedAction[\s\S]*?const table = \{([\s\S]*?)\n {4}\};/)[1];
  for (const key of topLevelKeys(scopedBlock)) {
    const colon = key.indexOf(":");
    if (colon > 0) known.add(key.slice(colon + 1));
  }

  // Hard-coded special cases in resolveAction()/FILE_ACTIONS.
  for (const label of [
    "Export", "Export…", "Import", "Import from Excel / MS Project",
  ]) known.add(label);

  return known;
}

const DELIBERATE_STUBS = new Set([
  // Needs a selected card/column/row the ribbon has no way to know.
  "Add Card", "Edit", "Assign", "Add Column", "Rename", "WIP Limit", "Close", "Escalate",
  // Whiteboard canvas tools (need a selected object/tool state). "Colour"
  // used to be here too -- #1109 wired it to the whiteboard's own note
  // selection (wbGetSelectedNoteTask()/wbOpenColourPanelForSelectedNote()).
  // "Note" used to be here too -- #1107 wired it to
  // wbCreateNoteInViewportCentre(), the same free-form-note creation
  // #1015 already built and the whiteboard toolbar's own buttons call.
  // "Text" was here too, until it became "Title" and was wired to the
  // toolbar's own free-floating-text function.
  "Align", "Distribute", "Lock", "To PBS", "To Tasks",
  // Features that don't exist in the app yet. ("Add Project" and "Capacity"
  // used to be here too -- #938 audit found both actually have real
  // functions (showCreateProjectDialog, the Team Allocation view) and wired
  // them instead of leaving them as stale stubs.)
  "Add Programme", "Weighting", "Rebaseline", "Snapshot",
  "Heat Map", "Heat", "Probability", "Impact", "RAG",
  // ("Group" used to be here too -- #1341 wired the whiteboard's Group to
  // the #874 grouping the selection toolbar already had.)
  "Slack", "Filter", "Sort",
  // No dedicated function exists (checked: grepped the codebase, found none).
  "Delete", "Milestone", "Go to Task", "Unlink",
  "Durations",
  "Interest", "Owner", "Grid",
  "Categorise", "Tag", "Link to Risk", "Review", "Publish",
  // Programme scope (#936/#909): Programmes aren't built yet (#731/#910).
  // PROGRAMME_TABS is a deliberately small, honestly-labelled placeholder --
  // every button in it is intentionally a stub rather than the ribbon
  // pretending programme features exist. See ribbon-ia.js's PROGRAMME_TABS
  // comment for the full reasoning.
  "Programme View", "Cross-Project Links", "Shared Capacity",
]);

test("every button label is either resolvable, a link button, or an explicit, reviewed stub", () => {
  const known = extractKnownLabels();
  const unaccounted = [];
  for (const { scopeId, label, flag } of allButtons()) {
    if (isLinkButton(flag) || known.has(label) || DELIBERATE_STUBS.has(label)) continue;
    unaccounted.push(`${scopeId}: "${label}"`);
  }
  assert.deepEqual(unaccounted, [], `unaccounted-for labels (neither wired nor a reviewed stub):\n${unaccounted.join("\n")}`);
});

test("DELIBERATE_STUBS has no dead entries -- every stub label is still used somewhere", () => {
  const used = new Set(allButtons().map((b) => b.label));
  const dead = [...DELIBERATE_STUBS].filter((label) => !used.has(label));
  assert.deepEqual(dead, [], `stub labels no longer used by any button (remove from the allowlist): ${dead.join(", ")}`);
});

test("no link: button label is also in DELIBERATE_STUBS or the resolvable tables", () => {
  const known = extractKnownLabels();
  for (const { label, flag } of allButtons()) {
    if (!isLinkButton(flag)) continue;
    assert.ok(!DELIBERATE_STUBS.has(label), `"${label}" is a link button but also listed as a stub`);
    assert.ok(!known.has(label), `"${label}" is a link button but also resolvable -- remove the redundant table entry`);
  }
});

test("no label is both wired and marked as a deliberate stub", () => {
  const known = extractKnownLabels();
  const overlap = [...DELIBERATE_STUBS].filter((label) => known.has(label));
  assert.deepEqual(overlap, [], `labels marked as stubs but actually wired (stale allowlist entry): ${overlap.join(", ")}`);
});

/**
 * #1111: the five per-category highlight toggles and the Highlight Preset
 * picker were reported as looking dead -- they're editor syntax-highlight
 * controls (#1051), invisible whenever the markdown editor panel isn't on
 * screen. Two checks lock in the fix: every one of the six has a tooltip
 * that names the markdown editor as what it affects (LABEL_HELP), and
 * every one of the five direct toggles reveals the editor panel as part of
 * its own action rather than leaving that as a documented-only promise.
 */
test("the highlight-toggle and preset-picker tooltips name the markdown editor as what they affect (#1111)", () => {
  const helpBlock = ribbonSrc.match(/const LABEL_HELP = \{([\s\S]*?)\n\};/)[1];
  for (const label of [
    "Show Durations", "Show Resources", "Show Tags", "Show Comments", "Show Dependencies", "Highlight Preset",
  ]) {
    const m = helpBlock.match(new RegExp(`'${label}':\\s*'([^']*)'`));
    assert.ok(m, `no LABEL_HELP entry for "${label}"`);
    assert.match(m[1], /markdown editor/i, `"${label}"'s tooltip doesn't say what it affects: "${m[1]}"`);
  }
});

test("each single-category highlight toggle reveals the editor panel so its effect is never silently invisible (#1111)", () => {
  const labelActionsBlock = ribbonSrc.match(/const LABEL_ACTIONS = \{([\s\S]*?)\n\};/)[1];
  for (const [label, category] of [
    ["Show Durations", "duration"], ["Show Resources", "resource"], ["Show Tags", "tag"],
    ["Show Comments", "comment"], ["Show Dependencies", "dependency"],
  ]) {
    const m = labelActionsBlock.match(new RegExp(`'${label}':\\s*\\(\\)\\s*=>\\s*\\{([^}]*)\\}`));
    assert.ok(m, `no LABEL_ACTIONS entry found for "${label}"`);
    assert.match(m[1], new RegExp(`toggleCategory\\('${category}'\\)`), `"${label}" doesn't toggle the "${category}" category`);
    assert.match(m[1], /revealEditorPanel\(\)/, `"${label}" doesn't reveal the editor panel`);
  }
});

test("applying a highlight preset also reveals the editor panel (#1111)", () => {
  const presetsBlock = ribbonSrc.match(/const HIGHLIGHT_PRESETS = \[([\s\S]*?)\nconst LABEL_HELP/)[1];
  const runLine = presetsBlock.match(/run:\s*\(\)\s*=>\s*\{[^}]*\}/);
  assert.ok(runLine, "no HIGHLIGHT_PRESETS run() callback found");
  assert.match(runLine[0], /applyPreset\(preset\)/);
  assert.match(runLine[0], /revealEditorPanel\(\)/, "picking a preset doesn't reveal the editor panel");
});
