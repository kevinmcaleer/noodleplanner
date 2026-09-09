How to Use the Notepad View
=============================

The Notepad view is a second, deliberately minimal way to build a plan: type a line, press Enter, get a task. There is no front matter, no Markdown syntax, and no jargon on screen — just an indented list, the same way a plain notepad or outliner app works. Underneath, it edits the exact same Markdown document as every other view, so nothing is lost moving between them.

Open the Notepad View
-----------------------

After rendering your plan, open **Home > Views > Notepad** in the ribbon (or **Views > Notepad** in the sub-navigation bar).

.. figure:: /_static/img/how-to/np-01-notepad-view.png
   :alt: The Notepad view showing an indented task list with a Board view button
   :width: 100%

   The Notepad view: an indented list of tasks with a ready-to-type row at the end.

Build an Outline
------------------

- **Type a line, press Enter** — the line becomes a task, and a new empty row is ready for the next one.
- **Tab** indents the current line under the line before it; **Shift+Tab** outdents it. This works both on a task you have already created and on the line you are currently typing.
- **Backspace** at the start of an empty line removes that task and moves you back to the end of the previous one. A task with children cannot be removed this way — clear or move its children first.
- **Drag** a row by its handle (the ``☰`` icon that appears on hover, or always visible on touch) to reorder it among its siblings. This works with a mouse and with touch.
- Click into any existing line to rename it. Renaming preserves any Markdown metadata already on that line (dates, resources, dependencies) — only the task's name changes.

Because every change goes through the same plan model the Markdown editor uses, a plan built entirely in the Notepad view, opened in the editor, and saved back is byte-identical unless you changed it there too.

Switch to the Board
---------------------

Click **Board view** in the Notepad toolbar to switch to the :doc:`Kanban board <use-the-kanban-board>`. The two are different lenses over the same plan text — a task added, renamed, or reordered in one is reflected in the other immediately, in both directions, because they share the same underlying document rather than keeping two separate copies in sync.

Related
--------

- :doc:`../reference/views` — overview of all views
- :doc:`use-the-kanban-board` — grouping and moving tasks visually
