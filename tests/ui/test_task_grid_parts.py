"""The task grid's cells are the task row's parts.

The Tasks view and the Gantt's task list draw one 16-column grid, and it
drew a task's completion, status and people its own way: a hand-built 16px
conic pie, a 12px dot on a hex palette, and "sam[50%], Jo Lee" as text.
Those cells are now the task row's (Penpot "Task row"): <np-checkbox> filled
to the percent, <np-rag> and <np-resource-stack>. The grid itself -- every
column, in-cell editing, the Gantt's row alignment -- is unchanged. These
pin that each cell still does what it did.

Usage:
    uv run pytest tests/ui/test_task_grid_parts.py -q
"""

import pytest

from .helpers import load_plan, open_app, plan_text

pytestmark = pytest.mark.ui

PLAN = """---
title: Task grid
Resources:
  - @sam: Sam Smith, Developer
  - @jo: Jo Lee, Reviewer
---

Discovery
  Research @sam 5d 60%
  Sign-off 0d 100%
Build @jo
  API @sam[50%] @jo 8d
  Docs 3d
"""

ROWS = {"tasks": "#tasksTableBody tr", "gantt": "#gantt-view .gantt-info-table tbody tr"}


def _view(page, view_id):
    page.evaluate(f"switchToView('{view_id}')")
    page.wait_for_selector(f"{ROWS[view_id]} np-checkbox")


def _cells(page, view_id):
    return page.evaluate(
        """sel => Object.fromEntries([...document.querySelectorAll(sel)].map(tr => {
            const name = tr.querySelector('.task-name-text').textContent.replace(/[\u25B6\u25BC]/g, '').trim();
            const box = tr.querySelector('.gantt-done-cell np-checkbox');
            const dot = tr.querySelector('.gantt-rag-cell np-rag');
            const people = tr.querySelector('td[data-field="resources"]');
            const stack = people && people.querySelector('np-resource-stack');
            return [name, {
                box: box && { checked: box.hasAttribute('checked'), progress: box.getAttribute('progress'),
                              label: box.getAttribute('label') },
                rag: dot && { status: dot.getAttribute('status'), done: dot.hasAttribute('done') },
                people: stack ? stack.getAttribute('names') : people && people.textContent.trim(),
                title: people && people.getAttribute('title'),
                inherited: !!(people && people.querySelector('.task-grid-inherited')),
            }];
        }))""",
        ROWS[view_id],
    )


def _line(page, name):
    for line in plan_text(page).splitlines():
        if line.strip().split(" ")[0] == name:
            return line
    raise AssertionError(f"no line for {name!r}")


@pytest.fixture
def grid(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    return page


@pytest.mark.parametrize("view_id", ["tasks", "gantt"])
def test_the_grid_cells_are_the_rows_parts(grid, view_id):
    _view(grid, view_id)
    cells = _cells(grid, view_id)
    assert cells["Discovery"]["box"] is None, "a phase reports its tasks; it has no box of its own"
    assert cells["Research"]["box"] == {"checked": False, "progress": "60",
                                        "label": 'Mark "Research" as complete (60% complete)'}
    assert cells["Sign-off"]["box"]["checked"] and cells["Sign-off"]["rag"]["done"]
    assert cells["Research"]["rag"]["status"], cells["Research"]
    assert cells["Research"]["people"] == "Sam Smith"
    assert cells["API"]["people"] == "Sam Smith, Jo Lee"
    assert "sam[50%]" in (cells["API"]["title"] or ""), "the allocation is still there, on hover"
    assert grid.locator(".mini-piechart, .gantt-rag-dot").count() == 0


def test_an_inherited_assignment_says_so(grid):
    _view(grid, "tasks")
    inherited = grid.evaluate("() => lastRenderedTasks.filter(t => t.inherited_resource).map(t => t.name)")
    if not inherited:
        pytest.skip("the engine reports no inherited assignment for this plan")
    cells = _cells(grid, "tasks")
    for name in inherited:
        assert cells[name]["inherited"], cells[name]
        assert "Inherited from parent summary task" in cells[name]["title"]


@pytest.mark.parametrize("view_id", ["tasks", "gantt"])
def test_a_click_on_the_box_ticks_and_unticks_the_task(grid, view_id):
    _view(grid, view_id)
    box = f"{ROWS[view_id]}:has(.task-name-text:text-is('Docs')) np-checkbox"
    grid.locator(box).click()
    grid.wait_for_function("() => /Docs\\b[^\\n]*100%/.test(document.getElementById('planEditor').value)")
    grid.wait_for_selector(f"{box}[checked]")
    grid.locator(box).click()
    grid.wait_for_function("() => /Docs\\b[^\\n]*\\b0%/.test(document.getElementById('planEditor').value)")


def test_a_click_on_the_box_does_not_open_the_task(grid):
    _view(grid, "tasks")
    grid.locator("#tasksTableBody tr:has(.task-name-text:text-is('Docs')) np-checkbox").click()
    grid.wait_for_function("() => /Docs\\b[^\\n]*100%/.test(document.getElementById('planEditor').value)")
    assert not grid.evaluate("() => document.getElementById('taskFormSection')?.classList.contains('active')")


def test_press_and_hold_sets_a_percent(grid):
    _view(grid, "tasks")
    box = grid.locator("#tasksTableBody tr:has(.task-name-text:text-is('Docs')) np-checkbox")
    box.scroll_into_view_if_needed()
    b = box.bounding_box()
    grid.mouse.move(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2)
    grid.mouse.down()
    grid.wait_for_selector(".piechart-popup", timeout=3000)
    grid.mouse.up()
    grid.locator(".piechart-popup-btn", has_text="50%").click()
    grid.wait_for_function("() => /Docs\\b[^\\n]*50%/.test(document.getElementById('planEditor').value)")
    assert "100%" not in _line(grid, "Docs"), "the click that ends the hold is not also a tick"


def test_the_people_cell_still_edits_as_text_and_escape_restores_the_chips(grid):
    _view(grid, "tasks")
    cell = grid.locator("#tasksTableBody tr:has(.task-name-text:text-is('API')) td[data-field='resources']")
    cell.dblclick()
    field = cell.locator("input")
    assert field.input_value() == grid.evaluate(
        "() => lastRenderedTasks.find(t => t.name === 'API').resources"
    )
    field.press("Escape")
    assert cell.locator("np-resource-stack").get_attribute("names") == "Sam Smith, Jo Lee"


def test_editing_the_people_cell_writes_the_plan(grid):
    _view(grid, "tasks")
    cell = grid.locator("#tasksTableBody tr:has(.task-name-text:text-is('Docs')) td[data-field='resources']")
    cell.dblclick()
    field = cell.locator("input")
    field.fill("@jo")
    field.press("Enter")
    grid.wait_for_function("() => /Docs\\b[^\\n]*@jo/.test(document.getElementById('planEditor').value)")
    grid.wait_for_selector(
        "#tasksTableBody tr:has(.task-name-text:text-is('Docs')) td[data-field='resources'] np-resource-stack"
    )


def test_on_a_touch_screen_the_box_is_a_whole_target(tablet_landscape, app_server):
    pg = tablet_landscape
    open_app(pg, app_server)
    load_plan(pg, PLAN)
    _view(pg, "tasks")
    size = pg.evaluate(
        """() => { const r = document.querySelector('#tasksTableBody np-checkbox').getBoundingClientRect();
            return [Math.round(r.width), Math.round(r.height)]; }"""
    )
    assert min(size) >= 44, size
