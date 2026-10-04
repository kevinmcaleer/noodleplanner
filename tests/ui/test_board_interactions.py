"""Everyday Board interactions, driven with real mouse and keyboard input.

Each test drives the board the way a person would -- a real drag from a card, a
real click on a column title, real key presses -- and then checks the three
things a user notices first: the page still answers, nothing threw, and the
plan text says what the board shows.

The "page still answers" check is what a hang looks like to a test: a stuck
main thread makes the next `page.evaluate` time out, so `assert_responsive`
fails instead of the whole run stalling. The Add Phase hang was this shape:
the name prompt opened inside the native `drop` event, which left the page
unresponsive, and the synthetic-event tests in test_usability.py could not see
it because they never run a real drag.
"""

import pytest

from tests.ui.helpers import open_project_view, set_editor_value

PLAN = "Phase One\n  Task A 0%\n  Task C 0%\nPhase Two\n  Task B 0%"

# window.prompt() is replaced so a test can answer it deterministically, and so
# it can tell whether the prompt opened while a native drop was being handled.
PROMPT_SPY = """
() => {
    window.__prompts = [];
    window.__answers = [];
    window.__inDrop = false;
    window.addEventListener('drop', () => {
        window.__inDrop = true;
        setTimeout(() => { window.__inDrop = false; }, 0);
    }, true);
    window.prompt = (label) => {
        window.__prompts.push({ label, duringDrop: window.__inDrop });
        return window.__answers.length ? window.__answers.shift() : null;
    };
}
"""


def answer_prompts(page, *answers):
    page.evaluate("(answers) => { window.__answers = answers; }", list(answers))


def prompts(page):
    return page.evaluate("() => window.__prompts")


def app_errors(page):
    # The suite blocks the CDN, so failed subresource loads are expected.
    return [e for e in page.console_errors if "Failed to load resource" not in e]


def assert_responsive(page):
    assert page.evaluate("() => 1 + 1") == 2
    assert app_errors(page) == []


def editor_text(page):
    return page.evaluate("() => document.getElementById('planEditor').value")


def column_titles(page):
    return page.evaluate(
        "() => [...document.querySelectorAll('.kanban-column-title')].map(e => e.textContent)"
    )


def card(page, name):
    return page.locator(f'.kanban-card[data-task-name="{name}"]')


@pytest.fixture
def board(page, app_server):
    open_project_view(page, app_server)
    set_editor_value(page, PLAN)
    page.evaluate("() => switchPlanSubnavToBoard()")
    page.wait_for_selector(".kanban-card")
    page.evaluate(PROMPT_SPY)
    return page


def test_drag_card_to_another_column(board):
    card(board, "Task A").drag_to(board.locator('.kanban-column-body[data-column-title="Phase Two"]'))
    board.wait_for_function(
        "() => document.getElementById('planEditor').value.includes('Task B 0%\\n  Task A 0%')"
    )
    assert_responsive(board)


@pytest.mark.parametrize("title", ["proposal", "Proposal", "Phase Three"])
def test_drag_card_to_add_phase_names_the_phase(board, title):
    answer_prompts(board, title)
    card(board, "Task A").drag_to(board.locator('[data-drop-target="new-column"]'))
    board.wait_for_function(
        "(title) => [...document.querySelectorAll('.kanban-column-title')]"
        ".some(e => e.textContent === title)",
        arg=title,
    )
    assert_responsive(board)
    assert f"{title}\n  Task A 0%" in editor_text(board)
    # The prompt must not open inside the native drop, or the page hangs.
    assert [p["duringDrop"] for p in prompts(board)] == [False]


def test_drag_only_card_to_add_phase_drops_emptied_phase(board):
    answer_prompts(board, "proposal")
    card(board, "Task B").drag_to(board.locator('[data-drop-target="new-column"]'))
    board.wait_for_function(
        "() => [...document.querySelectorAll('.kanban-column-title')]"
        ".some(e => e.textContent === 'proposal')"
    )
    assert_responsive(board)
    assert column_titles(board) == ["Phase One", "proposal"]


def test_cancelled_add_phase_prompt_changes_nothing(board):
    answer_prompts(board, None)
    card(board, "Task A").drag_to(board.locator('[data-drop-target="new-column"]'))
    board.wait_for_function("() => window.__prompts.length === 1")
    assert_responsive(board)
    assert editor_text(board).count("Task A") == 1
    assert column_titles(board) == ["Phase One", "Phase Two"]


def test_add_phase_button_creates_empty_phase(board):
    answer_prompts(board, "proposal")
    board.locator(".kanban-add-column-btn").click()
    board.wait_for_function(
        "() => [...document.querySelectorAll('.kanban-column-title')]"
        ".some(e => e.textContent === 'proposal')"
    )
    assert_responsive(board)


def test_rename_phase_by_clicking_its_title(board):
    answer_prompts(board, "Discovery")
    board.locator(".kanban-column-title", has_text="Phase One").click()
    board.wait_for_function(
        "() => [...document.querySelectorAll('.kanban-column-title')]"
        ".some(e => e.textContent === 'Discovery')"
    )
    assert_responsive(board)
    assert "Discovery\n  Task A 0%" in editor_text(board)
    assert "Phase One" not in editor_text(board)


def test_add_task_to_a_column(board):
    column = board.locator('.kanban-column[data-column-title="Phase Two"]')
    column.locator(".kanban-add-card-btn").click()
    board.wait_for_function(
        "() => document.getElementById('planEditor').value.includes('New Task')"
    )
    assert_responsive(board)
    assert column.locator(".kanban-card").count() == 2


def test_keyboard_moves_card_between_columns(board):
    card(board, "Task A").focus()
    board.keyboard.press("Alt+ArrowRight")
    board.wait_for_function(
        "() => document.getElementById('planEditor').value.includes('Task B 0%\\n  Task A 0%')"
    )
    assert_responsive(board)


def test_keyboard_reorders_card_within_column(board):
    card(board, "Task C").focus()
    board.keyboard.press("Alt+ArrowUp")
    board.wait_for_function(
        "() => document.getElementById('planEditor').value.includes('Task C 0%\\n  Task A 0%')"
    )
    assert_responsive(board)


def test_repeated_drags_keep_the_page_responsive(board):
    """A burst of ordinary use: move, create a phase, move back, rename."""
    answer_prompts(board, "proposal", "Review")
    card(board, "Task A").drag_to(board.locator('[data-drop-target="new-column"]'))
    board.wait_for_function(
        "() => document.querySelectorAll('.kanban-column').length === 3"
    )
    card(board, "Task A").drag_to(board.locator('.kanban-column-body[data-column-title="Phase Two"]'))
    board.wait_for_function(
        "() => document.getElementById('planEditor').value.includes('Task B 0%\\n  Task A 0%')"
    )
    board.locator(".kanban-column-title", has_text="Phase Two").click()
    assert_responsive(board)
    assert all(not p["duringDrop"] for p in prompts(board))
