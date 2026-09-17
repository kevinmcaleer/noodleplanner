"""One resource-assign control per whiteboard checklist row (issue #1244).

Every row used to render *two* always-visible assign controls, from two code
paths that never knew about each other:

  * `.wb-note-row-resource` -- a dashed "+" appended by `wbBuildChildRow()`,
    opening a `.wb-smart-menu.wb-resource-menu` over the plan's front-matter
    resource declarations.
  * `.wb-note-assign-bubble` -- a round "+" appended by
    `wbAppendChildResourceControls()` (issue #1162), opening a
    `.wb-note-menu`-based dropdown over `getAllResourceNames()`.

Both carried the accessible name "Assign a resource to <name>", so a screen
reader announced the same action twice per row, and neither was hidden by CSS.
They arrived from different issues under the same epic (#878) and were never
reconciled. The dashed "+" survived; the bubble is gone.

This file is the browser-level guard on that, because there wasn't one: the
row-level control had no coverage at all before this. The only resource test in
The note *header* used to carry a twin of this control. It was removed when the
header's resting inventory was settled (open question 3 on #1250 -- resources
belong on tasks, not on the summary a post-it stands for), and the one
assertion its test still earned moved here. The pure functions underneath are
covered by `tests/test_whiteboard_notes.js`.

Clicks are dispatched rather than mouse-clicked, for the reason
`tests/ui/test_task_peek.py`'s module docstring gives: the whiteboard is a
pan/zoom canvas and this plan's notes sit outside the visible pane, so no
driver can hit-test them. Same event, same listener.

Usage:
    uv run pytest tests/ui/test_whiteboard_row_assign.py -q
"""

import re

from .helpers import load_plan, note, open_app, plan_text, switch_to_whiteboard

# `Solo` has no resources; `Paired` already has one, so the row renders an
# avatar as well as the assign control -- the case where a second "+" used to
# sit immediately after the avatar stack.
DECLARED_PLAN = """---
title: Row Assign Test Plan
Resources:
  - @sam: Sam Smith, Developer
  - @jo: Jo Lee, Reviewer
---

Phase 1
  Build
    Solo 2d
    Paired @jo 1d
    Noted 1d "Chase the vendor for a quote."

---whiteboard---
| Task  | X   | Y  | Colour | Width | Height | Collapsed |
|-------|-----|----|--------|-------|--------|-----------|
| Build | 480 | 80 |        | 280   | 260    | no        |
"""

# The same plan with no front-matter declarations, only `@tokens` used on task
# lines. Before the merge this was the split that mattered: the bubble listed
# these (via getAllResourceNames()'s own fallback) and the surviving menu said
# "No resources in plan front matter." The survivor now covers both.
UNDECLARED_PLAN = """---
title: Row Assign Fallback Plan
---

Phase 1
  Build
    Solo 2d
    Paired @jo 1d

---whiteboard---
| Task  | X   | Y  | Colour | Width | Height | Collapsed |
|-------|-----|----|--------|-------|--------|-----------|
| Build | 480 | 80 |        | 280   | 260    | no        |
"""


def _rows(page):
    return note(page, "Build").locator(".wb-note-row")


def _row(page, child_name):
    return _rows(page).filter(
        has=page.locator(
            ".wb-note-row-name", has_text=re.compile(rf"^{re.escape(child_name)}$")
        )
    )


def _line_for(page, task_name):
    for line in plan_text(page).split("\n"):
        if line.strip().startswith(task_name):
            return line
    return None


def _open_menu(page, child_name):
    _row(page, child_name).locator(".wb-note-row-resource").dispatch_event("click")
    page.wait_for_selector(".wb-resource-menu", state="visible")
    return page.locator(".wb-resource-menu")


class TestExactlyOneAssignControl:
    def test_each_row_has_one_assign_control_and_no_bubble(self, page, app_server):
        open_app(page, app_server)
        load_plan(page, DECLARED_PLAN)
        switch_to_whiteboard(page)

        rows = _rows(page)
        assert rows.count() == 3, "the Build note renders a row per child task"

        for child in ("Solo", "Paired", "Noted"):
            row = _row(page, child)
            assert (
                row.locator(".wb-note-row-resource").count() == 1
            ), f"{child} renders exactly one resource-assign control"

        # Board-wide, not just on the rows above: the bubble is gone from the
        # tree entirely, not merely absent from the two rows this plan draws.
        assert page.locator(".wb-note-assign-bubble").count() == 0

    def test_an_assigned_row_still_renders_its_avatar(self, page, app_server):
        """The avatars were the bubble's neighbours, not the bubble."""
        open_app(page, app_server)
        load_plan(page, DECLARED_PLAN)
        switch_to_whiteboard(page)

        assert _row(page, "Paired").locator(".wb-note-row-avatar").count() == 1
        assert _row(page, "Solo").locator(".wb-note-row-avatar").count() == 0


class TestTheSurvivingControl:
    def test_clicking_it_writes_the_token_onto_the_childs_own_line(
        self, page, app_server
    ):
        open_app(page, app_server)
        load_plan(page, DECLARED_PLAN)
        switch_to_whiteboard(page)

        menu = _open_menu(page, "Solo")
        assert "Sam Smith" in menu.inner_text()
        menu.locator("button", has_text=re.compile("Sam Smith")).dispatch_event("click")

        page.wait_for_function(
            "() => document.getElementById('planEditor').value"
            "        .split('\\n').some(l => l.trim().startsWith('Solo')"
            "                                  && l.includes('@sam'))"
        )
        # The child's own line, and only it.
        assert "@sam" in _line_for(page, "Solo")
        assert "@sam" not in _line_for(page, "Paired")

    def test_assigning_leaves_the_rest_of_the_line_alone(self, page, app_server):
        """A comment on the task survives the assignment.

        Inherited from tests/test_whiteboard_notes.py's header quick-assign
        test, which went when that control did -- resources belong on tasks,
        not on the summary a post-it stands for (open question 3 on #1250).
        The behaviour it happened to guard is a property of the write path
        rather than of the button that triggered it: wbToggleResourceMenu()
        commits through PlanModel.updateLine(), and the regression it protects
        against is a regex rewriter that rebuilds the line from the tokens it
        recognises and silently drops everything else. That path is still live,
        still shared, and this is the control that still reaches it.
        """
        open_app(page, app_server)
        load_plan(page, DECLARED_PLAN)
        switch_to_whiteboard(page)

        menu = _open_menu(page, "Noted")
        menu.locator("button", has_text=re.compile("Sam Smith")).dispatch_event("click")

        page.wait_for_function(
            "() => document.getElementById('planEditor').value"
            "        .split('\\n').some(l => l.trim().startsWith('Noted')"
            "                                  && l.includes('@sam'))"
        )
        line = _line_for(page, "Noted")
        assert "@sam" in line
        assert '"Chase the vendor for a quote."' in line, (
            f"the assignment rewrote the line and lost the comment: {line!r}"
        )
        assert "1d" in line, f"the assignment lost the duration: {line!r}"

    def test_it_declares_a_popup_before_it_is_ever_opened(self, page, app_server):
        """`aria-haspopup` at render time, not only once the menu has opened.

        The survivor used to set `aria-expanded` from `wbOpenSmartMenu()` and
        never set `aria-haspopup` at all, so a screen reader reaching a
        never-opened row was not told the control opened anything. The deleted
        bubble declared both up front; that behaviour moved across.
        """
        open_app(page, app_server)
        load_plan(page, DECLARED_PLAN)
        switch_to_whiteboard(page)

        control = _row(page, "Solo").locator(".wb-note-row-resource")
        assert control.get_attribute("aria-haspopup") == "menu"
        assert control.get_attribute("aria-expanded") == "false"

    def test_the_menu_is_a_menu_and_takes_the_keyboard(self, page, app_server):
        """Ported from the bubble, which was the only one of the two to have it.

        The surviving popup was a `role="dialog"` of plain buttons that focused
        nothing on open and handled no arrow keys.
        """
        open_app(page, app_server)
        load_plan(page, DECLARED_PLAN)
        switch_to_whiteboard(page)

        menu = _open_menu(page, "Solo")
        assert menu.get_attribute("role") == "menu"

        items = menu.locator('[role="menuitemcheckbox"]')
        assert items.count() == 2, "one menuitem per declared resource"

        # Focus lands on the first choice, and ArrowDown roves to the second.
        assert page.evaluate(
            "() => document.activeElement"
            "        && document.activeElement.classList.contains('wb-resource-choice')"
        )
        first = page.evaluate("() => document.activeElement.textContent")
        page.keyboard.press("ArrowDown")
        assert page.evaluate("() => document.activeElement.textContent") != first

        # Escape closes and hands focus back to the control that opened it.
        page.keyboard.press("Escape")
        page.wait_for_selector(".wb-resource-menu", state="detached")
        assert page.evaluate(
            "() => document.activeElement"
            "        && document.activeElement.classList"
            "             .contains('wb-note-row-resource')"
        )

    def test_it_can_unassign_as_well_as_assign(self, page, app_server):
        """The bubble filtered assigned names out; the survivor toggles."""
        open_app(page, app_server)
        load_plan(page, DECLARED_PLAN)
        switch_to_whiteboard(page)

        menu = _open_menu(page, "Paired")
        jo = menu.locator('[role="menuitemcheckbox"]', has_text=re.compile("Jo Lee"))
        assert jo.get_attribute("aria-checked") == "true"

        jo.dispatch_event("click")
        page.wait_for_function(
            "() => document.getElementById('planEditor').value"
            "        .split('\\n').some(l => l.trim().startsWith('Paired')"
            "                                  && !l.includes('@jo'))"
        )
        assert "@jo" not in _line_for(page, "Paired")


class TestResourceSourceBreadth:
    def test_tokens_without_declarations_still_offer_resources(
        self, page, app_server
    ):
        """The split that made the two controls behave differently.

        With no front matter to read, this menu used to say "No resources in
        plan front matter." while the bubble beside it listed `jo` perfectly
        well. Harvesting the plan's own `@tokens` closes that.
        """
        open_app(page, app_server)
        load_plan(page, UNDECLARED_PLAN)
        switch_to_whiteboard(page)

        menu = _open_menu(page, "Solo")
        assert menu.locator('[role="menuitemcheckbox"]').count() >= 1
        assert "jo" in menu.inner_text()
        assert "No resources" not in menu.inner_text()
