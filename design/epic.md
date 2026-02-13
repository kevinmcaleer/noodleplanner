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
- **Timeline View**: Compact ASCII timeline
- **Report View**: Formatted markdown output
- **Export**: Excel, PowerPoint, PDF

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
