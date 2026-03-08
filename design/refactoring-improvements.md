# NoodlePlanner: Refactoring Improvements

> Review date: 2026-03-08
> Scope: Full codebase — frontend (script.js, style.css, index.html), backend (app.py), tests

---

## 1. Navigation — The Core Architectural Problem

The current navigation has **three overlapping layers** that fight each other:

- **Layer 1 — Top tabs:** Dashboard, Portfolio, Plan, Tracking, Resources, Tools
- **Layer 2 — Editor sub-views:** Report, Tasks, Gantt, Calendar, Timeline, Milestones, Mindmap, Stakeholders
- **Layer 3 — Portfolio sub-nav:** Projects, Status, Resources, Timeline, Actions, Risks, Lookahead

### What's Confusing

- "Dashboard" is actually a *project* report — it does not belong at top-level next to Portfolio
- "Resources" appears as both a top-level nav tab *and* a Portfolio sub-view
- "Tracking" (RAID/Actions/Budget) is a dropdown, but those are project-level tools
- "Plan" is a dropdown spawning 8 sub-views, making it feel like a second app inside the first

**The mental model mismatch:** Users see Portfolio vs "everything else" — but the nav presents Dashboard, Portfolio, Plan, Tracking, Resources, Tools as peers. This creates constant confusion about "where am I?" and "is this a portfolio thing or a project thing?"

### Proposed Navigation Model

```
Top level:   [Portfolio]  [Project ▼]
                               ├── Plan (editor + output views)
                               ├── Gantt / Kanban / Calendar / Timeline
                               ├── Tracking (RAID, Actions, Budget)
                               └── Resources / Milestones / Stakeholders

Portfolio sub-nav:   Projects | Status | Resources | Timeline | Risks | Actions | Lookahead
```

The mental model becomes clear: you are either in portfolio context or project context. The current "Dashboard" tab becomes the project Report/Summary view.

---

## 2. script.js: God Object (18,596 lines, 475 functions)

This is the single biggest barrier to future improvement. Every change risks side effects because there are no module boundaries. The portfolio feature already demonstrates the right approach — it is split across 9 separate files (`portfolio.js`, `portfolio-status.js`, `portfolio-resources.js`, etc.). The rest of the app should follow this model.

### 2.1 Navigation Functions Have Overlapping Responsibilities

Four functions exist for navigation with unclear distinctions:

- `switchTab(tabName)` — activates top-level tab panes
- `switchToView(viewName)` — calls `switchTab('editor')` then `switchOutputTab()` then manages nav state
- `switchToProject()` — calls `switchToView('project-report')` then overrides nav active state again
- `switchToTracking()`, `switchToResources()` — wrappers around the above, each re-implementing the same `querySelectorAll('.tabs .tab').forEach(...)` pattern

That active-state reset appears in at least 5 different functions. Adding a new nav button requires updating all of them.

### 2.2 Editor Line Synchronisation Duplicated 6+ Times

Every editable field (%, start date, end date, predecessors, bucket, task name) has its own find-line → tokenize → update → rebuild implementation:

- `syncGanttEditToEditor()`
- `syncGanttPercentToEditor()`
- `syncGanttPredecessorsToEditor()`
- `updateStartDateInLine()`
- `updateFinishDateInLine()`
- `updatePercentInLine()`

All follow the same pattern with subtle differences. A bug fix in one is rarely applied to the others.

### 2.3 Table Rendering Duplicated 6+ Times

`updateMilestonesTable()`, `updateTasksTable()`, `updateTimesheet()`, `updateAnalysis()`, and others all do:

1. Get tbody element
2. Clear `innerHTML`
3. Loop through data
4. Create cells with `classList.add()`
5. Attach event listeners

Any improvement must be made in every copy.

### 2.4 State is 30+ Unrelated Global Variables

```javascript
let selectedFile = null           // line ~1
let renderTimeout = null          // line ~2
let globalResourceMap = {}        // line ~4
let lastRenderedTasks = []        // line ~8
let timelineTasks = []            // line ~3322
let detailedTimelineEnabled = false
// ... 25+ more
```

No ownership, no validation, no documentation of which functions read or write each variable. State mutations are untraceable.

### 2.5 Functions With Too Many Responsibilities

- `setupEditor()` (~400 lines): syntax highlighting, line numbers, cursor tracking, 10+ event listeners, debounce management
- `updateAllViews()` (~295 lines): 18+ separate state updates, no transaction/rollback
- `render()`: API call, file download, error fallback, 4 export formats — all in one function

---

## 3. app.py: Repeated Patterns (1,723 lines)

### 3.1 Temporary File Export Pattern Repeated 8+ Times

```python
tmp_path = None
try:
    with tempfile.NamedTemporaryFile(...) as tmp:
        tmp_path = tmp.name
    export_function(...)
    with open(tmp_path, 'rb') as f:
        content = f.read()
finally:
    if tmp_path and os.path.exists(tmp_path):
        os.unlink(tmp_path)
```

Every export format (Excel, CSV, PPT, PDF) duplicates this block with no shared helper.

### 3.2 Front Matter Parsing in 3 Different Locations

- Line ~595: extract highlights, RAID, baseline
- Line ~615: extract title
- Line ~635: parse key-value pairs

Each uses a different parsing strategy. There is no single `FrontMatterParser`.

### 3.3 Routes Contain Business Logic

`render_plan()` (156 lines) does: parsing, scheduling, transformation, export, and HTTP response handling. Routes should be thin HTTP adapters delegating to a service layer.

---

## 4. CSS: Single 12,000+ Line File

- No modularisation — all styles in one `style.css`
- Inconsistent breakpoint usage (CLAUDE.md requires 480px, 768px, 1024px)
- Inconsistent mobile-first vs desktop-first approach
- Animation variables defined (`--np-anim-duration`) but applied inconsistently

---

## 5. Test Coverage Gaps

- No tests for Gantt chart DOM rendering
- No tests for timeline view rendering
- No tests for tab switching logic
- No tests for editor synchronisation (the most complex feature)
- No tests for RAID/Budget UI item management
- Unclear whether 80% coverage target (from CLAUDE.md) is currently met

---

## 6. User Experience Gaps

- No "current project" context indicator in the nav when in portfolio mode — users lose track of which project they were editing
- "Tools" (Planning Room, Syntax Guide) should be inside the Project context, not top-level — they are project-specific
- "Resources" appears in both Portfolio and Project contexts with potentially different data, with no clear distinction
- Switching to Portfolio does not clearly communicate that you have left the project context

---

## 7. What's Working Well

- The portfolio module split is the right pattern — follow it everywhere
- CSS custom properties for the design system are well-defined
- Backend middleware stack is clean and well-organised
- Test coverage for backend parsing and scheduling is substantive
- The YAML-based plan format is innovative and the core parsing engine is solid

---

## Remediation Actions

Actions are ordered by impact. Earlier actions unlock later ones.

### Priority 1 — Navigation (User-visible, high impact)

- [ ] **NAV-1** Redesign the top-level nav to two contexts: Portfolio and Project. Remove "Dashboard" as a top-level tab; make it the default view within Project. Move Tracking and Resources inside the Project context.
- [ ] **NAV-2** Consolidate `switchTab()`, `switchToView()`, `switchToProject()`, `switchToTracking()`, `switchToResources()` into a single `NavigationController` with a view registry. Each view registers `{ activate, deactivate }` hooks. `switchToView()` becomes a 3-line function.
- [ ] **NAV-3** Extract the repeated active-state reset (`querySelectorAll('.tabs .tab').forEach(...)`) into one shared `setActiveNavTab(tabId)` function.
- [ ] **NAV-4** Add a visible "current project" breadcrumb or indicator in the nav so users always know which project they are editing.

### Priority 2 — script.js Modularisation

- [ ] **JS-1** Split script.js into domain files following the portfolio pattern. Suggested split:
  - `editor.js` — editor setup, syntax highlighting, line numbers
  - `editor-sync.js` — all line tokenise/update/rebuild logic
  - `views-gantt.js` — Gantt chart rendering and drag interactions
  - `views-timeline.js` — Timeline rendering
  - `views-tables.js` — Milestones, Tasks, Resources, Timesheet table rendering
  - `state.js` — centralised state object
  - `nav.js` — navigation controller
- [ ] **JS-2** Create a generic `updateLineField(line, fieldName, value)` tokeniser function to replace the 6 near-identical editor sync functions.
- [ ] **JS-3** Create a generic `buildTableRows(tbody, data, columnDefs)` helper to replace the 6 near-identical table-building blocks.
- [ ] **JS-4** Introduce a `PlanState` object to replace the 30+ global variables. Document which functions read and write each field. Add validation on mutation.
- [ ] **JS-5** Break `setupEditor()` into focused functions: `initSyntaxHighlighting()`, `initLineNumbers()`, `initEditorEventListeners()`.
- [ ] **JS-6** Break `updateAllViews()` into independently callable view update functions so individual views can be refreshed without triggering a full re-render.

### Priority 3 — Backend Service Layer

- [ ] **BE-1** Extract a `export_to_file(export_fn, *args, suffix, media_type)` helper to replace the 8 copies of the temp-file try/finally pattern.
- [ ] **BE-2** Create a `FrontMatterParser` class with methods `parse_title()`, `parse_highlights()`, `parse_raid()`, `parse_key_values()`. Replace the 3 scattered parsing locations with calls to this class.
- [ ] **BE-3** Separate business logic from routes. Create a `PlanService` with methods `render()`, `parse()`, `export()`. Routes become thin HTTP adapters.

### Priority 4 — CSS

- [ ] **CSS-1** Split `style.css` into component files: `base.css`, `layout.css`, `components.css`, `views/gantt.css`, `views/timeline.css`, `views/portfolio.css`, `animations.css`, `responsive.css`.
- [ ] **CSS-2** Audit all breakpoints and standardise to 480px, 768px, 1024px as required by CLAUDE.md. Convert to consistent mobile-first approach.
- [ ] **CSS-3** Audit animation usage — ensure `--np-anim-duration` and `--np-anim-easing` are applied consistently wherever transitions are used.

### Priority 5 — Tests

- [ ] **TEST-1** Run coverage report and identify files below 80% threshold.
- [ ] **TEST-2** Add tests for editor sync functions (once extracted in JS-2) — these are the highest-risk code paths.
- [ ] **TEST-3** Add tests for the navigation controller (once extracted in NAV-2).
- [ ] **TEST-4** Add integration tests for each export format end-to-end.
- [ ] **TEST-5** Add tests for `FrontMatterParser` (once extracted in BE-2).

### Priority 6 — UX Polish

- [x] **UX-1** Move "Tools" (Planning Room, Syntax Guide) inside the Project context dropdown. Remove from top-level nav.
- [ ] **UX-2** Add clear visual distinction between Portfolio Resources view and Project Resources view to avoid data confusion.
- [ ] **UX-3** Add a loading/transition state when switching between Portfolio and Project contexts so the mode change is unambiguous.
