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

Microsoft Project (``.mpp``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Writes a **native** ``.mpp`` file that opens in Microsoft Project by
double-click — unlike the XML export, which has to be opened from inside
Project.  Tasks, phases, dependencies, milestones, resources, assignments,
percent complete and comments all carry across.

1. Click **Tools** → **Export to MS Project (.mpp)**
2. The file downloads as ``{project-name}.mpp``

The file is built **entirely in your browser** by the
`mppwriter <https://www.npmjs.com/package/mppwriter>`_ library, from the
plan the page has already scheduled.  Nothing about your plan is sent
anywhere: the only request the export makes is for the template described
below, and the server has no ``.mpp`` endpoint at all.  Dependency type and
lag (``[depends Design:SS +2d]``) carry across, and a link that Microsoft
Project would reject as circular is left out with the reason written in the
task's notes, exactly as the XML export does.

Native export needs a one-time template saved from a licensed copy of
Microsoft Project (the file embeds structures only Project can create — see
the `pymppwriter README <https://github.com/kevinmcaleer/pymppwriter>`_ for
the two-minute recipe).  The XML export (**Export to MS Project (XML)**) keeps
working without any template.

Where to put the template
^^^^^^^^^^^^^^^^^^^^^^^^^

Copy it to ``packages/noodle-web/src/noodle_web/static/mpp-template.mpp`` so
the app serves it at ``/static/mpp-template.mpp``.  When it is missing the
export stops with a message saying so; it never falls back to the server.

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
