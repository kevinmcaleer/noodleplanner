"""The ribbon on a touch tablet (#1388, epic #1376).

* With a coarse pointer every ribbon control is at least 44x44.
* A touch tablet defaults to the Simple ribbon, whose tabs fold into one
  picker on the command row, so at 768-1024px the ribbon is 130px or less.
* A display mode chosen from the ▼ menu is kept.
* At 820x1180 (an iPad Air in portrait) the view fills at least 60% of the
  first screen.
* A desktop with a mouse keeps its default.
"""

import pytest

from .helpers import load_plan, open_app

PLAN = """---
title: Tablet ribbon
---

Design
  Research @alex 2d
  Wireframes @alex 3d
"""

SMALL = """() => {
    const shell = document.getElementById('ribbonShell');
    return [...shell.querySelectorAll('button, a, input, [role="tab"]')]
        .filter(el => {
            const cs = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            return r.width && r.height && cs.visibility !== 'hidden' && cs.display !== 'none';
        })
        .map(el => ({ el: (el.getAttribute('aria-label') || el.className || el.tagName).toString().slice(0, 40),
                      w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) }))
        .filter(({ w, h }) => w < 44 || h < 44);
}"""

HEIGHT = "() => document.getElementById('ribbonShell').getBoundingClientRect().height"


def _switch(pg, view):
    pg.evaluate(f"() => switchToView({view!r})")
    pg.wait_for_function("() => !NavigationController.isTransitioning()")


@pytest.mark.parametrize("device", ["tablet_portrait", "tablet_ipad_air", "tablet_landscape"])
@pytest.mark.parametrize("view", ["tasks", "gantt", "kanban"])
def test_every_control_is_44px_and_the_ribbon_is_130px_or_less(device_page, app_server, device, view):
    pg = device_page(device)
    open_app(pg, app_server)
    load_plan(pg, PLAN)
    _switch(pg, view)
    pg.wait_for_timeout(200)  # the simple ribbon's fit pass runs a frame late
    assert pg.evaluate("() => document.getElementById('ribbonShell').dataset.mode") == "simple"
    assert pg.evaluate(SMALL) == []
    assert pg.evaluate(HEIGHT) <= 130


def test_every_control_is_44px_in_the_full_ribbon_too(device_page, app_server):
    pg = device_page("tablet_landscape")
    pg.add_init_script(
        "localStorage.setItem('noodleplanner:ribbon-state', JSON.stringify({displayMode: 'full', displayModeChosen: true}))"
    )
    open_app(pg, app_server)
    pg.wait_for_timeout(200)
    assert pg.evaluate("() => document.getElementById('ribbonShell').dataset.mode") == "full"
    assert pg.evaluate(SMALL) == []


def test_the_tab_picker_switches_tabs(tablet_portrait, app_server):
    pg = tablet_portrait
    open_app(pg, app_server)
    load_plan(pg, PLAN)
    _switch(pg, "gantt")
    pg.locator(".ribbon-tab-picker").tap()
    pg.wait_for_selector(".ribbon-tab-menu")
    labels = pg.locator(".ribbon-tab-menu .ribbon-display-menu-item").all_inner_texts()
    labels = [label.replace("✓", "").strip() for label in labels]
    assert labels == ["File", "Home", "Plan", "Track", "Resources", "Report", "View", "Gantt Tools"]
    pg.locator(".ribbon-tab-menu [data-tab-choice='__ctx']").tap()
    pg.wait_for_function(
        "() => document.querySelector('.ribbon-tab-picker-label').textContent === 'Gantt Tools'"
    )
    assert pg.locator(".ribbon-body .ribbon-simple-btn[data-label='Critical Path']").count() == 1


def test_a_chosen_display_mode_is_kept(tablet_portrait, app_server):
    pg = tablet_portrait
    open_app(pg, app_server)
    pg.locator(".ribbon-display-toggle-btn").tap()
    pg.locator(".ribbon-display-menu-item[data-display-mode='full']").tap()
    pg.wait_for_function("() => document.getElementById('ribbonShell').dataset.mode === 'full'")
    pg.reload(wait_until="domcontentloaded")
    pg.wait_for_selector(".ribbon-scope-btn", state="attached")
    pg.wait_for_function("() => document.getElementById('ribbonShell').dataset.mode === 'full'")


def test_a_narrow_tablet_s_search_button_goes_to_search(tablet_portrait, app_server):
    pg = tablet_portrait
    open_app(pg, app_server)
    pg.locator(".ribbon-search-btn").tap()
    pg.wait_for_function("() => NavigationController.getCurrentView() === 'search'")


def test_an_ipad_air_in_portrait_gives_the_view_60_percent(device_page, app_server):
    pg = device_page("tablet_ipad_air")
    open_app(pg, app_server)
    load_plan(pg, PLAN)
    _switch(pg, "tasks")
    pg.wait_for_timeout(200)
    share = pg.evaluate(
        """() => {
            const r = document.getElementById('tasks-view').getBoundingClientRect();
            const bar = document.querySelector('.status-bar').getBoundingClientRect();
            const bottom = Math.min(innerHeight, bar.top);
            const top = Math.max(0, r.top);
            return ((Math.min(r.bottom, bottom) - top) * Math.min(r.width, innerWidth)) / (innerWidth * innerHeight);
        }"""
    )
    assert share >= 0.6


def test_a_desktop_with_a_mouse_keeps_the_full_ribbon(page, app_server):
    open_app(page, app_server)
    assert page.evaluate("() => document.getElementById('ribbonShell').dataset.mode") == "full"
    assert page.evaluate("() => getComputedStyle(document.querySelector('.ribbon-tab-picker')).display") == "none"
