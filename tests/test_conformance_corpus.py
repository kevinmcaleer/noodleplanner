"""The conformance corpus pins the plan engine's behaviour (issue #793).

The browser engine is held to the corpus by
``tests/test_engine_conformance.mjs``; this module holds the *Python* engine
to it, so a change in the scheduler shows up as a corpus diff to be reviewed
rather than as a silent divergence between the two implementations.

Regenerate deliberately after an intended change::

    uv run scripts/build_conformance_corpus.py
"""

import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
CORPUS = REPO / "tests" / "fixtures" / "conformance"
sys.path.insert(0, str(REPO / "scripts"))

from build_conformance_corpus import FROZEN_TODAY, build, freeze_time  # noqa: E402

PLANS = sorted(CORPUS.glob("*.md"))
assert PLANS, "the conformance corpus is empty"


@pytest.fixture(scope="module", autouse=True)
def frozen_clock():
    """The corpus is generated at a fixed date; the checks must match it.

    freeze_time() rebinds the ``datetime`` class inside ``date_math`` and
    ``exporters`` process-wide, so the freeze has to be undone afterwards:
    without this, every test module that happened to run after this one saw
    2026-06-01 as "today" and any test of dating or RAG passed or failed by
    accident of collection order (tests/test_first_time_plan.py found this).
    """
    from noodle_core import date_math, exporters

    original = (date_math.datetime, exporters.datetime)
    freeze_time()
    try:
        yield
    finally:
        date_math.datetime, exporters.datetime = original


@pytest.mark.parametrize("plan_path", PLANS, ids=[p.stem for p in PLANS])
def test_python_engine_still_matches_the_corpus(plan_path):
    expected_path = plan_path.with_suffix(".expected.json")
    assert expected_path.exists(), (
        f"{plan_path.name} has no expectation; run "
        "`uv run scripts/build_conformance_corpus.py`"
    )

    actual = json.loads(json.dumps(build(plan_path.read_text(encoding="utf-8")), default=str))
    expected = json.loads(expected_path.read_text(encoding="utf-8"))

    assert actual["success"] is True, f"{plan_path.name} no longer parses"
    assert [t["name"] for t in actual["tasks"]] == [t["name"] for t in expected["tasks"]], "task order changed"
    assert actual == expected, (
        f"{plan_path.name} no longer schedules as the corpus records. If the change is "
        "intended, regenerate with `uv run scripts/build_conformance_corpus.py` and "
        "review the diff."
    )


def test_the_corpus_covers_the_grammar():
    """A corpus that does not exercise the format proves nothing."""
    plans = "\n".join(p.read_text(encoding="utf-8") for p in PLANS)

    for construct in [
        ":SS", ":FF", ":SF",            # dependency types (#640)
        "+2d", "-1d", "+1w",            # lag and lead
        "*", "*+2d",                    # sequential chains
        "0d",                           # milestones
        "non-working-days:", "non-working [",  # calendars (#117)
        "[repeats",                     # recurrence (#665)
        "$discovery", "[depends $",     # products
        "!!!", "{Research}", "~8h/16h", # priority, bucket, effort
        "#urgent", "@adam:R", "@kev:A", # labels, quality roles
        "100%", "2026-07-01",           # progress, explicit dates
        "@dev[50%]",                    # allocation, not progress
    ]:
        assert construct in plans, f"the corpus does not exercise {construct!r}"


def test_the_corpus_exercises_the_scheduler_not_just_the_parser():
    """Every expectation must carry scheduled dates and a critical path."""
    for plan_path in PLANS:
        expected = json.loads(plan_path.with_suffix(".expected.json").read_text(encoding="utf-8"))
        tasks = expected["tasks"]
        assert tasks, f"{plan_path.name} scheduled no tasks"
        assert all(t["start"] and t["finish"] for t in tasks), f"{plan_path.name} has undated tasks"
        assert any(t["critical"] for t in tasks), f"{plan_path.name} has no critical path"

    circular = json.loads((CORPUS / "circular.expected.json").read_text(encoding="utf-8"))
    flagged = [t for t in circular["tasks"] if t["circular_dependencies"]]
    assert flagged, "the circular fixture should flag circular dependencies"


def test_undated_tasks_start_from_the_frozen_date():
    """The freeze is what makes the corpus stable; prove it is in effect."""
    expected = json.loads((CORPUS / "sequential-chains.expected.json").read_text(encoding="utf-8"))
    first = next(t for t in expected["tasks"] if t["name"] == "First")
    assert first["start"] == FROZEN_TODAY.strftime("%Y-%m-%d")
