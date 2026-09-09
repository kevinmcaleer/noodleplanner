Browser-First Architecture
===========================

The backend that serves NoodlePlanner runs on a Raspberry Pi. Every
millisecond of server CPU is expensive there, and until this programme the
app called the server on essentially every plan edit. This page records why
that changed, the decision behind how it changed, and — the part that
matters most once the code has moved on — exactly which routes are left and
why. It is the design note issue #788 asked for; the work itself is
covered phase by phase in :doc:`two-scheduling-engines` and
:doc:`browser-local-store`, which this page links to rather than repeats.

The hot path, and what it cost
-------------------------------

``updateAllViews()`` (``static/script.js``) called ``POST /api/parse`` on
essentially every keystroke-driven update. Measured server-side on an
M-series Mac before any of this work started:

.. list-table::
   :header-rows: 1
   :widths: 20 20

   * - Tasks
     - ``/api/parse``
   * - 110
     - 9.5 ms
   * - 275
     - 24.4 ms
   * - 550
     - 52.6 ms
   * - 1,100
     - 129.1 ms

A Raspberry Pi 5 measured 3.8× that at 110 tasks, rising to 7.6× at 1,100 —
the gap widens exactly where it hurts, because the Pi scales worse than the
Mac does. HTTP overhead added roughly another 13% on top of the parse
itself. Both figures, and the harness that produced them
(``scripts/benchmark_parse.py``), are recorded on issue #788.

The route inventory
---------------------

When this programme was scoped, the backend served 29 routes, classified by
whether the work behind them could move to the browser:

.. list-table::
   :header-rows: 1
   :widths: 30 10 15 45

   * - Category
     - Routes
     - Movable?
     - Disposition
   * - Pure computation — parse, schedule, export, import
     - ~17
     - Yes
     - Moved; see `The end-state`_
   * - Static data — templates, agent definitions, favicon, logo
     - ~8
     - Yes, as static files
     - Favicon/logo were already static. Templates and agent definitions are
       still served dynamically from disk — Phase 4 below, not started.
   * - Needs a server — ``/api/ai/chat``, ``/api/ai/test``
     - 2
     - No, unless a BYO-key mode is added
     - Unchanged; hold provider API keys
   * - Health / page shell
     - 2
     - n/a
     - Unchanged

The app has grown routes since this was scoped — a search endpoint, MS
Project XML import, programme dependencies, and the live-collaboration
relay (``/ws/session/{id}``, ``/api/collab/start``, ``/join/{id}``) that
issue #766 anticipated. None of those were part of the 29 this programme
inventoried, and the collaboration relay is inherently a server for the same
reason ``/api/ai/chat`` is: coordinating more than one browser, or holding a
secret, is not something a browser can do for itself.

The port decision: JS-native or Pyodide
------------------------------------------

Two ways existed to move the ~17 pure-computation routes into the browser,
and both were measured before choosing.

**Pyodide** — run the existing Python unchanged, via WebAssembly:

.. list-table::
   :header-rows: 1
   :widths: 60 20

   * - Asset
     - Transferred
   * - ``pyodide.asm.wasm``
     - 2.75 MB gz
   * - ``python_stdlib.zip``
     - 2.32 MB
   * - ``pyodide.asm.js``
     - 215 KB gz
   * - ``lxml`` wheel (python-pptx dependency)
     - 1.74 MB
   * - ``pillow`` wheel (python-pptx dependency)
     - 1.03 MB
   * - ``python-pptx``, ``openpyxl``, ``reportlab`` (pure-Python wheels)
     - ~2.6 MB
   * - misc (pyyaml, dateutil, six, micropip, et-xmlfile)
     - ~300 KB
   * - **Total for the full export stack**
     - **~11 MB**

Verified as workable — every needed package publishes a pure-Python wheel
``micropip`` can install — but it costs ~11 MB and a cold start, and WASM
Python is slower than native exactly where speed was the point.

**JS-native** — port the logic, use JS libraries:

.. list-table::
   :header-rows: 1
   :widths: 60 20

   * - Library
     - Transferred (gz)
   * - ExcelJS 4.4.0
     - 250 KB
   * - PptxGenJS 3.12.0
     - 153 KB
   * - jsPDF 2.5.2
     - 112 KB
   * - **Total for all three exporters**
     - **515 KB**

~11 MB against ~515 KB is a 20× difference, for reference against the app's
own JS payload at the time (380 KB gzipped). The cost of JS-native is
porting effort: the exporters, and for the scheduler, roughly 4,000 lines of
``scheduling_engine.py`` + ``metadata.py`` + ``date_math.py`` +
``front_matter_parser.py``.

**Decision made: JS-native, phased**, and that is what shipped — every
exporter and the scheduler itself were ported to JavaScript rather than run
through Pyodide. Pyodide remains the documented fallback for code that is
rarely used and expensive to port, such as the 1,361-line binary ``.mpp``
reader — a candidate to load lazily, on demand, if it is ever revisited. It
has not been needed so far: ``.mpp`` import and export both shipped as
direct JavaScript ports instead (`mppwriter
<https://www.npmjs.com/package/mppwriter>`_ — see
:doc:`../reference/export-formats`).

Keeping the Python engine honest
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Porting the scheduler creates a second implementation, and
``packages/noodle-cli`` still needs the first. How the two are kept in
agreement — a conformance corpus checked in CI — is :doc:`two-scheduling-engines`'
subject, not repeated here.

The phasing, and what shipped
--------------------------------

.. list-table::
   :header-rows: 1
   :widths: 12 40 30 18

   * - Phase
     - Scope
     - Issue → shipped via
     - Status
   * - 0
     - Stop ``/api/parse`` computing the unread ``ascii_output`` table;
       de-duplicate the double scheduling pass
     - #789 → PR #815
     - Merged
   * - 1
     - Move the exporters — Excel/CSV, PowerPoint, PDF/DOCX — to the browser
     - #790 → PRs #824, #831; #791 → PR #832; #792 → PR #830
     - Merged, default on
   * - 2
     - Move plan parsing and scheduling to the browser
     - #793 → PRs #835, #836
     - Merged, default on
   * - 3
     - Replace ``localStorage`` with a real browser-local store
     - #794 → PR #826
     - Merged
   * - 4
     - Serve templates and agent definitions as static files; retire what's
       left
     - No tracking issue yet
     - **Not started**

Phase 4 is the one gap in the phasing: unlike Phases 0–3, nobody has filed
the issue for it. The routes it covers (``/api/templates``, its two
sub-routes, ``/api/ai/agents`` and its sub-route) are not on the hot path —
they are not called on every keystroke the way ``/api/parse`` was — which is
presumably why they were left for last and then not picked up. They are
still genuinely dynamic FastAPI handlers reading from disk on every request,
not static files, so the classification table above still counts them as
outstanding rather than done.

The end-state
---------------

What is actually server-side today, and why, route by route:

.. list-table::
   :header-rows: 1
   :widths: 35 65

   * - Disposition
     - Routes
   * - **Genuinely needs a server**
     - ``POST /api/ai/chat``, ``POST /api/ai/test`` — hold provider API keys.
       ``POST /api/collab/start``, ``GET /join/{session_id}``,
       ``WS /ws/session/{session_id}`` — coordinating several browsers in a
       live session (issue #766) is irreducibly a server's job; added after
       this programme was scoped, same reasoning applies.
   * - **Moved to the browser; server route kept as an inactive fallback**
     - ``POST /api/parse`` and the browser scheduling engine
       (``localStorage np-local-engine``); the Excel, PowerPoint, PDF and
       DOCX/comms export and RAID/budget import routes
       (``localStorage np-server-exports``). The flag exists so the server
       path can be forced for comparison or if a browser engine bug is
       suspected — see :doc:`two-scheduling-engines`. Neither flag is set by
       default, so none of these routes carry live traffic.
   * - **Deliberately stayed server-side (accepted scope reduction)**
     - ``POST /api/excel/analyze``, ``POST /api/excel/convert``,
       ``POST /api/excel/convert-planner`` — the generic Excel import
       wizard's column detection and format sniffing
       (``excel_importer.py``, 1,574 lines). Issue #790 scoped this out
       explicitly: it is the largest and riskiest part of that issue, and the
       *targeted* RAID and budget imports — the routine traffic — moved
       instead. The wizard can still move in a follow-up; nothing about the
       current architecture blocks it.
   * - **Not yet moved — Phase 4, unstarted**
     - ``GET /api/templates``, ``GET /api/templates/{id}``,
       ``GET /api/templates/{id}/hero.{ext}``, ``GET /api/ai/agents``,
       ``GET /api/ai/agents/{id}`` — read from disk on every request rather
       than being served as static files.
   * - **Static file serving / page shell — unaffected**
     - ``/``, ``/favicon.png``, ``/logo.png``, ``/manifest.webmanifest``,
       ``/sw.js``, ``/health``, ``/templates`` (the HTML page, distinct from
       the API routes above)

Related
--------

- :doc:`two-scheduling-engines` — the Phase 2 decision in detail: why two
  scheduling implementations exist, and the conformance corpus that keeps
  them honest
- :doc:`browser-local-store` — the Phase 3 decision: why IndexedDB and not
  SQL, and how the migration from ``localStorage`` works
- :doc:`../reference/export-formats` — what each export format contains and
  which library builds it
- Issue #788 — the umbrella issue this page closes out
- Issues #789, #790, #791, #792, #793, #794 — the phase issues
