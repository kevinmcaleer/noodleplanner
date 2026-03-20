Getting Started with NoodlePlanner
====================================

This tutorial walks you through NoodlePlanner from zero to your first rendered project plan. By the end you will have a working plan with tasks, resources, and a schedule displayed across multiple views.

What you will learn
--------------------

- How to open the editor and write a basic plan
- The core plan syntax: tasks, durations, and resources
- How to render your plan and switch between views
- How to save your work

Prerequisites
-------------

- A modern web browser (Chrome, Firefox, Safari, or Edge)
- Access to your NoodlePlanner instance

Step 1: Open the Editor
------------------------

When you first open NoodlePlanner you will see the **Project** view with the plan editor on the left. The editor is a plain-text area where you type your project plan.

The main navigation across the top gives you access to:

- **Portfolio** — view and manage multiple projects
- **Project** — the active project's views (Dashboard, Tasks, Gantt, Board, etc.)

Step 2: Write Your First Plan
------------------------------

Click inside the editor and type the following plan:

.. code-block:: text

   ---
   title: My First Project
   project manager: Your Name
   ---

   Discovery Phase
     Research @alice 3d
     Stakeholder interviews @bob 2d

   Build Phase
     Design prototype @alice 5d [depends Research]
     Build MVP @bob @alice 10d [depends Design prototype]

   Launch Phase
     Testing @bob 3d [depends Build MVP]
     Go Live 0d [depends Testing]

What this plan defines:

- A **front matter** block (between ``---`` lines) with the project title and manager
- Three **phases** (Discovery, Build, Launch) — these are summary tasks
- **Leaf tasks** indented under each phase with durations (``3d``, ``2d``, etc.)
- **Resources** prefixed with ``@``
- **Dependencies** using ``[depends Task Name]``
- A **milestone** (``Go Live 0d``) — a zero-duration task

Step 3: Render Your Plan
-------------------------

Press **Ctrl+Enter** (Windows/Linux) or **Cmd+Enter** (Mac) to render the plan, or click the **Render** button.

NoodlePlanner will parse your text and calculate all start and finish dates automatically based on dependencies and working days.

.. note::

   If there are any syntax errors, a warning will appear below the editor. Check your indentation and task syntax.

Step 4: Explore the Views
--------------------------

Once rendered you can explore your project through multiple views using the sub-navigation bar below the main navigation:

- **Dashboard** — a quad overview with milestones, risks, highlights, and notes
- **Tasks** — a flat list of all tasks
- **Gantt** — a timeline chart (use the zoom controls to change the scale)
- **Board** — a Kanban board grouped by phase, resource, progress, or label
- **Calendar** — tasks laid out on a calendar
- **Milestones** — key dates and summary tasks only
- **Timeline** — a horizontal milestone timeline

Step 5: Save Your Work
-----------------------

NoodlePlanner keeps your plan in the browser's local storage automatically. To save a copy:

1. Go to **Tools** in the sub-navigation bar
2. Select **Export** → **Excel** or **Download as Markdown**

You can reload a saved plan by dragging and dropping the ``.md`` file onto the editor.

Next Steps
----------

- :doc:`first-project` — a deeper walkthrough building a realistic project plan
- :doc:`../how-to/create-a-project` — focused guide on project setup
- :doc:`../reference/plan-syntax` — full syntax reference
