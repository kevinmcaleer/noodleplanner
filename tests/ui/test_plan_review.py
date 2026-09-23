"""End-to-end cover for the Analysis view's plan review (#782).

The checks are unit-tested in tests/test_plan_quality.py; this pins the page:
the review is fetched when the Analysis view is shown, findings are grouped by
severity and filterable, each links to its line, and a one-click fix edits the
plan in a single undoable step.

Usage:
    uv run pytest tests/ui/test_plan_review.py -q
"""

import pytest

from .helpers import load_plan, open_project_view, plan_text

PLAN = """---
title: Review UI
Resources:
- @alex: Alex Chen, Developer
---

Phase
  Design @alex 2d 2026-03-02
  Build @alex 3d [depends Desing]
  Test @bob 2d [depends Build]
"""


@pytest.fixture
def analysis(page, app_server):
    open_project_view(page, app_server)
    load_plan(page, PLAN)
    page.evaluate("switchToView('analysis')")
    page.wait_for_selector("#planReview .plan-review-item")
    return page


def test_findings_are_grouped_by_severity_with_fix_guidance(analysis):
    page = analysis
    groups = page.eval_on_selector_all(
        "#planReview .plan-review-group", "els => els.map(e => e.className.split('--')[1])"
    )
    assert groups[0] == "error"
    assert groups == sorted(groups, key=["error", "warning", "suggestion"].index)
    dangling = page.locator('#planReview .plan-review-item[data-check="dangling-dependency"]')
    assert "Did you mean 'Design'?" in dangling.text_content()
    assert "How to fix" in dangling.text_content()
    href = dangling.locator(".plan-review-docs").get_attribute("href")
    assert href.endswith("plan-quality-checks.html#dangling-dependency")
    score = page.text_content("#planReview .plan-review-score-value")
    assert score.isdigit() and int(score) < 100


def test_severity_chips_and_search_filter_the_list(analysis):
    page = analysis
    page.click('#planReview .plan-review-chip[data-severity="error"]')
    severities = page.eval_on_selector_all("#planReview .plan-review-item", "els => els.map(e => e.className)")
    assert severities and all("plan-review-item--error" in s for s in severities)
    assert page.get_attribute('#planReview .plan-review-chip[data-severity="error"]', "aria-pressed") == "true"

    page.click('#planReview .plan-review-chip[data-severity="all"]')
    page.fill("#planReview .plan-review-search", "@bob")
    items = page.eval_on_selector_all("#planReview .plan-review-item", "els => els.map(e => e.dataset.check)")
    assert items == ["undeclared-resource"]
    assert "Showing 1 of" in page.text_content("#planReview .plan-review-status")


def test_a_finding_links_to_its_line(analysis):
    page = analysis
    page.click('#planReview .plan-review-item[data-check="dangling-dependency"] .plan-review-line')
    line = page.evaluate(
        """() => { const e = document.getElementById('planEditor');
                   return e.value.slice(0, e.selectionStart).split('\\n').length; }"""
    )
    assert plan_text(page).split("\n")[line - 1] == "  Build @alex 3d [depends Desing]"


def test_apply_fix_edits_the_plan_and_one_undo_reverts_it(analysis):
    page = analysis
    before = plan_text(page)
    page.click('#planReview .plan-review-item[data-check="undeclared-resource"] .plan-review-apply')
    page.wait_for_function(
        "() => document.getElementById('planEditor').value.includes('- @bob: Bob')"
    )
    # the review re-runs on the fixed plan and the finding is gone
    page.wait_for_function(
        "() => !document.querySelector('#planReview .plan-review-item[data-check=\"undeclared-resource\"]')"
    )
    page.evaluate("EditorUndoManager.undo()")
    page.wait_for_function(
        "before => document.getElementById('planEditor').value === before", arg=before
    )


def test_the_old_duplicate_health_score_is_gone(analysis):
    page = analysis
    assert page.locator(".analysis-health-score").count() == 0
    assert page.locator("#planReview .plan-review-score").count() == 1
