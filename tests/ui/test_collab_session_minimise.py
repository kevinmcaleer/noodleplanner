"""Minimising the host's planning-session dialog (#1339), on Playwright.

The dialog is the only place the host can read the six-digit code and end
the session. Closing it used to leave no way back: the ribbon's planning
session button started a *new* session, dropping every joiner. Now the
dialog minimises into the status-bar chat bubble, and that same button
restores the live session's dialog, code unchanged.

Usage:
    uv run pytest tests/ui/test_collab_session_minimise.py -q
"""

from tests.ui.helpers import open_app

QUICK_BTN = '.ribbon-quick-btn[data-quick="Start planning session"]'


def start_session(page, app_server):
    open_app(page, app_server)
    page.click(QUICK_BTN)
    page.wait_for_selector("#collabSessionOverlay.active")
    page.wait_for_selector("#collabChatWrap:not([hidden])", state="attached")
    page.wait_for_function("() => document.getElementById('collabSessionCode').value.length === 6")
    page.wait_for_function("() => collabSocket && collabSocket.readyState === WebSocket.OPEN")
    return page.input_value("#collabSessionCode")


def wait_minimised(page):
    page.wait_for_selector("#collabSessionOverlay", state="hidden")


class TestMinimiseSessionDialog:
    def test_minimise_keeps_the_session_and_collaborate_restores_it(self, page, app_server):
        code = start_session(page, app_server)
        session_id = page.evaluate("collabSessionId")

        page.click("#collabSessionMinimise")
        wait_minimised(page)
        assert page.evaluate("collabSocket.readyState === WebSocket.OPEN")
        assert page.is_visible("#collabChatBtn")
        # Focus follows the dialog into its new home.
        assert page.evaluate("document.activeElement.id") == "collabChatBtn"
        assert page.get_attribute(QUICK_BTN, "aria-label") == "Show planning session"

        page.click(QUICK_BTN)
        page.wait_for_selector("#collabSessionOverlay.active")
        page.wait_for_function("() => !collabDialogAnimation")
        assert page.input_value("#collabSessionCode") == code
        assert page.evaluate("collabSessionId") == session_id
        assert page.evaluate("collabSocket.readyState === WebSocket.OPEN")
        assert page.is_visible("text=End session")
        # The main app pulls fonts/icons from CDNs a sandboxed runner may
        # block; only script errors are this feature's to answer for.
        assert [e for e in page.console_errors if "Failed to load resource" not in e] == []

    def test_closing_a_live_session_dialog_minimises_it(self, page, app_server):
        code = start_session(page, app_server)
        page.click("#collabSessionOverlay np-close-button:not(#collabSessionMinimise)")
        wait_minimised(page)
        assert page.evaluate("collabSocket.readyState === WebSocket.OPEN")

        page.click(QUICK_BTN)
        page.wait_for_selector("#collabSessionOverlay.active")
        assert page.input_value("#collabSessionCode") == code

    def test_after_end_session_collaborate_starts_a_new_session(self, page, app_server):
        start_session(page, app_server)
        first_id = page.evaluate("collabSessionId")
        page.click("text=End session")
        page.wait_for_function("() => collabSocket === null")
        page.wait_for_selector("#collabChatWrap[hidden]", state="attached")
        assert page.get_attribute(QUICK_BTN, "aria-label") == "Start planning session"

        page.click("#collabSessionOverlay np-close-button:not(#collabSessionMinimise)")
        page.wait_for_selector("#collabSessionOverlay", state="hidden")
        start_session(page, app_server)
        assert page.evaluate("collabSessionId") != first_id
