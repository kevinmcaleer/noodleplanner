"""Keyboard shortcuts dialog and Alt shortcuts, on Playwright.

Pressing `?` used to open two dialogs at once: an older `#keyboardShortcutsOverlay`
and the newer `#shortcutsOverlay`, each wired to its own document keydown
handler. The older one has been folded into the newer one; these tests pin that
`?` now opens exactly one "Keyboard Shortcuts" dialog, and that pressing it
again (or Escape) closes it.

A field inside a component's shadow root -- the task form's editable title in
<np-panel-header>, <np-quick-add>'s input -- reaches the document's key handlers
retargeted to the component, which is not itself editable. Typing "What next?"
there used to open this dialog and drop the "?", and a word with "gt" or "gg" in
it ("length", "suggest") switched views; the last class pins that it doesn't.

Usage:
    uv run pytest tests/ui/test_keyboard_shortcuts.py -q
"""

from .helpers import load_plan, open_app

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


PLAN = """---
title: Shortcuts
---

Design
  Research 2d
"""

TITLE = "#taskFormPanelHeader .title"

# Record the calls the shortcuts would make instead of making them, as above.
STUB_SHORTCUT_TARGETS = """() => {
    window.__calls = [];
    const record = name => (...args) => { window.__calls.push([name, ...args]); };
    for (const name of ['switchToView', 'switchPlanSubnavToBoard', 'addNewTaskViaShortcut',
                        'openRaidFormWithType', 'openResourceForm']) {
        window[name] = record(name);
    }
}"""


def _type_in_the_task_title(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    page.evaluate(
        "() => { const m = NoodlePlanModel.modelForEditor(document.getElementById('planEditor'));"
        " openTaskForm(m.lineNumber(m.tasks.find(t => t.name === 'Research'))); }"
    )
    page.wait_for_selector("#taskFormSection.active")
    page.evaluate(STUB_SHORTCUT_TARGETS)
    title = page.locator(TITLE)
    title.click()
    page.keyboard.press("ControlOrMeta+A")
    return title


def _shortcuts_overlay_open(page):
    return page.evaluate(
        "() => !!document.getElementById('shortcutsOverlay')?.classList.contains('active')"
    )


class TestTypingInsideAShadowRoot:
    def test_a_question_mark_types_into_the_task_title(self, page, app_server):
        title = _type_in_the_task_title(page, app_server)
        page.keyboard.type("What next?")

        assert title.inner_text() == "What next?"
        assert not _shortcuts_overlay_open(page)

    def test_go_keys_type_into_the_task_title(self, page, app_server):
        # g then d/t/g/c/b/l are the go-to-view shortcuts.
        title = _type_in_the_task_title(page, app_server)
        page.keyboard.type("Length suggest ugly egg")

        assert title.inner_text() == "Length suggest ugly egg"
        assert page.evaluate("() => window.__calls") == []

    def test_an_alt_shortcut_leaves_the_task_title_alone(self, page, app_server):
        _type_in_the_task_title(page, app_server)
        page.keyboard.press("Alt+t")

        assert page.evaluate("() => window.__calls") == []

    def test_a_question_mark_types_into_a_quick_add(self, page, app_server):
        open_app(page, app_server)
        page.evaluate(
            "() => { const q = document.createElement('np-quick-add'); q.id = 'probeQuickAdd';"
            " document.body.appendChild(q); }"
        )
        field = page.locator("#probeQuickAdd input")
        field.focus()  # appended at the foot of the page, under the status bar
        page.keyboard.type("Why?")

        assert field.input_value() == "Why?"
        assert not _shortcuts_overlay_open(page)

    def test_a_question_mark_on_the_page_still_opens_the_dialog(self, page, app_server):
        _type_in_the_task_title(page, app_server)
        _press_question_mark(page)

        page.wait_for_selector("#shortcutsOverlay.active", state="visible")
