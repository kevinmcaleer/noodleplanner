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

# A row parked before #1110, or hand-typed: flat Text, no `detail` snapshot.
LEGACY_PLAN = """---
title: Legacy Parking Lot Plan
---

Phase 1
  Other Task 2d

---parking lot---
| ID | Text | Date Parked |
|----|------|-------------|
| 1  | Old Idea \u2014 An old comment |  |
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


def restore_parked(page, text_substring):
    """Click Restore on the parked row whose text contains `text_substring`.

    Assumes the panel is open. The panel is a fixed overlay anchored to the
    board, so this is dispatched for the same reason the note menu is.
    """
    row = page.locator(f"{DIALOG} .wb-parking-lot-item").filter(
        has=page.locator(".wb-parking-lot-item-text", has_text=text_substring)
    )
    assert row.count() == 1, f"no single parked row matching {text_substring!r}"
    row.locator(".wb-parking-lot-item-restore").dispatch_event("click")


def close_parking_lot_panel(page):
    """Restore deliberately leaves the panel open, showing the narrowed list.

    Its overlay then physically covers the toolbar button underneath, so
    anything that reopens the panel has to close it first.
    """
    page.keyboard.press("Escape")
    page.wait_for_selector(DIALOG, state="detached")


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

    def test_each_parked_item_offers_a_restore_button(self, board):
        send_to_parking_lot(board, "Loose Idea")
        wait_for_parked(board)

        open_parking_lot_panel(board)
        assert board.locator(f"{DIALOG} .wb-parking-lot-item-restore").count() == 1


class TestParkingLotDetailAndRestore:
    """Issue #1110: sending a note to the parking lot now snapshots its exact
    title, resolved colour, and (for a checklist note) every direct child's
    name and completion state into the parked row's `detail` field, and the
    panel's "Restore" button rebuilds the note -- task, children and whiteboard
    row, colour included -- from that snapshot.
    """

    def test_checklist_note_is_parked_with_colour_and_children_in_detail(self, board):
        send_to_parking_lot(board, "Discovery")
        wait_for_parked(board, "Discovery")

        detail = board.evaluate(
            """() => {
                const items = parseParkingLotMarkdown(
                    extractParkingLotFromPlanText(
                        document.getElementById('planEditor').value));
                const item = items.find(i => i.text.startsWith('Discovery'));
                return item ? item.detail : null;
            }"""
        )
        assert detail is not None, "the parked row carries a detail snapshot"
        assert detail["title"] == "Discovery"
        assert detail["colour"].startswith("#")
        assert detail["checklist"] == [{"name": "Research", "done": True}]

    def test_restore_brings_a_freeform_note_back_with_comment_and_colour_intact(self, board):
        send_to_parking_lot(board, "Loose Idea")
        wait_for_parked(board, "Loose Idea")

        open_parking_lot_panel(board)
        restore_parked(board, "Loose Idea")
        board.wait_for_function(
            "() => document.getElementById('planEditor').value"
            "        .split('---whiteboard---')[0].includes('Loose Idea')"
        )

        outline = plan_text(board).split("---whiteboard---")[0]
        assert "Loose Idea" in outline
        assert "A stray thought worth keeping." in outline

        close_parking_lot_panel(board)
        switch_to_whiteboard(board, expected_notes=3)
        assert "Loose Idea" in note_task_names(board)

        open_parking_lot_panel(board)
        assert parking_lot_item_texts(board) == [], "the restored item left the parking lot"

    def test_restore_brings_a_checklist_note_back_with_children_and_completion_state_intact(self, board):
        send_to_parking_lot(board, "Discovery")
        wait_for_parked(board, "Discovery")

        open_parking_lot_panel(board)
        restore_parked(board, "Discovery")
        board.wait_for_function(
            "() => document.getElementById('planEditor').value"
            "        .split('---whiteboard---')[0].includes('Discovery')"
        )

        outline = plan_text(board).split("---whiteboard---")[0]
        assert "Discovery" in outline
        assert "Research" in outline
        assert "100%" in outline

        close_parking_lot_panel(board)
        switch_to_whiteboard(board, expected_notes=3)
        assert "Discovery" in note_task_names(board)

    def test_restore_is_a_single_undo_step(self, board):
        send_to_parking_lot(board, "Loose Idea")
        wait_for_parked(board, "Loose Idea")
        before_restore = plan_text(board)
        # The park's own undo entry has to land before the restore's, or the
        # two coalesce and "a single undo" is true for the wrong reason.
        board.evaluate(
            "() => EditorUndoManager.captureImmediate("
            "  document.getElementById('planEditor').value)"
        )

        open_parking_lot_panel(board)
        restore_parked(board, "Loose Idea")
        board.wait_for_function(
            "() => document.getElementById('planEditor').value"
            "        .split('---whiteboard---')[0].includes('Loose Idea')"
        )

        # The restore's own undo snapshot is debounced by 600ms, so pressing
        # undo straight away lands before it exists. Taking it outright is what
        # the debounce would have done, just deterministically -- and it does
        # not weaken the assertion: pushSnapshot() skips duplicates, so if the
        # restore had left several entries behind, one undo would land on an
        # intermediate state and this would still fail.
        board.evaluate(
            "() => EditorUndoManager.captureImmediate("
            "  document.getElementById('planEditor').value)"
        )

        board.focus("#planEditor")
        modifier = "Meta" if board.evaluate("() => navigator.platform.includes('Mac')") else "Control"
        board.keyboard.press(f"{modifier}+z")

        board.wait_for_function(
            "expected => document.getElementById('planEditor').value === expected",
            arg=before_restore,
        )
        assert plan_text(board) == before_restore, "a single undo fully reverts the restore"

    def test_restore_uniquifies_a_name_collision_instead_of_overwriting(self, board):
        send_to_parking_lot(board, "Loose Idea")
        wait_for_parked(board, "Loose Idea")

        # Something new now occupies the parked note's old name.
        # Raw string: the \n below must reach JavaScript as an escape, not as
        # an actual newline inside a single-quoted JS string.
        board.evaluate(
            r"""() => {
                const editor = document.getElementById('planEditor');
                editor.value = editor.value.replace(
                    'Phase 1\n', 'Phase 1\n  Loose Idea 1d\n');
                editor.dispatchEvent(new Event('input', {bubbles: true}));
            }"""
        )
        board.wait_for_function(
            "() => document.getElementById('planEditor').value.includes('Loose Idea 1d')"
        )

        open_parking_lot_panel(board)
        restore_parked(board, "Loose Idea")
        board.wait_for_function(
            "() => document.getElementById('planEditor').value"
            "        .split('---whiteboard---')[0].includes('Loose Idea 2')"
        )

        assert "Loose Idea 2" in plan_text(board).split("---whiteboard---")[0]

    def test_restore_of_a_legacy_item_with_no_detail_falls_back_to_splitting_its_flat_text(
        self, page, app_server
    ):
        """A row parked before #1110 (or hand-typed) has no `detail` -- Restore
        still works, by splitting its flat Text back apart on the " -- "
        separator it was joined with (see wbRestoreParkedItem()'s own doc
        comment)."""
        open_app(page, app_server)
        load_plan(page, LEGACY_PLAN)
        switch_to_whiteboard(page, expected_notes=0)

        open_parking_lot_panel(page)
        restore_parked(page, "Old Idea")
        page.wait_for_function(
            "() => document.getElementById('planEditor').value"
            "        .split('---whiteboard---')[0].includes('Old Idea')"
        )

        outline = plan_text(page).split("---whiteboard---")[0]
        assert "Old Idea" in outline
        assert "An old comment" in outline

        close_parking_lot_panel(page)
        switch_to_whiteboard(page, expected_notes=1)
        assert "Old Idea" in note_task_names(page)



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

    @pytest.mark.unstable
    def test_parked_detail_survives_a_page_reload_and_can_still_be_restored(self, page, app_server):
        """Issue #1110: the richer detail snapshot (colour, checklist)
        round-trips through a reload exactly like the flat text already did,
        and Restore still works afterwards.

        `unstable` for the same reason as the test above it -- it reloads, and
        the startup restore intermittently never completes under load. Nothing
        to do with #1110; see tests/ui/README.md.
        """
        open_app(page, app_server)
        load_plan(page, SAMPLE_PLAN, with_project="Parking Lot Detail Round Trip")
        switch_to_whiteboard(page, expected_notes=3)

        send_to_parking_lot(page, "Discovery")
        wait_for_parked(page, "Discovery")
        page.wait_for_function(
            """() => {
                const p = getCurrentProject();
                return !!p && (p.planText || '').includes('parking-lot-detail');
            }"""
        )

        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector("#planEditor", state="attached")
        page.wait_for_function(
            "() => document.getElementById('planEditor').value"
            "        .includes('---parking lot---')",
            timeout=30_000,
        )

        parked = plan_text(page).split("---parking lot---")[1]
        assert "parking-lot-detail" in parked
        assert "Research" in parked

        switch_to_whiteboard(page, expected_notes=2)
        open_parking_lot_panel(page)
        restore_parked(page, "Discovery")
        page.wait_for_function(
            "() => document.getElementById('planEditor').value"
            "        .split('---whiteboard---')[0].includes('Discovery')"
        )

        outline = plan_text(page).split("---whiteboard---")[0]
        assert "Discovery" in outline
        assert "Research" in outline
