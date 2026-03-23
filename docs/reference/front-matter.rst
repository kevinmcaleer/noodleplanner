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
