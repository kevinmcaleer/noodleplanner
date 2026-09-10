Two Scheduling Engines, One Answer
====================================

NoodlePlanner schedules a plan twice over, in two languages, and the two must
always agree. This page explains why that is deliberate, and what keeps them
honest.

Why there are two
------------------

The plan is scheduled on every edit. Doing that on the server means a network
round trip for each keystroke-driven update, and the server is a Raspberry Pi,
where CPU is the scarce resource. Scheduling in the browser removes the trip
and the CPU cost together: a 550-task plan schedules in about **40 ms** in the
browser against roughly **370 ms** for the round trip on the Pi, and the
server does no work at all.

But Python is still needed. The command-line tool (``packages/noodle-cli``)
has no browser, and neither does anything that drives NoodlePlanner as a
library. So the Python engine stays, and there are two implementations:

- ``packages/noodle-core/src/noodle_core/`` — ``scheduling_engine.py``,
  ``metadata.py``, ``date_math.py``. Used by the CLI and by the server.
- ``packages/noodle-web/src/noodle_web/static/engine/`` — ``scheduler.js``,
  ``tokeniser.js``, ``date-math.js``. Used by the browser.

The alternative — one implementation, with the CLI shelling out to a
JavaScript runtime, or the browser running Python through Pyodide — was
weighed and rejected. Pyodide costs about 5 MB of download and is slower
exactly where speed matters, and making the CLI depend on Node inverts the
problem rather than solving it.

What keeps them honest
-----------------------

A shared **conformance corpus**: plans in, scheduled output out.

``tests/fixtures/conformance/`` holds a set of plans, each with a sibling
``.expected.json`` recording the complete ``/api/parse`` payload the Python
engine produces for it. Both engines are checked against those files, and
divergence fails the build:

.. list-table::
   :header-rows: 1
   :widths: 45 55

   * - Check
     - What it catches
   * - ``scripts/build_conformance_corpus.py --check``
     - The Python engine changed but the corpus was not regenerated
   * - ``tests/test_conformance_corpus.py``
     - The Python engine no longer matches the recorded answers
   * - ``tests/test_engine_conformance.mjs``
     - The browser engine diverged from the corpus
   * - ``tests/test_engine_date_math.mjs``
     - Working-day arithmetic differs, compared directly against Python
   * - ``tests/test_engine_tokeniser.mjs``
     - The task-line grammar differs, over every line in the corpus

All of these run on every push and pull request
(``.github/workflows/engine-conformance.yml``).

The corpus covers every dependency type, lag and lead, ``*`` chains, nested
summaries and their roll-up, milestones, non-working days, recurrence,
``$product`` tokens, priorities, buckets, effort, labels, quality roles,
explicit dates, percent complete and both kinds of circular dependency.

Time is frozen
~~~~~~~~~~~~~~~

A task with no date starts from today, and a task's RAG is judged against
today. An un-frozen corpus would therefore be rewritten every morning and
prove nothing. The corpus is generated at a fixed date, and the browser
engine takes that date as a parameter, so the comparison is stable.

Changing the schedule on purpose
---------------------------------

When you intend to change how plans schedule:

1. Change the Python engine.
2. Regenerate the corpus::

       uv run scripts/build_conformance_corpus.py

3. **Review the diff.** It shows exactly which tasks now schedule
   differently, which is the point of the corpus.
4. Make the matching change in the browser engine, until
   ``node --test tests/test_engine_conformance.mjs`` passes again.

If the two engines disagree and it is not obvious which is right, the Python
engine is the reference: the corpus is generated from it.

Which engine runs
------------------

The browser engine is the default: editing a plan makes no ``/api/parse``
request at all. If it throws, the page falls back to the server for that
render rather than showing nothing.

To force the server — to compare the two, or to work around a suspected
engine bug — from the browser console::

    localStorage.setItem('np-local-engine', '0')   // use the server
    localStorage.setItem('np-local-engine', '1')   // use the browser
    localStorage.removeItem('np-local-engine')     // back to the default

Known differences
------------------

None currently. Both engines schedule around the same front-matter calendar:
project-wide ``non-working-days:``/``holidays:``, per-resource
``non-working [...]`` exceptions (issue #837), a named ``calendar:`` /
``calendars:`` week pattern or shift rotation (issue #1132), and a
resource's own ``calendar <Name>`` assignment overriding the project's for
that resource's tasks (issue #1136) -- see :doc:`../reference/front-matter`.
``PlanService._schedule_and_build_tasks`` passes
``FrontMatterParser.parse_non_working_days()``,
``parse_resource_non_working_days()``, ``active_calendar()`` and
``resource_calendars()`` into ``schedule_tasks``, and the browser engine's
``localParse`` applies the same calendar by default (``local-parse.js``'s
``applyCalendar`` option, on unless passed ``false``, computing the active
and per-resource calendars via ``calendar.js``'s ``activeCalendar()`` and
``resolvedResourceCalendars()``). ``tests/test_engine_conformance.mjs``
passes the same calendars through for both, including a fixture with a
named Sun-Thu calendar and a resource assigned to it
(``named-calendar.md``), so the two engines keep agreeing.

Related
--------

- :doc:`browser-first-architecture` — the programme-level view: the route
  inventory, the JS-native vs Pyodide decision, and the end-state
- :doc:`../reference/plan-format` — the format both engines implement
- Issue #793 — the port
- Issue #788 — the browser-first programme this is part of
