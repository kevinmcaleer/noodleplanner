"""The whiteboard's key to its lines, and the Whiteboard ribbon tab on a
planning-session joiner's page.

The ribbon's Whiteboard > Key button shows and hides a small card saying what
a solid line (a sub-task) and a dashed line (a dependency) mean. The joiner
page now carries the same ribbon, pinned to its Whiteboard tab, so a
collaborator has the same board commands as the host.

Usage:
    uv run pytest tests/ui/test_whiteboard_key.py -q
"""

import os

import pytest

from .helpers import actionable_console_errors, load_plan, open_app, switch_to_whiteboard

PLAN = """---
title: Key Board
---
Alpha
  Alpha one 2d
  Alpha two 2d [depends: Alpha one]
Beta

---whiteboard---
| Task  | X   | Y  | Colour | Width | Height | Collapsed |
|-------|-----|----|--------|-------|--------|-----------|
| Alpha | 360 | 60 |        | 240   | 180    | no        |
| Beta  | 700 | 60 |        | 240   | 180    | no        |
"""

SHOTS = os.environ.get("NOODLE_SHOT_DIR")


def shot(pg, name):
    if SHOTS:
        pg.wait_for_timeout(400)  # let the ribbon's tab fade-in finish
        pg.screenshot(path=os.path.join(SHOTS, f"{name}.png"))


def key_button(pg):
    return pg.locator('#ribbonShell [data-scope-id="whiteboard"][data-label="Key"]')


def open_whiteboard_tab(pg):
    """Select the Whiteboard contextual tab, as a user would on the app."""
    tab = pg.locator('#ribbonShell .ribbon-tab-btn.contextual')
    tab.wait_for()
    if tab.get_attribute("aria-selected") != "true":
        tab.click()
    key_button(pg).wait_for()


@pytest.fixture
def board(page, app_server):
    page.set_default_timeout(15_000)
    open_app(page, app_server)
    page.evaluate("() => { try { localStorage.removeItem('whiteboard_key_visible'); } catch (e) {} }")
    load_plan(page, PLAN)
    switch_to_whiteboard(page)
    return page


class TestTheKey:
    def test_hidden_until_asked_for(self, board):
        assert board.locator("#whiteboardKey").is_hidden()

    def test_the_ribbon_button_shows_and_hides_it(self, board):
        open_whiteboard_tab(board)
        key_button(board).click()
        key = board.locator("#whiteboardKey")
        key.wait_for(state="visible")
        assert "Solid line" in key.inner_text()
        assert "Dashed line" in key.inner_text()
        assert key_button(board).get_attribute("aria-pressed") == "true"
        shot(board, "host-key")
        key_button(board).click()
        key.wait_for(state="hidden")
        assert key_button(board).get_attribute("aria-pressed") == "false"

    def test_its_close_button_hides_it(self, board):
        open_whiteboard_tab(board)
        key_button(board).click()
        board.locator("#whiteboardKey np-close-button").click()
        board.locator("#whiteboardKey").wait_for(state="hidden")

    def test_it_is_remembered(self, board):
        open_whiteboard_tab(board)
        key_button(board).click()
        board.reload()
        load_plan(board, PLAN)
        switch_to_whiteboard(board)
        board.locator("#whiteboardKey").wait_for(state="visible")

    def test_samples_match_the_real_noodles(self, board):
        open_whiteboard_tab(board)
        key_button(board).click()
        styles = board.evaluate(
            """() => {
                const read = (sel) => {
                    const s = getComputedStyle(document.querySelector(sel));
                    return { stroke: s.stroke, dash: s.strokeDasharray };
                };
                return {
                    solid: read('.wb-key-sample-hierarchy .wb-key-line'),
                    dashed: read('.wb-key-sample-dependency .wb-key-line'),
                    realDep: read('.wb-dep-noodle-path'),
                };
            }"""
        )
        assert styles["solid"]["dash"] == "none"
        assert styles["dashed"]["dash"] != "none"
        assert styles["dashed"]["stroke"] == styles["realDep"]["stroke"]


class TestTheJoinerHasTheRibbon:
    @pytest.fixture
    def joiner(self, page, app_server):
        host_page = page.context.new_page()
        host_page.set_default_timeout(15_000)
        open_app(host_page, app_server)
        load_plan(host_page, PLAN)
        switch_to_whiteboard(host_page)
        host_page.evaluate("() => startCollabSession()")
        host_page.wait_for_function(
            "() => document.getElementById('collabSessionCode').value.length === 6"
        )
        code = host_page.input_value("#collabSessionCode")
        page.set_default_timeout(15_000)
        page.goto(f"{app_server}/join")
        page.evaluate("() => { try { localStorage.removeItem('whiteboard_key_visible'); } catch (e) {} }")
        page.fill("#joinCode", code)
        page.fill("#displayName", "Alex")
        page.click("#joinBtn")
        page.wait_for_selector("#relayInput", state="visible")
        page.wait_for_function(
            "() => document.querySelectorAll('#whiteboardContainer .wb-note').length === 2"
        )
        page.bring_to_front()
        yield page, host_page
        host_page.close()

    def test_only_the_whiteboard_tab(self, joiner):
        page, _ = joiner
        key_button(page).wait_for()
        assert page.locator("#ribbonShell .ribbon-tab-btn").count() == 1
        assert page.locator("#ribbonShell .ribbon-titlebar").count() == 0
        assert page.locator("#ribbonShell .ribbon-file-btn").count() == 0
        assert page.locator('#ribbonShell [data-label="Tidy"]').is_visible()
        shot(page, "joiner-ribbon")
        assert actionable_console_errors(page) == []

    def test_the_key_works_there_too(self, joiner):
        page, _ = joiner
        key_button(page).click()
        page.locator("#whiteboardKey").wait_for(state="visible")
        shot(page, "joiner-key")
        assert actionable_console_errors(page) == []

    def test_a_ribbon_note_reaches_the_host(self, joiner):
        page, host_page = joiner
        page.locator('#ribbonShell [data-scope-id="whiteboard"][data-label="Note"]').click()
        title = page.locator(".wb-note-title.editing")
        title.wait_for()
        page.keyboard.type("Gamma")
        page.keyboard.press("Enter")
        host_page.wait_for_function(
            "() => document.getElementById('planEditor').value.includes('Gamma')"
        )

    def test_the_board_still_fills_the_rest_of_the_page(self, joiner):
        page, _ = joiner
        ribbon = page.locator("#ribbonShell").bounding_box()
        board = page.locator("#whiteboardContainer").bounding_box()
        assert board["y"] >= ribbon["y"] + ribbon["height"] - 1
        assert board["y"] + board["height"] >= page.viewport_size["height"] - 4
