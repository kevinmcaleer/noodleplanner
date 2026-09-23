"""A lag or lead on a sequential task: ``* +2d Build 3d``.

``* +2d X`` means ``X [depends Prev +2d]``: X starts two working days after
the previous task finishes (``-1d`` is a one-day lead), its name is ``X``
and its duration is its own ``3d``, not the lag's ``2d``. The browser
engine is held to the same answers by tests/test_engine_conformance.mjs and
the ``sequential-lag`` conformance fixture.
"""

import pytest

from noodle_core import extract_metadata
from noodle_web.plan_service import PlanService

LAGGED = (
    "P\n"
    "  Design 3d 2026-06-01\n"
    "  * +2d Build 3d\n"
    "  *+2d Cure 2d\n"
    "  * -1d Inspect 1d\n"
    "  Review 1d [depends Build]\n"
)
SPELLED_OUT = (
    "P\n"
    "  Design 3d 2026-06-01\n"
    "  Build 3d [depends Design +2d]\n"
    "  Cure 2d [depends Build +2d]\n"
    "  Inspect 1d [depends Cure -1d]\n"
    "  Review 1d [depends Build]\n"
)


def _tasks(plan):
    return {t["name"]: t for t in PlanService().parse(plan).tasks}


@pytest.mark.parametrize("line, lag", [
    ("* +2d Build 3d", "+2d"),
    ("*+2d Build 3d", "+2d"),
    ("* -1d Build 3d", "-1d"),
])
def test_the_lag_is_neither_the_duration_nor_the_name(line, lag):
    meta = extract_metadata(line)
    assert meta["sequential"] is True
    assert meta["sequential_lag"] == lag
    assert meta["description"] == "Build"
    assert meta["duration"].days == 3


def test_a_plain_star_or_a_dependency_lag_is_not_a_sequential_lag():
    assert "sequential_lag" not in extract_metadata("*Build 3d")
    assert "sequential_lag" not in extract_metadata("Build 3d [depends A +2d]")


def test_lagged_tasks_are_named_without_the_lag():
    assert list(_tasks(LAGGED)) == ["P", "Design", "Build", "Cure", "Inspect", "Review"]


def test_a_star_lag_schedules_as_the_spelled_out_dependency_lag():
    lagged, spelled = _tasks(LAGGED), _tasks(SPELLED_OUT)
    for name in ["Build", "Cure", "Inspect", "Review"]:
        a, b = lagged[name], spelled[name]
        assert (a["start"], a["finish"], a["duration_days"], a["lag_lead"]) == \
            (b["start"], b["finish"], b["duration_days"], b["lag_lead"]), name


def test_the_lag_shifts_the_start_by_working_days():
    tasks = _tasks(LAGGED)
    # Design runs Mon 06-01 for three days, finishing 06-04; a plain `*`
    # would start Build on 06-04, and +2 working days makes it Mon 06-08.
    assert tasks["Design"]["finish"] == "2026-06-04"
    assert tasks["Build"]["start"] == "2026-06-08"
    assert tasks["Build"]["duration_days"] == 3
    assert tasks["Build"]["depends"] == ["Design"]
    assert tasks["Build"]["lag_lead"] == {"Design": "+2d"}


def test_a_negative_lag_is_a_lead():
    tasks = _tasks(LAGGED)
    assert tasks["Inspect"]["start"] < tasks["Cure"]["finish"]
    assert tasks["Inspect"]["lag_lead"] == {"Cure": "-1d"}


def test_a_dependency_on_a_lagged_task_resolves_by_name():
    tasks = _tasks(LAGGED)
    assert tasks["Review"]["depends"] == ["Build"]
    assert tasks["Review"]["start"] == tasks["Build"]["finish"]
