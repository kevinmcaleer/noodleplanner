How to Use the Portfolio View
==============================

The Portfolio view gives you cross-project visibility — a single place to see status, risks, actions, and timelines for all your projects.

Open the Portfolio View
------------------------

Click **Portfolio** in the main navigation bar (top left, next to the NoodlePlanner logo).

Portfolio Sub-views
--------------------

The portfolio header contains tabs for different perspectives:

- **Projects** — list of all projects with status and metadata
- **Status** — project status dashboard (RAG, progress, open risks, trends)
- **Resources** — resource allocation across projects
- **Timeline** — Gantt-style timeline showing all projects as horizontal swimlanes
- **Actions** — open actions from RAID logs across all projects
- **Risks** — aggregated risk register from all projects

Add a Project
--------------

1. Click **+ New Project** in the portfolio header
2. Enter the project name
3. The new project appears in the list and you can open the editor to add a plan

Import a Project
-----------------

1. Click the **...** (three-dot) menu in the portfolio header
2. Select **Import Project**
3. Upload a ``.md`` or ``.txt`` plan file

View Portfolio Status
----------------------

Click the **Status** tab to see a table with one row per project:

- **Project** — name
- **Status** — project status label
- **Progress** — percentage complete
- **RAG** — colour-coded RAG indicator
- **Open Risks** — count of open risks and issues
- **Last Updated** — date last rendered
- **Trend** — improving, stable, or declining

View the Portfolio Timeline
----------------------------

Click the **Timeline** tab to see all projects laid out on a Gantt-style chart.

- Each project appears as a horizontal swimlane
- Phase bars show start and end dates, with progress overlays
- Milestone markers appear as dots
- A vertical red "Today" line spans all swimlanes
- Click a project row to open that project's dashboard

Use the date scale selector to switch between Months, Quarters, and Years.

View the Portfolio Risk Register
----------------------------------

Click the **Risks** tab to see all open risks across all projects in a single table.

- Filter by project or RAG level (High/Medium/Low based on score)
- Click a row to navigate to the RAID log for that project and item
- Add a new risk directly from the portfolio view

View the Actions Chaser
------------------------

Click the **Actions** tab to see open actions from all project RAID logs.

- Filter by project, owner, or status

Export a Portfolio Report
--------------------------

1. Click the **...** (three-dot) menu in the portfolio header
2. Select **Export Report**
3. A PowerPoint presentation downloads containing:
   - A portfolio overview slide (summary counts, timeline, project table)
   - One report slide per project

Portfolio Look-Ahead
---------------------

The Portfolio Look-Ahead shows overdue and upcoming tasks across all projects in the portfolio for the next 14 days.

1. Click the **Look-Ahead** tab in the portfolio header
2. Tasks are grouped by project and sorted by date
3. Overdue tasks are highlighted at the top
4. Use this view in steering meetings to review near-term deliverables across the programme

Portfolio Dependencies
-----------------------

The Portfolio Dependencies view shows cross-project dependencies — tasks or milestones in one project that another project depends on. This is essential for programme management where multiple workstreams need to coordinate.

View Dependencies
~~~~~~~~~~~~~~~~~~

1. Click the **Dependencies** tab in the portfolio header
2. Each dependency is shown as a link between a source task in one project and a dependent task in another
3. Dependencies are displayed on the portfolio timeline as arrows between projects

Add a Dependency
~~~~~~~~~~~~~~~~~

1. Click **+ Add Dependency** in the Dependencies view
2. In the dialog, select:

   - **Source Project** — the project that produces the deliverable
   - **Source Task / Milestone** — the specific task or milestone in the source project
   - **Dependent Project** — the project that is waiting for the deliverable
   - **Dependent Task / Milestone** — the task that cannot start until the source completes
   - **Lag (days)** — optional delay (positive) or overlap (negative) in working days
   - **Notes** — optional description of the dependency

3. Click **Add Dependency**

Edit or Delete a Dependency
~~~~~~~~~~~~~~~~~~~~~~~~~~~~

- Click on an existing dependency row to open the edit dialog
- Modify the fields as needed and click **Save Changes**
- Click **Delete** to remove a dependency

Front Matter Storage
~~~~~~~~~~~~~~~~~~~~~

Dependencies are automatically stored in each project's front matter. When you add or edit a dependency, NoodlePlanner updates the ``dependencies`` section of the affected project(s):

.. code-block:: text

   ---
   title: My Project
   dependencies:
     - from: Infrastructure Project
       task: Server Setup Complete
       to_task: Backend Integration
       type: FS
       lag: 0
   ---

This means dependencies travel with the plan file when you save and reload it.

.. note::

   The ``from`` field is the source project name, ``task`` is the source task, ``to_task`` is the task in this project that depends on it, ``type`` is the dependency type (FS, SS, FF, SF), and ``lag`` is the offset in days.

Status Bar Warnings
~~~~~~~~~~~~~~~~~~~~

NoodlePlanner monitors your programme dependencies and shows warnings in the status bar:

- **Red warning** — a dependent project referenced in the front matter is missing from this browser's project store. This means the project has been deleted or not yet imported.
- **Amber warning** — a dependent activity has a non-green RAG status (Amber or Red), indicating a risk to your project's schedule.

These warnings help you proactively manage cross-project risks during steering meetings and daily standups.

Tips
~~~~~

- Use milestones (zero-duration tasks) as dependency points — they make cleaner handoff markers than regular tasks
- Review the Dependencies view before each steering meeting to check for at-risk cross-project links
- If you rename a task that is used as a dependency, update the dependency to match

Related
--------

- :doc:`use-the-raid-log` — managing risks and actions per project
- :doc:`use-the-2-week-lookahead` — upcoming tasks across all projects
- :doc:`export-your-plan` — exporting individual project plans
- :doc:`../reference/front-matter` — full front matter field reference
