"""Phase view: every top-level summary task is a column, its subtasks are the cards.

A phase is whatever sits at the top of the outline with subtasks under it. It
does not matter what is on its line (dates, resources, dependencies, a $product
token, 100% complete) or how far the outline is indented.
"""

import pytest

from tests.ui.helpers import open_project_view, set_editor_value

# Shaped like a real compliance plan: indented top-level stages carrying
# metadata, `*` sequential subtasks, a finished stage, a nested summary and a
# loose top-level task.
PLAN = """\
---
title: Compliance
start: 2026-01-05
resources:
- @kev: Kevin
- @agne: Agne
---

  Proposal Stage $proposal @kev 100%
    *Collect information $info @kev 100%
    *Write proposal $write 2d @kev 100%
  Definition Stage $definition [depends $proposal] @kev 50%
    *Produce Plan $plan @kev 100%
    Kick Off Meeting $kickoff 1d @kev 100%
    Gap analysis $gap 3d @agne 0%
      review session 1 1d 0%
      review session 2 1d 0%
  Phase 1 - UK assessment $phase1 @agne 0%
    Confirm approach 5d @kev 0%
    Interview workshop 1d @kev 0%
  Stand-alone task 1d 0%
"""

EXPECTED = {
    "Proposal Stage": ["Collect information", "Write proposal"],
    "Definition Stage": ["Produce Plan", "Kick Off Meeting", "Gap analysis"],
    "Phase 1 - UK assessment": ["Confirm approach", "Interview workshop"],
    "Unassigned": ["Stand-alone task"],
}


def board_layout(page):
    return page.evaluate(
        """() => Object.fromEntries([...document.querySelectorAll('.kanban-column')].map(col => [
            col.querySelector('.kanban-column-title').textContent.trim(),
            [...col.querySelectorAll('.kanban-card')].map(c => c.dataset.taskName)]))"""
    )


def load(page, app_server, plan):
    page.set_viewport_size({"width": 1900, "height": 900})
    open_project_view(page, app_server)
    set_editor_value(page, plan)
    page.evaluate("() => switchPlanSubnavToBoard()")
    page.wait_for_selector(".kanban-card")
    return page


def test_top_level_summaries_are_columns_with_subtasks_as_cards(page, app_server):
    load(page, app_server, PLAN)
    assert board_layout(page) == EXPECTED
    assert page.evaluate("() => 1 + 1") == 2


def test_finished_phase_and_finished_cards_are_shown(page, app_server):
    load(page, app_server, PLAN)
    layout = board_layout(page)
    assert "Proposal Stage" in layout, "a 100% phase must still be a column"
    assert "Collect information" in layout["Proposal Stage"]


def test_nested_summary_is_a_card_not_a_column(page, app_server):
    load(page, app_server, PLAN)
    layout = board_layout(page)
    assert "Gap analysis" in layout["Definition Stage"]
    assert "Gap analysis" not in layout
    assert "review session 1" not in sum(layout.values(), [])


def test_columns_follow_plan_order(page, app_server):
    load(page, app_server, PLAN)
    titles = page.evaluate(
        "() => [...document.querySelectorAll('.kanban-column-title')].map(e => e.textContent.trim())"
    )
    assert titles == ["Proposal Stage", "Definition Stage", "Phase 1 - UK assessment", "Unassigned"]


@pytest.mark.parametrize("indent", ["", "  ", "    "])
def test_indentation_of_the_top_level_does_not_matter(page, app_server, indent):
    plan = "\n".join(
        (indent + line if line and not line.startswith(("-", "title", "start", "resources", " "))
         else line)
        for line in PLAN.splitlines()
    )
    # Re-indent only the outline lines, keeping front matter untouched.
    head, body = PLAN.split("---\n\n", 1)
    outline = "\n".join(indent + line.lstrip(" ") if not line.startswith("    ") else indent + line
                        for line in body.splitlines())
    load(page, app_server, head + "---\n\n" + outline + "\n")
    assert list(board_layout(page)) == list(EXPECTED)


def test_plain_unindented_headers_still_work(page, app_server):
    load(page, app_server, "Phase One\n  Task A 0%\n  Task C 0%\nPhase Two\n  Task B 0%\nEmpty Phase\n")
    assert board_layout(page) == {
        "Phase One": ["Task A", "Task C"],
        "Phase Two": ["Task B"],
        "Empty Phase": [],
    }


def test_drag_card_between_metadata_phases(page, app_server):
    load(page, app_server, PLAN)
    page.locator('.kanban-card[data-task-name="Interview workshop"]').drag_to(
        page.locator('.kanban-column-body[data-column-title="Definition Stage"]')
    )
    page.wait_for_function(
        "() => [...document.querySelectorAll('.kanban-column')]"
        ".find(c => c.querySelector('.kanban-column-title').textContent.trim() === 'Definition Stage')"
        ".querySelectorAll('.kanban-card').length === 4"
    )
    layout = board_layout(page)
    assert "Interview workshop" in layout["Definition Stage"]
    assert layout["Phase 1 - UK assessment"] == ["Confirm approach"]
    assert page.evaluate("() => 1 + 1") == 2


def test_drilling_into_a_summary_card_shows_its_subtasks(page, app_server):
    load(page, app_server, PLAN)
    page.locator('.kanban-card[data-task-name="Gap analysis"]').focus()
    page.keyboard.press("Shift+Enter")
    page.wait_for_function(
        "() => [...document.querySelectorAll('.kanban-card')].some(c => c.dataset.taskName === 'review session 1')"
    )
