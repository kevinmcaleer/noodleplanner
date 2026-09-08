How to Use the Whiteboard
===========================

The Whiteboard is a free-form canvas of post-it notes, one per summary task you choose to put there. Each note shows that task's own direct children as a todo list, with checkboxes, an assignee chip, and a way to drill further down when a child has children of its own.

Open the Whiteboard
---------------------

Click **Views ▾** in the project sub-navigation bar, then choose **Whiteboard**.

.. figure:: /_static/img/how-to/wb-01-whiteboard-notes.png
   :alt: Two post-it notes on the whiteboard, "Discovery & Planning" and "Design", each listing its own subtasks with checkboxes
   :width: 100%

   Two summary tasks on the board, each rendered as a note.

Put a Summary Task on the Board
---------------------------------

The whiteboard only ever shows the summary tasks you have explicitly added — it is a curated view, not every phase automatically.

1. Click **+ Add note** in the whiteboard toolbar (or, on an empty board, the **Add note** button in the empty-state message).
2. In the **Add notes to whiteboard** dialog, tick one or more summary tasks. Two same-named tasks in different phases are told apart by their ``Phase › Sub-phase`` path shown under the name. Type in the search box to filter by name or phase.
3. Click **Add note** (it reads **Add N notes** once more than one is ticked).

Each note lands in the first free space of your current view that does not overlap an existing note. To add every summary task at once, use **Add all summary tasks** on the empty-state message instead of the picker.

Move and Resize a Note
------------------------

- **Move** — drag a note by its coloured header.
- **Resize** — drag the small grip in its bottom-right corner.
- **Bring to front** — click or drag a note; it always comes to the front of the others, and stays there after a reload.

Both moving and resizing save once you release, as a single undo step — nothing is written while you are still dragging.

Tick Off a Todo
-----------------

Click the checkbox next to any item in a note's list to mark it complete or incomplete. This is the same completion state shown everywhere else in NoodlePlanner (the Kanban board, Tasks table, and so on) — ticking it here updates the task itself, not just the note.

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

Click the ``...`` menu in a note's top-right corner. The menu opens a swatch grid — Palette, Pastel and Dark rows, plus a **Default colour** option at the top to clear any colour you have set.

.. figure:: /_static/img/how-to/wb-02-note-colour-menu.png
   :alt: A note's "..." menu open, showing the Default colour option and Palette/Pastel/Dark colour swatch grids
   :width: 100%

   The note colour menu, opened from a note's ``...`` button.

A colour you pick here is the same colour the Kanban board's column header and the mind map's branch use for that summary task — set it on any one of the three views and it shows up on the other two. Pick **Default colour** to go back to the automatic palette colour NoodlePlanner assigns every task, based on its place in the outline.

Remove a Note from the Board
-------------------------------

Open the note's ``...`` menu and choose **Remove from board**.

.. note::

   Removing a note only takes it off the whiteboard. The summary task and every one of its subtasks are left completely untouched in your plan's outline — nothing is deleted. There is no confirmation prompt; like every other change on the whiteboard, it is one ordinary undo step, so ``Ctrl+Z``/``Cmd+Z`` brings the note straight back if you remove the wrong one.

Adding the same task back later gives it a fresh position on the board — it does not remember where the old note used to sit.

Related
--------

- :doc:`../reference/views` — overview of all views, including the Whiteboard
- :doc:`../reference/plan-format` — the ``---whiteboard---`` back-matter format, column by column
- :doc:`../explanation/whiteboard-layout-vs-viewport` — why a note's position is saved in your plan but pan/zoom isn't
- :doc:`use-the-kanban-board` — another view that shares the same task colours
- :doc:`use-the-mind-map` — another view that shares the same task colours
