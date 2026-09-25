"""The planning session's participants in the ribbon's title bar.

While a session is live and someone has joined, the title bar shows who, as
the design system's overlapping <np-resource-stack> chips -- the ones task
assignments use -- between the planning-session button and the document
title. A chip does what the status-bar chat bubble does: it opens the
session chat.

Usage:
    uv run pytest tests/ui/test_collab_ribbon_people.py -q
"""

from .test_collab_whiteboard import host, joiner  # noqa: F401 -- fixtures

PEOPLE = "#ribbonCollabPeople"


def chips(pg):
    return pg.locator(f"{PEOPLE} >> .chip")


def join_as(context, app_server, code, name):
    other = context.new_page()
    other.set_default_timeout(15_000)
    other.goto(f"{app_server}/join")
    other.fill("#joinCode", code)
    other.fill("#displayName", name)
    other.click("#joinBtn")
    other.wait_for_selector("#relayInput", state="visible")
    return other


def test_no_chips_until_someone_joins(host):
    host_page, _ = host
    host_page.wait_for_selector(".ribbon-quick-btn")
    assert host_page.locator(PEOPLE).count() == 0


def test_a_joiner_appears_between_the_session_button_and_the_title(joiner, host):
    host_page, _ = host
    host_page.wait_for_selector(PEOPLE)
    assert chips(host_page).count() == 1
    assert chips(host_page).first.inner_text() == "AL"
    assert chips(host_page).first.get_attribute("aria-label") == "Alex"
    button = host_page.locator('.ribbon-quick-btn[data-quick="Start planning session"]').bounding_box()
    stack = host_page.locator(PEOPLE).bounding_box()
    title = host_page.locator("#ribbonDocTitle").bounding_box()
    assert button["x"] + button["width"] <= stack["x"]
    assert stack["x"] + stack["width"] <= title["x"]


def test_several_joiners_overlap_like_task_assignments(joiner, host, app_server):
    host_page, code = host
    second = join_as(joiner.context, app_server, code, "Jo Lee")
    host_page.wait_for_function(
        f"() => document.querySelector('{PEOPLE}')?.shadowRoot.querySelectorAll('.chip').length === 2"
    )
    first_box = chips(host_page).nth(0).bounding_box()
    second_box = chips(host_page).nth(1).bounding_box()
    assert second_box["x"] < first_box["x"] + first_box["width"], "chips should overlap"
    # Sized from the spacing scale, not a one-off pixel value.
    assert host_page.evaluate(
        f"""() => getComputedStyle(document.querySelector('{PEOPLE}')).getPropertyValue('--np-avatar-size').trim()"""
    ) == host_page.evaluate(
        "() => getComputedStyle(document.documentElement).getPropertyValue('--np-space-24').trim()"
    )
    second.close()


def test_clicking_a_chip_opens_the_session_chat(joiner, host):
    host_page, _ = host
    host_page.wait_for_selector(PEOPLE)
    assert host_page.locator("#collabChatPanel").is_hidden()
    chips(host_page).first.click()
    host_page.wait_for_selector("#collabChatPanel", state="visible")
    # A second click keeps it open rather than toggling it shut.
    chips(host_page).first.click()
    assert host_page.locator("#collabChatPanel").is_visible()


def test_the_card_says_who_and_opens_the_chat(joiner, host):
    host_page, _ = host
    host_page.wait_for_selector(PEOPLE)
    chips(host_page).first.hover()
    card = host_page.locator(f"{PEOPLE} >> .card")
    card.wait_for(state="visible")
    assert "Alex" in card.inner_text()
    assert "Active" in card.inner_text()
    link = host_page.locator(f"{PEOPLE} >> .card .open")
    assert link.inner_text() == "Open session chat"
    link.click()
    host_page.wait_for_selector("#collabChatPanel", state="visible")


def test_chips_go_when_everyone_leaves(joiner, host):
    host_page, _ = host
    host_page.wait_for_selector(PEOPLE)
    joiner.click("#leaveBtn")
    host_page.wait_for_selector(PEOPLE, state="detached")
