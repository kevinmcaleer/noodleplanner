"""Saved board view tabs (#1553): All Tasks plus one tab per Views: entry."""

from tests.ui.helpers import open_project_view, set_editor_value

PLAN = """\
---
title: Views
start: 2026-01-05
labels: [must, should, ui]
resources:
- @kev: Kevin
- @jen: Jennifer
Views:
  - name: "Must haves"
    filter: "label:must -status:Complete"
  - name: "Kev's work"
    filter: "resource:kev"
---

Design
  Login page #must @kev 2d 100% {Doing}
  Settings page #should #ui @jen 1d 0%
Build
  Login API #must @jen 3d 50% {Doing}
  Search box #ui @kev 2d 0% {Backlog}
"""


def load(page, app_server, plan=PLAN):
    page.set_viewport_size({"width": 1400, "height": 900})
    open_project_view(page, app_server)
    set_editor_value(page, plan)
    page.evaluate("() => switchPlanSubnavToBoard()")
    page.wait_for_selector(".kanban-card")
    return page


def cards(page):
    return sorted(page.evaluate(
        "() => [...document.querySelectorAll('.kanban-card')].map(c => c.dataset.taskName)"))


def tab_names(page):
    return page.evaluate(
        "() => [...document.querySelectorAll('#kanbanViewTabs [role=tab]')].map(t => t.textContent)")


def test_tabs_listed_in_front_matter_order(page, app_server):
    load(page, app_server)
    assert tab_names(page) == ["All Tasks", "Must haves", "Kev's work"]
    selected = page.locator("#kanbanViewTabs [aria-selected=true]")
    assert selected.inner_text() == "All Tasks"
    assert len(cards(page)) == 4


def test_selecting_a_tab_applies_its_filter(page, app_server):
    load(page, app_server)
    page.get_by_role("tab", name="Must haves").click()
    assert cards(page) == ["Login API"]
    assert page.locator("#kanbanFilterInput").input_value() == "label:must -status:Complete"
    page.get_by_role("tab", name="Kev's work").click()
    assert cards(page) == ["Login page", "Search box"]
    page.get_by_role("tab", name="All Tasks").click()
    assert len(cards(page)) == 4
    assert page.locator("#kanbanFilterInput").input_value() == ""


def test_arrow_keys_move_between_tabs(page, app_server):
    load(page, app_server)
    page.get_by_role("tab", name="All Tasks").focus()
    page.keyboard.press("ArrowRight")
    assert page.locator("#kanbanViewTabs [aria-selected=true]").inner_text() == "Must haves"
    assert cards(page) == ["Login API"]
    page.keyboard.press("End")
    assert page.locator("#kanbanViewTabs [aria-selected=true]").inner_text() == "Kev's work"
    page.keyboard.press("ArrowRight")
    assert page.locator("#kanbanViewTabs [aria-selected=true]").inner_text() == "All Tasks"


def test_editing_the_filter_marks_the_tab_modified(page, app_server):
    load(page, app_server)
    page.get_by_role("tab", name="Must haves").click()
    tab = page.get_by_role("tab", name="Must haves")
    assert tab.get_attribute("data-modified") is None
    page.locator("#kanbanFilterInput").press("End")
    page.locator("#kanbanFilterInput").press_sequentially(" ui")
    assert tab.get_attribute("data-modified") == "true"


def test_no_tab_strip_without_saved_views(page, app_server):
    load(page, app_server, PLAN.split("Views:")[0] + "---\n" + PLAN.split("---\n", 2)[2])
    assert page.locator("#kanbanViewTabs").is_hidden()


def test_view_names_are_text_not_markup(page, app_server):
    plan = PLAN.replace("Must haves", "<b>x</b>")
    load(page, app_server, plan)
    assert "<b>x</b>" in tab_names(page)
    assert page.locator("#kanbanViewTabs b").count() == 0


# --- creating and managing views (#1554, #1555, #1556) ----------------------

PLAIN = """\
---
title: Views
start: 2026-01-05
labels: [must, should, ui]
resources:
- @kev: Kevin
- @jen: Jennifer
---

Design
  Login page #must @kev 2d 100% {Doing}
  Settings page #should #ui @jen 1d 0%
Build
  Login API #must @jen 3d 50% {Doing}
  Search box #ui @kev 2d 0% {Backlog}
"""


def plan_text(page):
    return page.evaluate("() => document.getElementById('planEditor').value")


def type_filter(page, text):
    box = page.locator("#kanbanFilterInput")
    box.fill("")
    box.press_sequentially(text)


def dialog_submit(page, **fields):
    dialog = page.locator("dialog.kanban-view-dialog")
    dialog.wait_for()
    inputs = dialog.locator("input")
    values = list(fields.values())
    for i, value in enumerate(values):
        inputs.nth(i).fill(value)
    dialog.locator("np-button[data-action=submit]").click()


def open_menu(page):
    page.locator(".kanban-view-tab-menu-btn").click()
    return page.locator(".kanban-view-menu")


def menu_action(page, action):
    open_menu(page).locator(f"[data-action={action}]").click()


def selected(page):
    return page.locator("#kanbanViewTabs [role=tab][aria-selected=true]").inner_text()


def test_save_filter_as_a_view_writes_front_matter(page, app_server):
    load(page, app_server, PLAIN)
    assert page.locator("#kanbanViewTabs").is_hidden()
    assert page.locator("#kanbanViewActions np-button").count() == 0
    type_filter(page, "label:must")
    page.locator("#kanbanViewActions [data-action=save-new-view]").click()
    dialog_submit(page, name="Must haves")
    assert tab_names(page) == ["All Tasks", "Must haves"]
    assert selected(page) == "Must haves"
    text = plan_text(page)
    assert 'Views:\n  - name: "Must haves"\n    filter: "label:must"' in text
    assert text.count("---") == 2 and "Login page #must" in text
    assert page.locator("#kanbanViewActions np-button").count() == 0


def test_save_discard_and_save_as_new(page, app_server):
    load(page, app_server)
    page.get_by_role("tab", name="Must haves").click()
    page.locator("#kanbanFilterInput").press("End")
    page.locator("#kanbanFilterInput").press_sequentially(" label:ui")
    assert page.locator("#kanbanViewActions np-button").count() == 3
    page.locator("[data-action=discard-view]").click()
    assert page.locator("#kanbanFilterInput").input_value() == "label:must -status:Complete"
    assert page.get_by_role("tab", name="Must haves").get_attribute("data-modified") is None

    type_filter(page, "bucket:Doing")
    page.locator("[data-action=save-view]").click()
    assert 'filter: "bucket:Doing"' in plan_text(page)
    assert cards(page) == ["Login API", "Login page"]

    type_filter(page, "label:ui")
    page.locator("[data-action=save-new-view]").click()
    dialog_submit(page, name="UI work")
    assert tab_names(page) == ["All Tasks", "Must haves", "Kev's work", "UI work"]
    assert selected(page) == "UI work"
    assert plan_text(page).index("UI work") > plan_text(page).index("Kev's work")


def test_name_validation_in_the_dialog(page, app_server):
    load(page, app_server)
    type_filter(page, "label:ui")
    page.locator("[data-action=save-new-view]").click()
    dialog_submit(page, name="  ")
    assert "name" in page.locator(".kanban-view-dialog-error").inner_text().lower()
    dialog_submit(page, name="must HAVES")
    assert "already exists" in page.locator(".kanban-view-dialog-error").inner_text()
    page.keyboard.press("Escape")
    assert page.locator("dialog.kanban-view-dialog").count() == 0
    assert tab_names(page) == ["All Tasks", "Must haves", "Kev's work"]


def test_menu_only_on_the_selected_saved_tab(page, app_server):
    load(page, app_server)
    assert page.locator(".kanban-view-tab-menu-btn").count() == 0
    page.get_by_role("tab", name="Must haves").click()
    assert page.locator(".kanban-view-tab-menu-btn").count() == 1
    page.get_by_role("tab", name="All Tasks").click()
    assert page.locator(".kanban-view-tab-menu-btn").count() == 0


def test_rename_view(page, app_server):
    load(page, app_server)
    page.get_by_role("tab", name="Must haves").click()
    menu_action(page, "rename")
    dialog_submit(page, name="Priorities")
    assert tab_names(page) == ["All Tasks", "Priorities", "Kev's work"]
    assert selected(page) == "Priorities"
    assert 'name: "Priorities"\n    filter: "label:must -status:Complete"' in plan_text(page)
    assert cards(page) == ["Login API"]


def test_edit_view_changes_name_and_filter(page, app_server):
    load(page, app_server)
    page.get_by_role("tab", name="Kev's work").click()
    menu_action(page, "edit")
    dialog_submit(page, name="Jen's work", filter="resource:jen")
    assert selected(page) == "Jen's work"
    assert cards(page) == ["Login API", "Settings page"]
    assert page.locator("#kanbanFilterInput").input_value() == "resource:jen"
    assert 'name: "Jen\'s work"\n    filter: "resource:jen"' in plan_text(page)


def test_edit_view_rejects_an_invalid_filter(page, app_server):
    load(page, app_server)
    page.get_by_role("tab", name="Must haves").click()
    menu_action(page, "edit")
    dialog_submit(page, name="Must haves", filter="bogus:thing")
    assert page.locator(".kanban-view-dialog-error").is_visible()
    assert page.locator("dialog.kanban-view-dialog").count() == 1


def test_move_view_left_and_right(page, app_server):
    load(page, app_server)
    page.get_by_role("tab", name="Must haves").click()
    menu = open_menu(page)
    assert menu.locator("[data-action=move-left]").get_attribute("aria-disabled") == "true"
    assert menu.locator("[data-action=move-right]").get_attribute("aria-disabled") is None
    menu.locator("[data-action=move-right]").click()
    assert tab_names(page) == ["All Tasks", "Kev's work", "Must haves"]
    assert selected(page) == "Must haves"
    assert plan_text(page).index("Kev's work") < plan_text(page).index("Must haves")
    menu = open_menu(page)
    assert menu.locator("[data-action=move-right]").get_attribute("aria-disabled") == "true"
    menu.locator("[data-action=move-left]").click()
    assert tab_names(page) == ["All Tasks", "Must haves", "Kev's work"]


def test_remove_view(page, app_server):
    load(page, app_server)
    page.get_by_role("tab", name="Must haves").click()
    page.once("dialog", lambda d: d.dismiss())
    menu_action(page, "remove")
    assert tab_names(page) == ["All Tasks", "Must haves", "Kev's work"]
    page.once("dialog", lambda d: d.accept())
    menu_action(page, "remove")
    assert tab_names(page) == ["All Tasks", "Kev's work"]
    assert selected(page) == "All Tasks"
    assert len(cards(page)) == 4
    assert "Must haves" not in plan_text(page) and "Kev's work" in plan_text(page)
    page.once("dialog", lambda d: d.accept())
    page.get_by_role("tab", name="Kev's work").click()
    menu_action(page, "remove")
    assert "Views:" not in plan_text(page)
    assert page.locator("#kanbanViewTabs").is_hidden()


def test_menu_keyboard_and_escape(page, app_server):
    load(page, app_server)
    page.get_by_role("tab", name="Must haves").click()
    button = page.locator(".kanban-view-tab-menu-btn")
    button.focus()
    page.keyboard.press("Enter")
    menu = page.locator(".kanban-view-menu")
    assert page.evaluate("() => document.activeElement.dataset.action") == "rename"
    page.keyboard.press("ArrowDown")
    assert page.evaluate("() => document.activeElement.dataset.action") == "edit"
    page.keyboard.press("ArrowDown")
    # move-left is disabled on the first view, so it is skipped
    assert page.evaluate("() => document.activeElement.dataset.action") == "move-right"
    page.keyboard.press("Escape")
    assert menu.count() == 0
    assert page.evaluate("() => document.activeElement.className") == "kanban-view-tab-menu-btn"


def test_hand_edited_views_block_updates_the_tabs(page, app_server):
    load(page, app_server)
    text = plan_text(page).replace("Must haves", "Edited by hand")
    set_editor_value(page, text)
    page.evaluate("() => syncKanbanFromEditor()")
    assert tab_names(page) == ["All Tasks", "Edited by hand", "Kev's work"]
