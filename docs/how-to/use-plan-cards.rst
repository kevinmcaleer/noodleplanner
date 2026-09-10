How to Reuse Plan Cards
=========================

A **card** is a named, reusable chunk of a plan — a phase, a set of governance tasks, a standard testing block — that you save once and drop into any plan afterwards. Cards save you retyping the same handful of tasks every time you start a similar project.

A card is just a saved fragment of the task outline: a task and everything nested under it. It is stored in your browser, the same way your projects are — nothing is sent to a server.

Save a Task as a Card
------------------------

1. Right-click the task you want to save (or open its context menu) and choose **Cards…**. This works on a single task or on a summary task with children — the whole subtree is captured.
2. In the **Cards** popup, type a name and click **Save**.

The card now appears in the list below, ready to reuse in this plan or any other.

.. note::
   Saving a card captures the task line exactly as written — durations, resources, tags and dependency links included. A dependency that points *outside* the saved subtree won't resolve when the card is dropped into a different plan, the same as pasting any task with a dangling ``[depends: ...]`` reference would.

Insert a Card
----------------

Open **Cards…** from any task's context menu, then pick a saved card from the list and choose how to insert it:

- **Insert as Tasks** adds the card's tasks immediately after the task you opened the menu from, at the same level, with its own internal nesting reconstructed. This is the quickest way to drop in a ready-made block.
- **Insert as Text** places the card's raw outline text at your current cursor position in the Markdown editor, so you can review or adjust it before it becomes part of the plan.

A card dropped under a summary task nests correctly underneath it, and the plan is immediately schedulable — inserting a card is no different from typing the same lines by hand.

Manage Your Cards
--------------------

Click the trash icon next to a card in the list to delete it. Cards are stored per browser, not per project, so a card saved from one plan is available in every plan you open afterwards.

Related
--------

- :doc:`use-the-notepad` — a minimal, jargon-free way to build a plan
- :doc:`use-project-templates` — starting a whole new plan from a template, rather than reusing a fragment of an existing one
