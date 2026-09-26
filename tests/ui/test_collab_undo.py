"""Undo and redo for a planning-session joiner.

A joiner's Undo takes back only their own last edit, on top of the plan as it
is now -- the host's and other joiners' changes, made before or since, stay.
It is sent to the host like any other board edit, so every board follows.

Usage:
    uv run pytest tests/ui/test_collab_undo.py -q -m ui
"""

from .helpers import actionable_console_errors
from .test_collab_whiteboard import (  # noqa: F401 -- fixtures
    board_note,
    host,
    host_plan,
    joiner,
    joiner_plan,
    set_host_plan,
)


def add_note(joiner_page, name):
    joiner_page.click("#whiteboardNewNoteBtn")
    joiner_page.locator(".wb-note-title.editing").wait_for()
    joiner_page.keyboard.type(name)
    joiner_page.keyboard.press("Enter")
    board_note(joiner_page, name).wait_for()


def host_has(host_page, text, present=True):
    host_page.wait_for_function(
        "([t, want]) => document.getElementById('planEditor').value.includes(t) === want",
        arg=[text, present],
    )


def blur(page):
    page.evaluate("() => document.activeElement && document.activeElement.blur()")


class TestJoinerUndo:
    def test_nothing_to_undo_on_joining(self, joiner):
        assert joiner.locator("#undoBtn").is_disabled()
        assert joiner.locator("#redoBtn").is_disabled()

    def test_undo_and_redo_a_new_note(self, joiner, host):
        host_page, _ = host
        add_note(joiner, "Gamma")
        host_has(host_page, "Gamma")
        assert joiner.locator("#undoBtn").is_enabled()

        joiner.click("#undoBtn")
        host_has(host_page, "Gamma", present=False)
        board_note(joiner, "Gamma").wait_for(state="detached")
        assert joiner.locator("#redoBtn").is_enabled()

        joiner.click("#redoBtn")
        host_has(host_page, "Gamma")
        board_note(joiner, "Gamma").wait_for()
        assert actionable_console_errors(joiner) == []

    def test_undo_keeps_the_hosts_later_edit(self, joiner, host):
        host_page, _ = host
        add_note(joiner, "Gamma")
        host_has(host_page, "Gamma")
        set_host_plan(host_page, host_plan(host_page).replace("  Alpha two", "  Alpha second"))
        joiner.wait_for_function(
            "() => document.getElementById('planEditor').value.includes('Alpha second')"
        )

        blur(joiner)
        joiner.keyboard.press("Control+z")
        host_has(host_page, "Gamma", present=False)
        assert "Alpha second" in host_plan(host_page)
        assert "Alpha second" in joiner_plan(joiner)

        joiner.keyboard.press("Control+Shift+z")
        host_has(host_page, "Gamma")
        assert "Alpha second" in host_plan(host_page)

    def test_ctrl_z_in_the_chat_box_is_the_text_boxs_own(self, joiner, host):
        host_page, _ = host
        add_note(joiner, "Gamma")
        host_has(host_page, "Gamma")
        joiner.click("#relayInput")
        joiner.keyboard.type("hello")
        joiner.keyboard.press("Control+z")
        joiner.wait_for_timeout(500)
        assert "Gamma" in host_plan(host_page)
        assert joiner.locator("#undoBtn").is_enabled()
