How to Use the Gantt View
==========================

The Gantt view shows your project schedule as a horizontal bar chart with tasks on the left and a date timeline on the right.

Open the Gantt View
--------------------

After rendering your plan, click **Gantt** in the project sub-navigation bar.

.. figure:: /_static/img/how-to/gv-01-gantt-full.png
   :alt: Full Gantt chart view showing tasks as horizontal bars on a timeline
   :width: 100%

   The Gantt chart displays your project schedule with task bars, dependencies, and a today marker.

Zoom and Navigate the Timeline
-------------------------------

The **zoom slider** beside the chart title moves smoothly from whole years
down to individual days. The five named scales -- **Years**, **Quarters**,
**Months**, **Weeks** and **Days** -- are detents on the slider: it clicks
onto each one as you pass it, and the readout shows which one you are on.
Between them you get any zoom you like.

.. figure:: /_static/img/how-to/gv-02-gantt-zoom.png
   :alt: The Gantt zoom slider beside the chart title, with month and quarter header bands
   :width: 100%

   Zoomed out between the Months and Quarters detents: the header shows
   quarters above months, chosen automatically for the zoom.

- The **−** and **+** buttons step out and in.
- **Ctrl + mouse wheel** (or a trackpad pinch) over the chart zooms about the
  pointer: the date under it stays where it is.
- The slider zooms about the centre of the visible chart, so you never lose
  your place.
- The **Gantt Tools** ribbon tab's **Scale** buttons jump straight to a named
  scale; **Zoom > Fit** zooms so the whole project fits the width of the
  chart, and **Zoom > Today** scrolls today into view.
- The chart remembers its zoom for each project.

The two rows of date headings are picked from the zoom: the finest unit that
still has room for a readable label (days, weeks, months, quarters or years)
with the next larger unit above it. Weekends are shaded whenever days are
wide enough to see.

Scroll horizontally to move through time.

Read the Chart
---------------

Each row in the Gantt chart represents one task:

- **Summary tasks** (phases) appear as thicker bars spanning their child tasks
- **Leaf tasks** show as thinner bars coloured by RAG status
- **Milestones** appear as diamond markers
- A **green progress fill** inside the bar shows percentage completion
- A vertical **red "Today" line** marks the current date

Hover Over Tasks
-----------------

Hover over a task bar to see a tooltip with:

- Task name
- Start and finish dates
- Duration
- Assigned resources
- Percentage complete
- RAG status

Click to Edit
--------------

Click on a task bar to open the **Task Details** panel. From there you can edit the task name, dates, duration, resources, progress, RAG status, and comments directly.

Drag to Reschedule
-------------------

Drag a task bar to change its schedule. The change is written straight into
your plan's text.

- Drag the **right end** of a bar to change the task's **duration**.
- Drag the **left end** to change its **start**; the finish stays where it is,
  so the duration changes to match.
- Drag the **middle** of a bar to **move** the whole task. Milestones can only
  be moved.

.. figure:: /_static/img/how-to/gv-03-gantt-drag.png
   :alt: A Gantt bar being dragged, with its dependent tasks shown in their new positions and a label giving the new dates
   :width: 100%

   Mid-drag: the dependent tasks, outlined, have already moved to where the
   schedule will put them.

While you drag, every task that depends on the one you are dragging moves
with it -- and so do the tasks that depend on *those*, and the summary bars
above them. A label above the bar shows the new dates, the duration, and how
many other tasks the change moves. This preview is calculated by the same
scheduler that draws the chart, so when you let go nothing jumps: the chart
you are left with is the one you were looking at. Press **Escape** before
letting go to cancel.

How a drag moves:

- **Working days.** Durations are counted in working days, honouring
  weekends, your project's ``non-working-days``, calendars, and each
  resource's own non-working days. Dragging a finish onto a weekend adds no
  working days, so the bar may not grow until you reach the next working day.
- **Steps that suit the zoom.** Zoomed in, a drag moves in whole days. Zoomed
  out, it moves in whole weeks or months instead, so a pixel of hand wobble
  never moves a task by a day. Half a step of movement is needed before
  anything changes.
- **Dependencies still apply.** Dragging the start or middle writes a start
  date on the task. NoodlePlanner treats a start date as *start no earlier
  than*, so you can drag a dependent task later, but not earlier than its
  predecessors allow -- the bar simply will not go there.
- **Summary tasks** cannot be dragged; their bars always follow their
  children.
- **One undo** (**Ctrl+Z**, or **Undo** on the ribbon) reverses a whole drag.

What gets written: dragging the right end rewrites the duration (keeping the
unit you used if the new length is a whole number of it -- ``2w`` stays in
weeks when you drag it to 21 working days, and becomes ``9d`` otherwise);
dragging the left end rewrites the start date and the duration; dragging the
middle rewrites the start date. Nothing else on the line changes -- products,
priorities, buckets, comments and dependencies are left exactly as they were.

Baselines
----------

Baselines let you save a snapshot of your schedule and compare it against the current plan.

**Set a Baseline**
   Click **Set Baseline** in the **Baseline** group of the **Gantt Tools** ribbon tab to save the current schedule as a baseline.

**Show Baseline**
   Click **Show Baseline** in the same group. Semi-transparent bars appear behind the current task bars, showing the original baselined dates. If a task has slipped, the current bar extends beyond the baseline bar.

See :doc:`use-baselines` for a full guide on working with baselines.

Related
--------

- :doc:`../reference/views` — overview of all views
- :doc:`../explanation/rag-status` — understanding RAG status
- :doc:`../reference/plan-syntax` — plan syntax reference
- :doc:`use-baselines` — full baselines guide
