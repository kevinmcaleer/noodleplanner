"""The whiteboard's Tidy zooms to fit the notes in their new places.

Tidy lays the notes out as a grid starting from the current viewport, so on a
zoomed-in board most of the grid lands off screen. Once the notes have moved,
the board zooms to fit them. In a planning session everyone's board does, not
just the board of whoever pressed Tidy: the host's Tidy reaches each joiner
with the snapshot that carries the new layout, and a joiner's reaches the
host, which passes it on.

Usage:
    uv run pytest tests/ui/test_whiteboard_tidy_fit.py -q
"""

import pytest

from .helpers import load_plan, open_app, switch_to_whiteboard

PLAN = """---
title: Tidy Board
---
Alpha
  Alpha one
Beta
  Beta one
Gamma
  Gamma one
Delta
  Delta one
Epsilon
  Epsilon one
Zeta
  Zeta one

---whiteboard---
| Task    | X    | Y    | Colour | Width | Height | Collapsed |
|---------|------|------|--------|-------|--------|-----------|
| Alpha   | 60   | 60   |        | 240   | 180    | no        |
| Beta    | 900  | 700  |        | 320   | 200    | no        |
| Gamma   | 1800 | 60   |        | 240   | 180    | no        |
| Delta   | 60   | 1400 |        | 240   | 260    | no        |
| Epsilon | 1400 | 1300 |        | 240   | 180    | no        |
| Zeta    | 2400 | 900  |        | 280   | 180    | no        |
"""

NOTES = 6

# Every note wholly inside the board's canvas.
ALL_NOTES_ON_SCREEN = """() => {
    const canvas = document.getElementById('whiteboardContainer').getBoundingClientRect();
    const notes = [...document.querySelectorAll('#whiteboardContainer .wb-note')];
    return notes.length > 0 && notes.every(note => {
        const r = note.getBoundingClientRect();
        return r.left >= canvas.left - 1 && r.top >= canvas.top - 1 &&
            r.right <= canvas.right + 1 && r.bottom <= canvas.bottom + 1;
    });
}"""


def all_notes_on_screen(pg):
    return pg.evaluate(ALL_NOTES_ON_SCREEN)


def zoom_in_on_first_note(pg):
    """Zoom right in on Alpha, the way someone reading one note has it --
    with most of the board, and most of where Tidy will put things, off
    screen."""
    pg.evaluate("""() => {
        wbZoom = 3;
        wbPanX = 0;
        wbPanY = 0;
        wbApplyTransform(false);
        wbUpdateZoomLabel();
    }""")
    assert not all_notes_on_screen(pg)


def tidied(pg):
    """Whether the board has been laid out by Tidy: every note the same size."""
    return pg.evaluate("""() => {
        const notes = [...document.querySelectorAll('#whiteboardContainer .wb-note')];
        return new Set(notes.map(n => `${n.dataset.wbWidth}x${n.dataset.wbHeight}`)).size === 1;
    }""")


def test_tidy_zooms_to_fit_the_new_layout(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    switch_to_whiteboard(page, expected_notes=NOTES)
    zoom_in_on_first_note(page)

    page.evaluate("() => wbLayoutTidyNotes()")

    page.wait_for_function(ALL_NOTES_ON_SCREEN)
    assert tidied(page)


def test_tidy_on_a_tidy_board_still_fits(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    switch_to_whiteboard(page, expected_notes=NOTES)
    # Twice: the first Tidy spaces its rows by the tallest note it started
    # with, and the second by the standard size it gave them all.
    for _ in range(2):
        zoom_in_on_first_note(page)
        page.evaluate("() => wbLayoutTidyNotes()")
        page.wait_for_function(ALL_NOTES_ON_SCREEN)
    # Back to the view that grid was laid out from, so Tidy has nothing
    # left to move.
    zoom_in_on_first_note(page)

    changed = page.evaluate("() => wbLayoutTidyNotes()")

    assert changed is False
    page.wait_for_function(ALL_NOTES_ON_SCREEN)


# ── In a planning session ────────────────────────────────────────────────


@pytest.fixture
def host(page, app_server):
    """The app, with PLAN on its whiteboard, hosting a live session."""
    host_page = page.context.new_page()
    host_page.set_default_timeout(15_000)
    open_app(host_page, app_server)
    load_plan(host_page, PLAN)
    switch_to_whiteboard(host_page, expected_notes=NOTES)
    host_page.evaluate("() => startCollabSession()")
    host_page.wait_for_function(
        "() => document.getElementById('collabSessionCode').value.length === 6"
    )
    code = host_page.input_value("#collabSessionCode")
    host_page.evaluate("() => minimiseCollabSessionModal()")
    yield host_page, code
    host_page.close()


@pytest.fixture
def joiner(page, app_server, host):
    """The joiner, in the session, with the host's board drawn."""
    _, code = host
    page.set_default_timeout(15_000)
    page.goto(f"{app_server}/join")
    page.fill("#joinCode", code)
    page.fill("#displayName", "Alex")
    page.click("#joinBtn")
    page.wait_for_selector("#relayInput", state="visible")
    page.wait_for_function(
        "n => document.querySelectorAll('#whiteboardContainer .wb-note').length === n",
        arg=NOTES,
    )
    page.bring_to_front()
    return page


def test_the_hosts_tidy_fits_the_joiners_board(host, joiner):
    host_page, _ = host
    zoom_in_on_first_note(joiner)

    host_page.evaluate("() => wbLayoutTidyNotes()")

    joiner.wait_for_function(ALL_NOTES_ON_SCREEN)
    assert tidied(joiner)
    host_page.wait_for_function(ALL_NOTES_ON_SCREEN)


def test_a_joiners_tidy_fits_the_hosts_board(host, joiner):
    host_page, _ = host
    zoom_in_on_first_note(host_page)

    # From the joiner's ribbon, the way they would press it.
    joiner.click('#ribbonShell [data-scope-id="whiteboard"][data-label="Tidy"]')

    joiner.wait_for_function(ALL_NOTES_ON_SCREEN)
    host_page.wait_for_function(ALL_NOTES_ON_SCREEN)
    assert tidied(host_page)
