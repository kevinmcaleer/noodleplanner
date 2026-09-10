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
 *
 * This test parses ribbon.js's source (a lightweight, deliberately
 * conservative regex extraction -- see extractKnownLabels()) rather than
 * executing it, since ribbon.js reaches for globals (switchToView,
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

/** Labels ribbon.js's resolver can currently handle, extracted from its
 * source. Deliberately conservative: a label only counts as "known" if it
 * appears as a key in one of the three lookup tables, or is one of the
 * hard-coded special cases in resolveAction(). */
function extractKnownLabels() {
  const known = new Set();

  const viewBlock = ribbonSrc.match(/const VIEW_FOR_LABEL = \{([\s\S]*?)\n\};/)[1];
  for (const m of viewBlock.matchAll(/(?:'([^']+)'|([A-Za-z][\w]*))\s*:/g)) known.add(m[1] || m[2]);

  const labelActionsBlock = ribbonSrc.match(/const LABEL_ACTIONS = \{([\s\S]*?)\n\};/)[1];
  for (const m of labelActionsBlock.matchAll(/(?:'([^']+)'|([A-Za-z][\w ]*[\w]))\s*:\s*\(\)/g)) known.add(m[1] || m[2]);

  // scopedAction()'s table keys are "scope:Label" -- collect the bare
  // labels too, since resolveAction() only needs *a* match to exist, and
  // several of these are scope-specific overrides of an otherwise-known label.
  const scopedBlock = ribbonSrc.match(/function scopedAction[\s\S]*?const table = \{([\s\S]*?)\n {4}\};/)[1];
  for (const m of scopedBlock.matchAll(/'([^:']+):([^']+)'/g)) known.add(m[2]);

  // Hard-coded special cases in resolveAction()/FILE_ACTIONS.
  for (const label of [
    "Export", "Export…", "Import", "Import from Excel / MS Project",
  ]) known.add(label);

  return known;
}

/**
 * Labels reviewed and deliberately left as a "not available yet" stub,
 * because no existing function does the thing without inventing new
 * scope (a selection model that doesn't exist, a feature -- Programme,
 * portfolio heat maps -- that isn't built). Adding a label here is a
 * decision, not an oversight: if you're adding one, you looked for a real
 * function first and didn't find one.
 */
const DELIBERATE_STUBS = new Set([
  // Needs a selected card/column/row the ribbon has no way to know.
  "Add Card", "Edit", "Assign", "Add Column", "Rename", "WIP Limit", "Close", "Escalate",
  // Whiteboard canvas tools (need a selected object/tool state). "Colour"
  // used to be here too -- #1109 wired it to the whiteboard's own note
  // selection (wbGetSelectedNoteTask()/wbOpenColourPanelForSelectedNote()).
  "Align", "Distribute", "Lock", "Note", "Text", "To PBS", "To Tasks",
  // Features that don't exist in the app yet. ("Add Project" and "Capacity"
  // used to be here too -- #938 audit found both actually have real
  // functions (showCreateProjectDialog, the Team Allocation view) and wired
  // them instead of leaving them as stale stubs.)
  "Add Programme", "Weighting", "Rebaseline", "Snapshot",
  "Heat Map", "Heat", "Probability", "Impact", "RAG",
  "Slack", "Sync", "Filter", "Sort", "Group",
  // No dedicated function exists (checked: grepped the codebase, found none).
  "Delete", "Milestone", "Fit", "Today", "Go to Task", "Unlink",
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
