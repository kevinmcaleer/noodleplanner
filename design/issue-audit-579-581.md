# Issue Audit: #558–#581 Refactoring Issues

**Date:** 2026-03-09
**Context:** Many of these issues were implemented on worktree branches that became stale during a messy rebase/merge. Some were re-implemented fresh, others survived, and some were lost.

---

## Properly implemented and working (keep closed)

| Issue | Title | Status |
|-------|-------|--------|
| **#558** | NAV-1: Portfolio vs Project contexts | Re-implemented fresh, working |
| **#559** | NAV-2: NavigationController | Re-implemented fresh, working |
| **#560** | NAV-3: setActiveNavTab() helper | Re-implemented fresh, working |
| **#561** | NAV-4: Project breadcrumb | Re-implemented fresh, working |
| **#568** | BE-1: export_to_file() helper | In PlanService, working |
| **#570** | BE-3: PlanService layer | Working (679 lines, 14 methods) |
| **#573** | CSS-3: Animation variables | `--np-anim-*` vars defined and used |
| **#574** | TEST-1: Coverage baseline | Report exists (79.47%) |
| **#579** | UX-1: Move Tools into Project | Re-implemented fresh, pushed |

## In main but NOT actually working — should reopen

| Issue | Title | Problem |
|-------|-------|---------|
| **#571** | CSS-1: Split style.css | Modular files exist but HTML loads only `style.css` — split was reverted because it broke EVM and lookahead styles |
| **#572** | CSS-2: Responsive breakpoints | Uses `max-width` (desktop-first), not `min-width` (mobile-first) as intended. Also CSS source-order bugs caused kanban/editor layout regressions |

## In main but code was lost/overwritten — should reopen

| Issue | Title | Problem |
|-------|-------|---------|
| **#563** | JS-2: updateLineField() tokeniser | Function not found in any JS file |
| **#564** | JS-3: buildTableRows() helper | Function not found in any JS file |
| **#569** | BE-2: FrontMatterParser class | No class exists, uses standalone `parse_front_matter()` functions instead |
| **#581** | UX-3: Context transitions | No transition code found in JS or CSS |

## Partially implemented — needs assessment

| Issue | Title | Status |
|-------|-------|--------|
| **#562** | JS-1: Split script.js | Module files exist (nav.js, kanban.js, editor.js, etc.) but script.js is still ~12.5K lines — split was incomplete |
| **#565** | JS-4: PlanState object | state.js exists with global variables, but no PlanState class was created |
| **#566** | JS-5: Break setupEditor() | editor.js extracted as module, unclear if setupEditor() was fully decomposed into focused functions |
| **#567** | JS-6: Break updateAllViews() | Per-view files exist (views-tables.js, views-timeline.js), unclear if updateAllViews() was fully decomposed |
| **#580** | UX-2: Portfolio/Project Resources | portfolio-resources.js exists with dedicated functions |

## Never started — remain open

| Issue | Title |
|-------|-------|
| **#575** | TEST-2: Add unit tests for editor line sync functions |
| **#576** | TEST-3: Add unit tests for NavigationController |
| **#577** | TEST-4: Add integration tests for export endpoints |
| **#578** | TEST-5: Add unit tests for FrontMatterParser |

---

## Recommendations

1. **Reopen:** #563, #564, #569, #571, #572, #581 — these need re-implementation from scratch on current main
2. **Verify then close or reopen:** #562, #565, #566, #567, #580 — check if partial implementations are sufficient or need completion
3. **Keep open:** #575–#578 — test issues not yet started
4. **Clean up stale worktree branches** — there are 26+ worktree branches from old agent runs that can be deleted
