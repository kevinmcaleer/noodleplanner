"""The board card's right-click menu: rename, progress, label, bucket, resource,
dependent task and delete -- each one edit of the plan text."""

import pytest

from tests.ui.test_board_interactions import (
    app_errors,
    card,
    card_names,
    editor_text,
    load_board,
    settle,
)

PLAN = (
    "---\ntitle: T\nlabels: [design]\nresources:\n  - @kev: Kev Smith\n  - @sam: Sam Jones\n---\n"
    "Phase One\n  Task A 3d 0% @kev #design\n  Task B 2d 25%\n"
)


@pytest.fixture
def board(page, app_server):
    return load_board(page, app_server, PLAN)


def open_menu(page, name="Task A"):
    card(page, name).click(button="right")
    page.wait_for_selector("np-menu.kanban-card-menu [role^=menuitem]")


def pick(page, text):
    page.locator("np-menu.kanban-card-menu [role^=menuitem]", has_text=text).first.click()


def enter(page, text):
    entry = page.locator("np-menu.kanban-card-menu .wb-note-menu-input")
    entry.fill(text)
    entry.press("Enter")


def line_of(page, name):
    return next(l.strip() for l in editor_text(page).splitlines() if l.strip().startswith(name))


def test_right_click_opens_the_menu_and_escape_closes_it(board):
    open_menu(board)
    labels = board.locator("np-menu.kanban-card-menu [role^=menuitem]").all_inner_texts()
    assert labels[0] == "Rename"
    assert [l.replace("✓", "").strip() for l in labels[1:6]] == ["0%", "25%", "50%", "75%", "100%"]
    assert "Add dependent task" in labels and labels[-1] == "Delete task"
    assert board.locator('.wb-note-menu-tick:text("✓")').count() == 1  # Task A is at 0%
    board.keyboard.press("Escape")
    assert board.locator("np-menu.kanban-card-menu").count() == 0
    assert app_errors(board) == []


def test_a_press_outside_closes_it(board):
    open_menu(board)
    board.mouse.click(5, 5)
    assert board.locator("np-menu.kanban-card-menu").count() == 0


@pytest.mark.parametrize("percent", [25, 50, 75, 100])
def test_progress(board, percent):
    open_menu(board)
    pick(board, f"{percent}%")
    board.wait_for_function(f"() => document.getElementById('planEditor').value.includes('Task A 3d @kev #design {percent}%')")


def test_progress_zero(board):
    open_menu(board, "Task B")
    pick(board, "0%")
    board.wait_for_function("() => document.getElementById('planEditor').value.includes('Task B 2d 0%')")


def test_rename(board):
    open_menu(board)
    pick(board, "Rename")
    field = board.locator(".kanban-card-title-input")
    field.fill("Task Z")
    field.press("Enter")
    board.wait_for_function("() => document.getElementById('planEditor').value.includes('Task Z 3d')")
    assert "Task A" not in card_names(board)


def test_delete_confirms(board):
    open_menu(board)
    pick(board, "Delete task")
    assert board.dialogs and "Task A" in board.dialogs[0]
    assert "Task A" in card_names(board)  # dismissed
    board.dialog_answer = ""  # accept
    open_menu(board)
    pick(board, "Delete task")
    board.wait_for_function("() => !document.getElementById('planEditor').value.includes('Task A')")
    assert card_names(board) == ["Task B"]


def test_existing_label_toggles(board):
    open_menu(board, "Task B")
    pick(board, "Label")
    pick(board, "design")
    board.wait_for_function("() => /Task B 2d #design 25%/.test(document.getElementById('planEditor').value)")
    open_menu(board, "Task B")
    pick(board, "Label")
    assert board.locator('[role=menuitemcheckbox][aria-checked=true]').count() == 1
    pick(board, "design")
    board.wait_for_function("() => !/Task B[^\\n]*#design/.test(document.getElementById('planEditor').value)")


def test_new_label_is_added_to_the_task_and_the_plan(board):
    open_menu(board, "Task B")
    pick(board, "Label")
    enter(board, "Needs Review")
    board.wait_for_function("() => document.getElementById('planEditor').value.includes('#needs_review')")
    assert "labels: [design, needs_review]" in editor_text(board)


def test_bucket_new_then_existing(board):
    open_menu(board)
    pick(board, "Bucket")
    enter(board, "Backlog")
    board.wait_for_function("() => document.getElementById('planEditor').value.includes('{Backlog}')")
    assert "buckets: [Backlog]" in editor_text(board)
    settle(board)
    open_menu(board, "Task B")
    pick(board, "Bucket")
    pick(board, "Backlog")
    board.wait_for_function("() => /Task B[^\\n]*\\{Backlog\\}/.test(document.getElementById('planEditor').value)")


def test_resource_existing_and_new(board):
    open_menu(board, "Task B")
    pick(board, "Resource")
    pick(board, "Sam Jones")
    board.wait_for_function("() => /Task B[^\\n]*@sam/.test(document.getElementById('planEditor').value)")
    settle(board)
    open_menu(board, "Task B")
    pick(board, "Resource")
    enter(board, "@alex")
    board.wait_for_function("() => /Task B[^\\n]*@sam[^\\n]*@alex|Task B[^\\n]*@alex/.test(document.getElementById('planEditor').value)")


def test_dependent_task(board):
    open_menu(board)
    pick(board, "Add dependent task")
    field = board.locator(".kanban-card-title-input")
    field.wait_for(state="visible")
    field.fill("Follow up")
    field.press("Enter")
    board.wait_for_function("() => /Follow up[^\\n]*\\[depends: Task A\\]/.test(document.getElementById('planEditor').value)")
    assert app_errors(board) == []


def test_the_menu_stays_in_the_viewport_and_walks_by_keyboard(board):
    card(board, "Task B").click(button="right", position={"x": 5, "y": 5})
    board.wait_for_selector("np-menu.kanban-card-menu [role^=menuitem]")
    box = board.locator("np-menu.kanban-card-menu").bounding_box()
    assert box["x"] >= 0 and box["y"] >= 0
    assert box["x"] + box["width"] <= 1900 and box["y"] + box["height"] <= 900
    board.keyboard.press("ArrowDown")
    assert board.evaluate("() => document.activeElement.textContent.includes('0%')")
