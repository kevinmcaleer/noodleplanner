"""Configurable dashboard widgets (#779): hide, reorder and resize from the
Customise panel, persisted in the plan's `dashboard:` front matter."""

import pytest

from .helpers import load_plan, open_app

pytestmark = pytest.mark.ui

PLAN = """---
title: Widgets
start: 2026-01-05
---

Design
  Research 5d
  Sign-off 0d
"""

IDS = "() => [...document.querySelectorAll('#dashboardWidgets > [data-widget-id]')].map(e => e.dataset.widgetId)"
VISIBLE = """() => [...document.querySelectorAll('#dashboardWidgets > [data-widget-id]')]
    .filter(e => getComputedStyle(e).display !== 'none').map(e => e.dataset.widgetId)"""


def _open(page, app_server, plan=PLAN):
    open_app(page, app_server)
    load_plan(page, plan)
    page.evaluate("() => switchToView('project-report')")
    page.wait_for_function("() => !NavigationController.isTransitioning()")
    page.wait_for_selector("#dashboardWidgets", state="visible")


def _editor(page):
    # The textarea's visible text hides the front matter; `.value` is the whole plan.
    return page.evaluate("() => document.getElementById('planEditor').value")


def test_default_dashboard_has_every_widget_in_order(page, app_server):
    _open(page, app_server)
    assert page.evaluate(IDS) == [
        "timeline", "task_completion", "milestones", "up_next",
        "highlights", "risks", "budget", "actions",
    ]
    assert "dashboard:" not in _editor(page)


def test_hide_and_reorder_persist_to_front_matter(page, app_server):
    _open(page, app_server)
    page.click("#dashboardCustomizeBtn")
    page.uncheck('[data-widget-id="risks"] [data-act="toggle"]')
    page.click('[data-widget-id="actions"] [data-act="up"]')
    assert "risks" not in page.evaluate(VISIBLE)
    ids = page.evaluate(IDS)
    assert ids.index("actions") < ids.index("budget")
    text = _editor(page)
    assert "dashboard:\n  - {id: timeline, size: wide}" in text
    assert "- {id: risks, size: half, hidden: true}" in text


def test_layout_survives_a_reload_of_the_plan(page, app_server):
    _open(page, app_server)
    page.click("#dashboardCustomizeBtn")
    page.click('[data-widget-id="actions"] [data-act="up"]')
    saved = _editor(page)
    ids = page.evaluate(IDS)
    load_plan(page, saved)
    assert page.evaluate(IDS) == ids
    assert _editor(page) == saved


def test_reordering_works_from_the_keyboard(page, app_server):
    _open(page, app_server)
    page.click("#dashboardCustomizeBtn")
    page.focus('[data-widget-id="up_next"] [data-act="up"]')
    page.keyboard.press("Enter")
    ids = page.evaluate(IDS)
    assert ids.index("up_next") < ids.index("milestones")
    # focus stays on a move button so the keyboard user can keep going
    assert page.evaluate("() => document.activeElement.dataset.act") in ("up", "down")


def test_unknown_widget_ids_are_ignored(page, app_server):
    plan = PLAN.replace("start: 2026-01-05\n", "start: 2026-01-05\ndashboard:\n  - {id: from_the_future, size: half}\n  - {id: actions, size: full}\n")
    _open(page, app_server, plan)
    assert page.evaluate(IDS)[0] == "actions"
    assert "from_the_future" in _editor(page)


def test_reset_restores_the_default(page, app_server):
    _open(page, app_server)
    page.click("#dashboardCustomizeBtn")
    page.click('[data-widget-id="actions"] [data-act="up"]')
    page.evaluate("() => document.getElementById('dashboardResetBtn').click()")
    assert "dashboard:" not in _editor(page)
    assert page.evaluate(IDS)[-1] == "actions"
