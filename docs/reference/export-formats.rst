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

Markdown (``.md``)
~~~~~~~~~~~~~~~~~~~

Downloads the raw plan text as a markdown file. Use this to save your plan to disk.

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
