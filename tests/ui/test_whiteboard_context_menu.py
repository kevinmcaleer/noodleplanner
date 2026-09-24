"""Right-click menus on the whiteboard.

A right-click on a note opens that note's own `...` menu at the pointer, and a
right-click on bare canvas opens a board menu whose "here" items drop the new
object where you clicked. Anything being typed in keeps the browser's menu.

Usage:
    uv run pytest tests/ui/test_whiteboard_context_menu.py -q
"""

from .helpers import load_plan, note, open_app, open_note_menu, switch_to_whiteboard

PLAN = """---
title: Context Menu Test Plan
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


def _board(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    switch_to_whiteboard(page)


def _menu_labels(page):
    return page.evaluate(
        "() => [...document.querySelectorAll('#wbNoteMenu [role=menuitem]')]"
        "        .map(n => n.textContent.trim())"
    )


def _empty_canvas_point(page):
    """A point on bare canvas with room for a new post-it centred on it, so
    the free-space fallback never moves it. The outline panel floats over the
    canvas's left edge, so it is closed first, and the page is widened enough
    for a note's width of canvas on one side of the existing note."""
    page.set_viewport_size({"width": 1800, "height": 1000})
    page.evaluate("() => wbToggleOutlinePanel(false)")
    # Both of those can move the board; read positions once it has settled.
    page.wait_for_function(
        """() => new Promise(done => {
            const read = () => wbGroup.getAttribute('transform') + '|' +
                JSON.stringify(document.querySelector('foreignObject.wb-note')
                    .getBoundingClientRect());
            const first = read();
            setTimeout(() => done(read() === first), 300);
        })"""
    )
    box = page.locator("#whiteboardContainer").bounding_box()
    card = note(page, "Build").bounding_box()
    room_left = card["x"] - box["x"]
    room_right = box["x"] + box["width"] - (card["x"] + card["width"])
    y = card["y"] + card["height"] / 2
    if room_left >= room_right:
        return box["x"] + room_left / 2, y
    return card["x"] + card["width"] + room_right / 2, y


def _right_click_note_header(page):
    box = note(page, "Build").locator(".wb-note-header").bounding_box()
    x, y = box["x"] + 12, box["y"] + box["height"] / 2
    page.mouse.click(x, y, button="right")
    return x, y


class TestNoteMenu:
    def test_right_click_on_a_note_opens_its_menu_at_the_pointer(
        self, page, app_server
    ):
        _board(page, app_server)
        x, y = _right_click_note_header(page)
        page.wait_for_selector(MENU, state="visible")
        assert "Rename" in _menu_labels(page)
        box = page.locator(MENU).bounding_box()
        assert abs(box["x"] - x) <= 2, "the menu opens at the pointer, not the button"

    def test_the_menu_belongs_to_the_notes_button(self, page, app_server):
        """Same menu as the object toolbar's More button: it says so, and
        Escape goes back there."""
        _board(page, app_server)
        _right_click_note_header(page)
        page.wait_for_selector(MENU, state="visible")
        btn = page.locator(".wb-object-toolbar .wb-object-toolbar-more")
        assert btn.get_attribute("aria-expanded") == "true"
        page.keyboard.press("Escape")
        page.wait_for_selector(MENU, state="detached")
        assert btn.get_attribute("aria-expanded") == "false"
        assert page.evaluate(
            "() => document.activeElement.classList.contains('wb-object-toolbar-more')")

    def test_a_title_being_edited_keeps_the_browsers_menu(self, page, app_server):
        _board(page, app_server)
        handled = page.evaluate(
            """() => {
                const fo = document.querySelector('foreignObject.wb-note');
                const title = fo.querySelector('.wb-note-title');
                title.contentEditable = 'true';
                const ev = new MouseEvent('contextmenu',
                    { bubbles: true, cancelable: true, clientX: 10, clientY: 10 });
                title.dispatchEvent(ev);
                title.contentEditable = 'false';
                return ev.defaultPrevented;
            }"""
        )
        assert handled is False
        assert page.locator(MENU).count() == 0


class TestCanvasMenu:
    def test_right_click_on_bare_canvas_opens_the_board_menu(self, page, app_server):
        _board(page, app_server)
        page.mouse.click(*_empty_canvas_point(page), button="right")
        page.wait_for_selector(MENU, state="visible")
        labels = _menu_labels(page)
        assert "New post-it here" in labels
        assert "Fit to content" in labels
        assert "Rename" not in labels, "not a note's menu"

    def test_new_post_it_here_lands_where_you_clicked(self, page, app_server):
        _board(page, app_server)
        x, y = _empty_canvas_point(page)
        want = page.evaluate("([x, y]) => wbClientToBoard(x, y)", [x, y])
        page.mouse.click(x, y, button="right")
        page.wait_for_selector(MENU, state="visible")
        page.locator(MENU).get_by_role("menuitem", name="New post-it here").click()
        page.wait_for_selector(MENU, state="detached")
        page.wait_for_function(
            "() => document.querySelectorAll('foreignObject.wb-note').length === 2")
        placed = page.evaluate(
            """() => {
                const rows = parseWhiteboardMarkdown(extractWhiteboardFromPlanText(
                    document.getElementById('planEditor').value));
                const row = rows.find(r => r.task === 'New idea');
                return { cx: row.x + row.width / 2, cy: row.y + row.height / 2 };
            }"""
        )
        assert abs(placed["cx"] - want["x"]) <= 1
        assert abs(placed["cy"] - want["y"]) <= 1

    def test_escape_returns_focus_to_the_canvas(self, page, app_server):
        _board(page, app_server)
        page.mouse.click(*_empty_canvas_point(page), button="right")
        page.wait_for_selector(MENU, state="visible")
        page.keyboard.press("Escape")
        page.wait_for_selector(MENU, state="detached")
        assert page.evaluate(
            "() => document.activeElement.id") == "whiteboardContainer"

    def test_a_left_click_on_the_canvas_closes_it(self, page, app_server):
        """The canvas container is where focus returns to, not a trigger --
        clicking inside it must still count as clicking outside the menu."""
        _board(page, app_server)
        x, y = _empty_canvas_point(page)
        page.mouse.click(x, y, button="right")
        page.wait_for_selector(MENU, state="visible")
        page.mouse.click(x - 40, y - 40)
        page.wait_for_selector(MENU, state="detached")

    def test_right_clicking_a_note_replaces_the_canvas_menu(self, page, app_server):
        _board(page, app_server)
        page.mouse.click(*_empty_canvas_point(page), button="right")
        page.wait_for_selector(MENU, state="visible")
        _right_click_note_header(page)
        page.wait_for_function(
            "() => [...document.querySelectorAll('#wbNoteMenu [role=menuitem]')]"
            "        .some(n => n.textContent.trim() === 'Rename')")
        assert page.locator(MENU).count() == 1
