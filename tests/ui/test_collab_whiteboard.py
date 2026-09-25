"""A planning-session joiner working on the host's whiteboard (#1347).

The joiner page (/join) used to draw its own board: a separate note design
that took neither the host's colours nor its later edits, could not rename a
note, change its colour, edit its checklist or group notes, had no zoom or
structure panel, and whose "New post-it" only appeared on the host once the
host moved it. It now runs the host's own whiteboard against the host's plan
text, and sends every edit back as a whole-text replacement the host applies.

These tests drive both sides for real: `page` is the joiner, and `host` is the
full app in a second page of the same browser, hosting the session with its
whiteboard open.

Usage:
    uv run pytest tests/ui/test_collab_whiteboard.py -q
"""

import pytest

from .helpers import actionable_console_errors, load_plan, open_app, switch_to_whiteboard

PLAN = """---
title: Session Board
---
Alpha
  Alpha one
  Alpha two
Beta
  Beta one

---whiteboard---
| Task  | X   | Y  | Colour  | Width | Height | Collapsed |
|-------|-----|----|---------|-------|--------|-----------|
| Alpha | 60  | 60 | #FFAFA3 | 240   | 180    | no        |
| Beta  | 360 | 60 |         | 240   | 180    | no        |
"""


def board_note(pg, task):
    return pg.locator(f'#whiteboardContainer .wb-note[data-wb-task="{task}"]')


def host_plan(host_page):
    return host_page.evaluate("() => document.getElementById('planEditor').value")


def joiner_plan(page):
    return page.evaluate("() => document.getElementById('planEditor').value")


def set_host_plan(host_page, text):
    """Type into the host's editor the way the PM does."""
    host_page.eval_on_selector(
        "#planEditor",
        """(editor, value) => {
            editor.value = value;
            editor.dispatchEvent(new Event('input', { bubbles: true }));
        }""",
        text,
    )


@pytest.fixture
def host(page, app_server):
    """The app, with PLAN on its whiteboard, hosting a live session."""
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
    # Out of the way of the board, as a host working on it would have it.
    host_page.evaluate("() => minimiseCollabSessionModal()")
    yield host_page, code
    host_page.close()


@pytest.fixture
def joiner(page, app_server, host):
    """The joiner, in the session, with the host's board drawn."""
    host_page, code = host
    page.set_default_timeout(15_000)
    page.goto(f"{app_server}/join")
    page.fill("#joinCode", code)
    page.fill("#displayName", "Alex")
    page.click("#joinBtn")
    page.wait_for_selector("#relayInput", state="visible")
    page.wait_for_function(
        "() => document.querySelectorAll('#whiteboardContainer .wb-note').length === 2"
    )
    # In front, as the joiner's own tab is, and fitted, so a real pointer
    # can reach every note.
    page.bring_to_front()
    page.evaluate("() => whiteboardZoomFit()")
    page.wait_for_timeout(300)
    return page


def note_colour(pg, task):
    return pg.evaluate(
        """t => getComputedStyle(document.querySelector(
               `#whiteboardContainer .wb-note[data-wb-task="${t}"] .wb-note-card`)).backgroundColor""",
        task,
    )


class TestTheJoinerSeesTheHostsBoard:
    def test_joining_raises_no_page_errors(self, joiner):
        assert actionable_console_errors(joiner) == []

    def test_notes_are_the_hosts_own(self, joiner, host):
        host_page, _ = host
        assert joiner.locator("#whiteboardContainer .wb-note-card").count() == 2
        assert note_colour(joiner, "Alpha") == note_colour(host_page, "Alpha")
        assert note_colour(joiner, "Beta") == note_colour(host_page, "Beta")

    def test_zoom_controls_and_structure_panel_are_there(self, joiner):
        assert joiner.locator("#whiteboardZoomInBtn").is_visible()
        assert joiner.locator("#whiteboardZoomOutBtn").is_visible()
        before = joiner.inner_text("#whiteboardZoomLabel")
        joiner.click("#whiteboardZoomInBtn")
        joiner.wait_for_function(
            "b => document.getElementById('whiteboardZoomLabel').textContent !== b", arg=before
        )
        assert joiner.locator("#whiteboardOutlineBtn").is_visible()
        assert joiner.locator(".wb-outline-panel").count() == 1

    def test_the_board_fills_the_page(self, joiner):
        board = joiner.locator("#whiteboardContainer").bounding_box()
        viewport = joiner.viewport_size
        chat = joiner.locator("#chatPanel").bounding_box()
        # Everything the chat panel does not take, give or take the toolbar.
        assert board["width"] + chat["width"] >= viewport["width"] - 4
        assert board["y"] + board["height"] >= viewport["height"] - 4

    def test_there_is_no_list_view_any_more(self, joiner):
        assert joiner.locator(".joiner-tab").count() == 0
        assert joiner.locator("#joinNotepadContainer").count() == 0

    def test_nothing_says_post_it(self, joiner):
        assert "post-it" not in joiner.content().lower()


class TestHostEditsReachTheJoiner:
    def test_a_rename_typed_in_the_markdown_arrives(self, joiner, host):
        host_page, _ = host
        set_host_plan(host_page, host_plan(host_page).replace("  Alpha two", "  Alpha second"))
        joiner.wait_for_function(
            "() => document.querySelector('#whiteboardContainer .wb-note[data-wb-task=\"Alpha\"]')"
            "        .textContent.includes('Alpha second')"
        )

    def test_a_colour_typed_in_the_markdown_arrives(self, joiner, host):
        host_page, _ = host
        before = note_colour(joiner, "Beta")
        set_host_plan(
            host_page,
            host_plan(host_page).replace("| Beta  | 360 | 60 |         |", "| Beta  | 360 | 60 | #A8D5BA |"),
        )
        joiner.wait_for_function(
            """before => getComputedStyle(document.querySelector(
                   '#whiteboardContainer .wb-note[data-wb-task="Beta"] .wb-note-card')).backgroundColor !== before""",
            arg=before,
        )
        host_page.wait_for_timeout(1500)  # the host's own debounced render
        assert note_colour(joiner, "Beta") == note_colour(host_page, "Beta")


class TestJoinerEditsReachTheHost:
    def test_a_new_note_appears_on_both_boards(self, joiner, host):
        host_page, _ = host
        joiner.click("#whiteboardNewNoteBtn")
        title = joiner.locator(".wb-note-title.editing")
        title.wait_for()
        joiner.keyboard.type("Gamma")
        joiner.keyboard.press("Enter")
        host_page.wait_for_function(
            "() => document.querySelector('#whiteboardContainer .wb-note[data-wb-task=\"Gamma\"]')"
        )
        board_note(joiner, "Gamma").wait_for()
        assert "Gamma" in host_plan(host_page)
        assert actionable_console_errors(joiner) == []

    def test_adding_a_checklist_item(self, joiner, host):
        host_page, _ = host
        field = board_note(joiner, "Beta").locator(".wb-note-add-input")
        field.click()
        field.fill("Beta two")
        field.press("Enter")
        host_page.wait_for_function(
            "() => document.getElementById('planEditor').value.includes('Beta two')"
        )
        host_page.wait_for_function(
            "() => document.querySelector('#whiteboardContainer .wb-note[data-wb-task=\"Beta\"]')"
            "        .textContent.includes('Beta two')"
        )
        assert actionable_console_errors(joiner) == []

    def test_ticking_a_checklist_item(self, joiner, host):
        host_page, _ = host
        box = board_note(joiner, "Alpha").locator("np-checkbox").first.bounding_box()
        joiner.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        host_page.wait_for_function(
            "() => /Alpha one.*100%/.test(document.getElementById('planEditor').value)"
        )
        assert actionable_console_errors(joiner) == []

    def test_renaming_a_note(self, joiner, host):
        host_page, _ = host
        joiner.evaluate("() => wbSetSelectedNote('Beta')")
        joiner.locator(".wb-object-toolbar .wb-object-toolbar-edit").dispatch_event("click")
        title = joiner.locator(".wb-note-title.editing")
        title.wait_for()
        joiner.keyboard.press("Control+A")
        joiner.keyboard.type("Beta renamed")
        joiner.keyboard.press("Enter")
        host_page.wait_for_function(
            "() => document.querySelector('#whiteboardContainer .wb-note[data-wb-task=\"Beta renamed\"]')"
        )
        assert actionable_console_errors(joiner) == []

    def test_changing_a_notes_colour(self, joiner, host):
        host_page, _ = host
        joiner.evaluate("() => wbSetSelectedNote('Beta')")
        joiner.locator(".wb-object-toolbar .wb-object-toolbar-colour").dispatch_event("click")
        joiner.locator('#wbNoteMenu .wb-note-menu-swatch[title="#FFAFA3"]').click()
        # A note's colour lives in the front matter's Theme map.
        host_page.wait_for_function(
            "() => /^- Beta: #FFAFA3$/mi.test(document.getElementById('planEditor').value)"
        )
        joiner.wait_for_function(
            """() => getComputedStyle(document.querySelector(
                   '#whiteboardContainer .wb-note[data-wb-task="Beta"] .wb-note-card')).backgroundColor
                 === getComputedStyle(document.querySelector(
                   '#whiteboardContainer .wb-note[data-wb-task="Alpha"] .wb-note-card')).backgroundColor"""
        )
        assert actionable_console_errors(joiner) == []

    def test_grouping_notes(self, joiner, host):
        host_page, _ = host
        joiner.evaluate("() => wbSetSelectedNotes(['Alpha', 'Beta'])")
        joiner.click(".wb-selection-group")
        field = joiner.locator(".wb-group-title-input")
        field.wait_for(state="visible")
        field.fill("Discovery")
        field.press("Enter")
        host_page.wait_for_selector('.wb-group[data-wb-group="Discovery"] .wb-group-box')
        assert "Discovery" in host_plan(host_page)
        assert actionable_console_errors(joiner) == []

    def test_moving_a_note(self, joiner, host):
        host_page, _ = host
        header = board_note(joiner, "Beta").locator(".wb-note-title").bounding_box()
        x, y = header["x"] + 8, header["y"] + header["height"] / 2
        joiner.mouse.move(x, y)
        joiner.mouse.down()
        joiner.mouse.move(x + 60, y + 90, steps=8)
        joiner.mouse.up()
        host_page.wait_for_function(
            "() => !/\\|\\s*Beta\\s*\\|\\s*360\\s*\\|\\s*60\\s*\\|/.test(document.getElementById('planEditor').value)"
        )
        assert actionable_console_errors(joiner) == []


class TestConcurrentEdits:
    def test_a_joiner_edit_racing_the_hosts_typing_is_kept(self, joiner, host):
        """The host types; before its broadcast goes out, the joiner edits a
        different line. The host bounces the joiner's edit as stale, and the
        joiner rebases it onto the host's text and sends it again -- neither
        edit is lost."""
        host_page, _ = host
        set_host_plan(host_page, host_plan(host_page).replace("  Beta one", "  Beta first"))
        joiner.evaluate(
            """() => {
                const editor = document.getElementById('planEditor');
                editor.value = editor.value.replace('  Alpha one', '  Alpha uno');
                editor.dispatchEvent(new Event('input', { bubbles: true }));
            }"""
        )
        host_page.wait_for_function(
            """() => { const t = document.getElementById('planEditor').value;
                       return t.includes('Alpha uno') && t.includes('Beta first'); }"""
        )
        joiner.wait_for_function(
            """() => { const t = document.getElementById('planEditor').value;
                       return t.includes('Alpha uno') && t.includes('Beta first'); }"""
        )
        assert joiner_plan(joiner) == host_plan(host_page)


class TestLeavingAndChat:
    def test_leave_session_returns_to_the_join_form(self, joiner):
        joiner.click("#leaveBtn")
        joiner.wait_for_selector("#joinForm", state="visible")
        assert "You left the session" in joiner.inner_text("#status")
        assert joiner.locator("#relay").is_hidden()

    def test_the_host_sees_the_joiner_leave(self, joiner, host):
        host_page, _ = host
        host_page.wait_for_function(
            "() => document.querySelectorAll('#collabPresenceList .collab-presence-row').length === 1"
        )
        joiner.click("#leaveBtn")
        host_page.wait_for_function(
            "() => document.querySelectorAll('#collabPresenceList .collab-presence-row').length === 0"
        )

    def test_chat_is_a_collapsible_side_panel(self, joiner):
        panel = joiner.locator("#chatPanel")
        board_before = joiner.locator("#whiteboardContainer").bounding_box()["width"]
        assert panel.is_visible()
        assert panel.bounding_box()["x"] >= board_before - 2  # to the right of the board
        joiner.click("#chatCollapse")
        assert panel.is_hidden()
        assert joiner.get_attribute("#chatToggle", "aria-expanded") == "false"
        assert joiner.locator("#whiteboardContainer").bounding_box()["width"] > board_before
        joiner.click("#chatToggle")
        assert panel.is_visible()

    def test_messages_are_bubbles_with_a_profile_chip(self, joiner, host):
        host_page, _ = host
        joiner.fill("#relayInput", "hello board")
        for _ in range(50):
            joiner.press("#relayInput", "Enter")
            if joiner.input_value("#relayInput") == "":
                break
            joiner.wait_for_timeout(200)
        mine = joiner.locator(".np-chat-message.is-own")
        mine.wait_for()
        assert mine.locator(".np-chat-avatar").inner_text() == "AL"
        assert mine.locator(".np-chat-name").inner_text() == "You"
        assert mine.locator(".np-chat-time").inner_text() != ""
        assert mine.locator(".np-chat-bubble").inner_text() == "hello board"
        # The meta line sits above the bubble.
        meta = mine.locator(".np-chat-meta").bounding_box()
        bubble = mine.locator(".np-chat-bubble").bounding_box()
        assert meta["y"] + meta["height"] <= bubble["y"] + 1
        # The host renders the same message with the same bubble markup.
        host_page.evaluate("() => toggleCollabChatPanel()")
        theirs = host_page.locator("#collabChatList .np-chat-message:not(.is-own)")
        theirs.wait_for()
        assert theirs.locator(".np-chat-name").inner_text() == "Alex"
        assert theirs.locator(".np-chat-bubble").inner_text() == "hello board"

    def test_unread_count_while_the_chat_is_hidden(self, joiner, host):
        host_page, _ = host
        joiner.click("#chatCollapse")
        host_page.evaluate(
            """() => { const input = document.getElementById('collabChatInput');
                       input.value = 'from the host'; submitCollabChat(); }"""
        )
        joiner.wait_for_selector("#chatUnread", state="visible")
        assert joiner.inner_text("#chatUnread") == "1"
        joiner.click("#chatToggle")
        assert joiner.locator("#chatUnread").is_hidden()
