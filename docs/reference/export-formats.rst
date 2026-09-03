Export Formats Reference
=========================

NoodlePlanner supports several export formats for individual projects and portfolios.

Project Exports
----------------

Excel (``.xlsx``)
~~~~~~~~~~~~~~~~~~

A full spreadsheet export of the project schedule.

- Access: **Tools** → **Export → Excel**
- Filename: ``{project-name}.xlsx``

Columns included:

.. list-table::
   :header-rows: 1
   :widths: 25 75

   * - Column
     - Description
   * - ID
     - Task identifier
   * - Task Name
     - Task title
   * - Start
     - Start date (YYYY-MM-DD)
   * - Finish
     - Finish date (YYYY-MM-DD)
   * - Duration (days)
     - Duration in calendar days
   * - Resources
     - Comma-separated resource names
   * - % Complete
     - Percentage complete (0–100)
   * - RAG
     - RAG status (Green/Amber/Red)
   * - Priority
     - Task priority (if set)
   * - Bucket
     - Task bucket/label (if set)
   * - Comment
     - Task comment

CSV (``.csv``)
~~~~~~~~~~~~~~~

Same columns as Excel, in plain text comma-separated format.

- Access: **Tools** → **Export → CSV**
- Filename: ``{project-name}.csv``

PowerPoint (``.pptx``)
~~~~~~~~~~~~~~~~~~~~~~~

A single-slide project report presentation:

- Access: **Tools** → **Export → PowerPoint**
- Contains: project header, timeline graphic, milestones table, highlights, risks and issues

PDF
~~~~

A printable version of the project report.

- Access: **Tools** → **Export → PDF**

Microsoft Project XML (``.xml``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Exports the plan as a Microsoft Project XML file that can be opened in Microsoft Project.

- Access: **Tools** → **Export to MS Project (XML)**
- Filename: ``{project-name}.xml``

The file follows the MSPDI schema, so Microsoft Project, ProjectLibre and
Smartsheet all open it directly — use **File → Open** and pick the ``.xml``
file. Tasks carry their outline hierarchy, durations, dependencies, percent
complete, notes and resource assignments, scheduled against a standard
Monday–Friday 08:00–17:00 calendar.

Microsoft Project is stricter about dependencies than NoodlePlanner. It
refuses to open a file in which a task is linked to its own summary task, or
in which a dependency on a phase heading loops back through that phase's
subtasks once the link is rolled down to them. Such links are left out of
the export and the reason is written to the task's **Notes** field, so the
file always opens; check the Notes column if a link seems to be missing.
NoodlePlanner marks the same dependencies in red in the editor and offers a
**Fix** in the status bar that removes the entry from the ``[depends ...]``
list.

Every task is exported with a *Start No Earlier Than* constraint on the date
NoodlePlanner scheduled it for, so Microsoft Project shows the same dates
rather than recalculating the plan from its own start date on open. Resource
assignments carry the task's dates, work and progress; milestones are
zero-length instants.

.. note::

   NoodlePlanner cannot write Microsoft Project's native binary ``.mpp``
   format — no open-source library can, including MPXJ, the reference
   implementation, which is read-only for ``.mpp``. XML is the supported
   round-trip format. NoodlePlanner *can* read ``.mpp`` files on import; see
   :doc:`../how-to/import-from-ms-project`.

Markdown (``.md``)
~~~~~~~~~~~~~~~~~~~

Downloads the raw plan text as a markdown file. Use this to save your plan to disk.

- Access: **Ctrl+S** / **Cmd+S**, or click the save icon in the editor toolbar

RAID Log Excel
~~~~~~~~~~~~~~~

Exports RAID log items as a formatted Excel table.

- Access: **Tracking** → **RAID Log** → Export icon
- Filename: ``raid-log.xlsx``

Portfolio Exports
------------------

Portfolio PowerPoint (``.pptx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

A multi-slide portfolio report:

- Access: **Portfolio** → ``...`` menu → **Export Report**
- Slide 1: Portfolio overview (project table, timeline, summary counts)
- Subsequent slides: One report slide per project (header, timeline, milestones, risks, highlights)
