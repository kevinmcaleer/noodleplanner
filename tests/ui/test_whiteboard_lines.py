"""Associative lines between post-its (issue #874).

A line is a `Kind: line` row in the ---whiteboard--- table, drawn dotted with
no arrowhead. These cover the board-facing half: drawing one from a note's
menu, labelling and recolouring it, promoting it to a dependency, deleting
it, and that it survives a reload of the same plan text.

The pure helpers (storage round trip, promote, refusal rules) are covered by
tests/test_whiteboard_lines.mjs.

Usage:
    uv run pytest tests/ui/test_whiteboard_lines.py -q
"""

from .helpers import load_plan, note, open_note_menu, plan_text, switch_to_whiteboard

PLAN = """---
title: Lines Test Plan
---

Phase 1
  Alpha 1d
  Beta 1d

---whiteboard---
| Task  | X   | Y  | Colour  | Width | Height | Collapsed |
|-------|-----|----|---------|-------|--------|-----------|
| Alpha | 80  | 80 | #FCE38A | 280   | 200    | no        |
| Beta  | 480 | 80 | #CFF4D2 | 280   | 200    | no        |
"""


def _loaded(page, app_server):
    from .helpers import open_app

    open_app(page, app_server)
    load_plan(page, PLAN)
    switch_to_whiteboard(page, expected_notes=2)
    return page


def _draw(page):
    open_note_menu(page, "Alpha")
    page.get_by_role("menuitem", name="Draw a line to…").click()
    box = note(page, "Beta").locator(".wb-note-card").bounding_box()
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.mouse.down()
    page.mouse.up()
    page.wait_for_selector(".wb-assoc-line")


class TestAssociativeLines:
    def test_drawing_a_line_writes_a_line_row(self, page, app_server):
        _loaded(page, app_server)
        _draw(page)
        text = plan_text(page)
        assert "| line" in text
        assert "| Alpha" in text and "| Beta" in text
        assert page.locator(".wb-assoc-line-path").count() == 1

    def test_line_is_dotted_and_has_no_arrowhead(self, page, app_server):
        _loaded(page, app_server)
        _draw(page)
        dash = page.evaluate(
            "() => getComputedStyle(document.querySelector('.wb-assoc-line-path')).strokeDasharray"
        )
        assert dash and dash != "none"
        assert page.locator(".wb-assoc-line polygon").count() == 0

    def test_label_and_pen_round_trip(self, page, app_server):
        _loaded(page, app_server)
        _draw(page)
        page.locator(".wb-assoc-line.selected .wb-assoc-line-input").fill("conflicts with")
        page.keyboard.press("Enter")
        page.wait_for_function("() => document.body.innerText.includes('conflicts with')")
        page.locator(".wb-assoc-line.selected .wb-assoc-line-pen").nth(1).dispatch_event("click")
        page.wait_for_function(
            "() => document.getElementById('planEditor').value.includes('#E5484D')"
        )
        assert "conflicts with" in plan_text(page)

    def test_make_dependency_replaces_the_line(self, page, app_server):
        _loaded(page, app_server)
        _draw(page)
        page.locator(".wb-assoc-line.selected .wb-assoc-line-promote").dispatch_event("click")
        page.wait_for_function("() => !document.querySelector('.wb-assoc-line')")
        text = plan_text(page)
        assert "[depends: Alpha]" in text or "depends: Alpha" in text
        assert "| line" not in text

    def test_delete_removes_the_row(self, page, app_server):
        _loaded(page, app_server)
        _draw(page)
        page.locator(".wb-assoc-line.selected .wb-assoc-line-delete").dispatch_event("click")
        page.wait_for_function("() => !document.querySelector('.wb-assoc-line')")
        assert "| line" not in plan_text(page)

    def test_a_second_line_between_the_same_notes_is_refused(self, page, app_server):
        _loaded(page, app_server)
        _draw(page)
        open_note_menu(page, "Alpha")
        page.get_by_role("menuitem", name="Draw a line to…").click()
        box = note(page, "Beta").locator(".wb-note-card").bounding_box()
        page.mouse.move(box["x"] + 20, box["y"] + 20)
        page.mouse.down()
        page.mouse.up()
        assert page.locator(".wb-assoc-line").count() == 1
