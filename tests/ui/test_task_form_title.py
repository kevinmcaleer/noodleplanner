"""The task form's editable title is one line of text.

A task name is a single line of the plan, so Enter in the title finishes the
rename -- the title loses focus -- rather than starting a second line, which
used to be written into the plan and split the task's line in two. The same
holds for a soft keyboard's return, which can arrive as a bare `beforeinput`,
and for a paste of several lines.

Usage:
    uv run pytest tests/ui/test_task_form_title.py -q
"""

import pytest

from .helpers import load_plan, open_app, plan_text

PLAN = """---
title: Title editing
---

Design
  Research @alex 2d
  Wireframes 3d
"""

TITLE = "#taskFormPanelHeader .title"
SHADOW = "document.getElementById('taskFormPanelHeader').shadowRoot"


def _open_research(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    page.evaluate(
        "() => { const m = NoodlePlanModel.modelForEditor(document.getElementById('planEditor'));"
        " openTaskForm(m.lineNumber(m.tasks.find(t => t.name === 'Research'))); }"
    )
    page.wait_for_selector("#taskFormSection.active")
    page.wait_for_function(f"() => {SHADOW}.querySelector('.title').textContent === 'Research'")
    title = page.locator(TITLE)
    title.click()
    page.keyboard.press("ControlOrMeta+A")
    return title


def _task_names(page):
    return page.evaluate(
        "() => NoodlePlanModel.modelForEditor(document.getElementById('planEditor')).tasks.map(t => t.name)"
    )


def _title_focused(page):
    return page.evaluate(f"() => {SHADOW}.activeElement !== null")


@pytest.mark.parametrize("key", ["Enter", "Shift+Enter"])
def test_enter_finishes_the_rename(page, app_server, key):
    title = _open_research(page, app_server)
    lines = len(plan_text(page).split("\n"))

    page.keyboard.type("Usability review")
    assert _title_focused(page)
    page.keyboard.press(key)

    assert not _title_focused(page)
    assert title.inner_text() == "Usability review"
    assert "\n" not in page.evaluate("() => document.getElementById('taskName').value")
    assert _task_names(page) == ["Design", "Usability review", "Wireframes"]
    assert len(plan_text(page).split("\n")) == lines


def test_a_soft_keyboard_return_finishes_the_rename(page, app_server):
    # Android's keyboard reports its return key as "Unidentified" on keydown,
    # so the only reliable signal is the line break it is about to insert.
    _open_research(page, app_server)
    page.keyboard.type("Usability review")

    for input_type in ("insertParagraph", "insertLineBreak"):
        page.locator(TITLE).focus()
        prevented = page.evaluate(
            f"""type => !{SHADOW}.querySelector('.title').dispatchEvent(
                new InputEvent('beforeinput', {{ inputType: type, bubbles: true, cancelable: true }}))""",
            input_type,
        )
        assert prevented, input_type
        assert not _title_focused(page), input_type

    assert _task_names(page) == ["Design", "Usability review", "Wireframes"]


def test_a_pasted_name_stays_on_one_line(page, app_server):
    title = _open_research(page, app_server)
    lines = len(plan_text(page).split("\n"))

    page.evaluate(
        f"""() => {{
            const data = new DataTransfer();
            data.setData('text/plain', 'Usability\\nreview\\r\\n  round two');
            {SHADOW}.querySelector('.title').dispatchEvent(
                new ClipboardEvent('paste', {{ clipboardData: data, bubbles: true, cancelable: true }}));
        }}"""
    )

    assert title.inner_text() == "Usability review round two"
    assert _task_names(page) == ["Design", "Usability review round two", "Wireframes"]
    assert len(plan_text(page).split("\n")) == lines


def test_a_line_break_that_gets_in_never_splits_the_plan(page, app_server):
    # A drop, or a browser that refuses insertText in a shadow root, can still
    # put a block or a <br> in the title; the saved name is one line anyway.
    _open_research(page, app_server)
    lines = len(plan_text(page).split("\n"))

    page.evaluate(
        f"""() => {{
            const title = {SHADOW}.querySelector('.title');
            title.innerHTML = 'Usability<div>review</div><br>';
            title.dispatchEvent(new InputEvent('input', {{ bubbles: true }}));
        }}"""
    )

    assert _task_names(page) == ["Design", "Usability review", "Wireframes"]
    assert len(plan_text(page).split("\n")) == lines
