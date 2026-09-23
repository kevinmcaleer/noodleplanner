"""End-to-end cover for the Tasks by Assignment and Slippage views (#776).

The report arithmetic is unit-tested in tests/test_plan_reports.mjs and the
file exports in tests/test_report_exports.py; this pins the views in the page:
reached from the ribbon, rendering the groups and comparisons, filtering, the
no-baseline message, and an export that downloads a file.

Usage:
    uv run pytest tests/ui/test_reports.py -q
"""

import pytest

from .helpers import load_plan, open_project_view

PLAN = """---
title: Reports UI
Resources:
- @alex: Alex Chen, Developer
- @sam: Sam Lee, Designer
---

Design
  Wireframes @sam 3d 2026-03-02 100%
  Review @alex @sam 1d [depends Wireframes]
Build
  API @alex 8d [depends Review]
  Docs 2d [depends Review]
  Launch 0d [depends API, Docs]

---baseline---
| Task Name | Start | Finish | Duration |
|-----------|-------|--------|----------|
| Design | 2026-03-02 | 2026-03-06 | 4d |
| Wireframes | 2026-03-02 | 2026-03-05 | 3d |
| Review | 2026-03-05 | 2026-03-06 | 1d |
| Build | 2026-03-06 | 2026-03-13 | 5d |
| API | 2026-03-06 | 2026-03-13 | 5d |
| Docs | 2026-03-06 | 2026-03-10 | 2d |
| Launch | 2026-03-13 | 2026-03-13 | 0d |
| Retired task | 2026-03-02 | 2026-03-03 | 1d |
"""


@pytest.fixture
def reports(page, app_server):
    open_project_view(page, app_server)
    load_plan(page, PLAN)
    return page


def test_ribbon_opens_both_reports(reports):
    page = reports
    assert page.evaluate("PLAN_VIEWS.includes('assignments') && PLAN_VIEWS.includes('slippage')")
    page.evaluate("switchToView('assignments')")
    page.wait_for_selector("#assignments-view.active #assignmentsGroups .assignment-group")
    page.evaluate("switchToView('slippage')")
    page.wait_for_selector("#slippage-view.active #slippageReport .slippage-summary")


def test_assignments_groups_people_and_puts_unassigned_first(reports):
    page = reports
    page.evaluate("switchToView('assignments')")
    page.wait_for_selector("#assignmentsGroups .assignment-group")
    names = page.eval_on_selector_all(
        "#assignmentsGroups .assignment-group-name", "els => els.map(e => e.textContent)"
    )
    assert names == ["Unassigned", "Alex Chen", "Sam Lee"]
    assert page.locator(".assignment-group--unassigned").count() == 1
    alex = page.locator('#assignmentsGroups .assignment-group[data-person="alex chen"]')
    assert "Developer" in alex.locator(".assignment-group-role").text_content()
    review = alex.locator("tr", has_text="Review")
    assert "shared" in review.text_content() and "Sam Lee" in review.text_content()


def test_assignment_filters(reports):
    page = reports
    page.evaluate("switchToView('assignments')")
    page.wait_for_selector("#assignmentsGroups .assignment-group")
    page.select_option("#assignmentsStatus", "complete")
    names = page.eval_on_selector_all("#assignmentsGroups .assignment-group-name", "els => els.map(e => e.textContent)")
    assert names == ["Sam Lee"]
    page.select_option("#assignmentsStatus", "")
    page.select_option("#assignmentsPhase", "Build")
    tasks = page.eval_on_selector_all("#assignmentsGroups tbody tr td:first-child",
                                      "els => els.map(e => e.firstChild.textContent)")
    assert sorted(tasks) == ["API", "Docs", "Launch"]


def test_slippage_compares_with_the_baseline(reports):
    page = reports
    page.evaluate("switchToView('slippage')")
    page.wait_for_selector("#slippageReport .slippage-summary")
    assert page.is_hidden("#slippageEmpty")
    headline = page.text_content("#slippageReport .slippage-headline-value")
    assert headline == "+3d"
    critical = page.locator("#slippageReport .slippage-section--critical")
    assert "API" in critical.text_content()
    first_task = page.text_content("#slippageReport .slippage-section--tasks tbody tr:first-child td:first-child")
    assert first_task.startswith("API")
    scope = page.text_content("#slippageReport .slippage-section--scope")
    assert "Retired task" in scope and "Removed" in scope


def test_slippage_without_a_baseline_explains_itself(page, app_server):
    open_project_view(page, app_server)
    load_plan(page, PLAN.split("\n---baseline---")[0] + "\n")
    page.evaluate("switchToView('slippage')")
    page.wait_for_selector("#slippageEmpty", state="visible")
    assert "No baseline yet" in page.text_content("#slippageEmpty")
    assert page.locator("#slippageReport > *").count() == 0


def test_export_downloads_a_file(reports):
    page = reports
    page.evaluate("switchToView('slippage')")
    page.wait_for_selector("#slippageReport .slippage-summary")
    with page.expect_download() as info:
        page.click("#slippage-view .report-export-btn:has-text('Excel')")
    assert info.value.suggested_filename.endswith("_slippage.xlsx")
    page.evaluate("switchToView('assignments')")
    page.wait_for_selector("#assignmentsGroups .assignment-group")
    with page.expect_download() as info:
        page.click("#assignments-view .report-export-btn:has-text('PowerPoint')")
    assert info.value.suggested_filename.endswith("_tasks_by_assignment.pptx")
