"""A note's checklist: ticking a task, part-done tasks, and "+N more".

*   **Ticking.** A row's checkbox marks its task 100% (and back to 0%). It
    used to be untickable: <np-checkbox> took a click on its own box for a
    click on its padding and clicked the box a second time, straight back.
*   **Part done.** A task between 0% and 100% fills its box like a pie to its
    percent -- Kanban's progress fill -- and a tick still means "done".
*   **"+N more".** A note shorter than its list says, in its footer, how many
    rows are out of sight, and pressing it scrolls to them.

Usage:
    uv run pytest tests/ui/test_whiteboard_note_checklist.py -q
"""

import re

from .helpers import load_plan, note, open_app, plan_text, switch_to_whiteboard

PLAN = """---
title: Checklist Test Plan
---

Build
  Design
  Prototype 40%
  Test
Long
  One
  Two
  Three
  Four
  Five
  Six
  Seven
  Eight
  Nine
  Ten

---whiteboard---
| Task  | X   | Y   | Colour | Width | Height | Collapsed |
|-------|-----|-----|--------|-------|--------|-----------|
| Build | 60  | 120 |        | 260   | 260    | no        |
| Long  | 400 | 120 |        | 260   | 200    | no        |
"""


def board(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    switch_to_whiteboard(page, expected_notes=2)
    page.evaluate("() => whiteboardZoomReset()")
    page.evaluate(
        "() => wbToggleOutlinePanel(false)"
    )
    page.evaluate("() => whiteboardRevealNote('Build', { centre: true })")
    page.wait_for_timeout(300)


def row(page, task, child):
    return note(page, task).locator(f".wb-note-row[data-wb-row-task='{child}']")


def click_box(page, task, child):
    """A real press on the box itself -- the case that used to double-toggle."""
    box = row(page, task, child).locator("np-checkbox").bounding_box()
    page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)


def line_for(page, name):
    return next(
        line.strip() for line in plan_text(page).split("\n")
        if re.match(rf"^\s+{re.escape(name)}\b", line)
    )


class TestTicking:
    def test_ticking_a_task_marks_it_complete(self, page, app_server):
        board(page, app_server)
        click_box(page, "Build", "Design")
        page.wait_for_function(
            "() => /^\\s+Design 100%/m.test(document.getElementById('planEditor').value)")
        assert line_for(page, "Design") == "Design 100%"
        page.wait_for_selector(".wb-note[data-wb-task='Build'] "
                               ".wb-note-row[data-wb-row-task='Design'] np-checkbox[checked]")

    def test_unticking_marks_it_not_started(self, page, app_server):
        board(page, app_server)
        click_box(page, "Build", "Design")
        # The note re-renders from the plan after a tick; the second press
        # has to land on the redrawn, ticked box, not the old one.
        page.wait_for_selector(".wb-note[data-wb-task='Build'] "
                               ".wb-note-row[data-wb-row-task='Design'] np-checkbox[checked]")
        page.wait_for_timeout(300)
        click_box(page, "Build", "Design")
        page.wait_for_function(
            "() => /^\\s+Design 0%/m.test(document.getElementById('planEditor').value)")

    def test_the_footer_count_follows(self, page, app_server):
        board(page, app_server)
        click_box(page, "Build", "Test")
        page.wait_for_function(
            "() => document.querySelector(\".wb-note[data-wb-task='Build'] .wb-note-progress\")"
            ".textContent.trim() === '1 / 3'")


class TestPartDone:
    def test_a_part_done_task_carries_its_percent(self, page, app_server):
        board(page, app_server)
        box = row(page, "Build", "Prototype").locator("np-checkbox")
        assert box.get_attribute("progress") == "40"
        assert box.get_attribute("checked") is None
        assert "40% complete" in box.get_attribute("title")
        fill = page.evaluate(
            """() => {
                const cb = document.querySelector(
                    ".wb-note[data-wb-task='Build'] .wb-note-row[data-wb-row-task='Prototype'] np-checkbox");
                return getComputedStyle(cb.shadowRoot.querySelector('input')).backgroundImage;
            }"""
        )
        assert "conic-gradient" in fill

    def test_not_started_and_done_tasks_have_no_pie(self, page, app_server):
        board(page, app_server)
        assert row(page, "Build", "Design").locator("np-checkbox").get_attribute("progress") is None

    def test_ticking_a_part_done_task_completes_it(self, page, app_server):
        board(page, app_server)
        click_box(page, "Build", "Prototype")
        page.wait_for_function(
            "() => /^\\s+Prototype 100%/m.test(document.getElementById('planEditor').value)")


class TestMoreRows:
    MORE = ".wb-note[data-wb-task='Long'] .wb-note-more"

    def test_a_short_note_says_how_many_rows_are_hidden(self, page, app_server):
        board(page, app_server)
        page.wait_for_selector(self.MORE, state="visible")
        text = page.locator(self.MORE).text_content()
        hidden = int(re.search(r"\+(\d+) more", text).group(1))
        visible = page.evaluate(
            """() => {
                const body = document.querySelector(".wb-note[data-wb-task='Long'] .wb-note-body");
                const v = body.getBoundingClientRect();
                return [...body.querySelectorAll('.wb-note-row')].filter(r => {
                    const b = r.getBoundingClientRect();
                    const m = b.top + b.height / 2;
                    return m >= v.top && m <= v.bottom;
                }).length;
            }"""
        )
        assert hidden + visible == 10
        assert hidden > 0

    def test_a_note_that_fits_shows_nothing(self, page, app_server):
        board(page, app_server)
        page.wait_for_timeout(200)
        assert page.locator(".wb-note[data-wb-task='Build'] .wb-note-more").is_hidden()

    def test_pressing_it_scrolls_to_the_hidden_rows(self, page, app_server):
        board(page, app_server)
        page.evaluate("() => whiteboardRevealNote('Long', { centre: true })")
        page.wait_for_timeout(300)
        page.wait_for_selector(self.MORE, state="visible")
        before = page.evaluate(
            "() => document.querySelector(\".wb-note[data-wb-task='Long'] .wb-note-body\").scrollTop")
        page.locator(self.MORE).click()
        page.wait_for_function(
            f"() => document.querySelector(\".wb-note[data-wb-task='Long'] .wb-note-body\").scrollTop > {before}")

    def test_growing_the_note_until_everything_fits_hides_it(self, page, app_server):
        board(page, app_server)
        page.wait_for_selector(self.MORE, state="visible")
        page.evaluate(
            """() => { const e = wbNoteNodes.get('Long');
                       wbSetBoardRect(e.fo, { height: 700 }); }"""
        )
        page.wait_for_selector(self.MORE, state="hidden")

    def test_the_wheel_scrolls_a_selected_notes_list(self, page, app_server):
        board(page, app_server)
        page.evaluate("() => wbSetSelectedNote('Long')")
        body = note(page, "Long").locator(".wb-note-body").bounding_box()
        pan = page.evaluate("() => [wbPanX, wbPanY]")
        page.mouse.move(body["x"] + body["width"] / 2, body["y"] + body["height"] / 2)
        page.mouse.wheel(0, 80)
        page.wait_for_function(
            "() => document.querySelector(\".wb-note[data-wb-task='Long'] .wb-note-body\").scrollTop > 0")
        assert page.evaluate("() => [wbPanX, wbPanY]") == pan, "the board did not pan as well"

    def test_the_wheel_over_an_unselected_note_pans_the_board(self, page, app_server):
        board(page, app_server)
        body = note(page, "Long").locator(".wb-note-body").bounding_box()
        pan = page.evaluate("() => wbPanY")
        page.mouse.move(body["x"] + body["width"] / 2, body["y"] + body["height"] / 2)
        page.mouse.wheel(0, 80)
        page.wait_for_timeout(150)
        assert page.evaluate("() => wbPanY") == pan - 80
        assert page.evaluate(
            "() => document.querySelector(\".wb-note[data-wb-task='Long'] .wb-note-body\").scrollTop") == 0
