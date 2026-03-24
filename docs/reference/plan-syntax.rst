Plan Syntax Reference
======================

NoodlePlanner uses a plain-text format for project plans. This page is the complete reference for all supported syntax.

File Structure
---------------

.. code-block:: text

   ---
   <front matter>
   ---

   Phase Name
     Task Name [attributes...]

   ---raid log---
   <RAID log markdown table>

Front matter is optional. The RAID log section is appended automatically when you save the RAID log.

Task Line Syntax
-----------------

A task line takes the form:

.. code-block:: text

   [*] Task Name [$product] [@resource...] [duration] [progress] [date] ["comment"] [depends...]

All fields except the task name are optional and can appear in any order.

Sequential Task Prefix
~~~~~~~~~~~~~~~~~~~~~~~

Prefix a task with ``*`` to make it start immediately after the previous task:

.. code-block:: text

   Phase
     Task A @alice 3d
     * Task B @alice 2d

Task B starts the day after Task A finishes.

Duration Formats
~~~~~~~~~~~~~~~~~

.. list-table::
   :header-rows: 1
   :widths: 20 30 50

   * - Format
     - Example
     - Meaning
   * - ``Nd`` / ``Ndays``
     - ``3d``, ``5days``
     - N calendar days
   * - ``Nw`` / ``Nweeks``
     - ``2w``, ``1week``
     - N weeks
   * - ``Nm`` / ``Nmonths``
     - ``1m``, ``3months``
     - N months
   * - ``Ny`` / ``Nyears``
     - ``1y``, ``2years``
     - N years
   * - ``0d``
     - ``0d``
     - Milestone (no duration)

Resources
~~~~~~~~~~

Resources are prefixed with ``@``:

.. code-block:: text

   Task A @alice 3d
   Task B @alice @bob 2d

Specify allocation percentage:

.. code-block:: text

   Task A @alice:50% 3d

Resources must be defined in the front matter ``Resources`` block.

Progress
~~~~~~~~~

Progress can be specified as a percentage or with the ``p`` prefix:

.. code-block:: text

   Task A @alice 3d 75%
   Task B @alice 3d p75

Valid range: 0–100.

Explicit Start Date
~~~~~~~~~~~~~~~~~~~~

.. code-block:: text

   Task A @alice 3d 2026-06-01

Date format: ``YYYY-MM-DD``.

Comments
~~~~~~~~~

Enclose a comment in double quotes:

.. code-block:: text

   Task A @alice 3d "Review before submitting"

Use ``!"note"`` for a comment that is prominently flagged:

.. code-block:: text

   Task A @alice 3d !"High priority deliverable"

Deliverables (Products)
~~~~~~~~~~~~~~~~~~~~~~~~

Mark a task as a deliverable or product with the ``$`` prefix:

.. code-block:: text

   Fuselage $fuselage @team-a 4w
   Avionics $avionics @team-b 3w

The ``$name`` token assigns a product identifier to the task. This enables product-based planning views such as the Product Breakdown Structure, Deliverables Matrix, and Product Flow.

Product-level dependencies are created by referencing a ``$name`` in a ``[depends ...]`` block:

.. code-block:: text

   Avionics $avionics [depends $fuselage]

This means the Avionics task cannot start until the Fuselage deliverable is complete.

Dependencies
~~~~~~~~~~~~~

.. code-block:: text

   [depends Task Name]
   [depends Task A, Task B]

Depend on a task with an offset (start N days before or after finish):

.. code-block:: text

   [depends Design +2d]
   [depends Review -1d]

Phases (Summary Tasks)
-----------------------

A top-level (non-indented) line is a phase. Phases act as summary tasks and cannot have direct attributes — their dates are derived from their child tasks.

Milestones
-----------

A task with ``0d`` duration is a milestone. Milestones appear as diamond markers on the Timeline view and in the Milestones table.

.. code-block:: text

   Go Live 0d [depends Final Testing]

Front Matter YAML
------------------

See :doc:`front-matter` for the complete field reference.

RAID Log Section
-----------------

The RAID log is embedded in the plan after a ``---raid log---`` separator as a markdown table:

.. code-block:: markdown

   ---raid log---

   # RAID Log

   | ID | Type | Title | ... | Status |
   |----|------|-------|-----|--------|
   | 1  | Risk | ...   | ... | Open   |

This section is managed automatically by the RAID Log view. Do not edit it manually unless you are confident of the format.
