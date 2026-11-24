"""Configurable dashboard widgets (#779): move, resize, hide and show widgets
in place, with a layout of its own per device (desktop, tablet, phone), saved in
the plan's `dashboard:`, `dashboard_tablet:` and `dashboard_phone:` front matter."""

import pytest

from .helpers import load_plan, open_app

pytestmark = pytest.mark.ui

PLAN = """---
title: Widgets
start: 2026-01-05
---

Design
  Research 5d
  Sign-off 0d
"""

IDS = "() => [...document.querySelectorAll('#dashboardWidgets > [data-widget-id]')].map(e => e.dataset.widgetId)"
VISIBLE = """() => [...document.querySelectorAll('#dashboardWidgets > [data-widget-id]')]
    .filter(e => getComputedStyle(e).display !== 'none').map(e => e.dataset.widgetId)"""
COLUMNS = "() => getComputedStyle(document.getElementById('dashboardWidgets')).gridTemplateColumns.split(' ').length"

DEFAULT_DESKTOP = [
    "timeline", "task_completion", "milestones", "up_next",
    "highlights", "risks", "budget", "actions",
]
DEFAULT_PHONE = [
    "milestones", "up_next", "risks", "actions",
    "highlights", "budget", "timeline", "task_completion",
]


def _open(page, app_server, plan=PLAN):
    open_app(page, app_server)
    load_plan(page, plan)
    page.evaluate("() => switchToView('project-report')")
    page.wait_for_function("() => !NavigationController.isTransitioning()")
    page.wait_for_selector("#dashboardWidgets", state="visible")


def _editor(page):
    # The textarea's visible text hides the front matter; `.value` is the whole plan.
    return page.evaluate("() => document.getElementById('planEditor').value")


def _customise(page):
    page.click("#dashboardCustomizeBtn")
    page.wait_for_selector("#dashboardWidgets[data-editing]")


def _btn(widget, act):
    return f'#dashboardWidgets > [data-widget-id="{widget}"] [data-act="{act}"]'


def _span(page, widget):
    return page.evaluate(
        "id => document.querySelector(`#dashboardWidgets > [data-widget-id=\"${id}\"]`)"
        ".style.getPropertyValue('--dashboard-w')", widget)


# ── The default, unchanged ──────────────────────────────────────────────


def test_default_dashboard_has_every_widget_in_order(page, app_server):
    _open(page, app_server)
    assert page.evaluate(IDS) == DEFAULT_DESKTOP
    assert page.evaluate(COLUMNS) == 12
    text = _editor(page)
    assert "dashboard:" not in text and "dashboard_tablet" not in text
    # nothing has a fixed height until someone sets one
    assert page.evaluate("() => document.querySelectorAll('#dashboardWidgets > [data-h]').length") == 0
    # and no edit chrome until Customise is pressed
    assert page.locator(".dashboard-edit-bar").count() == 0


# ── Editing in place on a desktop ───────────────────────────────────────


def test_customise_shows_handles_and_done_hides_them(page, app_server):
    _open(page, app_server)
    _customise(page)
    assert page.locator(".dashboard-edit-bar").count() == 8
    assert page.locator(".dashboard-resize").count() == 8
    page.click("#dashboardCustomizeBtn")  # now "Done"
    assert page.locator(".dashboard-edit-bar").count() == 0


def test_hide_add_and_reorder_persist_to_front_matter(page, app_server):
    _open(page, app_server)
    _customise(page)
    page.click(_btn("risks", "hide"))
    assert "risks" not in page.evaluate(VISIBLE)
    page.click('#dashboardTray [data-act="add"][data-widget-id="risks"]')
    assert "risks" in page.evaluate(VISIBLE)
    page.click(_btn("actions", "prev"))
    ids = page.evaluate(IDS)
    assert ids.index("actions") < ids.index("budget")
    text = _editor(page)
    assert "dashboard:\n  - {id: timeline, w: 9}" in text
    assert "dashboard_tablet" not in text


def test_width_and_height_buttons_are_the_keyboard_path(page, app_server):
    _open(page, app_server)
    _customise(page)
    page.focus(_btn("risks", "wider"))
    page.keyboard.press("Enter")
    assert _span(page, "risks") == "7"
    # focus stays on the same control so the keyboard user can keep going
    assert page.evaluate("() => document.activeElement.dataset.act") == "wider"
    page.focus(_btn("risks", "taller"))
    page.keyboard.press("Enter")
    page.keyboard.press("Enter")
    assert "- {id: risks, w: 7, h: 3}" in _editor(page)
    page.keyboard.press("Escape")
    assert page.locator(".dashboard-edit-bar").count() == 0


def test_dragging_the_corner_resizes_to_whole_columns_and_rows(page, app_server):
    _open(page, app_server)
    _customise(page)
    handle = page.locator(_btn("milestones", "resize"))
    handle.scroll_into_view_if_needed()
    box = handle.bounding_box()
    grid = page.locator("#dashboardWidgets").bounding_box()
    start_x, start_y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    page.mouse.move(start_x, start_y)
    page.mouse.down()
    # a quarter of the grid further right is three more columns on a 12-column grid
    page.mouse.move(start_x + grid["width"] / 4, start_y + 220, steps=8)
    page.mouse.up()
    entry = [l for l in _editor(page).splitlines() if "id: milestones" in l]
    assert entry, _editor(page)
    assert "w: 9" in entry[0], entry
    assert "h: 2" in entry[0] or "h: 3" in entry[0], entry
    # the widget really is that tall now (rows of the grid, not auto)
    assert page.evaluate(
        "() => document.querySelector('#dashboardWidgets > [data-widget-id=\"milestones\"]').dataset.h") in ("2", "3")


def test_dragging_the_handle_reorders(page, app_server):
    page.set_viewport_size({"width": 1280, "height": 2400})  # both widgets on screen
    _open(page, app_server)
    _customise(page)
    src = page.locator(_btn("actions", "drag")).bounding_box()
    dst = page.locator('#dashboardWidgets > [data-widget-id="milestones"]').bounding_box()
    page.mouse.move(src["x"] + 8, src["y"] + 8)
    page.mouse.down()
    page.mouse.move(dst["x"] + 40, dst["y"] + 60, steps=6)
    page.mouse.up()
    ids = page.evaluate(IDS)
    assert ids.index("actions") == ids.index("milestones") - 1


def test_layout_survives_a_reload_of_the_plan(page, app_server):
    _open(page, app_server)
    _customise(page)
    page.click(_btn("actions", "prev"))
    page.click(_btn("actions", "taller"))
    saved = _editor(page)
    ids = page.evaluate(IDS)
    load_plan(page, saved)
    assert page.evaluate(IDS) == ids
    assert _editor(page) == saved


def test_unknown_widget_ids_and_legacy_sizes(page, app_server):
    plan = PLAN.replace(
        "start: 2026-01-05\n",
        "start: 2026-01-05\ndashboard:\n  - {id: from_the_future, size: half}\n  - {id: actions, size: full}\n")
    _open(page, app_server, plan)
    assert page.evaluate(IDS)[0] == "actions"
    assert _span(page, "actions") == "12"
    assert "from_the_future" in _editor(page)


def test_reset_restores_this_devices_default(page, app_server):
    _open(page, app_server)
    _customise(page)
    page.click(_btn("actions", "prev"))
    page.click("#dashboardResetBtn")
    assert "dashboard:" not in _editor(page)
    assert page.evaluate(IDS) == DEFAULT_DESKTOP


# ── A layout per device ─────────────────────────────────────────────────


def test_a_tablet_has_six_columns_and_its_own_layout(device_page, app_server):
    tablet = device_page("tablet_portrait", layout="tablet")
    _open(tablet, app_server)
    assert tablet.evaluate("() => document.documentElement.dataset.layout") == "tablet"
    assert tablet.evaluate(COLUMNS) == 6
    assert tablet.evaluate(IDS) == DEFAULT_DESKTOP
    _customise(tablet)
    tablet.click(_btn("risks", "wider"))
    tablet.click(_btn("actions", "prev"))
    text = _editor(tablet)
    assert "dashboard_tablet:" in text and "- {id: risks, w: 4}" in text
    # the desktop layout was not touched
    assert "\ndashboard:" not in text
    # and a desktop reading the same plan gets its default order back
    desktop_ids = tablet.evaluate(
        "text => dashboardLayoutFromText(text, 'desktop').map(i => i.id)", text)
    assert desktop_ids == DEFAULT_DESKTOP


def test_each_device_keeps_its_own_arrangement(page, app_server):
    plan = PLAN.replace(
        "start: 2026-01-05\n",
        "start: 2026-01-05\ndashboard_tablet:\n  - {id: actions, w: 6}\ndashboard_phone:\n  - {id: budget, w: 1}\n")
    _open(page, app_server, plan)
    # a desktop browser shows the desktop layout (no `dashboard:` block: default)
    assert page.evaluate(IDS) == DEFAULT_DESKTOP
    # switching the layout override swaps to that device's arrangement live
    page.evaluate("() => NoodleLayout.setOverride('tablet')")
    page.wait_for_function("() => document.documentElement.dataset.layout === 'tablet'")
    assert page.evaluate(IDS)[0] == "actions"
    page.evaluate("() => NoodleLayout.setOverride('phone')")
    page.wait_for_function("() => document.documentElement.dataset.layout === 'phone'")
    assert page.evaluate(IDS)[0] == "budget"


def test_the_phone_is_one_column_with_arrows_and_a_taller_button(phone, app_server):
    _open(phone, app_server)
    assert phone.evaluate(COLUMNS) == 1
    assert phone.evaluate(IDS) == DEFAULT_PHONE
    _customise(phone)
    # no width controls or resize corner on a phone
    assert phone.locator('[data-act="wider"], [data-act="narrower"], .dashboard-resize').count() == 0
    # every control is a 44px target
    sizes = phone.evaluate(
        """() => [...document.querySelectorAll('#dashboardWidgets .dashboard-edit-btn')]
            .filter(b => !b.disabled && b.offsetParent).map(b => { const r = b.getBoundingClientRect(); return Math.min(r.width, r.height); })""")
    assert sizes and min(sizes) >= 44, sizes
    phone.click(_btn("up_next", "next"))
    phone.click(_btn("up_next", "taller"))
    text = _editor(phone)
    assert "dashboard_phone:" in text and "- {id: up_next, w: 1, h: 2}" in text
    assert "\ndashboard:" not in text and "dashboard_tablet" not in text
    # nothing scrolls sideways
    assert phone.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth")
