"""End-to-end cover for the caret drifting while editing `[depends ...]` (#744).

The plan editor is a transparent `<textarea>` laid over `#highlightLayer`; the
caret comes from the textarea, the glyphs from the overlay, so the two must
hold char-for-char the same text. The dependency highlighter used to rebuild
the block -- `A,` became `A`, `A,B` became `A, B`, `Milestone: ` vanished and
`:ss` became `:SS` -- so the glyphs after the edit point slid away from the
caret. This types the issue's repro through the real keyboard and compares the
overlay's text with the textarea's, line for line.

Usage:
    uv run pytest tests/ui/test_depends_caret_alignment.py -q
"""

import pytest

from .helpers import open_project_view

PLAN = """Design 2d
Launch 0d
Build 3d [depends Design]
Ship 1d [depends Design,Build:ss +1d, Milestone: Launch]
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


def _depends_lines(page):
    """The `[depends` lines as the textarea and the overlay each hold them."""
    return page.evaluate(
        """() => {
            const pick = text => text.split('\\n').filter(l => l.includes('[depends'));
            return {
                editor: pick(document.getElementById('planEditor').value),
                overlay: pick(document.getElementById('highlightLayer').textContent),
            };
        }"""
    )


@pytest.fixture
def editor(page, app_server):
    open_project_view(page, app_server)
    _set_plan(page, PLAN)
    page.wait_for_function(
        "() => document.getElementById('highlightLayer').textContent.includes('Ship 1d')"
    )
    return page


def test_overlay_keeps_the_dependency_text_verbatim(editor):
    lines = _depends_lines(editor)
    assert lines["editor"] == [
        "Build 3d [depends Design]",
        "Ship 1d [depends Design,Build:ss +1d, Milestone: Launch]",
    ]
    assert lines["overlay"] == lines["editor"]


def test_typing_a_new_dependency_keeps_the_overlay_aligned(editor):
    editor.click("#planEditor")
    editor.evaluate(
        """() => {
            const ed = document.getElementById('planEditor');
            const at = ed.value.indexOf('[depends Design]') + '[depends Design'.length;
            ed.setSelectionRange(at, at);
        }"""
    )
    # The transient state from the issue: a trailing comma, then a partial name.
    for typed, expected in ((",", "[depends Design,]"),
                            ("L", "[depends Design,L]"),
                            ("a", "[depends Design,La]")):
        editor.keyboard.type(typed)
        # The overlay is redrawn synchronously in the `input` handler, so once
        # the textarea holds the keystroke the overlay has had its chance.
        editor.wait_for_function(
            "t => document.getElementById('planEditor').value.includes(t)",
            arg=expected,
        )
        lines = _depends_lines(editor)
        assert lines["overlay"] == lines["editor"], f"overlay drifted after typing {typed!r}"
