"""The host's session chat, docked beside the plan.

Expanded, the chat used to be a fixed panel laid over the right of the
window, covering whatever was there -- on the whiteboard, the parking lot.
Docked, it is a column beside the app instead, and the app gives up that
width, so nothing sits underneath it: the arrangement the joiner page's chat
already has.

Usage:
    uv run pytest tests/ui/test_collab_chat_dock.py -q
"""

from .test_collab_whiteboard import host  # noqa: F401 -- fixture


def open_chat(host_page):
    host_page.evaluate("() => openCollabChatPanel()")
    host_page.wait_for_selector("#collabChatPanel", state="visible")


def box(pg, selector):
    return pg.locator(selector).bounding_box()


def test_docking_puts_the_chat_beside_the_board_not_over_it(host):
    host_page, _ = host
    open_chat(host_page)
    host_page.click("#collabChatDockBtn")
    host_page.wait_for_function("() => document.body.classList.contains('collab-chat-docked')")
    host_page.wait_for_timeout(300)
    chat = box(host_page, "#collabChatPanel")
    board = box(host_page, "#whiteboardContainer")
    assert board["x"] + board["width"] <= chat["x"] + 1, (board, chat)
    assert chat["x"] + chat["width"] >= host_page.viewport_size["width"] - 1


def test_the_parking_lot_stays_in_view_while_docked(host):
    host_page, _ = host
    open_chat(host_page)
    host_page.click("#collabChatDockBtn")
    host_page.evaluate("() => wbOpenParkingLotPanel()")
    host_page.wait_for_selector("#wbParkingLotPanel.open")
    host_page.wait_for_timeout(400)  # its slide-in
    lot = box(host_page, "#wbParkingLotPanel")
    chat = box(host_page, "#collabChatPanel")
    assert lot["x"] + lot["width"] <= chat["x"] + 1, (lot, chat)


def test_undocking_or_closing_gives_the_width_back(host):
    host_page, _ = host
    width_before = box(host_page, "#whiteboardContainer")["width"]
    open_chat(host_page)
    host_page.click("#collabChatDockBtn")
    host_page.wait_for_function("() => document.body.classList.contains('collab-chat-docked')")
    assert host_page.get_attribute("#collabChatDockBtn", "aria-pressed") == "true"
    host_page.click("#collabChatDockBtn")
    host_page.wait_for_function("() => !document.body.classList.contains('collab-chat-docked')")
    assert host_page.get_attribute("#collabChatDockBtn", "aria-pressed") == "false"
    host_page.click("#collabChatDockBtn")
    host_page.wait_for_function("() => document.body.classList.contains('collab-chat-docked')")
    host_page.evaluate("() => closeCollabChatPanel()")
    host_page.wait_for_function("() => !document.body.classList.contains('collab-chat-docked')")
    host_page.wait_for_timeout(300)
    assert abs(box(host_page, "#whiteboardContainer")["width"] - width_before) <= 1
