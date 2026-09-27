"""The layout mode in a real browser (#1379).

tests/test_layout_mode.mjs covers the helper's logic against a stub
matchMedia. These check what only a browser can: that the attribute is there
before the app's own scripts run, that the device fixtures really produce a
coarse pointer, and that Settings -> Layout drives the override.
"""

from .helpers import open_app


def test_a_phone_is_a_phone_with_a_coarse_pointer(phone, app_server):
    open_app(phone, app_server)
    root = phone.evaluate(
        "() => ({ layout: document.documentElement.dataset.layout,"
        "  pointer: document.documentElement.dataset.pointer,"
        "  hoverNone: matchMedia('(hover: none)').matches })"
    )
    assert root == {"layout": "phone", "pointer": "coarse", "hoverNone": True}


def test_tablets_are_tablets(tablet_portrait, tablet_landscape, app_server):
    for pg in (tablet_portrait, tablet_landscape):
        open_app(pg, app_server)
        assert pg.evaluate("() => document.documentElement.dataset.layout") == "tablet"


def test_a_desktop_is_a_desktop(page, app_server):
    open_app(page, app_server)
    assert page.evaluate("() => document.documentElement.dataset.layout") == "desktop"
    assert page.evaluate("() => document.documentElement.dataset.pointer") == "fine"


def test_the_layout_is_set_before_the_body_is_parsed(page, app_server):
    # An inline script at the top of <body> sees the attribute already there,
    # which is what keeps the first paint from flashing the wrong layout.
    page.add_init_script(
        """document.addEventListener('readystatechange', () => {
            if (!window.__layoutAtBody && document.body) {
                window.__layoutAtBody = document.documentElement.dataset.layout || 'unset';
            }
        });"""
    )
    open_app(page, app_server)
    assert page.evaluate("() => window.__layoutAtBody") == "desktop"


def test_a_forced_layout_wins_over_the_width(device_page, app_server):
    pg = device_page("tablet_landscape", layout="desktop")
    open_app(pg, app_server)
    assert pg.evaluate("() => document.documentElement.dataset.layout") == "desktop"


def test_settings_layout_sets_the_override_and_fires_layoutchange(page, app_server):
    open_app(page, app_server)
    page.evaluate(
        "() => { window.__changes = [];"
        "  document.addEventListener('layoutchange', e => window.__changes.push(e.detail.layout)); }"
    )
    page.evaluate("() => openSettingsPanel('layout')")
    auto = page.locator('input[name="settingsLayout"][value="auto"]')
    assert auto.is_checked()

    page.locator('input[name="settingsLayout"][value="tablet"]').check()
    assert page.evaluate("() => document.documentElement.dataset.layout") == "tablet"
    assert page.evaluate("() => localStorage.getItem('np-layout')") == "tablet"
    assert page.evaluate("() => window.__changes") == ["tablet"]

    # It is not plan text.
    assert "tablet" not in page.evaluate("() => document.getElementById('planEditor').value")

    page.locator('input[name="settingsLayout"][value="auto"]').check()
    assert page.evaluate("() => document.documentElement.dataset.layout") == "desktop"
    assert page.evaluate("() => localStorage.getItem('np-layout')") is None


def test_resizing_across_a_breakpoint_changes_the_layout(page, app_server):
    open_app(page, app_server)
    page.set_viewport_size({"width": 820, "height": 900})
    page.wait_for_function("() => document.documentElement.dataset.layout === 'tablet'")
    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_function("() => document.documentElement.dataset.layout === 'phone'")
