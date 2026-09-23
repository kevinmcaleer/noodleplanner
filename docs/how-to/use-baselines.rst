How to Use Baselines
=====================

Baselines let you save a snapshot of your project schedule and compare it against the current plan. This is useful for tracking how the schedule has changed over time.

Set a Baseline
---------------

1. Open the **Gantt** view
2. Click **Set Baseline** in the **Baseline** group of the **Gantt Tools** ribbon tab
3. The current schedule is saved as the baseline

To see everything that has moved since, open the **Slippage** report
(**Report** ▸ Reports ▸ **Slippage**). See
:doc:`use-the-assignment-and-slippage-reports`.

The baseline captures the start date, finish date, and duration of every task at that point in time.

Show the Baseline
------------------

1. Click **Show Baseline** in the **Baseline** group of the **Gantt Tools** ribbon tab
2. Baseline bars appear behind the current task bars as semi-transparent overlays
3. Click it again to hide them

Read Baseline Bars
-------------------

When baseline display is enabled:

- **Semi-transparent bars** appear behind each task, showing the original baselined dates
- If a task has **slipped**, the current bar extends beyond the baseline bar
- If a task has been **brought forward**, the current bar appears shorter or earlier than the baseline
- Tasks that have not changed show the current bar directly over the baseline bar

When to Use Baselines
----------------------

Set a baseline at key points in the project lifecycle:

- **After initial planning** — capture the original schedule before work begins
- **After re-planning** — save a new baseline when the schedule is formally revised
- **Before a steering committee** — baseline the schedule so you can show changes at the next review

.. note::

   Only one baseline is stored at a time. Setting a new baseline replaces the previous one.

Related
--------

- :doc:`use-the-gantt-view` — Gantt view guide
- :doc:`../reference/views` — overview of all views
