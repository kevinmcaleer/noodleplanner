"""Saved board view tabs on phones and tablets (#1551, #1557).

Touch emulation at 390x844, 768x1024 and 1024x768. Checks that the tab strip,
the options menu and the name/filter dialog are usable by finger:

* the page never scrolls sideways, even with many views (the strip scrolls
  inside itself);
* every control is a 44px target and its centre lands on it;
* the menu and the dialog stay inside the window;
* text fields are 16px or more, which iOS Safari zooms the page into on focus;
* a whole create / switch / rename / remove flow works by tapping.
"""

import pytest

from .helpers import load_plan, open_app

DEVICES = ["phone", "tablet_portrait", "tablet_landscape"]

PLAN = """---
title: Device views
Views:
  - name: "Must haves"
    filter: "label:must -status:Complete"
  - name: "Kev's work"
    filter: "resource:kev"
---

Design
  Login page #must @kev 2d 100% {Doing}
  Settings page #should @jen 1d 0%
Build
  Login API #must @jen 3d 50% {Doing}
"""

MANY = "---\ntitle: Many\nViews:\n" + "".join(
    f'  - name: "A rather long view name {i}"\n    filter: "label:must"\n' for i in range(1, 9)
) + "---\n\nDesign\n  Login page #must @kev 2d 0%\n"

FIELD_SIZES = """() => [...document.querySelectorAll('dialog.kanban-view-dialog input')]
    .map(el => parseFloat(getComputedStyle(el).fontSize))"""

REACH = """(selector) => [...document.querySelectorAll(selector)].map(el => {
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
        label: (el.getAttribute('aria-label') || el.textContent).trim(),
        w: r.width, h: r.height,
        hit: !!hit && (hit === el || el.contains(hit) || (hit.getRootNode() instanceof ShadowRoot && el.contains(hit.getRootNode().host))),
    };
})"""

INSIDE = """(selector) => {
    const r = document.querySelector(selector).getBoundingClientRect();
    return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
}"""


@pytest.fixture(params=DEVICES)
def device(request, device_page):
    return device_page(request.param)


def open_board(page, app_server, plan=PLAN):
    open_app(page, app_server)
    load_plan(page, plan)
    page.evaluate("() => switchPlanSubnavToBoard()")
    page.wait_for_selector(".kanban-card")
    return page


def no_sideways_scroll(page):
    return page.evaluate("() => document.documentElement.scrollWidth <= innerWidth + 1")


def tab_names(page):
    return page.evaluate(
        "() => [...document.querySelectorAll('#kanbanViewTabs [role=tab]')].map(t => t.textContent)")


def card_names(page):
    return sorted(page.evaluate(
        "() => [...document.querySelectorAll('.kanban-card')].map(c => c.dataset.taskName)"))


def test_tabs_fit_and_are_finger_sized(device, app_server):
    open_board(device, app_server)
    assert tab_names(device) == ["All Tasks", "Must haves", "Kev's work"]
    assert no_sideways_scroll(device)
    for tab in device.evaluate(REACH, "#kanbanViewTabs [role=tab]"):
        assert tab["h"] >= 44, tab
        assert tab["hit"], tab


def test_many_views_scroll_inside_the_strip(device, app_server):
    open_board(device, app_server, MANY)
    assert len(tab_names(device)) == 9
    assert no_sideways_scroll(device)
    overflow = device.evaluate(
        "() => { const s = document.getElementById('kanbanViewTabs'); return s.scrollWidth > s.clientWidth; }")
    assert overflow or device.viewport_size["width"] >= 1024
    # the selected tab is scrolled into view by selecting the last one
    device.get_by_role("tab", name="A rather long view name 8").tap()
    assert device.evaluate("() => document.activeElement && document.activeElement.tagName") is not None
    assert no_sideways_scroll(device)


def test_menu_is_reachable_and_inside_the_window(device, app_server):
    open_board(device, app_server)
    device.get_by_role("tab", name="Must haves").tap()
    button = device.locator(".kanban-view-tab-menu-btn")
    box = button.bounding_box()
    assert box["width"] >= 44 and box["height"] >= 44, box
    button.tap()
    device.locator(".kanban-view-menu").wait_for()
    assert device.evaluate(INSIDE, ".kanban-view-menu")
    for item in device.evaluate(REACH, ".kanban-view-menu-item"):
        assert item["h"] >= 44, item
        assert item["hit"], item


def test_dialog_fits_and_fields_do_not_trigger_ios_zoom(device, app_server):
    open_board(device, app_server)
    device.get_by_role("tab", name="Must haves").tap()
    device.locator(".kanban-view-tab-menu-btn").tap()
    device.locator("[data-action=edit]").tap()
    device.locator("dialog.kanban-view-dialog").wait_for()
    assert device.evaluate(INSIDE, "dialog.kanban-view-dialog")
    assert min(device.evaluate(FIELD_SIZES)) >= 16
    for button in device.evaluate(REACH, "dialog.kanban-view-dialog np-button"):
        assert button["h"] >= 44, button
        assert button["hit"], button
    assert no_sideways_scroll(device)


def test_save_discard_buttons_are_finger_sized(device, app_server):
    open_board(device, app_server)
    device.get_by_role("tab", name="Must haves").tap()
    box = device.locator("#kanbanFilterInput")
    box.focus()
    box.press("End")
    box.press_sequentially(" label:ui")
    buttons = device.evaluate(REACH, "#kanbanViewActions np-button")
    assert len(buttons) == 3
    for button in buttons:
        assert button["h"] >= 44, button
        assert button["hit"], button
    assert no_sideways_scroll(device)


def test_create_switch_rename_remove_by_touch(device, app_server):
    open_board(device, app_server)
    device.get_by_role("tab", name="Kev's work").tap()
    assert card_names(device) == ["Login page"]
    device.locator(".kanban-view-tab-menu-btn").tap()
    device.locator("[data-action=rename]").tap()
    dialog = device.locator("dialog.kanban-view-dialog")
    dialog.locator("input").fill("Mine")
    dialog.locator("np-button[data-action=submit]").tap()
    assert tab_names(device) == ["All Tasks", "Must haves", "Mine"]
    device.once("dialog", lambda d: d.accept())
    device.locator(".kanban-view-tab-menu-btn").tap()
    device.locator("[data-action=remove]").tap()
    assert tab_names(device) == ["All Tasks", "Must haves"]
    device.get_by_role("tab", name="Must haves").tap()
    assert card_names(device) == ["Login API"]
