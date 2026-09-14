# NoodlePlanner — UI Inventory

Map of every screen, panel and dialog in the app, and the components on each.
Companion to `noodleplanner-design-system.md`.

**Status:** scaffold — not yet filled in.

> **How to use this.** Two passes. Pass 1: name every screen and state, no detail.
> Stop when the list stops growing — that's the point of the exercise. Pass 2: go back
> through and tag components against each screen, building the tally in section 3.
> Do Pass 1 in one sitting, even roughly, before starting Pass 2.
>
> Scaffold headings below are a starting guess. Delete anything that doesn't exist,
> add anything missing. **Only list what is actually built** — planned features go in
> section 4.

---

## 1. Pass 1 — Screen map

### Chrome (persistent UI)

<!-- The shell that wraps everything: ribbon, breadcrumb, status bar, etc. -->

- Ribbon —
- Breadcrumb —
- Backstage —

### Project-level views

#### Home 
- Dashboard —
- Markdown view —
- Gantt View -
- Outline View -
- Timeline View -
- Calendar View -
- Tasks View
- Mind Map view —
- Board / Kanban view —
- Product breakdown structure —
- Product flow diagram —
- Product checklist / deliverables —
- RAID view
- Actions view
- Highlights
- Lookahead
- Escalations

#### Plan
Structure
  - Tasks View
  - PBS view
Gantt
  - Calendars (view not built yet; needed to add, modify and delete custom calendars)
  - Products (links to the PBS view)
  - Durations (not implemented)
  - Critical Path (enables critical path view on the gantt view)
  - Baseline (dialog box for adding, clearing baselines)
Products
  - Products
  - Product Flow 
  - Deliverables
Model
  - Mindmap
  - Whitboard
  - Timeline

#### Track
RAID
  - Raid
Progress
  - Highlights View
  - Actions
  - lookahead
  - Analysis
  - Lessons
Budget
  - Budget view
  - EVM
  - Forecast 
Benefits
  - Benefits
  - Releasiation
    - Map View
    - Tracking 

#### Resources
People
  - Resources
  - Stakeholders
  - Calendars (needs building out)
Effort
  - Timesheet
  - Workload
  - Level
  - Overallocation
  - Resource Sheet
  - Clear level (removes levelling)
Comms
  - Comms Plan
  - Influence
  - Print
Report
  - Project Report (Dashboard view)
  - Highlights
  - Analysis
  - Milestones
  - Budget
  - Benefits
Share
  - Export (action: exports the current file, dropdown list; Excel, CSV,PDF, PowerPoint, MS Project .mpp) 
  - Print
  - PDF (action exports to PDF)
  - Excel (exports to Excel
  - Exports to PowerPoint
Data
  - Import (Dropdown list; Plan file (.md), Excel, MS Project)
  - Save
  - Sync

### View
Layout
  - Editor (shows or hides the Markdown editor panel)
  - Milestones
Window
  - Settings
  - Darkmode (toggles it on or off)
  - System Theme (changes the light/dark to follow the current system theme)
  - AI settings (pops open the AI dialog box)
Help
  - Syntax Guide
  - Docs (opens docs.noodleplanner.com site)

### Programme
  - not implemented yet

### Portfolio-level views

### Portfolio view
#### Home
Portfolio
  - Status
  - Projects
  - New Project
  - Import Projects
Report
  - Export Report
  - Actions

#### Plan
Schedule
  - Timeline
  - Look-ahead
  - Dependencies
Capacity
  - Team Allocation
  - Level Team

#### Track

RAID & Benefits
  - Risks
  - Benefits
  - Lessons

#### Portfolio Tools
Portfolio
  - Add Programme
  - Add Project
  - Weighting
  - Rebaseline
  - Snapshot
Analyse
  - Head Map (not implemented)
  - Dependencies
  - Capacity (shows team allocation view)
  - Status
  - Benefits


### Slide-out panels

<!-- Every drawer. Note which side it comes from and whether it has the gradient header. -->

- Task details Form —
- Task Inspector - 
- Resource Details form
- RAID Item Details form

- Settings - App settings panel
- Details - Project Details

### Dialogs / modals

<!-- Everything that appears over a screen: confirms, pickers, alerts, imports. -->

-

### Empty / loading / error states

<!-- Easy to forget, but they need components too. -->

-

---

## 2. Pass 2 — Components per screen

<!-- For each screen above, list the components on it. Add to the tally in section 3
     as you go. First sighting = new row. Every sighting after = increment. -->

| Screen | Components |
| --- | --- |
| Dashboard | Markdown editor |
| Dashboard | Report dashboard |
| Report Dashboard | Title |
| Report Dashboard | Label and value (project manager, sponsor, budget, date |
| Report Dashboard | Status badge |
| Report Dashboard | horizonal line |
| Report Dashboard | Timeline Component |
| Report Dashboard | Task completion widget |
| Report Dashboard | Milestones widget |
| Report Dashboard | Up Next widget |
| Report Dashboard | Latest Highlight |
| Report Dashboard | Risks & Issues Widget |
| Report Dashboard | Budget Summary | 
| Report Dashboard | Open Actions |
| Report Dashboard | Footer |
| Footer | Project Switcher |
| Footer | Status Bar |
| Footer | Notifications icon |
| Footer | Version |
| Footer | Plan Version number |
| Footer | Settings Button |
| Footer | Details Button |  
| Gantt View | Timeline (Minimal variant) |
| Gantt View | Gantt Chart header - title, label & dropdown (scale), checkboxes & labels (Show dependencies, cricial path, show baseline), Buttons (set baseline, Manage baselines)|
| Gantt View | Gantt Chart - table & calendar with task bars |


---

## 3. Component tally → build order

<!-- The deduplicated list. Sort by count descending when Pass 2 is done — that
     ordering IS the Storybook build order. -->

| Component | Screens | Count | Canonical version chosen | Story built |
| --- | --- | --- | --- | --- |
| Button |  |  | ☐ | ☐ |
| Panel (drawer) |  |  | ☐ | ☐ |
| Panel header |  |  | ☐ | ☐ |
| Input / field |  |  | ☐ | ☐ |
| Card |  |  | ☐ | ☐ |

---

## 4. Not yet built

<!-- Planned but non-existent screens. Keep them out of the inventory proper so the
     count stays honest — the inventory measures what needs migrating, not what's coming. -->

-

---

## 5. Open questions

<!-- Things spotted during the passes that need a decision — near-duplicate components,
     one-offs that might not deserve to be components, anything that doesn't fit. -->

-
