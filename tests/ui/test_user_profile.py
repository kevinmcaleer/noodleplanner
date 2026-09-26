"""The user's own profile (#1377).

The profile circle at the right of the ribbon's title bar used to be an empty,
unclickable dot. It now opens "Your profile" -- the same details as the
resource form -- saved in this browser's localStorage and nowhere else, and
shows the profile's initials. In a planning session the host's messages carry
the profile's name instead of "Host", and the join page offers it as the
joiner's name.

Usage:
    uv run pytest tests/ui/test_user_profile.py -q
"""

import json

from .helpers import actionable_console_errors, load_plan, open_app, plan_text
from .test_collab_whiteboard import host, joiner  # noqa: F401 -- fixtures

AVATAR = "#ribbonAvatar"
DIALOG = "#userProfileDialog"
KEY = "np-user-profile"

PROFILE = {
    "fullName": "Mary Jane Watson",
    "shortname": "mjw",
    "role": "Designer",
    "email": "mj@example.com",
    "allocation": 50,
}


def stored(pg):
    return pg.evaluate(f"() => JSON.parse(localStorage.getItem('{KEY}'))")


def save_profile(pg, profile):
    pg.evaluate(f"p => localStorage.setItem('{KEY}', JSON.stringify(p))", profile)


def empty_circle(pg, slot=AVATAR):
    return pg.locator(f"{slot} button.user-profile-circle-empty")


def chip(pg, slot=AVATAR):
    return pg.locator(f"{slot} np-resource-stack >> .chip")


def dialog_open(pg):
    return pg.evaluate(f"() => document.querySelector('{DIALOG}').open")


def open_with_profile(pg, app_server, profile=PROFILE):
    open_app(pg, app_server)
    save_profile(pg, profile)
    open_app(pg, app_server)
    chip(pg).wait_for()


def fill_profile(pg, profile):
    pg.fill("#userProfileFullName", profile["fullName"])
    pg.fill("#userProfileShortname", profile["shortname"])
    pg.fill("#userProfileRole", profile["role"])
    pg.fill("#userProfileEmail", profile["email"])
    pg.fill("#userProfileAllocation", str(profile["allocation"]))


class TestTheCircle:
    def test_without_a_profile_it_offers_to_set_one_up(self, page, app_server):
        open_app(page, app_server)
        circle = empty_circle(page)
        circle.wait_for()
        assert circle.get_attribute("aria-label") == "Set up your profile"
        assert circle.is_enabled()
        circle.click()
        page.wait_for_function(f"() => document.querySelector('{DIALOG}').open")
        # Straight into the first field.
        assert page.evaluate("() => document.activeElement.id") == "userProfileFullName"
        # Centred, despite base.css's `* { margin: 0 }`.
        box = page.locator(DIALOG).bounding_box()
        right_gap = page.viewport_size["width"] - (box["x"] + box["width"])
        assert abs(box["x"] - right_gap) <= 2, box
        assert actionable_console_errors(page) == []

    def test_it_is_the_last_thing_on_the_title_bar_and_a_full_size_target(self, page, app_server):
        open_app(page, app_server)
        circle = empty_circle(page)
        circle.wait_for()
        box = circle.bounding_box()
        assert box["width"] >= 24 and box["height"] >= 24
        search = page.locator(".ribbon-search-wrap").bounding_box()
        assert search["x"] + search["width"] <= box["x"]

    def test_with_a_profile_it_shows_the_initials(self, page, app_server):
        open_with_profile(page, app_server)
        # First and last word, as every avatar in the app does it.
        assert chip(page).inner_text() == "MW"
        assert chip(page).get_attribute("aria-label") == "Mary Jane Watson"
        assert empty_circle(page).count() == 0

    def test_its_card_says_who_and_opens_the_profile(self, page, app_server):
        open_with_profile(page, app_server)
        chip(page).hover()
        card = page.locator(f"{AVATAR} >> .card")
        card.wait_for(state="visible")
        text = card.inner_text()
        assert "Mary Jane Watson" in text
        assert "Designer" in text
        assert "mj@example.com" in text
        # The card opens leftward, inside the window, from the bar's last item.
        box = card.bounding_box()
        assert box["x"] >= 0
        assert box["x"] + box["width"] <= page.viewport_size["width"]
        link = page.locator(f"{AVATAR} >> .card .open")
        assert link.inner_text() == "Edit your profile"
        link.click()
        page.wait_for_function(f"() => document.querySelector('{DIALOG}').open")

    def test_clicking_the_chip_opens_the_profile(self, page, app_server):
        open_with_profile(page, app_server)
        chip(page).click()
        page.wait_for_function(f"() => document.querySelector('{DIALOG}').open")
        assert page.input_value("#userProfileFullName") == "Mary Jane Watson"


class TestTheForm:
    def test_it_asks_for_what_the_resource_form_asks_for(self, page, app_server):
        open_app(page, app_server)
        empty_circle(page).click()
        for field in ("FullName", "Shortname", "Role", "Email", "Allocation"):
            assert page.locator(f"#userProfile{field}").is_visible(), field
        # The resource form's own non-working-days table, with its blank row.
        assert page.locator("#userProfileNonWorkingDaysTableBody tr.nwd-blank-row").count() == 1

    def test_done_saves_it_and_it_survives_a_reload(self, page, app_server):
        open_app(page, app_server)
        empty_circle(page).click()
        fill_profile(page, PROFILE)
        page.click("#userProfileDone")
        assert not dialog_open(page)
        assert stored(page) == {**PROFILE, "nonWorkingDays": []}
        chip(page).wait_for()
        assert chip(page).inner_text() == "MW"

        open_app(page, app_server)
        assert chip(page).inner_text() == "MW"
        chip(page).click()
        assert page.input_value("#userProfileRole") == "Designer"
        assert page.input_value("#userProfileAllocation") == "50"

    def test_typing_saves_without_pressing_done(self, page, app_server):
        open_app(page, app_server)
        empty_circle(page).click()
        page.fill("#userProfileFullName", "Alice Smith")
        page.wait_for_function(
            f"() => JSON.parse(localStorage.getItem('{KEY}') || 'null')?.fullName === 'Alice Smith'"
        )
        # The circle behind the dialog has already caught up.
        chip(page).wait_for()
        assert chip(page).inner_text() == "AS"

    def test_escape_closes_it_and_keeps_what_was_just_typed(self, page, app_server):
        open_app(page, app_server)
        empty_circle(page).click()
        page.fill("#userProfileFullName", "Jo Lee")
        page.keyboard.press("Escape")
        assert not dialog_open(page)
        assert stored(page)["fullName"] == "Jo Lee"
        # Focus goes back to the circle, redrawn as it has been since.
        page.wait_for_function(
            f"() => document.activeElement === document.querySelector('{AVATAR} np-resource-stack')"
        )

    def test_a_click_on_the_backdrop_closes_it(self, page, app_server):
        open_app(page, app_server)
        empty_circle(page).click()
        page.mouse.click(5, page.viewport_size["height"] - 5)
        assert not dialog_open(page)

    def test_non_working_days_are_kept(self, page, app_server):
        open_app(page, app_server)
        empty_circle(page).click()
        page.fill("#userProfileFullName", "Alice Smith")
        row = page.locator("#userProfileNonWorkingDaysTableBody tr").first
        row.locator("input").nth(0).fill("Christmas")
        row.locator("input").nth(1).fill("2026-12-24")
        row.locator("input").nth(2).fill("2026-12-26")
        page.click("#userProfileDone")
        assert stored(page)["nonWorkingDays"] == [
            {"name": "Christmas", "start": "2026-12-24", "finish": "2026-12-26"}
        ]

    def test_clear_profile_puts_the_empty_circle_back(self, page, app_server):
        open_with_profile(page, app_server)
        chip(page).click()
        page.click("#userProfileClear")
        assert stored(page) is None
        assert page.input_value("#userProfileFullName") == ""
        assert dialog_open(page), "clearing is not closing"
        page.click("#userProfileDone")
        empty_circle(page).wait_for()

    def test_nothing_goes_into_the_plan_or_to_the_server(self, page, app_server):
        open_app(page, app_server)
        load_plan(page, "---\ntitle: Profile test\n---\nOnly task\n")
        before = plan_text(page)
        sent = []
        page.on("request", lambda request: sent.append((request.url, request.post_data or "")))
        empty_circle(page).click()
        fill_profile(page, PROFILE)
        page.click("#userProfileDone")
        page.wait_for_timeout(600)
        assert plan_text(page) == before
        leaked = [url for url, body in sent if "Mary Jane" in body or "Mary%20Jane" in url or "mj@example.com" in body]
        assert leaked == []

    def test_another_tab_sees_the_change(self, page, app_server):
        open_app(page, app_server)
        other = page.context.new_page()
        open_app(other, app_server)
        empty_circle(other).wait_for()
        empty_circle(page).click()
        page.fill("#userProfileFullName", "Alice Smith")
        page.click("#userProfileDone")
        chip(other).wait_for()
        assert chip(other).inner_text() == "AS"
        other.close()

    def test_storage_that_throws_does_not_break_it(self, page, app_server):
        # Only the profile's own key throws. Blocking localStorage outright
        # stops the rest of the app starting at all -- on main too -- which
        # is not this feature's to fix.
        page.add_init_script(
            f"""(() => {{
                for (const method of ['getItem', 'setItem', 'removeItem']) {{
                    const original = Storage.prototype[method];
                    Storage.prototype[method] = function (key, ...rest) {{
                        if (key === '{KEY}') throw new DOMException('blocked', 'SecurityError');
                        return original.call(this, key, ...rest);
                    }};
                }}
            }})();"""
        )
        open_app(page, app_server)
        empty_circle(page).click()
        page.fill("#userProfileFullName", "Alice Smith")
        page.click("#userProfileDone")
        # Kept for as long as the page is open.
        chip(page).wait_for()
        assert chip(page).inner_text() == "AS"
        assert not [e for e in actionable_console_errors(page) if "profile" in e.lower()]


class TestInAPlanningSession:
    def test_the_hosts_messages_carry_the_profile_name(self, joiner, host):
        host_page, _ = host
        host_page.evaluate(f"p => NoodleUserProfile.set(p)", {"fullName": "Pat Lee"})
        host_page.evaluate("() => openCollabChatPanel()")
        host_page.fill("#collabChatInput", "hello from the host")
        host_page.press("#collabChatInput", "Enter")

        theirs = joiner.locator("#relayLog .np-chat-message:not(.is-own)")
        theirs.wait_for()
        assert theirs.locator(".np-chat-name").inner_text() == "Pat Lee"
        assert theirs.locator(".np-chat-avatar").inner_text() == "PL"

        mine = host_page.locator("#collabChatList .np-chat-message.is-own")
        mine.wait_for()
        assert mine.locator(".np-chat-name").inner_text() == "You"
        assert mine.locator(".np-chat-avatar").inner_text() == "PL"

    def test_without_a_profile_the_host_is_still_host(self, joiner, host):
        host_page, _ = host
        host_page.evaluate("() => openCollabChatPanel()")
        host_page.fill("#collabChatInput", "hi")
        host_page.press("#collabChatInput", "Enter")
        theirs = joiner.locator("#relayLog .np-chat-message:not(.is-own)")
        theirs.wait_for()
        assert theirs.locator(".np-chat-name").inner_text() == "Host"

    def test_a_joiner_with_the_hosts_name_is_not_the_host(self, joiner, host):
        host_page, _ = host
        # The fixture's joiner is "Alex"; so, now, is the host.
        host_page.evaluate("p => NoodleUserProfile.set(p)", {"fullName": "Alex"})
        joiner.fill("#relayInput", "from the joiner")
        for _ in range(50):
            joiner.press("#relayInput", "Enter")
            if joiner.input_value("#relayInput") == "":
                break
            joiner.wait_for_timeout(200)
        host_page.evaluate("() => openCollabChatPanel()")
        message = host_page.locator("#collabChatList .np-chat-message", has_text="from the joiner")
        message.wait_for()
        assert "is-own" not in message.get_attribute("class")

    def test_the_join_page_offers_the_profile_name(self, page, app_server):
        page.goto(f"{app_server}/join")
        save_profile(page, {"fullName": "Mary Jane Watson"})
        page.goto(f"{app_server}/join")
        assert page.input_value("#displayName") == "Mary Jane Watson"

    def test_a_joiner_sets_up_a_profile_from_the_session_bar(self, joiner):
        circle = empty_circle(joiner, "#sessionProfile")
        circle.wait_for()
        circle.click()
        joiner.wait_for_function(f"() => document.querySelector('{DIALOG}').open")
        # Starts from the name they joined as.
        assert joiner.input_value("#userProfileFullName") == "Alex"
        joiner.click("#userProfileDone")
        chip(joiner, "#sessionProfile").wait_for()
        assert chip(joiner, "#sessionProfile").inner_text() == "AL"
        assert json.loads(joiner.evaluate(f"() => localStorage.getItem('{KEY}')"))["fullName"] == "Alex"
