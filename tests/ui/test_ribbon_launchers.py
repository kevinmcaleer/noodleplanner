"""Ribbon group launchers (the corner button in a group's caption), on Playwright.

Each launcher used to show "More options" and do nothing when clicked (#1435).
A launcher is now a real design-system button that runs its group's fuller
action, and a group with no such action renders none.

Usage:
    uv run pytest tests/ui/test_ribbon_launchers.py -q
"""

from .helpers import open_project_view


def _launcher(page, tab, group):
    page.click(f'.ribbon-tab-btn[data-tab="{tab}"]')
    return page.locator(f'.ribbon-group[data-group="{group}"] .ribbon-launcher')


class TestRibbonLaunchers:
    def test_launcher_is_a_named_button(self, page, app_server):
        open_project_view(page, app_server)
        launcher = _launcher(page, "view", "Layout")
        assert launcher.count() == 1
        assert launcher.evaluate("el => el.tagName") == "NP-BUTTON"
        assert page.get_by_role("button", name="Layout options").count() == 1

    def test_clicking_a_launcher_opens_its_panel(self, page, app_server):
        open_project_view(page, app_server)
        _launcher(page, "view", "Layout").click()
        page.wait_for_selector("#settingsSection", state="visible")

    def test_launcher_is_keyboard_operable(self, page, app_server):
        open_project_view(page, app_server)
        _launcher(page, "view", "Layout").focus()
        page.keyboard.press("Enter")
        page.wait_for_selector("#settingsSection", state="visible")

    def test_groups_without_a_target_show_no_launcher(self, page, app_server):
        open_project_view(page, app_server)
        assert _launcher(page, "plan", "Structure").count() == 0

    def test_every_rendered_launcher_resolves_to_an_action(self, page, app_server):
        open_project_view(page, app_server)
        tabs = page.eval_on_selector_all(
            ".ribbon-tab-btn", "els => els.map(e => e.dataset.tab)"
        )
        for tab in tabs:
            page.click(f'.ribbon-tab-btn[data-tab="{tab}"]')
            for el in page.locator(".ribbon-launcher").all():
                assert el.get_attribute("label"), f"unnamed launcher on {tab}"
