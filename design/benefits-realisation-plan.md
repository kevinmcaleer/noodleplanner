# Benefits Realisation Management - Implementation Plan (Issue #614)

## Architecture Decisions

- **Separate `benefits.js` file** — script.js is ~14,700 lines; benefits canvas logic is self-contained like mindmap.js
- **SVG rendering** — consistent with mindmap.js and PBS; supports CSS styling, hit testing, accessibility
- **Left-to-right 4-column layout** — Enablers -> Changes -> Benefits/Disbenefits -> Objectives
- **Markdown table storage** in plan file (like RAID/Budget) — no database tables
- **Detail pane for forms** — consistent with task, RAID, comms, product forms
- **Connections stored as `Linked To` column** in elements table (comma-separated IDs)

## Data Model

```javascript
{
    id: 1,
    type: 'benefit',  // 'objective' | 'enabler' | 'change' | 'benefit' | 'disbenefit'
    title: '',
    description: '',
    objectiveType: '',       // compliance | risk_reduction | productivity | cost_reduction
    targetValue: '',         // e.g. "10% savings per year"
    currentValue: '',
    targetDate: '',
    measurementMethod: '',
    linkedTo: [],            // IDs of connected elements (forward direction)
    contributionPercent: 0,  // % contribution to linked objective
    score: 0                 // calculated score
}
```

## Markdown Storage Format

```markdown
---benefits---
# Benefits Map

| ID | Type | Title | Description | Objective Type | Target Value | Current Value | Target Date | Measurement | Linked To | Contribution % |
|---|---|---|---|---|---|---|---|---|---|---|

## Benefits Tracking

| Benefit ID | Title | Target Value | Current Value | Target Date | Measurement | Status | Last Updated |
|---|---|---|---|---|---|---|---|
```

## Phases

### Phase 1: Data Model, Storage, and Canvas Foundation
- [ ] Add state variables to `state.js` (benefitItems, benefitNextId, benefitConnections, etc.)
- [ ] Create `benefits.js` with SVG canvas, pan/zoom, layout algorithm (reuse mindmap.js patterns)
- [ ] Implement auto-layout: 4 columns (Enablers, Changes, Benefits/Disbenefits, Objectives)
- [ ] Implement node rendering per type (blue rounded rect, yellow ellipse, white rect, red rect)
- [ ] Implement connection rendering (S-curve beziers like mindmap)
- [ ] Add `parseBenefitsMarkdown()` and `generateBenefitsMarkdown()`
- [ ] Add benefits view HTML in `index.html` with toolbar (zoom, add buttons)
- [ ] Register view in script.js, wire into updateAllViews()
- [ ] Add CSS for benefits nodes, connections, toolbar

### Phase 2: Benefits Detail Form and CRUD
- [ ] Add benefits form section in detail pane (Type, Title, Description, etc.)
- [ ] Implement addBenefitItem(), openBenefitForm(), saveBenefitItemFromForm(), deleteBenefitItem()
- [ ] Canvas click/double-click to select/edit nodes
- [ ] Connection creation UI (shift+drag or form "Linked To" field)
- [ ] Sync to plan text after each CRUD operation

### Phase 3: Scoring and Contribution Calculation
- [ ] Implement calculateBenefitScores() — cascade from objectives backward
- [ ] Display scores on nodes (formatted large numbers)
- [ ] Contribution % editing on connections
- [ ] Validation (contributions to each objective sum <= 100%)

### Phase 4: Benefits Tracking Table
- [ ] Add tracking sub-view toggle (canvas vs. tracking table)
- [ ] Tracking table with inline editing (Target, Current, Status, etc.)
- [ ] Parse/generate tracking table in markdown

### Phase 5: Task Linkage
- [ ] Auto-create plan tasks from business change items
- [ ] Rename synchronisation between changes and tasks
- [ ] Visual indicators (icon on tasks, completion % on change nodes)

### Phase 6: Backend Support (noodle-core)
- [ ] Add extract_benefits() and parse_benefits_markdown() to format_converter.py
- [ ] Update ParseResult dataclass and plan_service.py
- [ ] Add tests for parsing and round-trip

### Phase 7: Portfolio Benefits View
- [ ] Create portfolio-benefits.js (aggregate across projects)
- [ ] Add portfolio sub-view with aggregated table
- [ ] Auto-suggest existing benefit names across projects

### Phase 8: Polish, Copy, and Export
- [ ] Copy canvas as PNG to clipboard
- [ ] Excel export (elements + tracking sheets)
- [ ] Keyboard shortcuts (arrows, tab, enter, delete)
- [ ] Dark mode support
- [ ] Responsive design

## Key Files

- `packages/noodle-web/src/noodle_web/static/state.js` — state variables
- `packages/noodle-web/src/noodle_web/static/benefits.js` — NEW, canvas + CRUD
- `packages/noodle-web/src/noodle_web/static/mindmap.js` — reference for SVG patterns
- `packages/noodle-web/src/noodle_web/static/script.js` — view registration, sync
- `packages/noodle-web/src/noodle_web/templates/index.html` — HTML view + form
- `packages/noodle-web/src/noodle_web/static/style.css` — benefits CSS
- `packages/noodle-core/src/noodle_core/format_converter.py` — server-side parsing
- `packages/noodle-core/src/noodle_core/plan_service.py` — API response
