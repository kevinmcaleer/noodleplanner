#!/usr/bin/env python3
"""Build the conformance corpus that pins the plan engine's behaviour.

Issue #793 ports the scheduler to the browser. Two engines can only be kept
honest by a shared corpus: plans in, scheduled output out, checked against
both. This script produces the expected output from the Python engine — the
reference — so ``tests/test_engine_conformance.mjs`` can hold the JavaScript
one to it, and ``tests/test_conformance_corpus.py`` can catch the Python one
drifting.

Every plan in ``tests/fixtures/conformance/`` gets a sibling
``<name>.expected.json`` holding the full ``/api/parse`` payload.

**Time is frozen.** ``schedule_tasks`` starts an undated task from today, so
an un-frozen corpus would be rewritten every day and prove nothing. Both
engines use the date below; the JavaScript engine takes it as a parameter.

Usage::

    uv run scripts/build_conformance_corpus.py           # rewrite expectations
    uv run scripts/build_conformance_corpus.py --check    # fail if any differ
"""

from __future__ import annotations

import argparse
import dataclasses
import datetime as _datetime
import json
import logging
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CORPUS = REPO / "tests" / "fixtures" / "conformance"

# The instant both engines schedule from. A Monday, so "today" needs no
# weekend snapping and the fixtures read naturally.
FROZEN_TODAY = _datetime.datetime(2026, 6, 1)


class _FrozenDatetime(_datetime.datetime):
    """datetime whose now() is FROZEN_TODAY; everything else is unchanged."""

    @classmethod
    def now(cls, tz=None):  # noqa: D102 - matches datetime.now
        return FROZEN_TODAY

    @classmethod
    def today(cls):  # noqa: D102 - matches datetime.today
        return FROZEN_TODAY


def freeze_time() -> None:
    """Point every clock the payload depends on at FROZEN_TODAY.

    Two modules read the time: ``date_math`` starts undated tasks from today,
    and ``exporters`` compares against today to decide each task's RAG. Both
    have to be frozen, or the corpus records a RAG that changes tomorrow.
    """
    from noodle_core import date_math, exporters

    date_math.datetime = _FrozenDatetime
    exporters.datetime = _FrozenDatetime


def build(plan_text: str, project_name: str | None = None) -> dict:
    """The /api/parse payload for one plan, with the clock frozen."""
    from noodle_web.plan_service import PlanService

    result = PlanService().parse(plan_text, project_name=project_name)
    payload = dataclasses.asdict(result)
    # ascii_output is opt-in and empty here (#789); it is not part of the
    # contract the browser engine has to reproduce.
    payload.pop("ascii_output", None)
    return payload


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true",
                        help="fail if any expectation is out of date instead of rewriting it")
    args = parser.parse_args(argv)

    logging.disable(logging.CRITICAL)
    freeze_time()

    plans = sorted(CORPUS.glob("*.md"))
    if not plans:
        print(f"no plans found in {CORPUS}", file=sys.stderr)
        return 1

    stale: list[str] = []
    for plan_path in plans:
        expected_path = plan_path.with_suffix(".expected.json")
        payload = build(plan_path.read_text(encoding="utf-8"))
        rendered = json.dumps(payload, indent=1, sort_keys=True, default=str) + "\n"

        if args.check:
            if not expected_path.exists() or expected_path.read_text(encoding="utf-8") != rendered:
                stale.append(plan_path.name)
            continue

        expected_path.write_text(rendered, encoding="utf-8")
        print(f"  {plan_path.name}: {len(payload['tasks'])} tasks -> {expected_path.name}")

    if args.check:
        if stale:
            print("expectations are out of date for: " + ", ".join(stale), file=sys.stderr)
            print("run: uv run scripts/build_conformance_corpus.py", file=sys.stderr)
            return 1
        print(f"{len(plans)} expectation(s) up to date")
        return 0

    print(f"wrote {len(plans)} expectation(s) frozen at {FROZEN_TODAY:%Y-%m-%d}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
