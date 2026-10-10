"""The task form's ← Back button returns to the task you drilled down from.

Opening a subtask (or a dependency) from inside the task form pushes the task
you were on, and Back pops it. The trail lives only while the form stays
open: closing it, or opening a task any other way, starts it afresh.

Usage:
    uv run pytest tests/ui/test_task_form_back.py -q
"""

from .helpers import load_plan, open_app

PLAN = """---
title: Back button
---

Design
  Research 2d
  Wireframes 3d
"""

BACK = "#taskFormBackBtn"
TITLE = "document.getElementById('taskName').value"


def _open(page, name):
    page.evaluate(
        "(n) => { const m = NoodlePlanModel.modelForEditor(document.getElementById('planEditor'));"
        " openTaskForm(m.lineNumber(m.tasks.concat(...m.tasks.map(t => t.children)).find(t => t.name === n))); }",
        name,
    )
    page.wait_for_function(f"() => {TITLE} === {name!r}")


def _drill(page, name):
    # the same call a subtask row's task-open event makes
    page.evaluate(
        "(n) => drillIntoTask(() => openTaskFormByName(n, { keepHistory: true }))", name
    )
    page.wait_for_function(f"() => {TITLE} === {name!r}")


def test_back_hidden_until_drilled_then_returns(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    _open(page, "Design")
    assert page.locator(BACK).is_hidden()

    _drill(page, "Research")
    assert page.locator(BACK).is_visible()
    _drill(page, "Wireframes")

    page.click(BACK)
    page.wait_for_function(f"() => {TITLE} === 'Research'")
    assert page.locator(BACK).is_visible()
    page.click(BACK)
    page.wait_for_function(f"() => {TITLE} === 'Design'")
    assert page.locator(BACK).is_hidden()


def test_history_resets_when_form_closed_or_reopened(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    _open(page, "Design")
    _drill(page, "Research")

    page.evaluate("closeTaskForm()")
    _open(page, "Design")
    assert page.locator(BACK).is_hidden()

    _drill(page, "Research")
    _open(page, "Wireframes")  # opened some other way, not by drilling down
    assert page.locator(BACK).is_hidden()
