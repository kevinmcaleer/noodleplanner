"""The note's resource avatars, now <np-resource-stack> (#1246, under #1199).

The note rendered avatars twice, from two code paths, at two sizes, with two
caps and two data sources: the checklist row's were 14px and uncapped, the
footer's 20px and capped at six with no indication it had capped. Neither was
focusable, neither carried a role, and the only affordance was a native `title`
tooltip -- which never appears on keyboard focus and cannot hold a link.

#1199 asks for a profile circle with initials and a hover card carrying name,
role, email and a way into the resource details form. This covers that, and the
two note renderings going through one component.

Usage:
    uv run pytest tests/ui/test_whiteboard_resource_stack.py -q
"""

import re

from .helpers import load_plan, note, open_app, switch_to_whiteboard

PLAN = """---
title: Resource Stack Test Plan
Resources:
  - @sam: Sam Smith, Developer, sam@example.com
  - @jo: Jo Lee, Reviewer, jo@example.com
  - @al: Alex Ray, Designer
  - @ki: Kim Ito, QA, kim@example.com
  - @ro: Ro Patel, Analyst, ro@example.com
---

Phase 1
  Build @sam @jo
    Crowded @sam @jo @al @ki @ro 2d
    Just one @sam 1d
    Nobody 1d

---whiteboard---
| Task  | X   | Y  | Colour | Width | Height | Collapsed |
|-------|-----|----|--------|-------|--------|-----------|
| Build | 480 | 80 |        | 320   | 320    | no        |
"""


def _row(page, child_name):
    return note(page, "Build").locator(".wb-note-row").filter(
        has=page.locator(
            ".wb-note-row-name", has_text=re.compile(rf"^{re.escape(child_name)}$")
        )
    )


def _row_stack(page, child_name):
    return _row(page, child_name).locator("np-resource-stack")


def _shadow(locator, script):
    return locator.evaluate(f"n => {{ const s = n.shadowRoot; return ({script}); }}")


def _loaded(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    switch_to_whiteboard(page)
    page.wait_for_selector(".wb-note[data-wb-task=Build] np-resource-stack")


class TestTheRowIsTheOnlyRendering:
    """The note used to render this component twice: once per checklist row,
    and once in the footer for the note's own task.

    The footer one is gone. A note maps to a summary task, and assigning
    resources to a summary is bad practice in a plan -- so the board showed,
    as a first-class part of every card, something a planner should not be
    doing. Resources live on the tasks inside the note, which is where the
    rows show them.
    """

    def test_the_row_renders_the_component_and_the_footer_does_not(
        self, page, app_server
    ):
        _loaded(page, app_server)
        card = note(page, "Build")
        assert card.locator(".wb-note-row-slot-people np-resource-stack").count() >= 1
        assert card.locator(".wb-note-footer np-resource-stack").count() == 0, (
            "the footer is rendering a resource stack again"
        )

    def test_the_row_shows_that_child_s_own_resources(self, page, app_server):
        _loaded(page, app_server)
        row = _shadow(_row_stack(page, "Just one"),
                      "[...s.querySelectorAll('.chip:not(.more)')].map(c => c.getAttribute('aria-label'))")
        assert row == ["Sam Smith"], row

    def test_a_child_with_no_resources_of_its_own_inherits_its_parent_s(
        self, page, app_server
    ):
        """Not a behaviour this change introduced -- the old hand-rolled
        avatars read the same `childVm.resources`, which the view model fills
        from the parent when a child names nobody. Asserted here because it
        surprised me while writing these tests, and a stack showing two people
        on a line that mentions none is worth having written down.

        Note the view model also resolves `@sam` to "Sam Smith" before this
        point, which is why the component receives names rather than shortnames.
        """
        _loaded(page, app_server)
        inherited = _shadow(
            _row_stack(page, "Nobody"),
            "[...s.querySelectorAll('.chip:not(.more)')].map(c => c.getAttribute('aria-label'))",
        )
        assert sorted(inherited) == ["Jo Lee", "Sam Smith"], inherited


class TestOverflow:
    def test_it_caps_and_says_how_many_it_hid(self, page, app_server):
        """The row used to be uncapped; the footer capped silently; kanban's
        own rule hides the eleventh onward with nothing to say so."""
        _loaded(page, app_server)
        stack = _row_stack(page, "Crowded")
        assert _shadow(stack, "s.querySelectorAll('.chip:not(.more)').length") == 3
        assert _shadow(stack, "s.querySelector('.chip.more').textContent") == "+2"

    def test_the_overflow_chip_reveals_the_names_it_hid(self, page, app_server):
        """It is a control, not a label."""
        _loaded(page, app_server)
        stack = _row_stack(page, "Crowded")
        stack.evaluate("n => n.shadowRoot.querySelector('.chip.more').dispatchEvent("
                       "new MouseEvent('mouseenter'))")
        text = _shadow(stack, "s.querySelector('.card').textContent")
        assert "Kim Ito" in text and "Ro Patel" in text, text


class TestTheProfileCard:
    def test_hovering_a_chip_shows_name_role_and_email(self, page, app_server):
        _loaded(page, app_server)
        stack = _row_stack(page, "Just one")
        stack.evaluate("n => n.shadowRoot.querySelector('.chip').dispatchEvent("
                       "new MouseEvent('mouseenter'))")
        assert _shadow(stack, "s.querySelector('.card').hidden") is False
        text = _shadow(stack, "s.querySelector('.card').textContent")
        assert "Sam Smith" in text
        assert "Developer" in text
        assert "sam@example.com" in text

    def test_a_resource_with_no_email_gets_no_blank_row(self, page, app_server):
        _loaded(page, app_server)
        stack = _row_stack(page, "Crowded")
        # Alex Ray is the third chip and has no email in the front matter.
        stack.evaluate(
            "n => { const c = [...n.shadowRoot.querySelectorAll('.chip:not(.more)')]"
            "        .find(c => c.getAttribute('aria-label') === 'Alex Ray');"
            "       c.dispatchEvent(new MouseEvent('mouseenter')); }"
        )
        assert _shadow(stack, "s.querySelector('.card .email') === null") is True
        assert "Designer" in _shadow(stack, "s.querySelector('.card').textContent")

    def test_the_card_offers_a_way_into_the_resource_form(self, page, app_server):
        _loaded(page, app_server)
        stack = _row_stack(page, "Just one")
        stack.evaluate("n => n.shadowRoot.querySelector('.chip').dispatchEvent("
                       "new MouseEvent('mouseenter'))")
        assert _shadow(stack, "s.querySelector('.card .open') !== null") is True


class TestKeyboard:
    def test_a_chip_is_focusable_and_focus_opens_the_card(self, page, app_server):
        """Neither old rendering was focusable at all -- the only affordance was
        a native title tooltip, which never appears on keyboard focus."""
        _loaded(page, app_server)
        stack = _row_stack(page, "Just one")
        stack.evaluate("n => n.shadowRoot.querySelector('.chip').focus()")
        assert _shadow(stack, "s.querySelector('.card').hidden") is False

    def test_escape_closes_the_card(self, page, app_server):
        _loaded(page, app_server)
        stack = _row_stack(page, "Just one")
        stack.evaluate("n => n.shadowRoot.querySelector('.chip').focus()")
        page.keyboard.press("Escape")
        assert _shadow(stack, "s.querySelector('.card').hidden") is True
