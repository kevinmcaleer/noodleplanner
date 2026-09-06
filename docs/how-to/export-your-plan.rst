How to Export Your Plan
========================

NoodlePlanner supports several export formats for sharing, archiving, and reporting.

Access the Export Menu
-----------------------

In the project sub-navigation, click **Tools** to open the tools dropdown. Export options are listed in the menu.

Export Formats
---------------

Excel (``.xlsx``)
~~~~~~~~~~~~~~~~~~

Exports a full spreadsheet with all tasks, dates, resources, progress, and RAG status. Best for sharing with stakeholders who need to work with the data.

1. Click **Tools** → **Export → Excel**
2. The file downloads immediately as ``{project-name}.xlsx``

Columns exported: ID, Task Name, Start, Finish, Duration (days), Resources, % Complete, RAG, Priority, Bucket, Comment.

Excel and CSV files are built **in your browser**, from the scheduled data
the page already holds: no plan data is sent to the server and the server
spends no CPU on the export. Render the latest plan before exporting. Large
workbooks are generated in a Web Worker so the page stays responsive, and if
the browser cannot build the workbook NoodlePlanner logs the error and falls
back to the server exporter.

To use the server exporters instead — for all of Excel, CSV, PDF and Word —
set this once from the browser console:

.. code-block:: javascript

   localStorage.setItem('np-server-exports', '1')

CSV (``.csv``)
~~~~~~~~~~~~~~~

A simple flat file format compatible with other tools (e.g. spreadsheets, databases).

1. Click **Tools** → **Export → CSV**
2. The file downloads as ``{project-name}.csv``

PowerPoint (``.pptx``)
~~~~~~~~~~~~~~~~~~~~~~~

Generates a presentation-ready report slide showing project overview, timeline, milestones, and RAID items.

1. Click **Tools** → **Export → PowerPoint**
2. The file downloads as ``{project-name}.pptx``

PDF
~~~~

Creates a printable version of the project report.

1. Click **Tools** → **Export → PDF**
2. The file downloads as ``{project-name}.pdf`` (or ``{project-name} v{version}.pdf``
   when the plan's front matter carries a ``version``)

The PDF is built **entirely in your browser** from the plan the page has
already scheduled, so no plan data is sent to the server. The only request it
makes is for the font it embeds.

Paper size defaults to A4. To switch to US Letter, set this once from the
browser console:

.. code-block:: javascript

   localStorage.setItem('np-pdf-page-size', 'letter')

Fonts and non-English text
^^^^^^^^^^^^^^^^^^^^^^^^^^^

The PDF embeds DejaVu Sans Mono, which covers Latin, Latin Extended,
Greek and Cyrillic — so accented names such as ``Kévin`` render correctly.
It does **not** cover Chinese, Japanese or Korean. Characters outside its
coverage are drawn as ``□`` rather than dropped, and the export logs which
ones to the browser console so nothing disappears silently.

Microsoft Project (``.mpp``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Writes a **native** ``.mpp`` file that opens in Microsoft Project by
double-click.  Tasks, phases, dependencies, milestones, resources,
assignments, percent complete and comments all carry across.

1. Click **Tools** → **Export to MS Project**
2. The file downloads as ``{project-name}.mpp``

The file is built **entirely in your browser** by the
`mppwriter <https://www.npmjs.com/package/mppwriter>`_ library, from the
plan the page has already scheduled.  Nothing about your plan is sent
anywhere: the only request the export makes is for the template described
below, and the server has no ``.mpp`` endpoint at all.  Dependency type and
lag (``[depends Design:SS +2d]``) carry across, and a link that Microsoft
Project would reject as circular is left out with the reason written in the
task's notes.

The writer works from a template: a blank project saved by Microsoft
Project, because the file embeds structures only Project can create.  One
ships with the app at ``packages/noodle-web/src/noodle_web/static/mpp-template.mpp``
(served as ``/static/mpp-template.mpp``), so nothing needs setting up.
The older MS Project XML (MSPDI) export is no longer in the menu;
integrations can still request it from the API (see
:doc:`../reference/export-formats`).

Using your own template
^^^^^^^^^^^^^^^^^^^^^^^^

If you want exported files to start from your organisation's own blank
project (its calendar, views or custom fields), save one from Microsoft
Project following the `pymppwriter README
<https://github.com/kevinmcaleer/pymppwriter>`_ recipe and replace the
bundled file.  If the file cannot be loaded the export stops with a message
saying so; it never falls back to the server.

What does not round-trip yet
^^^^^^^^^^^^^^^^^^^^^^^^^^^^

Calendars and non-working days, task constraints and baselines are not
written to the ``.mpp`` file; Microsoft Project uses its standard calendar.
Costs and timephased data are not modelled by the library.

Export the RAID Log
--------------------

From the **RAID Log** view:

1. Click the **Export** icon in the RAID log toolbar
2. An Excel file is downloaded with all RAID items

Related
--------

- :doc:`import-from-excel` — how to import plans from Excel
- :doc:`use-the-portfolio-view` — export a portfolio report covering all projects
