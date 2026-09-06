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

Turning the browser engine on
------------------------------

It is currently opt-in. From the browser console::

    localStorage.setItem('np-local-engine', '1')   // schedule in the browser
    localStorage.setItem('np-local-engine', '0')   // use the server
    localStorage.removeItem('np-local-engine')     // back to the default

With it on, editing a plan makes no ``/api/parse`` request at all. If the
browser engine throws, the page falls back to the server for that render
rather than showing nothing.

Known differences
------------------

One difference is deliberate, and worth knowing about because it looks like a
bug in the browser engine and is not.

**The front-matter calendar is ignored on the web path.** Both engines can
schedule around project-wide and per-resource non-working days, but
``PlanService`` does not pass them: ``_schedule_and_build_tasks`` calls
``schedule_tasks(phases)`` with no holidays, so the ``non-working-days:``
front matter is parsed and then unused when the server answers
``/api/parse``. The browser engine matches that, so the two agree. Wiring the
calendar through is a one-line change on the Python side, and when it is made
the corpus will need regenerating and the browser engine will need
``applyCalendar`` turned on to match.

Related
--------

- :doc:`../reference/plan-format` — the format both engines implement
- Issue #793 — the port
- Issue #788 — the browser-first programme this is part of
