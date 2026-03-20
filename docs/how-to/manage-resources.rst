How to Manage Resources
========================

Resources in NoodlePlanner represent the people (or teams) assigned to tasks. This guide covers defining resources, assigning them to tasks, and viewing workload information.

Define Resources in the Front Matter
--------------------------------------

Add a ``Resources`` block to your plan's front matter:

.. code-block:: text

   ---
   title: My Project
   Resources:
   - @alice: Alice Smith, Developer
   - @bob: Bob Jones, Designer
   - @charlie: Charlie Brown, Tester
   ---

Each entry maps a **short name** (prefixed with ``@``) to a full name and role description.

Assign Resources to Tasks
--------------------------

Use the short name in any task:

.. code-block:: text

   Build Phase
     Backend API @alice 5d
     UI components @bob 4d
     Unit tests @charlie @alice 2d

Multiple resources can share a task. Separate them with spaces.

Set Resource Allocation
------------------------

Add a percentage after the resource name to set the allocation level:

.. code-block:: text

     Part-time review @alice:50% 3d

This indicates Alice is available at 50% capacity for this task.

View the Resource Table
------------------------

1. Click **Resources** in the project sub-navigation
2. Select **Resource Table** from the dropdown

The resource table shows all tasks grouped by resource, with start date, finish date, duration, and percentage complete.

View Resource Workload
-----------------------

1. Click **Resources** → **Workload**

The Workload view shows one section per team member with:

- A statistics bar (tasks completed, days worked, overall percentage)
- A table of all assigned tasks

Use the **User Filter** dropdown at the top to focus on a single team member.

View the Timesheet
-------------------

1. Click **Resources** → **Timesheet**

The timesheet gives a calendar-style view of resource time allocation, useful for spotting scheduling conflicts.

View the Resource Sheet
------------------------

1. Click **Resources** → **Resource Sheet**

The resource sheet provides a matrix view of all resources across time, similar to a staffing plan.

Edit Resource Details
----------------------

1. Open the **Project Details** panel (via the settings icon in the editor toolbar or via the Resource form)
2. Add or edit resources, including full name, role, and short name

Related
--------

- :doc:`../reference/plan-syntax` — full syntax including resource allocation syntax
- :doc:`use-the-2-week-lookahead` — upcoming work by resource
