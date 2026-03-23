How the Scheduling Engine Works
================================

NoodlePlanner's scheduling engine converts your plain-text plan into a fully-calculated project schedule. Understanding how it works helps you write better plans and troubleshoot unexpected dates.

.. mermaid::

   flowchart TB
       subgraph Inputs["Inputs"]
           direction TB
           FM["Front Matter\n(project metadata,\nresource definitions,\nholidays)"]
           PT["Plan Text\n(phases, tasks, durations,\nresources, dependencies,\ndates, progress)"]
       end

       subgraph Processing["Scheduling Engine Processing"]
           direction TB
           P1["Parse plan text\n& extract task lines"]
           P2["Extract metadata per task\n(duration, resources, progress,\ndependencies, labels, comments)"]
           P3["Build task graph\n& resolve dependencies\n(FS, SS, FF, SF + lag/lead)"]
           P4["Detect dependency loops\n& add warnings"]
           P5["Schedule leaf tasks\n(sequential → dependencies →\nexplicit start → parallel)"]
           P6["Calculate start & finish dates\n(working days, holidays,\nresource non-working days)"]
           P7["Calculate summary task dates\n(earliest child start,\nlatest child finish)"]
           P8["Inherit resources\nfrom parent to children"]
           P9["Order tasks\n(summaries before children)"]

           P1 --> P2 --> P3 --> P4 --> P5 --> P6 --> P7 --> P8 --> P9
       end

       subgraph Outputs["Outputs"]
           direction TB
           O1["Scheduled Tasks\n(start/finish dates,\ndurations, hierarchy)"]
           O2["Gantt Chart Data\n(bars, milestones,\ndependency lines)"]
           O3["Resource Allocations\n(who works on what & when)"]
           O4["RAG Status\n(Complete, On Track,\nBehind Schedule, Overdue)"]
           O5["Warnings\n(circular dependencies,\nmissing resources)"]
       end

       FM --> P1
       PT --> P1
       P9 --> O1
       P9 --> O2
       P9 --> O3
       P9 --> O4
       P9 --> O5

Parsing the Plan
-----------------

When you press **Render**, the engine:

1. Reads the front matter block for project metadata and resource definitions
2. Parses each line of the plan to identify phases, tasks, and their attributes
3. Builds a task graph with dependency edges

Task Attributes Extracted
~~~~~~~~~~~~~~~~~~~~~~~~~~

For each task line, the engine extracts:

- Task name (the text without any attribute markers)
- Duration (``3d``, ``2w``, etc.)
- Resources (``@name`` tokens)
- Progress (percentage or ``pN`` format)
- Explicit start date (``YYYY-MM-DD``)
- Comments (quoted strings)
- Dependencies (``[depends ...]`` block)
- Sequential flag (``*`` prefix)

Scheduling Algorithm
---------------------

The engine uses a forward-pass algorithm:

1. **Start from the project start date** (today, unless overridden)
2. For each task, calculate the **earliest possible start date** based on:
   - Its explicit start date (if set)
   - The finish date of all tasks it depends on (plus any offset)
   - The previous task's finish date (if marked as sequential with ``*``)
3. Add the task's duration to get the **finish date**
4. Summary task (phase) dates are derived from the earliest start and latest finish of their children

Working Days
~~~~~~~~~~~~~

By default the engine schedules on calendar days (including weekends). If working days are configured, weekends and holidays are skipped when calculating durations.

Dependency Offsets
~~~~~~~~~~~~~~~~~~~

A dependency offset shifts the start date relative to the dependency's finish:

- ``[depends Task A +2d]`` — start 2 days after Task A finishes
- ``[depends Task A -1d]`` — start 1 day before Task A finishes (overlap)

Sequential Tasks
~~~~~~~~~~~~~~~~~

A task prefixed with ``*`` starts the day after the previous task in the same phase finishes. This is a shorthand for an implicit dependency:

.. code-block:: text

   Phase
     Task A @alice 3d
     * Task B @alice 2d   ← starts the day after Task A finishes

Milestones
~~~~~~~~~~~

A milestone (``0d`` duration) marks a point in time. It has the same start and finish date and appears as a diamond on the Gantt and Timeline views.

Phases (Summary Tasks)
~~~~~~~~~~~~~~~~~~~~~~~

Phases do not have their own duration. The engine calculates a phase's start as the earliest child task start date and its finish as the latest child task finish date.

Plan Start Date
~~~~~~~~~~~~~~~~

If no explicit start date is provided on any task, the first task starts on today's date. All subsequent tasks are scheduled relative to this anchor.

Troubleshooting Date Calculations
----------------------------------

**A task starts later than expected**

Check its dependency chain. A task cannot start until all its dependencies are complete. Use the Gantt view to trace the dependency chain visually.

**Tasks seem to start in the past**

The plan calculates forward from today by default. If tasks have no dependencies, they all start on today's date. Add dependencies or explicit dates to sequence them correctly.

**Duration feels wrong**

Remember that durations are in calendar days by default. ``5d`` means 5 calendar days (including weekends), not 5 working days.

**Two tasks with the same name behave unexpectedly in dependencies**

Task names must be unique within a plan for dependencies to resolve correctly. If two tasks share a name, ``[depends Task Name]`` will resolve to one of them (typically the first occurrence).

Related
--------

- :doc:`../reference/plan-syntax` — full syntax reference including dependency syntax
- :doc:`../tutorials/getting-started` — hands-on introduction
