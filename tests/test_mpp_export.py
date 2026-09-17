"""Native .mpp export in noodle_core.mpp_writer and its round trip through
NoodlePlanner's own .mpp importer.

These are the library paths (CLI and other Python consumers). The web app
builds and reads .mpp files in the browser with mppwriter (issue #770), so
there is no /render or /api endpoint for .mpp any more; that path is covered
by tests/test_mpp_browser_export.mjs, which also checks the JavaScript model
against build_project_model so the two cannot drift.

pymppwriter is a real dependency of noodle-core[mpp], so these tests import it
rather than skipping: a missing dependency should fail loudly here.  The
Microsoft Project template the writer needs ships with the app
(static/mpp-template.mpp, the blank project the browser export uses too);
NOODLE_MPP_TEMPLATE points the tests at a different one.
"""

import os
from pathlib import Path

import pytest

BUNDLED_TEMPLATE = (
    Path(__file__).resolve().parent.parent
    / "packages" / "noodle-web" / "src" / "noodle_web" / "static" / "mpp-template.mpp"
)
TEMPLATE = os.environ.get("NOODLE_MPP_TEMPLATE", str(BUNDLED_TEMPLATE))
needs_template = pytest.mark.skipif(
    not os.path.exists(TEMPLATE), reason="needs an .mpp template (NOODLE_MPP_TEMPLATE)"
)


def test_bundled_template_is_present_and_blank():
    """The app ships its own template: a blank project with the three recipe
    tasks, no resources, and no author metadata from whoever saved it."""
    assert BUNDLED_TEMPLATE.exists(), "static/mpp-template.mpp must be committed"
    data = BUNDLED_TEMPLATE.read_bytes()
    assert data[:8] == OLE_MAGIC
    for encoding in ("utf-8", "utf-16-le"):
        assert "Kevin".encode(encoding) not in data
        assert "McAleer".encode(encoding) not in data

PLAN = """Phase 1
  Proposal 1d 100% @kevin 2026-07-01
  *Approval 0d @kevin
  Build 5d @adam, @kevin 50%
Phase 2
  Review 2d @kevin
  Ship 1d
"""

OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"


def _export(tmp_path):
    from noodle_core.mpp_writer import export_to_mpp

    out = tmp_path / "plan.mpp"
    export_to_mpp(PLAN, str(out), TEMPLATE, project_name="Roundtrip")
    return out


@needs_template
def test_export_produces_native_mpp(tmp_path):
    import olefile

    out = _export(tmp_path)
    assert out.read_bytes()[:8] == OLE_MAGIC
    ole = olefile.OleFileIO(str(out))
    assert ole.exists("   114/TBkndTask/FixedData")


@needs_template
def test_roundtrip_through_own_importer(tmp_path):
    from noodle_core.msproject import import_from_mpp

    out = _export(tmp_path)
    markdown = import_from_mpp(out.read_bytes())
    # every named task survives the export -> native import cycle
    for name in ("Proposal", "Approval", "Build", "Review", "Ship"):
        assert name in markdown, f"{name!r} missing from re-imported plan:\n{markdown}"
    assert "Phase 1" in markdown and "Phase 2" in markdown


@needs_template
def test_roundtrip_keeps_durations_resources_and_progress(tmp_path):
    """Names alone are not a round trip: this caught a reader reading every row
    as a summary, with no durations and unnamed resources."""
    from noodle_core.msproject import import_from_mpp

    markdown = import_from_mpp(_export(tmp_path).read_bytes())
    lines = {
        line.strip().split(" ")[0].lstrip("*"): line.strip()
        for line in markdown.splitlines()
        if line.startswith("  ")
    }
    assert "1d" in lines["Proposal"] and "100%" in lines["Proposal"]
    assert "5d" in lines["Build"] and "50%" in lines["Build"]
    assert "2d" in lines["Review"]
    # resources carry across, declared in the front matter and used per task
    assert "@kevin" in lines["Proposal"] and "@adam" in lines["Build"]
    assert "- @kevin:" in markdown and "- @adam:" in markdown
    # the hidden project-summary row is not re-imported as a task
    assert "\nRoundtrip" not in markdown


def test_missing_template_raises_clear_error(tmp_path):
    from noodle_core.mpp_writer import MppTemplateError, export_to_mpp

    with pytest.raises(MppTemplateError, match="template"):
        export_to_mpp(PLAN, str(tmp_path / "x.mpp"), str(tmp_path / "nope.mpp"))


def test_model_carries_dependency_type_and_lag():
    """Lag/lead used to be written as 0 on every relation (issue #770)."""
    from noodle_core.mpp_writer import build_project_model

    model = build_project_model(
        "Phase 1\n  Design 3d\n  Build 5d [depends Design +2d]\n  Test 2d [depends Build:SS -1w]\n",
        "Lag",
    )
    uid = {t["name"]: t["uid"] for t in model["tasks"]}
    by_succ = {r["succUid"]: r for r in model["relations"]}
    assert by_succ[uid["Build"]] == {
        "predUid": uid["Design"], "succUid": uid["Build"], "type": "FS", "lagDays": 2.0,
    }
    # the scheduler counts a week as 7 (date_math.parse_duration_to_days)
    assert by_succ[uid["Test"]] == {
        "predUid": uid["Build"], "succUid": uid["Test"], "type": "SS", "lagDays": -7.0,
    }


def test_web_app_has_no_server_side_mpp_path():
    """Export and import of .mpp happen in the browser; the server keeps no
    endpoint, flag or template lookup for them."""
    import importlib

    from noodle_web.plan_service import PlanService

    web_module = importlib.import_module("noodle_web.app")
    routes = {r.path for r in web_module.app.routes}
    assert "/api/mpp/model" not in routes
    assert "export_mpp" not in web_module.RenderRequest.model_fields
    assert not hasattr(PlanService, "_export_mpp")


# --- assignment/date consistency (kevinmcaleer/Snakie#975) ------------------
#
# pymppwriter/mppwriter write an assignment's Work as a single aggregate
# value (assignment var entry 49) rather than a true timephased actual/
# remaining contour. Per the library's own docs/FORMAT_NOTES.md ("Progress
# on assigned tasks"), that is verified safe at 0% complete (no actual-work
# data is written at all) and at 100% (a separately tested, already-flagged
# ScheduleWarning: the task's dates hold, only the percentage reads back at
# 99% on reopen) -- but a task with an assignment and a percent strictly
# between 1 and 99 has only been checked against the library's own reader,
# never against Microsoft Project's real scheduler. Task 81 from the report
# ("Bradford optimisation 15d @Jack 53% 2026-08-24") is exactly that shape.

TASK_81_SHAPE = """Backbone Project
  Bradford
    Bradford optimisation 15d @Jack 53% 2026-08-24
"""


def test_assignment_date_risk_flags_partial_percent_with_resource():
    from noodle_core.mpp_writer import build_project_model

    model = build_project_model(TASK_81_SHAPE, project_name="Backbone Project")
    assert model["assignmentDateRisks"] == [
        {"name": "Bradford optimisation", "percent": 53},
    ]


def test_assignment_date_risk_excludes_zero_and_full_percent():
    from noodle_core.mpp_writer import build_project_model

    plan = """Phase 1
  Not started 5d @kevin 0%
  Finished 5d @kevin 100%
"""
    model = build_project_model(plan, project_name="Percent")
    assert model["assignmentDateRisks"] == []


def test_assignment_date_risk_excludes_unassigned_and_summary_and_milestone():
    from noodle_core.mpp_writer import build_project_model

    plan = """Phase 1
  Unassigned 5d 50%
  *Kickoff 0d @kevin
"""
    model = build_project_model(plan, project_name="Shapes")
    assert model["assignmentDateRisks"] == []
    # the phase (summary) itself rolls up a mid-range percent too, but it has
    # no assignment of its own and must not be flagged
    assert all(r["name"] != "Phase 1" for r in model["assignmentDateRisks"])


def test_assignment_date_risk_message_names_task_and_percent():
    from noodle_core.mpp_writer import assignment_date_risk_message

    message = assignment_date_risk_message({"name": "Bradford optimisation", "percent": 53})
    assert "Bradford optimisation" in message
    assert "53%" in message
    assert "outside" in message


@needs_template
def test_export_logs_assignment_date_risk_warning(tmp_path, caplog):
    from noodle_core.mpp_writer import export_to_mpp

    out = tmp_path / "risk.mpp"
    with caplog.at_level("WARNING", logger="noodle_core.mpp_writer"):
        export_to_mpp(TASK_81_SHAPE, str(out), TEMPLATE, project_name="Backbone Project")

    assert any(
        "Bradford optimisation" in record.message and "53%" in record.message
        for record in caplog.records
    )


# --- the 100%-complete breadcrumb (parity with the browser exporter) ---------
#
# Project reads a 100%-complete task with an assignment back as 99% on reopen,
# so the exporter appends a note recording what the percentage really was and
# the importer restores it. static/mpp-export.js did this from the start;
# build_project_model did not, and the two exporters are required to produce
# the same model for the same plan. tests/test_mpp_browser_export.mjs compares
# them field for field, but only when a .venv is present -- these run always.


def _notes_by_name(model):
    return {t["name"]: t["notes"] for t in model["tasks"]}


def test_full_complete_note_is_added_to_assigned_complete_leaf_tasks():
    from noodle_core.mpp_writer import FULL_COMPLETE_EXPORT_NOTE, build_project_model

    plan = """Phase 1
  Done 5d @kevin 100% "Signed off by the board"
"""
    notes = _notes_by_name(build_project_model(plan, project_name="Breadcrumb"))
    assert notes["Done"] == f"Signed off by the board\n{FULL_COMPLETE_EXPORT_NOTE}"


def test_full_complete_note_stands_alone_when_the_task_has_no_comment():
    from noodle_core.mpp_writer import FULL_COMPLETE_EXPORT_NOTE, build_project_model

    plan = """Phase 1
  Done 5d @kevin 100%
"""
    notes = _notes_by_name(build_project_model(plan, project_name="Breadcrumb"))
    assert notes["Done"] == FULL_COMPLETE_EXPORT_NOTE


def test_full_complete_note_is_withheld_from_shapes_that_do_not_hit_the_quirk():
    """Only a leaf, with real duration, at 100%, with an assignment."""
    from noodle_core.mpp_writer import FULL_COMPLETE_EXPORT_NOTE, build_project_model

    plan = """Phase 1
  Unassigned 5d 100%
  Partly done 5d @kevin 50%
  Not started 5d @kevin 0%
  *Kickoff 0d @kevin 100%
"""
    notes = _notes_by_name(build_project_model(plan, project_name="Breadcrumb"))
    for name in ["Phase 1", "Unassigned", "Partly done", "Not started", "Kickoff"]:
        assert FULL_COMPLETE_EXPORT_NOTE not in notes[name], name


def test_full_complete_note_matches_the_browser_exporter_byte_for_byte():
    """The one line that must never drift between the two exporters.

    A mismatch would not fail anything obvious -- each exporter would keep
    working alone, and only a file written by one and read by the other would
    quietly lose the 100%.
    """
    import re

    from noodle_core.mpp_writer import FULL_COMPLETE_EXPORT_NOTE

    js = (
        Path(__file__).resolve().parent.parent
        / "packages" / "noodle-web" / "src" / "noodle_web" / "static" / "mpp-export.js"
    ).read_text()
    found = re.search(r'const FULL_COMPLETE_EXPORT_NOTE = "([^"]*)"', js)
    assert found, "mpp-export.js no longer declares FULL_COMPLETE_EXPORT_NOTE"
    assert found.group(1) == FULL_COMPLETE_EXPORT_NOTE
