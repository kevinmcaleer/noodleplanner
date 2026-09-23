"""Keyboard shortcuts dialog, on Playwright.

Pressing `?` used to open two dialogs at once: an older `#keyboardShortcutsOverlay`
and the newer `#shortcutsOverlay`, each wired to its own document keydown
handler. The older one has been folded into the newer one; these tests pin that
`?` now opens exactly one "Keyboard Shortcuts" dialog, and that pressing it
again (or Escape) closes it.

Usage:
    uv run pytest tests/ui/test_keyboard_shortcuts.py -q
"""

from .helpers import open_app

# Every rendered heading that reads "Keyboard Shortcuts", reported by the id of
# the dialog it sits in -- what the user actually sees, whichever overlay drew it.
VISIBLE_SHORTCUT_DIALOGS = """() => [...document.querySelectorAll('h1, h2, h3')]
    .filter(h => h.textContent.trim() === 'Keyboard Shortcuts')
    .filter(h => h.getClientRects().length > 0
        && getComputedStyle(h).visibility !== 'hidden')
    .map(h => (h.closest('[role="dialog"]') || h).id)"""


def _press_question_mark(page):
    # Make sure the key lands on the document, not a focused editor.
    page.evaluate("document.activeElement && document.activeElement.blur()")
    page.keyboard.press("?")


class TestKeyboardShortcutsDialog:
    def test_question_mark_opens_exactly_one_dialog(self, page, app_server):
        open_app(page, app_server)
        _press_question_mark(page)
        page.wait_for_selector("#shortcutsOverlay.active", state="visible")

        dialogs = page.get_by_role("dialog", name="Keyboard shortcuts")
        assert dialogs.count() == 1
        assert page.evaluate(VISIBLE_SHORTCUT_DIALOGS) == ["shortcutsOverlay"]
        assert page.locator("#keyboardShortcutsOverlay").count() == 0

    def test_question_mark_again_closes_it(self, page, app_server):
        open_app(page, app_server)
        _press_question_mark(page)
        page.wait_for_selector("#shortcutsOverlay.active", state="visible")
        _press_question_mark(page)
        page.wait_for_selector("#shortcutsOverlay", state="hidden")
        assert page.evaluate(VISIBLE_SHORTCUT_DIALOGS) == []

    def test_escape_closes_it(self, page, app_server):
        open_app(page, app_server)
        _press_question_mark(page)
        page.wait_for_selector("#shortcutsOverlay.active", state="visible")
        page.keyboard.press("Escape")
        page.wait_for_selector("#shortcutsOverlay", state="hidden")
