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
