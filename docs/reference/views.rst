Views Reference
================

NoodlePlanner provides multiple views of your project plan. All views are accessible from the sub-navigation bar below the main navigation.

Project Views
--------------

Dashboard
~~~~~~~~~~

A quad-layout overview of the project:

- **Header** — project name, manager, RAG status badge, sponsor, budget, date
- **Timeline** — milestone markers on a progress bar
- **Milestones** (top-left) — next 10 incomplete milestones sorted by date
- **Risks & Issues** (top-right) — open RAID items sorted by score
- **Latest Highlight** (bottom-left) — most recent highlight entry
- **Notes** (bottom-right) — placeholder for future use

Tasks
~~~~~~

A flat table of all tasks with columns: Task Name, Start, Finish, Duration, Resources, %, RAG.

Click any row to open the Task Details panel.

Gantt
~~~~~~

A horizontal bar chart showing the project schedule. See :doc:`../how-to/use-the-gantt-view`.

Board (Kanban)
~~~~~~~~~~~~~~~

A card-based board with tasks grouped into columns. See :doc:`../how-to/use-the-kanban-board`.

Calendar
~~~~~~~~~

Tasks displayed on a monthly calendar grid, positioned by their start and finish dates. See :doc:`../how-to/use-the-calendar-view`.

Milestones
~~~~~~~~~~~

A table showing summary tasks and zero-duration milestones only. Columns: Task, Start, Finish, RAG, %, Notes.

Timeline
~~~~~~~~~

A horizontal milestone timeline. See :doc:`../how-to/use-the-timeline-view`.

Mind Map
~~~~~~~~~

A radial diagram showing the project hierarchy (phases and tasks as nodes). Supports keyboard navigation, branch colour customisation, and copy-as-image export. See :doc:`../how-to/use-the-mind-map`.

Stakeholders
~~~~~~~~~~~~~

A view for managing project stakeholders using an interest/influence grid. Stakeholders are defined in the front matter. See :doc:`../how-to/use-the-stakeholders-view`.

Tracking Views
---------------

RAID Log
~~~~~~~~~

Risks, Actions, Issues, Decisions, and Dependencies table. See :doc:`../how-to/use-the-raid-log`.

Actions
~~~~~~~~

Filtered view of RAID items where Type = Action.

Highlights
~~~~~~~~~~~

A log of project highlights (status updates). Each entry has a date, author, and markdown-formatted content.

Look-Ahead
~~~~~~~~~~~

Overdue and upcoming tasks for the next 14 days. See :doc:`../how-to/use-the-2-week-lookahead`.

Analysis
~~~~~~~~~

EVM (Earned Value Management) and other analytical views. Displays PV, EV, AC, SPI, CPI, and S-curve charts. See :doc:`../how-to/use-the-evm-view`.

Budget
~~~~~~~

Budget tracking using the NoodleSheet spreadsheet component.

Resources Views
----------------

Resource Table
~~~~~~~~~~~~~~~

Tasks grouped by assigned resource with dates and progress.

Timesheet
~~~~~~~~~~

Calendar-style view of resource time allocation.

Workload
~~~~~~~~~

Per-user task breakdown with statistics (tasks complete, days complete, percentage). See :doc:`../how-to/manage-resources`.

Resource Sheet
~~~~~~~~~~~~~~~

Matrix view of resources across time (staffing plan style).

Portfolio Views
---------------

See :doc:`../how-to/use-the-portfolio-view` for a full guide.

- **Projects** — list of all projects
- **Status** — RAG status dashboard
- **Resources** — cross-project resource view
- **Timeline** — Gantt-style portfolio timeline
- **Actions** — open actions across all projects
- **Risks** — aggregated risk register
- **Look-Ahead** — overdue and upcoming tasks across all portfolio projects
- **Dependencies** — cross-project dependency map

Shared View Features
---------------------

Embedded Timeline Toggle
~~~~~~~~~~~~~~~~~~~~~~~~~~

Several views (Dashboard, Tasks, Gantt) include an **embedded timeline** toggle that displays a compact milestone timeline bar at the top of the view. Click the toggle in the view toolbar to show or hide it.

Copy as Image
~~~~~~~~~~~~~~

Multiple views support a **Copy as Image** button in the toolbar. Click it to copy the current view to your clipboard as a PNG image, ready to paste into documents or presentations. Available in: Mind Map, Gantt, Timeline.

RAID Log Columns
-----------------

.. list-table::
   :header-rows: 1
   :widths: 20 15 65

   * - Column
     - Type
     - Description
   * - ID
     - Auto
     - Unique identifier (auto-incremented)
   * - Type
     - Enum
     - risk, action, issue, decision, dependency
   * - Title
     - Text
     - Brief title of the item
   * - Description
     - Text
     - Detailed description
   * - Raised By
     - Text
     - Person who raised the item
   * - Owner
     - Text
     - Person responsible for resolution
   * - Mitigation Actions
     - Text
     - Steps being taken
   * - Impact
     - 1–5
     - Severity if the item occurs
   * - Likelihood
     - 1–5
     - Probability of occurrence
   * - Score
     - Calculated
     - Impact × Likelihood (auto-calculated)
   * - Status
     - Enum
     - open, closed, transferred
