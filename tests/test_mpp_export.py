"""Native .mpp export (noodle_core.mpp_writer), its round trip through
NoodlePlanner's own .mpp importer, and the /render endpoint that serves it.

pymppwriter is a real dependency of noodle-web (noodle-core[mpp]), so these
tests import it rather than skipping: a missing dependency means the deployed
export is broken and should fail loudly here.  Only the tests that need a
Microsoft Project template are skipped when one is absent — the template is
per-deployment and cannot be committed.
"""

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from noodle_web.app import app

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


@pytest.fixture
def client():
    # the rate-limit store is process-global, so a full-suite run arrives here
    # with the budget already spent and every request would come back 429
    from noodle_web.security import reset_rate_limit_store

    reset_rate_limit_store()
    return TestClient(app)


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


@needs_template
def test_render_endpoint_serves_native_mpp(client, monkeypatch):
    monkeypatch.setenv("NOODLE_MPP_TEMPLATE", TEMPLATE)
    response = client.post("/render", json={"plan_text": PLAN, "export_mpp": True})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/vnd.ms-project")
    assert ".mpp" in response.headers.get("content-disposition", "")
    assert response.content[:8] == OLE_MAGIC


def test_render_endpoint_reports_a_missing_template(client, monkeypatch, tmp_path):
    """An unconfigured server says so, instead of failing as a generic 500."""
    monkeypatch.setenv("NOODLE_MPP_TEMPLATE", str(tmp_path / "absent.mpp"))
    response = client.post("/render", json={"plan_text": PLAN, "export_mpp": True})
    assert response.status_code == 503
    assert "not configured" in response.json()["detail"]


def test_model_endpoint_returns_the_scheduled_plan(client):
    """The browser exporter builds from this, so it must carry the whole plan."""
    response = client.post("/api/mpp/model", json={"plan_text": PLAN, "project_name": "Browser"})
    assert response.status_code == 200
    model = response.json()
    assert model["title"] == "Browser"
    names = [t["name"] for t in model["tasks"]]
    for name in ("Proposal", "Approval", "Build", "Review", "Ship"):
        assert name in names, f"{name} missing from {names}"
    assert {r["name"] for r in model["resources"]} >= {"kevin", "adam"}
    assert len(model["assignments"]) >= 3
    assert model["relations"], "the plan's dependencies should carry across"
    # dates are wall-clock ISO strings the browser can parse without a zone
    assert all("T" in t["start"] and not t["start"].endswith("Z") for t in model["tasks"])


def test_model_endpoint_needs_no_template(client, monkeypatch, tmp_path):
    """It schedules only — no pymppwriter and no template involved."""
    monkeypatch.setenv("NOODLE_MPP_TEMPLATE", str(tmp_path / "absent.mpp"))
    response = client.post("/api/mpp/model", json={"plan_text": PLAN})
    assert response.status_code == 200
    assert response.json()["tasks"]
