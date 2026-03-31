# Noodle Planner - Epic Documentation

## Overview

Noodle Planner is a project planning tool that converts natural language task descriptions into scheduled project plans with Gantt charts, Kanban boards, and milestone views.

---

## Features

### Core Planning Engine

The scheduling engine (`packages/noodle-core/`) parses natural language task definitions and calculates start/finish dates based on:

- **Duration**: `3d` (days), `2w` (weeks), `1m` (months), `1y` (years)
- **Resources**: `@john @jane`
- **Dependencies**: `#taskname` or `[depends task1 +2d, task2 -1w]`
- **Sequential tasks**: `*Task Name` (starts after previous task)
- **Explicit dates**: `2025-01-15`
- **Progress**: `50%` or `p50`
- **Comments**: `!"note"` or `"note"`
- **Recurrence**: `[repeats daily]`, `[repeats weekly mon,wed,fri]`, `[repeats monthly 3rd thu]`, `[repeats yearly]`

### Web Application

The web application (`packages/noodle-web/`) provides:

- **Editor**: Natural language task input with real-time parsing
- **Milestone View**: Table of summary tasks and zero-duration milestones
- **Gantt View**: Timeline chart with 5 zoom scales (days/weeks/months/quarters/years)
- **Kanban View**: Board with 4 grouping modes (phase/resource/progress/label)
- **Timeline View**: Milestone timeline with optional detailed phase blocks
- **Report View**: Quad dashboard with project header, timeline, milestones, RAID, and highlights
- **2-Week Look-Ahead View**: Focused view of upcoming tasks (next 14 days) and overdue items
- **User Workload View**: Task breakdown by user with workload statistics and filtering
- **Export**: Excel, CSV, PowerPoint, PDF

### CSV Export

The CSV export feature provides a simple tabular export of the project schedule.

**Function:** `export_to_csv()` in `packages/noodle-core/src/noodle_core/scheduling_engine.py` (line 5114)

**API Endpoint:** `POST /render` with `export_csv: true`

**Response:**
- Content-Type: `text/csv`
- Content-Disposition header with `{project_name}.csv` filename

**Columns:** ID, Task Name, Start, Finish, Duration (days), Resources, % Complete, RAG, Priority, Bucket, Comment

### Keyboard Shortcuts

Press `?` to open the keyboard shortcuts modal, which lists all available shortcuts.

**Editor Shortcuts:**
- `Tab` / `Shift+Tab`: Indent/outdent tasks
- `Ctrl+Enter` / `Cmd+Enter`: Render the plan

**Navigation Shortcuts:**
- `1`-`9`: Switch between tabs (Editor, Dashboard, Plan views, etc.)

### Drag and Drop File Loading (Issue #244)

Users can drag and drop `.md` or `.txt` files directly onto the editor panel to load them.

**Behaviour:**
- Visual feedback with drag-over styling on the editor panel
- File contents replace the current editor text
- Plan auto-renders after loading

**Key JavaScript Functions:**
- Editor panel `dragover`, `dragleave`, `drop` event listeners
- Uses `FileReader` API to read dropped file contents

### Top Navigation (Issue #503)

The top navigation bar uses direct-link buttons instead of dropdown menus for the main sections. Each button navigates to a default view and reveals a sub-navigation bar with all related views.

| Button | Default View | Sub-Navigation Views |
|--------|-------------|---------------------|
| Dashboard | Project Report | (shows plan subnav) |
| Portfolio | Portfolio | (no subnav) |
| Project | Project Report (Dashboard) | Dashboard, Tasks, Gantt, Board, Calendar, Milestones, Timeline, Mind Map |
| Tracking | RAID Log | RAID Log, Actions, Highlights, Look-Ahead, Analysis |
| Resources | Resource Table | Resource Table, Timesheet, Workload, Resource Sheet |
| Tools | (dropdown menu) | Text Report, Planning Room, Syntax Guide, Import/Export |

**Key functions:**
- `switchToProject()` -- Navigates to Dashboard with plan subnav, highlights Project tab
- `switchToTracking()` -- Navigates to RAID Log with tracking subnav, highlights Tracking tab
- `switchToResources()` -- Navigates to Resource Table with resources subnav, highlights Resources tab
- `switchToView(viewName)` -- General view switcher that updates nav state and subnav
- `updatePlanSubnav(viewName)` -- Shows/hides the correct subnav group and highlights the active button

**Design notes:**
- Only the Tools menu retains its dropdown; Project, Tracking, and Resources are direct links
- Each section has a persistent sub-navigation bar (`.plan-subnav`) visible when any view in that group is active
- The Dashboard and Project buttons both navigate to the project report, but Dashboard highlights the Dashboard tab while Project highlights the Project tab

### Project Report (Quad Layout)

The Project Report tab displays a dashboard-style overview of the project status in a quad layout (GitHub Issue #145).

**Header Section (full width):**
- Project name (large title)
- Project manager name (from front matter `project manager` / `manager` / `owner`)
- Overall project RAG status (colored badge from front matter `status` field)
- Sponsor and budget (if available in front matter)
- Current date

**Timeline Section (full width):**
- Reuses the existing `updateReportTimeline()` function
- Shows milestone markers on a progress bar with date labels

**Quad Grid (2x2 CSS grid):**

| Position | Section | Content |
|----------|---------|---------|
| Top-left | Milestones | Next 10 incomplete milestones sorted by date. Columns: Milestone, Date, RAG. Skips completed (100%) milestones. Clickable rows open task form. |
| Top-right | Risks & Issues | Open risks and issues from RAID log, sorted by score (highest to lowest), limited to 10. Columns: Type, Title, Score. Uses existing `raidItems` global state. |
| Bottom-left | Latest Highlight | Most recent highlight entry showing date, author, and markdown-rendered content. Uses existing `highlightsData` global state. |
| Bottom-right | Notes | Placeholder reserved for future use. |

**Key Functions:**
- `updateReportPage(tasks, projectName, frontMatter)` - orchestrates all quad sections
- `updateReportMilestones(tasks)` - filters and renders milestone table
- `updateReportRaid()` - filters RAID items and renders risk/issue table
- `updateReportHighlight()` - renders the most recent highlight entry

**Responsive Design:**
- On screens narrower than 768px, the quad grid stacks to a single column

### RAID Log

The RAID Log tab provides tracking for project Risks, Actions, Issues, Decisions, and Dependencies.

**Design Decisions:**
- No database storage — RAID data lives in client-side JavaScript state
- Users download/upload markdown files (`raid.md`) for persistence
- Excel import/export handled server-side via openpyxl
- Score is auto-calculated as Impact × Likelihood (both on a 1-5 scale)

**Columns:**

| Column | Type | Description |
|--------|------|-------------|
| ID | Auto-increment | Unique identifier |
| Type | Enum | risk, action, issue, decision, dependency |
| Title | Text | Brief title |
| Description | Text | Detailed description |
| Raised By | Text | Person who raised the item |
| Owner | Text | Person responsible |
| Mitigation Actions | Text | Steps to mitigate |
| Impact | 1-5 | Severity if item occurs |
| Likelihood | 1-5 | Probability of occurrence |
| Score | Calculated | Impact × Likelihood |
| Status | Enum | open, closed, transferred |

**Markdown Format:**

The RAID log is stored as a standard markdown table in a `raid.md` file:

```markdown
# RAID Log

| ID | Type | Title | Description | Raised By | Owner | Mitigation Actions | Impact | Likelihood | Score | Status |
|----|------|-------|-------------|-----------|-------|--------------------|--------|------------|-------|--------|
| 1  | Risk | ...   | ...         | ...       | ...   | ...                | 3      | 4          | 12    | Open   |
```

**API Endpoints:**
- `POST /api/raid/export-excel` — Export RAID items to styled .xlsx file
- `POST /api/raid/import-excel` — Import RAID items from .xlsx file

**Key JavaScript Functions:**
- `renderRaidTable()` — Renders filtered/sorted table from client state
- `generateRaidMarkdown()` / `parseRaidMarkdown()` — Markdown serialization
- `exportRaidExcel()` / `uploadRaidExcel()` — Excel via backend endpoints
- `openRaidForm()` / `saveRaidItemFromForm()` — Modal form for CRUD

### NoodleSheet - Reusable Spreadsheet Component (Issue #551)

NoodleSheet is a reusable, Excel-like spreadsheet component that stores data in markdown tables with schema defined via DBML.

**Files:**
- `packages/noodle-web/src/noodle_web/static/noodlesheet.js` - Component class
- `packages/noodle-web/src/noodle_web/static/noodlesheet.css` - Styling
- `packages/noodle-web/src/noodle_web/static/noodlesheet-tests.html` - Test suite

**Features:**
- Excel-like cell grid with column headers (A, B, C...) and row numbers
- DBML schema parser for defining columns, types, and enum values
- Markdown table parser/generator (bidirectional, lossless round-trip)
- Inline cell editing with type-appropriate editors (text, number, date, dropdown)
- Formula engine: `=SUM()`, `=COUNT()`, `=AVERAGE()`, cell references, basic arithmetic
- Worksheet tabs (add, switch, rename, delete)
- Keyboard navigation (arrow keys, Tab, Enter, Delete, type-to-edit)
- Context menu (right-click) for row operations
- Toolbar with add/delete row and copy-to-clipboard
- Formula bar showing cell reference and raw value/formula
- Responsive design with horizontal scroll

**DBML Schema Format:**
```dbml
Table budget_items {
  description text
  estimate number
  type enum('Capex','Opex','One-off')
  date_ordered date
}
```

**Usage:**
```javascript
const sheet = new NoodleSheet(containerEl, {
    sheets: [{ name: 'Budget', dbml: '...', markdown: '...' }],
    onChange: (sheetIndex, markdown) => { /* save */ }
});
```

**Public API:**
- `addRow(data)` / `deleteRow(index)` / `setCellValue(row, col, value)`
- `getMarkdown(sheetIndex)` / `loadMarkdown(markdown, sheetIndex)`
- `getRows(sheetIndex)` / `getColumns(sheetIndex)` / `getSheetCount()`
- `addSheet(name, dbml, markdown)` / `deleteSheet(index)` / `renameSheet(index, name)`
- `activateSheet(index)` / `evaluateFormula(formula)`
- `destroy()` - cleanup

**Budget Tracker Integration:**
The budget tab includes a "Spreadsheet" toggle button that switches between the existing form-based table view and the NoodleSheet component. Data syncs bidirectionally via markdown.

### Quality Analyser (Issue #627)

The Quality Analyser enhances the existing **Analysis** view with a set of schedule quality checks derived from the ProjectQA VBA tool methodology. The checks are displayed as a card grid below the health score and insights sections.

**Location:** Analysis view (`switchToView('analysis')`) — under the "Suggested Actions" section.

**Two check categories:**

1. **Information Checks** (blue cards) — counts that describe the plan, not flagged as problems:
   - Check 2: Inbound dependencies (tasks tagged `#inbound` in comment/name)
   - Check 3: Outbound dependencies (tasks tagged `#outbound` in comment/name)
   - Check 4: Remaining tasks (non-summary, completion < 100%)
   - Check 5: Milestones (non-summary tasks with `duration_days === 0`)
   - Check 7: Tasks finishing within the next 8 weeks (not complete)

2. **Issue Checks** (red when count > 0, green when count = 0) — problems that need attention:
   - Check 6: Outbound milestones without predecessors (zero-duration tasks with no `depends`)
   - Check 8: Tasks longer than 5 days finishing within next 8 weeks
   - Check 9: Inbound milestones with no successors (zero-duration tasks nothing depends on)
   - Check 10: Tasks longer than 20 days
   - Check 11: Tasks with no successors (nothing depends on them)
   - Check 12: Tasks with no predecessors (no `depends` entries)
   - Check 13: Tasks with negative float (overdue and not complete)
   - Check 14: Tasks with work in the past (started + finished in past, not complete)
   - Check 15: Tasks with work complete in future (100% but finish date still future)

**Skipped checks:**
- Check 1 (clear issue field): Not applicable — NoodlePlanner has no MS Project "issue field"
- Check 16 (summary tasks with resources assigned): NoodlePlanner allows this by design (resource inheritance)

**Implementation:** Entirely frontend JavaScript, using the `tasks` array from `/api/parse`.

**Key JavaScript functions:**
- `runQualityAnalyserChecks(tasks)` — entry point, computes all checks and renders cards
- `buildSuccessorMap(tasks)` — inverts `depends` to build task → successor list
- `countInboundDependencies(tasks)` — counts tasks tagged `#inbound`
- `countOutboundDependencies(tasks)` — counts tasks tagged `#outbound`
- `countOutboundMilestonesWithoutPredecessors(tasks)` — Check 6 logic
- `countInboundMilestonesWithoutSuccessors(tasks, successorMap)` — Check 9 logic
- `createQaCheckCard(checkNum, count, label, cardType)` — renders a single check card

**CSS classes:**
- `.qa-section` — outer container with border-top separator
- `.qa-grid` — CSS grid with `auto-fill` responsive columns (min 200px)
- `.qa-check-card` / `.qa-info` / `.qa-issue` / `.qa-issue-ok` — card variants
- `.qa-check-badge` / `.qa-badge-info` / `.qa-badge-issue` / `.qa-badge-ok` — status badges

**Data requirements from `/api/parse`:**
- `duration_days` — 0 for milestones
- `depends` — list of predecessor task names
- `start`, `finish` — date strings (YYYY-MM-DD)
- `percent` — completion percentage
- `is_summary` — boolean to exclude summary tasks from checks
- `comment`, `name` — text fields checked for `#inbound` / `#outbound` tags

### Portfolio Views

The Portfolio tab provides cross-project visibility through multiple sub-views:

**Status Dashboard (`portfolio-status.js`):**
- Shows a table of all projects with columns: Project, Status, Progress, RAG, Open Risks, Last Updated, Trend
- RAG status derived from front matter or schedule-based heuristic (overdue tasks)
- **Open Risks count**: filters RAID items where `type` is `risk` or `issue` AND `status` is `open`
- Data sourced from `/api/parse` via `parseAllProjects()` in `multi-plan-loader.js`
- RAID items are parsed independently of tasks in the backend, so they remain available even when task parsing fails (`success: false`)

**Risk Register (`portfolio-risks.js`):**
- Aggregates open risks across all projects into a single table
- Filterable by project and RAG level (High/Medium/Low based on risk score)
- Clicking a risk navigates to the RAID editor for that project and item
- Supports adding new risks from the portfolio view

**Actions Chaser (`portfolio-actions.js`):**
- Shows open actions from RAID logs across all projects
- Filterable by project, owner, and status

**2-Week Look-Ahead (`portfolio-lookahead.js`):**
- Aggregates overdue and upcoming tasks across all projects into a portfolio-level view
- Two sections: Overdue Tasks (past due, not 100% complete) and Upcoming Tasks (starting or finishing within the next 14 days)
- Project name shown as the first column in each table
- Filterable by project using a dropdown
- Summary header shows counts for overdue tasks, upcoming tasks, and number of projects
- Sortable columns (project, task name, dates, days late, percent complete)
- Clicking a task row navigates to the project editor and opens the task details form for that task
- Data sourced from `/api/parse` via `parseAllProjects()` -- only non-summary tasks are included

**Portfolio Timeline (`portfolio-timeline.js`):**
- SVG-based Gantt-style timeline showing all projects as horizontal swimlane rows
- Each project row shows phase bars (summary tasks with start/finish dates) and milestone dots
- Phase bars use blue shades for in-progress, green for complete, with a green progress overlay for partial completion
- Overlapping phases within a project are stacked in separate rows using greedy row assignment
- Date scale header supports months, quarters, and years (user-selectable)
- A vertical red "Today" marker line spans all swimlanes to show the current date
- Clicking a project row opens that project's dashboard
- Alternating row striping (subtle grey background on even rows) improves visual separation
- Task bar height is 28px with 14px font labels for readable phase names
- Milestone dots are 7px radius circles with hover expansion to 9px

**Data Flow for RAID Items in Portfolio Views:**
1. `parseAllProjects()` sends each project's `planText` to `/api/parse`
2. Backend `extract_raid_log()` extracts the `---raid log---` section
3. Backend `parse_raid_markdown()` parses the markdown table into structured items
4. Response includes `raid_items` array regardless of `success` status
5. Frontend portfolio views filter items by type and status for display

**Important:** The RAID log is embedded in the plan text (after the `---raid log---` marker). The backend parser must preserve empty cells in the markdown table to maintain correct column alignment -- otherwise type/status fields can be shifted, causing incorrect filtering.

### Detail Pane (Slide-Out Panel)

Form dialogs for editing tasks, RAID items, project details, and resources use a slide-out detail pane that appears from the right side of the screen, replacing the previous centered modal dialogs. The Excel Import Wizard remains as a centered modal.

**Design Decisions:**
- Single `<div id="detailPane">` container holds all form sections; only one section is visible at a time
- The pane slides in from the right using CSS `transform: translateX()` animation
- A semi-transparent backdrop overlay (`detailPaneOverlay`) sits behind the pane
- On mobile (< 768px), the pane takes full viewport width
- The resource form tracks its origin section so closing it returns to the project details form when opened from there

**Sections:**

| Section ID | Purpose | Open Function | Close Function |
|------------|---------|---------------|----------------|
| `taskFormSection` | Edit task details | `openTaskForm(lineNumber)` | `closeTaskForm()` |
| `raidFormSection` | Edit RAID items | `openRaidForm(itemId)` | `closeRaidForm()` |
| `projectDetailsSection` | Project metadata | `openProjectDetailsForm()` | `closeProjectDetailsForm()` |
| `resourceFormSection` | Add/edit resources | `openResourceForm(shortname)` | `closeResourceForm()` |

**Key JavaScript Functions:**
- `openDetailPane(sectionId)` -- Shows overlay, activates section, slides pane in
- `closeDetailPane()` -- Hides overlay, slides pane out, deactivates sections
- `isDetailPaneOpen()` -- Returns true if the pane is currently visible

**Z-Index Stack:**
- Autocomplete dropdowns: 10001 (above pane)
- Detail pane: 1000
- Detail pane overlay: 999
- Tour overlay: 10000-10002

### Detailed Timeline (Issue #152)

The Timeline view supports a "Detailed" mode that renders phase blocks as rectangular bars above the standard milestone timeline.

**Controls:**
- **Show Phases**: Toggles phase diamond markers on the milestone timeline
- **Detailed**: Toggles detailed phase blocks above the timeline

**Detailed View Features:**
- Rectangular SVG blocks for each phase, positioned by start/finish dates
- Phase title text displayed inside each block (clipped to block width)
- Overlap detection: phases that overlap in time are placed on separate rows
- Colour coding:
  - Completed phases (100%): green (#4caf50)
  - Incomplete phases: blue shades from darker to lighter (#1565c0 to #90caf9)
  - Percent complete shown as a darker overlay on the left portion of the block
- Row height scales so total phase area height does not exceed 20% of timeline width
- Tooltips show phase name and completion percentage

**Key JavaScript Functions:**
- `renderDetailedPhaseBlocks()` — Renders SVG phase blocks above the timeline
- `assignPhaseRows()` — Greedy algorithm to assign phases to rows without overlap
- `darkenColor()` — Utility to darken a hex colour for progress overlays
- `toggleDetailedTimeline()` — Checkbox event handler

### 2-Week Look-Ahead View

The 2-Week Look-Ahead view (GitHub Issue #221) provides a focused snapshot of upcoming work and overdue items.

**Purpose:**
- Help teams focus on immediate priorities
- Highlight tasks that need attention in the next two weeks
- Surface overdue tasks that are blocking progress

**Display Sections:**

1. **Overdue Tasks** (red header):
   - Tasks past their due date with completion < 100%
   - Shows: Task Name, Due Date, Days Late, Resources, %, RAG
   - Days Late calculated from current date, highlighted in red and bold
   - Sorted by due date (earliest first)
   - Hidden if no overdue tasks exist

2. **Upcoming Tasks** (blue header):
   - Tasks starting or finishing within next 14 days
   - Shows: Task Name, Start Date, Due Date, Duration, Resources, %, RAG
   - Sorted by start date (earliest first)
   - Hidden if no upcoming tasks exist

**Empty State:**
- Displays "✅ No overdue or upcoming tasks in the next 2 weeks!" when both sections are empty
- Indicates project is on track or completed

**Interactivity:**
- All task rows are clickable
- Clicking a row opens the task form for editing
- Uses existing `openMilestoneTaskForm()` function

**Key JavaScript Functions:**
- `updateLookAhead(tasks)` — Main function that filters tasks and populates both sections
- `createLookAheadRow(task, type, today)` — Helper to create table rows with appropriate columns
- `getRAGColor(rag)` — Returns color code for RAG status indicators

**Date Calculations:**
- Uses normalized dates (midnight) for accurate comparisons
- 2-week window: current date + 14 days
- Tasks included if start OR finish falls within window
- Summary tasks always excluded

### User Workload View

The User Workload view (GitHub Issue #221) breaks down tasks by assigned user/resource, providing visibility into individual workloads.

**Purpose:**
- Show task distribution across team members
- Identify workload imbalances
- Help managers track individual assignments
- Allow users to view their own task lists

**Features:**

1. **User Filter Dropdown:**
   - "All Users" option shows all users
   - Individual user options (alphabetically sorted)
   - Users automatically extracted from task resources
   - Dropdown updates when plan is rendered

2. **User Sections** (when "All Users" selected):
   - One expandable section per user
   - Purple gradient header with user icon (👤)
   - Statistics bar showing:
     - Tasks: X/Y complete
     - Days: X/Y complete
     - Overall completion percentage

3. **Task Tables:**
   - Shows all tasks assigned to the user
   - Columns: Task Name, Start, Finish, Duration, %, RAG
   - Task names indented based on hierarchy level
   - Monospace font for proper alignment
   - RAG status color-coded

**Workload Statistics:**
- Total tasks assigned
- Completed tasks (100% complete)
- Total days (sum of all task durations)
- Completed days (sum of completed task durations)
- Completion percentage (tasks completed / total tasks)

**Resource Extraction:**
- Parses comma-separated resources from tasks
- Strips @ symbols and allocation percentages
- Summary tasks excluded from workload calculations
- Case-sensitive matching for user names

**Interactivity:**
- Filter dropdown instantly updates the display
- All task rows are clickable
- Clicking a row opens the task form for editing
- Uses existing `openMilestoneTaskForm()` function

**Key JavaScript Functions:**
- `updateUserWorkload(tasks)` — Extracts users and populates dropdown
- `displayUserWorkload(userMap, filterUser)` — Renders user sections and tables
- `filterUserWorkload()` — Dropdown change handler
- `getRAGColor(rag)` — Returns color code for RAG status indicators

**Global State:**
- `window.currentUserMap` — Stores user-to-tasks mapping for filtering
- Persists between filter selections for performance

**Empty States:**
- "No tasks assigned to users" shown when no resources found
- Individual sections hidden if user has no tasks

### Portfolio Report Export (Issue #485)

The Portfolio Report feature exports a multi-slide PowerPoint deck that combines all projects into a single presentation.

**Slide Structure:**

1. **Portfolio Overview Slide** (always first):
   - Dark blue title bar with portfolio name and date
   - Summary counts (total projects, green/amber/red breakdown)
   - Project Status Dashboard table (name, status, progress %, RAG, open risks)
   - Portfolio Timeline with Gantt-style bars showing each project's date range
   - Projects with date ranges show coloured bars (blue for in-progress, green for complete)
   - Partial completion shown as a green overlay on the left portion of the bar

2. **Individual Project Report Slides** (one per project):
   - Same layout as the single-project report export (quad layout)
   - Title bar with project name, PM, sponsor, budget, date, status
   - Timeline graphic (phases and milestones)
   - Milestones table (top-left), Up Next table (top-right)
   - Latest Highlight (bottom-left), Risks and Issues (bottom-right)

**API Endpoint:**
- `POST /api/portfolio/export-pptx` -- Accepts portfolio overview data and individual project report payloads

**Request Payload:**
```json
{
  "portfolio_name": "My Portfolio",
  "date": "2026-02-27",
  "projects": [
    {"name": "Project A", "status": "On Track", "rag": "green", "completion": 50, "risk_count": 2, "start_date": "2026-01-01", "end_date": "2026-06-30"}
  ],
  "project_reports": [
    {"project_name": "Project A", "manager": "John", ...}
  ]
}
```

**Frontend:**
- Export Report button in the Portfolio header three-dot (`...`) dropdown menu
- `exportPortfolioReport()` function in `portfolio-report.js`
- Parses all projects via `/api/parse`, collects report data from parsed results
- `buildProjectReportData()` builds each project's report payload from parsed API data (not DOM)

**Key Functions:**
- `export_portfolio_to_powerpoint(output_path, portfolio_data, project_reports)` -- Core function in scheduling engine
- `_add_portfolio_overview_slide(prs, portfolio_data)` -- Builds the overview slide
- `_add_report_slide(prs, report_data)` -- Shared helper for individual project report slides
- `exportPortfolioReport()` -- Frontend entry point
- `buildProjectReportData(project, tasks, frontMatter, raidItems, reportDate)` -- Builds report data from parsed API results

**Files:**
- `packages/noodle-core/src/noodle_core/scheduling_engine.py` -- Core export functions
- `packages/noodle-web/src/noodle_web/app.py` -- API endpoint
- `packages/noodle-web/src/noodle_web/static/portfolio-report.js` -- Frontend logic
- `packages/noodle-web/src/noodle_web/templates/index.html` -- Export button in portfolio header

### Portfolio UI Enhancement (Issue #487)

The Portfolio page header was consolidated to save vertical space and prioritise the timeline view.

**Layout Changes:**
- The previous two-row layout (header with title/buttons, then separate sub-navigation bar) was merged into a single compact header row
- The "Portfolio" h1 heading was removed -- the page is already identified by the active tab
- The plan selector dropdown, tab buttons (Projects, Status, Resources, Timeline, Actions, Risks), and action buttons all sit on the same row
- The sub-nav tab buttons are now borderless with an underline-style active indicator, taking up less space
- "Import Project" and "Export Report" were moved into a vertical three-dot (`...`) dropdown menu to reduce clutter
- The "+ New Project" button remains visible in the header for quick access
- Overall padding, margins, and font sizes were reduced across the portfolio container, headers, and timeline sections

**Three-dot Menu:**
- `togglePortfolioMoreMenu(event)` and `closePortfolioMoreMenu()` functions in `portfolio.js`
- Menu closes automatically when clicking outside (document click listener)
- `.portfolio-more-menu-wrapper` / `.portfolio-more-menu` CSS classes follow the existing `.export-menu` dropdown pattern

**Files:**
- `packages/noodle-web/src/noodle_web/templates/index.html` -- Restructured portfolio header HTML
- `packages/noodle-web/src/noodle_web/static/style.css` -- Updated portfolio styles (header, subnav, more menu, reduced spacing)
- `packages/noodle-web/src/noodle_web/static/portfolio.js` -- Added toggle/close functions for the more menu

### User Documentation (Issue #632)

NoodlePlanner includes a full user documentation site built with Sphinx and the Read the Docs theme, hosted at `docs.noodleplanner.com`.

**Structure (Diátaxis methodology):**

| Section | Purpose | Location |
|---------|---------|----------|
| Tutorials | Learning-oriented step-by-step guides for beginners | `docs/tutorials/` |
| How-to guides | Task-oriented guides for users who know what they want | `docs/how-to/` |
| Reference | Technical descriptions of syntax, views, exports, shortcuts | `docs/reference/` |
| Explanation | Conceptual discussion (RAG status, scheduling engine) | `docs/explanation/` |

**Pages:**

- `tutorials/getting-started.rst` — first steps from zero to a rendered plan
- `tutorials/first-project.rst` — realistic project plan walkthrough
- `how-to/create-a-project.rst` — project setup guide
- `how-to/use-the-gantt-view.rst` — Gantt view guide
- `how-to/use-the-kanban-board.rst` — Kanban board guide
- `how-to/use-the-raid-log.rst` — RAID log guide
- `how-to/manage-resources.rst` — resource management
- `how-to/export-your-plan.rst` — export formats guide
- `how-to/use-the-portfolio-view.rst` — portfolio guide
- `how-to/use-the-2-week-lookahead.rst` — look-ahead guide
- `how-to/use-the-timeline-view.rst` — timeline guide
- `how-to/import-from-excel.rst` — Excel import guide
- `reference/plan-syntax.rst` — complete syntax reference
- `reference/keyboard-shortcuts.rst` — keyboard shortcut reference
- `reference/views.rst` — all views reference
- `reference/export-formats.rst` — export format specification
- `reference/front-matter.rst` — front matter field reference
- `explanation/rag-status.rst` — RAG status explanation
- `explanation/scheduling-engine.rst` — scheduling algorithm explanation
- `explanation/diataxis.rst` — documentation methodology

**Building the docs:**

```bash
cd docs
uv run --with sphinx --with sphinx-rtd-theme python3 -m sphinx -b html . _build/html
# or:
pip install -r docs/requirements.txt
make html
```

**Navigation link:**

A **Docs** link in the main navigation bar (`index.html`) opens `https://docs.noodleplanner.com` in a new tab.

**Files:**
- `docs/` — Sphinx documentation root
- `docs/conf.py` — Sphinx configuration (RTD theme, extensions)
- `docs/Makefile` — build helper
- `docs/requirements.txt` — `sphinx` and `sphinx-rtd-theme`
- `packages/noodle-web/src/noodle_web/templates/index.html` — Docs nav link added

### CLI Tool

The CLI (`packages/noodle-cli/`) provides command-line access to the planning engine.

---

## Obsidian Plugin

### Overview

The Obsidian plugin (`packages/obsidian-noodle-planner/`) brings NoodlePlanner into Obsidian, allowing users to embed interactive project plans in markdown files using fenced code blocks.

### Usage

Create a plan using a `noodle` code block:

```markdown
```noodle
Project Phase 1
  Task 1 @john 3d
  Task 2 @jane 2d #Task 1
  *Task 3 @john 1d

Project Phase 2
  Task 4 5d
  Task 5 2d
```

### Views

The plugin renders four interactive views:

1. **Milestone View**: Table showing summary tasks and milestones with RAG status
2. **Gantt View**: Timeline chart with draggable bars for adjusting dates/duration
3. **Kanban View**: Board with drag-and-drop cards, 4 grouping modes (phase/resource/progress/label)
4. **Timeline View**: Horizontal progress bar with milestone markers, shows overall project completion

### Bidirectional Sync

When you modify tasks in the views (drag Gantt bars, move Kanban cards), changes are automatically written back to the source markdown.

### Plugin Architecture

```
packages/obsidian-noodle-planner/
├── src/
│   ├── main.ts              # Plugin entry, code block processor
│   ├── types/
│   │   └── task.ts          # NoodleTask interface, settings
│   ├── core/
│   │   ├── parser.ts        # Natural language → task structure
│   │   ├── scheduler.ts     # Scheduling engine
│   │   ├── metadata-extractor.ts  # Parse @resource, #dep, duration
│   │   └── working-days.ts  # Weekend/holiday calculations
│   ├── views/
│   │   ├── base-view.ts     # Abstract base class
│   │   ├── milestone-view.ts
│   │   ├── gantt-view.ts
│   │   ├── kanban-view.ts
│   │   └── timeline-view.ts
│   └── sync/
│       └── source-updater.ts  # Write changes back to markdown
├── styles/
│   └── styles.css           # All view styles
├── manifest.json
└── package.json
```

### Settings

- **Default View**: Choose which view to show by default (Gantt/Kanban/Milestone)
- **Gantt Scale**: Default zoom level (days/weeks/months/quarters/years)
- **Kanban View Mode**: Default grouping (phase/resource/progress/label)
- **Show Weekends**: Display weekend days in Gantt chart
- **Working Days Per Week**: 5/6/7 days

### Commands

- `Insert Noodle Plan Block`: Insert a template code block
- `Switch to Gantt View`: Change default view to Gantt
- `Switch to Kanban View`: Change default view to Kanban
- `Switch to Milestone View`: Change default view to Milestone

### Building

```bash
cd packages/obsidian-noodle-planner
npm install
npm run build
```

For development with hot reload:

```bash
npm run dev
```

### Installation

1. Build the plugin
2. Copy `main.js`, `manifest.json`, and `styles/styles.css` to your Obsidian vault's `.obsidian/plugins/noodle-planner/` directory
3. Enable the plugin in Obsidian settings

---

## Task Syntax Reference

| Syntax | Description | Example |
|--------|-------------|---------|
| `@resource` | Assign resource | `Task @john @jane` |
| `#taskname` | Dependency | `Task #other_task` |
| `[depends ...]` | Dependencies with lag/lead | `[depends task1 +2d, task2 -1w]` |
| `*` | Sequential (after previous) | `*Task Name` |
| `Nd/Nw/Nm/Ny` | Duration | `3d`, `2w`, `1m`, `1y` |
| `N%` | Percent complete | `50%` |
| `YYYY-MM-DD` | Explicit start date | `2025-01-15` |
| `!"text"` | Comment | `!"important note"` |

---

## Architecture

### Data Flow

1. **Input**: Natural language task text
2. **Parser**: `parseNoodleText()` → nested structure
3. **Scheduler**: `scheduleTasks()` → calculated dates
4. **Views**: Render milestone/gantt/kanban
5. **Sync**: View changes → update source

### Key Functions

| Function | File | Purpose |
|----------|------|---------|
| `parseNoodleText()` | `parser.ts` | Parse text to nested structure |
| `scheduleTasks()` | `scheduler.ts` | Calculate start/finish dates |
| `extractMetadata()` | `metadata-extractor.ts` | Parse task line metadata |
| `getNextWorkingDay()` | `working-days.ts` | Skip weekends/holidays |
| `addWorkingDays()` | `working-days.ts` | Calculate finish dates |

---

## UX Standards and Guidelines

### Design Standards Applied

The following standards and heuristics are used to evaluate and guide UI/UX decisions:

1. **WCAG 2.1 AA**: Accessibility compliance
   - Colour contrast: 4.5:1 for normal text, 3:1 for large text
   - Keyboard navigation: all interactive elements must be keyboard accessible
   - Focus indicators: visible focus rings using `focus-visible` (2px solid #108BB9)
   - Screen reader support: ARIA attributes on custom widgets
   - Skip-to-content links for bypass mechanism

2. **Touch Target Sizes** (Apple HIG / Material Design)
   - Minimum 44x44px on mobile devices
   - Adequate spacing between adjacent targets (8px minimum)

3. **Nielsen's Usability Heuristics**
   - Visibility of system status (loading states, save confirmation)
   - Match between system and real world (clear labels, familiar patterns)
   - User control and freedom (undo, cancel, escape to close)
   - Consistency and standards (uniform button sizing, colour usage)
   - Error prevention (form validation, confirmation for destructive actions)
   - Recognition rather than recall (visible navigation, clear affordances)

4. **Responsive Design**
   - Mobile-first approach with breakpoints at 480px, 768px, 1024px
   - Forms stack to single column below 768px
   - Navigation adapts for touch on mobile
   - Detail pane uses `min(600px, 90vw)` for responsive width

### CSS Architecture

- **Form grid classes**: `.form-grid-2col`, `.form-grid-3col` for responsive form layouts
- **No inline styles for layout**: Use CSS classes that can be overridden by media queries
- **Focus indicator**: Global `*:focus-visible` rule with `outline: 2px solid #108BB9`
- **Touch targets**: Mobile override at 768px ensures minimum 44x44px
- **Reduced motion**: `@media (prefers-reduced-motion: reduce)` for animation-sensitive users

### Related GitHub Issues

- #514: Form layouts break on mobile due to inline grid styles
- #515: Focus indicators removed with outline:none
- #516: Missing ARIA attributes and semantic HTML
- #517: Touch targets too small on mobile
- #518: No keyboard navigation for modals/dropdowns
- #519: Colour contrast issues
- #520: No loading states or feedback for async operations
- #521: Missing tablet breakpoint (1024px)
- #522: Inline styles should be moved to CSS classes
- #523: Detail pane width not responsive
- #525: Inconsistent button styling and sizing
- #526: No skip-to-content link or landmark regions
- #527: Navigation overflow on mobile
### UI Embellishments (Issue #510)

Visual polish and accessibility improvements across the interface.

**Colour Palette**

CSS custom properties define a consistent palette available application-wide:

| Token                | Hex       | Usage                      |
|----------------------|-----------|----------------------------|
| `--np-red`           | `#c21d1d` | Alerts, risk indicators    |
| `--np-orange`        | `#ff7b01` | Warnings, task ribbons     |
| `--np-yellow`        | `#ffd641` | Highlights                 |
| `--np-green`         | `#1c9e41` | Success, on-track items    |
| `--np-blue`          | `#108bb9` | Primary accent, links      |
| `--np-light-grey`    | `#dbdbdb` | Borders, dividers          |
| `--np-dark-blue`     | `#02384d` | Headers, dark backgrounds  |

Each colour has a `-subtle` variant (e.g. `--np-blue-subtle: #d0eaf5`) for use as light backgrounds in ribbon banners and highlighted sections.

**Ribbon Banners**

Flat-style vertical hanging ribbons with a notched pointed tip. Applied sparingly beside key page titles using the `.ribbon-banner` class with colour modifiers (e.g. `.ribbon-banner--blue`). Built entirely with CSS pseudo-elements -- no extra images required.

**Page-load Animations**

Elements with the `.np-fade-in` class fade in and slide up when they become visible. Animation timing uses `--np-anim-duration` (0.4s) and `--np-anim-easing`. Staggered delays are available via `.np-fade-in-delay-1` through `.np-fade-in-delay-4`.

**Disabling Animations**

Animations can be disabled in three ways:
1. **OS preference**: The `prefers-reduced-motion: reduce` media query is respected automatically.
2. **Front matter toggle**: Adding `animations: false` to the plan's YAML front matter applies the `.no-animations` class to `<body>`, disabling all CSS animations and transitions.
3. **Programmatic**: Any code can add/remove `document.body.classList.add('no-animations')`.

**Keyboard Shortcuts**

Pressing the `?` key (outside of text inputs) opens a modal listing all keyboard shortcuts. Shortcuts include:

| Shortcut           | Action                |
|--------------------|-----------------------|
| `?`                | Show shortcuts help   |
| `Esc`              | Close modal / menu    |
| `g` then `d`       | Go to Dashboard       |
| `g` then `t`       | Go to Tasks           |
| `g` then `g`       | Go to Gantt           |
| `g` then `c`       | Go to Calendar        |
| `g` then `b`       | Go to Board (Kanban)  |
| `g` then `l`       | Go to Timeline        |
| `Cmd+]` / `Ctrl+]` | Indent line (editor)  |
| `Cmd+[` / `Ctrl+[` | Outdent line (editor) |

**Accessibility**

- Navigation dropdown menus have ARIA attributes (`role="menu"`, `aria-haspopup`, `aria-expanded`, `aria-controls`, `role="menuitem"`).
- Menu items are keyboard-navigable with Arrow Up/Down, Enter to select, and Escape to close.
- Focus-visible outlines are styled for keyboard users on tabs, menu items, and sub-navigation buttons.
- The `aria-expanded` state is synced automatically via a MutationObserver when menus open or close.
### Security Hardening (Issue #235)

Security middleware and configuration to protect the NoodlePlanner web application in production deployments.

**Security Headers:**
All responses include the following headers via `SecurityHeadersMiddleware`:

| Header | Value | Purpose |
|--------|-------|---------|
| `X-Frame-Options` | `DENY` | Prevents clickjacking by blocking iframe embedding |
| `X-Content-Type-Options` | `nosniff` | Prevents MIME-type sniffing attacks |
| `X-XSS-Protection` | `1; mode=block` | Enables browser XSS filtering |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Enforces HTTPS connections |
| `Content-Security-Policy` | (configured for self + CDN) | Controls resource loading sources |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limits referrer information leakage |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | Disables unnecessary browser APIs |

**Rate Limiting:**
- In-memory per-IP rate limiting via `RateLimitMiddleware`
- Configurable via `RATE_LIMIT_REQUESTS` (default: 100) and `RATE_LIMIT_WINDOW` (default: 60 seconds)
- Returns HTTP 429 with `Retry-After` header when limit is exceeded
- Each IP address has an independent request counter

**CORS Configuration:**
- `CORS_ORIGINS` environment variable (comma-separated list of allowed origins)
- Defaults to `["*"]` when not set (development convenience)
- Example production config: `CORS_ORIGINS=https://app.example.com,https://staging.example.com`

**Request Body Size Limit:**
- `BodySizeLimitMiddleware` rejects requests with `Content-Length` exceeding `MAX_BODY_SIZE`
- Configurable via `MAX_BODY_SIZE` environment variable (default: 10 MB)
- Returns HTTP 413 when exceeded

**Error Message Sanitization:**
- `ENVIRONMENT` environment variable controls error detail level (`development` or `production`)
- In production: generic error messages returned to clients; full details logged server-side
- In development: full error details included in responses for debugging
- `ErrorSanitizationMiddleware` catches unhandled exceptions
- `_sanitized_detail()` helper used by all endpoint error handlers

**API Key Authentication:**
- Optional authentication via `APIKeyAuthMiddleware`
- Controlled by `API_KEY` environment variable
- When `API_KEY` is set: requires `Authorization: Bearer <key>` header on all requests
- When `API_KEY` is empty/unset: all requests allowed (current default behaviour)
- Public paths always accessible without auth: `/health`, `/healthz`, `/favicon.png`, `/logo.png`, `/static/*`

**File Upload Validation:**
- All upload endpoints validate file extension (`.xlsx`, `.xls` only for Excel endpoints)
- File size checked against `MAX_FILE_SIZE` environment variable (default: 1 MB)
- Content-Type verification on upload endpoints

**Environment Variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `ENVIRONMENT` | `development` | Set to `production` for sanitized errors |
| `API_KEY` | (empty) | When set, requires Bearer token auth |
| `CORS_ORIGINS` | (empty = `*`) | Comma-separated allowed CORS origins |
| `RATE_LIMIT_REQUESTS` | `100` | Max requests per window per IP |
| `RATE_LIMIT_WINDOW` | `60` | Rate limit window in seconds |
| `MAX_BODY_SIZE` | `10485760` | Max request body size in bytes (10 MB) |
| `MAX_FILE_SIZE` | `1048576` | Max uploaded file size in bytes (1 MB) |

**Middleware Stack (applied outermost to innermost):**
1. `APIKeyAuthMiddleware` -- authentication gate
2. `ErrorSanitizationMiddleware` -- exception catching
3. `RateLimitMiddleware` -- request throttling
4. `BodySizeLimitMiddleware` -- payload size check
5. `SecurityHeadersMiddleware` -- response header injection
6. `CORSMiddleware` -- cross-origin request handling
7. `ActivityLoggingMiddleware` -- request logging

**Files:**
- `packages/noodle-web/src/noodle_web/security.py` -- All security middleware and helpers
- `packages/noodle-web/src/noodle_web/app.py` -- Middleware registration and error sanitization
- `tests/test_security.py` -- Comprehensive tests (42 tests)
---

## Docker

### Overview

The application is containerized using Docker for deployment. The Dockerfile is optimized for fast development rebuild cycles by ordering layers from least to most frequently changed.

### Layer Strategy

The build uses five layers ordered by change frequency:

| Layer | Contents | Changes When |
|-------|----------|--------------|
| 1 - System deps | `gcc`, `curl`, apt packages | Rarely (new system-level library needed) |
| 2 - uv installer | uv package manager | Rarely (uv version update) |
| 3 - Dependencies | `pyproject.toml` + `uv.lock` files, `uv sync` | Dependencies added/removed/updated |
| 4 - App source | Python source, templates, tests, alembic | Any code change (most common) |
| 5 - Runtime config | `.env`, non-root user, EXPOSE | Rarely |

### Key Optimizations

- **Dependency caching**: Only `pyproject.toml` and `uv.lock` files are copied before `uv sync`. Minimal package stubs are created so uv can resolve workspace members without the full source tree. This means code-only changes skip the expensive dependency install entirely.
- **Cache mounts**: `--mount=type=cache,target=/root/.cache/uv` persists the uv download cache across builds. Even when the dependency layer is invalidated (e.g., a new package is added), previously downloaded packages are reused from the cache mount.
- **Selective package copying**: Only `noodle-core`, `noodle-web`, and `noodle-cli` packages are copied. `noodle-ios` and `obsidian-noodle-planner` are excluded since they are not needed at runtime.
- **No manual CACHEBUST**: The layer ordering handles cache invalidation naturally. Code changes only invalidate layers 4-5, not the dependency install.

### .dockerignore

The `.dockerignore` excludes non-runtime files from the build context: Python cache files, test artifacts, IDE config, git history, documentation, iOS/Obsidian packages, and OS metadata files. This reduces the context size sent to the Docker daemon and prevents unnecessary cache invalidation.

### Development Workflow

```bash
# Build and start (deps cached when only code changes)
docker compose up --build

# Rebuild from scratch (e.g., after Dockerfile changes)
docker compose build --no-cache

# Development mode: mount packages as a volume for live code changes
# (already configured in docker-compose.yml)
docker compose up
```

### docker-compose.yml

The compose file configures:
- Port mapping: `8007:8007`
- Environment variables: `HOST`, `PORT`, `MAX_FILE_SIZE`, `RELOAD`, `DATABASE_URL`, `ENABLE_ACTIVITY_LOGGING`
- Volume mount: `./packages:/app/packages` for live code reloading during development
- Health check: HTTP probe on `/health` endpoint
- Restart policy: `unless-stopped`

### Files

- `Dockerfile` -- Multi-layer build optimized for development
- `docker-compose.yml` -- Service configuration
- `.dockerignore` -- Build context exclusions
- `.env.example` -- Template for environment variables
### Keyboard Shortcuts (#511)

Global keyboard shortcuts provide quick access to common actions without using the mouse. Shortcuts are disabled when the user is typing in a text input, textarea, or contenteditable element.

**Navigation**

| Shortcut | Action |
|----------|--------|
| `Alt+D` | Go to Project Dashboard |
| `Alt+P` | Go to Portfolio |

**Create Items**

| Shortcut | Action |
|----------|--------|
| `Alt+N` | New Project (opens create project dialog) |
| `Alt+T` | New Task (appends task line and opens task form) |
| `Alt+R` | New Risk (opens RAID form with type set to Risk) |
| `Alt+I` | New Issue (opens RAID form with type set to Issue) |
| `Alt+Shift+R` | New Resource (opens resource form) |

**Export**

| Shortcut | Action |
|----------|--------|
| `Alt+E` | Export project to Excel |
| `Alt+Shift+P` | Export portfolio report to PowerPoint |

**General**

| Shortcut | Action |
|----------|--------|
| `?` | Show keyboard shortcuts help modal |
| `Esc` | Close open panel, modal, or autocomplete dropdown |

#### Implementation Details

- **Input guard**: The `isTypingInInput()` function checks if the focused element is a text input, textarea, or contenteditable element. Shortcuts are suppressed in these contexts to avoid interfering with typing.
- **Help modal**: A `keyboardShortcutsOverlay` modal in `index.html` lists all available shortcuts. Triggered by pressing `?` or accessible from the UI.
- **Helper functions**:
  - `showKeyboardShortcuts()` / `closeKeyboardShortcuts()` - toggle the help modal
  - `openRaidFormWithType(type)` - opens a new RAID form pre-set to a specific type
  - `addNewTaskViaShortcut()` - appends a new task line to the editor and opens the task form for editing
- **Event listener**: A single `keydown` listener on `document` handles all Alt-based shortcuts, routing to the appropriate existing functions (`switchToView`, `switchTab`, `showCreateProjectDialog`, `exportFile`, `exportPortfolioReport`, `openResourceForm`).
### Stakeholder Interest/Influence Grid (Issue #509)

The Stakeholders view provides a way to track project stakeholders with their interest and influence levels, displayed alongside an Interest/Influence grid.

**Navigation:**
- Accessible via the Plan dropdown menu (Plan > Stakeholders)
- Also available in the Plan sub-navigation bar
- Part of the PLAN_VIEWS group, mapped to the Plan tab

**Data Storage:**
Stakeholders are stored in the plan's YAML front matter under `Key Stakeholders:`:
```yaml
---
title: My Project
Key Stakeholders:
- @CEO: Chief Executive Officer, interest:high, influence:high
- @PM: Project Manager, interest:high, influence:low
- @User: End User, interest:low, influence:low
---
```

Each entry follows the format: `- @Name: Role, interest:high|low, influence:high|low`

**Layout:**
- Left side: Table of stakeholders with Name, Role, Interest, Influence columns
- Right side: SVG Interest/Influence grid (400x400 viewBox, maintains square aspect ratio)
- Responsive: Stacks vertically on screens narrower than 900px

**Interest/Influence Grid Quadrants:**
| | Low Interest | High Interest |
|---|---|---|
| **High Influence** | Watch | Manage |
| **Low Influence** | Monitor | Keep Informed |

Each quadrant has a subtle background colour and label. Stakeholders appear as coloured dots with name labels, positioned in their respective quadrant.

**CRUD Operations:**
- `addStakeholder()` - Opens the detail pane form to create a new stakeholder
- `openStakeholderForm(id)` - Opens the form pre-populated for editing
- `saveStakeholderFromForm()` - Saves the form data and syncs to front matter
- `deleteStakeholder(id)` - Removes a stakeholder after confirmation
- `closeStakeholderForm()` - Closes the detail pane

**Parsing and Sync:**
- `parseStakeholdersFromFrontMatter(str)` - Parses the Key Stakeholders YAML section
- `parseStakeholderEntry(entry)` - Parses a single `@Name: Role, interest:X, influence:Y` line
- `syncStakeholdersToFrontMatter()` - Writes stakeholder state back to the plan editor
- `updateFrontMatterStakeholders(planText, items)` - Updates the front matter text
- `generateStakeholdersFrontMatterSection(items)` - Generates the YAML section string
- `loadStakeholdersFromPlanText()` - Loads stakeholders when the plan is parsed

**Copy to Clipboard:**
- Uses the existing `copyElementAsImage()` function with html2canvas
- Captures the grid wrapper as a PNG image

**Lifecycle:**
- Stakeholders are loaded from front matter when the plan is parsed (in `updateViews`)
- Stakeholders are cleared when switching plans (via `clearPlanTrackingData`)
- The grid is rendered on demand when switching to the stakeholders view

**Global State:**
- `stakeholderItems[]` - Array of stakeholder objects `{id, name, role, interest, influence}`
- `stakeholderNextId` - Auto-incrementing ID counter

**Tests:**
- 54 tests in `tests/test_stakeholders.py` covering:
  - Navigation elements (3 tests)
  - View container elements (11 tests)
  - Form elements (8 tests)
  - JavaScript functions (19 tests)
  - CSS classes (11 tests)
  - SVG grid properties (2 tests)
### Baseline Plan (Issue #504)

The baseline plan feature allows users to capture a snapshot of the current schedule for later comparison. Only one baseline is kept at a time.

**Storage Format:**

The baseline is stored as a `---baseline---` section at the bottom of the plan text (after the RAID log section), containing a markdown table with the following columns:

```
---baseline---
| Task Name | Start      | Finish     | Duration |
|-----------|------------|------------|----------|
| Task 1    | 2026-03-02 | 2026-03-05 | 3d       |
| Task 2    | 2026-03-05 | 2026-03-10 | 5d       |
```

**Section ordering in plan text:** Tasks -> Highlights -> RAID Log -> Baseline

**Backend (Python):**

| Function | File | Purpose |
|----------|------|---------|
| `extract_baseline()` | `format_converter.py` | Extract baseline section text from plan |
| `strip_baseline()` | `format_converter.py` | Remove baseline section from plan text |
| `parse_baseline_markdown()` | `format_converter.py` | Parse baseline markdown table to list of dicts |
| `generate_baseline_text()` | `format_converter.py` | Generate aligned markdown table from baseline items |
| `update_plan_baseline()` | `format_converter.py` | Update plan text with new baseline data |

The `/api/parse` endpoint returns `baseline_items` in its response alongside tasks, highlights, and RAID items.

**Frontend (JavaScript):**

| Function | Purpose |
|----------|---------|
| `setBaseline()` | Capture current schedule as baseline |
| `clearBaseline()` | Remove baseline from plan |
| `loadBaselineFromData()` | Load baseline items from API response |
| `extractBaselineFromPlanText()` | Client-side fallback for baseline extraction |
| `parseBaselineMarkdown()` | Parse baseline markdown table in JS |
| `generateBaselineTable()` | Generate markdown table from baseline items |
| `syncBaselineToPlanText()` | Write baseline to plan editor text |
| `updatePlanBaselineText()` | Update plan text with baseline section |
| `renderBaselineBar()` | Render semi-transparent baseline bar in Gantt chart |
| `toggleBaselineDisplay()` | Toggle baseline visibility in Gantt |
| `toggleMilestonesBaselineDisplay()` | Toggle baseline columns in Milestones |

**UI Controls:**

- **Set Baseline button**: Located in the Gantt toolbar, captures the current schedule
- **Show Baseline toggle (Gantt)**: Shows/hides semi-transparent baseline bars behind current bars
- **Show Baseline toggle (Milestones)**: Shows/hides BL Start, BL Finish, and Variance columns

**Gantt Chart Baseline Rendering:**

- Baseline bars are rendered as semi-transparent grey bars (dashed border) positioned below the current task bars
- Baseline milestones are rendered as smaller, semi-transparent diamonds below current milestone diamonds
- Baseline bars are non-interactive (pointer-events: none)

**Milestone Table Baseline Columns:**

When the baseline toggle is active, three additional columns appear after Finish:
- **BL Start**: Baseline start date
- **BL Finish**: Baseline finish date
- **Variance**: Days difference between current and baseline finish (color-coded: red for late, green for early, grey for on-track, italic "New" for tasks not in baseline)

**Section Interactions:**

- `extract_raid_log()` stops at `---baseline---` to avoid including baseline data in RAID items
- `strip_raid_log()` preserves the baseline section
- `update_plan_raid_log()` preserves the baseline section when updating RAID items
- `update_plan_highlights()` preserves the baseline section when updating highlights
- `convert_plan_format_to_standard()` strips the baseline section before task parsing

## Task Context Menu (Issue #507)

### Overview

A three-dot (`...`) context menu on every task row in both the Tasks table and the Gantt chart info panel. The menu provides quick access to common task operations without needing to double-click cells or use keyboard shortcuts.

### Menu Actions

| Action | Description |
|--------|-------------|
| **Edit** | Opens the task detail form in the editor pane (calls `openMilestoneTaskForm`) |
| **Promote (Outdent)** | Removes 2 leading spaces from the task line, moving it up one hierarchy level |
| **Demote (Indent)** | Adds 2 leading spaces to the task line, making it a subtask of the previous task |
| **Insert Task Above** | Inserts a new task line above the current task with matching indentation, then opens the editor form |
| **Assign Resource** | Shows a prompt to enter or change the task's resource assignment |
| **Set Completion** | Submenu with 0%, 25%, 50%, 75%, 100% options to quickly set task progress |

### Implementation Details

- **Shared component**: Both the Tasks table and Gantt chart use the same `createTaskContextButton()` function
- **Positioning**: Menu appears as a fixed-position overlay near the clicked button, with viewport boundary detection
- **Close behavior**: Menu closes when clicking outside, or after selecting an action
- **Editor sync**: All actions modify the plan editor text and trigger `renderText()` to keep views in sync
- **CSS**: Styles follow the portfolio more-menu pattern (`.task-context-menu`, `.task-context-menu-item`)

### Key Functions

| Function | File | Purpose |
|----------|------|---------|
| `showTaskContextMenu()` | `script.js` | Display the context menu near the clicked button |
| `closeTaskContextMenu()` | `script.js` | Remove the context menu from the DOM |
| `createTaskContextButton()` | `script.js` | Create the `...` button element for a task row |
| `createCompletionSubmenu()` | `script.js` | Build the Set Completion submenu with percentage options |
| `promoteTask()` | `script.js` | Remove 2 spaces of indentation from a task line |
| `demoteTask()` | `script.js` | Add 2 spaces of indentation to a task line |
| `insertTaskAbove()` | `script.js` | Insert a blank task line above the target task |
| `assignResourceToTask()` | `script.js` | Prompt for and apply a resource assignment |
| `setTaskCompletion()` | `script.js` | Set a task's completion percentage |
| `findTaskLineNumber()` | `script.js` | Look up a task's line number in the editor by name |

---

## Dark Mode (Issue #595)

### Overview
Noodle Planner supports light and dark colour themes, toggled via a button in the main navigation bar. The preference can also be stored in the plan front matter so that a project always opens in the author's preferred mode.

### Theme Options
- **Light** (default): Standard light colour scheme
- **Dark**: Dark background with light text, reduced eye strain in low-light environments
- **System**: Follows the browser/OS `prefers-color-scheme` setting automatically

### How It Works

1. **CSS Variable Architecture**: `dark-mode.css` defines semantic colour tokens (e.g. `--np-bg`, `--np-text`, `--np-surface`) on `:root` for light mode and overrides them under `[data-theme="dark"]` for dark mode. All UI components reference these tokens.

2. **Toggle Button**: A sun/moon icon button is placed in the top navigation bar with a dropdown menu offering Light, Dark, and System options. The button meets the 44x44px minimum touch target, has `aria-label`, `aria-haspopup`, and full keyboard navigation (ArrowUp/Down, Enter, Escape).

3. **Persistence**: The chosen theme is saved to `localStorage` under the key `np-theme-choice`. A FOUC-prevention inline script in `<head>` applies the saved theme before the page renders.

4. **Front Matter Sync**: When the user changes theme, it writes `theme: light|dark|system` into the plan's YAML front matter. When a plan is parsed, the theme value from front matter is read and applied. This means each project can have its own theme preference.

5. **System Mode**: When set to "System", the app listens to `matchMedia('(prefers-color-scheme: dark)')` change events and updates in real time when the OS theme changes.

### Files
| File | Purpose |
|------|---------|
| `static/dark-mode.css` | Semantic colour tokens, dark theme overrides, toggle button and menu styles |
| `static/theme.js` | Theme initialisation, toggle logic, localStorage persistence, front matter sync, keyboard navigation |
| `templates/index.html` | Theme toggle button in nav bar, FOUC-prevention script, CSS/JS loading |
| `static/script.js` | Calls `applyThemeFromFrontMatter()` during `updateAllViews()` |
| `tests/test_dark_mode.py` | 26 tests covering assets, accessibility, front matter parsing, CSS tokens, and JS functions |

---

## Recurring Tasks (Issue #629)

### Overview

Tasks can be set to repeat at a regular frequency. Recurrence is stored inline in the task's markdown using `[repeats ...]` syntax — no database changes required.

### Syntax

| Example | Meaning |
|---------|---------|
| `[repeats daily]` | Repeats every day |
| `[repeats weekly]` | Repeats every day of the week |
| `[repeats weekly mon,wed,fri]` | Repeats every Monday, Wednesday, and Friday |
| `[repeats monthly 3rd thu]` | Repeats on the 3rd Thursday of each month |
| `[repeats monthly 1st mon]` | Repeats on the 1st Monday of each month |
| `[repeats yearly]` | Repeats annually on the same month/day as the task start date |

### How It Works

1. **Markdown storage**: Recurrence is stored inline in the task line alongside other metadata: `standup 1d @alice [repeats weekly mon,wed,fri]`

2. **Backend parsing**: `extract_metadata()` in `scheduling_engine.py` detects `[repeats ...]` and calls `parse_recurrence()` to build a structured dict. This is returned as the `recurrence` key on the task object and included in the `/api/parse` response.

3. **Frontend form**: The task details form has a "Recurrence" dropdown. Selecting "weekly" or "monthly" reveals sub-options (day checkboxes or ordinal+day selectors). `populateRecurrenceForm()` reads the recurrence string from the parsed task; `buildRecurrenceString()` builds it back from the form state on save.

4. **Look-ahead and up-next views**: `generateRecurrenceOccurrences()` in `script.js` generates virtual occurrence dates for recurring tasks within the 14-day look-ahead window. These appear in:
   - The 2-Week Look-Ahead view (overdue and upcoming tables)
   - The Report page "Up Next" widget
   Recurring task rows show a `[Recurring label]` badge in the task name column.

### Functions

| Function | Location | Purpose |
|----------|----------|---------|
| `parse_recurrence(s)` | `scheduling_engine.py` | Parse recurrence string into structured dict |
| `generate_recurrence_occurrences(task, start, end)` | `scheduling_engine.py` | Generate occurrence dates in a window (Python) |
| `populateRecurrenceForm(str)` | `script.js` | Populate task form recurrence fields from string |
| `buildRecurrenceString()` | `script.js` | Build recurrence string from form state |
| `onRecurrenceFrequencyChange()` | `script.js` | Show/hide sub-options on frequency change |
| `formatRecurrenceLabel(str)` | `script.js` | Human-readable label e.g. "Weekly: Mon, Wed, Fri" |
| `generateRecurrenceOccurrences(task, start, end)` | `script.js` | Generate virtual occurrences (JS, for views) |

### Files Changed

| File | Change |
|------|--------|
| `packages/noodle-core/src/noodle_core/scheduling_engine.py` | Added `parse_recurrence()`, `generate_recurrence_occurrences()`, recurrence extraction in `extract_metadata()` |
| `packages/noodle-core/src/noodle_core/__init__.py` | Exported new functions |
| `packages/noodle-web/src/noodle_web/plan_service.py` | Included `recurrence` in task data dict |
| `packages/noodle-web/src/noodle_web/templates/index.html` | Recurrence form UI in task details pane |
| `packages/noodle-web/src/noodle_web/static/script.js` | Recurrence parsing, form population, occurrence generation, look-ahead integration |
| `packages/noodle-web/src/noodle_web/static/views-tables.js` | Recurring tasks in "Up Next" report widget |
| `packages/noodle-web/src/noodle_web/static/components.css` | Styles for day-picker and recurrence badge |
| `tests/test_recurrence.py` | 31 tests covering parsing, generation, and metadata extraction |

---

### Programme Dependencies (Issue #630)

Allows users to specify dependencies between projects at the programme level — linking a task or milestone in one project to a task in another.

#### How it Works

1. **Dependency Storage**: Programme dependencies are stored in browser `localStorage` under the key `noodleplanner_programme_deps`. Each dependency is an object with:
   - `id`: unique identifier (`dep-{timestamp}-{random}`)
   - `from_project_id`: source project localStorage key
   - `from_task_name`: source task or milestone name (matched case-insensitively)
   - `to_project_id`: dependent project localStorage key
   - `to_task_name`: dependent task name
   - `lag_days`: integer; positive = wait N days after source finishes; negative = can start N days before
   - `notes`: optional free text

2. **RAG Calculation**: The server endpoint `POST /api/programme-dependencies/propagate` accepts all project task data + dependency definitions. For each dependency it:
   - Looks up the source task finish date
   - Calculates `required_start = source_finish + lag_days`
   - Compares with the dependent task's actual start date
   - Returns **RED** if the dependency constraint is violated (dependent starts before required_start)
   - Returns **RED** if dependent task is overdue (finish date passed, < 100% complete)
   - Returns **AMBER** if source has finished but dependent hasn't started
   - Returns **GREEN** if constraint satisfied
   - Returns **GREY** if tasks cannot be found or have missing dates

3. **Overall Programme RAG**: Worst-case across all dependency RAGs (red > amber > green > grey).

4. **Portfolio Dependencies View**: A dedicated "Dependencies" sub-tab in the Portfolio section. Users can:
   - View all programme dependencies as a table with RAG circles
   - Add new dependencies via a modal dialog (with task name autocomplete from the selected project's plan)
   - Edit or delete existing dependencies

5. **Timeline Arrows**: When the Portfolio Timeline view is rendered, `drawDependencyArrows()` overlays an SVG layer on the swimlane chart. Each dependency is drawn as a vertical connector line from the source task's finish date on its project row to the dependent task's row, coloured by RAG status:
   - Dashed red line = dependency violated
   - Dashed amber line = dependency at risk
   - Solid green line = satisfied

#### API

**`POST /api/programme-dependencies/propagate`**

Request body:
```json
{
  "dependencies": [
    {
      "id": "dep-xxx",
      "from_project_id": "project-xxx",
      "from_task_name": "Phase 1 Complete",
      "to_project_id": "project-yyy",
      "to_task_name": "Integration Testing",
      "lag_days": 2,
      "notes": "Must wait 2 days for env setup"
    }
  ],
  "projects": [
    {
      "project_id": "project-xxx",
      "project_name": "Backend API",
      "tasks": [
        { "name": "Phase 1 Complete", "start": "2026-03-01", "finish": "2026-03-15", "percent": 100, "duration_days": 0, "is_summary": false }
      ]
    }
  ]
}
```

Response:
```json
{
  "results": [
    {
      "dependency_id": "dep-xxx",
      "rag": "green",
      "reason": "Dependency satisfied; task starts 2026-03-17",
      "propagated_start": "2026-03-17",
      "from_task": { ... },
      "to_task": { ... }
    }
  ],
  "overall_rag": "green",
  "dependency_count": 1
}
```

#### Files

| File | Purpose |
|------|---------|
| `static/portfolio-dependencies.js` | LocalStorage CRUD, API call, render dependencies table, arrow drawing |
| `static/portfolio-timeline.js` | Enhanced to call `drawDependencyArrows()` after timeline render |
| `static/portfolio.js` | Added `dependencies` case to `switchPortfolioView()` |
| `static/views/portfolio.css` | Styles for `.dep-table`, `.dep-rag-circle`, `.programme-deps-view` |
| `templates/index.html` | Dependencies sub-nav button and `portfolioDependenciesView` div |
| `packages/noodle-web/src/noodle_web/app.py` | `POST /api/programme-dependencies/propagate` endpoint + helpers |
| `tests/test_programme_dependencies.py` | 21 tests covering helper functions and API endpoint |

---

### Agentic AI Capabilities (Issue #679)

NoodlePlanner supports AI-powered project management agents via a BYOK (Bring Your Own Key) architecture. Users configure their own AI provider (OpenAI, Anthropic, Ollama, or a custom endpoint) in the browser, and the backend proxies requests without storing API keys.

#### Architecture

- **BYOK model**: API keys stored in browser `localStorage`, sent per-request, never persisted server-side.
- **OpenAI-compatible interface**: All providers are accessed through an OpenAI-compatible chat completion format, with automatic translation for Anthropic's native format.
- **FastAPI proxy**: The backend (`ai_service.py`) proxies requests via `httpx`, adding provider-specific headers and payload translation.
- **Server-side agent templates**: Nine specialised agents defined as `agent.yml` + `system-prompt.md` files, loaded at runtime.
- **SSE streaming**: Responses stream token-by-token via Server-Sent Events.
- **No database changes**: All configuration in `localStorage`, all chat state in-memory.

#### Providers

| Provider | Endpoint | Key Required | Notes |
|----------|----------|:---:|-------|
| OpenAI | `https://api.openai.com/v1` | Yes | Default: `gpt-4o` |
| Anthropic | `https://api.anthropic.com/v1` | Yes | Default: `claude-sonnet-4-20250514`. Payload translated to Anthropic format. |
| Ollama | `http://localhost:11434/v1` | No | Must run on same machine as server. Default: `llama3`. |
| Custom | User-defined | Varies | Any OpenAI-compatible endpoint. |

#### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/ai/chat` | Proxy chat completion (SSE streaming response) |
| `POST` | `/api/ai/test` | Test provider connectivity |
| `GET` | `/api/ai/agents` | List all 9 agent metadata entries |
| `GET` | `/api/ai/agents/{id}` | Get agent metadata + system prompt |

#### Agents

Nine built-in agents, each with a system prompt that receives `{{plan_markdown}}`:

| ID | Name | Category |
|----|------|----------|
| `planning-agent` | Planning Agent | planning |
| `risk-manager` | Risk Manager | tracking |
| `reporting-analyst` | Reporting Analyst | reporting |
| `benefits-manager` | Benefits Realisation Manager | tracking |
| `stakeholder-engagement` | Stakeholder Engagement | planning |
| `accountant` | Accountant | tracking |
| `resource-manager` | Resource Manager | resources |
| `pm-assistant` | PM Assistant | planning |
| `meeting-actions` | Meeting Actions | reporting |

#### Frontend

- **AI Settings Modal**: Provider selection (radio buttons), endpoint, API key (toggleable visibility), model, test button.
- **Chat Panel**: Slide-in from right, agent chips at top, streaming markdown display, Ctrl+Shift+A toggle.
- **Visibility gating**: AI features hidden until a provider is configured and enabled.
- **Plan context injection**: Current plan text injected into agent prompt (truncated at 100 KB).

#### Files

| File | Purpose |
|------|---------|
| `ai_service.py` | Backend proxy: payload builders, headers, SSE streaming, connection test, agent discovery |
| `static/ai-config.js` | Provider presets, localStorage read/write, settings modal, test connection UI |
| `static/ai-chat.js` | Chat panel open/close, agent selection, message send/stream, markdown render |
| `static/ai-chat.css` | Chat panel, message bubbles, agent chips, typing indicator styles |
| `agents/*/agent.yml` | Agent metadata (name, description, icon, category, order) |
| `agents/*/system-prompt.md` | Agent system prompt with `{{plan_markdown}}` placeholder |
| `tests/test_ai_service.py` | 76 tests: models, payloads, headers, URLs, tokens, SSE, agents, connection, security, validation |
