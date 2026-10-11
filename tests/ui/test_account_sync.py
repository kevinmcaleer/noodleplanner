"""Sign in and sync: the cloud button, the "Account and sync" dialog, and plans
moving between this browser and the account on the server.

Usage:
    uv run pytest tests/ui/test_account_sync.py -q
"""

import itertools
import json

from .helpers import actionable_console_errors, open_app

BUTTON = "#ribbonSync .sync-button"
DIALOG = "#syncDialog"
_emails = itertools.count(1)


def new_account(page, app_server):
    """Register through the page's own session so its cookie is signed in."""
    email = f"sync{next(_emails)}@example.com"
    password = "a long enough password"
    res = page.request.post(
        f"{app_server}/account/register",
        form={"email": email, "password": password, "confirm": password},
        max_redirects=0,
    )
    assert res.status == 303, res.status
    return email


def api(page, method, path, body=None):
    return page.evaluate(
        """async ([method, path, body]) => {
            const init = {method, headers: {}};
            if (body) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
            const r = await fetch(path, init);
            return [r.status, r.status === 204 ? null : await r.json()];
        }""",
        [method, path, body],
    )


def open_dialog(page):
    page.locator(BUTTON).click()
    page.wait_for_function(f"() => document.querySelector('{DIALOG}').open")


class TestSignedOut:
    def test_the_button_offers_sign_in(self, page, app_server):
        open_app(page, app_server)
        page.wait_for_selector(f"{BUTTON}[data-state='signed-out']")
        assert page.locator(BUTTON).get_attribute("aria-label") == "Sign in to sync your plans"
        open_dialog(page)
        page.locator("#syncSignedOut").wait_for(state="visible")
        assert page.locator("#syncSignedOut a[href='/account/login']").is_visible()
        assert page.locator("#syncOff").is_hidden() and page.locator("#syncOn").is_hidden()
        assert actionable_console_errors(page) == []

    def test_it_sits_before_the_profile_circle(self, page, app_server):
        open_app(page, app_server)
        page.wait_for_selector(BUTTON)
        sync = page.locator(BUTTON).bounding_box()
        avatar = page.locator("#ribbonAvatar").bounding_box()
        assert sync["x"] + sync["width"] <= avatar["x"]
        assert sync["width"] >= 24 and sync["height"] >= 24


class TestSignedIn:
    def test_sync_stays_off_until_asked(self, page, app_server):
        email = new_account(page, app_server)
        open_app(page, app_server)
        page.wait_for_selector(f"{BUTTON}[data-state='off']")
        page.evaluate("() => createProject('Not yet', 'Task 1 3d')")
        open_dialog(page)
        page.locator("#syncOff").wait_for(state="visible")
        assert email in page.locator("#syncOffEmail").inner_text()
        assert api(page, "GET", "/api/v1/plans")[1]["plans"] == []

    def test_turning_it_on_uploads_and_then_pulls_server_changes(self, page, app_server):
        new_account(page, app_server)
        open_app(page, app_server)
        pid = page.evaluate("() => createProject('Launch plan', 'Task 1 3d').id")
        open_dialog(page)
        page.locator("#syncEnable").click()
        page.locator("#syncOn").wait_for(state="visible")
        page.wait_for_selector(f"{BUTTON}[data-state='ok']")

        plans = api(page, "GET", "/api/v1/plans")[1]["plans"]
        match = [p for p in plans if p["name"] == "Launch plan"]
        assert len(match) == 1
        server_id = match[0]["id"]
        assert api(page, "GET", f"/api/v1/plans/{server_id}")[1]["content"] == "Task 1 3d"

        # Another device edits it; "Sync now" brings the change in.
        status, current = api(page, "GET", f"/api/v1/plans/{server_id}")
        status, _ = api(page, "PUT", f"/api/v1/plans/{server_id}",
                        {"base_revision": current["revision"], "content": "Task 1 3d\nTask 2 2d"})
        assert status == 200
        page.locator("#syncNow").click()
        page.wait_for_function(
            "pid => (loadProject(pid) || {}).planText === 'Task 1 3d\\nTask 2 2d'", arg=pid
        )

    def test_a_plan_created_on_another_device_is_downloaded(self, page, app_server):
        new_account(page, app_server)
        open_app(page, app_server)
        status, _ = api(page, "POST", "/api/v1/plans", {"name": "From elsewhere", "content": "Task A 1d"})
        assert status == 201
        open_app(page, app_server)
        open_dialog(page)
        page.locator("#syncEnable").click()
        page.wait_for_function(
            "() => Object.values(getAllProjects()).some(p => p.name === 'From elsewhere' && p.planText === 'Task A 1d')"
        )

    def test_turning_it_off_leaves_plans_alone(self, page, app_server):
        new_account(page, app_server)
        open_app(page, app_server)
        page.evaluate("() => createProject('Stays', 'Task 1 3d')")
        open_dialog(page)
        page.locator("#syncEnable").click()
        page.wait_for_selector(f"{BUTTON}[data-state='ok']")
        page.locator("#syncDisable").click()
        page.locator("#syncOff").wait_for(state="visible")
        assert len(api(page, "GET", "/api/v1/plans")[1]["plans"]) >= 1
        assert page.evaluate("() => Object.values(getAllProjects()).some(p => p.name === 'Stays')")
        state = json.loads(page.evaluate("() => localStorage.getItem('np-sync-state')"))
        assert state["enabled"] is False
