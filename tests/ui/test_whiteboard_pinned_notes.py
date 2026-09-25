"""Pinned notes (issue #1291): the pin as the board's one vocabulary.

A note is on the whiteboard because the plan's `---whiteboard---` table has a
row for its task. #1291 gives that fact a name -- the note is *pinned* -- and
one glyph for it everywhere it can be changed: on the object toolbar over a
selected note, on the outline panel's per-row toggle, and on the peek popover
that opens from a child-count badge.

What is measured here is the behaviour those three surfaces have to share,
because the unit tests in tests/test_whiteboard_pinned_notes.mjs can reach the
source and the CSS but not a rendered, clicked note:

  * the note header carries no pin of its own any more -- it moved to the
    toolbar that floats above a selected note;
  * the toolbar's Unpin removes that note's row from the whiteboard table and
    nothing else -- the task and its subtasks stay in the plan;
  * the outline row's toggle is a pin on a task that is off the board and a
    struck-through pin on one that is on it;
  * the peek's own pin puts the child on the board near where the popover was,
    and reads as already-pinned once it is there.

Clicks go through `dispatch_event("click")` for the reason
tests/ui/test_task_peek.py's docstring sets out: the board is a pan/zoom canvas
and this plan's notes sit outside the visible pane, so a real mouse click has
nothing to hit.

Usage:
    uv run pytest tests/ui/test_whiteboard_pinned_notes.py -q
"""

import pytest

from .helpers import open_app

PLAN = """---
title: Pinned Notes Test Plan
---

Phase 1
  Discovery
    Research 2d
    Interviews 2d
  Build
    Ship Widget 3d
    Nested
      Sub A 1d
      Sub B 1d
        Detail One 1d
        Detail Two 1d

---whiteboard---
| Task      | X   | Y  | Colour | Width | Height | Collapsed |
|-----------|-----|----|--------|-------|--------|-----------|
| Discovery | 120 | 80 |        | 280   | 240    | no        |
| Build     | 480 | 80 |        | 280   | 260    | no        |
"""

PEEK = "#taskPeekPopover"


def load_plan(page, plan_text):
    page.eval_on_selector(
        "#planEditor",
        """(editor, value) => {
            editor.value = value;
            editor.dispatchEvent(new Event('input', { bubbles: true }));
        }""",
        plan_text,
    )


def switch_to_whiteboard(page, expected_notes=2):
    page.evaluate("() => switchToView('whiteboard')")
    page.wait_for_selector("#whiteboardContainer", state="visible")
    page.wait_for_function(
        "n => document.querySelectorAll('#whiteboardContainer .wb-note').length >= n",
        arg=expected_notes,
    )


def plan_text(page):
    return page.evaluate("() => document.getElementById('planEditor').value")


def whiteboard_tasks(page):
    """The task names the plan's whiteboard table currently pins."""
    return page.evaluate(
        "() => parseWhiteboardMarkdown("
        "  extractWhiteboardFromPlanText(document.getElementById('planEditor').value)"
        ").map(row => row.task)"
    )


def note(page, task):
    return page.locator(f'#whiteboardContainer .wb-note[data-wb-task="{task}"]')


@pytest.fixture
def board(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    switch_to_whiteboard(page)
    return page


# ── The note's own pin ───────────────────────────────────────────────────


class TestNotePin:
    def test_the_note_header_has_no_pin(self, board):
        assert note(board, "Build").locator(".wb-note-pin-btn").count() == 0

    def test_the_toolbar_unpin_removes_that_note_and_leaves_the_plan_alone(
        self, board
    ):
        before = plan_text(board)
        assert whiteboard_tasks(board) == ["Discovery", "Build"]

        board.evaluate("() => wbSetSelectedNote('Build')")
        unpin = board.locator(".wb-object-toolbar .wb-object-toolbar-unpin")
        unpin.wait_for(state="attached")
        assert "stays in your plan" in unpin.get_attribute("aria-label")
        unpin.dispatch_event("click")
        board.wait_for_function(
            "() => document.querySelectorAll("
            "  '#whiteboardContainer .wb-note').length === 1"
        )

        assert whiteboard_tasks(board) == ["Discovery"]
        after = plan_text(board)
        for line in ("  Build", "    Ship Widget 3d", "      Sub A 1d"):
            assert line in before and line in after, (
                f"unpinning must not touch the outline; lost {line!r}"
            )


# ── The outline panel's toggle ───────────────────────────────────────────


class TestOutlineToggle:
    def test_the_toggle_is_a_pin_off_the_board_and_a_struck_pin_on_it(
        self, board
    ):
        board.evaluate("() => wbToggleOutlinePanel && wbToggleOutlinePanel()")
        board.wait_for_selector(".wb-outline-row", state="attached")

        def toggle(task):
            return board.evaluate(
                """(task) => {
                    const rows = [...document.querySelectorAll('.wb-outline-row')];
                    const row = rows.find(r => {
                        const label = r.querySelector('.wb-outline-name, .wb-outline-label');
                        return label && label.textContent.trim() === task;
                    });
                    if (!row) return null;
                    const btn = row.querySelector('.wb-outline-add');
                    return {
                        remove: btn.classList.contains('wb-outline-remove'),
                        svgs: btn.querySelectorAll('svg').length,
                        paths: btn.querySelectorAll('svg path').length,
                        title: btn.getAttribute('title'),
                    };
                }""",
                task,
            )

        on_board = toggle("Build")
        assert on_board is not None, "no outline row for a task on the board"
        assert on_board["remove"] is True
        assert on_board["svgs"] == 1, "the glyph replaced the text toggle"
        assert on_board["title"].startswith("Unpin")

        off_board = toggle("Nested")
        assert off_board is not None, "no outline row for a task off the board"
        assert off_board["remove"] is False
        assert off_board["svgs"] == 1
        assert off_board["title"].startswith("Pin")
        # The unpin glyph is the pin plus its strike-through, so it draws one
        # more path than the pin does -- the two states are visibly different.
        assert on_board["paths"] == off_board["paths"] + 1


# ── The peek's pin ───────────────────────────────────────────────────────


class TestPeekPin:
    def open_peek(self, page, note_task, child_name):
        row = page.locator(
            f'#whiteboardContainer .wb-note[data-wb-task="{note_task}"] '
            f'.wb-note-row[data-wb-row-task="{child_name}"]'
        )
        row.locator(".wb-note-count-badge").dispatch_event("click")
        page.wait_for_selector(PEEK, state="visible")
        return page.locator(PEEK)

    def test_pin_from_the_peek_puts_the_child_on_the_board_where_the_peek_was(
        self, board
    ):
        peek = self.open_peek(board, "Build", "Nested")
        # The anchor in *board* coordinates, which is what the plan's
        # whiteboard table stores -- comparing client rects across the commit
        # would be comparing them across a re-render that may have panned.
        anchor = board.evaluate(
            """() => {
                const r = document.getElementById('taskPeekPopover')
                    .getBoundingClientRect();
                return wbClientToBoard(r.right, r.top);
            }"""
        )
        pin = peek.locator(".task-peek-pin-btn")
        assert pin.count() == 1, "the peek has no pin button"
        assert pin.is_disabled() is False

        pin.dispatch_event("click")
        board.wait_for_function(
            "() => document.querySelectorAll("
            "  '#whiteboardContainer .wb-note').length === 3"
        )

        assert whiteboard_tasks(board) == ["Discovery", "Build", "Nested"]
        # The peek closes before the note lands, so the new note is not left
        # underneath the popover that produced it.
        assert board.locator(PEEK).count() == 0

        # "At that position": the row written for the new note starts at the
        # peek's own corner plus the board's one note gap, not at the next
        # free cell of the viewport.
        placed = board.evaluate(
            """() => parseWhiteboardMarkdown(extractWhiteboardFromPlanText(
                document.getElementById('planEditor').value
            )).find(row => row.task === 'Nested')"""
        )
        assert abs(placed["x"] - anchor["x"]) < 40, (placed, anchor)
        # Down the same column, never up and never off to one side: the anchor
        # is where the scan *starts*, and a board will not stack two notes, so
        # an occupied corner steps the new note down past what is in the way
        # (here, the parent note the peek was covering).
        assert placed["y"] >= anchor["y"], (placed, anchor)

    def test_a_child_already_pinned_offers_a_disabled_pin_not_a_second_copy(
        self, board
    ):
        # Drilled into, rather than pinned from the root level, because
        # pinning a note's own direct child moves it out of that note's
        # checklist and into its linked-children summary -- the badge that
        # opened the peek is gone, so the *root* level cannot show this state
        # to anybody. A grandchild can: Nested stays off the board throughout.
        def sub_b_pin(page):
            peek = self.open_peek(page, "Build", "Nested")
            peek.locator(".task-peek-row").filter(
                has=page.get_by_text("Sub B", exact=True)
            ).locator(".wb-note-count-badge").dispatch_event("click")
            page.wait_for_function(
                "() => document.querySelector("
                "  '#taskPeekPopover .task-peek-title').textContent === 'Sub B'"
            )
            return peek.locator(".task-peek-pin-btn")

        pin = sub_b_pin(board)
        assert pin.is_disabled() is False
        pin.dispatch_event("click")
        board.wait_for_function(
            "() => document.querySelectorAll("
            "  '#whiteboardContainer .wb-note').length === 3"
        )
        assert whiteboard_tasks(board) == ["Discovery", "Build", "Sub B"]

        pin = sub_b_pin(board)
        assert pin.is_disabled() is True
        assert "already on the whiteboard" in pin.get_attribute("title")
        assert whiteboard_tasks(board).count("Sub B") == 1
