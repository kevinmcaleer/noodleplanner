"""The note's overflow menu: roles and keyboard (issue #1247).

The menu itself was already well behaved about positioning and dismissal. Its
semantics were not: swatches were `menuitem` carrying `aria-checked` (not a
supported combination, so the selected colour was never announced), an unowned
`list`/`listitem` sat between the menu and its buttons, Tab could walk out of
an open menu and leave it open, and arrow traversal collected every item into
one flat ring -- so ArrowDown from "Default colour" stepped through all ten
swatches before reaching "Rename", and the grid's six columns were invisible
to the keyboard.

The Selenium suite covers this menu (tests/test_whiteboard_note_colour.py's
TestNoteMenuOpenClose), but skips wherever chromedriver cannot drive the
installed Chromium. This is the version that runs in CI's gating browser job.

Usage:
    uv run pytest tests/ui/test_whiteboard_note_menu.py -q
"""

from .helpers import load_plan, note, open_app, switch_to_whiteboard

PLAN = """---
title: Note Menu Test Plan
---

Phase 1
  Build
    Leaf 1d

---whiteboard---
| Task  | X   | Y  | Colour  | Width | Height | Collapsed |
|-------|-----|----|---------|-------|--------|-----------|
| Build | 480 | 80 | #FCE38A | 300   | 260    | no        |
"""

MENU = "#wbNoteMenu"


def _open(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    switch_to_whiteboard(page)
    note(page, "Build").locator(".wb-note-menu-btn").dispatch_event("click")
    page.wait_for_selector(MENU, state="visible")
    return page.locator(MENU)


def _items(page):
    return page.evaluate(
        "() => [...document.querySelectorAll("
        "  '#wbNoteMenu [role=menuitem], #wbNoteMenu [role=menuitemradio]')]"
        "  .map(n => ({ role: n.getAttribute('role'),"
        "               text: n.textContent.trim(),"
        "               checked: n.getAttribute('aria-checked') }))"
    )


class TestRoles:
    def test_swatches_are_radios_so_the_selected_colour_is_announced(
        self, page, app_server
    ):
        _open(page, app_server)
        swatches = [i for i in _items(page) if i["role"] == "menuitemradio"]
        assert len(swatches) == 10, "the ten shipped pastels"
        checked = [s for s in swatches if s["checked"] == "true"]
        assert len(checked) == 1, "the note's own colour is the checked one"

    def test_the_list_between_the_menu_and_its_items_is_not_announced(
        self, page, app_server
    ):
        """A menu's children must be menu items."""
        _open(page, app_server)
        role = page.evaluate(
            "() => document.querySelector('#wbNoteMenu .wb-note-menu-list')"
            "        .getAttribute('role')"
        )
        assert role == "none"

    def test_the_destructive_pair_stays_distinguishable_from_parking(
        self, page, app_server
    ):
        """Parking relocates the text; it is deliberately not destructive."""
        _open(page, app_server)
        classes = page.evaluate(
            "() => Object.fromEntries([...document.querySelectorAll("
            "  '#wbNoteMenu button')].map(b => [b.textContent.trim(), b.className]))"
        )
        park = next(v for k, v in classes.items() if "parking lot" in k)
        remove = next(v for k, v in classes.items() if "Remove from board" in k)
        delete = next(v for k, v in classes.items() if "Delete task" in k)
        assert "wb-note-menu-remove" not in park, "parking is not styled destructive"
        assert "wb-note-menu-remove" in remove
        assert "wb-note-menu-delete" in delete, "delete is set apart from remove"


class TestKeyboard:
    def test_opening_focuses_the_first_item(self, page, app_server):
        _open(page, app_server)
        assert page.evaluate("() => document.activeElement.getAttribute('role')") == "menuitem"

    def test_arrow_down_reaches_the_swatch_grid(self, page, app_server):
        _open(page, app_server)
        page.keyboard.press("ArrowDown")
        assert page.evaluate(
            "() => document.activeElement.getAttribute('role')") == "menuitemradio"

    def test_arrow_keys_treat_the_grid_as_a_grid(self, page, app_server):
        """Left/Right within a row, Up/Down between rows. The flat ring this
        replaces stepped one swatch at a time in every direction."""
        _open(page, app_server)
        page.keyboard.press("ArrowDown")  # into the grid, first swatch

        def swatch_index():
            return page.evaluate(
                "() => [...document.querySelectorAll('#wbNoteMenu .wb-note-menu-swatch')]"
                "        .indexOf(document.activeElement)"
            )

        assert swatch_index() == 0
        page.keyboard.press("ArrowRight")
        assert swatch_index() == 1, "Right moves one swatch"
        page.keyboard.press("ArrowDown")
        assert swatch_index() == 7, "Down moves a whole row of six"

    def test_tab_closes_the_menu_instead_of_walking_out_of_it(self, page, app_server):
        _open(page, app_server)
        page.keyboard.press("Tab")
        page.wait_for_selector(MENU, state="detached")

    def test_escape_closes_and_returns_focus_to_the_trigger(self, page, app_server):
        _open(page, app_server)
        page.keyboard.press("Escape")
        page.wait_for_selector(MENU, state="detached")
        assert page.evaluate(
            "() => document.activeElement.classList.contains('wb-note-menu-btn')")


class TestOnePopupAtATime:
    def test_opening_the_menu_closes_an_open_smart_menu(self, page, app_server):
        """None of the three open paths used to close all the others."""
        open_app(page, app_server)
        load_plan(page, PLAN)
        switch_to_whiteboard(page)

        note(page, "Build").locator(".wb-note-resource-btn").dispatch_event("click")
        page.wait_for_selector(".wb-resource-menu", state="visible")
        note(page, "Build").locator(".wb-note-menu-btn").dispatch_event("click")
        page.wait_for_selector(MENU, state="visible")
        page.wait_for_selector(".wb-resource-menu", state="detached")
