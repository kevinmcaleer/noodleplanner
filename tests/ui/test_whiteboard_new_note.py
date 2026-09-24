"""A new post-it has to be somewhere the user can see it.

Two ways it used to go missing -- present in the markdown and the Plan
Structure panel, absent from the canvas:

- Naming it with an inline token (`Design 3d`, `Call @bob`) renamed its
  whiteboard row to the raw text, while the task is called `Design`. The row
  then named no task and the note was not drawn.
- With a note already in the middle of the screen, the next one was
  shelf-packed below the viewport.

And a board opened on a saved viewport pointing at empty space looked blank
although it had notes.

Usage:
    uv run pytest tests/ui/test_whiteboard_new_note.py -q
"""

import pytest

from .helpers import load_plan, note, note_task_names, open_app, plan_text

# A plan with tasks but nothing on the board yet: load_plan() waits on the
# app writing `rag:` back, which it only does for a plan with tasks.
EMPTY_PLAN = """---
title: New Note Test Plan
---

Phase 1
  Build 2d
"""


def _open_board(page, app_server, plan=EMPTY_PLAN, expected_notes=0):
    open_app(page, app_server)
    load_plan(page, plan, with_project="New note test")
    page.evaluate("() => switchToView('whiteboard')")
    page.wait_for_selector("#whiteboardContainer", state="visible")
    page.wait_for_function(
        "n => document.querySelectorAll('#whiteboardContainer .wb-note').length >= n",
        arg=expected_notes,
    )


def _new_post_it(page):
    """Create a post-it from the toolbar and wait for its title editor."""
    before = len(note_task_names(page))
    page.click("#whiteboardNewNoteBtn")
    page.wait_for_function(
        "n => document.querySelectorAll('#whiteboardContainer .wb-note').length > n",
        arg=before,
    )
    page.wait_for_selector(".wb-note-title.editing")


def _on_screen(page, task):
    """Whether `task`'s note lies wholly inside the visible canvas (the
    canvas minus the outline panel), once any pan animation has settled."""
    page.wait_for_timeout(300)
    return page.evaluate(
        """task => {
            const el = document.querySelector(
                `#whiteboardContainer .wb-note[data-wb-task="${task}"]`);
            const canvas = wbSvg.getBoundingClientRect();
            const v = wbVisibleCanvasRect();
            const r = el.getBoundingClientRect();
            return r.left >= canvas.left + v.x - 1 && r.top >= canvas.top + v.y - 1 &&
                r.right <= canvas.left + v.x + v.width + 1 &&
                r.bottom <= canvas.top + v.y + v.height + 1;
        }""",
        task,
    )


@pytest.mark.parametrize(
    "typed, task",
    [("Design 3d", "Design"), ("Call @bob", "Call"), ("Review 50%", "Review")],
)
def test_naming_a_new_note_with_a_token_keeps_it_on_the_board(
    page, app_server, typed, task
):
    _open_board(page, app_server)
    _new_post_it(page)
    page.keyboard.type(typed)
    page.keyboard.press("Enter")

    page.wait_for_function(
        "task => wbLastTasks.some(t => t.name === task)", arg=task
    )
    note(page, task).wait_for()
    assert note_task_names(page) == [task]
    # The token still does its job in the outline...
    assert f"\n{typed}\n" in plan_text(page)
    # ...and the row is keyed on the task's name, not the raw text.
    assert f"| {task} " in plan_text(page)


def test_each_new_post_it_lands_on_screen(page, app_server):
    _open_board(page, app_server)
    for i in range(4):
        _new_post_it(page)
        page.keyboard.press("Escape")
        name = "New idea" if i == 0 else f"New idea {i + 1}"
        assert _on_screen(page, name), f"{name} was created off screen"


def test_a_new_post_it_goes_beside_the_selected_note(page, app_server):
    page.set_viewport_size({"width": 1800, "height": 1100})
    _open_board(page, app_server)
    _new_post_it(page)
    page.keyboard.press("Escape")
    page.evaluate("() => wbSetSelectedNote('New idea')")
    _new_post_it(page)
    page.keyboard.press("Escape")

    first, second = (
        note(page, name).bounding_box() for name in ("New idea", "New idea 2")
    )
    gap_x = max(second["x"] - (first["x"] + first["width"]),
                first["x"] - (second["x"] + second["width"]))
    gap_y = max(second["y"] - (first["y"] + first["height"]),
                first["y"] - (second["y"] + second["height"]))
    assert max(gap_x, gap_y) < 60, "the new note is placed right beside the selected one"


def test_a_board_saved_looking_at_empty_space_frames_its_notes(page, app_server):
    plan = """---
title: Far Away
---

Phase 1
  Build 2d

---whiteboard---
| Task    | X    | Y    | Colour | Width | Height | Collapsed |
|---------|------|------|--------|-------|--------|-----------|
| Phase 1 | 4000 | 4000 |        | 260   | 220    | no        |
"""
    open_app(page, app_server)
    load_plan(page, plan, with_project="Far away")
    page.evaluate(
        "() => localStorage.setItem(wbViewportStorageKey(getCurrentProjectId()),"
        "  wbSerializeViewport(1, 0, 0))"
    )
    page.evaluate("() => switchToView('whiteboard')")
    note(page, "Phase 1").wait_for(state="attached")
    page.wait_for_function("() => wbPanX !== 0")
    assert _on_screen(page, "Phase 1")


def _offset_from_centre(page, task):
    """How far `task`'s note's centre is from the visible canvas's centre, in
    screen pixels, once any pan animation has settled."""
    page.wait_for_timeout(300)
    return page.evaluate(
        """task => {
            const el = document.querySelector(
                `#whiteboardContainer .wb-note[data-wb-task="${task}"]`);
            const canvas = wbSvg.getBoundingClientRect();
            const v = wbVisibleCanvasRect();
            const r = el.getBoundingClientRect();
            return Math.hypot(
                r.left + r.width / 2 - (canvas.left + v.x + v.width / 2),
                r.top + r.height / 2 - (canvas.top + v.y + v.height / 2));
        }""",
        task,
    )


def test_a_post_it_made_while_the_board_is_hidden_is_centred(page, app_server):
    """The ribbon's Whiteboard > Note works with another view showing. The
    hidden canvas measures 0x0, which used to put the note on the canvas's
    top-left corner -- behind the Plan Structure panel."""
    page.set_viewport_size({"width": 2000, "height": 1130})
    _open_board(page, app_server)
    # Let the first open finish framing the empty board before zooming.
    page.wait_for_selector("#whiteboardContainer svg.wb-svg", state="attached")
    page.wait_for_timeout(300)
    page.evaluate("() => { wbZoom = 1.27; wbApplyTransform(false); }")
    page.evaluate("() => switchToView('gantt')")
    page.wait_for_function("() => !wbVisibleCanvasRect().width")

    page.evaluate("() => wbCreateNoteInViewportCentre()")
    page.wait_for_function("() => wbLastTasks.some(t => t.name === 'New idea')")
    page.evaluate("() => switchToView('whiteboard')")
    note(page, "New idea").wait_for()
    page.wait_for_function("() => wbVisibleCanvasRect().width > 0")

    assert _offset_from_centre(page, "New idea") < 4
    assert page.evaluate("() => wbZoom") == pytest.approx(1.27), "revealing never zooms"


def test_a_new_post_it_is_centred_on_an_empty_board(page, app_server):
    page.set_viewport_size({"width": 2000, "height": 1130})
    _open_board(page, app_server)
    _new_post_it(page)
    assert _offset_from_centre(page, "New idea") < 4


class TestNotesFollowThePanAndZoom:
    """Notes are HTML in <foreignObject>s, and WebKit (Safari) paints that HTML
    -- the card is `position: relative` -- without the SVG transforms around
    it. Inside the panned and zoomed <g>, notes stayed frozen at their
    unpanned, unzoomed spot while the canvas moved: a note near the board
    origin sat behind the Plan Structure panel. So notes are placed in screen
    space themselves, and nothing above them is transformed.

    Chromium does not have the WebKit bug, so these pin down the mechanism
    rather than the painting."""

    PLAN = """---
title: Pan And Zoom
---

Phase 1
  Build 2d
Phase 2
  Test 2d

---whiteboard---
| Task    | X   | Y   | Colour | Width | Height | Collapsed |
|---------|-----|-----|--------|-------|--------|-----------|
| Phase 1 | 40  | 60  |        | 260   | 220    | no        |
| Phase 2 | 400 | 120 |        | 300   | 240    | no        |
"""

    def _board(self, page, app_server):
        page.set_viewport_size({"width": 1600, "height": 1000})
        _open_board(page, app_server, self.PLAN, expected_notes=2)
        page.wait_for_selector("#whiteboardContainer svg.wb-svg", state="attached")
        page.wait_for_timeout(300)

    def _misplaced(self, page):
        """Notes whose on-screen box is not their board rect under the
        current pan/zoom, as [task, expected, actual]."""
        return page.evaluate(
            """() => {
                const svg = wbSvg.getBoundingClientRect();
                const out = [];
                document.querySelectorAll('#whiteboardContainer .wb-note').forEach(fo => {
                    const b = wbBoardRect(fo);
                    const want = [svg.left + wbPanX + b.x * wbZoom, svg.top + wbPanY + b.y * wbZoom,
                                  b.width * wbZoom, b.height * wbZoom];
                    const r = fo.querySelector('.wb-note-card').getBoundingClientRect();
                    const got = [r.left, r.top, r.width, r.height];
                    if (want.some((v, i) => Math.abs(v - got[i]) > 1.5))
                        out.push([fo.dataset.wbTask, want.map(Math.round), got.map(Math.round)]);
                });
                return out;
            }"""
        )

    def test_no_transform_sits_above_a_note(self, page, app_server):
        self._board(page, app_server)
        transformed = page.evaluate(
            """() => {
                const out = [];
                for (let el = document.querySelector('#whiteboardContainer .wb-note');
                     el && el.tagName.toLowerCase() !== 'svg'; el = el.parentNode) {
                    if (el.getAttribute('transform')) out.push(el.getAttribute('class'));
                }
                return out;
            }"""
        )
        assert transformed == []

    def test_a_pan_moves_every_note_with_the_board(self, page, app_server):
        self._board(page, app_server)
        page.evaluate("() => { wbPanX -= 137; wbPanY += 59; wbApplyTransform(false); }")
        assert self._misplaced(page) == []

    def test_a_zoom_scales_every_note_with_the_board(self, page, app_server):
        self._board(page, app_server)
        page.evaluate("() => { wbZoom = 0.63; wbApplyTransform(false); }")
        assert self._misplaced(page) == []

    def test_an_animated_zoom_lands_every_note_with_the_board(self, page, app_server):
        self._board(page, app_server)
        page.evaluate("() => whiteboardZoomOut()")
        page.wait_for_timeout(500)
        assert self._misplaced(page) == []

    def test_a_dragged_note_moves_on_screen(self, page, app_server):
        self._board(page, app_server)
        page.evaluate("() => { wbZoom = 0.8; wbApplyTransform(false); }")
        page.evaluate(
            "() => wbSetBoardRect(wbNoteNodes.get('Phase 1').fo, { x: 123, y: 45 })"
        )
        assert self._misplaced(page) == []
