"""Shared page helpers for the Playwright UI suite.

The Selenium files each carried their own near-identical copy of these; there
is one copy here because there is one suite.
"""


def open_app(page, app_server):
    """Load the app and wait until its scripts have wired themselves up.

    The Selenium equivalent was `browser.get(url)` followed by `time.sleep(0.3)`
    and a hope. Waiting on a real signal -- the ribbon being present -- is both
    faster (it returns as soon as the app is ready) and stabler (it cannot
    return before it).
    """
    page.goto(app_server, wait_until="domcontentloaded")
    page.wait_for_selector(".ribbon-scope-btn", state="attached")
    return page


def click_scope(page, scope):
    """Switch the ribbon between the `project` and `portfolio` scopes."""
    page.click(f'.ribbon-scope-btn[data-scope="{scope}"]')


def open_project_view(page, app_server):
    open_app(page, app_server)
    click_scope(page, "project")
    return page


def open_portfolio_view(page, app_server):
    open_app(page, app_server)
    click_scope(page, "portfolio")
    return page


def set_editor_value(page, text):
    """Put `text` in the plan editor and fire the events the app listens for."""
    page.eval_on_selector(
        "#planEditor",
        """(editor, value) => {
            editor.focus();
            editor.value = value;
            editor.dispatchEvent(new Event('input', { bubbles: true }));
            editor.dispatchEvent(new Event('change', { bubbles: true }));
        }""",
        text,
    )
    return page.locator("#planEditor")


def css_token(page, name):
    """Read a custom property off :root."""
    return page.evaluate(
        "name => getComputedStyle(document.documentElement)"
        "  .getPropertyValue(name).trim()",
        name,
    )
