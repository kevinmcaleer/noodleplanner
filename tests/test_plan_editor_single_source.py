"""Every view that shows the plan's markdown must use the shared plan editor.

The Board view once carried a hand-copied editor (#kanbanPlanEditor) that
missed the front-matter panel, back-matter panel and section folding added
to the Plan Editor tab.  The editor is now one partial
(templates/_plan_editor.html) included wherever the markdown is shown; this
test fails if a view grows its own textarea, or if an included copy is not
wired up by editor.js the way the main one is.
"""

import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from noodle_web import app

PKG = Path(__file__).resolve().parent.parent / "packages" / "noodle-web" / "src" / "noodle_web"
EDITOR_JS = (PKG / "static" / "editor.js").read_text()
# A copy of the plan editor is any textarea with the editor-textarea class.
TEXTAREA = re.compile(r'<textarea\b[^>]*class="[^"]*\beditor-textarea\b[^"]*"[^>]*>', re.S)
# Each editor's fixed set of ids, in the order the partial emits them.
IDS = {
    "planEditor": ("lineNumbers", "highlightLayer", "frontMatterPanel", "backMatterPanel"),
    "kanbanPlanEditor": (
        "kanbanLineNumbers",
        "kanbanHighlightLayer",
        "kanbanFrontMatterPanel",
        "kanbanBackMatterPanel",
    ),
}


@pytest.fixture(scope="module")
def page():
    return TestClient(app).get("/").text


def _editor_block(page, editor_id):
    """The partial's rendered markup for one editor, ids normalised away."""
    start = page.index(f'id="{IDS[editor_id][2]}"')
    # Back up to the tip div that opens the partial, forward to the back-matter panel.
    start = page.rindex("Tip:", 0, start)
    start = page.rindex("<div", 0, start)
    end_marker = f'id="{IDS[editor_id][3]}"'
    end = page.index("</div>", page.index(end_marker)) + len("</div>")
    block = page[start:end]
    for name in (editor_id, *IDS[editor_id]):
        block = block.replace(f'id="{name}"', 'id="X"')
    return block


def test_only_the_shared_partial_defines_an_editor_textarea():
    for path in (PKG / "templates").glob("*.html"):
        found = TEXTAREA.findall(path.read_text())
        if path.name == "_plan_editor.html":
            assert len(found) == 1
        else:
            assert not found, f"{path.name} hand-builds a plan editor; include _plan_editor.html"


def test_every_rendered_editor_is_a_copy_of_the_main_one(page):
    assert len(TEXTAREA.findall(page)) == len(IDS)
    main = _editor_block(page, "planEditor")
    for editor_id in IDS:
        assert _editor_block(page, editor_id) == main, f"#{editor_id} has drifted from #planEditor"


@pytest.mark.parametrize("editor_id", IDS)
def test_every_editor_is_wired_up_by_editor_js(editor_id):
    # setupEditor() must not special-case one editor id, and each editor
    # must get its own front/back-matter panels.
    assert "editor.id ===" not in EDITOR_JS
    if editor_id != "planEditor":
        assert f"editorId: '{editor_id}'" in EDITOR_JS
        assert f"containerId: '{IDS[editor_id][2]}'" in EDITOR_JS
        assert f"containerId: '{IDS[editor_id][3]}'" in EDITOR_JS
