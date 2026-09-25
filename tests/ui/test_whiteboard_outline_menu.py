"""The right-click menu on a Plan structure row, and the same items on a note.

A right-click on any row of the whiteboard's Plan structure panel opens a menu
for that task (rename, edit, assign resources, indent, outdent, delete), and
it works the same on the host's board and on a planning-session
collaborator's. A collaborator has no task-details form -- that is the
host's app -- so "Edit task…" there opens the board's quick editor instead.

A note's own right-click menu (its More menu) carries the same six items,
alongside the note-only ones (colour, unlink, parking lot, remove).

Usage:
    uv run pytest tests/ui/test_whiteboard_outline_menu.py -q
"""

import pytest

from .helpers import load_plan, open_app, plan_text, switch_to_whiteboard

PLAN = """---
title: Outline Menu Test Plan
---
Alpha @kev
  Alpha one 1d
  Alpha two 2d
Beta
  Beta one 1d

---whiteboard---
| Task  | X   | Y  | Colour  | Width | Height | Collapsed |
|-------|-----|----|---------|-------|--------|-----------|
| Alpha | 360 | 60 | #FFAFA3 | 240   | 180    | no        |
| Beta  | 660 | 60 |         | 240   | 180    | no        |
"""

MENU = "#wbNoteMenu"
LABELS = ["Rename", "Edit task…", "Assign resources…", "Indent", "Outdent", "Delete task"]


def row(pg, task):
    return pg.locator(f'.wb-outline-row[data-task="{task}"]')


def open_row_menu(pg, task):
    row(pg, task).locator(".wb-outline-label").click(button="right")
    pg.wait_for_selector(MENU, state="visible")


def menu_item(pg, label):
    return pg.locator(f"{MENU} [role=menuitem]", has_text=label)


def outline_lines(text):
    """The plan's task outline, without the front matter or back matter."""
    body = text.split("---whiteboard---")[0].split("---", 2)[-1]
    return [line for line in body.splitlines() if line.strip()]


@pytest.fixture
def board(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    switch_to_whiteboard(page, expected_notes=2)
    return page


class TestTheMenu:
    def test_right_click_on_a_row_opens_its_menu(self, board):
        open_row_menu(board, "Alpha two")
        labels = board.evaluate(
            "() => [...document.querySelectorAll('#wbNoteMenu [role=menuitem]')]"
            "        .map(n => n.textContent.trim())"
        )
        assert labels == LABELS
        assert board.get_attribute(MENU, "aria-label") == "Options for Alpha two"

    def test_escape_closes_it_and_returns_focus_to_the_row(self, board):
        open_row_menu(board, "Alpha two")
        board.keyboard.press("Escape")
        board.wait_for_selector(MENU, state="detached")
        assert board.evaluate(
            "() => document.activeElement.closest('.wb-outline-row').dataset.task"
        ) == "Alpha two"

    def test_the_context_menu_key_opens_it_too(self, board):
        row(board, "Beta").locator(".wb-outline-label").focus()
        board.keyboard.press("Shift+F10")
        board.wait_for_selector(MENU, state="visible")
        assert board.get_attribute(MENU, "aria-label") == "Options for Beta"


class TestIndentAndOutdent:
    def test_indent_nests_a_task_under_the_one_above(self, board):
        open_row_menu(board, "Alpha two")
        menu_item(board, "Indent").click()
        board.wait_for_function(
            "() => document.getElementById('planEditor').value.includes('\\n    Alpha two 2d')"
        )
        assert outline_lines(plan_text(board))[:3] == [
            "Alpha @kev", "  Alpha one 1d", "    Alpha two 2d",
        ]

    def test_outdent_moves_a_task_up_a_level(self, board):
        open_row_menu(board, "Alpha two")
        menu_item(board, "Outdent").click()
        board.wait_for_function(
            "() => /\\nAlpha two 2d/.test(document.getElementById('planEditor').value)"
        )
        assert outline_lines(plan_text(board)) == [
            "Alpha @kev", "  Alpha one 1d", "Alpha two 2d", "Beta", "  Beta one 1d",
        ]

    def test_indent_is_disabled_for_a_first_child(self, board):
        before = plan_text(board)
        open_row_menu(board, "Alpha one")
        indent = menu_item(board, "Indent")
        assert indent.get_attribute("aria-disabled") == "true"
        # Forced: Playwright will not click an aria-disabled item, but a user can.
        indent.click(force=True)
        assert board.locator(MENU).is_visible(), "a disabled item does not close the menu"
        assert plan_text(board) == before

    def test_outdent_is_disabled_at_the_top_level(self, board):
        open_row_menu(board, "Beta")
        assert menu_item(board, "Outdent").get_attribute("aria-disabled") == "true"
        assert menu_item(board, "Indent").get_attribute("aria-disabled") is None

    def test_indent_is_one_undo_step(self, board):
        before = plan_text(board)
        open_row_menu(board, "Beta")
        menu_item(board, "Indent").click()
        board.wait_for_function(
            "b => document.getElementById('planEditor').value !== b", arg=before
        )
        board.evaluate("() => EditorUndoManager.undo()")
        board.wait_for_function(
            "b => document.getElementById('planEditor').value === b", arg=before
        )


class TestTheOtherItems:
    def test_rename_edits_the_row_in_place(self, board):
        open_row_menu(board, "Beta one")
        menu_item(board, "Rename").click()
        field = board.locator(".wb-outline-rename-input")
        field.fill("Beta first")
        field.press("Enter")
        board.wait_for_function(
            "() => document.getElementById('planEditor').value.includes('Beta first 1d')"
        )

    def test_assign_resources_opens_the_quick_assign_menu(self, board):
        open_row_menu(board, "Beta one")
        menu_item(board, "Assign resources…").click()
        board.wait_for_selector(".wb-resource-menu", state="visible")
        board.locator(".wb-resource-menu .wb-resource-choice", has_text="kev").click()
        board.wait_for_function(
            "() => document.getElementById('planEditor').value.includes('Beta one 1d @kev')"
        )

    def test_edit_task_opens_the_task_details_form_on_the_host(self, board):
        open_row_menu(board, "Alpha one")
        menu_item(board, "Edit task…").click()
        board.wait_for_function(
            "() => document.getElementById('taskName').value === 'Alpha one'"
        )

    def test_delete_task_removes_it_after_confirming(self, board):
        board.once("dialog", lambda dialog: dialog.accept())
        open_row_menu(board, "Beta")
        menu_item(board, "Delete task").click()
        board.wait_for_function(
            "() => !/^Beta/m.test(document.getElementById('planEditor').value)"
        )
        text = plan_text(board)
        assert "Beta one" not in text, "its subtasks go with it"
        assert "| Beta " not in text, "and so does its whiteboard row"

    def test_declining_the_confirmation_deletes_nothing(self, board):
        before = plan_text(board)
        board.once("dialog", lambda dialog: dialog.dismiss())
        open_row_menu(board, "Beta")
        menu_item(board, "Delete task").click()
        board.wait_for_selector(MENU, state="detached")
        assert plan_text(board) == before


# ── On a planning-session collaborator's board ─────────────────────────────


def host_plan(host_page):
    return host_page.evaluate("() => document.getElementById('planEditor').value")


@pytest.fixture
def host(page, app_server):
    host_page = page.context.new_page()
    host_page.set_default_timeout(15_000)
    open_app(host_page, app_server)
    load_plan(host_page, PLAN)
    switch_to_whiteboard(host_page, expected_notes=2)
    host_page.evaluate("() => startCollabSession()")
    host_page.wait_for_function(
        "() => document.getElementById('collabSessionCode').value.length === 6"
    )
    code = host_page.input_value("#collabSessionCode")
    host_page.evaluate("() => minimiseCollabSessionModal()")
    yield host_page, code
    host_page.close()


@pytest.fixture
def joiner(page, app_server, host):
    _, code = host
    page.set_default_timeout(15_000)
    page.goto(f"{app_server}/join")
    page.fill("#joinCode", code)
    page.fill("#displayName", "Alex")
    page.click("#joinBtn")
    page.wait_for_selector("#relayInput", state="visible")
    page.wait_for_function(
        "() => document.querySelectorAll('#whiteboardContainer .wb-note').length === 2"
    )
    page.bring_to_front()
    return page


class TestOnACollaboratorsBoard:
    def test_the_menu_is_there(self, joiner):
        open_row_menu(joiner, "Alpha two")
        labels = joiner.evaluate(
            "() => [...document.querySelectorAll('#wbNoteMenu [role=menuitem]')]"
            "        .map(n => n.textContent.trim())"
        )
        assert labels == LABELS

    def test_indent_reaches_the_host(self, joiner, host):
        host_page, _ = host
        open_row_menu(joiner, "Alpha two")
        menu_item(joiner, "Indent").click()
        host_page.wait_for_function(
            "() => document.getElementById('planEditor').value.includes('\\n    Alpha two 2d')"
        )

    def test_edit_task_opens_the_quick_editor_and_saves_to_the_host(self, joiner, host):
        host_page, _ = host
        open_row_menu(joiner, "Alpha one")
        menu_item(joiner, "Edit task…").click()
        editor = joiner.locator(".wb-quick-edit")
        editor.wait_for(state="visible")
        assert joiner.input_value("#wbQuickEditDuration") == "1d"
        joiner.fill("#wbQuickEditDuration", "3d")
        joiner.fill("#wbQuickEditPercent", "40")
        joiner.fill("#wbQuickEditComment", "Needs sign-off")
        joiner.locator(".wb-quick-edit np-button[variant=primary]").click()
        editor.wait_for(state="detached")
        host_page.wait_for_function(
            "() => document.getElementById('planEditor').value"
            "        .includes('Alpha one 3d 40% \"Needs sign-off\"')"
        )

    def test_the_quick_editor_refuses_a_bad_duration(self, joiner):
        before = joiner.evaluate("() => document.getElementById('planEditor').value")
        open_row_menu(joiner, "Alpha one")
        menu_item(joiner, "Edit task…").click()
        joiner.fill("#wbQuickEditDuration", "soon")
        joiner.press("#wbQuickEditDuration", "Enter")
        assert joiner.locator(".wb-quick-edit-error").is_visible()
        assert joiner.locator(".wb-quick-edit").is_visible(), "it stays open to fix"
        joiner.keyboard.press("Escape")
        joiner.wait_for_selector(".wb-quick-edit", state="detached")
        assert joiner.evaluate("() => document.getElementById('planEditor').value") == before

    def test_a_summary_task_has_no_duration_field(self, joiner):
        open_row_menu(joiner, "Alpha")
        menu_item(joiner, "Edit task…").click()
        joiner.wait_for_selector(".wb-quick-edit", state="visible")
        assert joiner.locator("#wbQuickEditDuration").count() == 0
        assert joiner.locator("#wbQuickEditPercent").is_visible()


# ── The same items on a note's own right-click menu ─────────────────────────


def open_note_context_menu(pg, task):
    header = pg.locator(f'#whiteboardContainer .wb-note[data-wb-task="{task}"] .wb-note-header')
    box = header.bounding_box()
    pg.mouse.click(box["x"] + 12, box["y"] + box["height"] / 2, button="right")
    pg.wait_for_selector(MENU, state="visible")


def menu_labels(pg):
    return pg.evaluate(
        "() => [...document.querySelectorAll('#wbNoteMenu [role=menuitem]')]"
        "        .map(n => n.textContent.trim())"
    )


class TestOnANote:
    def test_a_notes_menu_has_every_row_menu_item(self, board):
        open_note_context_menu(board, "Beta")
        labels = menu_labels(board)
        for label in LABELS:
            assert label in labels, f"{label!r} is on the note's menu"

    def test_indent_from_a_note(self, board):
        open_note_context_menu(board, "Beta")
        menu_item(board, "Indent").click()
        board.wait_for_function(
            "() => document.getElementById('planEditor').value.includes('\\n  Beta\\n    Beta one 1d')"
        )

    def test_outdent_is_disabled_on_a_top_level_note(self, board):
        open_note_context_menu(board, "Beta")
        assert menu_item(board, "Outdent").get_attribute("aria-disabled") == "true"

    def test_assign_resources_from_a_note(self, board):
        open_note_context_menu(board, "Beta")
        menu_item(board, "Assign resources…").click()
        board.wait_for_selector(".wb-resource-menu", state="visible")
        board.locator(".wb-resource-menu .wb-resource-choice", has_text="kev").click()
        board.wait_for_function(
            "() => /\\nBeta @kev\\n/.test(document.getElementById('planEditor').value)"
        )

    def test_edit_task_from_a_note_opens_the_task_form(self, board):
        open_note_context_menu(board, "Beta")
        menu_item(board, "Edit task…").click()
        board.wait_for_function("() => document.getElementById('taskName').value === 'Beta'")

    def test_a_collaborators_note_menu_opens_the_quick_editor(self, joiner, host):
        host_page, _ = host
        joiner.evaluate("() => whiteboardZoomFit()")
        joiner.wait_for_timeout(300)
        open_note_context_menu(joiner, "Beta")
        assert "Indent" in menu_labels(joiner)
        menu_item(joiner, "Edit task…").click()
        joiner.wait_for_selector(".wb-quick-edit", state="visible")
        joiner.fill("#wbQuickEditComment", "From the note")
        joiner.locator(".wb-quick-edit np-button[variant=primary]").click()
        host_page.wait_for_function(
            "() => document.getElementById('planEditor').value.includes('Beta \"From the note\"')"
        )
