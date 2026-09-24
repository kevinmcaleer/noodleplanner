"""Grouping and merging notes on the whiteboard (issue #874).

Two gestures from the issue's "join/group" half, and the multi-select they
both need:

*   **Group** — drag round several notes on empty canvas (or shift-click
    them), then "Group these" or Ctrl/Cmd+G. A boundary titled "Untitled
    group", its title already in edit, is drawn around them and a summary task appears
    underneath, which the user is never told about: the board is a lens that
    picks friendlier language for a structure the plan already has.
*   **Merge** — drag one note onto another, or select several and Combine.
    The sources' items end up on the target's list and the emptied sources
    go.

The issue asks for the two to feel clearly different at the moment of
choosing. The assertion that they do is structural rather than aesthetic and
is at the bottom of this file: after a group every member is still its own
note, and after a merge there is one note holding everything.

The pure outline rewrites are unit-tested in
tests/test_whiteboard_structure.js. What is here is what only a browser can
answer: whether the boundary lands where its members are, whether the
gestures reach the commit, and whether the two ever draw the same thing.

Geometry is read through bounding boxes for the reason
tests/ui/test_task_peek.py's docstring gives — the whiteboard is a pan/zoom
canvas and these notes sit outside the visible pane.

Usage:
    uv run pytest tests/ui/test_whiteboard_groups.py -q
"""


from .helpers import load_plan, note, open_app, plan_text, switch_to_whiteboard

PLAN = """---
title: Group Test Plan
---

Alpha
  Alpha one
  Alpha two
Beta
  Beta one
Gamma
  Gamma one

---whiteboard---
| Task  | X   | Y  | Colour | Width | Height | Collapsed |
|-------|-----|----|--------|-------|--------|-----------|
| Alpha | 60  | 60 |        | 240   | 180    | no        |
| Beta  | 360 | 60 |        | 240   | 180    | no        |
| Gamma | 660 | 60 |        | 240   | 180    | no        |
"""


def board(page, app_server, plan=PLAN, notes=3):
    open_app(page, app_server)
    load_plan(page, plan)
    switch_to_whiteboard(page, expected_notes=notes)
    # The notes are placed from the table a moment after they are first drawn
    # at their default size, and a boundary is measured from their rects --
    # so a measurement taken across that boundary measures the wrong box.
    page.wait_for_function(
        "() => { const n = document.querySelector("
        "  \".wb-note[data-wb-task='Alpha'] .wb-note-card\");"
        "  return n && Math.abs(n.offsetWidth - 240) < 2; }"
    )
    # Unlike most of the whiteboard suites, these tests drive real mouse
    # gestures -- a lasso and two drags -- rather than dispatching events, so
    # the notes have to actually be in the viewport for the pointer to reach
    # them. Fitting the board is the cheapest way to guarantee that, and it
    # is what a user looking at three notes would be seeing anyway.
    page.evaluate("() => whiteboardZoomFit()")
    page.wait_for_timeout(350)
    # The outline panel floats over the left of the canvas, which is where
    # `Alpha` is; a lasso that starts under it never reaches the board.
    page.evaluate(
        """() => { const b = document.getElementById('whiteboardOutlineBtn');
                   if (b && b.getAttribute('aria-pressed') === 'true') wbToggleOutlinePanel(); }"""
    )
    page.wait_for_timeout(150)


def shift_click_header(page, task):
    """Shift-press `task`'s header, the way a user building a selection does.

    A real mouse press rather than `click(modifiers=...)`: the board reads
    shift off `mousedown`, and Playwright's click on a canvas element this
    far from the origin is not guaranteed to land where the element is."""
    box = note(page, task).locator(".wb-note-header").bounding_box()
    assert box, f"{task}'s header is not on screen"
    page.keyboard.down("Shift")
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.mouse.down()
    page.mouse.up()
    page.keyboard.up("Shift")


def select(page, names):
    page.evaluate("names => wbSetSelectedNotes(names)", names)


def outline(page):
    """The plan's task outline, without front matter or back matter."""
    text = plan_text(page)
    body = text.split("---whiteboard---")[0]
    if body.startswith("---"):
        body = body.split("---", 2)[2]
    return [line for line in body.split("\n") if line.strip()]


def name_new_group(page, name):
    """Type `name` into a just-created group's title and press Enter.

    A new group starts as "Untitled group" with its title in edit, the way
    Obsidian's canvas does it, so naming is typing over the selected
    placeholder rather than answering a dialog.

    Waited on the board rather than on the plan text: the commit rewrites the
    editor and the board re-renders from it a tick later, so a wait that stops
    at the text hands back a page whose boundary does not exist yet -- and
    every caller here goes straight on to measure one."""
    field = page.locator(".wb-group-title-input")
    field.wait_for(state="visible")
    field.fill(name)
    field.press("Enter")
    page.wait_for_selector(f'.wb-group[data-wb-group="{name}"] .wb-group-box')


def group_selection(page, name):
    """Group the current selection and name the group."""
    page.click(".wb-selection-group")
    name_new_group(page, name)


def lasso(page, x1, y1, x2, y2, shift=False):
    """Drag on empty canvas from (x1, y1) to (x2, y2)."""
    if shift:
        page.keyboard.down("Shift")
    page.mouse.move(x1, y1)
    page.mouse.down()
    for i in range(1, 9):
        page.mouse.move(x1 + (x2 - x1) * i / 8, y1 + (y2 - y1) * i / 8)
    page.mouse.up()
    if shift:
        page.keyboard.up("Shift")


class TestMultiSelect:
    """Group and combine both act on several notes, so the selection had to
    stop being a single name. It is a set now, and the last name added is
    still the one a colour pick or a `...` menu acts on."""

    def test_the_toolbar_stays_away_until_a_selection_can_use_it(
        self, page, app_server
    ):
        board(page, app_server)
        bar = page.locator(".wb-selection-toolbar")

        select(page, [])
        assert bar.evaluate("n => n.hidden") is True

        select(page, ["Alpha"])
        assert bar.evaluate("n => n.hidden") is True, (
            "one note is not a group and cannot be combined with anything"
        )

        select(page, ["Alpha", "Beta"])
        assert bar.evaluate("n => n.hidden") is False
        assert "2 notes selected" in bar.inner_text()

    def test_shift_clicking_a_header_toggles_that_note(self, page, app_server):
        board(page, app_server)
        shift_click_header(page, "Alpha")
        assert page.evaluate("() => wbGetSelectedNoteTasks()") == ["Alpha"]

        shift_click_header(page, "Beta")
        assert page.evaluate("() => wbGetSelectedNoteTasks()") == ["Alpha", "Beta"]

        shift_click_header(page, "Alpha")
        assert page.evaluate("() => wbGetSelectedNoteTasks()") == ["Beta"], (
            "shift-clicking a selected note takes it back out again"
        )

    def test_shift_clicking_does_not_move_the_note(self, page, app_server):
        """Building a selection must not also pick something up, or every
        fourth click is a small accident."""
        board(page, app_server)
        before = note(page, "Alpha").bounding_box()
        shift_click_header(page, "Alpha")
        after = note(page, "Alpha").bounding_box()
        assert abs(before["x"] - after["x"]) < 1
        assert abs(before["y"] - after["y"]) < 1

    def test_the_selection_survives_a_note_leaving_the_board(self, page, app_server):
        """wbRenderNotes()' sweep deletes straight from wbNoteNodes, so a
        selection can be left holding a name that no longer has a note."""
        board(page, app_server)
        select(page, ["Alpha", "Beta"])
        page.evaluate("() => { wbNoteNodes.delete('Beta'); }")
        assert page.evaluate("() => wbGetSelectedNoteTasks()") == ["Alpha"]


class TestTheLasso:
    """A plain drag on empty canvas, as on Obsidian's canvas. Panning is the
    two-finger swipe (see TestPanning), so the drag is free to select."""

    def test_it_selects_the_notes_it_touches(self, page, app_server):
        board(page, app_server)
        a = note(page, "Alpha").bounding_box()
        b = note(page, "Beta").bounding_box()
        # From above-left of Alpha to inside Beta: touches both, misses Gamma.
        lasso(page, a["x"] - 12, a["y"] - 12, b["x"] + b["width"] / 2, b["y"] + 20)
        assert sorted(page.evaluate("() => wbGetSelectedNoteTasks()")) == [
            "Alpha",
            "Beta",
        ]

    def test_a_plain_drag_does_not_pan(self, page, app_server):
        board(page, app_server)
        before = page.evaluate("() => [wbPanX, wbPanY]")
        a = note(page, "Alpha").bounding_box()
        lasso(page, a["x"] - 40, a["y"] - 40, a["x"] - 5, a["y"] - 20)
        assert page.evaluate("() => [wbPanX, wbPanY]") == before

    def test_a_shift_drag_adds_to_the_selection(self, page, app_server):
        board(page, app_server)
        select(page, ["Gamma"])
        a = note(page, "Alpha").bounding_box()
        lasso(page, a["x"] - 12, a["y"] - 12, a["x"] + 40, a["y"] + 40, shift=True)
        assert sorted(page.evaluate("() => wbGetSelectedNoteTasks()")) == [
            "Alpha",
            "Gamma",
        ]

    def test_a_plain_drag_replaces_the_selection(self, page, app_server):
        board(page, app_server)
        select(page, ["Gamma"])
        a = note(page, "Alpha").bounding_box()
        lasso(page, a["x"] - 12, a["y"] - 12, a["x"] + 40, a["y"] + 40)
        assert page.evaluate("() => wbGetSelectedNoteTasks()") == ["Alpha"]

    def test_the_marquee_is_gone_once_the_button_is_up(self, page, app_server):
        board(page, app_server)
        a = note(page, "Alpha").bounding_box()
        lasso(page, a["x"] - 12, a["y"] - 12, a["x"] + 40, a["y"] + 40)
        assert page.locator(".wb-lasso").count() == 0

    def test_there_are_no_tool_buttons_to_switch(self, page, app_server):
        board(page, app_server)
        assert page.locator("#whiteboardMoveToolBtn, #whiteboardGroupToolBtn").count() == 0


class TestGrouping:
    def test_it_draws_a_titled_boundary_and_makes_a_summary_task(
        self, page, app_server
    ):
        board(page, app_server)
        select(page, ["Alpha", "Beta"])
        group_selection(page, "Discovery")

        assert outline(page) == [
            "Gamma",
            "  Gamma one",
            "Discovery",
            "  Alpha",
            "    Alpha one",
            "    Alpha two",
            "  Beta",
            "    Beta one",
        ]
        assert page.locator(".wb-group-box").count() == 1
        assert page.locator(".wb-group-title").text_content() == "Discovery"

    def test_the_group_gets_no_post_it_of_its_own(self, page, app_server):
        """The summary task underneath a boundary is an implementation of the
        group, not a note. Rendering it as one would put a card the user never
        asked for on top of the notes they did."""
        board(page, app_server)
        select(page, ["Alpha", "Beta"])
        group_selection(page, "Discovery")

        assert note(page, "Discovery").count() == 0
        assert page.locator(".wb-note").count() == 3

    def test_the_members_draw_no_noodles_to_a_card_that_is_not_there(
        self, page, app_server
    ):
        """A note whose children are on the board draws a noodle to each. A
        boundary is not a note, so its members must not."""
        board(page, app_server)
        before = page.locator(".wb-noodle").count()
        select(page, ["Alpha", "Beta"])
        group_selection(page, "Discovery")
        assert page.locator(".wb-noodle").count() == before

    def test_the_boundary_encloses_its_members(self, page, app_server):
        board(page, app_server)
        select(page, ["Alpha", "Beta"])
        group_selection(page, "Discovery")

        box = page.locator(".wb-group-box").bounding_box()
        for member in ("Alpha", "Beta"):
            rect = note(page, member).bounding_box()
            assert rect["x"] >= box["x"] - 1, f"{member} spills out of the boundary"
            assert rect["y"] >= box["y"] - 1
            assert rect["x"] + rect["width"] <= box["x"] + box["width"] + 1
            assert rect["y"] + rect["height"] <= box["y"] + box["height"] + 1

        outside = note(page, "Gamma").bounding_box()
        assert outside["x"] > box["x"] + box["width"], (
            "Gamma was not grouped, so the boundary must not reach it"
        )

    def test_the_boundary_paints_behind_the_notes(self, page, app_server):
        """A container that covers what it contains is not a container."""
        board(page, app_server)
        select(page, ["Alpha", "Beta"])
        group_selection(page, "Discovery")

        # Document order is paint order. The notes layer is not inside the
        # panned <g> (see wbPlaceBoardObject() in whiteboard.js), so compare
        # the two layers' positions in the whole SVG.
        order = page.evaluate(
            """() => [...document.querySelectorAll(
                    '#whiteboardContainer svg .wb-groups-layer, #whiteboardContainer svg .wb-notes-layer')]
                 .map(n => n.getAttribute('class'))"""
        )
        assert order.index("wb-groups-layer") < order.index("wb-notes-layer"), order

    def test_one_note_cannot_be_grouped(self, page, app_server):
        board(page, app_server)
        select(page, ["Alpha"])
        assert page.evaluate("() => wbGroupSelection()") is False
        assert page.locator(".wb-group-box").count() == 0

    def test_groups_nest(self, page, app_server):
        board(page, app_server)
        select(page, ["Alpha", "Beta"])
        group_selection(page, "Discovery")

        # A group is a task, so grouping it with a note nests it. Selecting a
        # group means selecting a member of it: the outer group is built from
        # the inner group's own name.
        page.evaluate(
            "() => wbGroupTasksInPlanText"
        )  # present, so the helper below is the real one
        page.evaluate(
            """() => {
                const editor = document.getElementById('planEditor');
                const next = wbGroupTasksInPlanText(editor.value, ['Discovery', 'Gamma'], 'Phase 1');
                wbCommitMarkdown(wbUpsertGroupRow(next, 'Phase 1'));
            }"""
        )
        page.wait_for_function(
            "() => document.querySelectorAll('.wb-group-box').length === 2"
        )

        titles = sorted(page.locator(".wb-group-title").all_text_contents())
        assert titles == ["Discovery", "Phase 1"]

        boxes = page.evaluate(
            """() => [...document.querySelectorAll('.wb-group')].map(g => {
                const r = g.querySelector('.wb-group-box');
                return { name: g.dataset.wbGroup,
                         x: +r.getAttribute('x'), y: +r.getAttribute('y'),
                         w: +r.getAttribute('width'), h: +r.getAttribute('height') };
            })"""
        )
        inner = next(b for b in boxes if b["name"] == "Discovery")
        outer = next(b for b in boxes if b["name"] == "Phase 1")
        assert outer["x"] <= inner["x"] and outer["y"] <= inner["y"]
        assert outer["x"] + outer["w"] >= inner["x"] + inner["w"], (
            "the outer boundary does not contain the inner one"
        )

    def test_ungroup_hands_the_notes_back(self, page, app_server):
        board(page, app_server)
        select(page, ["Alpha", "Beta"])
        group_selection(page, "Discovery")

        # Ungroup is revealed by hovering the boundary, so the gesture is
        # hover-then-click rather than a bare click -- which is also the only
        # way to find out whether the control is actually reachable.
        box = page.locator(".wb-group-box").bounding_box()
        page.mouse.move(box["x"] + box["width"] / 2, box["y"] + 6)
        page.wait_for_function(
            "() => getComputedStyle("
            "  document.querySelector('.wb-group-ungroup')).opacity === '1'"
        )
        label = page.locator(".wb-group-ungroup").bounding_box()
        page.mouse.click(
            label["x"] + label["width"] / 2, label["y"] + label["height"] / 2
        )
        page.wait_for_function(
            "() => document.querySelectorAll('.wb-group-box').length === 0"
        )

        assert "Discovery" not in plan_text(page)
        assert outline(page) == [
            "Gamma",
            "  Gamma one",
            "Alpha",
            "  Alpha one",
            "  Alpha two",
            "Beta",
            "  Beta one",
        ]
        assert page.locator(".wb-note").count() == 3


class TestLassoThenGroup:
    """Select with the lasso, then group: the selection toolbar's button or
    Ctrl/Cmd+G. The new group is titled "Untitled group" with its title
    already in edit -- the Obsidian canvas gesture."""

    def _lasso_alpha_and_beta(self, page):
        a = note(page, "Alpha").bounding_box()
        b = note(page, "Beta").bounding_box()
        lasso(page, a["x"] - 12, a["y"] - 12, b["x"] + b["width"] / 2, b["y"] + 20)

    def test_ctrl_g_groups_under_an_editable_title(self, page, app_server):
        board(page, app_server)
        self._lasso_alpha_and_beta(page)
        page.keyboard.press("Control+g")

        field = page.locator(".wb-group-title-input")
        field.wait_for(state="visible")
        assert field.input_value() == "Untitled group"
        assert page.locator(".wb-group-box").count() == 1

        name_new_group(page, "Discovery")
        lines = outline(page)
        start = lines.index("Discovery")
        assert lines[start + 1] == "  Alpha"
        assert "  Beta" in lines[start:]
        assert page.locator(".wb-group-title").text_content() == "Discovery"
        assert page.locator(".wb-group-title-input").count() == 0

    def test_the_toolbar_button_groups_the_lassoed_notes(self, page, app_server):
        board(page, app_server)
        self._lasso_alpha_and_beta(page)
        group_selection(page, "Discovery")
        assert page.locator(".wb-group-box").count() == 1

    def test_escape_keeps_the_placeholder_title(self, page, app_server):
        board(page, app_server)
        self._lasso_alpha_and_beta(page)
        page.keyboard.press("Control+g")
        field = page.locator(".wb-group-title-input")
        field.wait_for(state="visible")
        field.press("Escape")
        assert page.locator(".wb-group-title-input").count() == 0
        assert page.locator(".wb-group-title").text_content() == "Untitled group"

    def test_ctrl_g_with_one_note_makes_no_group(self, page, app_server):
        board(page, app_server)
        select(page, ["Alpha"])
        page.focus("#whiteboardContainer")
        page.keyboard.press("Control+g")
        page.wait_for_timeout(150)
        assert page.locator(".wb-group-box").count() == 0
        assert "Untitled group" not in plan_text(page)

    def test_a_group_and_a_note_selected_together_nest(self, page, app_server):
        """Selecting every note of a group and one more groups the group,
        rather than pulling its notes out of it."""
        board(page, app_server)
        select(page, ["Alpha", "Beta"])
        group_selection(page, "Discovery")

        select(page, ["Alpha", "Beta", "Gamma"])
        group_selection(page, "Phase 1")
        assert outline(page) == [
            "Phase 1",
            "  Discovery",
            "    Alpha",
            "      Alpha one",
            "      Alpha two",
            "    Beta",
            "      Beta one",
            "  Gamma",
            "    Gamma one",
        ]

    def test_double_clicking_a_title_edits_it_in_place(self, page, app_server):
        board(page, app_server)
        select(page, ["Alpha", "Beta"])
        group_selection(page, "Discovery")
        page.locator(".wb-group-title").dblclick()
        field = page.locator(".wb-group-title-input")
        field.wait_for(state="visible")
        assert field.input_value() == "Discovery"
        field.fill("Research")
        field.press("Enter")
        page.wait_for_selector('.wb-group[data-wb-group="Research"]')
        assert "Discovery" not in plan_text(page)


class TestPanning:
    """A two-finger trackpad swipe arrives as a plain wheel event and pans
    the board, as on Obsidian's canvas. Space+drag pans with a mouse."""

    def test_a_two_finger_swipe_pans(self, page, app_server):
        board(page, app_server)
        before = page.evaluate("() => [wbPanX, wbPanY, wbZoom]")
        box = page.locator("#whiteboardContainer").bounding_box()
        page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] - 30)
        page.mouse.wheel(40, 60)
        page.wait_for_timeout(100)
        after = page.evaluate("() => [wbPanX, wbPanY, wbZoom]")
        assert after[0] == before[0] - 40
        assert after[1] == before[1] - 60
        assert after[2] == before[2], "a swipe pans; only a pinch zooms"

    def test_space_drag_pans_instead_of_lassoing(self, page, app_server):
        board(page, app_server)
        before = page.evaluate("() => [wbPanX, wbPanY]")
        a = note(page, "Alpha").bounding_box()
        x, y = a["x"] - 40, a["y"] - 40
        page.focus("#whiteboardContainer")
        page.keyboard.down(" ")
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x + 60, y + 30, steps=5)
        page.mouse.up()
        page.keyboard.up(" ")
        after = page.evaluate("() => [wbPanX, wbPanY]")
        assert after == [before[0] + 60, before[1] + 30]
        assert page.evaluate("() => wbGetSelectedNoteTasks()") == []


class TestTheRibbonGroupButton:
    """Issue #1341: the Whiteboard ribbon's Arrange -> Group button was a
    "not available yet" stub although the grouping above already existed.
    It now runs the same grouping as the selection toolbar's "Group these".
    Driven through the ribbon's own button rather than the function, since
    the missing wiring was the bug."""

    def ribbon_group(self, page):
        # The Whiteboard tab is contextual: it appears once the board is
        # open but is not the selected tab until the user picks it.
        page.click('.ribbon-tab-btn.contextual[data-tab="__ctx"]')
        btn = page.locator(
            'button[data-scope-id="whiteboard"][data-label="Group"]'
        ).first
        btn.wait_for(state="visible")
        return btn

    def test_it_groups_the_selected_notes(self, page, app_server):
        board(page, app_server)
        select(page, ["Alpha", "Beta"])
        self.ribbon_group(page).click()
        name_new_group(page, "Discovery")
        lines = outline(page)
        start = lines.index("Discovery")
        assert lines[start:start + 6] == [
            "Discovery",
            "  Alpha",
            "    Alpha one",
            "    Alpha two",
            "  Beta",
            "    Beta one",
        ]
        assert page.locator(".wb-note").count() == 3

    def test_with_one_note_selected_it_explains_rather_than_staying_silent(
        self, page, app_server
    ):
        board(page, app_server)
        select(page, ["Alpha"])
        before = plan_text(page)
        self.ribbon_group(page).click()
        page.wait_for_function(
            "() => document.body.innerText.includes('Select two or more notes to group')"
        )
        assert "isn't available yet" not in page.locator("body").inner_text()
        assert plan_text(page) == before
        assert page.locator(".wb-group-box").count() == 0


class TestTheBoundaryTravelsWithItsNotes:
    """#874 left this as an open question and leaned yes. It is yes: a
    boundary you can slide off its own contents lies about what it contains
    for as long as the gesture lasts."""

    def _grouped(self, page, app_server):
        board(page, app_server)
        select(page, ["Alpha", "Beta"])
        group_selection(page, "Discovery")

    def test_dragging_the_boundary_moves_every_note_inside_it(
        self, page, app_server
    ):
        self._grouped(page, app_server)
        before = {n: note(page, n).bounding_box() for n in ("Alpha", "Beta", "Gamma")}

        box = page.locator(".wb-group-box").bounding_box()
        # The boundary's own top edge, clear of the notes inside it.
        start_x = box["x"] + box["width"] / 2
        start_y = box["y"] + 6
        page.mouse.move(start_x, start_y)
        page.mouse.down()
        for i in range(1, 7):
            page.mouse.move(start_x, start_y + 80 * i / 6)
        page.mouse.up()
        page.wait_for_timeout(300)

        after = {n: note(page, n).bounding_box() for n in ("Alpha", "Beta", "Gamma")}
        for member in ("Alpha", "Beta"):
            moved = after[member]["y"] - before[member]["y"]
            assert moved > 40, f"{member} did not travel with its boundary ({moved})"
        assert abs(after["Gamma"]["y"] - before["Gamma"]["y"]) < 2, (
            "a note outside the boundary moved with it"
        )

    def test_the_whole_group_moves_in_one_write(self, page, app_server):
        """Moving six notes is one thing the user did, so it is one commit --
        not one per note, which would also be six undo steps to get back.

        Counted at wbCommitMarkdown() rather than inferred from the undo
        stack: the editor coalesces writes on a debounce, so an undo-depth
        assertion would be measuring the debounce rather than this."""
        self._grouped(page, app_server)
        page.evaluate(
            """() => {
                window.__wbCommits = 0;
                const real = window.wbCommitMarkdown;
                window.wbCommitMarkdown = function (...args) {
                    window.__wbCommits += 1;
                    return real.apply(this, args);
                };
            }"""
        )

        box = page.locator(".wb-group-box").bounding_box()
        start_x, start_y = box["x"] + box["width"] / 2, box["y"] + 6
        page.mouse.move(start_x, start_y)
        page.mouse.down()
        for i in range(1, 7):
            page.mouse.move(start_x, start_y + 80 * i / 6)
        page.mouse.up()
        page.wait_for_function("() => window.__wbCommits > 0")
        page.wait_for_timeout(400)  # give a second write a chance to show up

        assert page.evaluate("() => window.__wbCommits") == 1, (
            "the group wrote the plan more than once for one drag"
        )

    def test_a_boundary_that_has_not_moved_writes_nothing(self, page, app_server):
        """A press that turns out to be a click -- to hover the Ungroup
        control, say -- must not commit a no-op move."""
        self._grouped(page, app_server)
        before = plan_text(page)

        box = page.locator(".wb-group-box").bounding_box()
        page.mouse.move(box["x"] + box["width"] / 2, box["y"] + 6)
        page.mouse.down()
        page.mouse.up()
        page.wait_for_timeout(400)

        assert plan_text(page) == before


class TestMerging:
    def test_combine_folds_the_selection_into_the_first_note(
        self, page, app_server
    ):
        board(page, app_server)
        select(page, ["Alpha", "Beta"])
        page.once("dialog", lambda d: d.dismiss())  # keep the target's own name
        page.click(".wb-selection-combine")
        page.wait_for_function(
            "() => document.querySelectorAll('.wb-note').length === 2"
        )

        assert outline(page) == [
            "Alpha",
            "  Alpha one",
            "  Alpha two",
            "  Beta one",
            "Gamma",
            "  Gamma one",
        ]
        assert page.locator(".wb-note").count() == 2, (
            "the merged-away note is still on the board"
        )

    def test_the_merged_note_can_be_renamed_on_the_spot(self, page, app_server):
        """#874 asks for a gentle naming prompt. Offered, not forced: the
        merged note already has a name, so cancelling leaves something
        sensible rather than nothing."""
        board(page, app_server)
        select(page, ["Alpha", "Beta"])
        page.once("dialog", lambda d: d.accept("Everything"))
        page.click(".wb-selection-combine")
        # Waited on the board, not on the plan text. The commit rewrites the
        # editor and the board re-renders from it a tick later, so a wait that
        # stops at the text can return before the note exists -- a check-then-
        # act race that only loses under `-n auto`, which is exactly where CI
        # runs this.
        page.wait_for_selector(
            '#whiteboardContainer .wb-note[data-wb-task="Everything"]'
        )
        assert note(page, "Everything").count() == 1

    def test_dragging_one_note_onto_another_merges_them(self, page, app_server):
        board(page, app_server)
        target = note(page, "Alpha").bounding_box()
        header = note(page, "Beta").locator(".wb-note-header").bounding_box()

        page.once("dialog", lambda d: d.accept())  # the confirm
        page.mouse.move(
            header["x"] + header["width"] / 2, header["y"] + header["height"] / 2
        )
        page.mouse.down()
        end_x = target["x"] + target["width"] / 2
        end_y = target["y"] + target["height"] / 2
        for i in range(1, 11):
            page.mouse.move(
                header["x"] + header["width"] / 2
                + (end_x - header["x"] - header["width"] / 2) * i / 10,
                header["y"] + header["height"] / 2
                + (end_y - header["y"] - header["height"] / 2) * i / 10,
            )
        page.mouse.up()
        page.wait_for_function(
            "() => document.querySelectorAll('.wb-note').length === 2"
        )

        rows = note(page, "Alpha").locator(".wb-note-row-name").all_inner_texts()
        assert [r.strip() for r in rows] == ["Alpha one", "Alpha two", "Beta one"]

    def test_declining_the_confirm_leaves_the_note_where_it_was_dropped(
        self, page, app_server
    ):
        """Landing on a note is one pixel from landing beside it, and the two
        outcomes are "nothing happened" and "that note is gone"."""
        board(page, app_server)
        target = note(page, "Alpha").bounding_box()
        header = note(page, "Beta").locator(".wb-note-header").bounding_box()

        page.once("dialog", lambda d: d.dismiss())
        page.mouse.move(
            header["x"] + header["width"] / 2, header["y"] + header["height"] / 2
        )
        page.mouse.down()
        end_x = target["x"] + target["width"] / 2
        end_y = target["y"] + target["height"] / 2
        for i in range(1, 11):
            page.mouse.move(
                header["x"] + header["width"] / 2
                + (end_x - header["x"] - header["width"] / 2) * i / 10,
                header["y"] + header["height"] / 2
                + (end_y - header["y"] - header["height"] / 2) * i / 10,
            )
        page.mouse.up()
        page.wait_for_timeout(400)

        assert page.locator(".wb-note").count() == 3
        assert "Beta" in plan_text(page)


class TestTheTwoGesturesEndSomewhereDifferent:
    """The thing #874 asks to be obvious at the moment of choosing. Asserted
    on the outcome rather than on the button labels, because the labels are
    the promise and this is whether it is kept."""

    def test_group_keeps_every_member_a_note_and_merge_does_not(
        self, page, app_server
    ):
        board(page, app_server)
        select(page, ["Alpha", "Beta"])
        group_selection(page, "Discovery")
        grouped_notes = page.locator(".wb-note").count()
        grouped_plan = plan_text(page)

        board(page, app_server)
        select(page, ["Alpha", "Beta"])
        page.once("dialog", lambda d: d.dismiss())
        page.click(".wb-selection-combine")
        page.wait_for_function(
            "() => document.querySelectorAll('.wb-note').length === 2"
        )
        merged_notes = page.locator(".wb-note").count()

        assert grouped_notes == 3, "grouping left a member without a note"
        assert merged_notes == 2, "merging left more than one note"
        assert "Beta" in grouped_plan.split("---whiteboard---")[0]
