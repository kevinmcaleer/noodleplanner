"""<np-task-row> in the task form and the product form.

The task form's Subtasks were bordered cards with a mini pie chart and
hand-built avatars, its Dependencies a <table> of bare inputs, and the
product form's Activities a flex list showing "NN%" as text -- three looks
for one thing. All three are now <np-task-row>s (Penpot "Task row"), and
these pin that each list still does what it did:

* Subtasks: every descendant, indented by depth; a summary reports its
  children; ticking writes the percent; the name opens the subtask; "Add Sub
  Task" is a row in its editing state.
* Dependencies: one relation row per predecessor; the pill edits type and
  lag; the action removes; the add box still adds.
* Activities: compact rows that tick, open and remove.
* On a phone every row is a 44px target and its action is shown without a
  hover to reveal it.

Usage:
    uv run pytest tests/ui/test_task_row.py -q
"""

import pytest

from .helpers import load_plan, open_app, plan_text

pytestmark = pytest.mark.ui

PLAN = """---
title: Task rows
Resources:
  - @sam: Sam Smith, Developer
---

Release
  Research @sam 2d
  Build 3d [depends Research]
    Frontend 1d
      Styles 1d 100%
      Scripts 1d
    Backend 1d
  Spec $spec
    Draft 2d
    Review 1d
"""


def _line(page, name):
    """The plan line whose task is `name` (the first word after the indent)."""
    for line in plan_text(page).splitlines():
        if line.strip().split(" ")[0] == name:
            return line
    raise AssertionError(f"no line for {name!r}")


def _open_task(page, name):
    page.evaluate(
        """name => {
            if (isDetailPaneOpen()) closeDetailPane();
            const m = NoodlePlanModel.modelForEditor(document.getElementById('planEditor'));
            openTaskForm(m.lineNumber(m.tasks.find(t => t.name === name)));
        }""",
        name,
    )
    page.wait_for_selector("#taskFormSection.active")
    page.wait_for_function("name => document.getElementById('taskName').value === name", arg=name)


def _open_product(page, deliverable):
    page.evaluate(
        """id => {
            if (isDetailPaneOpen()) closeDetailPane();
            openProductForm(lastRenderedTasks.find(t => t.deliverable === id));
        }""",
        deliverable,
    )
    page.wait_for_selector("#productFormSection.active")


def _rows(page, list_id):
    return page.evaluate(
        """id => [...document.querySelectorAll(`#${id} np-task-row`)].map(r => ({
            name: r.getAttribute('name'),
            depth: r.getAttribute('depth'),
            percent: r.getAttribute('percent'),
            summary: r.hasAttribute('summary'),
            indeterminate: r.hasAttribute('indeterminate'),
            type: r.getAttribute('type'),
            density: r.getAttribute('density'),
            relation: r.getAttribute('relation'),
            lag: r.getAttribute('lag'),
        }))""",
        list_id,
    )


@pytest.fixture
def loaded(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    page.on("dialog", lambda dialog: dialog.accept())
    return page


# ── Subtasks ────────────────────────────────────────────────────────────


def test_subtasks_are_task_rows_indented_by_depth(loaded):
    _open_task(loaded, "Build")
    rows = _rows(loaded, "subtasksList")
    assert [r["name"] for r in rows] == ["Frontend", "Styles", "Scripts", "Backend"]
    by_name = {r["name"]: r for r in rows}
    assert by_name["Frontend"]["depth"] is None
    assert by_name["Styles"]["depth"] == "1"
    # One of Frontend's two children is done: a summary reports that as mixed.
    assert by_name["Frontend"]["summary"] and by_name["Frontend"]["indeterminate"]
    assert not by_name["Backend"]["summary"]
    assert by_name["Styles"]["percent"] == "100"


def test_ticking_a_subtask_writes_its_percent(loaded):
    _open_task(loaded, "Build")
    loaded.locator("#subtasksList np-task-row[name='Scripts'] np-checkbox").click()
    loaded.wait_for_function(
        "() => /Scripts\\b.*100%/.test(document.getElementById('planEditor').value)"
    )
    assert "100%" in _line(loaded, "Scripts")
    # Both of Frontend's children are done now: no longer mixed.
    frontend = next(r for r in _rows(loaded, "subtasksList") if r["name"] == "Frontend")
    assert not frontend["indeterminate"]


def test_holding_a_subtask_box_sets_a_part_percent(loaded):
    """The mini pie chart's press-and-hold for 0/25/50/75/100%, kept."""
    _open_task(loaded, "Build")
    target = loaded.locator("#subtasksList np-task-row[name='Backend'] np-checkbox")
    target.scroll_into_view_if_needed()
    box = target.bounding_box()
    loaded.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    loaded.mouse.down()
    loaded.wait_for_selector(".piechart-popup")
    loaded.mouse.up()
    loaded.locator(".piechart-popup-btn", has_text="50%").click()
    loaded.wait_for_function(
        "() => /Backend\\b.*50%/.test(document.getElementById('planEditor').value)"
    )
    # The hold did not also tick it.
    assert "100%" not in _line(loaded, "Backend")


def test_a_subtask_name_opens_that_task(loaded):
    _open_task(loaded, "Build")
    loaded.locator("#subtasksList np-task-row[name='Backend'] button.name").click()
    loaded.wait_for_function("() => document.getElementById('taskName').value === 'Backend'")


def test_add_sub_task_is_a_row_being_edited(loaded):
    _open_task(loaded, "Build")
    loaded.locator("#taskFormSection .add-item-link").click()
    editing = loaded.locator("#subtasksList np-task-row[editing]")
    editing.locator("input.name-input").fill("Testing")
    editing.locator("input.name-input").press("Enter")
    loaded.wait_for_function(
        "() => document.getElementById('planEditor').value.includes('    Testing')"
    )
    assert "Testing" in [r["name"] for r in _rows(loaded, "subtasksList")]


def test_typing_a_sub_task_name_is_not_a_page_shortcut(loaded):
    """The name input is inside the row's shadow root. "gg"/"gl" switch views
    and "?" opens the shortcuts dialog unless the page can see the key came
    from a field -- keyEventTarget() (#1405) is what lets it."""
    _open_task(loaded, "Build")
    loaded.locator("#taskFormSection .add-item-link").click()
    field = loaded.locator("#subtasksList np-task-row[editing] input.name-input")
    field.press_sequentially("Suggest egg glue?")
    assert field.input_value() == "Suggest egg glue?"
    assert loaded.locator("#taskFormSection.active").count() == 1
    field.press("Enter")
    loaded.wait_for_function(
        "() => document.getElementById('planEditor').value.includes('Suggest egg glue?')"
    )


def test_escape_abandons_a_new_sub_task(loaded):
    _open_task(loaded, "Build")
    before = plan_text(loaded)
    loaded.locator("#taskFormSection .add-item-link").click()
    editing = loaded.locator("#subtasksList np-task-row[editing]")
    editing.locator("input.name-input").fill("Never mind")
    editing.locator("input.name-input").press("Escape")
    assert loaded.locator("#subtasksList np-task-row[editing]").count() == 0
    assert plan_text(loaded) == before


def test_no_subtasks_says_so(loaded):
    _open_task(loaded, "Backend")
    assert loaded.locator("#subtasksList np-task-row").count() == 0
    content = loaded.evaluate(
        "() => getComputedStyle(document.getElementById('subtasksList'), '::after').content"
    )
    assert "No sub tasks" in content


# ── Dependencies ────────────────────────────────────────────────────────


def test_a_dependency_is_a_relation_row(loaded):
    _open_task(loaded, "Build")
    rows = _rows(loaded, "dependenciesList")
    assert len(rows) == 1
    assert rows[0]["name"] == "Research"
    assert rows[0]["type"] == "relation"
    assert rows[0]["relation"] == "FS"
    pill = loaded.locator("#dependenciesList np-task-row button.pill")
    assert pill.inner_text() == "FS"


def test_the_pill_edits_type_and_lag(loaded):
    _open_task(loaded, "Build")
    row = loaded.locator("#dependenciesList np-task-row[name='Research']")
    row.locator("button.pill").click()
    row.locator("select.rel-type").select_option("SS")
    row.locator("input.rel-lag").fill("+2d")
    row.locator("input.rel-lag").press("Enter")
    loaded.wait_for_function(
        "() => document.getElementById('planEditor').value.includes('Research:SS +2d')"
    )
    assert "Research:SS +2d" in _line(loaded, "Build")
    # Enter leaves editing: the pill is back, saying what it now is.
    assert row.locator("button.pill").inner_text() == "SS +2d"


def test_the_action_removes_a_dependency(loaded):
    _open_task(loaded, "Build")
    row = loaded.locator("#dependenciesList np-task-row[name='Research']")
    row.hover()
    row.locator("button.action").click()
    loaded.wait_for_function(
        "() => !/Build.*depends/.test(document.getElementById('planEditor').value)"
    )
    assert loaded.locator("#dependenciesList np-task-row").count() == 0


def test_the_add_box_adds_a_relation_row(loaded):
    _open_task(loaded, "Backend")
    box = loaded.locator("#addDependencyInput")
    box.fill("Research")
    box.press("Enter")
    loaded.wait_for_function(
        "() => /Backend.*\\[depends Research\\]/.test(document.getElementById('planEditor').value)"
    )
    assert [r["name"] for r in _rows(loaded, "dependenciesList")] == ["Research"]


def test_a_dependency_name_opens_the_predecessor(loaded):
    _open_task(loaded, "Build")
    loaded.locator("#dependenciesList np-task-row[name='Research'] button.name").click()
    loaded.wait_for_function("() => document.getElementById('taskName').value === 'Research'")


# ── Product activities ──────────────────────────────────────────────────


def test_activities_are_compact_task_rows(loaded):
    _open_product(loaded, "spec")
    rows = _rows(loaded, "productComposition")
    assert [r["name"] for r in rows] == ["Draft", "Review"]
    assert {r["density"] for r in rows} == {"compact"}


def test_ticking_an_activity_writes_its_percent(loaded):
    _open_product(loaded, "spec")
    loaded.locator("#productComposition np-task-row[name='Draft'] np-checkbox").click()
    loaded.wait_for_function(
        "() => /Draft\\b.*100%/.test(document.getElementById('planEditor').value)"
    )


def test_the_action_removes_an_activity(loaded):
    _open_product(loaded, "spec")
    row = loaded.locator("#productComposition np-task-row[name='Review']")
    row.hover()
    row.locator("button.action").click()
    loaded.wait_for_function(
        "() => !/^\\s*Review\\b/m.test(document.getElementById('planEditor').value)"
    )


# ── Phone ───────────────────────────────────────────────────────────────


def test_rows_are_touch_targets_on_a_phone(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, PLAN)
    _open_task(phone, "Build")
    phone.evaluate("() => document.querySelectorAll('#taskFormSection details').forEach(d => d.open = true)")
    found = phone.evaluate(
        """() => [...document.querySelectorAll('#subtasksList np-task-row, #dependenciesList np-task-row')]
            .map(r => {
                const action = r.shadowRoot.querySelector('.action');
                return {
                    name: r.getAttribute('name'),
                    height: r.getBoundingClientRect().height,
                    actionOpacity: action.hidden ? null : getComputedStyle(action).opacity,
                };
            })"""
    )
    assert found, "no rows rendered"
    for row in found:
        assert row["height"] >= 44, row
        # No hover on a phone, so nothing may wait for one.
        assert row["actionOpacity"] in (None, "1"), row


# ── Dependency picker ───────────────────────────────────────────────────


def _picker(page):
    return page.evaluate(
        """() => {
            const box = document.getElementById('addDependencyAutocomplete');
            return {
                shown: box.style.display === 'block',
                options: [...box.querySelectorAll('np-task-row')].map(r => ({
                    name: r.getAttribute('name'),
                    type: r.getAttribute('type'),
                    density: r.getAttribute('density'),
                    id: r.getAttribute('task-id'),
                    meta: r.getAttribute('meta'),
                    role: r.getAttribute('role'),
                    selected: r.hasAttribute('selected'),
                })),
                more: box.querySelector('.dependency-picker-more')?.textContent || null,
            };
        }"""
    )


def test_the_picker_offers_task_rows_that_tell_tasks_apart(loaded):
    _open_task(loaded, "Backend")
    loaded.locator("#addDependencyInput").press_sequentially("Res")
    picker = _picker(loaded)
    assert picker["shown"]
    research = next(o for o in picker["options"] if o["name"] == "Research")
    assert research["type"] == "picker" and research["density"] == "compact"
    assert research["role"] == "option"
    # The ID and dates are what tell two similarly named tasks apart.
    assert research["id"] and research["meta"]


def test_the_picker_lists_names_starting_with_the_query_first(loaded):
    _open_task(loaded, "Backend")
    loaded.locator("#addDependencyInput").press_sequentially("s")
    names = [o["name"] for o in _picker(loaded)["options"]]
    starts = [n for n in names if n.lower().startswith("s")]
    assert starts and names[: len(starts)] == starts, names
    assert "Research" in names[len(starts):]


def test_the_picker_leaves_out_this_task_and_its_dependencies(loaded):
    _open_task(loaded, "Build")
    box = loaded.locator("#addDependencyInput")
    box.press_sequentially("Build")
    assert "Build" not in [o["name"] for o in _picker(loaded)["options"]]
    box.fill("")
    box.press_sequentially("Resea")
    # Research is already a predecessor of Build: nothing left to offer.
    assert not _picker(loaded)["shown"]


def test_arrow_and_enter_pick_the_active_option(loaded):
    _open_task(loaded, "Backend")
    box = loaded.locator("#addDependencyInput")
    box.press_sequentially("Resea")
    box.press("ArrowDown")
    picker = _picker(loaded)
    assert picker["options"][0]["selected"]
    active = loaded.evaluate("() => document.getElementById('addDependencyInput').getAttribute('aria-activedescendant')")
    assert active and loaded.locator(f"#{active}").get_attribute("name") == "Research"
    box.press("Enter")
    loaded.wait_for_function(
        "() => /Backend.*\\[depends Research\\]/.test(document.getElementById('planEditor').value)"
    )
    assert not _picker(loaded)["shown"]
    assert box.input_value() == ""


def test_clicking_an_option_adds_it(loaded):
    _open_task(loaded, "Backend")
    loaded.locator("#addDependencyInput").press_sequentially("Resea")
    loaded.locator("#addDependencyAutocomplete np-task-row[name='Research']").click()
    loaded.wait_for_function(
        "() => /Backend.*\\[depends Research\\]/.test(document.getElementById('planEditor').value)"
    )
    assert [r["name"] for r in _rows(loaded, "dependenciesList")] == ["Research"]
    # Focus stays in the box, ready for the next one.
    assert loaded.evaluate("() => document.activeElement.id") == "addDependencyInput"


def test_escape_closes_the_picker(loaded):
    _open_task(loaded, "Backend")
    box = loaded.locator("#addDependencyInput")
    box.press_sequentially("Resea")
    assert _picker(loaded)["shown"]
    box.press("Escape")
    assert not _picker(loaded)["shown"]
    assert box.get_attribute("aria-expanded") == "false"


def test_a_task_cannot_be_made_to_depend_on_itself(loaded):
    _open_task(loaded, "Backend")
    before = _line(loaded, "Backend")
    box = loaded.locator("#addDependencyInput")
    box.fill("Backend")
    box.press("Enter")
    assert loaded.locator("#dependenciesList np-task-row").count() == 0
    assert _line(loaded, "Backend") == before


def test_a_long_match_list_is_capped(page, app_server):
    tasks = "\n".join(f"  Step {i} 1d" for i in range(1, 61))
    open_app(page, app_server)
    load_plan(page, f"---\ntitle: Many\n---\n\nProject\n{tasks}\n  Wrap up 1d\n")
    _open_task(page, "Wrap up")
    page.locator("#addDependencyInput").press_sequentially("Step")
    picker = _picker(page)
    assert len(picker["options"]) == 50
    assert picker["more"] and picker["more"].startswith("10 more")


def test_clicking_the_empty_box_lists_every_task_it_could_depend_on(loaded):
    _open_task(loaded, "Backend")
    loaded.locator("#addDependencyInput").click()
    names = [o["name"] for o in _picker(loaded)["options"]]
    # Every leaf task in the plan -- phases were never dependency targets
    # here (getAllTaskNames) -- ...
    assert names, "an empty box, clicked, offers the whole plan"
    assert {"Research", "Styles", "Scripts", "Draft", "Review"} <= set(names)
    # Never itself, nor its own phases -- depending on those is a loop.
    assert "Backend" not in names
    assert "Build" not in names and "Release" not in names


def test_the_picker_leaves_out_anything_that_would_make_a_loop(loaded):
    """Build waits on Research, so Research may not wait on Build -- nor on
    Build's subtasks, which wait with their phase."""
    _open_task(loaded, "Research")
    loaded.locator("#addDependencyInput").click()
    names = [o["name"] for o in _picker(loaded)["options"]]
    for looped in ("Research", "Release", "Build", "Frontend", "Styles", "Scripts", "Backend"):
        assert looped not in names, (looped, names)
    assert names == ["Draft", "Review"]


def test_typing_a_looping_name_is_refused(loaded):
    _open_task(loaded, "Research")
    before = _line(loaded, "Research")
    box = loaded.locator("#addDependencyInput")
    box.fill("Build")
    box.press("Enter")
    assert loaded.locator("#dependenciesList np-task-row").count() == 0
    assert _line(loaded, "Research") == before


def test_arrow_down_opens_a_closed_picker(loaded):
    _open_task(loaded, "Backend")
    box = loaded.locator("#addDependencyInput")
    box.focus()
    assert not _picker(loaded)["shown"]
    box.press("ArrowDown")
    assert _picker(loaded)["shown"]
