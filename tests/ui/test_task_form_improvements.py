"""Task details form improvements (epic #1460).

* #1461 a long task name stays on one line in the header.
* #1462 Inspect and Product sit on the peek bar, right-aligned.
* #1463 no excess padding above the Schedule section.
* #1464 the form uses the compact field size.
* #1465 resources are a list of rows, added from a dropdown (with "new").
* #1466 clicking a resource opens its details form.
* #1467 a blank entry replaces "Add Sub Task".
* #1468 a trashcan replaces the ⋯ menu.
"""

from .helpers import load_plan, open_app

PLAN = """---
title: Task form
Resources:
- @alex: Alex Archer, Designer
- @sam: Sam Smith, Developer
---

Design
  Research @alex 2d
  Wireframes @alex @sam 3d
"""

OPEN = ("() => { const m = NoodlePlanModel.modelForEditor(document.getElementById('planEditor'));"
        " openTaskForm(m.lineNumber(m.tasks.find(t => t.name === '%s'))); }")


def _open(pg, name="Research"):
    pg.evaluate("() => { if (isDetailPaneOpen()) closeDetailPane(); }")
    pg.evaluate(OPEN % name)
    pg.wait_for_selector("#taskFormSection.active")
    pg.evaluate("() => document.querySelectorAll('#taskFormSection details').forEach(d => d.open = true)")


def _plan_line(pg, name):
    return pg.evaluate(
        "(n) => document.getElementById('planEditor').value.split('\\n').find(l => l.trim().startsWith(n))", name
    )


def test_a_long_title_stays_on_one_line(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    _open(page)
    page.evaluate("() => setTaskFormTitle('A very long task name ' + 'that keeps going and going '.repeat(8))")
    box = page.evaluate(
        """() => { const t = document.getElementById('taskFormPanelHeader').shadowRoot.querySelector('.title');
                   const s = getComputedStyle(t);
                   return { h: t.getBoundingClientRect().height, line: parseFloat(s.fontSize) * 2.5,
                            ws: s.whiteSpace, to: s.textOverflow }; }"""
    )
    assert box["ws"] == "nowrap" and box["to"] == "ellipsis"
    assert box["h"] < box["line"]


def test_inspect_and_product_are_on_the_peek_bar(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    _open(page)
    rects = page.evaluate(
        """() => {
            const sheet = document.getElementById('taskFormSection');
            const bar = sheet.shadowRoot.querySelector('.peekbar').getBoundingClientRect();
            const sw = sheet.shadowRoot.querySelector('np-peek-switch').getBoundingClientRect();
            const ins = sheet.querySelector('[slot=peekbar-actions]').getBoundingClientRect();
            const prod = document.getElementById('taskDeliverableBtn').getBoundingClientRect();
            return { bar: [bar.top, bar.bottom, bar.right], sw: [sw.left, sw.right],
                     ins: [ins.left, ins.top, ins.bottom], prod: [prod.left, prod.right, prod.top] };
        }"""
    )
    assert rects["bar"][0] <= rects["ins"][1] and rects["ins"][2] <= rects["bar"][1]
    assert rects["ins"][0] > rects["sw"][1]
    assert rects["bar"][2] - rects["prod"][1] < 24
    # nothing but the title, the trashcan and the close button in the header
    assert page.locator("#taskFormPanelHeader > [slot=actions]").count() == 0


def test_no_excess_padding_above_schedule(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    _open(page)
    gap = page.evaluate(
        """() => {
            const body = document.querySelector('#taskFormSection .modal-body').getBoundingClientRect();
            const first = document.querySelector('#taskFormSection .sheet-section').getBoundingClientRect();
            return first.top - body.top;
        }"""
    )
    assert gap <= 8


def test_fields_use_the_compact_size(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    _open(page)
    heights = page.evaluate(
        """() => ['taskDuration', 'taskStartDate', 'taskPercent'].map(id =>
            document.getElementById(id).getBoundingClientRect().height)"""
    )
    assert all(h <= 34 for h in heights), heights


def test_resources_are_rows_added_from_a_dropdown(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    _open(page, "Wireframes")
    rows = page.locator("#taskResourcesList .resource-row")
    assert rows.count() == 2
    assert "Alex Archer" in rows.nth(0).inner_text()

    # a resource already on the task is not offered again
    options = page.eval_on_selector_all("#addResourceSelect option", "els => els.map(e => e.value)")
    assert options == ["", "__new__"]

    # removing one rewrites the plan line
    rows.nth(1).locator(".resource-row-remove").click()
    assert rows.count() == 1
    assert "@sam" not in _plan_line(page, "Wireframes")

    # adding it back from the dropdown
    page.select_option("#addResourceSelect", "sam")
    assert rows.count() == 2
    assert "@sam" in _plan_line(page, "Wireframes")


def test_a_resource_can_be_defined_from_the_dropdown_and_assigned(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    _open(page)
    page.select_option("#addResourceSelect", "__new__")
    page.wait_for_selector("#resourceFormSection.active")
    page.fill("#resourceShortname", "jo")
    page.fill("#resourceFullName", "Jo Lee")
    page.evaluate("() => saveResource()")
    page.wait_for_selector("#taskFormSection.active")
    assert page.input_value("#taskName") == "Research"
    assert "Jo Lee" in page.locator("#taskResourcesList").inner_text()
    assert "@jo" in _plan_line(page, "Research")


def test_clicking_a_resource_opens_its_form_and_closing_returns(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    _open(page)
    page.locator("#taskResourcesList .resource-row-open").first.click()
    page.wait_for_selector("#resourceFormSection.active")
    assert page.input_value("#resourceShortname") == "alex"
    page.evaluate("() => dismissResourceForm()")
    page.wait_for_selector("#taskFormSection.active")
    assert page.input_value("#taskName") == "Research"


def test_a_blank_entry_adds_a_subtask(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    _open(page, "Design")
    assert page.locator("#taskFormSection .add-item-link").count() == 0
    box = page.locator("#newSubtaskInput")
    box.fill("Prototype")
    box.press("Enter")
    page.wait_for_function(
        "() => [...document.querySelectorAll('#subtasksList np-task-row')].some(r => r.getAttribute('name') === 'Prototype')"
    )
    assert _plan_line(page, "Prototype") == "  Prototype"
    assert page.input_value("#newSubtaskInput") == ""

    # an empty entry adds nothing
    before = page.locator("#subtasksList np-task-row").count()
    box.focus()
    box.press("Enter")
    assert page.locator("#subtasksList np-task-row").count() == before


def test_delete_is_a_trashcan(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    _open(page)
    assert page.evaluate(
        "() => document.getElementById('taskFormPanelHeader').shadowRoot.querySelector('.more').hidden"
    )
    page.once("dialog", lambda d: d.accept())
    page.locator("#taskFormPanelHeader > [slot=trailing]").click()
    page.wait_for_function("() => !document.getElementById('planEditor').value.includes('Research')")
