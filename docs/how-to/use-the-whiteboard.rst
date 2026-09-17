How to Use the Whiteboard
===========================

The Whiteboard is a free-form canvas of post-it notes. You can write a plan on it from nothing: each post-it is a task, and linking two together with a **noodle** makes one a subtask of the other. The structure you build appears as a collapsible outline floating on the left, which is also how you find a note again once the board gets busy.

It works the other way round too — a task that already exists in your plan can be pulled onto the board — so you can start loose and formalise later, or start from an existing plan and rearrange it visually.

Open the Whiteboard
---------------------

Click **Views ▾** in the project sub-navigation bar, then choose **Whiteboard**.

.. figure:: /_static/img/how-to/wb-01-whiteboard-notes.png
   :alt: Post-it notes on the whiteboard, linked by curved noodles, with the plan structure panel floating on the left
   :width: 100%

   A board mid-session: post-its, the noodles linking them, and the plan structure panel.

Add a Post-it
---------------

Any of these creates a new task in your plan and puts a note for it on the board:

- **Double-click** an empty part of the canvas — the note lands where you clicked.
- Press ``n``.
- Click **New post-it** in the toolbar.

The note appears with its title already selected, so just type the name and press ``Enter``. Until you name it, it is called ``New idea``.

.. note::

   A post-it is a real task, straight away. It starts at the top level of your plan and shows up everywhere else — the Tasks table, the Gantt chart, the outline — immediately. Nothing needs to be "promoted" later.

Free-form Notes
------------------

A brand-new post-it starts as a **free-form note**: just a title, with no checklist, dates or subtasks forced onto it. That is the whole point — the fastest way to get a thought onto the board is to type it and stop.

If you also want a line or two of detail, open **Open task details** on the note's ``...`` menu and fill in **Comment**. It shows up in the note's body.

The moment you give the note its *first* subtask — typing one into the ``Add task…`` row at the bottom of the note, indenting a task under it in the outline, adding one from the task form, or noodling an existing note underneath it — the note switches to a checklist automatically (see `Tick Off a Todo`_ below). There is no separate "add a checklist" step, no button to press first, and no way to switch back short of removing every subtask again.

The ``Add task…`` row is the usual way. Every note has one, free-form notes included: click it, type the task, press ``Enter``. On a free-form note that first task *is* the switch to a checklist — the note becomes a summary task because it now has something underneath it, not because you asked it to become one.

**Promote to task** on a free-form note's ``...`` menu does the same thing from the text you have already written: it turns the note's own **Comment** into a real subtask underneath it. If the note has no comment yet, it asks you to name the new subtask instead. Either way it is one action, and undoing it removes the subtask and returns the note to free-form.

The **Text note** button in the toolbar (next to **Add title**) creates the same free-form note as **New post-it** — it's simply a second way to reach it from alongside the board's other bare-canvas tools.

Use Facilitator Prompts
-------------------------

Select the ``✦`` on a note to open a small set of planning questions. If
the task starts with activity-shaped language such as "Draft", "Build" or
"Installing", the sparkle is highlighted and offers a gentle hint that
the real deliverable may be the thing the activity produces. It is only a
suggestion; NoodlePlanner never silently rewrites or classifies the task.

You can optionally mark the item as **Product** or **Activity**. These are
ordinary ``#product`` and ``#activity`` task labels, so they stay visible
and editable everywhere else. Select the active type again to leave the
task untyped.

The same panel asks a short, fixed set of useful questions: whether the
item needs approval, what it produces, and what must be true before it can
start. Choosing one asks you to name the answer, creates it as a new
post-it beside the current note, and adds a real predecessor or successor
dependency to the plan. **Who owns it?** opens the existing task-details
resource field rather than inventing a second assignment interface.

Activity-shaped checklist rows carry the same small ``✦`` hint, so you do
not have to turn a subtask into its own note just to use the prompts.

Rename a Note
---------------

Double-click a note's **header** (or double-tap it on a touchscreen) and type. ``Enter`` saves, ``Escape`` abandons the change. There is also a **Rename** item on the note's ``...`` menu.

Renaming from here renames the task itself, and updates anything that pointed at the old name — dependencies included — in one step.

Link Notes with Noodles
-------------------------

Each note's header has a small noodle handle next to the ``...`` button. **Drag it onto another note** to make that note a subtask.

While you drag, a dashed line follows your pointer and the note you are hovering is outlined: green if the link is allowed, red if it isn't. Drop it, and the target note drops in under the first one.

A noodle is not decoration — it *is* your plan's structure:

- The target note (and everything already under it) moves under the source in the outline.
- The target note grows an "under …" caption naming its new parent.
- The plan structure panel on the left re-nests to match.

Some links are refused, with a short message explaining why: a note cannot be linked to itself, cannot be linked to something already under it (that would make a loop), and a link that already exists does nothing.

Unlink Notes
--------------

**Click a noodle** to select it. It turns orange and a ``✕`` appears at its midpoint. Then either click the ``✕`` or press ``Delete``.

You can also use **Unlink from "…"** on the note's ``...`` menu, which is easier to hit on a crowded board.

.. note::

   Unlinking never deletes anything. The task moves back to the top level of your plan, keeping its own subtasks. To actually remove a task, use **Delete task** on the ``...`` menu — that one asks for confirmation, because unlike everything else on the board it destroys plan content.

Draw Dependency Links
-----------------------

Dependencies are drawn from a **task row**, not from a note. Hover a checklist row and a small handle appears at its right-hand end; drag it onto another task's row to draw a real scheduling dependency — the first task must finish before the second starts — the same relationship the ``[depends: ...]`` syntax and the Gantt view already use.

Rows are the endpoints because only an individual task can have a dependency: a summary task's dates come from its children, so a summary row offers no handle at all, and dropping onto one is refused.

A dependency noodle is dashed and purple, so it never reads as a hierarchy link (solid, blue) even on a board that has both. As you drag, every row you pass over shows whether the link would be accepted.

Creating a link that would make a circular dependency (A depends on B, which already depends on A) is refused with a short message, the same way a self-link or an already-linked pair are refused for hierarchy noodles.

Unlinking a dependency noodle works exactly like unlinking a hierarchy one — click to select, then the ``✕`` or :kbd:`Delete` — and removes only the dependency, never the task or its subtasks.

The Plan Structure Panel
--------------------------

The panel floating on the left of the canvas shows your whole plan as a collapsible outline, whether or not each task has a note on the board.

- **Collapse or expand** a branch with its chevron; the header's two buttons collapse or expand everything at once.
- **A filled dot** marks a task that has a note on the board. A hollow one marks a task that doesn't.
- **Click a row** to fly the board to that note, which flashes so you can spot it. This is the quickest way to find a note on a large board.
- **Type in the search box** to filter to matching tasks and their parents. Search ignores collapsed branches, so a result is never hidden from you.
- **Click the ``+``** on a row without a note to put that task on the board.
- **Drag a row's grip** (``⠿``) to restructure the plan. Dropping on the top half of another row moves it to sit just above that row; dropping on the bottom half moves it to sit just below — either way, at that row's own level, so dragging a nested task next to a top-level one un-nests it in the same move. Dropping on the bottom half **and** well to the right instead nests it as that row's sub-task — a deliberately different spot so a plain reorder is never mistaken for "make this a sub-task", or the reverse.

.. figure:: /_static/img/how-to/wb-04-plan-structure.png
   :alt: The plan structure panel, listing phases and their subtasks with collapse chevrons and dots marking which tasks are on the board
   :width: 60%

   The plan structure panel. Filled dots mark the tasks that have a note on the board.

Hide the panel with the ``‹`` button in its header, or the **Structure** button in the toolbar; a small **Structure** tab stays pinned to the canvas edge to bring it back. Whether the panel is open, and which branches you collapsed, is remembered per project on this device — it is never written into your plan file.

Put an Existing Task on the Board
-----------------------------------

The whiteboard only shows the tasks you have explicitly added — it is a curated view, not your whole plan automatically.

1. Click **Add existing** in the whiteboard toolbar (or the matching button on an empty board).
2. Tick one or more tasks. Two same-named tasks in different phases are told apart by the ``Phase › Sub-phase`` path shown under the name. Type in the search box to filter by name or phase.
3. Click **Add note** (it reads **Add N notes** once more than one is ticked).

Each note lands in the first free space of your current view that does not overlap an existing note. To lay out every phase at once, use **Add all summary tasks** on the empty-state message.

Move and Resize a Note
------------------------

- **Move** — drag a note by its coloured header. Any noodles attached to it follow.
- **Resize** — drag the small grip in its bottom-right corner.
- **Bring to front** — click or drag a note; it always comes to the front of the others, and stays there after a reload.

Both moving and resizing save once you release, as a single undo step — nothing is written while you are still dragging.

Tick Off a Todo
-----------------

Once a note has at least one subtask, it lists them as a checklist with a progress footer (``2 / 5``) — this is what a `Free-form Notes`_ note turns into the moment it earns its first subtask. Click a checkbox to mark one complete or incomplete. This is the same completion state shown everywhere else in NoodlePlanner (the Kanban board, Tasks table, and so on) — ticking it here updates the task itself, not just the note.

A subtask that has a post-it of its own is **not** listed in the checklist; it is the noodle leaving that note instead. That way one relationship is only ever shown once. If a note has both kinds, a quiet ``+ N linked notes`` line at the bottom of the list says so.

Drill Into a Subtask
----------------------

A child task that itself has children shows a count badge (for example ``2 ▾``) instead of just sitting there as a plain row. Click the badge, or the row itself, to open a small popover listing that task's own direct children — name, assignee, and a checkbox for each, plus a further badge if one of *those* has children too. A breadcrumb at the top lets you step back up through the levels you have drilled into.

.. figure:: /_static/img/how-to/wb-03-task-peek.png
   :alt: A task-peek popover open over a note, showing "Requirements gathering"'s own two subtasks with checkboxes
   :width: 100%

   Drilling into "Requirements gathering" opens a popover for its own subtasks.

This popover is deliberately lightweight — just name, assignee and completion. For anything else (dates, dependencies, comments, and so on), click **Open task details** at the top of the popover, or on the note's own ``...`` menu, to open the full task form for that task.

Colour a Note
---------------

Click the ``...`` menu in a note's top-right corner. The menu opens a swatch grid of soft pastel colours — two shades each of yellow, pink, green, blue and red — plus a **Default colour** option at the top to clear any colour you have set. This is purely a personal, manual choice: it carries no meaning of its own and has nothing to do with the Kanban board's rule-based conditional formatting.

.. figure:: /_static/img/how-to/wb-02-note-colour-menu.png
   :alt: A note's "..." menu open, showing the Default colour option and a grid of pastel colour swatches
   :width: 100%

   The note colour menu, opened from a note's ``...`` button.

A colour you pick here is the same colour the Kanban board's column header and the mind map's branch use for that task — set it on any one of the three views and it shows up on the other two. Pick **Default colour** to go back to the automatic pastel colour NoodlePlanner assigns every task, based on its place in the outline.

Remove a Note from the Board
-------------------------------

Open the note's ``...`` menu and choose **Remove from board**.

.. note::

   Removing a note only takes it off the whiteboard. The task and every one of its subtasks are left completely untouched in your plan's outline — nothing is deleted. There is no confirmation prompt; like every other change on the whiteboard, it is one ordinary undo step, so ``Ctrl+Z``/``Cmd+Z`` brings the note straight back if you remove the wrong one.

   To delete the task itself, use **Delete task** on the same menu instead.

Adding the same task back later gives it a fresh position on the board — it does not remember where the old note used to sit.

Send an Idea to the Parking Lot
----------------------------------

Not every post-it is ready to become a task yet. For a "good idea, not now" — something worth keeping but not worth cluttering the board or the plan with — open the note's ``...`` menu and choose **Send to parking lot**, or drag the note's header straight onto the open parking lot panel (see below) and drop it there.

Unlike **Remove from board**, this genuinely takes the idea out of the working plan: the task (and any subtasks it has) is deleted from the outline, and the whiteboard row goes with it, but the note's own text and appearance — its title, its comment if it had one, its colour, and (for a checklist note) every item and its completion state — is kept as a new entry in the parking lot rather than thrown away. There is no confirmation prompt and it is one ordinary undo step, the same as every other board action.

Click **Parking lot** in the whiteboard toolbar to slide the panel out from the board's right edge — a second click slides it back in. It lists everything sent there, each row showing the parked text and the date it was parked, with two actions per row: **Restore** rebuilds the note (and, for a checklist, every item on it) back onto the board, and **Remove** deletes the entry for good once you are sure you do not need it. Dragging a row out of the panel and dropping it on the board restores it at the exact spot you dropped it, rather than wherever free space happens to be, and dragging one row onto another reorders the list. The board stays interactive while the panel is open — it is a panel alongside your work, not a dialog blocking it.

Keyboard and Pointer Reference
--------------------------------

.. list-table::
   :header-rows: 1
   :widths: 40 60

   * - Gesture
     - Does
   * - Double-click empty canvas, or ``n``
     - New post-it (and a new task)
   * - Double-click a note's header
     - Rename the task in place
   * - Drag the noodle handle onto another note
     - Make that note a subtask
   * - Click a noodle, then ``Delete``
     - Unlink; the task returns to the top level
   * - Drag empty space, or scroll
     - Pan the board
   * - ``Ctrl``/``Cmd`` + scroll, or pinch
     - Zoom
   * - Arrow keys
     - Pan
   * - ``+`` / ``−`` / ``0``
     - Zoom in, out, reset to 100%
   * - ``f``
     - Fit the board to its contents
   * - ``Escape``
     - Deselect a noodle, or abandon a rename

Related
--------

- :doc:`../reference/views` — overview of all views, including the Whiteboard
- :doc:`../reference/plan-format` — the ``---whiteboard---`` back-matter format, column by column, and why noodles are not stored in it
- :doc:`../explanation/whiteboard-layout-vs-viewport` — why a note's position is saved in your plan but pan/zoom isn't
- :doc:`use-the-kanban-board` — another view that shares the same task colours
- :doc:`use-the-mind-map` — another view that shares the same task colours
