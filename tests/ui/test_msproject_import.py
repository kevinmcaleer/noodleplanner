"""Import > MS Project makes a saved project.

The import used to merge the file into whatever was open (or into nothing)
and never save, so the imported plan was missing from the project switcher
and lost on reload. Like the Excel and plan-file importers, it now creates a
project named after the file and saves it straight away.
"""

from pathlib import Path

import pytest

from .helpers import load_plan, open_app

TEMPLATE = (
    Path(__file__).resolve().parents[2]
    / "packages" / "noodle-web" / "src" / "noodle_web" / "static" / "mpp-template.mpp"
)

MPP_PLAN = """Phase 1
  Proposal 1d 100%
  Build 5d
Phase 2
  Ship 1d
"""

OPEN_PLAN = """---
title: Already open
---

Existing task 1d
"""


@pytest.fixture
def schedule_mpp(tmp_path):
    from noodle_core.mpp_writer import export_to_mpp

    out = tmp_path / "Imported Schedule.mpp"
    export_to_mpp(MPP_PLAN, str(out), str(TEMPLATE), project_name="Imported Schedule")
    return out


def _switcher_names(pg):
    return pg.evaluate(
        "() => [...document.querySelectorAll('.project-selector-dropdown option')].map(o => o.textContent)"
    )


def _import(pg, path):
    with pg.expect_file_chooser() as chooser:
        pg.evaluate("() => triggerMSProjectUpload()")
    chooser.value.set_files(str(path))
    pg.wait_for_function(
        "() => (getCurrentProject() || {}).name === 'Imported Schedule'"
        "  && (getCurrentProject().planText || '').includes('Build')"
    )


def test_import_creates_a_saved_project_in_the_switcher(page, app_server, schedule_mpp):
    open_app(page, app_server)
    load_plan(page, OPEN_PLAN, with_project="Already open")
    page.evaluate("() => saveCurrentProjectState()")

    _import(page, schedule_mpp)

    stored = page.evaluate("() => getCurrentProject().planText")
    assert "Proposal" in stored and "msproject_file: Imported Schedule.mpp" in stored
    assert "Existing task" not in stored
    names = page.evaluate("() => listProjects().map(p => p.name)")
    assert "Imported Schedule" in names and "Already open" in names
    assert "Imported Schedule" in _switcher_names(page)

    # The project it replaced in the editor is untouched.
    previous = page.evaluate(
        "() => listProjects().find(p => p.name === 'Already open').planText"
    )
    assert "Existing task" in previous and "Proposal" not in previous

    page.reload(wait_until="domcontentloaded")
    page.wait_for_selector(".ribbon-scope-btn", state="attached")
    assert "Imported Schedule" in page.evaluate("() => listProjects().map(p => p.name)")


def test_import_with_no_project_open_still_saves(page, app_server, schedule_mpp):
    open_app(page, app_server)
    page.evaluate("() => setCurrentProjectId(null)")

    _import(page, schedule_mpp)

    assert "Imported Schedule" in page.evaluate("() => listProjects().map(p => p.name)")
