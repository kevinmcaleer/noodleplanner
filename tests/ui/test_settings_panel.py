"""Settings panel regression test (issues #853, #883), on Playwright.

`style.css` defined `.settings-tab-content { display: none }` /
`.settings-tab-content.active { display: block }` but was never linked by
index.html, so every settings tab rendered simultaneously, stacked, no matter
which one had `.active`. The rules now live in components.css (which is
linked); this drives a real browser so a future refactor that moves them again
shows up here rather than as a silent regression.

Ported from tests/test_settings_panel.py. Same nine assertions, same DOM, no
Selenium: 119.6s -> 6.7s.

Usage:
    uv run pytest tests/ui/test_settings_panel.py -q
"""

import pytest

from .helpers import open_app

SETTINGS_TABS = ["gantt", "board", "timeline", "theme", "ai", "storage", "sync"]


def _visible_settings_tabs(page):
    """Which settingsTab-* panes currently compute to something other than none."""
    return page.evaluate(
        """() => [...document.querySelectorAll('.settings-tab-content')]
            .filter(el => getComputedStyle(el).display !== 'none')
            .map(el => el.id)"""
    )


class TestSettingsPanelTabs:
    def test_only_the_default_tab_is_visible_on_open(self, page, app_server):
        open_app(page, app_server)
        page.evaluate("openSettingsPanel();")
        visible = _visible_settings_tabs(page)
        assert visible == ["settingsTab-gantt"], (
            f"expected only the Gantt tab visible, got {visible}"
        )

    @pytest.mark.parametrize("tab", SETTINGS_TABS)
    def test_switching_tabs_shows_exactly_one_pane(self, page, app_server, tab):
        open_app(page, app_server)
        page.evaluate("openSettingsPanel();")
        page.evaluate(f"switchSettingsTab('{tab}');")
        visible = _visible_settings_tabs(page)
        assert visible == [f"settingsTab-{tab}"], (
            f"switching to {tab!r} should show only its pane, got {visible}"
        )

    def test_active_tab_button_has_the_accent_underline(self, page, app_server):
        open_app(page, app_server)
        page.evaluate("openSettingsPanel();")
        page.evaluate("switchSettingsTab('theme');")
        button = page.locator('.settings-tab-btn[data-tab="theme"]')
        assert "active" in (button.get_attribute("class") or "").split()
        border_width = button.evaluate(
            "el => getComputedStyle(el).borderBottomWidth"
        )
        assert border_width != "0px", "the active tab should have a visible underline"
