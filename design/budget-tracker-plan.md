# Epic #474: Budget Tracker - Implementation Plan

## Overview

Add a budget tracker to NoodlePlanner that allows users to enter cost items, track spending, and manage project budgets. The budget tracker follows the same patterns as the RAID log: client-side state, markdown table storage in the plan text, slide-out detail form, and Excel export/import.

---

## Data Model

### Budget Item Fields

| Field | Type | UI Control | Notes |
|-------|------|------------|-------|
| ID | Auto-increment | Hidden | Unique identifier |
| Description | Text | Text input | Cost item description |
| Estimate | Number | Number input | Estimated cost |
| Forecast | Number | Number input | Forecasted cost |
| Type | Enum | Dropdown | Capex, Opex, One-off |
| Invoice Number | Text | Text input | Invoice reference |
| PO Number | Text | Text input | Purchase order reference |
| Supplier | Text | Text input | Vendor/supplier name |
| Total | Number | Number input | Actual total spent |
| Date Ordered | Date | Date picker | When ordered |
| Date Received | Date | Date picker | When received |
| Category | Enum | Dropdown | Consultancy, Resource, Travel, Infrastructure, Hardware, Software |

---

## Storage Format

### Markdown Section

Appended to plan text using a `---budget---` marker (same pattern as RAID log):

```markdown
---budget---

| ID | Description | Estimate | Forecast | Type | Invoice | PO | Supplier | Total | Ordered | Received | Category |
|----|-------------|----------|----------|------|---------|-----|----------|-------|---------|----------|----------|
| 1  | Server hosting | 5000 | 4800 | Opex | INV-001 | PO-123 | AWS | 4800 | 2026-01-15 | 2026-01-15 | Infrastructure |
```

### Section Ordering in Plan Text

```
---
front matter
---
tasks...
---highlights---
highlights...
---end-highlights---
---budget---
budget table...
---raid log---
raid table...
```

---

## Implementation Phases

### Phase 1: Core Budget Table & Form (Frontend)

**Files to modify:**
- `packages/noodle-web/src/noodle_web/static/script.js` - Budget state, CRUD, rendering, markdown parse/generate
- `packages/noodle-web/src/noodle_web/templates/index.html` - Budget tab container, form section, navigation
- `packages/noodle-web/src/noodle_web/static/style.css` - Budget-specific styles

**JavaScript additions (script.js):**

1. **Global state:**
   - `let budgetItems = []`
   - `let budgetNextId = 1`
   - `let budgetSortColumn = null`
   - `let budgetSortAsc = true`

2. **Table rendering:** `renderBudgetTable()`
   - Sortable/filterable HTML table from `budgetItems`
   - Filters: Category dropdown, Type dropdown, Supplier text filter
   - Summary row at bottom: totals for Estimate, Forecast, Total columns
   - Monthly columns to the right showing totals per month (based on Date Ordered)
   - Empty state message when no items

3. **Form management:**
   - `openBudgetForm(itemId)` - Opens detail pane with budget form (new or edit)
   - `closeBudgetForm()` - Closes form, returns to table
   - `saveBudgetItemFromForm()` - Validates and saves item to `budgetItems`
   - `deleteBudgetItem(itemId)` - Removes item with confirmation dialog

4. **Markdown serialization:**
   - `generateBudgetMarkdown()` - Converts `budgetItems` array to markdown table
   - `parseBudgetMarkdown(text)` - Parses markdown table to item objects
   - `extractBudgetFromPlanText(planText)` - Finds text between `---budget---` and `---raid log---` (or EOF)

5. **Plan sync:**
   - `syncBudgetToPlanText()` - Updates plan editor text with generated markdown
   - Called after any CRUD operation on budget items

**HTML additions (index.html):**

1. **Navigation:** Add "Budget" to Tracking submenu
   ```html
   <button class="plan-subnav-btn" data-view="budget">Budget</button>
   ```

2. **Tab content container:**
   ```html
   <div id="budget-tab" class="tab-content">
     <div class="budget-toolbar">
       <button onclick="openBudgetForm(null)">+ Add Item</button>
       <select id="budgetCategoryFilter">...</select>
       <select id="budgetTypeFilter">...</select>
       <input id="budgetSupplierFilter" placeholder="Filter supplier...">
     </div>
     <div id="budgetTableContainer"></div>
     <div id="budgetEmptyState" class="empty-state">...</div>
   </div>
   ```

3. **Detail pane form section:**
   ```html
   <div id="budgetFormSection" class="detail-pane-section">
     <!-- Header, form grid with all fields, Save/Cancel/Delete buttons -->
   </div>
   ```

**CSS additions (style.css):**
- Budget table styles (consistent with RAID table)
- Monthly column styling
- Summary row with bold totals
- Budget form grid layout

### Phase 2: Budget Widget in Project Report

**Files to modify:**
- `packages/noodle-web/src/noodle_web/static/script.js` - Report budget widget

**Implementation:**
- Add `updateReportBudget()` function
- Replace the "Notes" placeholder (bottom-right quad) with budget summary
- Display: Budget Forecast total, Spend to Date total, Remaining budget
- Color coding: green if under budget, amber if >80% spent, red if over budget
- Called from `updateReportPage()` after budget items are loaded

### Phase 3: Excel Export/Import

**Files to modify:**
- `packages/noodle-web/src/noodle_web/app.py` - API endpoints
- `packages/noodle-core/src/noodle_core/scheduling_engine.py` - Excel generation with budget worksheet
- `packages/noodle-web/src/noodle_web/static/script.js` - Frontend export/import functions

**Backend endpoints:**
- `POST /api/budget/export-excel` - Export budget items to styled .xlsx
- `POST /api/budget/import-excel` - Import budget items from .xlsx

**Integration with project Excel export:**
- Add "Budget" worksheet to `export_to_excel()` output
- Add budget import support to Excel import flow
- Follow same openpyxl patterns as RAID Excel export

### Phase 4: Markdown Editor Toggle

**Files to modify:**
- `packages/noodle-web/src/noodle_web/static/script.js`
- `packages/noodle-web/src/noodle_web/templates/index.html`

**Implementation:**
- Add collapsible markdown editor panel (same as RAID editor)
- Toggle button in budget toolbar
- Direct editing of budget markdown with live parse/render

---

## Navigation Changes

Add "Budget" to the Tracking view group:

```javascript
// In script.js, update TRACKING_VIEWS constant
const TRACKING_VIEWS = ['raid', 'actions', 'highlights', 'lookahead', 'analysis', 'budget'];
```

Update `switchTab('budget')` routing and subnav highlighting.

---

## Testing Plan

### Unit Tests (test_app.py)

1. **TestBudgetExcelExport:**
   - `test_export_budget_returns_excel` - POST /api/budget/export-excel returns .xlsx
   - `test_export_budget_has_correct_filename` - Content-disposition contains project name
   - `test_export_budget_with_empty_items` - Returns valid empty workbook
   - `test_export_budget_with_items` - Verify items appear in worksheet

2. **TestBudgetExcelImport:**
   - `test_import_budget_returns_items` - POST /api/budget/import-excel parses correctly
   - `test_import_budget_handles_missing_columns` - Graceful handling of incomplete data
   - `test_import_budget_validates_numbers` - Non-numeric amounts handled

3. **Integration with project export:**
   - `test_export_excel_includes_budget_worksheet` - Budget sheet appears in project .xlsx

### Frontend Tests (if applicable)
- Budget markdown parsing/generation round-trip
- Filter logic
- Summary calculations

---

## Documentation Updates

### design/epic.md
Add "Budget Tracker" section documenting:
- Data model and fields
- Markdown storage format
- API endpoints
- Key JavaScript functions
- Report widget integration

### design/database.dbml
No database changes needed (client-side only, like RAID).

### Interface Tour
Update tour if budget is a prominent new feature visible to first-time users.

---

## Estimated Scope

| Phase | Files Changed | Complexity |
|-------|--------------|------------|
| Phase 1: Core table & form | 3 files (script.js, index.html, style.css) | Large - ~500-700 lines JS |
| Phase 2: Report widget | 1 file (script.js) | Small - ~50 lines |
| Phase 3: Excel export/import | 3 files (app.py, scheduling_engine.py, script.js) | Medium - ~200 lines |
| Phase 4: Markdown editor | 2 files (script.js, index.html) | Small - ~100 lines |

**Recommended approach:** Implement as 2-3 separate PRs:
1. PR 1: Phases 1 + 2 (core functionality + report widget)
2. PR 2: Phase 3 (Excel integration)
3. PR 3: Phase 4 (markdown editor toggle)

---

## Key Decisions

1. **Storage location:** Markdown section in plan text (not database) - consistent with RAID
2. **Navigation placement:** Under Tracking menu
3. **Monthly view:** Date columns to the right of the main table, grouped by month
4. **Delete confirmation:** Popup dialog (as specified in issue)
5. **Budget widget:** Replaces "Notes" placeholder in bottom-right quad of Project Report
