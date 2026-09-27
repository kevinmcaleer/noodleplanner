"""End-to-end cover for `&` collapsing in the highlight overlay (#745).

The plan editor is a transparent `<textarea>` laid over `#highlightLayer`, so
the overlay must hold char-for-char the textarea's text. Most of the overlay's
line sites escaped only `<` and `>`, so `Read &amp; review` rendered as
`Read & review` -- four characters short -- and the caret drifted. This loads
entity-like text into each kind of line and compares what the real browser
renders in the overlay with the textarea, line for line.

The back-matter sections are left to tests/test_highlight_overlay_escaping.js:
in the plan editor they fold into a one-line summary, so their raw lines never
reach the overlay here.

Usage:
    uv run pytest tests/ui/test_overlay_entity_escaping.py -q
"""

import pytest

from .helpers import open_project_view

SAMPLES = ["&amp;", "&lt;", "R&Damp", "&not", "&#169;", "a & b", "<tag>"]
TEXT = " ".join(SAMPLES)

PLAN = f"""---
title: Plan {TEXT}
---
# Phase {TEXT}
Read {TEXT} 2d @bob
Build "note {TEXT}" 3d [depends Read]
// comment {TEXT}
"""


def _set_plan(page, value):
    page.evaluate(
        """value => {
            const ed = document.getElementById('planEditor');
            ed.value = value;
            ed.dispatchEvent(new Event('input', { bubbles: true }));
        }""",
        value,
    )


def _sample_lines(page):
    """The lines carrying the samples, as the textarea and the overlay hold them."""
    return page.evaluate(
        """marker => {
            const pick = text => text.split('\\n').filter(l => l.includes(marker));
            return {
                editor: pick(document.getElementById('planEditor').value),
                overlay: pick(document.getElementById('highlightLayer').textContent),
            };
        }""",
        "R&Damp",
    )


@pytest.fixture
def editor(page, app_server):
    open_project_view(page, app_server)
    _set_plan(page, PLAN)
    page.wait_for_function(
        "() => document.getElementById('highlightLayer').textContent.includes('Read ')"
    )
    return page


def test_overlay_renders_entity_like_text_verbatim(editor):
    lines = _sample_lines(editor)
    assert len(lines["editor"]) == 5
    assert lines["overlay"] == lines["editor"]


def test_typing_an_entity_keeps_the_overlay_aligned(editor):
    editor.click("#planEditor")
    editor.evaluate(
        """() => {
            const ed = document.getElementById('planEditor');
            const at = ed.value.indexOf('Read ') + 'Read'.length;
            ed.setSelectionRange(at, at);
        }"""
    )
    editor.keyboard.type(" &amp;")
    editor.wait_for_function(
        "() => document.getElementById('planEditor').value.includes('Read &amp; ')"
    )
    lines = _sample_lines(editor)
    assert lines["overlay"] == lines["editor"]
