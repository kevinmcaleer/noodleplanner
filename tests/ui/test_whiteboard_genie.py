"""The genie pin (whiteboard-genie.js): pinning a task to the board animates
the new note out of the row it came from, then shows the real note.

The funnel's shape is unit-tested in tests/test_whiteboard_genie.mjs. What
needs a browser is the handover around it:

  * the genie really plays -- an overlay appears -- and the real note is held
    hidden underneath it while it does;
  * once it lands, the overlay is gone and the real note is visible, where the
    pin put it (the animation never changes what is committed);
  * with reduced motion requested there is no overlay at all, and the note is
    simply there.

Clicks go through `dispatch_event("click")`, as in
tests/ui/test_whiteboard_pinned_notes.py.

Usage:
    uv run pytest tests/ui/test_whiteboard_genie.py -q
"""

import pytest

from .helpers import open_app
from .test_whiteboard_pinned_notes import (
    PEEK,
    PLAN,
    load_plan,
    note,
    switch_to_whiteboard,
    whiteboard_tasks,
)

# Records every genie overlay added to the page, and whether the pinned note
# was hidden at that moment -- the overlay is gone again well before a
# polling assertion could reliably catch it.
WATCH_GENIE = """() => {
    window.__genieSeen = [];
    new MutationObserver(records => {
        for (const record of records) {
            for (const node of record.addedNodes) {
                if (!node.classList || !node.classList.contains('wb-genie-ghost')) continue;
                const fo = document.querySelector(
                    '#whiteboardContainer .wb-note[data-wb-task="Nested"]');
                window.__genieSeen.push({
                    noteHeld: !!fo && fo.classList.contains('wb-note-ghosted'),
                    hasCard: !!node.querySelector('.wb-genie-note .wb-note-card'),
                    clip: getComputedStyle(node.querySelector('.wb-genie-funnel')).clipPath,
                });
            }
        }
    }).observe(document.body, { childList: true, subtree: true });
}"""


def pin_nested_from_peek(page):
    row = page.locator(
        '#whiteboardContainer .wb-note[data-wb-task="Build"] '
        '.wb-note-row[data-wb-row-task="Nested"]'
    )
    row.locator(".wb-note-count-badge").dispatch_event("click")
    page.wait_for_selector(PEEK, state="visible")
    page.evaluate(WATCH_GENIE)
    page.locator(f"{PEEK} .task-peek-pin-btn").dispatch_event("click")
    page.wait_for_function(
        "() => document.querySelectorAll('#whiteboardContainer .wb-note').length === 3"
    )


def wait_until_landed(page):
    page.wait_for_function(
        """() => {
            const fo = document.querySelector(
                '#whiteboardContainer .wb-note[data-wb-task="Nested"]');
            return fo && !fo.classList.contains('wb-note-ghosted')
                && !document.querySelector('.wb-genie-ghost');
        }""",
        timeout=5_000,
    )


@pytest.fixture
def board(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    switch_to_whiteboard(page)
    return page


class TestGeniePin:
    def test_the_genie_plays_over_a_held_note_then_shows_it(self, board):
        pin_nested_from_peek(board)
        board.wait_for_function("() => window.__genieSeen.length > 0", timeout=2_000)

        seen = board.evaluate("() => window.__genieSeen")
        assert len(seen) == 1, seen
        assert seen[0]["noteHeld"], "the real note showed before the genie landed"
        assert seen[0]["hasCard"], "the genie carries no copy of the note's card"
        assert seen[0]["clip"].startswith("polygon("), seen[0]

        wait_until_landed(board)
        assert note(board, "Nested").evaluate(
            "fo => getComputedStyle(fo).visibility"
        ) == "visible"
        assert whiteboard_tasks(board) == ["Discovery", "Build", "Nested"]

    def test_reduced_motion_pins_with_no_genie(self, board):
        board.emulate_media(reduced_motion="reduce")
        pin_nested_from_peek(board)
        wait_until_landed(board)

        assert board.evaluate("() => window.__genieSeen") == []
        assert whiteboard_tasks(board) == ["Discovery", "Build", "Nested"]
        # External resources are blocked in this suite; anything else is ours.
        errors = [e for e in board.console_errors if "Failed to load resource" not in e]
        assert errors == []


# ── Unpin: the genie in reverse ──────────────────────────────────────────

PINNED_PLAN = PLAN.replace(
    "| Build     | 480 | 80 |        | 280   | 260    | no        |\n",
    "| Build     | 480 | 80 |        | 280   | 260    | no        |\n"
    "| Nested    | 880 | 80 |        | 280   | 240    | no        |\n",
)

# Records each reverse run as it starts -- the overlay carrying a funnel --
# and whether the row it drains into was held hidden at that moment, and
# every stand-in (an overlay with no funnel: the note's copy across the
# commit, or the fade-out where there is no row to go back to).
WATCH_UNPIN = """task => {
    window.__unpinSeen = { runs: [], standIns: 0 };
    new MutationObserver(records => {
        for (const record of records) {
            for (const node of record.addedNodes) {
                if (!node.classList || !node.classList.contains('wb-genie-ghost')) continue;
                const funnel = node.querySelector('.wb-genie-funnel');
                if (!funnel) { window.__unpinSeen.standIns++; continue; }
                const row = document.querySelector(
                    `#whiteboardContainer .wb-note .wb-note-row[data-wb-row-task="${task}"]`);
                window.__unpinSeen.runs.push({
                    rowHeld: !!row && row.classList.contains('wb-genie-row-held'),
                    reverse: funnel.getAnimations()
                        .some(a => a.effect.getTiming().direction === 'reverse'),
                });
            }
        }
    }).observe(document.body, { childList: true, subtree: true });
}"""


def unpin_from_toolbar(page, task):
    page.evaluate(WATCH_UNPIN, task)
    page.evaluate("task => wbSetSelectedNote(task)", task)
    unpin = page.locator(".wb-object-toolbar .wb-object-toolbar-unpin")
    unpin.wait_for(state="attached")
    unpin.dispatch_event("click")


def wait_until_drained(page):
    page.wait_for_function(
        "() => !document.querySelector('.wb-genie-ghost')"
        "  && !document.querySelector('.wb-genie-row-held')",
        timeout=5_000,
    )


@pytest.fixture
def pinned_board(page, app_server):
    open_app(page, app_server)
    load_plan(page, PINNED_PLAN)
    switch_to_whiteboard(page, expected_notes=3)
    return page


class TestGenieUnpin:
    def test_unpin_drains_the_note_back_into_its_row(self, pinned_board):
        board = pinned_board
        unpin_from_toolbar(board, "Nested")
        board.wait_for_function(
            "() => window.__unpinSeen.runs.length > 0", timeout=2_000
        )

        seen = board.evaluate("() => window.__unpinSeen")
        assert len(seen["runs"]) == 1, seen
        assert seen["runs"][0]["reverse"], "the genie did not play in reverse"
        assert seen["runs"][0]["rowHeld"], "the row showed before the note drained into it"
        assert seen["standIns"] == 1, "the note blinked out across the commit"

        wait_until_drained(board)
        assert whiteboard_tasks(board) == ["Discovery", "Build"]
        assert note(board, "Nested").count() == 0
        row = board.locator(
            '#whiteboardContainer .wb-note[data-wb-task="Build"] '
            '.wb-note-row[data-wb-row-task="Nested"]'
        )
        assert row.evaluate("r => getComputedStyle(r).visibility") == "visible"

    def test_a_note_with_no_row_to_return_to_fades_out(self, pinned_board):
        board = pinned_board
        board.evaluate("() => wbToggleOutlinePanel(false)")
        unpin_from_toolbar(board, "Discovery")
        wait_until_drained(board)

        seen = board.evaluate("() => window.__unpinSeen")
        assert seen["runs"] == [], seen
        assert whiteboard_tasks(board) == ["Build", "Nested"]

    def test_reduced_motion_unpins_with_no_genie(self, pinned_board):
        board = pinned_board
        board.emulate_media(reduced_motion="reduce")
        unpin_from_toolbar(board, "Nested")
        board.wait_for_function(
            "() => !document.querySelector("
            "  '#whiteboardContainer .wb-note[data-wb-task=\"Nested\"]')"
        )

        assert board.evaluate("() => window.__unpinSeen") == {"runs": [], "standIns": 0}
        assert whiteboard_tasks(board) == ["Discovery", "Build"]
