Why Note Layout Is Plan Data but the Viewport Isn't
=====================================================

A whiteboard note has two kinds of state that both feel like "where things are on screen", and NoodlePlanner deliberately stores them in two different places. Anyone extending the board — a new note property, a new interaction — will trip over this split sooner or later, so it is worth understanding why it exists rather than just where each half lives.

The split
----------

.. list-table::
   :header-rows: 1
   :widths: 30 35 35

   * - What
     - Where it lives
     - Scope
   * - A note's **X**, **Y**, **Width**, **Height** and **Colour**
     - The plan's ``---whiteboard---`` back matter (see :doc:`/reference/plan-format`)
     - Per plan — the same on every device, every browser, every collaborator who opens the file
   * - The board's **pan** and **zoom**
     - The browser's ``localStorage``, keyed by project id (``whiteboard_viewport_<id>``)
     - Per browser — this device only, never leaves it, never touches the ``.md`` file

Dragging a note or resizing it writes its new ``X``/``Y``/``Width``/``Height`` into the plan text the moment you release it — one ``wbCommitMarkdown()`` call, one undo step, exactly like editing a task line by hand. Panning or zooming the canvas never calls that function at all; it only ever updates the ``localStorage`` entry, debounced, on its own timer.

Why layout travels with the plan
-----------------------------------

A note's position, size and colour are decisions about *the plan* — "this task matters enough to be on the board, roughly here, in this colour" — the same category of decision as a task's duration or a Kanban bucket. Putting it anywhere other than the plan text would break the guarantee the rest of the format makes (see :doc:`/reference/plan-format`'s canonical guarantee): open the file on another machine, or send it to a colleague, and the board should look the way you left it. Layout is also exactly the kind of edit the app already tracks as an undo step and a version-history snapshot; keeping it in the plan text gets that for free instead of building a second, parallel history mechanism just for note positions.

The colour side of this is reinforced by the fact that a whiteboard note's colour is *not* even a whiteboard-private setting — it is the same ``Theme:`` front-matter entry the Kanban board and mind map read and write (see :doc:`/reference/plan-format`'s "Note colour precedence"). A note's colour has to be plan data, because it already is plan data somewhere else in the app; the whiteboard is just a third view onto it.

Why the viewport doesn't
--------------------------

Pan and zoom describe *where you are looking*, not what the plan contains. Two people who both have "Discovery & Planning" on their board are looking at the same notes; there is no reason their scroll position or zoom level should be forced to agree, and every reason it shouldn't be: if pan/zoom lived in the plan file, opening the whiteboard on a phone after leaving it zoomed in on a desktop would be actively unhelpful, and every pan or zoom tick would be a write to a file that is otherwise supposed to change only when the plan itself changes — noisy diffs, noisy undo history, noisy version snapshots, all for something that carries no information about the project.

Storing it in ``localStorage`` — the same place the app already keeps theme, panel widths and mind-map branch colours (see :doc:`/explanation/browser-local-store`'s "Where plan data lives" audit) — makes this explicit: it is a UI preference, scoped to one browser on one device, and it is fine for it to be lost, reset, or simply different somewhere else.

The rule of thumb
--------------------

When adding anything new to the whiteboard, ask: would a collaborator opening this same plan file on a different machine expect to see it? If yes, it belongs in the ``---whiteboard---`` table, written through the same commit-on-release path drag/resize already uses. If it is only ever "how I personally like to look at this board right now", it belongs in ``localStorage``, scoped by project id the same way the viewport already is.

Related
--------

- :doc:`/reference/plan-format` — the ``---whiteboard---`` section and note colour precedence
- :doc:`/explanation/browser-local-store` — the fuller audit of what is plan data and what is a browser-local preference
- :doc:`/how-to/use-the-whiteboard` — using the board day to day
