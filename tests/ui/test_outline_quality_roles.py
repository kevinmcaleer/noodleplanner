"""The Outline shows a task's name, not its `@name:P/R/A` quality roles.

`Definition Stage @Kevin:P @Agne:R` used to show as `Definition Stage :P :R`:
the tokenizer stripped `@Kevin` and left `:P` behind. Renaming such a task in
the Outline must keep every role assignment on its line.
"""

from .helpers import load_plan, open_app

PLAN = """---
title: Roles
---

Definition Stage $definition @Kevin:P @Agne:R @julian:A
  Produce Plan @Kevin 100% @agne:A @katie:R
  PDD 20d @agne:R
"""

EDITOR = "() => document.getElementById('planEditor').value"


def _open_outline(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    page.evaluate("() => switchToView('notepad')")
    page.wait_for_function("() => !NavigationController.isTransitioning()")
    page.wait_for_selector("#notepadContainer .notepad-row[data-task-id] .notepad-input")
    return page.locator("#notepadContainer .notepad-row[data-task-id] .notepad-input")


def test_outline_titles_leave_out_quality_roles(page, app_server):
    inputs = _open_outline(page, app_server)
    assert inputs.evaluate_all("els => els.map(e => e.value)") == ["Definition Stage", "Produce Plan", "PDD"]


def test_renaming_in_the_outline_keeps_quality_roles(page, app_server):
    inputs = _open_outline(page, app_server)
    inputs.nth(0).fill("Discovery Stage")
    inputs.nth(0).press("Enter")
    text = page.evaluate(EDITOR)
    assert "Discovery Stage $definition @Kevin:P @Agne:R @julian:A" in text
    assert "Produce Plan @Kevin 100% @agne:A @katie:R" in text
