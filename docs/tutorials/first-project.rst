Building Your First Real Project
==================================

This tutorial takes you through building a realistic software project plan step by step. You will create a plan with multiple phases, a team of resources, dependencies, progress tracking, and a RAID log.

What you will build
--------------------

A plan for a website redesign project with:

- A discovery and planning phase
- A design and build phase
- Testing and launch phase
- Two team members assigned to tasks
- Dependencies between tasks
- Progress tracking
- A RAID log entry

Step 1: Define the Front Matter
--------------------------------

The front matter block at the top of your plan sets project-level metadata. Start with:

.. code-block:: text

   ---
   title: Website Redesign
   project manager: Alex Chen
   sponsor: Marketing Director
   status: Green
   Resources:
   - @alex: Alex Chen, Project Manager
   - @jamie: Jamie Smith, Developer
   - @sam: Sam Lee, Designer
   ---

The ``Resources`` list registers each person so NoodlePlanner can validate ``@resource`` references in tasks. You can refer to people using their short name (e.g. ``@alex``).

Step 2: Add Phases and Tasks
-----------------------------

Phases are top-level (unindented) lines. Tasks are indented under phases:

.. code-block:: text

   Discovery & Planning
     Stakeholder interviews @alex 3d
     Requirements gathering @alex @jamie 2d [depends Stakeholder interviews]
     Sign-off on requirements @alex 0d [depends Requirements gathering]

   Design
     Wireframes @sam 5d [depends Sign-off on requirements]
     Design review @alex @sam 1d [depends Wireframes]
     Final designs @sam 3d [depends Design review]

   Development
     Frontend build @jamie 10d [depends Final designs]
     Backend integration @jamie 5d [depends Frontend build]
     Code review @alex @jamie 2d [depends Backend integration]

   Testing & Launch
     UAT @alex @sam 3d [depends Code review]
     Bug fixes @jamie 2d [depends UAT]
     Go Live 0d [depends Bug fixes]

Step 3: Add Progress
---------------------

You can track completion on any task by adding a percentage. Update a few tasks to show they are in progress:

.. code-block:: text

   Discovery & Planning
     Stakeholder interviews @alex 3d 100%
     Requirements gathering @alex @jamie 2d 75% [depends Stakeholder interviews]
     Sign-off on requirements @alex 0d [depends Requirements gathering]

Step 4: Add Comments
---------------------

Use quotes to add a comment or note to a task:

.. code-block:: text

     Final designs @sam 3d [depends Design review] "Includes mobile breakpoints"

Step 5: Render and Check the Dashboard
----------------------------------------

The plan renders automatically about a second after you stop typing. Then click **Dashboard** in the sub-navigation.

The dashboard shows:

- **Project header** — title, manager, status badge
- **Timeline** — milestone markers on a progress bar
- **Milestones** — next 10 incomplete milestones
- **Highlights** — latest project update

Step 6: Explore the Gantt View
--------------------------------

Click **Gantt** in the sub-navigation to see your schedule as a horizontal bar chart. Use the zoom controls at the top to switch between days, weeks, months, quarters, and years.

Hover over any task bar to see its details.

Step 7: Try the Kanban Board
-----------------------------

Click **Board** to see your tasks as a Kanban board. Use the grouping dropdown to switch between:

- **Phase** — columns are your phases
- **Resource** — columns show each team member's tasks
- **Progress** — columns group by completion percentage
- **Label** — columns show tasks by label

Step 8: Add a RAID Log Entry
-----------------------------

Navigate to **Tracking** → **RAID Log**. Click **Add Item** and fill in:

- **Type**: Risk
- **Title**: Third-party API dependency
- **Description**: The backend relies on a third-party payment API that may have rate limits
- **Owner**: @jamie
- **Impact**: 3
- **Likelihood**: 2

The Score (Impact × Likelihood = 6) is calculated automatically. Click **Save**.

Your RAID log entry will now appear on the Project Dashboard in the Risks & Issues panel.

Step 9: Export Your Plan
-------------------------

To share your plan:

1. Click **Tools** in the sub-navigation
2. Select **Export** → **Excel** to download a full spreadsheet
3. Or select **Export** → **PowerPoint** to create a presentation

Next Steps
----------

- :doc:`../how-to/manage-resources` — resource allocation and workload views
- :doc:`../how-to/use-the-raid-log` — full RAID log guide
- :doc:`../how-to/use-the-portfolio-view` — managing multiple projects
- :doc:`../reference/plan-syntax` — complete syntax reference
