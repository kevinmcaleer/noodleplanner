How to Use the Task Inspector
===============================

The Task Inspector provides a detailed analysis panel for an individual task, showing its dependencies, driving dependency, RAG status, and scheduling hints.

Open the Task Inspector
------------------------

Click the **inspector button** (magnifying glass icon) on any task row in the Tasks table or Gantt view. The Task Inspector panel opens on the right side of the screen.

What the Inspector Shows
--------------------------

The Task Inspector displays the following information:

**Dependencies**
   A list of all predecessor and successor tasks, with their relationship types (Finish-to-Start, Start-to-Start, etc.) and any lag or lead values.

**Driving Dependency**
   The single predecessor that determines the task's start date. This is highlighted so you can quickly see which upstream task is controlling the schedule.

**RAG Status**
   The task's Red/Amber/Green status with an explanation of why it has that status (e.g., overdue, at risk of slipping, on track).

**Hints**
   Scheduling hints and suggestions, such as:

   - Tasks with no dependencies that could be linked
   - Tasks with unusually long durations
   - Resource conflicts or over-allocations

.. note::

   The driving dependency is particularly useful for schedule analysis. If a task is late, follow the chain of driving dependencies upstream to find the root cause.

Related
--------

- :doc:`use-the-gantt-view` — Gantt view guide
- :doc:`../reference/views` — overview of all views
- :doc:`../explanation/rag-status` — understanding RAG status
- :doc:`../explanation/scheduling-engine` — how the scheduler resolves dependencies
