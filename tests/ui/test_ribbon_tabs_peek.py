"""Just Tabs ribbon: a tab click floats the full ribbon over the page.

Like Office's collapsed ribbon, the body appears over the page (no layout
shift) and goes away again after a command, an outside click or Escape.

Usage:
    uv run pytest tests/ui/test_ribbon_tabs_peek.py -q
"""

from .helpers import open_project_view

BODY = "#ribbonShell .ribbon-body"


def _tabs_only(page):
    page.click(".ribbon-display-toggle-btn")
    page.click('.ribbon-display-menu-item[data-display-mode="tabs"]')
    page.wait_for_selector(BODY, state="hidden")


def _body_visible(page):
    return page.locator(BODY).is_visible()


class TestRibbonTabsPeek:
    def test_tab_click_floats_ribbon_over_page(self, page, app_server):
        open_project_view(page, app_server)
        _tabs_only(page)
        top = page.evaluate("document.querySelector('.editor-layout, #editor-tab').getBoundingClientRect().top")
        page.click('.ribbon-tab-btn[data-tab="plan"]')
        page.wait_for_selector(BODY, state="visible")
        assert page.evaluate(f"getComputedStyle(document.querySelector('{BODY}')).position") == "absolute"
        after = page.evaluate("document.querySelector('.editor-layout, #editor-tab').getBoundingClientRect().top")
        assert after == top, "the page must not shift while the ribbon floats"

    def test_second_click_on_open_tab_closes_it(self, page, app_server):
        open_project_view(page, app_server)
        _tabs_only(page)
        page.click('.ribbon-tab-btn[data-tab="plan"]')
        page.wait_for_selector(BODY, state="visible")
        page.click('.ribbon-tab-btn[data-tab="plan"]')
        page.wait_for_selector(BODY, state="hidden")

    def test_escape_closes_it(self, page, app_server):
        open_project_view(page, app_server)
        _tabs_only(page)
        page.click('.ribbon-tab-btn[data-tab="plan"]')
        page.wait_for_selector(BODY, state="visible")
        page.keyboard.press("Escape")
        page.wait_for_selector(BODY, state="hidden")

    def test_outside_click_closes_it(self, page, app_server):
        open_project_view(page, app_server)
        _tabs_only(page)
        page.click('.ribbon-tab-btn[data-tab="plan"]')
        page.wait_for_selector(BODY, state="visible")
        page.mouse.click(600, 600)
        page.wait_for_selector(BODY, state="hidden")

    def test_choosing_a_command_closes_it(self, page, app_server):
        open_project_view(page, app_server)
        _tabs_only(page)
        page.click('.ribbon-tab-btn[data-tab="view"]')
        page.wait_for_selector(BODY, state="visible")
        page.locator(f"{BODY} .ribbon-lg-btn, {BODY} .ribbon-sm-btn").first.click()
        page.wait_for_selector(BODY, state="hidden")

    def test_full_mode_is_unaffected(self, page, app_server):
        open_project_view(page, app_server)
        page.click(".ribbon-display-toggle-btn")
        page.click('.ribbon-display-menu-item[data-display-mode="full"]')
        page.click('.ribbon-tab-btn[data-tab="plan"]')
        assert _body_visible(page)
        assert page.evaluate(f"getComputedStyle(document.querySelector('{BODY}')).position") != "absolute"
