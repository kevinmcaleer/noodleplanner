"""Keyboard shortcuts dialog and Alt shortcuts, on Playwright.

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


# Replace the functions the Alt shortcuts call with recorders, then fire a
# synthetic keydown on the document and report what was called. Global
# function declarations are writable window properties, and the handler looks
# them up by name at call time, so the stubs are what it reaches.
FIRE_ALT_SHORTCUT = """([key, code, shift]) => {
    const calls = [];
    const record = name => (...args) => { calls.push([name, ...args]); };
    for (const name of ['switchToView', 'switchTab', 'showCreateProjectDialog',
                        'addNewTaskViaShortcut', 'openRaidFormWithType',
                        'exportFile', 'openResourceForm', 'exportPortfolioReport']) {
        window[name] = record(name);
    }
    document.activeElement && document.activeElement.blur();
    document.body.dispatchEvent(new KeyboardEvent('keydown', {
        key, code, altKey: true, shiftKey: shift, bubbles: true, cancelable: true,
    }));
    return calls;
}"""


class TestAltShortcutsOnMac:
    """On macOS, Option+letter reports a different `key` ('∂' for Option+D, a
    dead key for Option+E), so the Alt shortcuts have to fall back to `code`.
    """

    def _fire(self, page, key, code, shift=False):
        return page.evaluate(FIRE_ALT_SHORTCUT, [key, code, shift])

    def test_option_d_goes_to_the_dashboard(self, page, app_server):
        open_app(page, app_server)
        assert self._fire(page, "∂", "KeyD") == [["switchToView", "project-report"]]

    def test_option_e_dead_key_exports_to_excel(self, page, app_server):
        open_app(page, app_server)
        assert self._fire(page, "Dead", "KeyE") == [["exportFile", "excel", "editor"]]

    def test_option_shift_r_opens_a_new_resource(self, page, app_server):
        open_app(page, app_server)
        assert self._fire(page, "‰", "KeyR", shift=True) == [["openResourceForm"]]

    def test_plain_alt_letter_still_works(self, page, app_server):
        open_app(page, app_server)
        assert self._fire(page, "t", "KeyT") == [["addNewTaskViaShortcut"]]
        assert self._fire(page, "R", "KeyR", shift=True) == [["openResourceForm"]]

    def test_the_printed_letter_wins_over_the_physical_key(self, page, app_server):
        # A non-QWERTY layout: the key in the QWERTY "N" position types "b".
        # The shortcut follows the letter the user sees, not the position.
        open_app(page, app_server)
        assert self._fire(page, "b", "KeyN") == [["switchToView", "benefits"]]
