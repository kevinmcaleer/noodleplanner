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
