# Noodle Planner - Epic Documentation

## Overview

Noodle Planner is a project planning tool that converts natural language task descriptions into scheduled project plans with Gantt charts, Kanban boards, and milestone views.

---

## Features

### Core Planning Engine

The scheduling engine (`packages/noodle-core/`) parses natural language task definitions and calculates start/finish dates based on:

- **Duration**: `3d` (days), `2w` (weeks), `1m` (months)
- **Resources**: `@john @jane`
- **Dependencies**: `#taskname` or `[depends task1 +2d, task2 -1w]`
- **Sequential tasks**: `*Task Name` (starts after previous task)
- **Explicit dates**: `2025-01-15`
- **Progress**: `50%` or `p50`
- **Comments**: `!"note"` or `"note"`

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
- **Export**: Excel, PowerPoint, PDF

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
| `Nd/Nw/Nm` | Duration | `3d`, `2w`, `1m` |
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
