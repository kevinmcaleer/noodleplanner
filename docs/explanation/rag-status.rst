Understanding RAG Status
=========================

RAG status is a traffic-light indicator used throughout NoodlePlanner to communicate project health at a glance. The acronym stands for Red, Amber, Green.

What RAG Status Means
----------------------

.. list-table::
   :header-rows: 1
   :widths: 15 85

   * - Status
     - Meaning
   * - **Green**
     - On track. The project or task is progressing as planned with no significant concerns.
   * - **Amber**
     - At risk. There are concerns that may impact the schedule or quality if not addressed. Action is recommended.
   * - **Red**
     - Off track. Significant issues are affecting the project and intervention is required. Stakeholders should be informed.

.. figure:: /_static/img/explanation/rs-01-rag-dashboard.png
   :alt: Dashboard showing Amber RAG status badge and project health indicators
   :width: 100%

   The dashboard with an Amber RAG status, showing how project health is communicated at a glance.

Where RAG Status Appears
-------------------------

**Project-level RAG**

Set manually in the front matter:

.. code-block:: yaml

   status: Amber

The RAG badge appears in the project header on the Dashboard, report slides, and the Portfolio Status view.

If no ``status`` is set in the front matter, NoodlePlanner derives a RAG from the schedule: if any tasks are overdue (past their finish date and below 100%), the project shows as Amber or Red.

**Task-level RAG**

Individual tasks can have a RAG status set in the Task Details panel. Task RAG is displayed:

- In the Tasks table
- On Gantt chart bars (as a colour)
- On Kanban cards
- In the Look-Ahead view
- In the Milestones table

**RAID item risk score and RAG**

RAID items do not use RAG colours directly, but the risk score (Impact × Likelihood, 1–25) maps loosely to RAG:

- Score 1–8: Low (Green)
- Score 9–16: Medium (Amber)
- Score 17–25: High (Red)

The Portfolio Risk Register filters by High/Medium/Low based on these bands.

RAG in the Portfolio
---------------------

The Portfolio Status dashboard shows RAG for each project:

- **Explicitly set**: Uses the ``status`` field from the project's front matter
- **Derived**: If not set, calculated from whether any tasks are overdue

The portfolio overview slide in exported PowerPoint reports also colour-codes each project by RAG.

Best Practices
---------------

- Update the project ``status`` field in the front matter regularly, especially before steering committee meetings
- Use Amber early — it is better to flag a risk before it becomes a problem
- Be consistent: define what Amber and Red mean for your programme so stakeholders have shared expectations
- Review RAID items alongside RAG status — open high-scoring risks often explain an Amber or Red status

Related
--------

- :doc:`../reference/front-matter` — setting project-level status
- :doc:`../how-to/use-the-raid-log` — tracking risks and issues
- :doc:`../how-to/use-the-portfolio-view` — portfolio RAG overview
