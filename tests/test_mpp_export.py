"""Native .mpp export in noodle_core.mpp_writer and its round trip through
NoodlePlanner's own .mpp importer.

These are the library paths (CLI and other Python consumers). The web app
builds and reads .mpp files in the browser with mppwriter (issue #770), so
there is no /render or /api endpoint for .mpp any more; that path is covered
by tests/test_mpp_browser_export.mjs, which also checks the JavaScript model
against build_project_model so the two cannot drift.

pymppwriter is a real dependency of noodle-core[mpp], so these tests import it
rather than skipping: a missing dependency should fail loudly here.  Only the
tests that need a Microsoft Project template are skipped when one is absent —
the template is per-deployment and cannot be committed.
"""

import os
from pathlib import Path

import pytest

TEMPLATE = os.environ.get(
    "NOODLE_MPP_TEMPLATE",
    str(Path(__file__).resolve().parent.parent / "templates" / "mpp-template.mpp"),
)
needs_template = pytest.mark.skipif(
    not os.path.exists(TEMPLATE), reason="needs an .mpp template (NOODLE_MPP_TEMPLATE)"
)

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
