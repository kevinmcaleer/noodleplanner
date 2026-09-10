The Board Is a Lens on the Plan
================================

The Board does not keep a second copy of a project.  Markdown is the canonical
plan, and every Board column is a grouping of task nodes parsed from that text.
After a card changes, the Board writes the change to the plan model, serialises
the Markdown, and rebuilds itself from that result.  This is why an edit made in
one Board mode immediately agrees with the editor and every other view.

Phase is the structural view
----------------------------

Phase columns represent the outline itself.  At the Board root, top-level
summary tasks are columns and their direct children are cards.  Drilling into a
summary repeats that relationship one level deeper.  Moving a card in Phase
mode therefore moves its complete task subtree beneath another summary node;
reordering cards or columns changes outline order too.

Resource, Progress, Label, and Bucket are derived views.  They regroup the same
task nodes by metadata without changing the outline order.  A drop in one of
these modes edits a token on the task rather than moving the node structurally.
Within-column ordering consequently has meaning only in Phase mode.

What a drop writes
------------------

Each mode has one write-back rule:

* **Phase** moves the task node beneath the target phase header.  Moving to
  **Unassigned** makes it a root task.
* **Resource** replaces all ``@resource`` assignments with the target
  resource, or removes them for **Unassigned**.
* **Progress** writes ``0%`` for **Not Started**, ``50%`` for **In Progress**,
  or ``100%`` for **Complete**.
* **Label** replaces all ``#labels`` with the target label, or removes them for
  **Unlabeled**.
* **Bucket** replaces the task's ``{bucket}``, or removes it for **No Bucket**.

A task with several resources or labels is shown once in every matching
column.  Those cards are several representations of one task, not independent
copies.  Dropping any copy applies the single-column rule above, so all old
assignments are replaced and every representation refreshes together.

Columns and their order
-----------------------

Phase columns follow outline order.  Resource, Label, and Bucket columns first
follow their declaration order in front matter; values found only on tasks are
added in first-use order.  Progress always uses the fixed order **Not Started**,
**In Progress**, **Complete**.

The Board also supplies implicit fallback columns:

* **Unassigned** contains tasks without an assignable resource.  In Phase mode
  it represents root tasks that are not beneath a phase header.
* **Unlabeled** contains tasks with no ``#label``.
* **No Bucket** contains tasks with no ``{bucket}``.

Declared resources, labels, and buckets remain visible even when no task uses
them.  This lets a user drop a task into an intentionally empty column.

Progress, filtering, and priority
---------------------------------

Progress has three exact ranges: ``0%`` (or no percentage) is **Not Started**,
``1%`` through ``99%`` is **In Progress**, and ``100%`` or more is
**Complete**.  The Board's standard 25-point controls therefore place 25, 50,
and 75 in **In Progress**.

**Hide Completed** removes 100%-complete cards, and hides a column when that
leaves it empty.  **Sort by Priority** uses Urgent, Important, Medium, then Low
inside every column.  Both preferences are presentation rules applied equally
to all five views; neither rewrites Markdown.

Safe write-back
---------------

Rendered cards retain references to parsed plan nodes.  Before any mutation,
the Board obtains the model for the editor's latest text and re-resolves a
reference if the text changed after the card was rendered.  Card edits never
write to a cached physical line number.  This prevents an autosave,
collaboration operation, or editor insertion from redirecting a later Board
edit onto an unrelated line.

Related
-------

* :doc:`../how-to/use-the-kanban-board` — operate the Board
* :doc:`browser-first-architecture` — why the browser owns interactive plan state
* :doc:`browser-local-store` — which settings are local preferences rather than plan data
