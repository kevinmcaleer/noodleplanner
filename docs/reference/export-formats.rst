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

PowerPoint (``.pptx``)
~~~~~~~~~~~~~~~~~~~~~~~

The project report deck, and the portfolio deck covering every project.

- Access: **Tools** → **Export Report to PowerPoint**; the portfolio deck from
  the **Portfolio** view's export button
- Filenames: ``{project-name} - Report.pptx`` and
  ``{portfolio-name} - Portfolio Report.pptx``

Both are built in the browser with `PptxGenJS <https://gitbrent.github.io/PptxGenJS/>`_
from the payload the page already assembles, so no plan data reaches the
server. The report deck is a four-quadrant slide (milestones, up next, latest
highlight, risks and issues) plus a dedicated highlight slide; the portfolio
deck adds an overview table and a combined risks slide before one slide per
project. Captured timeline images are embedded. The browser and Python decks
are compared slide by slide in ``tests/test_pptx_browser_export.mjs``, and the
portfolio deck is pinned against a committed reference — slide text, fill
colours, shape geometry and table shape — in
``tests/test_portfolio_deck_reference.mjs``.

The timeline images are rasterised from the live page with html2canvas, which
clones the whole document and re-resolves every stylesheet on each call. That
fixed cost dominates the export, so every project's timeline is laid out in one
offscreen container, rasterised in a **single** call, and cropped apart
afterwards (issue #778). ``tests/test_portfolio_timeline_capture.mjs`` checks
the crops are byte-identical to capturing each project on its own.

PDF
~~~~

A printable version of the project report.

- Access: **Tools** → **Export → PDF**
- Filename: ``{project-name}.pdf``, or ``{project-name} v{version}.pdf`` when
  the front matter carries a ``version``

Built entirely in the browser with `jsPDF <https://github.com/parallax/jsPDF>`_
from the plan the page has already scheduled; no plan data reaches the server.
The page content is the same monospaced report the ASCII view shows, and the
browser builder is checked line for line against the Python one over the whole
plan corpus in ``tests/test_pdf_docx_browser_export.mjs``. Paper size is A4 by
default; ``localStorage`` key ``np-pdf-page-size`` set to ``letter`` switches
it. See :doc:`../how-to/export-your-plan` for font coverage.

.. note::

   **Why jsPDF and not pdfmake.** The export is a monospaced text report, not
   a laid-out document, so pdfmake's richer layout engine buys nothing here
   while costing about five times the download (529 KB gzipped against 112 KB).
   Neither library's built-in fonts cover the accented names that appear in
   real plans, so a font had to be embedded either way; DejaVu Sans Mono is
   vendored alongside jsPDF for that. If the PDF ever becomes a formatted
   report rather than a text dump, pdfmake becomes the better choice and this
   decision should be revisited.

Word (``.docx``)
~~~~~~~~~~~~~~~~~

The communications plan as a landscape Word document.

- Access: **Comms Plan** view → **Export as Word**
- Filename: ``{project-name} - Communications Plan.docx``

Built in the browser with the `docx <https://docx.js.org/>`_ library, and
checked against the Python version for the same text, table shape, landscape
orientation and borders.

Microsoft Project XML (``.xml``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Exports the plan as a Microsoft Project XML file that can be opened in Microsoft Project.

- Access: API only — ``POST /render`` with ``export_msproject: true``. The
  Tools menu offers the native ``.mpp`` export below instead.
- Filename: ``{project-name}.xml``

The file follows the MSPDI schema, so Microsoft Project, ProjectLibre and
Smartsheet all open it directly — use **File → Open** and pick the ``.xml``
file. Tasks carry their outline hierarchy, durations, dependencies, percent
complete, notes and resource assignments.

Every calendar the plan declares (see :doc:`front-matter`'s ``calendar`` /
``calendars`` fields, issue #1133) is written as its own MS Project
calendar — working/non-working days, optional daily hours, and dated
exceptions, with the plan's project-wide ``non-working-days:`` layered onto
every one of them so a declared shutdown is honoured regardless of which
calendar governs a given task. The project opens set to whichever calendar
is active, and a resource assigned its own calendar (a ``calendar <Name>``
suffix on its ``Resources:`` line) carries that calendar in Microsoft
Project too. A plan with no ``calendar``/``calendars`` fields at all still
exports a single Monday–Friday 08:00–17:00 Standard calendar, exactly as
before this was added — nothing changes for a plan that never mentions
calendars. A calendar's optional ``hours`` becomes one working-time block
per day (Microsoft Project's own lunch-split default is used when a
calendar sets no hours of its own); a shift-rotation calendar (a bracketed,
multi-week pattern) is represented with Microsoft Project's ``WorkWeeks``
date-bounded overrides, spanning the exported project's actual date range —
Microsoft Project's calendar model has no way to say "alternate forever",
only "these specific weeks differ". Re-importing such a file reconstructs
the rotation when every overridden week shares one pattern (true of every
file this app exports); a calendar with irregular, varying overrides —
possible in a file hand-edited in Microsoft Project — imports as its plain
base pattern instead of a guessed cycle.

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

Microsoft Project (``.mpp``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

A native ``.mpp`` file that opens in Microsoft Project by double-click.

- Access: **Tools** → **Export to MS Project**
- Filename: ``{project-name}.mpp``

Built entirely in the browser with the `mppwriter
<https://www.npmjs.com/package/mppwriter>`_ library from the plan the page
has already scheduled; no plan data is sent to the server. It writes from a
blank project template that ships with the app at
``/static/mpp-template.mpp``; see :doc:`../how-to/export-your-plan` for
what does not round-trip yet and for using your own template. The same
library reads ``.mpp``
files on import, also in the browser; see
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

Tasks by Assignment (``.xlsx``, ``.pptx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The Tasks by Assignment report as it is showing, filters included. Excel: a
Summary sheet (one row per person) and a sheet per person listing their tasks.
PowerPoint: an overview slide, then a slide (or more) per person.

- Access: **Report** → **By Assignment** → **Excel** / **PowerPoint**
- Filename: ``<project>_tasks_by_assignment.xlsx`` / ``.pptx``

Slippage (``.xlsx``, ``.pptx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The Slippage report: variance against the baseline in working days. Excel:
Summary, Critical path, Phases, Tasks and Scope changes sheets. PowerPoint: a
headline slide, then critical-path slippage, phases, every task and scope
changes.

- Access: **Report** → **Slippage** → **Excel** / **PowerPoint**
- Filename: ``<project>_slippage.xlsx`` / ``.pptx``

Portfolio Exports
------------------

Portfolio PowerPoint (``.pptx``)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

A multi-slide portfolio report:

- Access: **Portfolio** → ``...`` menu → **Export Report**
- Slide 1: Portfolio overview (project table, timeline, summary counts)
- Subsequent slides: One report slide per project (header, timeline, milestones, risks, highlights)

A progress toast tracks the export while it runs. The deck is assembled and
zipped in a Web Worker, so the page stays responsive for that part; the
timeline captures need a live DOM and so still run on the main thread.

To profile the export on a realistic portfolio::

   uv run uvicorn noodle_web.app:app --host 127.0.0.1 --port 8007 &
   node tests/benchmarks/profile_pptx_export.mjs --projects 10 --runs 3

That builds a ten-project fixture, drives a real headless browser through the
real export, and prints a per-stage wall-clock breakdown.
