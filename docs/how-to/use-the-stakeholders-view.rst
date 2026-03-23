How to Use the Stakeholders View
==================================

The Stakeholders view provides an interest/influence grid for mapping and managing project stakeholders.

Open the Stakeholders View
----------------------------

After rendering your plan, click **Stakeholders** in the project sub-navigation bar.

Define Stakeholders
--------------------

Stakeholders are defined in the plan's front matter using a ``Stakeholders`` block:

.. code-block:: text

   ---
   title: My Project
   Stakeholders:
   - name: CEO
     interest: high
     influence: high
   - name: End Users
     interest: high
     influence: low
   - name: Finance Team
     interest: low
     influence: high
   ---

Each stakeholder has a **name**, an **interest** level, and an **influence** level.

Read the Grid
--------------

The stakeholders grid maps each stakeholder on two axes:

- **Interest** (horizontal) — how much the stakeholder cares about the project outcome
- **Influence** (vertical) — how much power the stakeholder has over the project

This creates four quadrants:

- **High Interest, High Influence** — manage closely
- **High Interest, Low Influence** — keep informed
- **Low Interest, High Influence** — keep satisfied
- **Low Interest, Low Influence** — monitor

.. note::

   The stakeholder grid is a standard project management tool for communication planning. Use it to decide how much engagement each stakeholder needs.

Related
--------

- :doc:`../reference/views` — overview of all views
- :doc:`../reference/front-matter` — front matter reference for defining stakeholders
