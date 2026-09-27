"""Deleting a product or an activity from the product form (#921).

Both used to find their line by text: a product by the first line that
*contained* its ``$id`` -- which could be another task's ``[depends $id]``,
or a longer id that starts with it -- and an activity by a hand-rolled
name regex. Each then spliced out that one line, leaving the product's
contents behind under whatever came before. They now find the task through
the plan model and remove its subtree.

Usage:
    uv run pytest tests/ui/test_product_delete.py -m ui -q
"""

import pytest

from .helpers import open_project_view, set_editor_value

pytestmark = pytest.mark.ui

PLAN = (
    "Release\n"
    "  Ship 1d [depends $spec]\n"
    "  Specs index $specs 1d\n"
    "  Spec $spec\n"
    "    Draft 2d\n"
    "    Review 1d\n"
    "  Launch 1d\n"
)


def _outline(page):
    text = page.eval_on_selector("#planEditor", "editor => editor.value")
    if text.startswith("---\n"):
        text = text[text.index("\n---\n", 3) + 5:]
    return text


def _load(page, app_server):
    open_project_view(page, app_server)
    set_editor_value(page, PLAN)
    page.on("dialog", lambda dialog: dialog.accept())


def test_deleting_a_product_removes_it_and_its_contents_only(page, app_server):
    _load(page, app_server)
    page.evaluate("productDeleteChild('spec')")
    assert _outline(page) == (
        "Release\n"
        "  Ship 1d [depends $spec]\n"
        "  Specs index $specs 1d\n"
        "  Launch 1d\n"
    )


def test_deleting_an_activity_removes_that_task(page, app_server):
    _load(page, app_server)
    page.evaluate("productDeleteActivity('Draft')")
    assert _outline(page) == PLAN.replace("    Draft 2d\n", "")
