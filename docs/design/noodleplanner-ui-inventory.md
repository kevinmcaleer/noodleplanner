# NoodlePlanner — UI Inventory

Map of every screen, panel and dialog in the app, and the components on each.
Companion to [`design-system.md`](design-system.md), which this fulfils as
the UI inventory's pass 2 (§5).

**Status:** Pass 1 complete, Pass 2 complete (audited 14 Sep 2026 against
`templates/index.html` and the `static/*.js` render modules).

> **How to use this.** Two passes. Pass 1: name every screen and state, no detail.
> Stop when the list stops growing — that's the point of the exercise. Pass 2: go back
> through and tag components against each screen, building the tally in section 3.
> Do Pass 1 in one sitting, even roughly, before starting Pass 2.
>
> Scaffold headings below are a starting guess. Delete anything that doesn't exist,
> add anything missing. **Only list what is actually built** — planned features go in
> section 4.

**How the audit was done.** Every `*-view` / `*-tab` / `*View` container in
`templates/index.html` was walked as a DOM tree, and every render module in
`static/` was scanned for the class names it emits. So section 2 lists what the
markup actually contains, not what the nav implies. Views whose body is built
entirely in JS (all ten portfolio views, the programme view, the canvases) were
read from their render module instead of the template.

---

## 1. Pass 1 — Screen map

### Chrome (persistent UI)

<!-- The shell that wraps everything: ribbon, breadcrumb, status bar, etc. -->

- Ribbon — `#ribbonShell`, built by `ribbon.js` / `ribbon-layout.js` / `ribbon-ia.js`
- Breadcrumb — ribbon breadcrumb rungs (`.ribbon-breadcrumb-rung`); the Board has its own (`#kanbanBreadcrumb`)
- Backstage — `#backstage-tab`, file rail + Recent / Templates main views
- Plan subnav — `#planSubnav`, the Dashboard + Views/Deliverables/Tracking/Resources/Tools dropdowns
- Status bar (the "footer") — project switcher, RAG lamp, live message, notification bell, version, Settings, Details
- Session chat — `#collabChatPanel`, only present while hosting a live session
- AI chat — `#aiChatPanel` + `#aiChatOverlay`
- Toasts — `.progress-toast` (success / error / progress variants)
- Task peek — `.task-peek` popover, raised from the whiteboard and outline

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
  - Programme view — `#programme-tab`. Landing header, SRO/vision/outcomes,
    stat tiles, key milestones, escalated risks, dependencies, resourcing,
    benefits realisation, member projects. (Ribbon IA for it is not built yet.)

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


### Other shells

<!-- Full-width surfaces that aren't a project view or the portfolio. -->

- Plan Editor — `#editor-tab`, the editor pane + splitter + output pane that hosts every project view
- Search — `#search-tab`, full-project search
- Upload — `#upload-tab`, drag-and-drop plan import
- Syntax Guide — `#guide-tab`

### Slide-out panels

<!-- Every drawer. Note which side it comes from and whether it has the gradient header. -->

All of these are sections of the one right-hand `#detailPane` drawer (`.detail-pane`),
shown one at a time over `.detail-pane-overlay`. Three use `.detail-pane-header`
(Task details, Product details, Task Inspector); the other thirteen use
`.modal-header` borrowed from the dialog shell — see section 5.

- Task details Form — `#taskFormSection`
- Task Inspector - `#taskInspectorSection`
- Resource Details form — `#resourceFormSection`
- RAID Item Details form — `#raidFormSection`

- Settings - App settings panel — `#settingsSection`, tabbed
- Details - Project Details — `#projectDetailsSection`
- Product Details — `#productFormSection`
- Stakeholder — `#stakeholderFormSection`
- Action — `#actionFormSection`
- Highlight — `#highlightFormSection`
- Budget item — `#budgetFormSection`
- Comms item — `#commsFormSection`
- Lesson learned — `#lessonsFormSection`
- Benefit item — `#benefitsFormSection`
- Version History — `#versionHistorySection`
- Conditional formatting — `#conditionalFormattingSection`

Drawers that are *not* part of `#detailPane`:

- Front matter panel — `#frontMatterPanel`, top of the editor pane
- Back matter panel — `#backMatterPanel`, bottom of the editor pane
- Whiteboard plan structure — `.wb-outline-panel`
- Whiteboard parking lot — `.wb-parking-lot-panel`
- Board editor panel — `#kanbanEditorPanel`, collapsible markdown editor beside the board
- RAID markdown editor — `#raidEditorSection`, collapsible under the RAID table
- Budget markdown editor — `#budgetEditorSection`, collapsible under the budget table

### Dialogs / modals

<!-- Everything that appears over a screen: confirms, pickers, alerts, imports. -->

All share one shell: `.modal-overlay` > `.task-form-modal` > `.modal-header` + `.modal-body`.

Declared in the template:

- Manage baselines — `#baselineDialogOverlay`
- Import Excel File — `#excelWizardOverlay`
- Project Templates — `#templatesModalOverlay` (own shell: `.templates-modal`)
- AI Settings — `#aiSettingsOverlay`
- Trend report — `#trendReportOverlay`
- Sync RAID with Excel — `#raidSyncOverlay`
- Sync MS Project Schedule — `#mspSyncOverlay`
- Status Message Log — `#statusLogOverlay`
- Keyboard Shortcuts — `#keyboardShortcutsOverlay` **and** `#shortcutsOverlay` (two of them, see section 5)
- Planning session — `#collabSessionOverlay`
- Delete confirms — `#raidDeleteConfirmOverlay`, `#budgetDeleteConfirmOverlay`,
  `#commsDeleteConfirmOverlay`, `#lessonsDeleteConfirmOverlay`
- Tour — `#tourOverlay`

Built at runtime in JS:

- Plan wizard — `plan-wizard.js`, 3 steps
- Estimate popup — `estimating.js`, duration / t-shirt modes
- Cards popup — `cards.js`, save and re-insert task groups
- Whiteboard add-note dialog — `.wb-add-note-dialog`
- Whiteboard note menus — colour, date, resource, coaching (`.wb-note-menu`, `.wb-smart-menu`)
- Portfolio project rename — `portfolio-projects-table.js`
- Portfolio resource details — `portfolio-resources.js`
- Portfolio / programme dependency editor — `portfolio-dependencies.js`, `programme.js`
- Colour pickers — mind map (`.mm-colour-picker`), board (`.theme-colour-picker`)

### Empty / loading / error states

<!-- Easy to forget, but they need components too. -->

Four distinct families, and they are not interchangeable — see section 5.

- **Welcome screen** — `.welcome-screen`, only on the Dashboard before a first render
- **Pre-render placeholder** — `.placeholder-view` plus a per-view class
  (`.gantt-placeholder`, `.tasks-placeholder`, `.evm-placeholder`, …). 16 views have one.
  Says "Render your plan to see …".
- **Empty state** — `.<area>-empty-state` on the table views (`.raid-empty-state`,
  `.budget-empty-state`, `.actions-empty-state`, `.stakeholders-empty-state`,
  `.highlights-empty-state`, `.lessons-empty-state`, `.comms-empty-state`,
  `.escalations-empty-state`, `.kanban-empty-state`, `.wb-empty-state`,
  `.portfolio-empty-state`, `.quad-empty-state`, `.ns-empty`, `.ben-tracking-empty`,
  `.vh-empty`, `.card-list-empty`, `.search-view-empty`, `.backstage-recent-empty`,
  `.programme-empty-hint`). Says "click to get started".
- **Loading** — `.spinner` (`#editorSpinner`, `#uploadSpinner`) on the shells,
  `.portfolio-loading` + `.portfolio-loading-spinner` on all ten portfolio views
  and the programme view.
- **Error** — `.portfolio-error` only. No project-level error state exists.
- **Read-only banner** — `.version-readonly-banner`, shown when viewing an old version.

---

## 2. Pass 2 — Components per screen

<!-- For each screen above, list the components on it. Add to the tally in section 3
     as you go. First sighting = new row. Every sighting after = increment. -->

Component names are deliberately repeated verbatim across rows — that repetition is
what section 3 counts. Semicolons separate components.

| Screen | Components |
| --- | --- |
| **Chrome — Ribbon** | Ribbon titlebar; Ribbon tabstrip; Ribbon group; Ribbon launcher; Ribbon menu; Popover; Icon button; Avatar; Search input; Document title; Breadcrumb; Caret |
| **Chrome — Plan subnav** | Subnav button; Dropdown menu; Menu item; Menu divider; Icon; Separator |
| **Chrome — Status bar** | Project switcher (select); Badge (RAG); Live message region; Icon button; Popover; Text button; Version label; Notification bell; Empty state |
| **Chrome — Session chat** | Panel header; Icon button; Message bubble; Text input; Badge (count) |
| **Chrome — AI chat** | Slide-out panel; Panel header; Message bubble; Typing indicator; Chip; Tool-call row; Text input; Icon button; Toast |
| **Chrome — Toasts** | Toast; Progress bar |
| **Chrome — Task peek** | Popover; Breadcrumb; Panel header; Icon button; Close button; List row; Checkbox; Avatar; Badge (count); Empty state |
| **Chrome — Backstage** | Icon button; Rail button; Icon; View header; Card; Card grid; List row; Badge (count); Empty state; Text button |
| Plan Editor (shell) | Markdown editor (textarea + line numbers + highlight layer); Slide-out panel; Splitter; Hint text; Live message region; Loading spinner; Output container |
| Dashboard / Project Report | Welcome screen; Placeholder (pre-render); Ribbon banner (view title); Label + value pair; Badge (RAG); Quad cell; Section header; Icon button; Copy-to-image button; Swimlane; Donut chart; Sparkline; Data table; Table wrapper; Empty state; Card; Progress bar; Stat tile |
| Milestones | Placeholder (pre-render); Toolbar; Checkbox + label; Data table; Table wrapper; Copy-to-image button; Sortable column header |
| Timeline | Placeholder (pre-render); Ribbon banner (view title); Checkbox + label; Timeline track; Milestone marker (diamond); Date label; Today marker; Progress bar |
| Gantt | Placeholder (pre-render); Collapsible section; Timeline track; Milestone marker (diamond); Copy-to-image button; Toolbar; Ribbon banner (view title); Select; Checkbox + label; Button (outline); Data table; Table wrapper; Splitter; Inline-editable cell; Disclosure triangle; Badge (RAG); Gantt bar; Progress bar; Today marker; Drag handle |
| Tasks | Placeholder (pre-render); Collapsible section; Timeline track; Milestone marker (diamond); Copy-to-image button; Toolbar; Ribbon banner (view title); Data table; Table wrapper; Inline-editable cell; Badge (RAG); Badge (type) |
| Outline (Notepad) | Toolbar; Hint text; Text button; List row; Drag handle; Bullet; Text input; Icon button |
| Board (Kanban) | Live message region; Markdown editor (textarea + line numbers + highlight layer); Splitter; Toolbar; Tab bar; Checkbox + label; Breadcrumb; Column; Column header; Badge (count); Card; Checkbox; Select; Icon button; Avatar; Tag/chip; Colour swatch picker; Empty state; Button (primary); Button (secondary); Drag handle |
| Calendar | Placeholder (pre-render); Icon button; Ribbon banner (view title); Calendar grid; Day cell; Badge (RAG) |
| Mind Map | Placeholder (pre-render); Text button; Zoom toolbar; Icon button; Toolbar separator; Theme toggle; Colour swatch picker; Hint text; Canvas (pan/zoom); Graph node; Graph edge; Inline text editor; Icon button |
| Whiteboard | Zoom toolbar; Icon button; Toolbar separator; Hint text; kbd key; Canvas (pan/zoom); Post-it note; Avatar; Badge (count); Context menu; Colour swatch picker; Empty state; Slide-out panel; Search input; List row; Drag handle; Button (primary) |
| PBS | Placeholder (pre-render); Code block; Text button; Ribbon banner (view title); Zoom toolbar; Icon button; Toolbar separator; Canvas (pan/zoom); Graph node; Graph edge; Badge (RAG) |
| Deliverables Matrix | Placeholder (pre-render); Code block; Ribbon banner (view title); Data table; Table wrapper; Inline-editable cell; Select; Badge (type); Tick marker; Avatar |
| Product Flow | Placeholder (pre-render); Code block; Text button; Ribbon banner (view title); Zoom toolbar; Icon button; Toolbar separator; Canvas (pan/zoom); Graph node; Graph edge; Badge (RAG); Tag/chip |
| Benefits Map | Placeholder (pre-render); Text button; Zoom toolbar; Icon button; Toolbar separator; Tab bar; Hint text; Canvas (pan/zoom); Graph node; Graph edge; Tag/chip |
| Benefits Tracking | Tab bar; Data table; Table wrapper; Inline-editable cell; Select; Badge (type); Empty state |
| RAID Log | Toolbar; Subtle add link; Icon; File input; Toolbar separator; Filter group (label + select); Data table; Table wrapper; Sortable column header; Badge (type); Badge (status); Empty state; Collapsible section; Markdown editor (plain textarea); Icon button |
| Actions | Toolbar; Subtle add link; File input; Toolbar separator; Filter group (label + select); Data table; Table wrapper; Badge (status); Badge (type); Empty state |
| Highlights | Placeholder (pre-render); Toolbar; Ribbon banner (view title); Subtle add link; Icon; List row; Card; Empty state |
| Look-Ahead | Placeholder (pre-render); Ribbon banner (view title); Section header; Data table; Table wrapper; Badge (RAG); Empty state |
| Escalations | View header; View subtitle; Toolbar; Filter group (label + select); Data table; Table wrapper; Badge (type); Empty state |
| Analysis | Placeholder (pre-render); Ribbon banner (view title); Section header; Card; Card grid; Badge (RAG); Text button |
| Budget (table) | Toolbar; Subtle add link; Icon; File input; Toolbar separator; Filter group (label + select); Text input; Icon button; Data table; Table wrapper; Table totals row; Empty state; Collapsible section; Markdown editor (plain textarea) |
| Budget (spreadsheet) | Spreadsheet toolbar; Icon button; Toolbar separator; Formula bar; Find bar; Text input; Spreadsheet grid; Column header; Row header; Cell editor; Table totals row; Tab bar; Context menu; Empty state; Sortable column header |
| EVM | Placeholder (pre-render); Ribbon banner (view title); Copy-to-image button; KPI tile; Line chart; Chart legend; Section header; Spreadsheet grid |
| Forecast | Placeholder (pre-render); Ribbon banner (view title); Copy-to-image button; Summary item; KPI tile; Line chart; Chart legend |
| Comms Plan | Toolbar; Subtle add link; Icon; Toolbar separator; Filter group (label + select); Button (outline); Data table; Table wrapper; Badge (status); Empty state |
| Lessons Learned | Toolbar; Subtle add link; Icon; Toolbar separator; Filter group (label + select); Hint text; Data table; Table wrapper; Badge (status); Empty state; Icon button |
| Resource Table | Placeholder (pre-render); Toolbar; Ribbon banner (view title); View subtitle; Subtle add link; Data table; Table wrapper; Copy-to-image button; Inline-editable cell; Avatar |
| Timesheet | Placeholder (pre-render); Ribbon banner (view title); Data table; Table wrapper; Column header; Table totals row; Heatmap cell |
| Workload | Placeholder (pre-render); Ribbon banner (view title); Filter group (label + select); Text button; Notice bar; Section header; Data table; Empty state |
| Resource Sheet | Placeholder (pre-render); Toolbar; Ribbon banner (view title); Filter group (label + select); Data table; Table wrapper; Gantt bar |
| Stakeholders | Toolbar; Subtle add link; Data table; Table wrapper; Copy-to-image button; Empty state; Influence grid |
| Syntax Guide | Section header; List; Code block; Code/pre block |
| Search | View header; Search input; Icon; Icon button; Result group header; Badge (count); Result row; Badge (type); Empty state; Hint text |
| Upload | Drop zone; Icon; File input; Button (primary); Loading spinner; Live message region; Output container |
| Portfolio — Projects | Data table; Table wrapper; Sortable column header; Checkbox; Inline-editable cell; Badge (status); Badge (type); Card; Icon button; Selection toolbar; Badge (count); Text button; Lasso box; Dialog shell; Form group; Text input; Button (primary); Button (secondary); Empty state |
| Portfolio — Status | Loading spinner; Ribbon banner (view title); Filter group (label + select); Data table; Table wrapper; Sortable column header; Badge (status); Badge (RAG); Badge (count); Progress bar; Trend indicator; Empty state |
| Portfolio — Team Allocation | Loading spinner; Ribbon banner (view title); View subtitle; Summary item; Data table; Table wrapper; Badge (count); Badge (type); Tooltip; Button (primary); Button (secondary); Heatmap grid; Heatmap legend; Dialog shell; Close button; Stat tile; Gantt bar; Badge (status); Empty state |
| Portfolio — Timeline | Loading spinner; Ribbon banner (view title); Toolbar; Timeline track; Date label; Swimlane; Milestone marker (diamond); Today marker; Empty state |
| Portfolio — Actions | Loading spinner; Ribbon banner (view title); Summary item; Filter group (label + select); Data table; Table wrapper; Sortable column header; Badge (type); Badge (RAG); Empty state |
| Portfolio — Risks | Loading spinner; Ribbon banner (view title); Summary item; Filter group (label + select); Text button; Data table; Table wrapper; Sortable column header; Badge (type); Badge (status); Badge (count); Empty state |
| Portfolio — Look-Ahead | Loading spinner; Ribbon banner (view title); Summary item; Filter group (label + select); Toggle button group; Section header; Data table; Table wrapper; Sortable column header; Badge (RAG); Empty state |
| Portfolio — Dependencies | Loading spinner; View header; Toolbar; Subtle add link; Icon; Data table; Badge (RAG); Dialog shell; Close button; Form group; Form grid (2 col); Select; Text input; Button (primary); Button (secondary); Button (danger); Empty state |
| Portfolio — Benefits | Loading spinner; Ribbon banner (view title); Summary item; Filter group (label + select); Data table; Table wrapper; Sortable column header; Badge (type); Badge (status); Canvas (pan/zoom); Graph node; Graph edge; Empty state |
| Portfolio — Lessons | Loading spinner; Section header; Toolbar; Filter group (label + select); Data table; Table wrapper; Badge (status); Empty state; Error state |
| Programme | Loading spinner; View header; View subtitle; Section header; Stat tile; List row; Badge (RAG); Badge (type); Data table; Table wrapper; Badge (count); Subtle add link; Icon; Card; Card grid; Dialog shell; Close button; Form group; Text input; Button (primary); Button (secondary); Button (danger); Empty state |
| Panel — Front matter | Panel header; Disclosure triangle; Tab bar; List row; Text input; Tag/chip; Icon button; Drag handle; Markdown editor (plain textarea); Badge (count); Hint text; Notice bar |
| Panel — Back matter | Panel header; Disclosure triangle; List row; Text input; Icon button; Markdown editor (plain textarea); Hint text |
| Panel — Task details | Slide-out panel; Panel header; Close button; Icon button; Form group; Form grid (2 col); Form grid (3 col); Text input; Select; Textarea; Checkbox + label; Form actions; Button (primary); Button (secondary) |
| Panel — Task Inspector | Slide-out panel; Panel header; Close button; Icon button; Section header; Label + value pair; Badge (RAG); Progress bar; List row; Hint text; Empty state |
| Panel — Product details | Slide-out panel; Panel header; Close button; Icon button; Form group; Form grid (2 col); Text input; Select; Textarea; Tag/chip; List row; Avatar; Form actions; Button (primary); Button (secondary) |
| Panel — RAID item | Slide-out panel; Panel header; Close button; Form group; Form grid (2 col); Text input; Select; Textarea; Form actions; Button (primary); Button (secondary) |
| Panel — Resource | Slide-out panel; Panel header; Close button; Form group; Form grid (2 col); Text input; Select; Form actions; Button (primary); Button (secondary) |
| Panel — Stakeholder | Slide-out panel; Panel header; Close button; Form group; Form grid (2 col); Text input; Select; Textarea; Form actions; Button (primary); Button (secondary) |
| Panel — Action | Slide-out panel; Panel header; Close button; Form group; Form grid (2 col); Text input; Select; Textarea; Form actions; Button (primary); Button (secondary) |
| Panel — Highlight | Slide-out panel; Panel header; Close button; Form group; Text input; Textarea; Form actions; Button (primary); Button (secondary) |
| Panel — Budget item | Slide-out panel; Panel header; Close button; Form group; Form grid (2 col); Text input; Select; Form actions; Button (primary); Button (secondary) |
| Panel — Comms item | Slide-out panel; Panel header; Close button; Form group; Form grid (2 col); Text input; Select; Textarea; Form actions; Button (primary); Button (secondary) |
| Panel — Lesson learned | Slide-out panel; Panel header; Close button; Form group; Form grid (2 col); Text input; Select; Textarea; Form actions; Button (primary); Button (secondary) |
| Panel — Benefit item | Slide-out panel; Panel header; Close button; Form group; Form grid (2 col); Text input; Select; Textarea; Form actions; Button (primary); Button (secondary) |
| Panel — Project details | Slide-out panel; Panel header; Close button; Text input; Form group; Form grid (2 col); Select; Textarea; Form actions; Button (primary); Button (secondary) |
| Panel — Project settings | Slide-out panel; Panel header; Close button; Tab bar; Form group; Checkbox + label; Select; Text input; Colour swatch picker; List row; Badge (status); Button (secondary); Form actions |
| Panel — Conditional formatting | Slide-out panel; Panel header; Close button; Data table; Subtle add link; Hint text; Colour swatch picker; Section header |
| Panel — Version history | Slide-out panel; Panel header; Close button; Filter group (label + select); Button (secondary); Icon; List row; Badge (RAG); Icon button; Empty state |
| Panel — Whiteboard structure | Slide-out panel; Panel header; Badge (count); Icon button; Search input; List row; Drag handle; Disclosure triangle; Badge (RAG); Empty state |
| Panel — Whiteboard parking lot | Slide-out panel; Panel header; Hint text; List row; Drag handle; Icon button; Empty state |
| Panel — Board editor | Markdown editor (textarea + line numbers + highlight layer); Splitter; Icon button |
| Dialog — shell (all modals) | Dialog shell; Panel header; Close button; Form actions; Button (primary); Button (secondary) |
| Dialog — Manage baselines | Dialog shell; Panel header; Close button; Icon; Hint text; Text input; Button (primary); List row; Icon button; Form actions; Button (secondary) |
| Dialog — Import Excel | Dialog shell; Panel header; Close button; Step indicator; Form group; Select; Data table; Table wrapper; Notice bar; Textarea; Form actions; Button (primary); Button (secondary); Loading spinner |
| Dialog — Templates | Dialog shell; Panel header; Close button; Sidebar nav; List row; Section header; Card; Card grid; Loading spinner; Error state |
| Dialog — AI settings | Dialog shell; Panel header; Close button; Form group; Select; Text input; Checkbox + label; Form actions; Button (primary); Button (secondary) |
| Dialog — Trend report | Dialog shell; Panel header; Close button; Textarea; Form actions; Button (primary); Button (secondary) |
| Dialog — RAID sync | Dialog shell; Panel header; Close button; File input; Data table; Form actions; Button (primary); Button (secondary) |
| Dialog — MS Project sync | Dialog shell; Panel header; Close button; File input; Data table; Form actions; Button (primary); Button (secondary) |
| Dialog — Status log | Dialog shell; Panel header; Close button; List row; Icon button; Empty state |
| Dialog — Keyboard shortcuts | Dialog shell; Panel header; Close button; Section header; List row; kbd key |
| Dialog — Planning session | Dialog shell; Panel header; Close button; Form group; Text input; Form actions; Button (primary); Button (secondary); Badge (status) |
| Dialog — Delete confirm | Dialog shell; Panel header; Close button; Form actions; Button (danger); Button (secondary) |
| Dialog — Plan wizard | Dialog shell; Panel header; Close button; Step indicator; View subtitle; Form group; Text input; Textarea; Form actions; Button (primary); Button (secondary); Spreadsheet grid |
| Dialog — Estimate popup | Dialog shell; Panel header; Close button; Tab bar; Form group; Text input; Toggle button group; Label + value pair; Form actions; Button (primary); Button (secondary) |
| Dialog — Cards popup | Dialog shell; Panel header; Close button; Text input; Button (primary); Section header; List row; Icon button; Empty state; Form actions; Button (secondary) |
| Dialog — Whiteboard add note | Dialog shell; Panel header; Close button; Search input; List row; Checkbox; Collapsible section; Text input; Form actions; Button (primary); Button (secondary); Empty state |
| Dialog — Tour | Dialog shell; Popover; Button (primary); Button (secondary); Step indicator |

---

## 3. Component tally → build order

<!-- The deduplicated list. Sort by count descending when Pass 2 is done — that
     ordering IS the Storybook build order. -->

Counted mechanically from section 2 (count = number of screens the component
appears on). Sorted descending, so read top-down as the build order.

93 screens and surfaces audited; 139 distinct components; 952 total sightings.

| Component | Screens | Count | Canonical version chosen | Story built |
| --- | --- | --- | --- | --- |
| Panel header | Chrome — Session chat, Chrome — AI chat, Chrome — Task peek, +36 more | 39 | ☐ | ☐ |
| Empty state | Chrome — Status bar, Chrome — Task peek, Chrome — Backstage, +34 more | 37 | ☐ | ☐ |
| Close button | Chrome — Task peek, Portfolio — Team Allocation, Portfolio — Dependencies, +33 more | 36 | ☐ | ☐ |
| Button (secondary) | Board (Kanban), Portfolio — Projects, Portfolio — Team Allocation, +30 more | 33 | ☐ | ☑ `np-button` |
| Icon button | Chrome — Ribbon, Chrome — Status bar, Chrome — Session chat, +30 more | 33 | ☐ | ☐ |
| Button (primary) | Board (Kanban), Whiteboard, Upload, +29 more | 32 | ☐ | ☑ `np-button` |
| Data table | Dashboard / Project Report, Milestones, Gantt, +29 more | 32 | ☐ | ☐ |
| Text input | Chrome — Session chat, Chrome — AI chat, Outline (Notepad), +27 more | 30 | ☐ | ☐ |
| Table wrapper | Dashboard / Project Report, Milestones, Gantt, +24 more | 27 | ☐ | ☐ |
| Form actions | Panel — Task details, Panel — Product details, Panel — RAID item, +23 more | 26 | ☐ | ☐ |
| Ribbon banner (view title) | Dashboard / Project Report, Timeline, Gantt, +21 more | 24 | ☐ | ☐ |
| Dialog shell | Portfolio — Projects, Portfolio — Team Allocation, Portfolio — Dependencies, +18 more | 21 | ☐ | ☐ |
| Form group | Portfolio — Projects, Portfolio — Dependencies, Programme, +18 more | 21 | ☐ | ☐ |
| Slide-out panel | Chrome — AI chat, Plan Editor (shell), Whiteboard, +18 more | 21 | ☐ | ☐ |
| List row | Chrome — Task peek, Chrome — Backstage, Outline (Notepad), +17 more | 20 | ☐ | ☐ |
| Placeholder (pre-render) | Dashboard / Project Report, Milestones, Timeline, +17 more | 20 | ☐ | ☐ |
| Select | Gantt, Board (Kanban), Deliverables Matrix, +16 more | 19 | ☐ | ☐ |
| Toolbar | Milestones, Gantt, Tasks, +15 more | 18 | ☐ | ☐ |
| Badge (RAG) | Chrome — Status bar, Dashboard / Project Report, Gantt, +14 more | 17 | ☐ | ☐ |
| Filter group (label + select) | RAID Log, Actions, Escalations, +12 more | 15 | ☐ | ☐ |
| Loading spinner | Plan Editor (shell), Upload, Portfolio — Status, +11 more | 14 | ☐ | ☐ |
| Section header | Dashboard / Project Report, Look-Ahead, Analysis, +11 more | 14 | ☐ | ☐ |
| Badge (count) | Chrome — Session chat, Chrome — Task peek, Chrome — Backstage, +10 more | 13 | ☐ | ☐ |
| Badge (type) | Tasks, Deliverables Matrix, Benefits Tracking, +10 more | 13 | ☐ | ☐ |
| Hint text | Plan Editor (shell), Outline (Notepad), Mind Map, +10 more | 13 | ☐ | ☐ |
| Icon | Chrome — Plan subnav, Chrome — Backstage, RAID Log, +10 more | 13 | ☐ | ☐ |
| Textarea | Panel — Task details, Panel — Product details, Panel — RAID item, +10 more | 13 | ☐ | ☐ |
| Badge (status) | RAID Log, Actions, Comms Plan, +9 more | 12 | ☐ | ☐ |
| Form grid (2 col) | Portfolio — Dependencies, Panel — Task details, Panel — Product details, +9 more | 12 | ☐ | ☐ |
| Subtle add link | RAID Log, Actions, Highlights, +8 more | 11 | ☐ | ☐ |
| Text button | Chrome — Status bar, Chrome — Backstage, Outline (Notepad), +8 more | 11 | ☐ | ☐ |
| Toolbar separator | Mind Map, Whiteboard, PBS, +8 more | 11 | ☐ | ☐ |
| Sortable column header | Milestones, RAID Log, Budget (spreadsheet), +6 more | 9 | ☐ | ☐ |
| Card | Chrome — Backstage, Dashboard / Project Report, Board (Kanban), +5 more | 8 | ☐ | ☑ `np-card` |
| Copy-to-image button | Dashboard / Project Report, Milestones, Gantt, +5 more | 8 | ☐ | ☐ |
| Avatar | Chrome — Ribbon, Chrome — Task peek, Board (Kanban), +4 more | 7 | ☐ | ☐ |
| Checkbox + label | Milestones, Timeline, Gantt, +4 more | 7 | ☐ | ☐ |
| Drag handle | Gantt, Outline (Notepad), Board (Kanban), +4 more | 7 | ☐ | ☐ |
| Tab bar | Board (Kanban), Benefits Map, Benefits Tracking, +4 more | 7 | ☐ | ☐ |
| Canvas (pan/zoom) | Mind Map, Whiteboard, PBS, +3 more | 6 | ☐ | ☐ |
| File input | RAID Log, Actions, Budget (table), +3 more | 6 | ☐ | ☐ |
| Inline-editable cell | Gantt, Tasks, Deliverables Matrix, +3 more | 6 | ☐ | ☐ |
| Progress bar | Chrome — Toasts, Dashboard / Project Report, Timeline, +3 more | 6 | ☐ | ☐ |
| Summary item | Forecast, Portfolio — Team Allocation, Portfolio — Actions, +3 more | 6 | ☐ | ☐ |
| Collapsible section | Gantt, Tasks, RAID Log, +2 more | 5 | ☐ | ☐ |
| Colour swatch picker | Board (Kanban), Mind Map, Whiteboard, +2 more | 5 | ☐ | ☐ |
| Graph edge | Mind Map, PBS, Product Flow, +2 more | 5 | ☐ | ☐ |
| Graph node | Mind Map, PBS, Product Flow, +2 more | 5 | ☐ | ☐ |
| Search input | Chrome — Ribbon, Whiteboard, Search, +2 more | 5 | ☐ | ☐ |
| Tag/chip | Board (Kanban), Product Flow, Benefits Map, +2 more | 5 | ☐ | ☐ |
| View header | Chrome — Backstage, Escalations, Search, +2 more | 5 | ☐ | ☐ |
| View subtitle | Escalations, Resource Table, Portfolio — Team Allocation, +2 more | 5 | ☐ | ☐ |
| Zoom toolbar | Mind Map, Whiteboard, PBS, +2 more | 5 | ☐ | ☐ |
| Card grid | Chrome — Backstage, Analysis, Programme, +1 more | 4 | ☐ | ☐ |
| Checkbox | Chrome — Task peek, Board (Kanban), Portfolio — Projects, +1 more | 4 | ☐ | ☐ |
| Code block | PBS, Deliverables Matrix, Product Flow, +1 more | 4 | ☐ | ☐ |
| Disclosure triangle | Gantt, Panel — Front matter, Panel — Back matter, +1 more | 4 | ☐ | ☐ |
| Live message region | Chrome — Status bar, Plan Editor (shell), Board (Kanban), +1 more | 4 | ☐ | ☐ |
| Markdown editor (plain textarea) | RAID Log, Budget (table), Panel — Front matter, +1 more | 4 | ☐ | ☐ |
| Milestone marker (diamond) | Timeline, Gantt, Tasks, +1 more | 4 | ☐ | ☐ |
| Popover | Chrome — Ribbon, Chrome — Status bar, Chrome — Task peek, +1 more | 4 | ☐ | ☐ |
| Splitter | Plan Editor (shell), Gantt, Board (Kanban), +1 more | 4 | ☐ | ☐ |
| Timeline track | Timeline, Gantt, Tasks, +1 more | 4 | ☐ | ☐ |
| Breadcrumb | Chrome — Ribbon, Chrome — Task peek, Board (Kanban) | 3 | ☐ | ☐ |
| Button (danger) | Portfolio — Dependencies, Programme, Dialog — Delete confirm | 3 | ☐ | ☑ `np-button` |
| Column header | Board (Kanban), Budget (spreadsheet), Timesheet | 3 | ☐ | ☑ `np-board` |
| Gantt bar | Gantt, Resource Sheet, Portfolio — Team Allocation | 3 | ☐ | ☐ |
| Label + value pair | Dashboard / Project Report, Panel — Task Inspector, Dialog — Estimate popup | 3 | ☐ | ☐ |
| Markdown editor (textarea + line numbers + highlight layer) | Plan Editor (shell), Board (Kanban), Panel — Board editor | 3 | ☐ | ☐ |
| Notice bar | Workload, Panel — Front matter, Dialog — Import Excel | 3 | ☐ | ☐ |
| Spreadsheet grid | Budget (spreadsheet), EVM, Dialog — Plan wizard | 3 | ☐ | ☐ |
| Stat tile | Dashboard / Project Report, Portfolio — Team Allocation, Programme | 3 | ☐ | ☐ |
| Step indicator | Dialog — Import Excel, Dialog — Plan wizard, Dialog — Tour | 3 | ☐ | ☐ |
| Table totals row | Budget (table), Budget (spreadsheet), Timesheet | 3 | ☐ | ☐ |
| Today marker | Timeline, Gantt, Portfolio — Timeline | 3 | ☐ | ☐ |
| Button (outline) | Gantt, Comms Plan | 2 | ☐ | ☑ `np-button` |
| Chart legend | EVM, Forecast | 2 | ☐ | ☐ |
| Context menu | Whiteboard, Budget (spreadsheet) | 2 | ☐ | ☐ |
| Date label | Timeline, Portfolio — Timeline | 2 | ☐ | ☐ |
| Error state | Portfolio — Lessons, Dialog — Templates | 2 | ☐ | ☐ |
| KPI tile | EVM, Forecast | 2 | ☐ | ☐ |
| Line chart | EVM, Forecast | 2 | ☐ | ☐ |
| Message bubble | Chrome — Session chat, Chrome — AI chat | 2 | ☐ | ☐ |
| Output container | Plan Editor (shell), Upload | 2 | ☐ | ☐ |
| Swimlane | Dashboard / Project Report, Portfolio — Timeline | 2 | ☐ | ☐ |
| Toast | Chrome — AI chat, Chrome — Toasts | 2 | ☐ | ☐ |
| Toggle button group | Portfolio — Look-Ahead, Dialog — Estimate popup | 2 | ☐ | ☐ |
| kbd key | Whiteboard, Dialog — Keyboard shortcuts | 2 | ☐ | ☐ |
| Bullet | Outline (Notepad) | 1 | ☐ | ☐ |
| Calendar grid | Calendar | 1 | ☐ | ☐ |
| Caret | Chrome — Ribbon | 1 | ☐ | ☐ |
| Cell editor | Budget (spreadsheet) | 1 | ☐ | ☐ |
| Chip | Chrome — AI chat | 1 | ☐ | ☐ |
| Code/pre block | Syntax Guide | 1 | ☐ | ☐ |
| Column | Board (Kanban) | 1 | ☐ | ☑ `np-board` |
| Day cell | Calendar | 1 | ☐ | ☐ |
| Document title | Chrome — Ribbon | 1 | ☐ | ☐ |
| Donut chart | Dashboard / Project Report | 1 | ☐ | ☐ |
| Drop zone | Upload | 1 | ☐ | ☐ |
| Dropdown menu | Chrome — Plan subnav | 1 | ☐ | ☐ |
| Find bar | Budget (spreadsheet) | 1 | ☐ | ☐ |
| Form grid (3 col) | Panel — Task details | 1 | ☐ | ☐ |
| Formula bar | Budget (spreadsheet) | 1 | ☐ | ☐ |
| Heatmap cell | Timesheet | 1 | ☐ | ☐ |
| Heatmap grid | Portfolio — Team Allocation | 1 | ☐ | ☐ |
| Heatmap legend | Portfolio — Team Allocation | 1 | ☐ | ☐ |
| Influence grid | Stakeholders | 1 | ☐ | ☐ |
| Inline text editor | Mind Map | 1 | ☐ | ☐ |
| Lasso box | Portfolio — Projects | 1 | ☐ | ☐ |
| List | Syntax Guide | 1 | ☐ | ☐ |
| Menu divider | Chrome — Plan subnav | 1 | ☐ | ☐ |
| Menu item | Chrome — Plan subnav | 1 | ☐ | ☐ |
| Notification bell | Chrome — Status bar | 1 | ☐ | ☐ |
| Post-it note | Whiteboard | 1 | ☐ | ☑ `np-note` |
| Project switcher (select) | Chrome — Status bar | 1 | ☐ | ☐ |
| Quad cell | Dashboard / Project Report | 1 | ☐ | ☐ |
| Rail button | Chrome — Backstage | 1 | ☐ | ☐ |
| Result group header | Search | 1 | ☐ | ☐ |
| Result row | Search | 1 | ☐ | ☐ |
| Ribbon group | Chrome — Ribbon | 1 | ☐ | ☐ |
| Ribbon launcher | Chrome — Ribbon | 1 | ☐ | ☐ |
| Ribbon menu | Chrome — Ribbon | 1 | ☐ | ☐ |
| Ribbon tabstrip | Chrome — Ribbon | 1 | ☐ | ☐ |
| Ribbon titlebar | Chrome — Ribbon | 1 | ☐ | ☐ |
| Row header | Budget (spreadsheet) | 1 | ☐ | ☐ |
| Selection toolbar | Portfolio — Projects | 1 | ☐ | ☐ |
| Separator | Chrome — Plan subnav | 1 | ☐ | ☐ |
| Sidebar nav | Dialog — Templates | 1 | ☐ | ☐ |
| Sparkline | Dashboard / Project Report | 1 | ☐ | ☐ |
| Spreadsheet toolbar | Budget (spreadsheet) | 1 | ☐ | ☐ |
| Subnav button | Chrome — Plan subnav | 1 | ☐ | ☐ |
| Theme toggle | Mind Map | 1 | ☐ | ☐ |
| Tick marker | Deliverables Matrix | 1 | ☐ | ☐ |
| Tool-call row | Chrome — AI chat | 1 | ☐ | ☐ |
| Tooltip | Portfolio — Team Allocation | 1 | ☐ | ☐ |
| Trend indicator | Portfolio — Status | 1 | ☐ | ☐ |
| Typing indicator | Chrome — AI chat | 1 | ☐ | ☐ |
| Version label | Chrome — Status bar | 1 | ☐ | ☐ |
| Welcome screen | Dashboard / Project Report | 1 | ☐ | ☐ |

---

## 4. Not yet built

<!-- Planned but non-existent screens. Keep them out of the inventory proper so the
     count stays honest — the inventory measures what needs migrating, not what's coming. -->

- **Calendars view** — add / modify / delete custom working calendars. Ribbon slot exists under Plan ▸ Gantt and Resources ▸ People; no view.
- **Durations** — ribbon slot under Plan ▸ Gantt, not implemented.
- **Portfolio heat map** — ribbon slot under Portfolio Tools ▸ Analyse, not implemented.
- **Programme ribbon IA** — the programme *view* is built (`#programme-tab`) but has no ribbon tab of its own.
- **Project-level error state** — only `.portfolio-error` exists; no equivalent for project views.

---

## 5. Open questions

<!-- Things spotted during the passes that need a decision — near-duplicate components,
     one-offs that might not deserve to be components, anything that doesn't fit. -->

- **The timeline is one component with four rendering modes**, not one component:
  full, detailed and minimal (`.minimal-timeline-mode`, toggled by `#minimalTimelineToggle`,
  with its own `.minimal-timeline-container` / `.minimal-milestone` / `.minimal-date-scale`
  class family in `views-timeline.js`), plus the embedded variant
  (`.embedded-timeline-wrapper`) that Gantt and Tasks collapse into a header. The story
  needs all four, and the minimal one is close to being a separate component.
- **No real horizontal rule anywhere in the Dashboard.** The apparent dividers between
  report sections are `border-top` on the section wrappers, not an `<hr>` — so there is no
  divider component to build, but three different section wrappers draw their own line.
- **Two keyboard-shortcuts dialogs.** `#keyboardShortcutsOverlay` (`.modal-overlay`) and
  `#shortcutsOverlay` (`.shortcuts-modal-overlay`) both exist and both say "Keyboard
  Shortcuts". One should go.
- **Panel headers are inconsistent.** Only Task details, Product details and the Task
  Inspector use `.detail-pane-header`; the other thirteen `#detailPane` sections use
  `.modal-header` + `<h2>`, borrowed from the dialog shell — so the drawer and the modal
  share a header component by accident rather than by design. Pick one before building
  the Storybook story.
- **Four kinds of "nothing here".** Welcome screen, `.placeholder-view`, `.<area>-empty-state`
  and `.portfolio-loading` all occupy the same slot and look different. They mean different
  things (never rendered / rendered but no data / loading), so they probably stay separate —
  but they need one shared shell.
- **Empty-state classes are per-area, not shared.** 19 variants of `*-empty-state` doing the
  same job. Strongest single consolidation target in the app.
- **`.ribbon-banner` is the view-title component but is named for the ribbon.** It appears
  on 23 views in 6 colour variants and has nothing to do with `#ribbonShell`. Rename when
  it becomes a component.
- **Table views are one component wearing nine hats.** `.raid-table`, `.budget-table`,
  `.actions-table`, `.resources-table`, `.stakeholders-table`, `.lessons-table`,
  `.comms-table`, `.deliverables-table` and the six `portfolio-*-table`s are the same
  toolbar + filter + table + empty-state pattern. Only some have sortable headers.
- **`escalations` is grouped but not wired into the nav**, and `lessons` is wired but not
  grouped (per `ui-structure.json`). One of the two lists is wrong.
- **Budget has two whole renderings** — `.budget-table` and the Noodlesheet spreadsheet
  (`#budgetSheetContainer`), toggled by one button. EVM reuses the spreadsheet for its
  metrics. Is Noodlesheet a component or a second app?
- **Badges are badly fragmented.** `.rag-badge`, `.rag-dot`, `.gantt-rag-dot`,
  `.report-rag-badge`, `.dep-rag-circle`, `.vh-rag-dot`, `.status-badge`,
  `.raid-status-badge`, `.task-status-badge`, `.raid-type-badge`, `.benefit-type-badge`,
  `.actions-priority-badge`, `.risk-score-badge`, `.workload-badge`, `.project-count-badge`,
  `.programme-badge`, `.stalled-badge`, `.recurrence-badge`, `.raid-escalation-badge`,
  `.portfolio-active-badge`. Three components at most: RAG, status, count.
- **Three breadcrumbs.** `.ribbon-breadcrumb-rung`, `.kanban-breadcrumb`,
  `.task-peek-breadcrumb`.
- **Three splitters.** `#editorSplitter`, `#ganttSplitter`, `#kanbanSplitter` — same
  grip + arrow pattern, three implementations.
- **Three zoom toolbars.** Mind map (`.mindmap-toolbar-btn`), PBS/Product Flow
  (`.pbs-toolbar-btn`) and Whiteboard (`.wb-toolbar-btn`) all do zoom in / out / fit /
  reset with different classes. Benefits reuses the mind map's.
- **`.subtle-add-btn` is an `<a>` acting as a button** on eight views. Focus and keyboard
  behaviour will need checking against the design gate.
- **Bootstrap leakage.** `.btn`, `.btn-sm`, `.btn-primary`, `.btn-secondary`,
  `.btn-outline-secondary`, `.btn-danger`, `.form-control`, `.table`, `.table-sm`,
  `.table-hover` and `.bi-*` icons are mixed with the local system. Decide whether
  `<np-button>` replaces them all.
- **Icons come from two places** — inline `<svg class="icon">` in the nav and backstage,
  Bootstrap Icons (`<i class="bi ...">`) everywhere else.
