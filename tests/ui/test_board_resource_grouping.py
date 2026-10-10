"""Board > Resource grouping and the Board Tools > View ribbon toggle.

Resources used on tasks form columns even when the front matter never declares
them, and ``@Kev`` / ``@kev`` are one column. Choosing a view from Group by
moves the highlighted button in the Board Tools > View group.
"""

import pytest

from tests.ui.helpers import open_project_view, set_editor_value

PLAN = """\
---
title: Undeclared
start: 2026-01-05
resources:
- @kev: Kevin McAleer
stakeholders:
- @kev: Kevin McAleer, sponsor
---
Phase One
  Task A 3d 0% @Kev
  Task B 2d 0% @kev
  Task C 1d 0% @Sam
  Task D 1d 0%
"""


@pytest.fixture
def board(page, app_server):
    page.set_viewport_size({"width": 1900, "height": 900})
    open_project_view(page, app_server)
    set_editor_value(page, PLAN)
    page.evaluate("() => switchPlanSubnavToBoard()")
    page.wait_for_selector(".kanban-card")
    return page


def columns(page):
    return page.evaluate(
        """() => Object.fromEntries([...document.querySelectorAll('.kanban-column')].map(col => [
            col.querySelector('.kanban-column-title').textContent.trim(),
            [...col.querySelectorAll('.kanban-card')].map(e => e.dataset.taskName),
        ]))"""
    )


def test_undeclared_resources_form_columns_case_insensitively(board):
    board.evaluate("() => switchKanbanView('resource')")
    cols = columns(board)
    assert sorted(cols["Kevin McAleer"]) == ["Task A", "Task B"]
    assert cols["Sam"] == ["Task C"]
    assert cols["Unassigned"] == ["Task D"]
    assert len(cols) == 3


def active_view_buttons(page):
    return page.evaluate(
        """() => [...document.querySelectorAll('.ribbon-shell [data-label]')]
            .filter(el => ['Phase', 'Resource', 'Progress', 'Label'].includes(el.dataset.label)
                && (el.classList.contains('active') || el.getAttribute('aria-pressed') === 'true'))
            .map(el => el.dataset.label)"""
    )


def test_group_by_menu_moves_the_view_toggle(board):
    board.locator('.ribbon-tab-btn[data-tab="__ctx"]').click()
    board.wait_for_selector('.ribbon-shell [data-label="Progress"]')
    assert active_view_buttons(board) == ["Phase"]
    board.evaluate("() => { ribbonActionAnchor = null; KANBAN_GROUP_MODES.find(m => m.label === 'Progress').run(); }")
    board.wait_for_timeout(800)
    assert active_view_buttons(board) == ["Progress"]

