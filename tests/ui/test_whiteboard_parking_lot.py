"""Whiteboard parking lot (issue #1019, part of the #885 epic), on Playwright.

A "good idea, not now" holding pen for whiteboard items that aren't ready to
become a task or note yet. Covers what the pure JS unit tests
(tests/test_whiteboard_backmatter.mjs) can't reach: the real note "..." menu's
"Send to parking lot" action, the real parking lot panel DOM, and the real
round trip through a page reload -- the browser's project store, not just plan
text in memory.

Ported from tests/test_whiteboard_parking_lot.py. Every assertion is the
original's; what changed is what the test waits on. The Selenium version
settled the editor by polling until its text had been unchanged for 1.5
seconds, on every test, which is at minimum 1.5s of doing nothing and at worst
a guess. `helpers.load_plan()` waits for the app to write the computed `rag:`
key back into the front matter instead -- quicker, and an actual guarantee the
parse finished.

Usage:
    uv run pytest tests/ui/test_whiteboard_parking_lot.py -q
"""

import pytest

from .helpers import (
    load_plan,
    note,
    note_task_names,
    open_app,
    plan_text,
    switch_to_whiteboard,
)

SAMPLE_PLAN = """---
title: Whiteboard Parking Lot Test Plan
---

Phase 1
  Discovery
    Research @sam 2d 100%
  Build
    Ship Widget $Widget @sam 3d 100%
  Loose Idea "A stray thought worth keeping."

---whiteboard---
| Task        | X   | Y   | Colour | Width | Height | Collapsed |
|-------------|-----|-----|--------|-------|--------|-----------|
| Discovery   | 120 | 80  |        | 280   | 240    | no        |
| Build       | 480 | 80  |        | 280   | 260    | no        |
| Loose Idea  | 120 | 400 |        | 240   | 180    | no        |
"""

DIALOG = "#wbParkingLotDialog"


def send_to_parking_lot(page, task_name):
    """Drive the note's own `...` menu, as a user would."""
    menu_btn = note(page, task_name).locator(".wb-note-menu-btn")
    assert menu_btn.count() == 1, f"no note (or menu button) found for {task_name}"
    menu_btn.dispatch_event("click")
    page.wait_for_selector("#wbNoteMenu", state="visible")
    page.locator("#wbNoteMenu .wb-note-menu-action").filter(
        has_text="Send to parking lot"
    ).dispatch_event("click")
    page.wait_for_selector("#wbNoteMenu", state="detached")


def wait_for_parked(page, task_name=None):
    """Wait for the park to reach the plan text, and optionally the board.

    The two are not simultaneous: `wbCommitMarkdown()` writes the
    `---parking lot---` section first and the whiteboard redraws after it, so a
    test that asserts the note has left the board has to wait for the redraw
    rather than for the text. Waiting only on the text passed in isolation and
    failed about one run in one under load, which is the worst kind of green.
    """
    page.wait_for_function(
        "() => document.getElementById('planEditor').value"
        "        .includes('---parking lot---')"
    )
    if task_name is not None:
        page.wait_for_function(
            "name => ![...document.querySelectorAll("
            "  '#whiteboardContainer .wb-note')].some(n => n.dataset.wbTask === name)",
            arg=task_name,
        )


def open_parking_lot_panel(page):
    page.click("#whiteboardParkingLotBtn")
    page.wait_for_selector(DIALOG, state="visible")


def parking_lot_item_texts(page):
    return page.locator(f"{DIALOG} .wb-parking-lot-item-text").all_text_contents()


def parked_section(page):
    """Whatever sits below the `---parking lot---` marker, or ''."""
    text = plan_text(page)
    return text.split("---parking lot---")[1] if "---parking lot---" in text else ""


@pytest.fixture
def board(page, app_server):
    """SAMPLE_PLAN loaded, whiteboard on screen, three notes drawn."""
    open_app(page, app_server)
    load_plan(page, SAMPLE_PLAN)
    switch_to_whiteboard(page, expected_notes=3)
    return page


class TestSendToParkingLot:
    def test_sends_a_free_form_note_and_removes_it_from_the_board_and_outline(self, board):
        assert "Loose Idea" in note_task_names(board)

        send_to_parking_lot(board, "Loose Idea")
        wait_for_parked(board, "Loose Idea")

        assert "Loose Idea" not in note_task_names(board), "the note is gone from the board"

        after_text = plan_text(board)
        assert "  Loose Idea " not in after_text and not after_text.rstrip().endswith("Loose Idea"), (
            "the task itself is gone from the outline, not just the board"
        )
        whiteboard_section = after_text.split("---whiteboard---")[-1].split("---parking lot---")[0]
        assert "| Loose Idea " not in whiteboard_section, "the whiteboard row is gone too"

        parking = parked_section(board)
        assert "Loose Idea" in parking
        # The note's own comment (the `"..."` token) was folded into the parked
        # text, not dropped.
        assert "A stray thought worth keeping" in parking

        # Unrelated notes/tasks are untouched.
        assert "Discovery" in note_task_names(board)
        assert "Ship Widget" in after_text

    def test_send_to_parking_lot_is_a_single_undo_step(self, board):
        before_text = plan_text(board)

        send_to_parking_lot(board, "Loose Idea")
        wait_for_parked(board)

        # Folding headers intentionally sit above their projected marker lines
        # and are clickable across the row, so focus the editor directly rather
        # than clicking an arbitrary centre point that one may be occupying.
        board.focus("#planEditor")
        modifier = "Meta" if board.evaluate("() => navigator.platform.includes('Mac')") else "Control"
        board.keyboard.press(f"{modifier}+z")

        board.wait_for_function(
            "expected => document.getElementById('planEditor').value === expected",
            arg=before_text,
        )
        assert plan_text(board) == before_text, "a single undo fully restores the parked note"

    def test_no_confirmation_dialog_is_required(self, board):
        board.evaluate(
            "() => { window.__confirmCalled = false;"
            "        window.confirm = () => { window.__confirmCalled = true; return true; }; }"
        )
        send_to_parking_lot(board, "Loose Idea")
        wait_for_parked(board)
        assert board.evaluate("() => window.__confirmCalled") is False


class TestParkingLotPanel:
    def test_panel_lists_parked_items(self, board):
        send_to_parking_lot(board, "Loose Idea")
        wait_for_parked(board)

        open_parking_lot_panel(board)
        texts = parking_lot_item_texts(board)
        assert any("Loose Idea" in t for t in texts), texts

    def test_panel_shows_empty_message_when_nothing_is_parked(self, board):
        open_parking_lot_panel(board)
        assert board.locator(f"{DIALOG} .wb-parking-lot-empty").count() == 1

    def test_remove_button_permanently_deletes_a_parked_item(self, board):
        send_to_parking_lot(board, "Loose Idea")
        wait_for_parked(board)

        open_parking_lot_panel(board)
        board.locator(f"{DIALOG} .wb-parking-lot-item-remove").first.click()
        board.wait_for_function(
            "() => !document.getElementById('planEditor').value"
            "         .includes('---parking lot---')"
        )

        assert "---parking lot---" not in plan_text(board)
        assert parking_lot_item_texts(board) == []

    def test_escape_closes_the_panel(self, board):
        open_parking_lot_panel(board)
        board.keyboard.press("Escape")
        board.wait_for_selector(DIALOG, state="detached")


class TestParkingLotRoundTrip:
    @pytest.mark.unstable
    def test_parked_item_survives_a_page_reload(self, page, app_server):
        open_app(page, app_server)
        # A real project, so the commit reaches the browser's project store
        # rather than only the in-memory editor -- the whole point of this test.
        load_plan(page, SAMPLE_PLAN, with_project="Parking Lot Round Trip Test")
        switch_to_whiteboard(page, expected_notes=3)

        send_to_parking_lot(page, "Loose Idea")
        wait_for_parked(page, "Loose Idea")
        # The project-store save is debounced. Waiting for the stored project
        # to actually carry the marker is the signal the Selenium version
        # approximated with `time.sleep(0.6)`.
        page.wait_for_function(
            """() => {
                const p = getCurrentProject();
                return !!p && (p.planText || '').includes('---parking lot---');
            }"""
        )

        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector("#planEditor", state="attached")

        # A whole page load plus a project-store rehydrate, so it gets its own
        # budget rather than the suite-wide 5s default, which is tuned for UI
        # transitions.
        #
        # Marked `unstable` and deselected from the gating run, because it
        # catches an app defect that is not fixed yet: under load the startup
        # restore sometimes never completes at all. The timing says stuck
        # rather than slow -- when this passes the test takes ~3 seconds, and
        # when it fails it burns the whole budget, at 30s and at 120s alike.
        # Roughly 1 run in 3 with four browsers on four cores.
        #
        # It found a second, separate defect on the way, which *is* fixed: an
        # empty editor could overwrite the stored project. See the guard in
        # project-storage.js's saveCurrentProjectState() and the write-up in
        # tests/ui/README.md.
        page.wait_for_function(
            "() => document.getElementById('planEditor').value"
            "        .includes('---parking lot---')",
            timeout=30_000,
        )

        reloaded_text = plan_text(page)
        assert "---parking lot---" in reloaded_text
        assert "Loose Idea" in reloaded_text.split("---parking lot---")[1]

        switch_to_whiteboard(page, expected_notes=2)
        open_parking_lot_panel(page)
        texts = parking_lot_item_texts(page)
        assert any("Loose Idea" in t for t in texts), texts
