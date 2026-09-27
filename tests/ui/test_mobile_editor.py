"""The markdown editor on phones and tablets (#1381, epic #1376).

* On a phone no view renders beside or above the editor: it is its own
  full-screen "Markdown" view, at 16px.
* With the editor hidden, editing in Tasks, Board, Outline and the task form
  still writes the plan -- and the edit survives a reload.
* Collapsed or expanded is remembered per layout, and a portrait tablet
  starts collapsed.
"""

import pytest

from .helpers import load_plan, open_app

PLAN = """---
title: Editor on a phone
---

Design
  Research @alex 2d
  Wireframes @alex 3d
"""

EDITOR_SHOWN = """() => {
    const panel = document.querySelector('.editor-panel');
    const r = panel.getBoundingClientRect();
    return getComputedStyle(panel).display !== 'none' && r.width > 0 && r.height > 0;
}"""


def _switch(pg, view):
    pg.evaluate(f"() => switchToView({view!r})")
    pg.wait_for_function("() => !NavigationController.isTransitioning()")


def _plan(pg):
    return pg.evaluate("() => document.getElementById('planEditor').value")


def _persisted(pg, text):
    """Reload straight after the edit, as someone switching away from the app
    would, and return the restored editor text. The edit is only in the editor
    at this point: saving it is the page's job as it goes (project-storage.js
    saves on pagehide and when the page is hidden)."""
    pg.reload(wait_until="domcontentloaded")
    pg.wait_for_function("t => document.getElementById('planEditor').value.includes(t)", arg=text, timeout=15000)
    return _plan(pg)


@pytest.mark.parametrize("view", ["tasks", "notepad", "kanban", "raid", "project-report"])
def test_no_view_renders_beside_or_above_the_editor_on_a_phone(phone, app_server, view):
    open_app(phone, app_server)
    load_plan(phone, PLAN)
    _switch(phone, view)
    assert not phone.evaluate(EDITOR_SHOWN)
    assert not phone.evaluate(
        "() => ['kanbanEditorPanel', 'editorSplitter', 'kanbanSplitter'].some(id => "
        "document.getElementById(id).getBoundingClientRect().height > 0)"
    )


def test_the_tasks_view_starts_right_under_the_app_bar(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, PLAN)
    _switch(phone, "tasks")
    top = phone.evaluate("() => document.getElementById('tasks-view').getBoundingClientRect().top")
    assert top <= 150


def test_the_markdown_view_is_the_editor_full_screen(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, PLAN)
    _switch(phone, "markdown")
    assert phone.evaluate(EDITOR_SHOWN)
    box = phone.evaluate(
        """() => {
            const r = document.querySelector('.editor-panel').getBoundingClientRect();
            return { width: r.width, bottom: r.bottom, size: parseFloat(getComputedStyle(
                document.getElementById('planEditor')).fontSize),
                output: getComputedStyle(document.querySelector('.output-panel')).display };
        }"""
    )
    assert box["width"] >= 389
    assert box["bottom"] >= 844 - 2
    assert box["size"] >= 16
    assert box["output"] == "none"
    assert phone.evaluate("() => document.getElementById('phoneAppBar').getAttribute('subheading')") == "Markdown"

    # And leaving it hides the editor again.
    _switch(phone, "tasks")
    assert not phone.evaluate(EDITOR_SHOWN)


def test_the_drawer_offers_the_markdown_view(phone, app_server):
    open_app(phone, app_server)
    phone.evaluate("() => document.getElementById('phoneAppBar').menuButton.click()")
    phone.locator("#phoneNavDrawer button[data-id='cmd:markdown']").tap()
    phone.wait_for_function("() => NavigationController.getCurrentView() === 'markdown'")


def test_editing_in_tasks_with_the_editor_hidden_survives_a_reload(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, PLAN, with_project="Tasks on a phone")
    _switch(phone, "tasks")
    assert not phone.evaluate(EDITOR_SHOWN)
    phone.evaluate(
        """() => {
            const row = [...document.querySelectorAll('#tasksTableBody tr')].find(r => r.textContent.includes('Research'));
            const cell = [...row.querySelectorAll('td')].find(td => td.textContent.trim().startsWith('Research'));
            cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        }"""
    )
    field = phone.locator("#tasksTableBody input:focus, #tasksTableBody input").first
    field.fill("Research interviews")
    field.press("Enter")
    phone.wait_for_function("() => document.getElementById('planEditor').value.includes('Research interviews')")
    assert "Research interviews" in _persisted(phone, "Research interviews")


def test_completing_a_card_on_the_board_with_the_editor_hidden_survives_a_reload(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, PLAN, with_project="Board on a phone")
    _switch(phone, "kanban")
    phone.wait_for_selector(".kanban-card")
    card = phone.locator(".kanban-card", has_text="Wireframes").first
    card.locator(".round-checkbox").click()
    phone.wait_for_function(
        "() => /Wireframes[^\\n]*100%/.test(document.getElementById('planEditor').value)"
    )
    assert "100%" in [line for line in _persisted(phone, "100%").splitlines() if "Wireframes" in line][0]


def test_typing_in_the_outline_with_the_editor_hidden_survives_a_reload(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, PLAN, with_project="Outline on a phone")
    _switch(phone, "notepad")
    phone.wait_for_selector(".notepad-input")
    field = phone.locator(".notepad-input >> nth=2")
    assert field.input_value() == "Wireframes"
    field.fill("Wireframes v2")
    field.press("Enter")
    phone.wait_for_function("() => document.getElementById('planEditor').value.includes('Wireframes v2')")
    assert "Wireframes v2" in _persisted(phone, "Wireframes v2")


def test_the_task_form_with_the_editor_hidden_survives_a_reload(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, PLAN, with_project="Task form on a phone")
    _switch(phone, "tasks")
    phone.evaluate(
        """() => {
            const model = NoodlePlanModel.modelForEditor(document.getElementById('planEditor'));
            openTaskForm(model.lineNumber(model.tasks.find(t => t.name === 'Research')));
        }"""
    )
    phone.wait_for_selector("#taskFormSection.active")
    phone.locator("#taskDuration").fill("7")
    phone.wait_for_function("() => /Research[^\\n]*7d/.test(document.getElementById('planEditor').value)")
    restored = _persisted(phone, "7d")
    assert any("Research" in line and "7d" in line for line in restored.splitlines())


def test_a_portrait_tablet_starts_with_the_editor_collapsed(tablet_portrait, app_server):
    open_app(tablet_portrait, app_server)
    tablet_portrait.wait_for_function("() => document.querySelector('.editor-panel').classList.contains('collapsed')")


def test_the_collapse_choice_is_remembered_per_layout(device_page, app_server):
    pg = device_page("tablet_landscape")
    open_app(pg, app_server)
    # Landscape tablets start expanded, like a desktop.
    assert not pg.evaluate("() => document.querySelector('.editor-panel').classList.contains('collapsed')")
    pg.evaluate("() => toggleMainEditor()")
    assert pg.evaluate("() => JSON.parse(localStorage.getItem('noodleplanner:editor-collapsed'))") == {
        "tablet-landscape": True
    }

    # Remembered across a reload...
    pg.reload(wait_until="domcontentloaded")
    pg.wait_for_function("() => document.querySelector('.editor-panel').classList.contains('collapsed')")

    # ...but not imposed on the desktop, which keeps its own choice...
    pg.set_viewport_size({"width": 1280, "height": 900})
    pg.wait_for_function("() => !document.querySelector('.editor-panel').classList.contains('collapsed')")

    # ...and back on the tablet, the tablet's choice returns.
    pg.set_viewport_size({"width": 1024, "height": 768})
    pg.wait_for_function("() => document.querySelector('.editor-panel').classList.contains('collapsed')")


def test_a_ribbon_command_that_needs_the_editor_opens_the_markdown_view_on_a_phone(phone, app_server):
    open_app(phone, app_server)
    phone.evaluate("() => revealEditorPanel()")
    phone.wait_for_function("() => NavigationController.getCurrentView() === 'markdown'")
    assert phone.evaluate(EDITOR_SHOWN)
