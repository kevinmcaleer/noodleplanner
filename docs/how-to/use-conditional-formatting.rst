How to Use Conditional Formatting
===================================

Conditional formatting lets you apply colour-coding rules to tasks based on their properties, making it easy to spot important items at a glance.

Open Conditional Formatting
-----------------------------

1. Open the **Project Details** panel (click the settings/gear icon in the editor toolbar)
2. Select the **Conditional Formatting** tab

Add a Rule
-----------

1. Click **Add Rule**
2. Choose the **field** to evaluate (e.g., RAG status, percentage complete, resource, duration)
3. Set the **condition** (e.g., equals, greater than, contains)
4. Set the **value** to match against
5. Choose the **colour** to apply when the condition is met
6. Click **Save**

Tasks matching the rule are highlighted with the chosen colour across table and Gantt views.

Rule Priority
--------------

Rules are evaluated from top to bottom. The **first matching rule wins** — if a task matches multiple rules, only the topmost rule's colour is applied.

To reorder rules, drag them into the desired priority order in the Conditional Formatting tab.

.. note::

   Conditional formatting applies to the Tasks table and Gantt view. It does not affect the Dashboard or exported reports.

Related
--------

- :doc:`use-the-gantt-view` — Gantt view guide
- :doc:`../reference/views` — overview of all views
- :doc:`../explanation/rag-status` — understanding RAG status
