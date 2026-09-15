/**
 * ribbon-ia.js -- data integrity for the ribbon's command catalogue
 * (design handoff "Ribbon Toolbar (option 2a)", #833 follow-up).
 *
 * This module was hand-ported from the design's ribbon-ia.json; these
 * tests catch transcription mistakes (a typo'd icon id, a duplicate tab,
 * a contextForView entry pointing at a tab that doesn't exist) rather
 * than testing behaviour, which lives in ribbon.js.
 *
 *   node --test tests/test_ribbon_ia.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  SCOPES, QUICK_ACTIONS, TABS, PORTFOLIO_TABS, PROGRAMME_TABS, CONTEXTUAL_TABS,
  CONTEXT_FOR_VIEW, contextualTabFor, tabsForScope, scopeForView,
} from "../packages/noodle-web/src/noodle_web/static/ribbon-ia.js";

/** Every scope's own tab set, plus the contextual tabs shared by all scopes. */
const ALL_SCOPE_TABS = [...TABS, ...PORTFOLIO_TABS, ...PROGRAMME_TABS];

const repo = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

/** Every symbol id defined in the app's sprite (templates/_icon_sprite.html,
 * `{% include %}`d by index.html and components.html), sans "icon-". */
function spriteIconIds() {
  const html = readFileSync(`${repo}/packages/noodle-web/src/noodle_web/templates/_icon_sprite.html`, "utf8");
  const ids = new Set();
  for (const m of html.matchAll(/<symbol id="icon-([a-z0-9-]+)"/g)) ids.add(m[1]);
  return ids;
}

/** Every [icon, label] / [icon, label, 'caret'] tuple across every group in a tab list. */
function buttonsIn(tabs) {
  const out = [];
  for (const tab of tabs) {
    for (const group of tab.groups) {
      for (const b of group.lg || []) out.push({ tab: tab.id, group: group.name, kind: "lg", tuple: b });
      for (const col of group.cols || []) {
        for (const b of col) out.push({ tab: tab.id, group: group.name, kind: "sm", tuple: b });
      }
    }
  }
  return out;
}

test("every button icon exists in the app's SVG sprite", () => {
  const known = spriteIconIds();
  const missing = [];
  for (const { tab, group, tuple } of [...buttonsIn(ALL_SCOPE_TABS), ...buttonsIn(CONTEXTUAL_TABS)]) {
    if (!known.has(tuple[0])) missing.push(`${tab}/${group}: icon "${tuple[0]}" for "${tuple[1]}"`);
  }
  assert.deepEqual(missing, [], `unknown icon ids:\n${missing.join("\n")}`);
});

test("quick actions and contextual-tab icons also exist in the sprite", () => {
  const known = spriteIconIds();
  const missing = [];
  for (const q of QUICK_ACTIONS) if (!known.has(q.icon)) missing.push(`quickActions: "${q.icon}" for "${q.label}"`);
  for (const s of SCOPES) if (!known.has(s.icon)) missing.push(`scopes: "${s.icon}" for "${s.label}"`);
  for (const c of CONTEXTUAL_TABS) if (!known.has(c.icon)) missing.push(`contextualTabs: "${c.icon}" for "${c.label}"`);
  assert.deepEqual(missing, []);
});

test("every button tuple has a non-empty icon and label", () => {
  for (const { tab, group, tuple } of [...buttonsIn(ALL_SCOPE_TABS), ...buttonsIn(CONTEXTUAL_TABS)]) {
    assert.ok(tuple[0], `${tab}/${group}: empty icon`);
    assert.ok(tuple[1], `${tab}/${group}: empty label for icon "${tuple[0]}"`);
    // A button tuple's 3rd element is either "caret" (a split/gallery
    // button) or "link:<url>" (#909 ribbon-parity follow-up -- a plain
    // external link, e.g. "Docs"; see ribbon-ia.js's top-of-file comment).
    if (tuple[2] !== undefined) {
      const isCaret = tuple[2] === "caret";
      const isLink = typeof tuple[2] === "string" && tuple[2].startsWith("link:");
      assert.ok(isCaret || isLink, `${tab}/${group}: unexpected 3rd element "${tuple[2]}"`);
    }
  }
});

test("a link: button always has a real https URL, and never doubles as a caret", () => {
  for (const { tab, group, tuple } of [...buttonsIn(ALL_SCOPE_TABS), ...buttonsIn(CONTEXTUAL_TABS)]) {
    if (typeof tuple[2] !== "string" || !tuple[2].startsWith("link:")) continue;
    const url = tuple[2].slice("link:".length);
    assert.match(url, /^https:\/\/.+/, `${tab}/${group}: "${tuple[1]}" has a non-https link URL "${url}"`);
  }
});

test("tab ids are unique, and match the design's Home/Plan/Track/Resources/Report/View order", () => {
  const ids = TABS.map((t) => t.id);
  assert.deepEqual(ids, [...new Set(ids)]);
  assert.deepEqual(ids, ["home", "plan", "track", "resources", "report", "view"]);
});

test("portfolio and programme scope tab ids are each unique, and don't collide with Project's or each other's", () => {
  const portfolioIds = PORTFOLIO_TABS.map((t) => t.id);
  const programmeIds = PROGRAMME_TABS.map((t) => t.id);
  assert.deepEqual(portfolioIds, [...new Set(portfolioIds)]);
  assert.deepEqual(programmeIds, [...new Set(programmeIds)]);
  const allIds = [...TABS.map((t) => t.id), ...portfolioIds, ...programmeIds];
  assert.deepEqual(allIds, [...new Set(allIds)], "a scope's tab id collides with another scope's");
});

test("tabsForScope returns the right tab set per scope, defaulting to Project for an unknown scope", () => {
  assert.equal(tabsForScope("project"), TABS);
  assert.equal(tabsForScope("portfolio"), PORTFOLIO_TABS);
  assert.equal(tabsForScope("programme"), PROGRAMME_TABS);
  assert.equal(tabsForScope("nonsense"), TABS);
});

test("portfolio Home leads with the roll-up (Status), mirroring project Home's Dashboard-first fix (issue #933)", () => {
  const pfHome = PORTFOLIO_TABS.find((t) => t.id === "pf-home");
  const firstLargeButton = pfHome.groups[0].lg[0];
  assert.equal(firstLargeButton[1], "Status", "the first, large icon on portfolio Home should be the roll-up, not the projects list");
});

test("scopeForView derives the altitude straight from the current view (issue #908/#932)", () => {
  assert.equal(scopeForView("portfolio"), "portfolio");
  assert.equal(scopeForView("backstage"), "portfolio", "backstage is a portfolio-altitude launcher/shell view");
  assert.equal(scopeForView("programme"), "programme");
  assert.equal(scopeForView("tasks"), "project");
  assert.equal(scopeForView("raid"), "project");
  assert.equal(scopeForView(null), "project", "no current view defaults to project scope, same as tabsForScope's unknown-scope fallback");
});

test("every scopeForView output resolves to a real tab set via tabsForScope, not the Project fallback by accident", () => {
  assert.equal(tabsForScope(scopeForView("portfolio")), PORTFOLIO_TABS);
  assert.equal(tabsForScope(scopeForView("programme")), PROGRAMME_TABS);
  assert.equal(tabsForScope(scopeForView("gantt")), TABS);
});

test("contextual tab ids are unique and every one has an accent, tint and onAccent colour", () => {
  const ids = CONTEXTUAL_TABS.map((c) => c.id);
  assert.deepEqual(ids, [...new Set(ids)]);
  for (const c of CONTEXTUAL_TABS) {
    assert.match(c.accent, /^#[0-9a-f]{6}$/i, `${c.id}: bad accent`);
    assert.match(c.tint, /^#[0-9a-f]{6}$/i, `${c.id}: bad tint`);
    assert.match(c.onAccent, /^#[0-9a-f]{6}$/i, `${c.id}: bad onAccent`);
    assert.ok(c.accentToken.startsWith("--np-"), `${c.id}: accentToken should be an --np-* custom property`);
  }
});

test("every group has at least one button", () => {
  for (const { tab, groups } of [...ALL_SCOPE_TABS, ...CONTEXTUAL_TABS]) {
    for (const g of groups) {
      const count = (g.lg || []).length + (g.cols || []).reduce((n, col) => n + col.length, 0);
      assert.ok(count > 0, `${tab || g.name}/${g.name} has no buttons`);
    }
  }
});

test("every contextForView value names a real contextual tab", () => {
  const ctxIds = new Set(CONTEXTUAL_TABS.map((c) => c.id));
  for (const [view, ctx] of Object.entries(CONTEXT_FOR_VIEW)) {
    assert.ok(ctxIds.has(ctx), `contextForView["${view}"] = "${ctx}" is not a real contextual tab`);
  }
});

test("contextualTabFor resolves a mapped view and returns null for an unmapped one", () => {
  assert.equal(contextualTabFor("raid").id, "raid");
  assert.equal(contextualTabFor("mindmap").id, "whiteboard");
  assert.equal(contextualTabFor("editor"), null);
  assert.equal(contextualTabFor(null), null);
});

test("the editor syntax-highlight toggles (#1051) sit in a group labelled for what they actually affect (#1111)", () => {
  // #1111: the group used to be called plain "Highlight", which read as a
  // whiteboard/Gantt display option -- these are markdown-editor syntax
  // highlighting toggles (see ribbon.js's LABEL_HELP for the tooltips that
  // now say so explicitly).
  const plan = TABS.find((t) => t.id === "plan");
  const group = plan.groups.find((g) =>
    (g.cols || []).some((col) => col.some((b) => b[1] === "Show Durations"))
  );
  assert.ok(group, "no group in the Plan tab contains the highlight-toggle buttons");
  assert.equal(group.name, "Editor Highlighting");
  const labels = (group.cols || []).flat().map((b) => b[1]);
  assert.deepEqual(labels, [
    "Show Durations", "Show Resources", "Show Tags", "Show Comments", "Show Dependencies", "Highlight Preset",
  ]);
});

test("a caret button is always a small (cols) button, never a large one", () => {
  // The design's large buttons are single-purpose (README: lg = 0-2 per
  // group, first in the row) -- caret/gallery behaviour is only specified
  // for the two-row small-button columns.
  for (const { tab, group, kind, tuple } of [...buttonsIn(ALL_SCOPE_TABS), ...buttonsIn(CONTEXTUAL_TABS)]) {
    if (tuple[2] === "caret") assert.equal(kind, "sm", `${tab}/${group}: "${tuple[1]}" is a caret lg button`);
  }
});
