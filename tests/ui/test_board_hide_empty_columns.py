"""Board > Columns > Hide Empty: with a filter applied, columns with no
matching cards are hidden; without a filter nothing is hidden."""

import pytest

from tests.ui.helpers import open_project_view, set_editor_value

PLAN = """\
---
title: Hide empty
start: 2026-01-05
---
Alpha
  Task A 3d 0%
Beta
  Task B 2d 0%
Gamma
  Task C 1d 0%
"""


@pytest.fixture
def board(page, app_server):
    page.set_viewport_size({"width": 1900, "height": 900})
    open_project_view(page, app_server)
    set_editor_value(page, PLAN)
    page.evaluate("() => switchPlanSubnavToBoard()")
    page.wait_for_selector(".kanban-card")
    return page


def titles(page):
    return page.evaluate(
        "() => [...document.querySelectorAll('.kanban-column-title')].map(e => e.textContent.trim())"
    )


def test_hide_empty_only_applies_while_filtered(board):
    board.locator('.ribbon-tab-btn[data-tab="__ctx"]').click()
    btn = board.locator('.ribbon-shell [data-label="Hide Empty"]')
    btn.wait_for()
    assert titles(board) == ["Alpha", "Beta", "Gamma"]

    btn.click()
    assert board.evaluate("() => kanbanBoard.hideEmptyColumns") is True
    assert titles(board) == ["Alpha", "Beta", "Gamma"]  # no filter: nothing hidden

    board.evaluate("() => { kanbanBoard.setFilterQuery('Task B'); kanbanBoard.render(); }")
    assert titles(board) == ["Beta"]
    assert board.locator('.ribbon-shell [data-label="Hide Empty"]').get_attribute("aria-pressed") == "true"

    board.locator('.ribbon-shell [data-label="Hide Empty"]').click()
    assert titles(board) == ["Alpha", "Beta", "Gamma"]
