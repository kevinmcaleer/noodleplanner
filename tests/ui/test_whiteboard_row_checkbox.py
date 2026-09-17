"""The checklist row's checkbox, now <np-checkbox> (issue #1245).

The row used to build a bare native input. The app had nine checkbox
treatments and no component, and -- because `views/gantt.css` is linked
globally and carried an unscoped `input[type="checkbox"]` rule that outranks
any single-class selector -- most of their declared sizes never applied at all.

This file covers the behaviour the seven Selenium assertions in
tests/test_whiteboard_notes.py and tests/test_whiteboard_drag_resize.py reach
through `querySelector('.wb-note-checkbox').click()`: that clicking a row's
checkbox still writes the completion back to the plan. Those run under
`-m usability` and skip wherever chromedriver cannot drive the installed
Chromium, so this is the version that actually runs in CI's gating browser job.

Usage:
    uv run pytest tests/ui/test_whiteboard_row_checkbox.py -q
"""

import re

from .helpers import load_plan, note, open_app, plan_text, switch_to_whiteboard

PLAN = """---
title: Row Checkbox Test Plan
---

Phase 1
  Build
    Leaf task 2d
    Done already 1d 100%
    Summary
      Child A 1d

---whiteboard---
| Task  | X   | Y  | Colour | Width | Height | Collapsed |
|-------|-----|----|--------|-------|--------|-----------|
| Build | 480 | 80 |        | 300   | 300    | no        |
"""


def _row(page, child_name):
    return note(page, "Build").locator(".wb-note-row").filter(
        has=page.locator(
            ".wb-note-row-name", has_text=re.compile(rf"^{re.escape(child_name)}$")
        )
    )


def _checkbox(page, child_name):
    return _row(page, child_name).locator(".wb-note-checkbox")


def _line_for(page, task_name):
    for line in plan_text(page).split("\n"):
        if line.strip().startswith(task_name):
            return line
    return None


def _loaded(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    switch_to_whiteboard(page)
    page.wait_for_selector(".wb-note[data-wb-task=Build] .wb-note-checkbox")


class TestItIsTheComponent:
    def test_the_row_renders_np_checkbox(self, page, app_server):
        _loaded(page, app_server)
        box = _checkbox(page, "Leaf task")
        assert box.evaluate("n => n.tagName.toLowerCase()") == "np-checkbox"
        # The class stays, because it is what several call sites and the
        # Selenium suite find a row's checkbox by; the rule behind it is gone.
        assert box.evaluate("n => n.classList.contains('wb-note-checkbox')")

    def test_it_reports_leaf_or_summary(self, page, app_server):
        """Only a summary may ever render the mixed state."""
        _loaded(page, app_server)
        assert _checkbox(page, "Leaf task").get_attribute("row") == "leaf"
        assert _checkbox(page, "Summary").get_attribute("row") == "summary"

    def test_an_already_complete_task_renders_checked(self, page, app_server):
        _loaded(page, app_server)
        assert _checkbox(page, "Done already").get_attribute("checked") is not None
        assert _checkbox(page, "Leaf task").get_attribute("checked") is None


class TestClickingItWritesThePlan:
    def test_clicking_marks_the_task_complete(self, page, app_server):
        """The behaviour the seven `.wb-note-checkbox.click()` assertions cover."""
        _loaded(page, app_server)
        assert "100%" not in _line_for(page, "Leaf task")

        _checkbox(page, "Leaf task").dispatch_event("click")
        page.wait_for_function(
            "() => document.getElementById('planEditor').value"
            "        .split('\\n').some(l => l.trim().startsWith('Leaf task')"
            "                                  && l.includes('100%'))"
        )
        assert "100%" in _line_for(page, "Leaf task")

    def test_clicking_a_complete_task_marks_it_incomplete(self, page, app_server):
        _loaded(page, app_server)
        _checkbox(page, "Done already").dispatch_event("click")
        page.wait_for_function(
            "() => document.getElementById('planEditor').value"
            "        .split('\\n').some(l => l.trim().startsWith('Done already')"
            "                                  && !l.includes('100%'))"
        )
        assert "100%" not in _line_for(page, "Done already")

    def test_clicking_a_summary_row_checkbox_does_not_also_drill_in(
        self, page, app_server
    ):
        """A summary row is a peek target, so its checkbox stops the click."""
        _loaded(page, app_server)
        _checkbox(page, "Summary").dispatch_event("click")
        page.wait_for_timeout(300)
        assert page.locator("#taskPeekPopover").count() == 0 or not page.locator(
            "#taskPeekPopover"
        ).is_visible()


class TestTheTargetIsBigEnough:
    def test_the_pressable_area_clears_the_minimum(self, page, app_server):
        """Every checkbox in the app was under WCAG 2.2 SC 2.5.8's 24px, and
        tests/ui/test_target_size.py never measured one because its collector
        matched only buttons."""
        _loaded(page, app_server)
        box = _checkbox(page, "Leaf task").bounding_box()
        assert box["width"] >= 24 and box["height"] >= 24, box

    def test_the_visible_control_stays_small(self, page, app_server):
        """The target grows with padding rather than by growing the box, so a
        dense checklist row does not gain a 24px square per line."""
        _loaded(page, app_server)
        inner = _checkbox(page, "Leaf task").evaluate(
            "n => { const i = n.shadowRoot.querySelector('input');"
            "       const r = i.getBoundingClientRect();"
            "       return { w: r.width, h: r.height }; }"
        )
        assert inner["w"] <= 16 and inner["h"] <= 16, inner
