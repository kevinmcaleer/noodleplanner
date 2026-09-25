"""The host hiding parts of the plan from a planning session, and the Plan
structure panel's group zoom and rename-in-place, on both boards.

`page` is the joiner; `host` is the full app in a second page of the same
browser, hosting the session with its whiteboard open -- the same set-up as
tests/ui/test_collab_whiteboard.py.

Usage:
    uv run pytest tests/ui/test_collab_hide.py -q
"""

import re

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
Secret
  Payroll [depends: Alpha one]
Launch [depends: Secret]

---whiteboard---
| Task  | X   | Y   | Colour  | Width | Height | Collapsed | Kind  |
|-------|-----|-----|---------|-------|--------|-----------|-------|
| Alpha | 60  | 60  |         | 240   | 180    | no        |       |
| Beta one | 1400 | 900 |      | 240   | 180    | no        |       |
| Beta  |     |     |         |       |        |           | group |
| Secret | 660 | 60 |         | 240   | 180    | no        |       |
"""


@pytest.fixture
def host(page, app_server):
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
    host_page.evaluate("() => minimiseCollabSessionModal()")
    yield host_page, code
    host_page.close()


@pytest.fixture
def joiner(page, app_server, host):
    host_page, code = host
    page.set_default_timeout(15_000)
    page.goto(f"{app_server}/join")
    page.fill("#joinCode", code)
    page.fill("#displayName", "Alex")
    page.click("#joinBtn")
    page.wait_for_selector("#relayInput", state="visible")
    page.wait_for_function(
        "() => document.getElementById('planEditor').value.includes('Alpha')"
    )
    page.bring_to_front()
    page.wait_for_timeout(300)
    return page


def plan_of(pg):
    return pg.evaluate("() => document.getElementById('planEditor').value")


def outline_row(pg, task):
    return pg.locator(f'.wb-outline-row[data-task="{task}"]')


def wait_for_joiner_plan(joiner, predicate):
    joiner.wait_for_function(
        f"() => {{ const text = document.getElementById('planEditor').value; return {predicate}; }}"
    )


class TestHiding:
    def test_only_the_host_gets_eyes(self, joiner, host):
        host_page, _ = host
        assert outline_row(host_page, "Secret").locator(".wb-outline-eye").count() == 1
        assert host_page.locator(".wb-outline-share-all").is_visible()
        assert joiner.locator(".wb-outline-eye").count() == 0
        assert joiner.locator(".wb-outline-share-all").is_visible() is False

    def test_every_header_button_fits_inside_the_panel(self, joiner, host):
        # The eye made the header four buttons; the last of them (hide the
        # panel) used to be pushed past the panel's right-hand edge.
        host_page, _ = host
        host_page.bring_to_front()
        overflow = host_page.evaluate(
            """() => {
                const panel = document.querySelector('.wb-outline-panel').getBoundingClientRect();
                return [...document.querySelectorAll('.wb-outline-actions button')]
                    .filter(b => !b.hidden)
                    .map(b => b.getBoundingClientRect())
                    .filter(r => r.right > panel.right - 1 || r.left < panel.left)
                    .length;
            }"""
        )
        assert host_page.locator(".wb-outline-share-all").is_visible()
        assert overflow == 0

    def test_hiding_a_task_removes_it_and_its_references_from_the_joiner(self, joiner, host):
        host_page, _ = host
        host_page.bring_to_front()
        outline_row(host_page, "Secret").locator(".wb-outline-eye").click()
        wait_for_joiner_plan(joiner, "!text.includes('Secret')")
        shared = plan_of(joiner)
        assert "Payroll" not in shared
        assert "Launch" in shared
        # The host's own plan is untouched.
        assert re.search(r"Secret\n  Payroll \[depends:? Alpha one\]", plan_of(host_page))
        assert "collab-hidden" in outline_row(host_page, "Secret").get_attribute("class")
        assert actionable_console_errors(joiner) == []

    def test_hide_all_then_unhide_one(self, joiner, host):
        host_page, _ = host
        host_page.bring_to_front()
        host_page.locator(".wb-outline-share-all").click()
        wait_for_joiner_plan(joiner, "!text.includes('Alpha') && !text.includes('Beta')")
        outline_row(host_page, "Beta").locator(".wb-outline-eye").click()
        wait_for_joiner_plan(joiner, "text.includes('Beta one')")
        assert "Alpha" not in plan_of(joiner)
        # And the header eye shares everything again.
        host_page.locator(".wb-outline-share-all").click()
        host_page.locator(".wb-outline-share-all").click()
        wait_for_joiner_plan(joiner, "text.includes('Secret') && text.includes('Alpha two')")

    def test_a_joiner_edit_keeps_the_hidden_task(self, joiner, host):
        host_page, _ = host
        host_page.bring_to_front()
        outline_row(host_page, "Secret").locator(".wb-outline-eye").click()
        wait_for_joiner_plan(joiner, "!text.includes('Secret')")
        joiner.bring_to_front()
        outline_row(joiner, "Alpha two").locator(".wb-outline-label").dblclick()
        field = joiner.locator(".wb-outline-rename-input")
        field.fill("Alpha second")
        field.press("Enter")
        host_page.wait_for_function(
            "() => document.getElementById('planEditor').value.includes('Alpha second')"
        )
        assert re.search(r"Secret\n  Payroll \[depends:? Alpha one\]", plan_of(host_page))

    def test_ending_the_session_forgets_the_settings(self, joiner, host):
        host_page, _ = host
        host_page.bring_to_front()
        outline_row(host_page, "Secret").locator(".wb-outline-eye").click()
        host_page.evaluate("() => endCollabSession()")
        host_page.wait_for_function("() => !isCollabSessionLive()")
        host_page.wait_for_function("() => document.querySelectorAll('.wb-outline-eye').length === 0")


class TestRenameInPlace:
    @pytest.mark.parametrize("side", ["host", "joiner"])
    def test_double_click_renames_and_updates_dependencies(self, side, joiner, host):
        host_page, _ = host
        pg = host_page if side == "host" else joiner
        pg.bring_to_front()
        outline_row(pg, "Alpha one").locator(".wb-outline-label").dblclick()
        field = pg.locator(".wb-outline-rename-input")
        field.fill("Kickoff")
        field.press("Enter")
        host_page.wait_for_function(
            "() => /\\[depends:? Kickoff\\]/.test(document.getElementById('planEditor').value)"
        )
        assert "Alpha one" not in plan_of(host_page)
        outline_row(pg, "Kickoff").wait_for()

    def test_renaming_a_group(self, joiner, host):
        host_page, _ = host
        joiner.bring_to_front()
        outline_row(joiner, "Beta").locator(".wb-outline-label").dblclick()
        field = joiner.locator(".wb-outline-rename-input")
        field.fill("Build")
        field.press("Enter")
        host_page.wait_for_function(
            "() => /\\| Build *\\|.*\\| group *\\|/.test(document.getElementById('planEditor').value)"
        )

    def test_escape_keeps_the_old_name(self, joiner, host):
        host_page, _ = host
        host_page.bring_to_front()
        outline_row(host_page, "Alpha").locator(".wb-outline-label").dblclick()
        field = host_page.locator(".wb-outline-rename-input")
        field.fill("Nope")
        field.press("Escape")
        outline_row(host_page, "Alpha").wait_for()
        assert "Nope" not in plan_of(host_page)


class TestGroupZoom:
    @pytest.mark.parametrize("side", ["host", "joiner"])
    def test_clicking_a_group_frames_it(self, side, joiner, host):
        host_page, _ = host
        pg = host_page if side == "host" else joiner
        pg.bring_to_front()
        pg.wait_for_function("() => wbGroupNodes.has('Beta')")
        pg.evaluate("() => { wbZoom = 0.3; wbPanX = 0; wbPanY = 0; wbApplyTransform(false); }")
        outline_row(pg, "Beta").locator(".wb-outline-label").click()
        pg.wait_for_timeout(600)
        centred = pg.evaluate(
            """() => {
                const box = wbGroupNodes.get('Beta').rect.getBoundingClientRect();
                const canvas = wbVisibleCanvasRect();
                const host = document.getElementById('whiteboardContainer').getBoundingClientRect();
                const cx = box.left + box.width / 2 - host.left;
                return { zoom: wbZoom, dx: Math.abs(cx - (canvas.x + canvas.width / 2)) };
            }"""
        )
        assert centred["zoom"] > 0.3
        assert centred["dx"] < 40

