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

   The same table as a Gantt chart, with the Markdown panel closed and
   the Gantt's commands on the toolbar.

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

The Toolbar
-----------

Under the tabs is a toolbar with the commands for the view that is open.
They are the ribbon's own commands, at one row:

- On the left, what the open view can do, in the ribbon's groups. The Gantt
  shows Link, Critical Path, Baseline, the scale (Days to Years) and the
  rest; the Board shows its grouping; the RAID log shows New Risk, New
  Issue and its own Import and Export. A button that is switched on, such
  as the scale in use, is tinted yellow.
- On the right, three menus that are always there in a project:
  **Reports** (Project Report, Highlights, Analysis, Milestones, Budget,
  Benefits, By Assignment and Slippage), **Export** (Markdown, Excel, CSV,
  PDF, PowerPoint and MS Project) and **Import**.

.. figure:: /_static/img/how-to/tv-06-toolbar-export.png
   :alt: The toolbar under the view tabs on the Gantt view, with the Export menu open and listing Markdown, Excel, CSV, PDF, PowerPoint and MS Project
   :width: 100%

   The toolbar on the Gantt view, with the Export menu open.

If the buttons do not fit, scroll the toolbar sideways with the mouse wheel
or a finger. Where a view has an Export of its own, as the RAID log does,
the menus on the right are named **Export plan** and **Import plan**.

Commands that only switch view are left off the toolbar, because the tabs
do that. Commands the ribbon marks as not available yet are left off too.

Adding Things and Finding Everything Else
-----------------------------------------

- The yellow **New** button adds to the open table: a task in Plan, an item
  in the RAID log, and so on.
- The **⋯** button lists every command for the open view, including the
  ones from the ribbon's other tabs.
- Save, Undo, Redo, Print, search and the **Project**, **Programme** and
  **Portfolio** switch stay in the bar along the top.

The Portfolio
-------------

Choose **Portfolio** in the bar along the top to leave the project. The
portfolio's views (Projects, Status, Actions, Risks and so on) become the
tabs, and its commands, such as New Project and Export Report, are on the
toolbar.

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
