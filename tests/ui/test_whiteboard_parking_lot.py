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

Issue #1201 turned the panel from a centred modal into a non-modal slide-out
panel docked to the board's right edge, and added drag-and-drop: a note
dragged onto the open panel parks it, a parked row dragged out onto the board
restores it at the drop point, and dragging one row onto another reorders the
list. `TestParkingLotPanel` and `TestParkingLotDetailAndRestore` below are
the pre-#1201 suite, updated only for the renamed/non-modal panel DOM (see
`DIALOG` and `open_parking_lot_panel()`); `TestParkingLotDragAndDrop` is new.

Usage:
    uv run pytest tests/ui/test_whiteboard_parking_lot.py -q
"""

import re

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

DIALOG = "#wbParkingLotPanel"


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


# The `board` page carries a 5s default timeout (tests/ui/conftest.py), which
# is sized for "is this element on screen". A park is a whole commit-and-redraw
# cycle, so it gets its own, longer one.
#
# This was first raised to chase a `test_dragging_a_note_onto_the_open_panel_parks_it`
# failure, on the reasoning that the drop must have registered and only the
# commit was slow. That reasoning was wrong, and the longer timeout did not fix
# it: the drop had not registered at all. `.wb-note-header`'s gap and padding
# had been rounded onto the 4px spacing scale, which walked the header's button
# row ~2px left until `.wb-note-link-handle` sat under the header's own
# midpoint -- the exact point `drag_note_to_panel()` grabs. Mousedown started a
# *link* drag, `wbFinishDrag()`'s park branch requires `drag.type === 'move'`,
# and so nothing was ever parked. The fix is in views/whiteboard.css, where
# those two values are now marked as off-scale on purpose.
#
# The longer timeout stays because the load argument is independently true and
# waiting costs nothing when the app is working. It is not what makes this
# test pass.
PARK_COMMIT_TIMEOUT_MS = 15_000


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
        "        .includes('---parking lot---')",
        timeout=PARK_COMMIT_TIMEOUT_MS,
    )
    if task_name is not None:
        page.wait_for_function(
            "name => ![...document.querySelectorAll("
            "  '#whiteboardContainer .wb-note')].some(n => n.dataset.wbTask === name)",
            arg=task_name,
            timeout=PARK_COMMIT_TIMEOUT_MS,
        )


def open_parking_lot_panel(page):
    page.click("#whiteboardParkingLotBtn")
    page.wait_for_selector(DIALOG, state="visible")
    # The panel slides in over ~200ms (views/whiteboard.css's
    # .wb-parking-lot-panel transition) rather than appearing instantly --
    # wait for it to actually land at its docked position (not a fixed
    # sleep) so a drag/drop test's first pointer move targets the panel's
    # *final* rect, not one still mid-transition.
    # .wb-parking-lot-panel is `right: 12px` within its positioning parent
    # (#whiteboardContainer), which is usually narrower than the window
    # itself (the editor/outline chrome takes the rest) -- compare against
    # the container's own edge, not window.innerWidth.
    page.wait_for_function(
        "() => { const p = document.getElementById('wbParkingLotPanel');"
        "        const c = document.getElementById('whiteboardContainer');"
        "        if (!p || !c || !p.classList.contains('open')) return false;"
        "        const pr = p.getBoundingClientRect();"
        "        const cr = c.getBoundingClientRect();"
        "        return pr.width > 0 && Math.abs(pr.right - (cr.right - 12)) < 2; }"
    )


def restore_parked(page, text_substring):
    """Click Restore on the parked row whose text contains `text_substring`.

    Assumes the panel is open. Dispatched for the same reason the note menu
    is: the row itself is drag-enabled (issue #1201), and drag-armed
    elements are otherwise finicky for Playwright's own actionability
    checks to click through reliably.
    """
    row = page.locator(f"{DIALOG} .wb-parking-lot-item").filter(
        has=page.locator(".wb-parking-lot-item-text", has_text=text_substring)
    )
    assert row.count() == 1, f"no single parked row matching {text_substring!r}"
    row.locator(".wb-parking-lot-item-restore").dispatch_event("click")


def close_parking_lot_panel(page):
    """Restore deliberately leaves the panel open, showing the narrowed list.

    Docked over the board's top-right corner, close to the toolbar the
    button sits in, so anything that reopens the panel closes it first
    rather than assuming the button is still free to click.
    """
    page.keyboard.press("Escape")
    page.wait_for_selector(DIALOG, state="detached")


def parking_lot_item_texts(page):
    return page.locator(f"{DIALOG} .wb-parking-lot-item-text").all_text_contents()


def parked_section(page):
    """Whatever sits below the `---parking lot---` marker, or ''."""
    text = plan_text(page)
    return text.split("---parking lot---")[1] if "---parking lot---" in text else ""


def drag_note_to_panel(page, task_name):
    """Mouse-drag `task_name`'s note header onto the open parking lot panel --
    the board's own custom mouse-drag machinery (not native HTML5 DnD; see
    wbNoteHeaderMouseDown()/wbFinishDrag() in whiteboard-notes.js), the same
    gesture a board reposition uses. Assumes the panel is already open.
    """
    header_box = note(page, task_name).locator(".wb-note-header").bounding_box()
    panel_box = page.locator(DIALOG).bounding_box()
    assert header_box and panel_box, "note header or panel not on screen"

    start_x = header_box["x"] + header_box["width"] / 2
    start_y = header_box["y"] + header_box["height"] / 2
    end_x = panel_box["x"] + panel_box["width"] / 2
    end_y = panel_box["y"] + panel_box["height"] / 2

    page.mouse.move(start_x, start_y)
    page.mouse.down()
    steps = 10
    for i in range(1, steps + 1):
        page.mouse.move(
            start_x + (end_x - start_x) * i / steps,
            start_y + (end_y - start_y) * i / steps,
        )
    page.mouse.up()


def dispatch_html5_drag(page, source_selector, target_selector, client_x=None, client_y=None):
    """Simulate a native HTML5 drag from `source_selector` to
    `target_selector` by constructing real DragEvents with a DataTransfer,
    rather than Playwright's mouse-based drag_to() -- Chromium's own OS-level
    drag-gesture recognition that drag_to() relies on does not reliably
    trigger custom dragover/drop handlers under headless CDP, where this
    (dispatching the same events the browser would, directly) does.

    `client_x`/`client_y`, when given, override the drop point -- used to
    land above/below a parking lot row's midpoint (its before/after reorder
    indicator) or at a specific point on the board (a restore's drop point).
    Defaults to the target's own centre.
    """
    page.evaluate(
        """({source, target, clientX, clientY}) => {
            const src = document.querySelector(source);
            const tgt = document.querySelector(target);
            const dt = new DataTransfer();
            const sRect = src.getBoundingClientRect();
            const tRect = tgt.getBoundingClientRect();
            const x = (clientX == null) ? (tRect.left + tRect.width / 2) : clientX;
            const y = (clientY == null) ? (tRect.top + tRect.height / 2) : clientY;
            const fire = (el, type, cx, cy) => el.dispatchEvent(new DragEvent(type, {
                bubbles: true, cancelable: true, dataTransfer: dt, clientX: cx, clientY: cy,
            }));
            fire(src, 'dragstart', sRect.left + 5, sRect.top + 5);
            fire(tgt, 'dragenter', x, y);
            fire(tgt, 'dragover', x, y);
            fire(tgt, 'drop', x, y);
            fire(src, 'dragend', x, y);
        }""",
        {"source": source_selector, "target": target_selector, "clientX": client_x, "clientY": client_y},
    )


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

    def test_panel_is_non_modal_the_board_stays_interactive_underneath(self, board):
        """Issue #1201: the panel is no longer a modal dialog -- there is no
        full-screen backdrop, and a note behind it is still clickable."""
        open_parking_lot_panel(board)

        assert board.locator(f"{DIALOG}").get_attribute("aria-modal") is None
        assert board.locator("#wbParkingLotOverlay").count() == 0

        # A note not underneath the (top-right-docked) panel -- Discovery is
        # the leftmost note in SAMPLE_PLAN's layout -- is still reachable:
        # raising it to front via a plain click still works.
        note(board, "Discovery").locator(".wb-note-header").click()
        board.wait_for_function(
            "() => { const n = document.querySelector("
            "  '#whiteboardContainer .wb-note[data-wb-task=\"Discovery\"]');"
            "  return !!n && n.parentElement.lastElementChild === n; }"
        )

    def test_toggle_button_closes_an_already_open_panel(self, board):
        """Issue #1201: the toolbar button now toggles -- a second click
        closes the panel instead of leaving a no-op modal-reopen."""
        open_parking_lot_panel(board)
        board.click("#whiteboardParkingLotBtn")
        board.wait_for_selector(DIALOG, state="detached")


class TestParkingLotDragAndDrop:
    """Issue #1201: dragging a note onto the open panel parks it, dragging a
    parked row back onto the board restores it at the drop point, and
    dragging one row onto another reorders the list.
    """

    def test_dragging_a_note_onto_the_open_panel_parks_it(self, board):
        open_parking_lot_panel(board)
        assert "Loose Idea" in note_task_names(board)

        drag_note_to_panel(board, "Loose Idea")
        wait_for_parked(board, "Loose Idea")

        assert "Loose Idea" not in note_task_names(board)
        texts = parking_lot_item_texts(board)
        assert any("Loose Idea" in t for t in texts), texts
        # Unrelated notes are untouched.
        assert "Discovery" in note_task_names(board)

    def test_dragging_a_note_elsewhere_on_the_board_still_just_moves_it(self, board):
        """The panel being open doesn't hijack *every* drag -- only one that
        actually ends up over it (wbFinishDrag()'s own containment check)."""
        open_parking_lot_panel(board)
        header_box = note(board, "Loose Idea").locator(".wb-note-header").bounding_box()
        assert header_box, "note header not on screen"
        start_x = header_box["x"] + header_box["width"] / 2
        start_y = header_box["y"] + header_box["height"] / 2

        board.mouse.move(start_x, start_y)
        board.mouse.down()
        board.mouse.move(start_x + 60, start_y + 60, steps=5)
        board.mouse.up()

        assert "Loose Idea" in note_task_names(board)
        assert "---parking lot---" not in plan_text(board)

    def test_dragging_a_parked_item_onto_the_board_restores_it_at_the_drop_point(self, board):
        send_to_parking_lot(board, "Loose Idea")
        wait_for_parked(board, "Loose Idea")

        open_parking_lot_panel(board)
        row = board.locator(f"{DIALOG} .wb-parking-lot-item").filter(
            has=board.locator(".wb-parking-lot-item-text", has_text="Loose Idea")
        )
        assert row.count() == 1
        row_id = row.get_attribute("data-wb-parked-id")

        # The expected board position for this screen drop point, computed
        # the exact way wbBoardPointFromClient()/wbRestoreParkedItem() do
        # (live pan/zoom, not an assumed default) -- so this test holds
        # regardless of where the board happened to centre on load.
        drop_x, drop_y = 300, 500
        expected = board.evaluate(
            """([clientX, clientY]) => {
                const rect = wbSvg.getBoundingClientRect();
                const zoom = wbCurrentZoom();
                return {
                    x: Math.round((clientX - rect.left - wbPanX) / zoom - WB_NOTE_DEFAULT_WIDTH / 2),
                    y: Math.round((clientY - rect.top - wbPanY) / zoom - WB_NOTE_DEFAULT_HEIGHT / 2),
                };
            }""",
            [drop_x, drop_y],
        )

        dispatch_html5_drag(
            board,
            f'{DIALOG} .wb-parking-lot-item[data-wb-parked-id="{row_id}"]',
            "#whiteboardContainer",
            client_x=drop_x,
            client_y=drop_y,
        )
        board.wait_for_function(
            "() => document.getElementById('planEditor').value"
            "        .split('---whiteboard---')[0].includes('Loose Idea')"
        )

        outline = plan_text(board).split("---whiteboard---")[0]
        assert "Loose Idea" in outline
        assert "A stray thought worth keeping" in outline

        close_parking_lot_panel(board)
        switch_to_whiteboard(board, expected_notes=3)
        assert "Loose Idea" in note_task_names(board)

        whiteboard_section = plan_text(board).split("---whiteboard---")[-1]
        row_match = re.search(r"\|\s*Loose Idea\s*\|\s*(-?\d+)\s*\|\s*(-?\d+)\s*\|", whiteboard_section)
        assert row_match, whiteboard_section
        x, y = int(row_match.group(1)), int(row_match.group(2))
        assert abs(x - expected["x"]) <= 2, f"restored x={x}, expected ~{expected['x']}"
        assert abs(y - expected["y"]) <= 2, f"restored y={y}, expected ~{expected['y']}"

    def test_dragging_to_reorder_persists_the_new_order_in_plan_text(self, board):
        send_to_parking_lot(board, "Loose Idea")
        wait_for_parked(board, "Loose Idea")
        send_to_parking_lot(board, "Discovery")
        wait_for_parked(board, "Discovery")

        open_parking_lot_panel(board)
        assert [t.split(" — ")[0] for t in parking_lot_item_texts(board)] == [
            "Loose Idea",
            "Discovery",
        ]

        items = board.locator(f"{DIALOG} .wb-parking-lot-item")
        first_id = items.nth(0).get_attribute("data-wb-parked-id")
        second_id = items.nth(1).get_attribute("data-wb-parked-id")

        # Drop the second row (Discovery) onto the top half of the first
        # row (Loose Idea): wbRenderParkingLotList()'s before/after split is
        # by which half of the target row the pointer is over.
        first_box = items.nth(0).bounding_box()
        dispatch_html5_drag(
            board,
            f'{DIALOG} .wb-parking-lot-item[data-wb-parked-id="{second_id}"]',
            f'{DIALOG} .wb-parking-lot-item[data-wb-parked-id="{first_id}"]',
            client_x=first_box["x"] + first_box["width"] / 2,
            client_y=first_box["y"] + 2,
        )

        board.wait_for_function(
            """expectedFirstId => {
                const first = document.querySelector('#wbParkingLotList .wb-parking-lot-item');
                return !!first && first.dataset.wbParkedId !== expectedFirstId;
            }""",
            arg=first_id,
        )

        assert [t.split(" — ")[0] for t in parking_lot_item_texts(board)] == [
            "Discovery",
            "Loose Idea",
        ]
        # The table order in the plan text itself changed, not just the DOM.
        # Checked against the table rows only, past the parking-lot-detail
        # JSON comment above them: that comment's keys are the parked items'
        # *ids* ("1", "2", ...), and JS always serialises integer-like
        # object keys in ascending numeric order regardless of insertion
        # order -- so id 1 (Loose Idea) sorts first in the comment no matter
        # what the table rows below it say, and searching the whole section
        # would be asserting nothing about the actual reorder.
        table_only = parked_section(board).split("-->")[-1]
        assert table_only.index("Discovery") < table_only.index("Loose Idea")

    def test_reorder_is_a_single_undo_step(self, board):
        send_to_parking_lot(board, "Loose Idea")
        wait_for_parked(board, "Loose Idea")
        send_to_parking_lot(board, "Discovery")
        wait_for_parked(board, "Discovery")

        open_parking_lot_panel(board)
        before_reorder = plan_text(board)
        board.evaluate(
            "() => EditorUndoManager.captureImmediate("
            "  document.getElementById('planEditor').value)"
        )

        items = board.locator(f"{DIALOG} .wb-parking-lot-item")
        first_id = items.nth(0).get_attribute("data-wb-parked-id")
        second_id = items.nth(1).get_attribute("data-wb-parked-id")
        first_box = items.nth(0).bounding_box()
        dispatch_html5_drag(
            board,
            f'{DIALOG} .wb-parking-lot-item[data-wb-parked-id="{second_id}"]',
            f'{DIALOG} .wb-parking-lot-item[data-wb-parked-id="{first_id}"]',
            client_x=first_box["x"] + first_box["width"] / 2,
            client_y=first_box["y"] + 2,
        )
        board.wait_for_function(
            """expectedFirstId => {
                const first = document.querySelector('#wbParkingLotList .wb-parking-lot-item');
                return !!first && first.dataset.wbParkedId !== expectedFirstId;
            }""",
            arg=first_id,
        )

        # The reorder's own undo snapshot is debounced by 600ms, so pressing
        # undo straight away lands before it exists (see the identical
        # comment on test_restore_is_a_single_undo_step below). Taking it
        # outright is what the debounce would have done, just
        # deterministically.
        board.evaluate(
            "() => EditorUndoManager.captureImmediate("
            "  document.getElementById('planEditor').value)"
        )

        board.focus("#planEditor")
        modifier = "Meta" if board.evaluate("() => navigator.platform.includes('Mac')") else "Control"
        board.keyboard.press(f"{modifier}+z")

        board.wait_for_function(
            "expected => document.getElementById('planEditor').value === expected",
            arg=before_reorder,
        )
        assert plan_text(board) == before_reorder, "a single undo fully reverts the reorder"


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
    def test_parked_item_survives_a_page_reload(self, page, app_server):
        open_app(page, app_server)
        # A real project, so the commit reaches the browser's project store
        # rather than only the in-memory editor -- the whole point of this test.
        load_plan(page, SAMPLE_PLAN, with_project="Parking Lot Round Trip Test")
        switch_to_whiteboard(page, expected_notes=3)

        send_to_parking_lot(page, "Loose Idea")
        wait_for_parked(page, "Loose Idea")
        # The commit has reached the project store's in-memory copy. Its
        # write to IndexedDB is still debounced (250ms), and the reload below
        # deliberately does not wait for it: a user who parks something and
        # reloads straight away is relying on the store's pagehide flush to
        # get it onto disk, and that is part of what this test checks. It
        # replaces the Selenium version's `time.sleep(0.6)`.
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
        # This wait used to time out under load, and the test was marked
        # `unstable` for it. The startup restore was not stuck: it completed,
        # with an empty plan, because the parked write had never reached
        # IndexedDB -- the pagehide flush started a transaction the reload
        # tore down before it committed. project-store.js's flush() now
        # commits explicitly. See tests/ui/README.md.
        #
        # It also found a separate defect, fixed earlier: an empty editor
        # could overwrite the stored project. See the guard in
        # project-storage.js's saveCurrentProjectState().
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

    def test_parked_detail_survives_a_page_reload_and_can_still_be_restored(self, page, app_server):
        """Issue #1110: the richer detail snapshot (colour, checklist)
        round-trips through a reload exactly like the flat text already did,
        and Restore still works afterwards.

        Like the test above it, this reloads while the parked write is still
        in the project store's debounce, so it depends on the pagehide flush
        committing. See tests/ui/README.md.
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
