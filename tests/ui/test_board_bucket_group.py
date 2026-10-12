"""Board > Bucket grouping, its ribbon button, and the quick-complete checkbox."""

import pytest

from tests.ui.helpers import open_project_view, set_editor_value

PLAN = """\
---
title: Buckets
start: 2026-01-05
buckets: [Design, Build]
resources:
- @kev: Kevin McAleer
---
Phase One
  Sub A
    Task A 2d 0% @kev {Design}
    Task B 1d 0% {Design}
  Task C 3d 0% {Build}
Phase Two
  Sub B
    Task D 1d 0% @kev
    Task E 2d 0% {Build}
  Task F 1d 0%
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
            [...col.querySelectorAll('.kanban-card')].map(e => e.dataset.taskName).sort(),
        ]))"""
    )


def test_bucket_columns_hold_every_task_however_deep(board):
    board.evaluate("() => switchKanbanView('bucket')")
    assert columns(board) == {
        "Design": ["Task A", "Task B"],
        "Build": ["Task C", "Task E"],
        "No Bucket": ["Task D", "Task F"],
    }


def test_bucket_button_in_the_view_group_shows_state(board):
    board.locator('.ribbon-tab-btn[data-tab="__ctx"]').click()
    board.wait_for_selector('.ribbon-shell [data-label="Bucket"]')
    board.locator('.ribbon-shell [data-label="Bucket"]').click()
    board.wait_for_selector('.kanban-column-title:text("No Bucket")')
    pressed = board.evaluate(
        """() => [...document.querySelectorAll('.ribbon-shell [data-label]')]
            .filter(el => ['Phase', 'Resource', 'Progress', 'Label', 'Bucket'].includes(el.dataset.label)
                && (el.classList.contains('active') || el.getAttribute('aria-pressed') === 'true'))
            .map(el => el.dataset.label)"""
    )
    assert pressed == ["Bucket"]


def test_completion_checkbox_updates_the_card_in_phase_view(board):
    card = board.locator('.kanban-card[data-task-name="Task C"]')
    card.locator('.round-checkbox').click()
    board.wait_for_function(
        "() => /Task C 3d \\{Build\\} 100%/.test(document.getElementById('planEditor').value)")
    card = board.locator('.kanban-card[data-task-name="Task C"]')
    assert card.locator('.round-checkbox').is_checked()
