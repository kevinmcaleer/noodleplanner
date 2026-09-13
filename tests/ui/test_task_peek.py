"""Whiteboard task-peek popover (issue #850, extended by #1016), on Playwright.

Opening a peek from a note's child-count badge/row instead of jumping straight
to the full task inspector; the peek's exact name/assignee/checkbox/badge
content; recursive drill-down with a breadcrumb; ticking a peek checkbox
writing the identical markdown edit a note-level tick would; "Open task
details" from both the peek and the note `...` menu; pan/zoom/scroll
restoration across that round trip; Escape/focus handling; and viewport-edge
repositioning.

The pure breadcrumb-stack/view-model logic is already covered by
tests/test_task_peek.js and tests/test_whiteboard_notes.js's own
wbBuildPeekLevel() section; this file is only for what those can't reach: the
real popover DOM, real focus/keyboard behaviour, the real markdown commit, and
the real task-details round trip.

Ported from tests/test_task_peek.py. The port is where the interaction-heavy
end of the suite pays off most, for two reasons:

  * `load_plan()` there polled the editor until its text had been *unchanged
    for 1.5 seconds*, on every single test, because there was no signal to wait
    on. Here it waits for the whiteboard to have drawn the notes -- the thing
    the test actually needs -- and returns as soon as that is true.
  * Waits are on state, not on the clock. Where the Selenium file slept 0.2s
    after a drill-down and hoped, this waits for the popover title to actually
    change, which is both faster and stricter.

Clicks here go through `dispatch_event("click")` rather than a real mouse
click, for exactly the reason the Selenium file used
`execute_script("arguments[0].click()")` and with the same trade-off. The
whiteboard is a pan/zoom canvas in a pane roughly 780px wide; with this plan's
note coordinates the "Build" note lands near x=1490, well outside the window,
and the peek popover anchors to the note, so it is off-screen too. No driver
will mouse-click what it cannot see. Playwright does not remove that
constraint -- it only names it more clearly in the failure message. The cost is
the same as before: these tests exercise the click *handlers*, not hit-testing.
Covering the latter would mean panning the board to the note first, which is a
change of behaviour rather than a port, so it is left alone here.

Usage:
    uv run pytest tests/ui/test_task_peek.py -q
"""

import pytest

from .helpers import open_app

# Build
#   Ship Widget $Widget @sam 3d 100%      <- leaf, complete
#   Nested                                <- summary, direct child of Build
#     Sub A @sam 1d                       <- leaf, incomplete
#     Sub B @jo 1d                        <- summary, has its own children
#       Detail One @jo 1d                 <- leaf, incomplete
#       Detail Two @jo 1d 100%            <- leaf, complete
SAMPLE_PLAN = """---
title: Task Peek Test Plan
---

Phase 1
  Discovery
    Research @sam 2d 100%
    Interviews @sam 2d
  Build
    Ship Widget $Widget @sam 3d 100%
    Nested
      Sub A @sam 1d
      Sub B @jo 1d
        Detail One @jo 1d
        Detail Two @jo 1d 100%

---whiteboard---
| Task      | X   | Y  | Colour | Width | Height | Collapsed |
|-----------|-----|----|--------|-------|--------|-----------|
| Discovery | 120 | 80 |        | 280   | 240    | no        |
| Build     | 480 | 80 |        | 280   | 260    | no        |
"""

# Issue #1016: a chain that nests four levels below the note's own root task
# (Nested), to prove the peek's drill-down has no artificial depth cap -- it
# must keep going exactly as far as the outline actually nests, not stop at
# grandchildren.
DEEP_NESTING_PLAN = """---
title: Task Peek Deep Nesting Test Plan
---

Phase 1
  Build
    Nested
      Gen1
        Gen2 @sam 1d
          Gen3 @sam 1d
            Gen4 @sam 1d 100%

---whiteboard---
| Task  | X   | Y  | Colour | Width | Height | Collapsed |
|-------|-----|----|--------|-------|--------|-----------|
| Build | 480 | 80 |        | 280   | 260    | no        |
"""

PEEK = "#taskPeekPopover"


# ── Helpers ──────────────────────────────────────────────────────────────


def load_plan(page, plan_text):
    """Put a plan in the editor and wait for the whiteboard to redraw.

    The Selenium version waited for the editor's own text to stop changing for
    1.5 seconds -- a proxy for "the app has probably finished" that costs at
    least that long even when the app finished immediately. Waiting on the
    rendered notes is both quicker and a stronger guarantee.
    """
    page.eval_on_selector(
        "#planEditor",
        """(editor, value) => {
            editor.value = value;
            editor.dispatchEvent(new Event('input', { bubbles: true }));
        }""",
        plan_text,
    )


def switch_to_whiteboard(page, expected_notes=1):
    page.evaluate("() => switchToView('whiteboard')")
    page.wait_for_selector("#whiteboardContainer", state="visible")
    page.wait_for_function(
        "n => document.querySelectorAll('#whiteboardContainer .wb-note').length >= n",
        arg=expected_notes,
    )


def plan_text(page):
    return page.evaluate("() => document.getElementById('planEditor').value")


def line_for_task(text, task_name):
    for line in text.split("\n"):
        if line.strip().startswith(task_name):
            return line
    return None


def note(page, task):
    """The whiteboard note card for `task`."""
    return page.locator(f'#whiteboardContainer .wb-note[data-wb-task="{task}"]')


def note_row(page, note_task, child_name):
    """The `.wb-note-row` for `child_name` inside `note_task`'s note."""
    return note(page, note_task).locator(".wb-note-row").filter(
        has=page.locator(".wb-note-row-name", has_text=re_exact(child_name))
    )


def re_exact(text):
    """Playwright treats a compiled pattern as a full-string regex match."""
    import re

    return re.compile(rf"^{re.escape(text)}$")


def badge_for_child(page, note_task, child_name):
    return note_row(page, note_task, child_name).locator(".wb-note-count-badge")


def open_peek(page, note_task, child_name):
    badge = badge_for_child(page, note_task, child_name)
    # See the module docstring: board content can be off-viewport, so this is
    # dispatched rather than mouse-clicked. Same event, same listener.
    badge.dispatch_event("click")
    page.wait_for_selector(PEEK, state="visible")
    return page.locator(PEEK)


def peek_row(page, task_name):
    return page.locator(f"{PEEK} .task-peek-row").filter(
        has=page.locator(".task-peek-row-name", has_text=re_exact(task_name))
    )


def peek_title(page):
    title = page.locator(f"{PEEK} .task-peek-title")
    return title.inner_text() if title.count() else None


def peek_row_names(page):
    return page.locator(f"{PEEK} .task-peek-row-name").all_inner_texts()


def crumbs(page):
    return page.locator(f"{PEEK} .task-peek-crumb").all_inner_texts()


def whiteboard_viewport(page):
    return page.evaluate("() => ({zoom: wbZoom, panX: wbPanX, panY: wbPanY})")


@pytest.fixture
def board(page, app_server):
    """A page with SAMPLE_PLAN loaded and the whiteboard on screen.

    Every test in the Selenium file opened with the same three lines; making it
    a fixture means the setup is written once and, more importantly, that the
    waits inside it are written once.
    """
    open_app(page, app_server)
    load_plan(page, SAMPLE_PLAN)
    switch_to_whiteboard(page, expected_notes=2)
    return page


# ── Tests ────────────────────────────────────────────────────────────────


class TestPeekOpensInsteadOfInspector:
    def test_badge_click_opens_peek_not_task_inspector(self, board):
        open_peek(board, "Build", "Nested")

        assert board.locator(PEEK).count() == 1, "the peek popover must be open"
        inspector_open = board.evaluate(
            "() => { const s = document.getElementById('taskInspectorSection');"
            "  return !!(s && s.classList.contains('active')); }"
        )
        assert inspector_open is False, (
            "clicking the badge must no longer jump straight to the Task Inspector"
        )

    def test_row_click_also_opens_peek(self, board):
        note_row(board, "Build", "Nested").dispatch_event("click")
        board.wait_for_selector(PEEK, state="visible")

    def test_clicking_same_badge_again_closes_the_peek(self, board):
        badge = badge_for_child(board, "Build", "Nested")
        badge.dispatch_event("click")
        board.wait_for_selector(PEEK, state="visible")
        badge.dispatch_event("click")
        board.wait_for_selector(PEEK, state="detached")


class TestPeekContent:
    def test_peek_shows_exactly_name_assignee_checkbox_badge(self, board):
        open_peek(board, "Build", "Nested")
        assert set(peek_row_names(board)) == {"Sub A", "Sub B"}, (
            "the peek must list exactly Nested's own direct children"
        )

        sub_b = peek_row(board, "Sub B")
        assert sub_b.locator(".task-peek-checkbox").count() == 1
        assert sub_b.locator(".task-peek-row-name").count() == 1
        assert sub_b.locator(".wb-note-avatar").count() == 1, (
            "each row must show completion, name and assignee"
        )
        assert sub_b.locator(".wb-note-count-badge").count() == 1, (
            "Sub B has its own children, so its row must carry a drill-down badge"
        )
        assert sub_b.locator(".wb-note-avatar").inner_text() == "JO", (
            "the assignee chip shows Jo's initials"
        )

        assert peek_row(board, "Sub A").locator(".wb-note-count-badge").count() == 0, (
            "a leaf child (Sub A) must not show a drill-down badge"
        )

    def test_peek_is_anchored_near_its_note(self, board):
        note_box = note(board, "Build").bounding_box()
        popover = open_peek(board, "Build", "Nested")
        peek_box = popover.bounding_box()
        # "Anchored to the note" -- not pinned to an arbitrary screen corner.
        assert abs(peek_box["y"] - note_box["y"]) < 400


class TestPeekBreadcrumb:
    def test_drilling_into_a_grandchild_shows_breadcrumb(self, board):
        open_peek(board, "Build", "Nested")
        assert crumbs(board) == [], (
            "a single-level peek shows no breadcrumb (nothing to navigate)"
        )

        peek_row(board, "Sub B").locator(".wb-note-count-badge").dispatch_event("click")
        board.wait_for_function(
            "() => document.querySelector('#taskPeekPopover .task-peek-title')"
            "        ?.textContent === 'Sub B'"
        )

        assert peek_title(board) == "Sub B", (
            "drilling in makes the child the peek's new current level"
        )
        assert set(peek_row_names(board)) == {"Detail One", "Detail Two"}
        assert crumbs(board) == ["Nested", "Sub B"], (
            "the breadcrumb shows the full path from the peek's root to here"
        )

    def test_breadcrumb_navigates_back_up(self, board):
        open_peek(board, "Build", "Nested")
        peek_row(board, "Sub B").locator(".wb-note-count-badge").dispatch_event("click")
        board.wait_for_function(
            "() => document.querySelector('#taskPeekPopover .task-peek-title')"
            "        ?.textContent === 'Sub B'"
        )

        board.locator(f"{PEEK} .task-peek-crumb").first.dispatch_event("click")
        board.wait_for_function(
            "() => document.querySelector('#taskPeekPopover .task-peek-title')"
            "        ?.textContent === 'Nested'"
        )

        assert peek_title(board) == "Nested", "clicking the root crumb navigates back to it"
        assert set(peek_row_names(board)) == {"Sub A", "Sub B"}


class TestPeekDeepNesting:
    """Issue #1016 ("nested subtasks within a post-it checklist, deeper than one
    level"). #850's peek was already built generically: wbBuildPeekLevel() only
    ever asks "does *this* task have children", tpDrillInto()/tpPushLevel() only
    ever push one more level onto a plain stack, and neither has any notion of
    "level 0" vs "level 1" -- there was never a hardcoded stop after one hop.
    #1016 is this file's regression lock for that.
    """

    def test_drilling_several_levels_deep_has_no_artificial_limit(self, page, app_server):
        open_app(page, app_server)
        load_plan(page, DEEP_NESTING_PLAN)
        switch_to_whiteboard(page, expected_notes=1)

        # Root: Nested's own direct children (opened from the note).
        open_peek(page, "Build", "Nested")
        assert peek_title(page) == "Nested"
        assert peek_row_names(page) == ["Gen1"]

        # Drill: Gen1 -> Gen2 -> Gen3, each one level deeper than #850's own
        # single-hop coverage.
        for child_name in ["Gen1", "Gen2", "Gen3"]:
            badge = peek_row(page, child_name).locator(".wb-note-count-badge")
            assert badge.count() == 1, (
                f"{child_name} has its own children, so it must carry a drill-down badge"
            )
            badge.dispatch_event("click")
            page.wait_for_function(
                "name => document.querySelector('#taskPeekPopover .task-peek-title')"
                "          ?.textContent === name",
                arg=child_name,
            )

        # Now four levels deep (Nested > Gen1 > Gen2 > Gen3); Gen3's own child,
        # Gen4, is a leaf and must show no further badge.
        assert crumbs(page) == ["Nested", "Gen1", "Gen2", "Gen3"], (
            "the breadcrumb records the full path, all four levels deep"
        )
        gen4 = peek_row(page, "Gen4")
        assert gen4.count() == 1
        assert gen4.locator(".wb-note-count-badge").count() == 0, (
            "Gen4 is a leaf, so its row must not carry a drill-down badge"
        )

        # Breadcrumb navigation works from any depth, not just "one level in" --
        # jump straight from the deepest crumb back to Gen1.
        page.locator(f"{PEEK} .task-peek-crumb", has_text=re_exact("Gen1")).dispatch_event("click")
        page.wait_for_function(
            "() => document.querySelector('#taskPeekPopover .task-peek-title')"
            "        ?.textContent === 'Gen1'"
        )
        assert peek_title(page) == "Gen1", (
            "clicking an earlier crumb jumps straight back to it, not just one level"
        )
        assert peek_row_names(page) == ["Gen2"]


class TestPeekPlanTextRerender:
    """Issue #1016's re-render requirement: the peek's navigation stack must
    survive the ordinary plan-text auto-render (editor.js's 1s input debounce ->
    renderText() -> wbRenderNotes()), not just user-driven drill/back
    navigation. wbRenderNotes() updates each note's DOM node *in place* and
    never touches the peek popover, so this is a regression lock on that
    decoupling: a stray future change coupling note re-render to the peek would
    show up here as a closed popover, a reset-to-root stack, or a duplicated
    #taskPeekPopover.
    """

    def test_multi_level_stack_survives_a_plan_text_rerender(self, board):
        open_peek(board, "Build", "Nested")
        peek_row(board, "Sub B").locator(".wb-note-count-badge").dispatch_event("click")
        board.wait_for_function(
            "() => document.querySelector('#taskPeekPopover .task-peek-title')"
            "        ?.textContent === 'Sub B'"
        )
        assert crumbs(board) == ["Nested", "Sub B"]

        # Edit the plan text elsewhere (an unrelated task, untouched by the
        # peeked branch) and let the ordinary auto-render debounce fire, exactly
        # like a collaborator's own typing would while this peek sits open two
        # levels deep.
        edited = SAMPLE_PLAN.replace(
            "Interviews @sam 2d", "Interviews @sam 2d  # rerender probe"
        )
        assert edited != SAMPLE_PLAN
        load_plan(board, edited)
        board.wait_for_function(
            "() => document.getElementById('planEditor').value.includes('rerender probe')"
        )
        # The debounce is the point of the test, so this one genuinely has to
        # outlast it rather than wait on a state change.
        board.wait_for_timeout(1500)

        assert board.locator(PEEK).count() == 1, (
            "the re-render must not duplicate or destroy the peek popover"
        )
        assert peek_title(board) == "Sub B", (
            "the drilled-in level must still be current after the re-render"
        )
        assert crumbs(board) == ["Nested", "Sub B"], (
            "the full navigation stack must survive the re-render"
        )
        assert set(peek_row_names(board)) == {"Detail One", "Detail Two"}, (
            "the current level's own rows must still be exactly Sub B's children"
        )


class TestPeekChecklistTicking:
    def test_ticking_a_peek_checkbox_writes_the_same_edit_as_a_note_tick(self, board):
        before_line = line_for_task(plan_text(board), "Sub A")
        assert before_line is not None and "100%" not in before_line.split()

        open_peek(board, "Build", "Nested")
        peek_row(board, "Sub A").locator(".task-peek-checkbox").dispatch_event("click")
        board.wait_for_function(
            "() => /Sub A[^\\n]*100%/.test(document.getElementById('planEditor').value)"
        )

        after = plan_text(board)
        after_line = line_for_task(after, "Sub A")
        assert after_line is not None and "100%" in after_line.split(), after

    def test_ticking_from_the_peek_is_a_single_undo_step(self, board):
        # The loaded plan's own undo snapshot is debounced by 600ms
        # (EditorUndoManager.DEBOUNCE_MS), so the tick must land *after* it --
        # otherwise the two edits coalesce into a single stack entry and "one
        # undo reverses the tick" passes for the wrong reason. The Selenium
        # version bought that ordering with its 1.5s-of-quiet plan load; taking
        # the snapshot outright is the same precondition, stated rather than
        # waited for, and is what the app itself does for programmatic edits.
        board.evaluate(
            "() => EditorUndoManager.captureImmediate("
            "  document.getElementById('planEditor').value)"
        )
        board.wait_for_function("() => EditorUndoManager.canUndo()")

        before_line = line_for_task(plan_text(board), "Sub A")
        assert before_line is not None and "100%" not in before_line.split()

        open_peek(board, "Build", "Nested")
        peek_row(board, "Sub A").locator(".task-peek-checkbox").dispatch_event("click")
        board.wait_for_function(
            "() => /Sub A[^\\n]*100%/.test(document.getElementById('planEditor').value)"
        )

        board.evaluate("() => EditorUndoManager.undo()")
        board.wait_for_function(
            "() => !/Sub A[^\\n]*100%/.test(document.getElementById('planEditor').value)"
        )
        after_line = line_for_task(plan_text(board), "Sub A")
        assert after_line is not None and "100%" not in after_line.split(), (
            "a single undo must fully reverse the peek tick's percent change"
        )


class TestOpenTaskDetails:
    def test_open_task_details_from_the_peek_selects_the_right_task(self, board):
        open_peek(board, "Build", "Nested")
        board.locator(f"{PEEK} .task-peek-open-details-btn").dispatch_event("click")
        board.wait_for_selector(PEEK, state="detached")

        assert board.evaluate(
            "() => document.getElementById('taskFormSection')"
            "        .classList.contains('active')"
        ) is True, "the task-details form must be open"
        assert board.input_value("#taskName") == "Nested", (
            "the peek's own current-level task (Nested) must be the one selected"
        )

    def test_open_task_details_from_the_note_menu_selects_the_right_task(self, board):
        note(board, "Discovery").locator(".wb-note-menu-btn").dispatch_event("click")
        board.wait_for_selector("#wbNoteMenu", state="visible")
        board.locator("#wbNoteMenu .wb-note-menu-open-task").dispatch_event("click")
        board.wait_for_selector("#wbNoteMenu", state="detached")

        board.wait_for_function(
            "() => document.getElementById('taskName').value === 'Discovery'"
        )
        assert board.input_value("#taskName") == "Discovery"


class TestPanZoomRestoration:
    def test_returning_from_task_details_restores_pan_and_zoom(self, board):
        # Establish a distinctive, non-default viewport before opening details.
        board.evaluate(
            "() => { wbZoom = 1.6; wbPanX = 123; wbPanY = 456; wbApplyTransform(false); }"
        )
        before = whiteboard_viewport(board)
        assert before == {"zoom": 1.6, "panX": 123, "panY": 456}

        open_peek(board, "Build", "Nested")
        board.locator(f"{PEEK} .task-peek-open-details-btn").dispatch_event("click")
        board.wait_for_selector(PEEK, state="detached")
        board.evaluate("() => closeTaskForm()")
        board.wait_for_selector("#whiteboardContainer", state="visible")

        after = whiteboard_viewport(board)
        assert after == before, (
            "pan/zoom must be exactly as left before opening task details "
            f"(before={before}, after={after})"
        )
        assert board.evaluate(
            "() => document.getElementById('whiteboardContainer').offsetParent !== null"
        ) is True

    def test_returning_from_task_details_restores_note_scroll(self, board):
        scroll_set = board.eval_on_selector(
            '#whiteboardContainer .wb-note[data-wb-task="Build"] .wb-note-body',
            "body => { body.scrollTop = 5; return body.scrollTop; }",
        )
        assert scroll_set is not None

        open_peek(board, "Build", "Nested")
        board.locator(f"{PEEK} .task-peek-open-details-btn").dispatch_event("click")
        board.wait_for_selector(PEEK, state="detached")
        board.evaluate("() => closeTaskForm()")
        board.wait_for_selector("#whiteboardContainer", state="visible")

        scroll_after = board.eval_on_selector(
            '#whiteboardContainer .wb-note[data-wb-task="Build"] .wb-note-body',
            "body => body.scrollTop",
        )
        assert scroll_after == scroll_set


class TestPeekEscapeAndFocus:
    def test_escape_closes_peek_and_refocuses_the_badge(self, board):
        open_peek(board, "Build", "Nested")
        board.keyboard.press("Escape")
        board.wait_for_selector(PEEK, state="detached")

        active = board.evaluate("() => document.activeElement.className")
        assert "wb-note-count-badge" in active, (
            "focus must return to the badge that opened the peek"
        )

    def test_second_escape_does_nothing_to_the_board(self, board):
        open_peek(board, "Build", "Nested")
        board.keyboard.press("Escape")
        board.wait_for_selector(PEEK, state="detached")

        before = whiteboard_viewport(board)
        board.keyboard.press("Escape")
        assert whiteboard_viewport(board) == before, (
            "a second Escape (peek already closed) must not affect the board"
        )
        assert board.locator(PEEK).count() == 0

    def test_outside_click_closes_the_peek(self, board):
        open_peek(board, "Build", "Nested")
        board.evaluate(
            "() => document.body.dispatchEvent("
            "  new MouseEvent('mousedown', {bubbles: true}))"
        )
        board.wait_for_selector(PEEK, state="detached")


class TestPeekViewportEdge:
    def test_peek_repositions_rather_than_overflowing_near_an_edge(self, page, app_server):
        """The Selenium version had to restore the window size in a `finally`,
        because its browser was shared across every test in the file and a
        failure here would leave a stale 700x600 window behind for the next
        test to inherit. This page belongs to one test, so there is nothing to
        restore.
        """
        page.set_viewport_size({"width": 700, "height": 600})
        open_app(page, app_server)
        load_plan(page, SAMPLE_PLAN)
        switch_to_whiteboard(page, expected_notes=2)

        # Pan the board so Build's note sits close to the right edge of a small
        # viewport -- close enough that the popover's default right-hand
        # placement would overflow, but not so far that the badge itself moves
        # off-screen (a real user could never click something off-screen
        # either, so that would test nothing).
        page.evaluate(
            "() => { wbZoom = 1; wbPanX = -110; wbPanY = 0; wbApplyTransform(false); }"
        )

        popover = open_peek(page, "Build", "Nested")
        rect = popover.bounding_box()
        width = page.evaluate("() => window.innerWidth")
        height = page.evaluate("() => window.innerHeight")
        assert rect["x"] >= 0, "the peek must not be clipped off the left edge"
        assert rect["x"] + rect["width"] <= width + 1, (
            "the peek must not overflow the right edge"
        )
        assert rect["y"] >= 0
        assert rect["y"] + rect["height"] <= height + 1, (
            "the peek must not overflow the bottom edge"
        )


class TestPeekTheming:
    @pytest.mark.parametrize("theme", ["light", "dark"])
    def test_peek_text_is_legible_in_light_and_dark_mode(self, board, theme):
        board.evaluate(
            "theme => document.documentElement.setAttribute('data-theme', theme)",
            theme,
        )
        open_peek(board, "Build", "Nested")
        ratio = board.evaluate(
            """() => {
                const pop = document.getElementById('taskPeekPopover');
                const title = pop.querySelector('.task-peek-title');
                const toHex = rgb => {
                    const nums = rgb.match(/\\d+/g).map(Number);
                    return '#' + nums.slice(0, 3)
                        .map(n => n.toString(16).padStart(2, '0')).join('');
                };
                return wbContrastRatio(
                    toHex(getComputedStyle(pop).backgroundColor),
                    toHex(getComputedStyle(title).color));
            }"""
        )
        assert ratio >= 4.5, (
            f"[{theme}] peek title/background contrast only {ratio:.2f}:1"
        )
