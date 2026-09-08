How to Use the Kanban Board
============================

The Kanban board (also called the **Board** view) shows your tasks as cards organised into columns. It is useful for visualising work in progress and managing task flow.

Open the Kanban Board
----------------------

After rendering your plan, click **Board** in the project sub-navigation bar.

.. figure:: /_static/img/how-to/kb-01-kanban-phase.png
   :alt: Kanban board with tasks grouped by project phase
   :width: 100%

   The Kanban board grouped by phase, showing task cards in columns.

Choose a Grouping Mode
-----------------------

Use the **View by** dropdown at the top of the board to change how tasks are grouped into columns:

- **Phase** — columns correspond to your plan phases (most common)
- **Resource** — one column per team member
- **Progress** — columns group by completion bracket (Not Started, In Progress, Complete)
- **Label** — columns based on task labels
- **Bucket** — columns based on task bucket

How Plan Depth Maps to the Board
--------------------------------

In **Phase** mode the column level follows your current drill-down position.
At the root, top-level summary tasks are columns and their direct children are
cards. Select **View Subtasks** on a summary card to move the board down one
level: summary tasks at that level become columns and their direct children
become cards. You can repeat this at any depth, and use the breadcrumb to move
back up.

A card's immediate children appear in the **Sub Tasks** checklist in Task
Details. Select a child there to open the same full Task Details form for that
child; this works recursively at every depth.

Move Cards
-----------

Cards can be dragged between columns. Moving a card:

- Updates the task's phase (when grouped by phase)
- Updates the resource (when grouped by resource)
- Updates the completion bracket (when grouped by progress)

The Markdown plan is updated immediately and exactly once, so the change is
reflected in every other view and survives a reload.

Only **Phase** mode has meaningful positional ordering. Dragging a card above
or below another card in that mode reorders the task and its complete subtree in
the plan. If the move separates a ``*`` task from its predecessor, the Board
expands the shorthand to an explicit ``[depends: ...]`` link so the dependency
is not changed accidentally. Moving the tasks back together does not collapse
that explicit link to ``*`` again. Resource, Progress, Label, and Bucket modes allow
moving cards between columns to change the corresponding task field, but do not
offer within-column reordering.

To move a focused card without a mouse, press ``Alt+Left`` or ``Alt+Right``.
The **Move…** control on each card provides the same operation for keyboard and
touch users. Press ``Escape`` to cancel a drag before dropping it.

Click a Card
-------------

Click any card to open the **Task Details** panel where you can edit all task fields.

Reading Card Information
-------------------------

Each card shows:

- Task name
- Assigned resources (as avatars or initials)
- RAG status indicator (coloured dot)
- Completion percentage

Filter the Board
-----------------

Use **Hide Completed** to filter out completed cards and **Sort by Priority** to
order visible cards. Use the triangle in a column header to collapse or expand
that column.

The selected view mode, filters, sorting, and collapsed columns are remembered
separately for each project and restored when the page reloads. The board is
always re-derived from the current Markdown when opened, including on the first
load of a project.

Related
--------

- :doc:`../reference/views` — overview of all views
- :doc:`../explanation/rag-status` — understanding RAG status
