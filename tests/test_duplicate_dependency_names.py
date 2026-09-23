"""A dependency on a duplicated task name means its first definition.

Before this was settled the name lookup kept the *last* definition.  The
scheduler walks the plan once, top to bottom, so when that last definition
came after the dependant it had no dates yet, the dependency was skipped, and
the dependant silently started today.  The first definition is the rule now,
in both engines (the browser's is pinned by the conformance corpus and
tests/test_duplicate_dependency_names.mjs) and everywhere a link is drawn or
exported, so the link a plan shows is the link it schedules.
"""

import os
import tempfile
import xml.etree.ElementTree as ET
from datetime import datetime

from noodle_core.metadata import task_name_lookup
from noodle_core.msproject import export_to_msproject_xml
from noodle_core.scheduling_engine import natural_language_to_yaml, schedule_tasks

NS = "http://schemas.microsoft.com/project"

PLAN = """Phase
  Design 3d 2026-01-05
  Design UI 2d [depends Design]
Other
  Design 4d 2026-01-05
  Build 2d [depends design]"""


def _schedule(plan):
    phases = natural_language_to_yaml(plan, "P")["P"]
    return schedule_tasks(phases if isinstance(phases, list) else [phases])


def _task(tasks, name, parent):
    return next(t for t in tasks if t.get("name") == name and t.get("parent") == parent)


def test_lookup_keeps_the_first_definition():
    first, second = {"name": "Design"}, {"name": "design"}
    assert task_name_lookup([first, second, {"name": ""}, {}]) == {"design": first}


def test_dependant_follows_the_first_definition_not_today():
    tasks = _schedule(PLAN)
    assert _task(tasks, "Design UI", "Phase")["start"] == datetime(2026, 1, 8)


def test_duplicate_does_not_move_the_dependant():
    """Removing the namesake leaves the schedule exactly as it was."""
    without = PLAN.replace("  Design 4d 2026-01-05\n", "")
    assert (
        _task(_schedule(PLAN), "Design UI", "Phase")["start"]
        == _task(_schedule(without), "Design UI", "Phase")["start"]
    )


def test_dependant_after_both_definitions_still_means_the_first():
    tasks = _schedule(PLAN)
    assert _task(tasks, "Build", "Other")["start"] == datetime(2026, 1, 8)


def test_critical_path_credits_the_successors_to_the_first_definition():
    tasks = _schedule(PLAN)
    first_design = _task(tasks, "Design", "Phase")
    second_design = _task(tasks, "Design", "Other")

    assert first_design["critical"] is True
    # Nothing depends on the second Design, so it has float (4d against
    # the 5d chain Design -> Design UI / Build).
    assert second_design["total_float"] > 0


def test_ms_project_link_points_at_the_first_definition():
    with tempfile.NamedTemporaryFile(suffix=".xml", delete=False) as f:
        path = f.name
    try:
        export_to_msproject_xml(PLAN, path, project_name="P")
        tasks = ET.parse(path).getroot().findall(f".//{{{NS}}}Task")
        design_uids = [
            t.find(f"{{{NS}}}UID").text for t in tasks
            if t.find(f"{{{NS}}}Name").text == "Design"
        ]
        for dependant in ("Design UI", "Build"):
            task = next(t for t in tasks if t.find(f"{{{NS}}}Name").text == dependant)
            links = task.findall(f"{{{NS}}}PredecessorLink")
            assert [l.find(f"{{{NS}}}PredecessorUID").text for l in links] == [design_uids[0]]
    finally:
        os.unlink(path)
