Plan File Format Specification
================================

A NoodlePlanner plan is one Markdown file. This page is the specification of
that file: what it contains, how each line is read, and the guarantee that
the file is **canonical** — the single, complete, hand-editable source of the
plan. :doc:`plan-syntax` is the friendlier tutorial version of the task
grammar; when the two disagree, this page wins.

The page is written so it can be handed to a language model as-is. A model
that follows it can read a plan, edit it, and write it back without losing
anything the app or a person put there.

The canonical guarantee
------------------------

1. **Complete.** The ``.md`` file alone holds the whole plan: front matter,
   the task outline, and every back-matter section (highlights, RAID log,
   communications plan, budget, benefits, lessons learned, baseline). Nothing
   about a plan lives only in the browser's storage or in a database. See
   `Where plan data lives`_ for the audit.
2. **Lossless.** Opening a plan and saving it without editing it leaves
   every byte as it was, with one narrow exception: the four front-matter
   keys the app maintains (`Keys the app maintains`_). Each of those is a
   single-line, in-place edit; nothing else moves. No key is reordered, no
   indentation reflowed, no whitespace normalised, no comment stripped.
3. **Hand-editable.** A person, or a model, can edit the file in any text
   editor and NoodlePlanner shows the edit. Lines it does not understand are
   kept, not discarded.
4. **Enforced.** ``tests/test_markdown_roundtrip.py`` and
   ``tests/test_markdown_roundtrip.mjs`` run every bundled template and a
   set of hand-written edge cases (``tests/fixtures/roundtrip/``) through
   the server's parser and the browser's writers and fail if anything but
   those keys changes. They run on every push and pull request
   (``.github/workflows/markdown-roundtrip.yml``).

Encoding and line endings
~~~~~~~~~~~~~~~~~~~~~~~~~~

UTF-8, any characters. Line endings are ``\n``. A file with ``\r\n``
endings is accepted, but the browser's editor normalises it to ``\n`` on
load, so that is the one transformation a hand-written file can undergo;
saving it back writes ``\n``. A final newline is kept if present and not
added if absent.

File structure
---------------

Three parts, in this order; only the task outline is required:

.. code-block:: text

   ---                     ← front matter (optional): YAML between two --- lines
   title: My Project
   ---

   Phase                   ← task outline: an indented tree of task lines
     Task 3d @alice

   ---raid log---          ← back matter (optional): sections opened by markers
   | ID | Type | ... |

Blank lines are allowed anywhere and are preserved. A line starting with
``//`` (after any indentation) is a comment: ignored by the scheduler,
preserved in the file.

Front matter
-------------

A block that starts on the **first line** of the file with ``---`` and ends
at the next line that is exactly ``---``. The content is YAML-like, read
line by line: ``key: value`` pairs and ``- item`` lists. Keys are
case-insensitive on read and written back exactly as found. Unknown keys are
kept untouched, so a plan may carry its own metadata.

Keys the app reads
~~~~~~~~~~~~~~~~~~~

.. list-table::
   :header-rows: 1
   :widths: 28 20 52

   * - Key
     - Type
     - Meaning
   * - ``title``
     - text
     - Project name. Falls back to the project's stored name.
   * - ``project manager`` / ``manager`` / ``owner``
     - text
     - Project manager, shown in headers and reports.
   * - ``sponsor``
     - text
     - Executive sponsor.
   * - ``budget``
     - text
     - Budget, free text (``£125,000``).
   * - ``status``
     - ``Green`` | ``Amber`` | ``Red``
     - Manually declared RAG, shown as a badge.
   * - ``theme``
     - ``light`` | ``dark`` | ``system``
     - UI theme when this plan is open.
   * - ``start date``
     - ``YYYY-MM-DD``
     - Project start, shown on reports and read by the AI assistant. It does
       not move tasks; give a task an explicit date for that.
   * - ``Resources``
     - list of ``- @short: Full Name, Role, email``
     - Team members. ``@short`` is what task lines use; the rest is display
       text. Extra comma-separated fields after the role are kept.
   * - ``dependencies``
     - list of maps (``from``, ``task``, ``to_task``, ``type``, ``lag``)
     - Cross-project (programme) dependencies. Written by the Portfolio
       Dependencies view, editable by hand.
   * - ``non-working-days`` / ``holidays``
     - flat: ``2026-12-25, 2026-12-26``; or a list of ``- Name: YYYY-MM-DD``
       and ``- Name: YYYY-MM-DD:YYYY-MM-DD`` ranges
     - Project-wide non-working days.
   * - ``non-working [...]`` suffix on a resource line
     - ``- @kev: Kevin, PM non-working [2026-08-03, 2026-08-10:2026-08-14]``
     - Non-working days, single or ranged, for that resource only.
   * - ``stakeholders``
     - list of maps
     - Stakeholder register, written by the Stakeholders view.

The full field reference with examples is :doc:`front-matter`.

Keys the app maintains
~~~~~~~~~~~~~~~~~~~~~~~

These four keys are the only bytes the app changes in a plan the user did
not edit. Each is written as one line, in place if the key exists, appended
as the last key of the front matter if it does not, and if the file has no
front matter a block holding just that key is added at the top. Writing a
value that is already there changes nothing.

.. list-table::
   :header-rows: 1
   :widths: 18 30 52

   * - Key
     - When it is written
     - Value
   * - ``labels``
     - On every parse, by the server, when the outline uses a ``#tag`` the
       line does not list
     - ``labels: [a, b]`` — a line that already lists every tag is kept
       verbatim, whatever its order, case or spacing; missing tags are
       appended to the existing list.
   * - ``rag``
     - After every render, by the browser, when the computed RAG differs
     - ``green`` | ``amber`` | ``red`` | ``blue``. Derived from progress and
       dates so that the portfolio and version history can read it.
   * - ``version``
     - On each save
     - ``major.minor``; the minor part increments, rolling to the next major
       at 20 (``5.20`` → ``6.0``).
   * - ``last_saved``
     - On each save
     - ``YYYY-MM-DD HH:MM`` local time.

A model editing a plan should leave these keys alone; the app will bring
them up to date.

Task outline
-------------

Everything between the front matter and the first back-matter marker. Each
non-blank, non-comment line is a task. **Indentation defines the tree**: a
line indented more than the previous task line is its child; a line
indented the same is a sibling; a line indented less closes the deeper
levels. Any consistent indent width works; two spaces is conventional. A
task with children is a **phase** (summary task): its dates and progress
roll up from the children and any duration on the line is ignored.

Task line grammar
~~~~~~~~~~~~~~~~~~

.. code-block:: text

   [*[±Nunit ]] name [token ...]

The **name** is everything up to the first metadata token. Tokens may
appear in any order after it, separated by spaces. Names may contain any
characters except the ones that start a token; a comma inside a name breaks
``[depends ...]`` lists that refer to it.

.. list-table::
   :header-rows: 1
   :widths: 30 70

   * - Token
     - Meaning
   * - ``*`` prefix
     - Follows the previous non-phase task (finish-to-start). ``*+2d Name``
       or ``*-1w Name`` adds lag or lead to that link.
   * - ``Nd`` ``Nw`` ``Nm`` ``Ny``
     - Duration in working days, weeks (7), months (30) or years (365).
       ``Ndays`` and ``Nweeks`` are accepted and read as the short form.
       ``0d`` is a milestone. A task with no duration is 1 day.
   * - ``@short``
     - Assigned resource; repeat for several (``@a @b`` or ``@a, @b``).
       ``@short:P`` / ``:R`` / ``:A`` assigns a quality role (produce,
       review, approve) instead.
   * - ``N%`` (or legacy ``pN``)
     - Percent complete, 0–100.
   * - ``YYYY-MM-DD``
     - Explicit start date (not-before constraint). A task with one is
       "manually scheduled".
   * - ``[depends A, B:SS +2d, $product -1d]``
     - Predecessors by task name or ``$deliverable``. ``[depends: ...]``
       (colon) is the same. Each entry may carry a type ``:FS`` (default)
       ``:SS`` ``:FF`` ``:SF`` and a lag/lead ``±Nd|w|m|y``.
   * - ``$name`` ``/$name`` ``^$name``
     - Declares this task's deliverable (product), a group product, or an
       external product. Other tasks may depend on it as ``$name``. A
       ``$name`` inside ``[depends ...]`` is a reference, not a declaration.
   * - ``#tag``
     - Label. Every tag used must appear in the front-matter ``labels:``
       line; the app adds missing ones (see above).
   * - ``!`` ``!!`` ``!!!``
     - Priority Medium, Important, Urgent (none = Low).
   * - ``"text"`` ``'text'`` ``!"text"``
     - A comment, kept with the task and shown in views and exports.
   * - ``{Bucket}``
     - Kanban bucket.
   * - ``~8h`` ``~2d`` ``~8h/16h``
     - Effort: total, or completed/total. When both are given the percent
       is derived from them.
   * - ``[repeats weekly]`` etc.
     - Recurrence.
   * - ``[levelled @short YYYY-MM-DD]``
     - Written by resource levelling; pins the start for that resource.

Resolution rules
~~~~~~~~~~~~~~~~~

* Dependency names are matched case-insensitively against task names. If
  two tasks share a name the later one wins; avoid duplicate names.
* A task that depends on its own phase, or a phase on its own subtask, is
  flagged in the editor and status bar; the MS Project exports leave such
  links out and say so in the task's notes.
* Tasks with no dependency and no explicit date start with their phase (or
  today); ``*`` chains and ``[depends]`` schedule from predecessors on a
  Monday–Friday calendar minus any non-working days.

Back matter
------------

After the outline, any of the following sections, each opened by a marker
line and running to the next marker or the end of the file. Order is free
but the app writes them in the order below. A section's content is a
Markdown table with a header row (column names are matched by name, not
position, so extra or reordered columns are tolerated), except highlights.

.. list-table::
   :header-rows: 1
   :widths: 26 74

   * - Marker
     - Content
   * - ``---highlights---`` … ``---end-highlights---``
     - Entries headed ``## YYYY-MM-DD @author``, each followed by free
       Markdown (bullets, bold, paragraphs) until the next heading. The end
       marker is optional but written by the app.
   * - ``---raid log---``
     - Table: ``ID | Type | Title | Description | Raised By | Owner |
       Mitigation Actions | Impact | Likelihood | Score | Status``. A short
       form ``Type | Description | Status | Score | Owner | Date`` is read
       too. Type is ``risk`` | ``assumption`` | ``issue`` | ``dependency``.
   * - ``---comms---``
     - Table: ``ID | Activity | Audience | Content | Frequency | Channel |
       Owner | Status``.
   * - ``---budget---``
     - Table: ``ID | Description | Estimate | Forecast | Type | Invoice | PO
       | Supplier | Total | Date Ordered | Date Received | Category``.
   * - ``---benefits---``
     - Table: ``ID | Type | Title | Description | Objective Type | Target
       Value | Current Value | Target Date | Measurement Method | Linked To
       | Contribution %``.
   * - ``---lessons learned---``
     - Table: ``ID | Project Manager | Project Type | Technology | Project
       Phase | Area | Impact Type | Observation | Impact | Recommendations |
       Date``.
   * - ``---baseline---``
     - Table: ``Task Name | Start | Finish | Duration``, one row per task at
       the time the baseline was taken.

A ``# Heading`` line directly after a marker (``# RAID Log``) is allowed
and kept.

Editing a section through its view (adding a RAID item, say) rewrites
**that section only**, in the app's canonical table layout. The rest of the
file is not touched. Hand-written tables are read as they are and left as
they are until the view edits them.

Where plan data lives
----------------------

The browser stores each project's plan text verbatim as one record in an
IndexedDB database (``static/project-store.js``, see
:doc:`/explanation/browser-local-store`) and nothing else about the plan.
Everything the views show is derived from that text on each render. The
other records the app keeps are:

* version history — snapshots of the plan text, one record each, derived;
* programme dependencies — the links declared in the front matter's
  ``dependencies`` key, kept as one metadata record so the portfolio can
  propagate RAG across projects, derived;
* theme, panel widths, mind-map colours, AI settings — UI preferences in
  ``localStorage``, not plan data.

Browsers without IndexedDB fall back to the previous single
``localStorage`` key; the plan text is stored verbatim either way.

There is no server-side persistence of plans, by design.

Accepted deviations
--------------------

These are the only known cases where a saved file is not byte-identical to
the file that was opened. Each is deliberate.

.. list-table::
   :header-rows: 1
   :widths: 34 66

   * - Case
     - Reason
   * - ``labels``, ``rag``, ``version``, ``last_saved`` lines
     - App-maintained keys; see above. Each is a one-line edit.
   * - ``\r\n`` line endings become ``\n``
     - The browser's text editor normalises line endings on load.
   * - A section edited through its view is rewritten in canonical layout
     - The view owns the table it edits; column padding and row order may
       change. Other sections and the outline are untouched.
   * - Loading several plans at once merges duplicate section markers
     - Multi-plan load only; a single plan is never merged.

Anything else that changes a plan the user did not edit is a bug, and the
round-trip tests exist to catch it.

Guidance for a language model
------------------------------

* Read the file as text; do not convert it to YAML or JSON and back.
* To change a task, edit its line in place. Keep the indentation of the
  line you are editing and of its neighbours.
* Add tasks as new lines at the indentation of their siblings. Prefer
  ``[depends Name]`` over reordering lines when a task must wait for
  another.
* Declare any new ``#tag`` in the ``labels:`` line, or leave it for the
  app to add.
* Do not touch ``rag``, ``version`` or ``last_saved``.
* Leave the back-matter tables' columns as they are; add rows in the same
  shape as the existing ones, with the next free ``ID``.
* Never remove a line you do not understand; it may be a comment or a key
  another tool relies on.
