"""Everyday Board interactions, driven with real mouse and keyboard input.

Each test drives the board the way a person would -- a real drag from a card, a
real click on a column title, real key presses -- and then checks what a user
notices first: the page still answers, nothing threw, no modal dialog opened
during a drag, and the plan text and the board agree on what exists afterwards
(the new column is there, the card is in it, no other card disappeared).

`assert_responsive` is what a hang looks like to a test: a stuck main thread
makes the next `page.evaluate` time out. `assert_board_state` is what silent
data loss looks like: it compares cards and columns before and after.
"""

import pytest

from tests.ui.helpers import open_project_view, set_editor_value

PLAN = "Phase One\n  Task A 0%\n  Task C 0%\nPhase Two\n  Task B 0%"

# Plans a real project can look like. Each has Task A, Task B and Task C.
PLANS = {
    "plain": PLAN,
    "durations_and_resources": (
        "---\ntitle: T\nstart: 2026-01-05\n---\n"
        "Phase One\n  Task A 3d 0% @kev\n  Task C 2d 0% @sam\nPhase Two\n  Task B 1d 0%\n"
    ),
    "dependencies": (
        "Phase One\n  Task A 3d 0%\n  Task C 2d 0% [depends: Task A]\n"
        "Phase Two\n  Task B 1d 0% [depends: Task C]\n"
    ),
    "dependency_on_dragged_card_reversed": (
        "Phase One\n  Task A 3d 0% [depends: Task C]\n  Task C 2d 0%\n"
        "Phase Two\n  Task B 1d 0% [depends: Task A]\n"
    ),
    "sequential": "Phase One\n  Task A 0%\n  * Task C 0%\nPhase Two\n  * Task B 0%\n",
    "no_metadata": "Phase One\n  Task A\n  Task C\nPhase Two\n  Task B\n",
    "blank_lines": "Phase One\n\n  Task A 0%\n\n  Task C 0%\n\nPhase Two\n\n  Task B 0%\n\n",
    "crlf": "Phase One\r\n  Task A 0%\r\n  Task C 0%\r\nPhase Two\r\n  Task B 0%\r\n",
    "trailing_sections": (
        "Phase One\n  Task A 3d 0%\n  Task C 2d 0%\nPhase Two\n  Task B 1d 0%\n\n"
        "---raid log---\n| Type | Description | Status | Score | Owner | Date |\n"
        "|------|-------------|--------|-------|-------|------|\n"
        "| Risk | Server fail | Open   | 8     | John  | 2026-02-13 |\n"
        "---whiteboard---\nrow: Task A\n---parking lot---\n- idea\n"
    ),
    "duplicate_task_names": "Phase One\n  Task A 0%\n  Task C 0%\nPhase Two\n  Task A 0%\n  Task B 0%\n",
}


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


def card_names(page):
    return page.evaluate(
        "() => [...document.querySelectorAll('.kanban-card')].map(e => e.dataset.taskName)"
    )


def cards_in(page, title):
    return page.evaluate(
        """(title) => [...document.querySelectorAll('.kanban-column')]
            .filter(col => col.querySelector('.kanban-column-title')?.textContent === title)
            .flatMap(col => [...col.querySelectorAll('.kanban-card')].map(e => e.dataset.taskName))""",
        title,
    )


def card(page, name):
    return page.locator(f'.kanban-card[data-task-name="{name}"]').first


def start_add_phase_drag(page, name):
    """Drag a card onto Add Phase and return once the name field is open."""
    card(page, name).drag_to(page.locator('[data-drop-target="new-column"]'))
    field = page.locator(".kanban-add-column-input")
    field.wait_for(state="visible")
    return field


def drop_on_add_phase(page, card_name, phase_name):
    field = start_add_phase_drag(page, card_name)
    field.fill(phase_name)
    field.press("Enter")


def wait_for_column(page, title):
    page.wait_for_function(
        "(title) => [...document.querySelectorAll('.kanban-column-title')]"
        ".some(e => e.textContent === title)",
        arg=title,
    )
    settle(page)


def settle(page):
    """Wait for the app's own follow-up writes (it adds `rag:` to the front
    matter a moment after a render) so the next drag starts from a steady board."""
    page.evaluate(
        """() => new Promise(resolve => {
            const editor = document.getElementById('planEditor');
            let last = editor.value;
            const tick = () => {
                if (editor.value === last) return resolve();
                last = editor.value;
                setTimeout(tick, 250);
            };
            setTimeout(tick, 250);
        })"""
    )
    assert page.evaluate("() => !kanbanBoard.isStale()")


def load_board(page, app_server, plan):
    # Wide enough for four columns and the Add Phase tile without scrolling: a
    # board that scrolls mid-drag starts the drag from a different card.
    page.set_viewport_size({"width": 1900, "height": 900})
    open_project_view(page, app_server)
    set_editor_value(page, plan)
    page.evaluate("() => switchPlanSubnavToBoard()")
    page.wait_for_selector(".kanban-card")
    # A modal dialog during a drag is what hung the page; none must ever open.
    page.dialogs = []
    page.dialog_answer = None

    def on_dialog(dialog):
        page.dialogs.append(dialog.message)
        if page.dialog_answer is None:
            dialog.dismiss()
        else:
            dialog.accept(page.dialog_answer)

    page.on("dialog", on_dialog)
    return page


@pytest.fixture
def board(page, app_server):
    return load_board(page, app_server, PLAN)


def answer_next_dialog(page, text):
    """The rename and Add Phase *button* still use window.prompt()."""
    page.dialog_answer = text


def test_drag_card_to_another_column(board):
    card(board, "Task A").drag_to(board.locator('.kanban-column-body[data-column-title="Phase Two"]'))
    board.wait_for_function(
        "() => document.getElementById('planEditor').value.includes('Task B 0%\\n  Task A 0%')"
    )
    assert_responsive(board)
    assert cards_in(board, "Phase Two") == ["Task B", "Task A"]
    assert sorted(card_names(board)) == ["Task A", "Task B", "Task C"]


# --- Drag to Add Phase -----------------------------------------------------

# Fresh names, names of cards that exist, and names that only differ by case.
PHASE_NAMES = ["proposal", "Proposal", "Phase Three", "Task A", "Task B", "task c", "TASK A"]


@pytest.mark.parametrize("plan", PLANS)
@pytest.mark.parametrize("name", PHASE_NAMES)
def test_drag_to_add_phase_creates_phase_and_keeps_every_card(page, app_server, plan, name):
    load_board(page, app_server, PLANS[plan])
    cards_before = sorted(card_names(page))
    dragged = "Task A"
    drop_on_add_phase(page, dragged, name)
    wait_for_column(page, name)

    assert_responsive(page)
    assert page.dialogs == [], "a modal dialog opened during the drag"
    assert column_titles(page)[-1] == name
    assert cards_in(page, name) == [dragged], "the card is not in the new phase"
    assert sorted(card_names(page)) == cards_before, "a card was lost or duplicated"
    # The plan text agrees with the board: one header line, with the card under it.
    lines = editor_text(page).replace("\r\n", "\n").split("\n")
    header = next(i for i, line in enumerate(lines) if line == name)
    assert lines[header + 1].lstrip().startswith(dragged)


def test_add_phase_survives_a_reload_of_the_plan(board):
    drop_on_add_phase(board, "Task A", "proposal")
    wait_for_column(board, "proposal")
    text = editor_text(board)
    set_editor_value(board, "")
    set_editor_value(board, text)
    board.evaluate("() => kanbanBoard.parse(); kanbanBoard.render()")
    assert cards_in(board, "proposal") == ["Task A"]
    assert_responsive(board)


def test_drag_only_card_to_add_phase_drops_emptied_phase(board):
    drop_on_add_phase(board, "Task B", "proposal")
    wait_for_column(board, "proposal")
    assert_responsive(board)
    assert column_titles(board) == ["Phase One", "proposal"]
    assert cards_in(board, "proposal") == ["Task B"]


def test_add_phase_name_of_existing_phase_is_refused_inline(board):
    field = start_add_phase_drag(board, "Task A")
    field.fill("phase two")
    field.press("Enter")
    assert "already exists" in board.locator(".kanban-add-column-message").inner_text()
    assert field.is_visible()
    assert editor_text(board).count("Task A") == 1
    field.fill("proposal")
    field.press("Enter")
    wait_for_column(board, "proposal")
    assert cards_in(board, "proposal") == ["Task A"]
    assert_responsive(board)


@pytest.mark.parametrize("how", ["escape", "blur"])
def test_cancelled_add_phase_changes_nothing(board, how):
    before = editor_text(board)
    field = start_add_phase_drag(board, "Task A")
    field.fill("proposal")
    if how == "escape":
        field.press("Escape")
    else:
        board.locator("body").click(position={"x": 5, "y": 5})
    board.locator(".kanban-add-column-input").wait_for(state="detached")
    assert editor_text(board) == before
    assert column_titles(board) == ["Phase One", "Phase Two"]
    assert sorted(card_names(board)) == ["Task A", "Task B", "Task C"]
    assert board.locator(".kanban-add-column-btn").is_visible()
    assert_responsive(board)


def test_empty_add_phase_name_is_ignored(board):
    field = start_add_phase_drag(board, "Task A")
    field.press("Enter")
    assert field.is_visible()
    field.press("Escape")
    assert editor_text(board).count("Task A") == 1


def test_drop_right_after_the_app_rewrites_the_plan_uses_fresh_line_numbers(page, app_server):
    """The app writes `rag:` into the front matter after the first change,
    moving every line down. The board must follow, or the next drop moves the
    wrong task."""
    load_board(page, app_server, PLAN)
    drop_on_add_phase(page, "Task A", "proposal")
    wait_for_column(page, "proposal")
    first_line_of = page.evaluate(
        "() => Object.fromEntries(kanbanBoard.tasks.map(t => [t.name, t.lineNumber]))"
    )
    lines = editor_text(page).split("\n")
    for name, number in first_line_of.items():
        assert lines[number - 1].strip().startswith(name), f"{name} is not on line {number}"
    drop_on_add_phase(page, "Task B", "review")
    wait_for_column(page, "review")
    assert cards_in(page, "review") == ["Task B"]
    assert cards_in(page, "proposal") == ["Task A"]
    assert_responsive(page)


def test_add_phase_twice_in_a_row(board):
    drop_on_add_phase(board, "Task A", "proposal")
    wait_for_column(board, "proposal")
    drop_on_add_phase(board, "Task B", "Task B")
    wait_for_column(board, "Task B")
    assert_responsive(board)
    assert board.dialogs == []
    assert column_titles(board) == ["Phase One", "proposal", "Task B"]
    assert sorted(card_names(board)) == ["Task A", "Task B", "Task C"]


def test_drop_that_cannot_create_the_column_is_reverted(board):
    """If the board and the text ever disagree after a drop, nothing is lost."""
    before = editor_text(board)
    board.evaluate(
        """() => {
            // Simulate a write that loses the card: the verifier must undo it.
            const real = kanbanBoard.commitMarkdown.bind(kanbanBoard);
            let calls = 0;
            kanbanBoard.commitMarkdown = (text, options) => {
                calls++;
                if (calls === 1) text = text.replace(/\\n  Task A 0%/, '');
                return real(text, options);
            };
        }"""
    )
    drop_on_add_phase(board, "Task A", "proposal")
    board.wait_for_function("() => document.querySelector('.kanban-add-column-input') === null")
    board.wait_for_function(
        "(before) => document.getElementById('planEditor').value === before", arg=before
    )
    assert sorted(card_names(board)) == ["Task A", "Task B", "Task C"]
    assert [e for e in app_errors(board) if "change reverted" not in e] == []


# --- Other board features --------------------------------------------------

def test_add_phase_button_creates_empty_phase(board):
    answer_next_dialog(board, "proposal")
    board.locator(".kanban-add-column-btn").click()
    wait_for_column(board, "proposal")
    assert_responsive(board)


def test_rename_phase_by_clicking_its_title(board):
    answer_next_dialog(board, "Discovery")
    board.locator(".kanban-column-title", has_text="Phase One").click()
    wait_for_column(board, "Discovery")
    assert_responsive(board)
    assert "Discovery\n  Task A 0%" in editor_text(board)
    assert "Phase One" not in editor_text(board)
    assert cards_in(board, "Discovery") == ["Task A", "Task C"]


def test_add_task_to_a_column(board):
    column = board.locator('.kanban-column[data-column-title="Phase Two"]')
    column.locator(".kanban-add-card-btn").click()
    board.wait_for_function(
        "() => document.getElementById('planEditor').value.includes('untitled-1')"
    )
    assert_responsive(board)
    assert column.locator(".kanban-card").count() == 2
    # Rapid capture: no task form, and the title is already an input.
    input_ = column.locator(".kanban-card-title-input")
    assert input_.count() == 1
    # A late re-render (renderText) must not lose the edit in progress.
    board.keyboard.type("Wri")
    board.evaluate("() => kanbanBoard.render()")
    board.wait_for_selector(".kanban-card-title-input")
    assert board.locator(".kanban-card-title-input").input_value() == "Wri"
    board.keyboard.type("te brief")
    board.keyboard.press("Enter")
    board.wait_for_function(
        "() => document.getElementById('planEditor').value.includes('Write brief')"
    )
    # Enter commits and opens the next placeholder card for rapid entry.
    board.wait_for_selector(".kanban-card-title-input")
    assert "untitled-1" in editor_text(board)
    board.keyboard.press("Escape")
    board.wait_for_function(
        "() => !document.getElementById('planEditor').value.includes('untitled-')"
    )
    assert "Write brief" in editor_text(board)
    assert_responsive(board)


def test_keyboard_moves_card_between_columns(board):
    card(board, "Task A").focus()
    board.keyboard.press("Alt+ArrowRight")
    board.wait_for_function(
        "() => document.getElementById('planEditor').value.includes('Task B 0%\\n  Task A 0%')"
    )
    assert_responsive(board)
    assert cards_in(board, "Phase Two") == ["Task B", "Task A"]


def test_keyboard_reorders_card_within_column(board):
    card(board, "Task C").focus()
    board.keyboard.press("Alt+ArrowUp")
    board.wait_for_function(
        "() => document.getElementById('planEditor').value.includes('Task C 0%\\n  Task A 0%')"
    )
    assert_responsive(board)
    assert cards_in(board, "Phase One") == ["Task C", "Task A"]


def test_reorder_columns_by_keyboard(board):
    board.locator('.kanban-column[data-column-title="Phase Two"] .kanban-column-header').focus()
    board.keyboard.press("Alt+ArrowLeft")
    board.wait_for_function(
        "() => document.querySelector('.kanban-column-title').textContent === 'Phase Two'"
    )
    assert_responsive(board)
    assert column_titles(board) == ["Phase Two", "Phase One"]


def test_drag_card_onto_another_card_reorders(board):
    card(board, "Task C").drag_to(card(board, "Task A"), target_position={"x": 20, "y": 2})
    board.wait_for_function(
        "() => document.getElementById('planEditor').value.includes('Task C 0%\\n  Task A 0%')"
    )
    assert_responsive(board)
    assert cards_in(board, "Phase One") == ["Task C", "Task A"]


def test_every_view_renders_and_survives_a_drag(board):
    for view in ("phase", "resource", "progress", "label", "bucket"):
        board.evaluate("(view) => switchKanbanView(view)", view)
        assert board.evaluate("() => document.querySelector('.kanban-board, #kanbanBoard') !== null")
        assert_responsive(board)
    board.evaluate("() => switchKanbanView('phase')")
    assert sorted(card_names(board)) == ["Task A", "Task B", "Task C"]


def test_repeated_use_keeps_the_page_responsive(board):
    """A burst of ordinary use: move, create a phase, move back, rename."""
    drop_on_add_phase(board, "Task A", "proposal")
    wait_for_column(board, "proposal")
    card(board, "Task A").drag_to(board.locator('.kanban-column-body[data-column-title="Phase Two"]'))
    board.wait_for_function(
        "() => document.getElementById('planEditor').value.includes('Task B 0%\\n  Task A 0%')"
    )
    answer_next_dialog(board, "Review")
    board.locator(".kanban-column-title", has_text="Phase Two").click()
    wait_for_column(board, "Review")
    assert_responsive(board)
    assert sorted(card_names(board)) == ["Task A", "Task B", "Task C"]
