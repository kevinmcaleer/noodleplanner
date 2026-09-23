Plan Quality Checks
===================

NoodlePlanner reviews your plan for the problems that most often make a
schedule wrong or misleading, and tells you how to fix each one. The same
review appears in three places:

- the **Plan review** at the top of the **Analysis** view (**Report** ▸
  Reports ▸ **Analysis** on the ribbon);
- ``noodle analyze plan.md`` on the command line;
- the AI assistant, through its ``analyse_plan`` and ``apply_plan_fix`` tools,
  and the **Planning Agent**, which is given the review before it gives its
  own advice.

.. figure:: /_static/img/reference/pq-01-plan-review.png
   :alt: The Plan review panel, showing a health score, severity filters, and findings grouped into errors, warnings and suggestions
   :width: 100%

   The Plan review in the Analysis view.

Using the review
----------------

- Findings are grouped by severity, most serious first. The chips above the
  list filter by severity; the search box filters by any text in a finding,
  a task name, or a check's name below.
- **Line N · Task** jumps to the line in the editor.
- **How to fix** says what to change. **More about this check** opens the
  entry on this page.
- **Apply fix** appears where the fix is unambiguous. It edits only the lines
  the fix is about, and it is a single step you can undo with **Ctrl+Z** (or
  **Undo** on the ribbon).

The review runs whenever the Analysis view is open and the plan changes. It
schedules the plan exactly as the chart does -- same calendar, same
non-working days -- so a finding always refers to the dates you can see.

Severity
--------

Error
   The schedule is not what the plan says. Something in the plan is ignored
   or contradictory, so dates shown elsewhere are wrong. Fix these first.

Warning
   The schedule is computed as written, but it is probably not what you
   meant, or it will mislead whoever reads it.

Suggestion
   The plan is sound; this is good practice it does not follow yet.

Plan health score
-----------------

The score starts at 100 and loses 15 points for each error, 5 for each
warning and 1 for each suggestion. Each *kind* of problem costs at most three
findings' worth, so a single habit repeated forty times (forty tasks with no
owner) cannot drown out everything else. The score never goes below 0.

======================  ==========
Score                   Grade
======================  ==========
90 -- 100               Healthy
70 -- 89                Fair
50 -- 69                Needs attention
0 -- 49                 At risk
======================  ==========

The score is a triage aid, not a verdict on the project. It measures how
much of the plan can be trusted as written, not whether the project will
succeed: a plan can score 100 and still be late.

The checks
----------

Structure
~~~~~~~~~

.. _missing-front-matter:

missing-front-matter
^^^^^^^^^^^^^^^^^^^^

**Warning.** The plan has no front matter, so it has no title, resources or
calendar. *Fix:* start the plan with a line of three dashes, ``title: Your
project``, any ``Resources:``, then another line of three dashes. **Apply
fix** adds a front-matter block with a placeholder title.

.. _missing-title:

missing-title
^^^^^^^^^^^^^

**Suggestion.** The front matter has no ``title:``. *Fix:* add one. **Apply
fix** adds ``title: Untitled plan`` for you to rename.

.. _undeclared-resource:

undeclared-resource
^^^^^^^^^^^^^^^^^^^

**Warning.** A task is assigned to ``@someone`` who is not listed under
``Resources:``, so reports show a short name with no role. *Fix:* declare
them, e.g. ``- @alex: Alex Chen, Developer``. **Apply fix** adds the entry
with the short name capitalised, for you to complete. Names are matched
without regard to case.

.. _no-duration:

no-duration
^^^^^^^^^^^

**Warning.** A task has no duration, so it is scheduled as one day. *Fix:*
add one, e.g. ``3d`` or ``2w``. Milestones (``0d``) and effort-driven tasks
(``~4h``) are not reported. Durations in hours are not supported -- a task
written ``4hours`` has no duration and is reported here.

.. _empty-summary:

empty-summary
^^^^^^^^^^^^^

**Warning.** A top-level line with no details and nothing indented under it
looks like a phase heading but is scheduled as a one-day task. *Fix:* indent
the phase's tasks under it, or delete the line. This check replaces
``no-duration`` for such lines.

.. _long-duration:

long-duration
^^^^^^^^^^^^^

**Suggestion.** A task runs for more than 40 working days. Tasks that long are
hard to track: nothing shows progress until they end. *Fix:* break it into
smaller tasks.

.. _no-resource:

no-resource
^^^^^^^^^^^

**Suggestion.** Nobody is assigned to a task. Tasks that inherit an owner
from their phase count as owned. *Fix:* add ``@name`` to the task or its
phase. A task on the critical path with no owner is reported as
``critical-no-owner`` instead.

.. _milestone-with-duration:

milestone-with-duration
^^^^^^^^^^^^^^^^^^^^^^^

**Warning.** A task whose name says it is a milestone has a duration. *Fix:*
make it ``0d``. **Apply fix** does that.

.. _child-outside-parent:

child-outside-parent
^^^^^^^^^^^^^^^^^^^^

**Warning.** A phase line carries its own start date or deadline
(``D2026-06-30``), and one of its tasks starts before it or finishes after it.
*Fix:* move the task, or change the phase's date. (A phase's dates are
otherwise always the span of its tasks, so this can only happen when the
phase line has a date of its own.)

Dependencies
~~~~~~~~~~~~

.. _dangling-dependency:

dangling-dependency
^^^^^^^^^^^^^^^^^^^

**Error.** ``[depends X]`` names a task that is not in the plan. The scheduler
ignores it, so the task is not held back by anything. The finding suggests
the task you probably meant. *Fix:* correct the name. **Apply fix** removes the
dependency -- safe, because it currently has no effect -- which you can then
re-add with the right name.

.. _phase-dependency:

phase-dependency
^^^^^^^^^^^^^^^^

**Error.** A task depends on a phase, or a phase line carries a
``[depends ...]`` of its own. The scheduler links tasks, not phases, so the
dependency is ignored. *Fix:* depend on the phase's last task (or a ``0d``
milestone at its end), and move a phase's own dependency onto its first task.

.. _circular-dependency:

circular-dependency
^^^^^^^^^^^^^^^^^^^

**Error.** Tasks depend on each other in a loop, or a task depends on its own
phase or subtask. *Fix:* remove one link in the loop. Where the loop is a task
depending on its own phase or subtask, **Apply fix** removes that link.

Schedule quality
~~~~~~~~~~~~~~~~

.. _critical-no-owner:

critical-no-owner
^^^^^^^^^^^^^^^^^

**Warning.** A task on the critical path has nobody assigned. If it slips the
end date slips, so someone must own it. *Fix:* assign an owner.

.. _over-allocation:

over-allocation
^^^^^^^^^^^^^^^

**Warning.** Someone has more than a full day of work on at least one working
day: two tasks at once, or shares that add up to more than 100%. Each task
takes a whole day of each of its resources unless you give a share, e.g.
``@alex[50%]``. Days that are non-working for that person are not counted.
*Fix:* stagger the tasks with dependencies, share the work, or level the plan.

.. _non-working-day:

non-working-day
^^^^^^^^^^^^^^^

**Warning.** A task's start date falls on a weekend, a project holiday, or one
of its resource's non-working days. The scheduler moves it to the next working
day, so the plan says one date and the chart shows another. **Apply fix**
changes the date to the one the scheduler uses.

.. _long-chain-no-milestone:

long-chain-no-milestone
^^^^^^^^^^^^^^^^^^^^^^^

**Suggestion.** Eight or more tasks follow one another with no milestone
among them, so there is no point at which progress along the chain can be
checked. *Fix:* add a ``0d`` milestone part-way along. Reported once per
chain, at its end.

.. _no-slack:

no-slack
^^^^^^^^

**Suggestion.** Every task is on the critical path although some run in
parallel: there is no float anywhere, so any slip delays the end date. A
schedule with zero float is fragile, not efficient. *Fix:* add contingency, or
make independent work genuinely independent. A single straight chain of tasks
has no float by construction and is not reported.

Progress and governance
~~~~~~~~~~~~~~~~~~~~~~~

.. _stale-progress:

stale-progress
^^^^^^^^^^^^^^

**Warning.** A task was due to finish before today but is less than 100%
complete. *Fix:* update its percent complete, or move its dates if it has not
started.

The next four checks apply only to a plan of at least eight tasks that is
*under way* -- one with progress recorded, or with work dated in the past. A
new plan or a template is not expected to have them yet.

.. _no-raid:

no-raid
^^^^^^^

**Suggestion.** No RAID log entries. *Fix:* record risks, assumptions, issues
and decisions in the RAID view (``---raid log---`` section).

.. _no-benefits:

no-benefits
^^^^^^^^^^^

**Suggestion.** No benefits defined. *Fix:* say what the project is for in the
Benefits view (``---benefits---`` section).

.. _no-stakeholders:

no-stakeholders
^^^^^^^^^^^^^^^

**Suggestion.** No stakeholders named. *Fix:* list them under
``Stakeholders:`` in the front matter, or in the Stakeholders view.

.. _no-baseline:

no-baseline
^^^^^^^^^^^

**Suggestion.** No baseline has been set, so slippage cannot be measured.
*Fix:* **Gantt Tools** ▸ **Set Baseline**. See :doc:`../how-to/use-baselines`.

Related
-------

- :doc:`views` -- the Analysis view
- :doc:`plan-syntax` -- durations, dependencies, resources
- :doc:`front-matter` -- resources, calendars, non-working days
- :doc:`../explanation/scheduling-engine` -- how dates are calculated
