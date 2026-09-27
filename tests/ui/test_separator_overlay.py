"""End-to-end cover for separator lines corrupting the editor overlay (#746).

The plan editor is a transparent `<textarea>` over `#highlightLayer`, whose
HTML the highlighter builds, so the two must hold the same text char for char.
Lines containing `---` or `===` used to go into the overlay unescaped: a `<`
on one opened a real tag, text vanished, and the lines after it shifted so the
caret sat between rendered lines. This paints such lines in the real app and
compares the overlay with the textarea, and checks the dev-mode drift check
(on for a localhost server) stays quiet.

Usage:
    uv run pytest tests/ui/test_separator_overlay.py -q
"""

from .helpers import open_project_view, set_editor_value

BODY = [
    "Kickoff 1d",
    "=== Phase <1> ===",
    "Design <-- review --- notes",
    "Migrate A---B 3d",
    "=== R&D <beta> ===",
    "Wrap up 1d [depends Kickoff]",
]


def _body_lines(page):
    """The Kickoff..Wrap up lines as the textarea and the overlay each hold them."""
    return page.evaluate(
        """() => {
            const pick = text => {
                const lines = text.split('\\n');
                const start = lines.indexOf('Kickoff 1d');
                const end = lines.findIndex(l => l.startsWith('Wrap up 1d'));
                return lines.slice(start, end + 1);
            };
            return {
                editor: pick(document.getElementById('planEditor').value),
                overlay: pick(document.getElementById('highlightLayer').textContent),
            };
        }"""
    )


def test_separator_lines_paint_verbatim(page, app_server):
    drift = []
    page.on("console", lambda msg: drift.append(msg.text) if "overlay drift" in msg.text else None)
    open_project_view(page, app_server)
    set_editor_value(page, "\n".join(BODY) + "\n")
    page.wait_for_function(
        "() => document.getElementById('highlightLayer').textContent.includes('Wrap up 1d')"
    )

    lines = _body_lines(page)
    assert lines["editor"] == BODY
    assert lines["overlay"] == lines["editor"]
    assert drift == []

    # A mid-line `---` is task text, so the line is highlighted as a task.
    duration = page.locator("#highlightLayer .syntax-duration", has_text="3d")
    assert duration.count() >= 1
