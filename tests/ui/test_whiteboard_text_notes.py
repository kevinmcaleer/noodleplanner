"""Text notes (thoughts): turning a task back into one, and how one looks.

*   **Turn into text note.** The note menu's way back from "Promote to task":
    the task's line is commented out, so it leaves the schedule, and the same
    card stays on the board as a text note holding the task's comment.
    Refused for a task with subtasks (they would be orphaned) and for one
    other tasks depend on (the dependencies would dangle).
*   **No colour.** A text note is always the --np-light-grey-subtle token,
    never a pastel, and offers no colour to pick.

Usage:
    uv run pytest tests/ui/test_whiteboard_text_notes.py -q
"""

from .helpers import load_plan, note, open_app, open_note_menu, plan_text, switch_to_whiteboard

PLAN = """---
title: Text Note Test Plan
---

Idea 2d "worth a look"
Parent
  Child
Base
Follower [depends Base]

---whiteboard---
| Task     | X   | Y   | Colour  | Width | Height | Collapsed |
|----------|-----|-----|---------|-------|--------|-----------|
| Idea     | 60  | 120 | #FFAFA3 | 240   | 180    | no        |
| Parent   | 360 | 120 |         | 240   | 180    | no        |
| Base     | 660 | 120 |         | 240   | 180    | no        |
| Follower | 960 | 120 |         | 240   | 180    | no        |
"""

DEMOTE = "#wbNoteMenu .wb-note-menu-demote"


def board(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    switch_to_whiteboard(page, expected_notes=4)


def outline_line(page, name):
    return next(line for line in plan_text(page).split("---whiteboard---")[0].split("\n")
                if name in line)


def token(page):
    return page.evaluate(
        "() => getComputedStyle(document.documentElement)"
        ".getPropertyValue('--np-light-grey-subtle').trim().toLowerCase()")


class TestTurnIntoTextNote:
    def test_it_comments_the_task_out_and_keeps_the_card(self, page, app_server):
        board(page, app_server)
        open_note_menu(page, "Idea")
        page.locator(DEMOTE).dispatch_event("click")
        page.wait_for_selector(".wb-note[data-wb-task='Idea'] .wb-note-card.wb-note-thought")
        assert outline_line(page, "Idea").strip() == '// Idea 2d "worth a look"'
        assert page.locator(".wb-note[data-wb-task='Idea'] .wb-note-thought-text").text_content() \
            == "worth a look"

    def test_promoting_it_again_restores_the_task(self, page, app_server):
        board(page, app_server)
        open_note_menu(page, "Idea")
        page.locator(DEMOTE).dispatch_event("click")
        page.wait_for_selector(".wb-note[data-wb-task='Idea'] .wb-note-card.wb-note-thought")
        open_note_menu(page, "Idea")
        page.locator("#wbNoteMenu .wb-note-menu-promote-thought").dispatch_event("click")
        page.wait_for_function(
            "() => !document.querySelector(\".wb-note[data-wb-task='Idea'] .wb-note-card.wb-note-thought\")")
        assert outline_line(page, "Idea").strip() == 'Idea 2d "worth a look"'

    def test_a_task_with_subtasks_is_not_offered_it(self, page, app_server):
        board(page, app_server)
        open_note_menu(page, "Parent")
        page.wait_for_selector("#wbNoteMenu", state="visible")
        assert page.locator(DEMOTE).count() == 0

    def test_a_task_others_depend_on_is_refused(self, page, app_server):
        board(page, app_server)
        before = plan_text(page)
        open_note_menu(page, "Base")
        page.locator(DEMOTE).dispatch_event("click")
        page.wait_for_timeout(300)
        assert plan_text(page) == before
        assert page.locator(".wb-note[data-wb-task='Base'] .wb-note-card.wb-note-thought").count() == 0


class TestTextNotesAreGrey:
    def _demote_idea(self, page):
        open_note_menu(page, "Idea")
        page.locator(DEMOTE).dispatch_event("click")
        page.wait_for_selector(".wb-note[data-wb-task='Idea'] .wb-note-card.wb-note-thought")

    def test_the_fill_is_the_light_grey_token_whatever_its_colour(self, page, app_server):
        board(page, app_server)
        self._demote_idea(page)
        accent = page.evaluate(
            "() => document.querySelector(\".wb-note[data-wb-task='Idea'] .wb-note-card\")"
            ".style.getPropertyValue('--wb-note-accent').trim().toLowerCase()")
        assert accent == token(page)
        assert "#FFAFA3" in plan_text(page), "the row keeps its colour for a later promote"

    def test_a_new_text_note_is_grey_too(self, page, app_server):
        board(page, app_server)
        name = page.evaluate("() => wbCreateThoughtInViewportCentre()")
        page.keyboard.press("Escape")
        page.wait_for_selector(f".wb-note[data-wb-task='{name}'] .wb-note-card.wb-note-thought")
        accent = page.evaluate(
            f"() => document.querySelector(\".wb-note[data-wb-task='{name}'] .wb-note-card\")"
            ".style.getPropertyValue('--wb-note-accent').trim().toLowerCase()")
        assert accent == token(page)

    def test_no_colour_to_pick(self, page, app_server):
        board(page, app_server)
        self._demote_idea(page)
        page.evaluate("() => wbSetSelectedNote('Idea')")
        page.wait_for_selector(".wb-object-toolbar", state="visible")
        assert page.locator(".wb-object-toolbar .wb-object-toolbar-colour").count() == 0
        open_note_menu(page, "Idea")
        page.wait_for_selector("#wbNoteMenu", state="visible")
        assert page.locator("#wbNoteMenu .wb-note-menu-swatch").count() == 0
