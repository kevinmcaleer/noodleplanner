How to Use the Guided Plan Wizard
====================================

The Guided Plan wizard walks a first-time user through building a plan one step at a time — **D**\ esign, **A**\ dd tasks, **D**\ ependencies, **E**\ stimating, **S**\ cheduling, **R**\ isks, **C**\ omms (DADESRC) — without needing to know Markdown syntax or find the right view on their own.

Each stage of the wizard is a small floating panel that sits over whatever view it switches you to; it never blocks you from using that view directly, and every stage can be skipped or revisited in any order.

Open the Wizard
------------------

Open **Plan > Wizard > Guided Plan** in the ribbon.

The wizard panel appears in the corner of the screen with seven numbered steps across the top, a short description of the current stage, and **Back**, **Skip** and **Next** controls.

Move Through the Stages
--------------------------

- **Click a step number** to jump straight to that stage — stages are never locked behind earlier ones.
- **Next** marks the current stage visited (shown with a check) and moves to the next one.
- **Skip** marks the current stage skipped (shown with a dash) without visiting it, and moves on.
- **Back** returns to the previous stage.
- On the last stage, **Next** becomes **Finish** and closes the wizard.
- The **×** in the panel header closes the wizard at any point — your progress is remembered, so reopening **Guided Plan** later picks up exactly where you left off.

What Each Stage Does
------------------------

Every stage hosts an existing NoodlePlanner view rather than a separate mini version of it — entering a stage switches you to that view and, where relevant, sets it up automatically:

- **Design** — opens Backstage, where you start a blank plan or pick a template to start from.
- **Add Tasks** — opens the :doc:`Notepad view <use-the-notepad>` for typing tasks without Markdown.
- **Dependencies** — opens the :doc:`Whiteboard <use-the-whiteboard>`, where dragging the handle on one task's checklist row onto another row links them.
- **Estimating** — opens the Tasks view; use a task's **Estimate…** menu item for a three-point or t-shirt estimate.
- **Scheduling** — opens the Tasks view, colour-coded by schedule health, and reports anything in the plan that breaks (see below).
- **Risks** — opens the RAID log for capturing risks against tasks.
- **Comms** — opens the communications plan.

Each stage also switches on the matching highlighting preset (see :doc:`../reference/plan-syntax`'s Syntax Highlighting section), so the editor only colours what's relevant to the step you're on — for example, the Dependencies stage highlights dependency links and nothing else.

Check What Breaks
--------------------

The **Scheduling** stage is the one stage that shows something of its own inside the wizard panel: a report of everything in the plan that does not work.

Set a deadline on a task first — open the task in the Tasks view and fill in its **Deadline** field. A deadline is a promise, not a date that moves work: it never reschedules anything, it just gives the plan something to be measured against.

The panel then lists, worst first:

- **Deadline missed** — the task is scheduled to finish after its deadline, and by how many days.
- **Deadline passed** — the deadline is already in the past and the task is not finished.
- **Dependency conflict** — the scheduler could not honour a link (a circular dependency, or one that fights the outline), so the dates downstream of it are optimistic.
- **Not scheduled** — a task that something depends on, or that carries a deadline, but has no dates of its own yet; give it a duration so the scheduler can place it.

Click any row to open that task, fix it, and the report updates as soon as the plan re-schedules. **Re-check** re-runs the scheduler by hand.

If nothing is wrong the panel says so, and says how many deadlines it checked — an empty list and no deadlines at all are different answers.

.. note::

   The Design stage opens Backstage, where a blank plan is always available; starting from a ready-made template is being built separately. Every stage is independently skippable, so this doesn't block the rest of the flow.

On a Tablet
--------------

The whole flow is usable by touch. The panel floats over the view it switches you to, at both landscape and portrait tablet sizes, without pushing the page into horizontal scrolling; step chips, the Back/Skip/Next controls, the close button and each row of the Scheduling report all meet the 44-pixel activation area described in :doc:`use-touch-controls`.

Related
--------

- :doc:`use-the-notepad` — the Add Tasks stage's host view
- :doc:`use-the-whiteboard` — the Dependencies stage's host view
- :doc:`use-conditional-formatting` — the highlighting presets each stage applies
- :doc:`../reference/plan-syntax` — the ``D2026-09-10`` deadline marker the Deadline field writes
- :doc:`use-touch-controls` — the touch conventions the panel follows
