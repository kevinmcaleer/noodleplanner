How to Use the Assignment and Slippage Reports
==============================================

Two reports answer the questions a status meeting always asks: *who is doing
what?* and *what has moved since we agreed the plan?* Both are on the
**Report** ribbon tab, in the **Reports** group: **By Assignment** and
**Slippage**. Both export to Excel and PowerPoint.

Tasks by Assignment
-------------------

.. figure:: /_static/img/how-to/rp-01-tasks-by-assignment.png
   :alt: The Tasks by Assignment report, with an Unassigned group first and a card per person listing their tasks and totals
   :width: 100%

   Each person's tasks, with the unassigned ones first.

Every task is listed under the person or role it is assigned to (``@name``).

- **Unassigned comes first.** Tasks nobody owns get their own group at the top,
  highlighted: that group is usually the one that needs attention.
- **Shared tasks** appear under everyone assigned to them, tagged *shared*, with
  the other people named in the **Shared with** column.
- A task given a share of someone's day (``@alex[50%]``) is tagged with the share,
  and only that share counts toward their **Work** total.
- A task that inherits its owner from its phase is tagged *from phase*.

Each person's card totals their tasks: how many, how many are **open** and
**complete**, their **work** in days, when their **next** task is due, and how many
are **overdue** (past their finish and not 100% complete).

Filter by **person**, **phase**, **status** (open, overdue or complete) and a
**from / to** date range (a task shows when it overlaps the range), and sort the
cards by name, most overdue, most tasks, most work, or next due date. Unassigned
stays at the top whatever the sort. Double-click a task to open it.

People are matched without regard to case or spacing, and a resource's short name
(``@alex``) and full name (Alex Chen, from ``Resources:``) are the same person.

Slippage
--------

.. figure:: /_static/img/how-to/rp-02-slippage.png
   :alt: The Slippage report: the project's variance in working days, critical-path slippage, a roll-up by phase, and every task sorted by variance
   :width: 100%

   What has moved since the baseline, largest slip first.

The Slippage report compares the schedule now with your **baseline** -- the copy
of the schedule you saved when the plan was agreed. If there is no baseline yet,
the report says so and offers to set one (see :doc:`use-baselines`).

From the top:

- **The headline** -- how many working days late or early the project now
  finishes, with a count of tasks that slipped, stayed on track, were pulled
  forward, or were added or removed since the baseline.
- **On the critical path** -- the slipped tasks on the critical path, on their
  own. These are the slips that move the end date.
- **By phase** -- each phase's finish against its baseline, how many of its tasks
  slipped, and its worst slip.
- **Every task** -- baselined and current start and finish, the variance of each,
  and a status, sorted with the largest slip first. Critical tasks are marked ◆.
- **Changed since the baseline** -- tasks added since, and baselined tasks that
  are no longer in the plan.

Variance is in **working days**, counted on your project's calendar: weekends,
``non-working-days`` and any ``calendar:`` are not counted. A finish that moves
from Friday to Monday has slipped by one working day, not three. Positive means
later than baselined (slipped), negative means earlier (pulled forward).

Tasks are matched to the baseline by name. If two tasks share a name, the first
is compared with the first baselined entry of that name, the second with the
second, and so on. A task renamed since the baseline shows as one task removed and
one added.

The report compares with the active baseline, named at the top. Setting a new
baseline replaces it.

Export
------

Each report has **Excel** and **PowerPoint** buttons. The export contains exactly
what the report is showing, filters included:

- **Tasks by Assignment** -- in Excel, a Summary sheet and a sheet per person; in
  PowerPoint, an overview slide and a slide per person.
- **Slippage** -- in Excel, Summary, Critical path, Phases, Tasks and Scope changes
  sheets; in PowerPoint, a headline slide followed by the same tables.

Related
-------

- :doc:`use-baselines` -- setting a baseline
- :doc:`manage-resources` -- declaring resources and roles
- :doc:`../reference/views` -- all views
- :doc:`../reference/export-formats` -- all export formats
