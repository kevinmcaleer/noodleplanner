Front Matter Reference
=======================

The front matter block appears at the top of a plan file between ``---`` delimiters. It sets project-level metadata used by the dashboard, reports, and exports.

.. code-block:: yaml

   ---
   title: My Project
   project manager: Jane Smith
   sponsor: CEO
   budget: £50,000
   status: Green
   theme: system
   Resources:
   - @jane: Jane Smith, Project Manager
   - @dev: Dev One, Developer
   ---

All fields are optional.

Editing front matter
---------------------

The editor shows a collapsible **Front matter** panel above the plan text.
On a plan where the front matter runs longer than about ten lines, it
starts collapsed, showing just a summary line such as ``Front matter (6
keys)`` — the same collapse/summary language the back-matter sections use.
Click the summary to expand or collapse it; the state is remembered per
project.

Expanded, the panel offers two interchangeable views:

- **Structured** (the default) — one row per key, Obsidian-property style.
  Known keys (``title``, ``status``, ``Resources``, ``dependencies``, …)
  get a purpose-built widget — a dropdown for ``status``/``theme``, a tag
  editor for ``labels``, repeatable entry rows for ``Resources``,
  ``dependencies`` and ``non-working-days``. Unrecognised keys still get a
  plain text row so nothing is ever hidden or silently dropped. Rows can be
  added, removed, and reordered with the ↑/↓ buttons.
- **Raw** — the front matter exactly as YAML text, for anyone who would
  rather type it directly.

Switching between the two is lossless in both directions: editing one key
leaves every other line — including comments, blank lines, and formatting
— byte-for-byte untouched. A line that doesn't parse as ``key: value`` is
preserved as-is rather than corrupted, and flagged with a warning so it's
easy to find.

Fields
-------

``title``
~~~~~~~~~

The project name displayed in view headers, exports, and the portfolio.

.. code-block:: yaml

   title: Website Redesign 2026

``project manager`` / ``manager`` / ``owner``
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The project manager's name, shown in the project header and report slides. All three field names are equivalent.

.. code-block:: yaml

   project manager: Jane Smith

``sponsor``
~~~~~~~~~~~

Executive sponsor name, shown on report slides.

.. code-block:: yaml

   sponsor: Chief Executive Officer

``budget``
~~~~~~~~~~~

Budget amount (free text), shown on report slides.

.. code-block:: yaml

   budget: £125,000

``status``
~~~~~~~~~~~

Overall project RAG status. Displayed as a coloured badge in the project header.

.. code-block:: yaml

   status: Green

Valid values: ``Green``, ``Amber``, ``Red``.

``theme``
~~~~~~~~~

UI theme preference for this project. Overrides the global theme setting when the plan is loaded.

.. code-block:: yaml

   theme: dark

Valid values: ``light``, ``dark``, ``system``.

``Resources``
~~~~~~~~~~~~~

A list of team members with short names (used in tasks with ``@``) and descriptions.

.. code-block:: yaml

   Resources:
   - @alice: Alice Smith, Lead Developer
   - @bob: Bob Jones, Designer
   - @charlie: Charlie Brown, QA Engineer

Format for each entry:

.. code-block:: text

   - @shortname: Full Name, Role

The short name (without ``@``) is used in task lines. The description is displayed in resource views and the resource form.

``dependencies``
~~~~~~~~~~~~~~~~~

A list of cross-project (programme) dependencies — tasks or milestones in other projects that this project depends on. These are managed automatically via the Portfolio Dependencies view, but can also be edited directly.

.. code-block:: yaml

   dependencies:
     - from: Infrastructure Project
       task: Server Setup Complete
       to_task: Backend Integration
       type: FS
       lag: 0
     - from: Design Project
       task: Brand Guidelines Approved
       to_task: UI Development
       type: SS
       lag: 2

Fields for each dependency entry:

- ``from`` — the source project name (the project that produces the deliverable)
- ``task`` — the source task or milestone name in the source project
- ``to_task`` — the task in this project that depends on the source
- ``type`` — dependency type: ``FS`` (Finish-Start, default), ``SS`` (Start-Start), ``FF`` (Finish-Finish), ``SF`` (Start-Finish)
- ``lag`` — offset in working days (positive = wait, negative = overlap, default ``0``)

.. note::

   Dependencies are updated automatically when you use the Portfolio Dependencies view. The status bar shows warnings if a dependent project is missing or if dependent activities have non-green RAG status.

See :doc:`../how-to/use-the-portfolio-view` for details on managing programme dependencies.

``non-working-days`` / ``holidays``
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Project-wide non-working days, applied on top of whichever calendar is active. Accepts a flat list of dates, or a named list with optional ranges:

.. code-block:: yaml

   non-working-days:
   - Christmas: 2026-12-25:2026-12-26
   - Training Day: 2026-03-10

A resource line's own ``non-working [...]`` suffix (see ``Resources`` above) adds non-working days for that resource alone, on top of both the project's non-working days and whichever calendar the resource uses (see ``calendars`` below and issue #1136 for resource-specific calendars).

``calendar`` / ``calendars``
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Named calendars a project can schedule against, and which one is active. A plan that declares neither key schedules against the implicit **Standard** calendar (Monday-Friday, no exceptions) -- exactly today's default behaviour, so existing plans are unaffected.

.. code-block:: yaml

   calendar: Fortnight Ops
   calendars:
   - Standard: Mon-Fri
   - Night Shift: Sun-Thu hours 22:00-06:00
   - Fortnight Ops: [Mon-Fri; Mon-Wed] hours 08:00-16:30 exceptions [Christmas: 2026-12-25:2026-12-26]

Each ``calendars:`` entry is one line: ``- <Name>: <week pattern> [hours HH:MM-HH:MM] [exceptions [...]]``.

- **Week pattern** — a work week as a day range or list (``Mon-Fri``, ``Sun-Thu``, ``Mon,Wed,Fri``), or a bracketed, semicolon-separated shift rotation for patterns that repeat over more than one week (``[Mon-Fri; Mon-Wed]`` for a two-week fortnight cycle). Day ranges wrap, so ``Sun-Thu`` is Sunday through Thursday (a Friday/Saturday weekend), not empty.
- **``hours``** (optional) — the daily working-time window, applied to every working day in the pattern.
- **``exceptions``** (optional) — dates that are non-working regardless of the week pattern, in the same named-entry format as ``non-working-days:`` above, comma-separated inside the brackets.

``calendar: <Name>`` selects which calendar is active for scheduling; omit it to use **Standard** even when other calendars are declared. Naming a calendar that isn't declared in ``calendars:`` falls back to Standard rather than failing to parse.

The active calendar's week pattern, hours and exceptions govern scheduling everywhere a project's non-working days do (issue #1132) -- both the server and browser engines apply it, and it layers with ``non-working-days:``/``holidays:`` and any resource-specific ``non-working [...]`` dates rather than replacing them.

.. note::

   Assigning a calendar to an individual resource (#1136, so different resources can work different weeks on the same project) and a UI for managing calendars (#1135) are tracked separately as part of the Calendars epic (#1047). The scheduling engine's day-granular duration model does not yet consume a calendar's optional ``hours`` window when computing dates -- it is parsed and available on the ``Calendar`` object for a future UI/export to read, but every duration is still whole working days.
