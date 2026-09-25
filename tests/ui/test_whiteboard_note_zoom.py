"""A note's text stays in proportion to the note at every zoom.

Notes and text objects sit in an untransformed layer and are scaled to the
board's zoom themselves (whiteboard.js wbPlaceBoardObject()). They used to be
scaled with CSS `zoom`, which scales the *font size* -- and WebKit clamps a
zoomed font size to its minimum logical font size, 9px by default. In Safari a
note's 13px text therefore stopped shrinking below ~70% while the card kept
shrinking, and overflowed it. Chromium applies `zoom` after that clamp, so the
bug cannot be reproduced here; these tests pin the two things that rule it
out instead: nothing on the board is scaled with `zoom`, and every piece of
text scales by exactly the board's zoom, the same as the card around it.

Usage:
    uv run pytest tests/ui/test_whiteboard_note_zoom.py -q
"""

import pytest

from .helpers import load_plan, open_app, switch_to_whiteboard

PLAN = """---
title: Note Zoom Test Plan
---

Phase 1
  Build
    Draft the brief 2d
    Review it 1d

---whiteboard---
| Task  | X   | Y   | Colour  | Width | Height | Collapsed | Kind | Id  | Text |
|-------|-----|-----|---------|-------|--------|-----------|------|-----|------|
| Build | 80  | 80  | #F7A8B8 | 280   | 300    | no        |      |     |      |
|       | 480 | 80  |         |       |        |           | text | tx1 | A section label long enough that it has to wrap onto a second line at some width |
"""

ZOOMS = (0.45, 0.7, 1, 2)


@pytest.fixture
def board(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN, with_project="Note zoom test")
    switch_to_whiteboard(page)
    page.wait_for_selector("#whiteboardContainer .wb-text-object-content")
    return page


def _measure(page, zoom):
    """Set the board's zoom without animating and measure, in screen px, the
    card, every text run on the note, and the text object."""
    return page.evaluate(
        """zoom => {
            wbZoom = zoom;
            wbApplyTransform(false);
            const fo = document.querySelector('#whiteboardContainer .wb-note[data-wb-task="Build"]');
            const text = {};
            const walker = document.createTreeWalker(fo, NodeFilter.SHOW_TEXT);
            let n;
            while ((n = walker.nextNode())) {
                const key = n.textContent.trim();
                if (!key) continue;
                const range = document.createRange();
                range.selectNodeContents(n);
                const r = range.getBoundingClientRect();
                if (r.width) text[key] = r.width;
            }
            const wrap = document.querySelector('#whiteboardContainer .wb-text-object-wrap');
            const tw = wrap.getBoundingClientRect();
            return {
                card: fo.querySelector('.wb-note-card').getBoundingClientRect().width,
                text,
                wrap: { width: tw.width, height: tw.height },
                zooms: [...document.querySelectorAll(
                    '#whiteboardContainer .wb-note > *, #whiteboardContainer .wb-text-object > *'
                )].map(el => getComputedStyle(el).zoom),
            };
        }""",
        zoom,
    )


def test_note_content_is_not_scaled_with_css_zoom(board):
    for zoom in ZOOMS:
        m = _measure(board, zoom)
        assert m["zooms"] and set(m["zooms"]) == {"1"}, (zoom, m["zooms"])


def test_note_text_scales_with_the_note(board):
    base = _measure(board, 1)
    assert base["text"], "no text measured on the note"
    for zoom in ZOOMS:
        m = _measure(board, zoom)
        assert m["card"] == pytest.approx(base["card"] * zoom, rel=0.01), zoom
        for key, width in base["text"].items():
            if key not in m["text"]:
                continue  # hidden at this tier (title-only below 40%)
            assert m["text"][key] == pytest.approx(width * zoom, rel=0.03), (zoom, key)


def test_text_object_wraps_the_same_at_every_zoom(board):
    base = _measure(board, 1)
    for zoom in ZOOMS:
        m = _measure(board, zoom)
        assert m["wrap"]["width"] == pytest.approx(base["wrap"]["width"] * zoom, rel=0.03), zoom
        assert m["wrap"]["height"] == pytest.approx(base["wrap"]["height"] * zoom, rel=0.03), zoom
