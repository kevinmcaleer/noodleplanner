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
