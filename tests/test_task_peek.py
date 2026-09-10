"""Selenium-driven browser tests for the whiteboard task-peek popover
(issue #850): opening a peek from a note's child-count badge/row instead
of jumping straight to the full task inspector, the peek's exact
name/assignee/checkbox/badge content, recursive drill-down with a
breadcrumb, ticking a peek checkbox writing the identical markdown edit a
note-level tick would, "Open task details" from both the peek and the note
`...` menu, pan/zoom/scroll restoration across that round trip, Escape/
focus handling, and viewport-edge repositioning.

Follows the same self-contained app_server/browser fixture pattern as
tests/test_whiteboard_notes.py (#846) and tests/test_whiteboard_note_colour.py
(#849). The pure breadcrumb-stack/view-model logic itself is already
covered by tests/test_task_peek.js and tests/test_whiteboard_notes.js's own
wbBuildPeekLevel() section; this file is only for what those can't reach:
the real popover DOM, real focus/keyboard behaviour, the real markdown
commit, and the real task-details round trip.

Usage:
    uv run pytest tests/test_task_peek.py -x -q
"""

import socket
import threading
import time

import pytest

try:
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options as ChromeOptions
    from selenium.webdriver.chrome.service import Service as ChromeService
    from selenium.webdriver.common.by import By
    from selenium.webdriver.common.keys import Keys
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.common.exceptions import WebDriverException

    HAS_SELENIUM = True
except ImportError:
    HAS_SELENIUM = False

try:
    import uvicorn
    from noodle_web.app import app as fastapi_app

    HAS_APP = True
except ImportError:
    HAS_APP = False

pytestmark = [
    pytest.mark.skipif(not HAS_SELENIUM, reason="selenium not installed"),
    pytest.mark.skipif(not HAS_APP, reason="noodle_web not importable"),
]

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

# Issue #1016: a chain that nests four levels below the note's own root
# task (Nested), to prove the peek's drill-down has no artificial depth
# cap -- it must keep going exactly as far as the outline actually nests,
# not stop at grandchildren.
#
# Build
#   Nested                        <- note's own checklist root
#     Gen1                        <- summary, direct child of Nested
#       Gen2 @sam 1d               <- summary, grandchild of Nested
#         Gen3 @sam 1d             <- summary, great-grandchild of Nested
#           Gen4 @sam 1d 100%      <- leaf, great-great-grandchild
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


def find_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def app_server():
    port = find_free_port()
    config = uvicorn.Config(fastapi_app, host="127.0.0.1", port=port, log_level="warning")
    server = uvicorn.Server(config)

    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    base_url = f"http://127.0.0.1:{port}"
    for _ in range(50):
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                break
        except OSError:
            time.sleep(0.1)
    else:
        pytest.fail("App server did not start in time")

    yield base_url

    server.should_exit = True
    thread.join(timeout=5)


def _create_chrome_driver():
    options = ChromeOptions()
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    options.add_argument("--window-size=1280,900")

    import os

    if os.path.exists("/usr/bin/chromium"):
        options.binary_location = "/usr/bin/chromium"

    try:
        if os.path.exists("/usr/bin/chromedriver"):
            service = ChromeService("/usr/bin/chromedriver")
            return webdriver.Chrome(service=service, options=options)
        return webdriver.Chrome(options=options)
    except WebDriverException:
        pytest.skip("Chrome/chromedriver not available on this system")


@pytest.fixture(scope="module")
def browser():
    driver = _create_chrome_driver()
    driver.implicitly_wait(3)
    yield driver
    driver.quit()


# ── Shared helpers (mirrors test_whiteboard_notes.py / test_whiteboard_note_colour.py) ──


def dismiss_tour(driver):
    driver.execute_script(
        "document.cookie = 'tourCompleted=true; path=/; max-age=31536000';"
        "['tourOverlay','tourPopup','tourSpotlight'].forEach(function(id){"
        "  var el = document.getElementById(id); if (el) el.style.display = 'none';"
        "});"
    )


def open_app(driver, base_url):
    driver.get(base_url)
    dismiss_tour(driver)
    time.sleep(0.3)


def load_plan(driver, plan_text):
    editor = WebDriverWait(driver, 5).until(
        EC.presence_of_element_located((By.ID, "planEditor"))
    )
    driver.execute_script(
        "arguments[0].value = arguments[1];"
        "arguments[0].dispatchEvent(new Event('input', {bubbles: true}));",
        editor,
        plan_text,
    )
    wait_for_stable_plan_text(driver, timeout=10.0, quiet=1.5)


def switch_to_whiteboard(driver):
    driver.execute_script("switchToView('whiteboard');")
    WebDriverWait(driver, 5).until(
        EC.visibility_of_element_located((By.ID, "whiteboardContainer"))
    )
    time.sleep(0.4)


def get_plan_text(driver):
    return driver.execute_script("return document.getElementById('planEditor').value;")


def wait_for_stable_plan_text(driver, timeout=10.0, quiet=1.5, interval=0.25):
    deadline = time.time() + timeout
    last = get_plan_text(driver)
    stable_since = time.time()
    while time.time() < deadline:
        time.sleep(interval)
        current = get_plan_text(driver)
        if current != last:
            last = current
            stable_since = time.time()
        elif time.time() - stable_since >= quiet:
            return last
    return last


def line_for_task(plan_text, task_name):
    for line in plan_text.split("\n"):
        if line.strip().startswith(task_name):
            return line
    return None


def badge_for_child(driver, note_task, child_name):
    """The `.wb-note-count-badge` button for `child_name`'s row inside the
    note for `note_task`, or None."""
    return driver.execute_script(
        """
        const notes = document.querySelectorAll('#whiteboardContainer .wb-note');
        for (const n of notes) {
            if (n.dataset.wbTask !== arguments[0]) continue;
            const rows = Array.from(n.querySelectorAll('.wb-note-row'));
            const target = rows.find(r => r.querySelector('.wb-note-row-name').textContent === arguments[1]);
            return target ? target.querySelector('.wb-note-count-badge') : null;
        }
        return null;
        """,
        note_task,
        child_name,
    )


def open_peek(driver, note_task, child_name):
    badge = badge_for_child(driver, note_task, child_name)
    assert badge is not None, f"no child-count badge found for {child_name} in {note_task}'s note"
    # A real user can only ever click something on-screen, but some of this
    # file's own tests deliberately pan/zoom the note to an extreme or
    # resize the window to exercise edge cases -- a plain WebElement.click()
    # then fails on Selenium's own coordinate-based interactability check
    # (ElementNotInteractableException/ElementClickInterceptedException)
    # even though the badge is a perfectly normal, connected DOM element the
    # app itself would happily handle a click on. Dispatch the click via the
    # DOM's own click() method instead -- functionally identical from the
    # app's point of view (it's the same 'click' event, same listener), it
    # just skips Selenium's viewport-visibility precondition.
    driver.execute_script("arguments[0].click();", badge)
    WebDriverWait(driver, 3).until(
        EC.presence_of_element_located((By.ID, "taskPeekPopover"))
    )
    return driver.find_element(By.ID, "taskPeekPopover")


def peek_row_for(driver, task_name):
    return driver.execute_script(
        """
        const popover = document.getElementById('taskPeekPopover');
        if (!popover) return null;
        const rows = Array.from(popover.querySelectorAll('.task-peek-row'));
        return rows.find(r => {
            const nameEl = r.querySelector('.task-peek-row-name');
            return nameEl && nameEl.textContent === arguments[0];
        }) || null;
        """,
        task_name,
    )


def peek_title(driver):
    el = driver.find_elements(By.CSS_SELECTOR, "#taskPeekPopover .task-peek-title")
    return el[0].text if el else None


def whiteboard_viewport(driver):
    return driver.execute_script("return {zoom: wbZoom, panX: wbPanX, panY: wbPanY};")


# ── Tests ────────────────────────────────────────────────────────────────


class TestPeekOpensInsteadOfInspector:
    def test_badge_click_opens_peek_not_task_inspector(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        open_peek(browser, "Build", "Nested")

        assert browser.find_elements(By.ID, "taskPeekPopover"), "the peek popover must be open"
        inspector_open = driver_inspector_open = browser.execute_script(
            "const s = document.getElementById('taskInspectorSection');"
            "return !!(s && s.classList.contains('active'));"
        )
        assert inspector_open is False, "clicking the badge must no longer jump straight to the Task Inspector"

    def test_row_click_also_opens_peek(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        row = browser.execute_script(
            """
            const notes = document.querySelectorAll('#whiteboardContainer .wb-note');
            for (const n of notes) {
                if (n.dataset.wbTask !== 'Build') continue;
                const rows = Array.from(n.querySelectorAll('.wb-note-row'));
                return rows.find(r => r.querySelector('.wb-note-row-name').textContent === 'Nested');
            }
            return null;
            """
        )
        assert row is not None
        row.click()
        WebDriverWait(browser, 3).until(EC.presence_of_element_located((By.ID, "taskPeekPopover")))

    def test_clicking_same_badge_again_closes_the_peek(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        badge = badge_for_child(browser, "Build", "Nested")
        badge.click()
        WebDriverWait(browser, 3).until(EC.presence_of_element_located((By.ID, "taskPeekPopover")))
        badge.click()
        WebDriverWait(browser, 3).until_not(lambda d: d.find_elements(By.ID, "taskPeekPopover"))


class TestPeekContent:
    def test_peek_shows_exactly_name_assignee_checkbox_badge(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        popover = open_peek(browser, "Build", "Nested")
        row_names = [el.text for el in popover.find_elements(By.CSS_SELECTOR, ".task-peek-row-name")]
        assert set(row_names) == {"Sub A", "Sub B"}, "the peek must list exactly Nested's own direct children"

        sub_b_row = peek_row_for(browser, "Sub B")
        assert sub_b_row is not None
        has_checkbox = browser.execute_script("return !!arguments[0].querySelector('.task-peek-checkbox');", sub_b_row)
        has_name = browser.execute_script("return !!arguments[0].querySelector('.task-peek-row-name');", sub_b_row)
        has_avatar = browser.execute_script("return !!arguments[0].querySelector('.wb-note-avatar');", sub_b_row)
        has_badge = browser.execute_script("return !!arguments[0].querySelector('.wb-note-count-badge');", sub_b_row)
        assert has_checkbox and has_name and has_avatar, "each row must show completion, name and assignee"
        assert has_badge, "Sub B has its own children, so its row must carry a drill-down badge"

        avatar_text = browser.execute_script(
            "return arguments[0].querySelector('.wb-note-avatar').textContent;", sub_b_row
        )
        assert avatar_text == "JO", "the assignee chip shows Jo's initials"

        sub_a_row = peek_row_for(browser, "Sub A")
        has_badge_a = browser.execute_script("return !!arguments[0].querySelector('.wb-note-count-badge');", sub_a_row)
        assert has_badge_a is False, "a leaf child (Sub A) must not show a drill-down badge"

    def test_peek_is_anchored_near_its_note(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        note_rect = browser.execute_script(
            """
            const notes = document.querySelectorAll('#whiteboardContainer .wb-note');
            for (const n of notes) {
                if (n.dataset.wbTask === 'Build') return n.getBoundingClientRect();
            }
            return null;
            """
        )
        popover = open_peek(browser, "Build", "Nested")
        pop_rect = popover.rect
        # "Anchored to the note" -- not pinned to an arbitrary screen corner.
        assert abs(pop_rect["y"] - note_rect["y"]) < 400


class TestPeekBreadcrumb:
    def test_drilling_into_a_grandchild_shows_breadcrumb(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        open_peek(browser, "Build", "Nested")
        assert browser.find_elements(By.CSS_SELECTOR, "#taskPeekPopover .task-peek-breadcrumb") == [], \
            "a single-level peek shows no breadcrumb (nothing to navigate)"

        sub_b_badge = browser.execute_script(
            "const r = arguments[0]; return r.querySelector('.wb-note-count-badge');",
            peek_row_for(browser, "Sub B"),
        )
        sub_b_badge.click()
        time.sleep(0.2)

        assert peek_title(browser) == "Sub B", "drilling in makes the child the peek's new current level"
        row_names = [el.text for el in browser.find_elements(By.CSS_SELECTOR, "#taskPeekPopover .task-peek-row-name")]
        assert set(row_names) == {"Detail One", "Detail Two"}

        crumbs = [el.text for el in browser.find_elements(By.CSS_SELECTOR, "#taskPeekPopover .task-peek-crumb")]
        assert crumbs == ["Nested", "Sub B"], "the breadcrumb shows the full path from the peek's root to here"

    def test_breadcrumb_navigates_back_up(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        open_peek(browser, "Build", "Nested")
        peek_row_for(browser, "Sub B")
        sub_b_badge = browser.execute_script(
            "return arguments[0].querySelector('.wb-note-count-badge');",
            peek_row_for(browser, "Sub B"),
        )
        sub_b_badge.click()
        time.sleep(0.2)
        assert peek_title(browser) == "Sub B"

        root_crumb = browser.execute_script(
            "return document.querySelector('#taskPeekPopover .task-peek-crumb');"
        )
        root_crumb.click()
        time.sleep(0.2)

        assert peek_title(browser) == "Nested", "clicking the root crumb navigates back to it"
        row_names = [el.text for el in browser.find_elements(By.CSS_SELECTOR, "#taskPeekPopover .task-peek-row-name")]
        assert set(row_names) == {"Sub A", "Sub B"}


class TestPeekDeepNesting:
    """Issue #1016 ("nested subtasks within a post-it checklist, deeper
    than one level"). #850's peek (TestPeekBreadcrumb above) was already
    built generically: wbBuildPeekLevel() only ever asks "does *this*
    task have children", tpDrillInto()/tpPushLevel() only ever push one
    more level onto a plain stack, and neither has any notion of "level
    0" vs "level 1" -- there was never a hardcoded stop after one hop.
    #1016 is this file's regression lock for that: it proves the exact
    same mechanism keeps drilling as many times as the outline actually
    nests, with no code change required to reach a fourth or fifth level.
    """

    def test_drilling_several_levels_deep_has_no_artificial_limit(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, DEEP_NESTING_PLAN)
        switch_to_whiteboard(browser)

        # Root: Nested's own direct children (opened from the note).
        open_peek(browser, "Build", "Nested")
        assert peek_title(browser) == "Nested"
        row_names = [el.text for el in browser.find_elements(By.CSS_SELECTOR, "#taskPeekPopover .task-peek-row-name")]
        assert row_names == ["Gen1"]

        # Drill: Gen1 -> Gen2 -> Gen3, each one level deeper than #850's
        # own single-hop coverage.
        for child_name in ["Gen1", "Gen2", "Gen3"]:
            badge = browser.execute_script(
                "return arguments[0].querySelector('.wb-note-count-badge');",
                peek_row_for(browser, child_name),
            )
            assert badge is not None, f"{child_name} has its own children, so it must carry a drill-down badge"
            badge.click()
            time.sleep(0.2)
            assert peek_title(browser) == child_name, f"drilling into {child_name} makes it the peek's current level"

        # Now four levels deep (Nested > Gen1 > Gen2 > Gen3); Gen3's own
        # child, Gen4, is a leaf and must show no further badge.
        crumbs = [el.text for el in browser.find_elements(By.CSS_SELECTOR, "#taskPeekPopover .task-peek-crumb")]
        assert crumbs == ["Nested", "Gen1", "Gen2", "Gen3"], \
            "the breadcrumb records the full path, all four levels deep"

        gen4_row = peek_row_for(browser, "Gen4")
        assert gen4_row is not None
        has_badge = browser.execute_script("return !!arguments[0].querySelector('.wb-note-count-badge');", gen4_row)
        assert has_badge is False, "Gen4 is a leaf, so its row must not carry a drill-down badge"

        # Breadcrumb navigation works from any depth, not just "one level
        # in" -- jump straight from the deepest crumb back to Gen1.
        gen1_crumb = browser.execute_script(
            """
            const crumbs = Array.from(document.querySelectorAll('#taskPeekPopover .task-peek-crumb'));
            return crumbs.find(c => c.textContent === 'Gen1');
            """
        )
        gen1_crumb.click()
        time.sleep(0.2)
        assert peek_title(browser) == "Gen1", "clicking an earlier crumb jumps straight back to it, not just one level"
        row_names_after = [el.text for el in browser.find_elements(By.CSS_SELECTOR, "#taskPeekPopover .task-peek-row-name")]
        assert row_names_after == ["Gen2"]


class TestPeekPlanTextRerender:
    """Issue #1016's re-render requirement: the peek's navigation stack
    must survive the ordinary plan-text auto-render (editor.js's 1s input
    debounce -> renderText() -> wbRenderNotes()), not just user-driven
    drill/back navigation. wbRenderNotes() updates each note's DOM node
    *in place* (wbNoteNodes keeps the same node across renders -- see
    wbUpdateNoteNode()) and never touches or closes the peek popover
    (document.body's #taskPeekPopover, outside any note card), so this is
    mostly a regression lock on that decoupling rather than new plumbing:
    a stray future change coupling note re-render to the peek (e.g. an
    over-eager "refresh everything" call) would show up here as a closed
    popover, a reset-to-root stack, or a duplicated #taskPeekPopover.
    """

    def test_multi_level_stack_survives_a_plan_text_rerender(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        open_peek(browser, "Build", "Nested")
        sub_b_badge = browser.execute_script(
            "return arguments[0].querySelector('.wb-note-count-badge');",
            peek_row_for(browser, "Sub B"),
        )
        sub_b_badge.click()
        time.sleep(0.2)
        assert peek_title(browser) == "Sub B"
        crumbs_before = [el.text for el in browser.find_elements(By.CSS_SELECTOR, "#taskPeekPopover .task-peek-crumb")]
        assert crumbs_before == ["Nested", "Sub B"]

        # Edit the plan text elsewhere (an unrelated task, untouched by the
        # peeked branch) and let the ordinary 1s auto-render debounce fire,
        # exactly like a collaborator's own typing would while this peek
        # sits open two levels deep.
        edited = SAMPLE_PLAN.replace("Interviews @sam 2d", "Interviews @sam 2d  # rerender probe")
        assert edited != SAMPLE_PLAN
        editor = browser.find_element(By.ID, "planEditor")
        browser.execute_script(
            "arguments[0].value = arguments[1];"
            "arguments[0].dispatchEvent(new Event('input', {bubbles: true}));",
            editor,
            edited,
        )
        wait_for_stable_plan_text(browser, timeout=10.0, quiet=1.5)
        time.sleep(0.3)

        popovers = browser.find_elements(By.ID, "taskPeekPopover")
        assert len(popovers) == 1, "the re-render must not duplicate or destroy the peek popover"
        assert peek_title(browser) == "Sub B", "the drilled-in level must still be current after the re-render"
        crumbs_after = [el.text for el in browser.find_elements(By.CSS_SELECTOR, "#taskPeekPopover .task-peek-crumb")]
        assert crumbs_after == ["Nested", "Sub B"], "the full navigation stack must survive the re-render"
        row_names = [el.text for el in browser.find_elements(By.CSS_SELECTOR, "#taskPeekPopover .task-peek-row-name")]
        assert set(row_names) == {"Detail One", "Detail Two"}, \
            "the current level's own rows must still be exactly Sub B's children after the re-render"


class TestPeekChecklistTicking:
    def test_ticking_a_peek_checkbox_writes_the_same_edit_as_a_note_tick(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        before = get_plan_text(browser)
        before_line = line_for_task(before, "Sub A")
        assert before_line is not None and "100%" not in before_line.split()

        open_peek(browser, "Build", "Nested")
        checkbox = browser.execute_script(
            "return arguments[0].querySelector('.task-peek-checkbox');",
            peek_row_for(browser, "Sub A"),
        )
        checkbox.click()
        time.sleep(0.5)

        after = get_plan_text(browser)
        after_line = line_for_task(after, "Sub A")
        assert after_line is not None and "100%" in after_line.split(), after

    def test_ticking_from_the_peek_is_a_single_undo_step(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        before = wait_for_stable_plan_text(browser)
        before_line = line_for_task(before, "Sub A")
        assert before_line is not None and "100%" not in before_line.split()

        open_peek(browser, "Build", "Nested")
        checkbox = browser.execute_script(
            "return arguments[0].querySelector('.task-peek-checkbox');",
            peek_row_for(browser, "Sub A"),
        )
        checkbox.click()

        ticked = wait_for_stable_plan_text(browser)
        ticked_line = line_for_task(ticked, "Sub A")
        assert ticked_line is not None and "100%" in ticked_line.split()

        browser.execute_script("EditorUndoManager.undo();")
        time.sleep(0.3)
        after_one_undo = get_plan_text(browser)
        after_line = line_for_task(after_one_undo, "Sub A")
        assert after_line is not None and "100%" not in after_line.split(), \
            "a single undo must fully reverse the peek tick's percent change"


class TestOpenTaskDetails:
    def test_open_task_details_from_the_peek_selects_the_right_task(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        open_peek(browser, "Build", "Nested")
        open_btn = browser.find_element(By.CSS_SELECTOR, "#taskPeekPopover .task-peek-open-details-btn")
        open_btn.click()
        time.sleep(0.4)

        assert browser.find_elements(By.ID, "taskPeekPopover") == [], "opening details must close the peek"
        active_section = browser.execute_script(
            "return document.getElementById('taskFormSection').classList.contains('active');"
        )
        assert active_section is True, "the task-details form must be open"
        selected_name = browser.execute_script("return document.getElementById('taskName').value;")
        assert selected_name == "Nested", "the peek's own current-level task (Nested) must be the one selected"

        browser.execute_script("closeTaskForm();")
        time.sleep(0.2)

    def test_open_task_details_from_the_note_menu_selects_the_right_task(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        menu_btn = browser.execute_script(
            """
            const notes = document.querySelectorAll('#whiteboardContainer .wb-note');
            for (const n of notes) {
                if (n.dataset.wbTask === 'Discovery') return n.querySelector('.wb-note-menu-btn');
            }
            return null;
            """
        )
        menu_btn.click()
        WebDriverWait(browser, 3).until(EC.presence_of_element_located((By.ID, "wbNoteMenu")))
        open_task_btn = browser.find_element(By.CSS_SELECTOR, "#wbNoteMenu .wb-note-menu-open-task")
        open_task_btn.click()
        time.sleep(0.4)

        assert browser.find_elements(By.ID, "wbNoteMenu") == [], "picking the menu item must close the menu"
        selected_name = browser.execute_script("return document.getElementById('taskName').value;")
        assert selected_name == "Discovery"

        browser.execute_script("closeTaskForm();")
        time.sleep(0.2)


class TestPanZoomRestoration:
    def test_returning_from_task_details_restores_pan_and_zoom(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        # Establish a distinctive, non-default viewport before opening details.
        browser.execute_script(
            "wbZoom = 1.6; wbPanX = 123; wbPanY = 456; wbApplyTransform(false);"
        )
        before = whiteboard_viewport(browser)
        assert before["zoom"] == 1.6 and before["panX"] == 123 and before["panY"] == 456

        open_peek(browser, "Build", "Nested")
        browser.find_element(By.CSS_SELECTOR, "#taskPeekPopover .task-peek-open-details-btn").click()
        time.sleep(0.4)
        browser.execute_script("closeTaskForm();")
        time.sleep(0.4)

        after = whiteboard_viewport(browser)
        assert after == before, \
            f"pan/zoom must be exactly as left before opening task details (before={before}, after={after})"

        # The whiteboard container itself must still be the visible view.
        visible = browser.execute_script(
            "const el = document.getElementById('whiteboardContainer');"
            "return el.offsetParent !== null;"
        )
        assert visible is True

    def test_returning_from_task_details_restores_note_scroll(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        scroll_set = browser.execute_script(
            """
            const notes = document.querySelectorAll('#whiteboardContainer .wb-note');
            for (const n of notes) {
                if (n.dataset.wbTask !== 'Build') continue;
                const body = n.querySelector('.wb-note-body');
                body.scrollTop = 5;
                return body.scrollTop;
            }
            return null;
            """
        )
        assert scroll_set is not None

        open_peek(browser, "Build", "Nested")
        browser.find_element(By.CSS_SELECTOR, "#taskPeekPopover .task-peek-open-details-btn").click()
        time.sleep(0.4)
        browser.execute_script("closeTaskForm();")
        time.sleep(0.4)

        scroll_after = browser.execute_script(
            """
            const notes = document.querySelectorAll('#whiteboardContainer .wb-note');
            for (const n of notes) {
                if (n.dataset.wbTask === 'Build') return n.querySelector('.wb-note-body').scrollTop;
            }
            return null;
            """
        )
        assert scroll_after == scroll_set


class TestPeekEscapeAndFocus:
    def test_escape_closes_peek_and_refocuses_the_badge(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        badge = badge_for_child(browser, "Build", "Nested")
        badge.click()
        WebDriverWait(browser, 3).until(EC.presence_of_element_located((By.ID, "taskPeekPopover")))

        browser.switch_to.active_element.send_keys(Keys.ESCAPE)
        WebDriverWait(browser, 3).until_not(lambda d: d.find_elements(By.ID, "taskPeekPopover"))

        active = browser.execute_script("return document.activeElement.className;")
        assert "wb-note-count-badge" in active, "focus must return to the badge that opened the peek"

    def test_second_escape_does_nothing_to_the_board(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        badge = badge_for_child(browser, "Build", "Nested")
        badge.click()
        WebDriverWait(browser, 3).until(EC.presence_of_element_located((By.ID, "taskPeekPopover")))
        browser.switch_to.active_element.send_keys(Keys.ESCAPE)
        WebDriverWait(browser, 3).until_not(lambda d: d.find_elements(By.ID, "taskPeekPopover"))

        before = whiteboard_viewport(browser)
        browser.switch_to.active_element.send_keys(Keys.ESCAPE)
        time.sleep(0.2)
        after = whiteboard_viewport(browser)
        assert after == before, "a second Escape (peek already closed) must not affect the board"
        assert browser.find_elements(By.ID, "taskPeekPopover") == []

    def test_outside_click_closes_the_peek(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        open_peek(browser, "Build", "Nested")
        browser.execute_script(
            "document.body.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));"
        )
        WebDriverWait(browser, 3).until_not(lambda d: d.find_elements(By.ID, "taskPeekPopover"))


class TestPeekViewportEdge:
    def test_peek_repositions_rather_than_overflowing_near_an_edge(self, browser, app_server):
        # set_window_size is a browser-chrome-level setting that outlives a
        # driver.get() reload, and this fixture's browser is shared (module
        # scope) across every test in this file -- restore it in a finally
        # so a failure here can never leave a stale small window behind for
        # a later test to silently inherit.
        try:
            open_app(browser, app_server)
            browser.set_window_size(700, 600)
            load_plan(browser, SAMPLE_PLAN)
            switch_to_whiteboard(browser)

            # Pan the board so Build's note sits close to the right edge of
            # a small viewport -- close enough that the popover's default
            # right-hand placement would overflow, but not so far that the
            # badge itself moves off-screen (a real user could never click
            # something off-screen either, so that would test nothing).
            browser.execute_script(
                "wbZoom = 1; wbPanX = -110; wbPanY = 0; wbApplyTransform(false);"
            )
            time.sleep(0.2)

            popover = open_peek(browser, "Build", "Nested")
            rect = popover.rect
            window_width = browser.execute_script("return window.innerWidth;")
            window_height = browser.execute_script("return window.innerHeight;")
            assert rect["x"] >= 0, "the peek must not be clipped off the left edge"
            assert rect["x"] + rect["width"] <= window_width + 1, "the peek must not overflow the right edge"
            assert rect["y"] >= 0
            assert rect["y"] + rect["height"] <= window_height + 1, "the peek must not overflow the bottom edge"
        finally:
            browser.set_window_size(1280, 900)


class TestPeekTheming:
    def test_peek_text_is_legible_in_light_and_dark_mode(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        for theme in ("light", "dark"):
            browser.execute_script(
                "document.documentElement.setAttribute('data-theme', arguments[0]);", theme
            )
            popover = open_peek(browser, "Build", "Nested")
            style = browser.execute_script(
                """
                const title = document.querySelector('#taskPeekPopover .task-peek-title');
                const s = getComputedStyle(title);
                const bodyBg = getComputedStyle(document.getElementById('taskPeekPopover')).backgroundColor;
                return {color: s.color, background: bodyBg};
                """
            )
            ratio = browser.execute_script(
                """
                function toHex(rgb) {
                    const nums = rgb.match(/\\d+/g).map(Number);
                    return '#' + nums.slice(0, 3).map(n => n.toString(16).padStart(2, '0')).join('');
                }
                return wbContrastRatio(toHex(arguments[0]), toHex(arguments[1]));
                """,
                style["background"],
                style["color"],
            )
            assert ratio >= 4.5, f"[{theme}] peek title/background contrast only {ratio:.2f}:1"
            browser.execute_script("TaskPeek.close();")
