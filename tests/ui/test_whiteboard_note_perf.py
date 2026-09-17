"""What a board full of notes costs to render and to drag (issue #1249).

`tests/test_dependency_perf.mjs` measures the *model* half of a dependency
drag -- the parse, the lookups, the serialize -- and says in its own header
that the DOM half is deliberately not covered, because it needs a real
browser. This is that half, and #1249 asks for it by name, because the epic
put custom elements on the board: `<np-checkbox>` on every checklist row
(#1245) and `<np-resource-stack>` on every row with an assignee (#1246), each
with a shadow root, on a surface that is transform-driven and re-rendered on
every plan edit.

Two custom-element upgrades per row on a 12-note board with 8 rows each is
~100 upgrades and ~100 shadow roots per full render, which is a real cost
rather than a theoretical one. So: measure it, and keep a regression guard on
it. The numbers this records on a sandboxed CI runner are

    full render of 12 notes x 8 rows   ~110 ms
    one re-render of the same board     ~95 ms
    a 20-step note drag                 ~35 ms

against budgets several times larger. Like the model-side file, these are a
guard against something changing *algorithmically* -- a per-row re-parse, an
upgrade that forces layout -- not a benchmark score, so they are deliberately
loose enough that a busy runner does not fail them.

Usage:
    uv run pytest tests/ui/test_whiteboard_note_perf.py -q
"""

import pytest

from .helpers import load_plan, note, open_app, switch_to_whiteboard

NOTES = 12
ROWS_PER_NOTE = 8

# Generous multiples of the measured cost above. A regression that matters --
# a shadow root per *cell*, a re-parse per row, a synchronous layout inside the
# render loop -- moves these by an order of magnitude, not by 50%.
RENDER_BUDGET_MS = 1500
RERENDER_BUDGET_MS = 1200
DRAG_BUDGET_MS = 800


def _plan():
    """A board shaped like a real one: every row carries the tokens that make
    the builder do work -- a duration, an assignee, a deliverable on some, a
    detected date on others -- so nothing is measured on an empty row."""
    lines = [
        "---",
        "title: Note Perf Board",
        "Resources:",
        "  - @sam: Sam Smith, Developer",
        "  - @jo: Jo Lee, Reviewer",
        "---",
        "",
        "Programme",
    ]
    for n in range(NOTES):
        lines.append(f"  Workstream {n}")
        for r in range(ROWS_PER_NOTE):
            bits = [f"    Task {n}-{r}", "2d", "@sam"]
            if r % 3 == 0:
                bits.append("@jo")
            if r % 4 == 0:
                bits.append("$Deliverable")
            if r % 5 == 0:
                bits.append("2026-03-12")
            lines.append(" ".join(bits))

    lines += [
        "",
        "---whiteboard---",
        "| Task | X | Y | Colour | Width | Height | Collapsed |",
        "|------|---|---|--------|-------|--------|-----------|",
    ]
    for n in range(NOTES):
        x = 200 + (n % 4) * 320
        y = 80 + (n // 4) * 340
        lines.append(f"| Workstream {n} | {x} | {y} | | 280 | 300 | no |")
    return "\n".join(lines) + "\n"


@pytest.fixture
def board(page, app_server):
    open_app(page, app_server)
    load_plan(page, _plan())
    return page


def _row_count(page):
    return page.evaluate(
        "() => document.querySelectorAll("
        "  '#whiteboardContainer .wb-note-row').length"
    )


class TestBoardRenderCost:
    def test_a_full_board_renders_inside_budget(self, board):
        # The cold build, measured the way a user pays for it: the first time
        # the whiteboard is opened, every note node, every row and every
        # custom-element upgrade happens at once. Timed in the page and read
        # back once the rows are actually on screen, so the number includes the
        # upgrades rather than stopping at the append.
        board.evaluate("() => { window.__t0 = performance.now(); }")
        switch_to_whiteboard(board, expected_notes=NOTES)
        board.wait_for_function(
            "n => document.querySelectorAll("
            "  '#whiteboardContainer .wb-note-row').length >= n",
            arg=NOTES * ROWS_PER_NOTE,
        )
        elapsed = board.evaluate(
            """() => {
                document.querySelectorAll('#whiteboardContainer .wb-note')
                    .forEach((n) => n.getBoundingClientRect());
                return performance.now() - window.__t0;
            }"""
        )
        assert _row_count(board) >= NOTES * ROWS_PER_NOTE, (
            "the board did not render every row, so the timing is meaningless"
        )
        assert elapsed < RENDER_BUDGET_MS, (
            f"a {NOTES}-note board took {elapsed:.0f}ms to render, over the "
            f"{RENDER_BUDGET_MS}ms guard"
        )

    def test_a_re_render_of_the_same_board_stays_inside_budget(self, board):
        # The path a plan edit, a zoom step and a committed drag all take. It
        # reuses every existing note node rather than rebuilding it, so it
        # should be no *worse* than the first render.
        switch_to_whiteboard(board, expected_notes=NOTES)
        elapsed = board.evaluate(
            """() => {
                const t0 = performance.now();
                wbRenderNotes();
                document.querySelectorAll('#whiteboardContainer .wb-note')
                    .forEach((n) => n.getBoundingClientRect());
                return performance.now() - t0;
            }"""
        )
        assert elapsed < RERENDER_BUDGET_MS, (
            f"re-rendering a {NOTES}-note board took {elapsed:.0f}ms, over the "
            f"{RERENDER_BUDGET_MS}ms guard"
        )

    def test_zoom_tiers_recompute_without_a_rebuild(self, board):
        # wbUpdateNoteZoomTiers() runs on every zoom step. It must only toggle
        # classes -- if it ever starts rebuilding note contents, every zoom
        # step pays a full render and this catches it.
        switch_to_whiteboard(board, expected_notes=NOTES)
        before = _row_count(board)
        elapsed = board.evaluate(
            """() => {
                const t0 = performance.now();
                for (let i = 0; i < 10; i++) wbUpdateNoteZoomTiers();
                return performance.now() - t0;
            }"""
        )
        assert _row_count(board) == before, (
            "a zoom-tier update rebuilt the rows; it is supposed to toggle a class"
        )
        assert elapsed < RERENDER_BUDGET_MS, (
            f"ten zoom-tier updates took {elapsed:.0f}ms"
        )


class TestDragCost:
    def test_dragging_a_note_across_a_full_board_stays_inside_budget(self, board):
        switch_to_whiteboard(board, expected_notes=NOTES)
        header = note(board, "Workstream 0").locator(".wb-note-header")
        box = header.bounding_box()
        assert box, "the first note's header is not on screen"

        start_x = box["x"] + box["width"] / 2
        start_y = box["y"] + box["height"] / 2

        board.evaluate("() => { window.__t0 = performance.now(); }")
        board.mouse.move(start_x, start_y)
        board.mouse.down()
        for step in range(1, 21):
            board.mouse.move(start_x + step * 4, start_y + step * 2)
        board.mouse.up()
        elapsed = board.evaluate("() => performance.now() - window.__t0")

        assert elapsed < DRAG_BUDGET_MS, (
            f"a 20-step drag on a {NOTES}-note board took {elapsed:.0f}ms, over "
            f"the {DRAG_BUDGET_MS}ms guard"
        )

    def test_a_drag_does_not_re_render_per_pointer_move(self, board):
        # The regression that would matter: a pointermove that re-renders the
        # board. A drag moves one <foreignObject> by setting x/y -- if any
        # frame of it started calling wbRenderNotes(), a 12-note board would
        # pay a full rebuild per frame and the gesture would crawl.
        #
        # Counted rather than timed, and counted rather than compared by node
        # identity: the board re-renders for its own reasons (the 1s auto-render
        # debounce catching up on an earlier edit, the commit at the end of the
        # gesture), so "did any node change" is a question about scheduling,
        # while "how many renders did twenty pointer moves cause" is the
        # question this is actually asking.
        switch_to_whiteboard(board, expected_notes=NOTES)
        board.evaluate(
            """() => {
                window.__renders = 0;
                const real = window.wbRenderNotes;
                window.wbRenderNotes = function () {
                    window.__renders++;
                    return real.apply(this, arguments);
                };
            }"""
        )
        box = note(board, "Workstream 0").locator(".wb-note-header").bounding_box()
        board.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        board.mouse.down()
        for step in range(1, 21):
            board.mouse.move(box["x"] + box["width"] / 2 + step * 5,
                             box["y"] + box["height"] / 2 + step * 3)
        during = board.evaluate("() => window.__renders")
        board.mouse.up()

        assert during <= 2, (
            f"twenty pointer moves caused {during} full board renders; a drag "
            "should move one node, not rebuild the board"
        )
