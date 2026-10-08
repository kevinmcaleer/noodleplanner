How to Use Initiatives
======================

An **initiative** is a smaller piece of work that still needs tracking: a bundle of related tasks with no milestones or gateways. It is a plan like any other (same markdown file, same project list), marked with ``type: initiative`` in its front matter.

An initiative may sit under a programme or stand alone.

Create an Initiative
--------------------

1. Open the **Portfolio** view.
2. Click **New Initiative** on the **Home** tab of the ribbon (or **+ Create Initiative** when the list is empty).
3. Enter a name. The new plan opens with a short task list ready to edit.

Initiatives show an **Initiative** badge in the Projects table. Once the portfolio holds at least one, a **Show** filter above the table narrows the list to all plans, projects, or initiatives.

What an Initiative Shows
------------------------

The ribbon for an initiative is smaller than a project's. It keeps the task list, the board, actions, highlights, resources and stakeholders, and leaves out the project-only structure (Gantt, milestones, PBS, baselines, RAID, budget).

Resources and stakeholders live in the initiative's front matter exactly as they do for a project; see :doc:`../reference/front-matter`.

State the RAG
-------------

A project's RAG is worked out from its schedule. An initiative has no schedule rigor to work it out from, so you state it:

1. On the **Home** tab, under **Track**, click **Rate**.
2. Choose Green, Amber or Red, and add a short comment.
3. Click **Save**.

This writes ``rag``, ``rag_comment`` and ``rag_updated`` to the front matter. An initiative nobody has rated shows **Not Rated** everywhere; it is never counted as green.

Put an Initiative Under a Programme
-----------------------------------

Add ``programme: <slug>`` to the front matter, exactly as for a project. Selecting the initiative in the Projects table and choosing **Group into programme** does the same. The programme view lists it with an **Initiative** badge.

From inside an open initiative you can also click **Programme** on the **Home** tab, under **Track**, choose an existing programme and click **Save**. Choose **No programme** to take it back out. Programmes are not created here; group projects into one from the Portfolio first.

Portfolio Report
----------------

Initiatives are included in the portfolio report. Each is labelled ``(Initiative)``, shows its stated RAG (or **NOT RATED**) and puts its RAG comment in the Status column. Not-rated initiatives sort after rated ones.

See :doc:`use-the-portfolio-view` for the rest of the portfolio.
