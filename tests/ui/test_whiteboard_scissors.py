"""Scissors split between checklist rows (issue #874, slice 1).

Hovering the gap between two checklist items reveals a scissors control;
clicking it lifts everything below the cut onto a new post-it alongside.
The outline rewrite is a pure helper (wbSplitChecklistAt); these tests
cover the board-facing half: the affordance, the split, colour, the blank
title-edit, and that a note with 0–1 rows has no scissors.

Clicks and geometry use dispatched events and bounding boxes because the
whiteboard is a pan/zoom canvas and these notes sit outside the visible
pane — see tests/ui/helpers.py.

Usage:
    uv run pytest tests/ui/test_whiteboard_scissors.py -q
"""

import re

from .helpers import load_plan, note, note_task_names, open_app, plan_text, switch_to_whiteboard

PLAN = """---
title: Scissors Test Plan
Resources:
  - @sam: Sam Smith, Developer
  - @jo: Jo Lee, Reviewer
---

Phase 1
  Build
    Keep @sam 1d
    MoveMe @jo 2d
      Nested @jo 1d
    After @sam 3d
  Solo
    OnlyChild 1d
  Loose Idea

---whiteboard---
| Task       | X   | Y   | Colour  | Width | Height | Collapsed |
|------------|-----|-----|---------|-------|--------|-----------|
| Build      | 480 | 80  | #FCE38A | 280   | 320    | no        |
| Solo       | 480 | 440 | #CFF4D2 | 280   | 200    | no        |
| Loose Idea | 800 | 80  | #FFD6E0 | 280   | 200    | no        |
"""


def settled(page, task="Build", width=280):
    page.wait_for_function(
        "([t, w]) => { const c = document.querySelector("
        "  `.wb-note[data-wb-task='${t}'] .wb-note-card`);"
        "  return c && Math.abs(c.offsetWidth - w) < 2; }",
        arg=[task, width],
    )


def _loaded(page, app_server, expected_notes=3):
    open_app(page, app_server)
    load_plan(page, PLAN)
    switch_to_whiteboard(page, expected_notes=expected_notes)
    settled(page)
    return page


def _scissors_after(page, parent, child):
    """The scissors button sitting in the gap after `child`'s row.

    CSS rather than get_by_role: the control is opacity 0 at rest, and
    Playwright's role engine skips that as hidden.
    """
    return note(page, parent).locator(
        f'.wb-note-scissors[aria-label="Split note after {child}"]'
    )


def _note_accent(page, task):
    return page.evaluate(
        "t => getComputedStyle(document.querySelector("
        "  `.wb-note[data-wb-task='${t}'] .wb-note-card`)"
        ").getPropertyValue('--wb-note-accent').trim()",
        task,
    )


class TestScissorsAffordance:
    def test_three_rows_have_a_cut_between_each_pair(self, page, app_server):
        _loaded(page, app_server)
        assert _scissors_after(page, "Build", "Keep").count() == 1
        assert _scissors_after(page, "Build", "MoveMe").count() == 1
        assert _scissors_after(page, "Build", "After").count() == 0, (
            "no scissors after the last checklist row"
        )

    def test_a_single_row_note_has_no_scissors(self, page, app_server):
        _loaded(page, app_server)
        assert note(page, "Solo").locator(".wb-note-scissors").count() == 0
        assert note(page, "Solo").locator(".wb-note-cut").count() == 0

    def test_a_freeform_note_has_no_scissors(self, page, app_server):
        _loaded(page, app_server)
        assert note(page, "Loose Idea").locator(".wb-note-row").count() == 0
        assert note(page, "Loose Idea").locator(".wb-note-scissors").count() == 0

    def test_scissors_has_an_accessible_name_and_a_44px_hit_target(self, page, app_server):
        _loaded(page, app_server)
        btn = _scissors_after(page, "Build", "Keep")
        assert btn.get_attribute("aria-label") == "Split note after Keep"
        box = page.evaluate(
            """() => {
                const b = document.querySelector(
                    '.wb-note[data-wb-task=Build] .wb-note-scissors');
                const r = b.getBoundingClientRect();
                return { w: b.offsetWidth, h: b.offsetHeight, rw: r.width, rh: r.height };
            }"""
        )
        assert box["w"] >= 44 and box["h"] >= 44, box
        # offsetWidth is layout pixels; the canvas zoom must not shrink the
        # hit target below 44 CSS pixels.
        assert box["w"] == 44 and box["h"] == 44, box

    def test_resting_state_hides_the_icon(self, page, app_server):
        _loaded(page, app_server)
        opacity = page.evaluate(
            """() => getComputedStyle(document.querySelector(
                '.wb-note[data-wb-task=Build] .wb-note-scissors')).opacity"""
        )
        assert float(opacity) == 0, "scissors must not add chrome at rest"


class TestScissorsSplit:
    def test_clicking_scissors_lifts_everything_below_the_cut(self, page, app_server):
        board = _loaded(page, app_server)
        before = plan_text(board)

        _scissors_after(board, "Build", "Keep").dispatch_event("click")
        board.wait_for_function(
            "() => document.querySelectorAll('#whiteboardContainer .wb-note').length >= 4"
        )

        names = note_task_names(board)
        assert "Build" in names
        new_names = [n for n in names if n not in ("Build", "Solo", "Loose Idea")]
        assert len(new_names) == 1, names
        new_name = new_names[0]
        assert new_name.startswith("New idea")

        build_rows = board.evaluate(
            """() => [...document.querySelectorAll(
                '.wb-note[data-wb-task=Build] .wb-note-row-name')].map(n => n.textContent)"""
        )
        assert build_rows == ["Keep"], build_rows

        new_rows = board.evaluate(
            """name => [...document.querySelectorAll(
                `.wb-note[data-wb-task='${name}'] .wb-note-row-name`)].map(n => n.textContent)""",
            new_name,
        )
        assert new_rows == ["MoveMe", "After"], new_rows

        text = plan_text(board)
        outline = text.split("---whiteboard---")[0]
        assert "    Keep @sam 1d" in outline
        assert "  MoveMe @jo 2d" in outline
        assert "    Nested @jo 1d" in outline
        assert "  After @sam 3d" in outline
        # Nested travelled with MoveMe: Build's remaining child is Keep only.
        assert re.search(r"Build\n\s+Keep @sam 1d\n", outline)
        assert not re.search(r"Build\n\s+Keep @sam 1d\n\s+MoveMe", outline)

        wb = text.split("---whiteboard---")[-1]
        assert "| Build " in wb or "| Build |" in wb
        assert new_name in wb
        assert "Loose Idea" in wb

        assert _note_accent(board, new_name).upper() == _note_accent(board, "Build").upper()

        title = note(board, new_name).locator(".wb-note-title")
        board.wait_for_function(
            """name => {
                const t = document.querySelector(
                    `.wb-note[data-wb-task='${name}'] .wb-note-title`);
                return t && t.isContentEditable;
            }""",
            arg=new_name,
        )
        assert title.evaluate("t => t.textContent") == ""

        pos = board.evaluate(
            """() => {
                const src = document.querySelector('.wb-note[data-wb-task=Build]');
                const names = [...document.querySelectorAll('#whiteboardContainer .wb-note')]
                    .map(n => n.dataset.wbTask)
                    .filter(n => n !== 'Build' && n !== 'Solo' && n !== 'Loose Idea');
                const neu = document.querySelector(
                    `.wb-note[data-wb-task='${names[0]}']`);
                return {
                    sx: Number(src.dataset.wbX), sy: Number(src.dataset.wbY),
                    sw: Number(src.dataset.wbWidth),
                    nx: Number(neu.dataset.wbX), ny: Number(neu.dataset.wbY),
                    nw: Number(neu.dataset.wbWidth),
                };
            }"""
        )
        assert pos["nx"] >= pos["sx"] + pos["sw"], pos
        assert pos["ny"] == pos["sy"], pos
        assert pos["nx"] + pos["nw"] > pos["sx"] + pos["sw"], "the new note must not sit on the old one"

        assert plan_text(board) != before

    def test_splitting_off_the_last_row_is_allowed(self, page, app_server):
        board = _loaded(page, app_server)
        _scissors_after(board, "Build", "MoveMe").dispatch_event("click")
        board.wait_for_function(
            "() => document.querySelectorAll('#whiteboardContainer .wb-note').length >= 4"
        )
        names = [n for n in note_task_names(board)
                 if n not in ("Build", "Solo", "Loose Idea")]
        assert len(names) == 1
        new_rows = board.evaluate(
            """name => [...document.querySelectorAll(
                `.wb-note[data-wb-task='${name}'] .wb-note-row-name`)].map(n => n.textContent)""",
            names[0],
        )
        assert new_rows == ["After"], new_rows
        build_rows = board.evaluate(
            """() => [...document.querySelectorAll(
                '.wb-note[data-wb-task=Build] .wb-note-row-name')].map(n => n.textContent)"""
        )
        assert build_rows == ["Keep", "MoveMe"], build_rows

    def test_split_is_a_single_undo_step(self, page, app_server):
        board = _loaded(page, app_server)
        board.evaluate(
            "() => EditorUndoManager.captureImmediate("
            "  document.getElementById('planEditor').value)"
        )
        before = plan_text(board)

        _scissors_after(board, "Build", "Keep").dispatch_event("click")
        board.wait_for_function(
            "() => document.querySelectorAll('#whiteboardContainer .wb-note').length >= 4"
        )

        board.evaluate("() => EditorUndoManager.undo()")
        board.wait_for_function(
            "() => document.querySelectorAll('#whiteboardContainer .wb-note').length === 3"
        )
        assert "New idea" not in plan_text(board).split("---whiteboard---")[0]
        assert plan_text(board).split("---whiteboard---")[0] == before.split("---whiteboard---")[0]


class TestScissorsArming:
    """The touch-arming state is board-wide and transient.

    Coarse pointers have no hover, so a press on a row reveals the scissors
    in the gap below it and a second tap splits. That armed state used to be
    cleared only by a press on another row *of the same note*, so pressing a
    row's count badge armed a cut that then stayed visible forever -- on a
    note that had since lost focus (the reported bug).
    """

    @staticmethod
    def _armed(page):
        return page.evaluate(
            "() => Array.from(document.querySelectorAll("
            "  '.wb-note-cut[data-wb-armed]')).length"
        )

    @staticmethod
    def _press(locator, pointer_type):
        locator.dispatch_event(
            "pointerdown", {"pointerType": pointer_type, "bubbles": True}
        )

    def _row(self, page, parent, child):
        return note(page, parent).locator(
            f".wb-note-row:has(.wb-note-row-name:text-is('{child}'))"
        )

    def test_a_mouse_press_never_arms(self, page, app_server):
        _loaded(page, app_server)
        self._press(self._row(page, "Build", "Keep"), "mouse")
        assert self._armed(page) == 0, (
            "fine pointers reveal the scissors by hovering the gap; arming "
            "on a mouse press leaves them showing with no second tap to spend"
        )

    def test_pressing_the_count_badge_does_not_arm(self, page, app_server):
        _loaded(page, app_server)
        badge = note(page, "Build").locator(".wb-note-count-badge").first
        assert badge.count() == 1
        self._press(badge, "touch")
        assert self._armed(page) == 0, (
            "the badge press is the peek's gesture, not a bid to split"
        )

    def test_a_touch_press_arms_only_the_cut_below_that_row(self, page, app_server):
        _loaded(page, app_server)
        self._press(self._row(page, "Build", "Keep"), "touch")
        assert self._armed(page) == 1

    def test_pressing_another_note_disarms(self, page, app_server):
        _loaded(page, app_server)
        self._press(self._row(page, "Build", "Keep"), "touch")
        assert self._armed(page) == 1
        self._press(self._row(page, "Solo", "OnlyChild"), "touch")
        assert self._armed(page) == 0, (
            "an armed cut on one note must not survive a press on another"
        )

    def test_pressing_the_canvas_disarms(self, page, app_server):
        _loaded(page, app_server)
        self._press(self._row(page, "Build", "Keep"), "touch")
        assert self._armed(page) == 1
        page.locator("#whiteboardContainer").dispatch_event(
            "pointerdown", {"pointerType": "touch", "bubbles": True}
        )
        assert self._armed(page) == 0
