How to Use the Table Views Interface
====================================

The table views interface is a simpler way round NoodlePlanner. Instead of
the ribbon's tabs, it lists a project's **tables** down the left, and shows
each table's **views** as tabs across the top. The plan's Markdown can sit
to the left of whichever view is open.

It is a preview. The classic ribbon is still the default, and you can
switch back at any time. Nothing about your plans changes: both interfaces
show the same views of the same Markdown.

.. figure:: /_static/img/how-to/tv-01-plan-table.png
   :alt: The Plan table open on its Table view, with the list of tables on the left and the plan's Markdown between the list and the view
   :width: 100%

   The Plan table, with the Markdown panel open beside it.

Switching It On
---------------

1. Open **Settings** and choose the **Layout** tab.
2. Under **Interface**, choose **Table views (preview)**.

The choice is kept in this browser only, not in the plan. To go back,
choose **Classic ribbon** in the same place.

You can also open NoodlePlanner with ``?ui=tables`` on the end of its
address to switch it on, and ``?ui=classic`` to switch it off.

Tables and Their Views
----------------------

The list on the left starts with the **Dashboard**, then the tables:

.. list-table::
   :header-rows: 1
   :widths: 25 75

   * - Table
     - Views
   * - Plan
     - Table, Gantt, Board, Calendar, Timeline, Milestones, PBS, Product
       Flow, Mind Map, Outline, Whiteboard, Deliverables, By Assignment,
       Slippage
   * - RAID log
     - Log, Actions, Escalations
   * - Highlight reports
     - Reports, Look-Ahead
   * - Lessons learned
     - Log
   * - Budget
     - Budget, EVM, Forecast
   * - Benefits
     - Benefits
   * - Resources
     - Table, Resource Sheet, Workload, Timesheet
   * - Stakeholders
     - Stakeholders, Comms Plan

Click a table to open it, then a tab to change view. A table reopens on the
view you last left it on. If a table has more views than fit, scroll the
tabs sideways with the mouse wheel or a finger.

.. figure:: /_static/img/how-to/tv-02-plan-gantt.png
   :alt: The Plan table on its Gantt view, with the Markdown panel closed so the chart has the full width
   :width: 100%

   The same table as a Gantt chart, with the Markdown panel closed.

The button at the top of the list shrinks it to a strip of icons, and
brings it back.

The Markdown Panel
------------------

The **Markdown** button at the right of the tabs shows or hides the plan's
Markdown, to the left of the view. It stays where you put it as you move
between tables, so you can edit the plan's text beside the RAID log, the
budget or the board, and watch the view follow.

.. figure:: /_static/img/how-to/tv-03-raid-markdown.png
   :alt: The RAID log with the plan's Markdown open to its left
   :width: 100%

   The Markdown beside the RAID log.

Drag the panel's right edge to resize it. NoodlePlanner remembers its width,
and whether it was open, in this browser.

Adding Things and Finding Commands
----------------------------------

- The yellow **New** button adds to the open table: a task in Plan, an item
  in the RAID log, and so on.
- The **⋯** button lists every command for the open view: the same commands
  the ribbon has, grouped the same way.
- Save, Undo, Redo, Print, search and the **Project**, **Programme** and
  **Portfolio** switch stay in the bar along the top.

On a Tablet or a Phone
----------------------

A tablet starts with the list of tables as a strip of icons, so the view
keeps the width. Every button is at least 44 pixels across.

.. figure:: /_static/img/how-to/tv-04-tablet.png
   :alt: A portrait tablet showing the Plan table, with the tables as a strip of icons down the left
   :width: 60%

   The Plan table on a portrait tablet.

A phone keeps its own layout (see :doc:`use-noodleplanner-on-a-phone`). With
table views switched on, its menu lists the tables, and the chips under the
app bar are the open table's views.

.. figure:: /_static/img/how-to/tv-05-phone-tables.png
   :alt: The phone menu listing Dashboard and the tables
   :width: 40%

   The tables in the phone's menu.

What Is Not Here Yet
--------------------

This is the first step of the table views work. Still to come:

- one filter, sort and group bar shared by every view of a table (today
  each view keeps its own, and the Board has its filter box);
- choosing which fields a table shows;
- opening a row in a side panel from any view.
