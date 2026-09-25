"""Checklist rows on a whiteboard note: rename in place, and drag.

Double-clicking a row's name edits it where it sits; dragging a row
re-orders it within its note, moves it between notes, or -- dropped on bare
board -- lifts it off as a note of its own with no noodle back to where it
came from. The outline rewrite is the pure wbMoveRowInPlanText() (covered by
tests/test_whiteboard_structure.js); these drive the real gestures.

The board is pinned at zoom 1 with no pan so every note is inside the pane
and the mouse can reach it -- see tests/ui/helpers.py.

Usage:
    uv run pytest tests/ui/test_whiteboard_row_drag.py -q
"""

from .helpers import load_plan, note, note_task_names, open_app, plan_text, switch_to_whiteboard

PLAN = """---
title: Row Drag Test Plan
---

Build
  Keep 1d
  MoveMe 2d
    Nested 1d
  After 3d
Other
  Existing 1d
Loose Idea
// Musing

---whiteboard---
| Task       | X   | Y   | Colour  | Width | Height | Collapsed |
|------------|-----|-----|---------|-------|--------|-----------|
| Build      | 20  | 20  | #FCE38A | 260   | 240    | no        |
| Other      | 320 | 20  | #CFF4D2 | 260   | 200    | no        |
| Loose Idea | 20  | 300 | #FFD6E0 | 260   | 160    | no        |
| Musing     | 320 | 300 |         | 260   | 160    | no        |
"""


def _loaded(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    switch_to_whiteboard(page, expected_notes=4)
    page.evaluate("() => { wbZoom = 1; wbPanX = 0; wbPanY = 0; wbApplyTransform(false); }")
    page.wait_for_function(
        "() => { const c = document.querySelector(`.wb-note[data-wb-task='Build'] .wb-note-card`);"
        "  return c && Math.abs(c.offsetWidth - 260) < 2; }"
    )
    return page


def _row(page, parent, child):
    return note(page, parent).locator(f'.wb-note-row[data-wb-row-task="{child}"]')


def _row_names(page, parent):
    return page.evaluate(
        "t => [...document.querySelectorAll(`.wb-note[data-wb-task='${t}'] .wb-note-row`)]"
        "  .map(r => r.dataset.wbRowTask)",
        parent,
    )


def _name_centre(page, parent, child):
    box = _row(page, parent, child).locator(".wb-note-row-name").bounding_box()
    return box["x"] + min(20, box["width"] / 2), box["y"] + box["height"] / 2


def _wait_rows(page, parent, names):
    page.wait_for_function(
        "([t, want]) => JSON.stringify([...document.querySelectorAll("
        "  `.wb-note[data-wb-task='${t}'] .wb-note-row`)].map(r => r.dataset.wbRowTask))"
        "  === JSON.stringify(want)",
        arg=[parent, names],
    )


def _drag(page, start, end):
    page.mouse.move(*start)
    page.mouse.down()
    page.mouse.move(start[0] + 6, start[1] + 6, steps=2)
    page.mouse.move(*end, steps=8)
    page.mouse.up()


class TestRenameInPlace:
    def test_double_click_edits_the_row_and_enter_renames_the_task(self, page, app_server):
        board = _loaded(page, app_server)
        x, y = _name_centre(board, "Build", "Keep")
        board.mouse.dblclick(x, y)
        name = _row(board, "Build", "Keep").locator(".wb-note-row-name")
        assert name.get_attribute("contenteditable") == "true"
        board.keyboard.press("ControlOrMeta+a")
        board.keyboard.type("Kept")
        board.keyboard.press("Enter")
        board.wait_for_function("() => document.getElementById('planEditor').value.includes('  Kept 1d')")
        board.wait_for_function(
            "() => !!document.querySelector(`.wb-note[data-wb-task='Build'] .wb-note-row[data-wb-row-task='Kept']`)"
        )

    def test_escape_abandons_the_rename(self, page, app_server):
        board = _loaded(page, app_server)
        before = plan_text(board)
        x, y = _name_centre(board, "Build", "After")
        board.mouse.dblclick(x, y)
        board.keyboard.type("Whatever")
        board.keyboard.press("Escape")
        name = _row(board, "Build", "After").locator(".wb-note-row-name")
        assert name.text_content() == "After"
        assert plan_text(board) == before

    def test_double_click_on_a_summary_row_does_not_leave_the_peek_open(self, page, app_server):
        board = _loaded(page, app_server)
        x, y = _name_centre(board, "Build", "MoveMe")
        board.mouse.dblclick(x, y)
        name = _row(board, "Build", "MoveMe").locator(".wb-note-row-name")
        assert name.get_attribute("contenteditable") == "true"
        assert not board.evaluate("() => TaskPeek.isOpenFor('MoveMe')")


class TestDragRow:
    def test_drag_reorders_within_the_note(self, page, app_server):
        board = _loaded(page, app_server)
        keep = _row(board, "Build", "Keep").bounding_box()
        start = _name_centre(board, "Build", "After")
        _drag(board, start, (keep["x"] + 40, keep["y"] + 2))
        board.wait_for_function(
            "() => document.getElementById('planEditor').value.includes('Build\\n  After 3d\\n  Keep 1d')"
        )
        _wait_rows(board, "Build", ["After", "Keep", "MoveMe"])

    def test_drag_moves_a_row_to_another_note_with_its_subtree(self, page, app_server):
        board = _loaded(page, app_server)
        existing = _row(board, "Other", "Existing").bounding_box()
        start = _name_centre(board, "Build", "MoveMe")
        _drag(board, start, (existing["x"] + 40, existing["y"] + existing["height"] - 2))
        board.wait_for_function(
            "() => document.getElementById('planEditor').value"
            "  .includes('Other\\n  Existing 1d\\n  MoveMe 2d\\n    Nested 1d')"
        )
        _wait_rows(board, "Other", ["Existing", "MoveMe"])
        _wait_rows(board, "Build", ["Keep", "After"])

    def test_drag_onto_an_empty_note_adds_it_there(self, page, app_server):
        board = _loaded(page, app_server)
        loose = note(board, "Loose Idea").locator(".wb-note-card").bounding_box()
        start = _name_centre(board, "Build", "Keep")
        _drag(board, start, (loose["x"] + loose["width"] / 2, loose["y"] + loose["height"] / 2))
        board.wait_for_function(
            "() => document.getElementById('planEditor').value.includes('Loose Idea\\n  Keep 1d')"
        )

    def test_drag_onto_bare_board_lifts_it_off_as_an_unlinked_note(self, page, app_server):
        board = _loaded(page, app_server)
        svg = board.locator("#whiteboardContainer svg").first.bounding_box()
        drop = (svg["x"] + 640, svg["y"] + 500)
        start = _name_centre(board, "Build", "After")
        _drag(board, start, drop)
        board.wait_for_function(
            "() => !!document.querySelector(`#whiteboardContainer .wb-note[data-wb-task='After']`)"
        )
        text = plan_text(board)
        outline = text.split("---whiteboard---")[0]
        assert "\nAfter 3d" in outline, "lifted off to the top level, so no noodle"
        assert "  After 3d" not in outline
        assert "After" not in _row_names(board, "Build")
        rect = board.evaluate(
            "() => { const fo = document.querySelector(`.wb-note[data-wb-task='After']`);"
            "  return { x: +fo.dataset.wbX, y: +fo.dataset.wbY }; }"
        )
        assert abs(rect["x"] - (640 - 24)) <= 2 and abs(rect["y"] - (500 - 24)) <= 2, rect
        assert "After" in note_task_names(board)

    def test_drop_on_a_thought_changes_nothing(self, page, app_server):
        board = _loaded(page, app_server)
        before = plan_text(board)
        musing = note(board, "Musing").locator(".wb-note-card").bounding_box()
        start = _name_centre(board, "Build", "Keep")
        _drag(board, start, (musing["x"] + 40, musing["y"] + 40))
        board.wait_for_timeout(200)
        assert plan_text(board) == before

    def test_a_plain_click_neither_drags_nor_renames(self, page, app_server):
        board = _loaded(page, app_server)
        before = plan_text(board)
        x, y = _name_centre(board, "Build", "Keep")
        board.mouse.click(x, y)
        board.wait_for_timeout(600)
        assert plan_text(board) == before
        assert board.locator(".wb-row-drag-ghost").count() == 0
        name = _row(board, "Build", "Keep").locator(".wb-note-row-name")
        assert name.get_attribute("contenteditable") != "true"
