"""Selenium-driven browser tests for whiteboard board membership (issue #847):
the Add-note picker (open/close/Escape/keyboard-nav/search/multi-select),
placing a new note visibly and without overlap, one commit per add (single
or batch), the "Remove from board" menu item (wording, one-commit removal,
outline left byte-identical), and the empty state on a board with no notes.

Follows the same self-contained app_server/browser fixture pattern as
tests/test_whiteboard_notes.py (#846), tests/test_whiteboard_drag_resize.py
(#848), and tests/test_whiteboard_note_colour.py (#849). The pure
"not-on-board" set difference, path-building, search matching, and
free-space placement math are already covered by
tests/test_whiteboard_board_membership.js; this file is only for what that
can't reach: the real picker DOM, real focus/keyboard behaviour, the real
rendered notes, and the real round trip through plan text (including that
the task outline is left untouched).

Usage:
    uv run pytest tests/test_whiteboard_board_membership.py -x -q
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

# A board with two summary tasks already on it, and two more (one of them
# nested, one of them same-named-as-a-different-phase's own child) not yet
# on the board -- enough to exercise the picker's not-on-board filtering,
# path disambiguation, and search.
SAMPLE_PLAN = """---
title: Whiteboard Board Membership Test Plan
---

Phase 1
  Discovery
    Research @sam 2d 100%
    Interviews @sam 2d
  Build
    Testing
      Regression @sam 1d
    Ship Widget $Widget @sam 3d 100%

Phase 2
  Discovery
    Kickoff @sam 1d

---whiteboard---
| Task      | X   | Y  | Colour | Width | Height | Collapsed |
|-----------|-----|----|--------|-------|--------|-----------|
| Discovery | 120 | 80 |        | 280   | 240    | no        |
| Build     | 480 | 80 |        | 280   | 260    | no        |
"""

# No ---whiteboard--- section at all -- the empty-state plan.
EMPTY_PLAN = """---
title: Whiteboard Empty State Test Plan
---

Phase 1
  Discovery
    Research @sam 2d 100%
  Build
    Ship Widget $Widget @sam 3d 100%
"""

# Every summary task the outline has is already a whiteboard row -- the
# picker's true dead-end case (issue #980): opening it should offer the
# "create a new summary task" affordance instead of a non-actionable
# "Every summary task is already on the board" message.
ALL_ON_BOARD_PLAN = """---
title: Whiteboard All On Board Test Plan
---

Phase 1
  Research @sam 2d 100%

---whiteboard---
| Task    | X   | Y  | Colour | Width | Height | Collapsed |
|---------|-----|----|--------|-------|--------|-----------|
| Phase 1 | 120 | 80 |        | 280   | 240    | no        |
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


# ── Shared helpers (mirrors test_whiteboard_note_colour.py / _drag_resize.py) ──


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


def wait_for_front_matter_rag(driver, timeout=15.0, interval=0.25):
    # The app auto-computes and writes back a `rag:` front-matter entry
    # shortly after a plan loads -- an edit this test suite doesn't
    # trigger itself, but one that must be allowed to land *before* a test
    # captures its own "before" text, or that unrelated auto-edit can end
    # up sitting between the test's own before-snapshot and its action,
    # making a single undo of the test's own action look like it didn't
    # fully revert (mirrors test_whiteboard_drag_resize.py's identical
    # helper/rationale).
    deadline = time.time() + timeout
    while time.time() < deadline:
        if "rag:" in get_plan_text(driver):
            return True
        time.sleep(interval)
    return False


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
    wait_for_front_matter_rag(driver)
    wait_for_stable_plan_text(driver, timeout=10.0, quiet=1.5)
    # Force an explicit, immediate undo checkpoint for the fully-settled
    # loaded state (editor-undo.js's EditorUndoManager.captureImmediate()
    # -- normal snapshots are debounced 600ms behind the editor's own
    # 'input' events, per that file's own DEBOUNCE_MS). Without this, a
    # test's own `before_text` snapshot (read right after this function
    # returns) can silently not correspond to any *actual* undo-stack
    # entry, so a single Ctrl+Z later in the test pops back further than
    # expected -- this makes "the state right after load_plan()" and "the
    # nearest undo checkpoint" the same point, deterministically.
    driver.execute_script(
        "if (typeof EditorUndoManager !== 'undefined') {"
        "  EditorUndoManager.captureImmediate(document.getElementById('planEditor').value);"
        "}"
    )


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


def rendered_note_task_names(driver):
    return driver.execute_script(
        "return Array.from(document.querySelectorAll('#whiteboardContainer .wb-note'))"
        ".map(n => n.dataset.wbTask);"
    )


def get_note_rect(driver, task_name):
    return driver.execute_script(
        """
        const notes = document.querySelectorAll('#whiteboardContainer .wb-note');
        for (const n of notes) {
            if (n.dataset.wbTask === arguments[0]) return {
                x: parseFloat(n.getAttribute('x')), y: parseFloat(n.getAttribute('y')),
                width: parseFloat(n.getAttribute('width')), height: parseFloat(n.getAttribute('height')),
            };
        }
        return null;
        """,
        task_name,
    )


def outline_only(plan_text):
    """The task outline (everything before ---whiteboard---), for a
    byte-for-byte comparison that ignores only the whiteboard rows.

    Trailing newlines are normalised away: updatePlanWhiteboardText()
    (script.js) always separates the outline from a *newly created*
    ---whiteboard--- marker with exactly `\\n\\n`, regardless of how many
    trailing newlines the outline had before -- a whitespace-only
    difference at that boundary the very first time a whiteboard section
    is added, not a real outline mutation."""
    marker = "---whiteboard---"
    idx = plan_text.find(marker)
    text = plan_text if idx == -1 else plan_text[:idx]
    return text.rstrip("\n")


def open_picker(driver):
    btn = WebDriverWait(driver, 5).until(
        EC.element_to_be_clickable((By.ID, "whiteboardAddNoteBtn"))
    )
    btn.click()
    WebDriverWait(driver, 3).until(
        EC.presence_of_element_located((By.ID, "wbAddNoteOverlay"))
    )
    return driver.find_element(By.ID, "wbAddNoteDialog")


def picker_item_names(driver):
    return driver.execute_script(
        "return Array.from(document.querySelectorAll('#wbAddNoteList .wb-add-note-item'))"
        ".map(li => li.dataset.taskName);"
    )


def picker_item(driver, task_name):
    return driver.execute_script(
        """
        const items = document.querySelectorAll('#wbAddNoteList .wb-add-note-item');
        for (const li of items) {
            if (li.dataset.taskName === arguments[0]) return li;
        }
        return null;
        """,
        task_name,
    )


def select_picker_item(driver, task_name):
    item = picker_item(driver, task_name)
    assert item is not None, f"no picker entry for {task_name}"
    item.click()
    return item


# ── "Create a new summary task" affordance helpers (issue #980) ──────────


def create_form_is_open(driver):
    form = driver.find_element(By.ID, "wbAddNoteCreateForm")
    return form.is_displayed()


def open_create_form(driver):
    """Click the persistent "+ New phase" toggle to reveal the create
    form (the dead-end case shows it already open, without a toggle to
    click -- callers there should skip this)."""
    toggle = WebDriverWait(driver, 3).until(
        EC.element_to_be_clickable((By.ID, "wbAddNoteCreateToggle"))
    )
    toggle.click()
    WebDriverWait(driver, 3).until(lambda d: create_form_is_open(d))


def create_new_summary_task(driver, name):
    """Type `name` into the create form's input and submit it via the
    "Create and add" button -- the form must already be open (either the
    dead-end's forced-open state, or after open_create_form())."""
    field = WebDriverWait(driver, 3).until(
        EC.visibility_of_element_located((By.ID, "wbAddNoteCreateInput"))
    )
    field.clear()
    field.send_keys(name)
    driver.find_element(By.ID, "wbAddNoteCreateBtn").click()


def note_menu_btn_for(driver, task_name):
    return driver.execute_script(
        """
        const notes = document.querySelectorAll('#whiteboardContainer .wb-note');
        for (const n of notes) {
            if (n.dataset.wbTask === arguments[0]) return n.querySelector('.wb-note-menu-btn');
        }
        return null;
        """,
        task_name,
    )


def click_remove_from_board(driver, task_name):
    btn = note_menu_btn_for(driver, task_name)
    assert btn is not None, f"no note (or menu button) found for {task_name}"
    btn.click()
    WebDriverWait(driver, 3).until(EC.presence_of_element_located((By.ID, "wbNoteMenu")))
    remove_btn = driver.find_element(By.CSS_SELECTOR, "#wbNoteMenu .wb-note-menu-remove")
    remove_btn.click()


# ── Tests ────────────────────────────────────────────────────────────────


class TestAddNotePickerOpenClose:
    def test_toolbar_button_opens_picker_listing_only_tasks_not_on_board(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        open_picker(browser)
        names = picker_item_names(browser)
        assert "Discovery" not in names or names.count("Discovery") <= 1, names
        # "Build" and one "Discovery" (Phase 2's) are already on the board
        # (SAMPLE_PLAN's whiteboard rows are Discovery/Build) -- neither
        # the already-added "Discovery" row's match nor "Build" should be
        # offered again.
        assert "Build" not in names, "a summary task already on the board must not be offered again"
        assert "Testing" in names, "a not-yet-added nested summary task is offered"
        assert "Phase 1" in names and "Phase 2" in names, "top-level phases are offered too"

    def test_picker_shows_parent_path_for_disambiguation(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        open_picker(browser)
        testing_path = browser.execute_script(
            """
            const items = document.querySelectorAll('#wbAddNoteList .wb-add-note-item');
            for (const li of items) {
                if (li.dataset.taskName === 'Testing') {
                    const el = li.querySelector('.wb-add-note-item-path');
                    return el ? el.textContent : null;
                }
            }
            return undefined;
            """
        )
        assert testing_path == "Phase 1 › Build", testing_path

    def test_escape_closes_the_picker(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        open_picker(browser)
        browser.switch_to.active_element.send_keys(Keys.ESCAPE)
        WebDriverWait(browser, 3).until_not(
            lambda d: d.find_elements(By.ID, "wbAddNoteOverlay")
        )

    def test_cancel_button_closes_without_adding_anything(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        before = get_plan_text(browser)
        open_picker(browser)
        select_picker_item(browser, "Phase 1")
        browser.find_element(By.CSS_SELECTOR, ".wb-add-note-cancel").click()
        WebDriverWait(browser, 3).until_not(lambda d: d.find_elements(By.ID, "wbAddNoteOverlay"))
        time.sleep(0.3)
        assert get_plan_text(browser) == before, "Cancel must not write anything"

    def test_search_filters_by_name_and_by_parent_path(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        open_picker(browser)
        search = browser.find_element(By.ID, "wbAddNoteSearch")

        # "Testing" matches by name; "Regression" is its child, so it
        # matches by path (`Phase 1 › Build › Testing`). Leaves like
        # Regression are offerable now that a post-it creates its own task
        # -- every new note starts as a leaf, so a picker that hid them
        # could not re-add a note the user had just removed from the board.
        search.send_keys("testing")
        WebDriverWait(browser, 3).until(
            lambda d: picker_item_names(d) == ["Testing", "Regression"]
        )

        search.clear()
        search.send_keys("phase 1")
        names = WebDriverWait(browser, 3).until(lambda d: picker_item_names(d) or True) and picker_item_names(browser)
        assert "Testing" in names, "search also matches by parent path (Testing's path is 'Phase 1 › Build')"
        assert "Phase 2" not in names, "an entry whose name/path do not match the query is excluded"

    def test_arrow_down_from_search_focuses_first_item(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        open_picker(browser)
        search = browser.find_element(By.ID, "wbAddNoteSearch")
        search.send_keys(Keys.ARROW_DOWN)
        active_role = browser.execute_script("return document.activeElement.getAttribute('role');")
        assert active_role == "option", "ArrowDown from the search box moves focus into the list"


class TestAddNotePickerCreateNew:
    """The "create a new summary task" affordance (issue #980): the picker's
    dead-end case (every summary task already on the board) offers an
    actionable create-and-add form instead of a plain, non-actionable
    message, and the same form is available -- collapsed behind a
    persistent "+ New phase" toggle -- even when there's still something
    to pick."""

    def test_dead_end_shows_create_form_not_a_plain_message(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, ALL_ON_BOARD_PLAN)
        switch_to_whiteboard(browser)

        open_picker(browser)

        # The old dead-end <li> is gone entirely (list.hidden), so its
        # exact, non-actionable message can no longer appear as a bare,
        # un-actionable list row -- it may still appear (with a
        # "-- create a new one to add:" continuation) as the create
        # form's own explanatory intro line, which is fine: that's an
        # actionable form, not a dead end.
        assert not browser.find_elements(By.CSS_SELECTOR, "#wbAddNoteList .wb-add-note-empty"), \
            "the old non-actionable dead-end list row must be gone"

        assert create_form_is_open(browser), "the create form is forced open in the dead-end case"
        assert not browser.find_element(By.ID, "wbAddNoteList").is_displayed(), \
            "the (now pointless) empty list is hidden in the dead-end case"
        assert not browser.find_element(By.ID, "wbAddNoteSearch").is_displayed(), \
            "the (now pointless) search box is hidden in the dead-end case"
        assert not browser.find_element(By.ID, "wbAddNoteCreateToggle").is_displayed(), \
            "the toggle that would open the form is redundant/hidden once it's already open"

        focused_id = browser.execute_script("return document.activeElement.id;")
        assert focused_id == "wbAddNoteCreateInput", "opening focus lands in the create field, not a hidden search box"

    def test_creating_a_new_summary_task_adds_it_to_outline_and_board(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, ALL_ON_BOARD_PLAN)
        switch_to_whiteboard(browser)

        open_picker(browser)
        create_new_summary_task(browser, "Launch")

        WebDriverWait(browser, 3).until_not(lambda d: d.find_elements(By.ID, "wbAddNoteOverlay"))
        after_text = wait_for_stable_plan_text(browser, timeout=5.0, quiet=1.0)

        outline = outline_only(after_text)
        assert "Launch" in outline, "the new summary task exists in the plan's task outline"

        # wbLastTasks (whiteboard-notes.js) is a top-level `let`, so it's
        # not reachable as window.wbLastTasks from here; re-parse the
        # committed plan text through the same /api/parse endpoint the app
        # itself uses instead, to check what the outline now actually
        # contains.
        launch_task = browser.execute_async_script(
            """
            const planText = arguments[0];
            const done = arguments[arguments.length - 1];
            fetch('/api/parse', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({plan_text: planText, project_name: null}),
            }).then(r => r.json()).then(data => {
                done((data.tasks || []).find(t => t && t.name === 'Launch') || null);
            }).catch(() => done(null));
            """,
            after_text,
        )
        assert launch_task is not None, "the new task is present in the parsed outline"
        assert launch_task.get("is_summary"), \
            "the new task is classified as a summary task (it has a child line in the outline)"

        assert "Launch" in rendered_note_task_names(browser), "a corresponding note is rendered on the board"
        assert after_text.count("| Launch ") == 1, "exactly one whiteboard row was written for the new task"

    def test_persistent_new_phase_toggle_available_when_entries_exist(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        open_picker(browser)
        assert not create_form_is_open(browser), "the create form starts collapsed when there's still something to pick"
        assert browser.find_element(By.ID, "wbAddNoteList").is_displayed(), "the normal list is still shown"

        open_create_form(browser)
        focused_id = browser.execute_script("return document.activeElement.id;")
        assert focused_id == "wbAddNoteCreateInput", "opening the toggle focuses the create field"

    def test_creating_from_the_persistent_toggle_still_works_alongside_the_list(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        open_picker(browser)
        open_create_form(browser)
        create_new_summary_task(browser, "Rollout")

        WebDriverWait(browser, 3).until_not(lambda d: d.find_elements(By.ID, "wbAddNoteOverlay"))
        after_text = wait_for_stable_plan_text(browser, timeout=5.0, quiet=1.0)

        assert "Rollout" in outline_only(after_text), "the new summary task exists in the plan's task outline"
        assert "Rollout" in rendered_note_task_names(browser), "a corresponding note is rendered on the board"

    def test_blank_name_shows_an_inline_error_and_keeps_the_picker_open(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, ALL_ON_BOARD_PLAN)
        switch_to_whiteboard(browser)

        open_picker(browser)
        browser.find_element(By.ID, "wbAddNoteCreateBtn").click()

        error = WebDriverWait(browser, 3).until(
            EC.visibility_of_element_located((By.ID, "wbAddNoteCreateError"))
        )
        assert error.text.strip(), "a blank name shows an inline error"
        assert browser.find_elements(By.ID, "wbAddNoteOverlay"), "the picker stays open on invalid input"

    def test_duplicate_name_shows_an_inline_error_and_does_not_write_anything(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, ALL_ON_BOARD_PLAN)
        switch_to_whiteboard(browser)

        before_text = get_plan_text(browser)
        open_picker(browser)
        create_new_summary_task(browser, "Phase 1")

        error = WebDriverWait(browser, 3).until(
            EC.visibility_of_element_located((By.ID, "wbAddNoteCreateError"))
        )
        assert error.text.strip(), "a name that already exists in the outline shows an inline error"
        assert browser.find_elements(By.ID, "wbAddNoteOverlay"), "the picker stays open on invalid input"
        assert get_plan_text(browser) == before_text, "nothing is written to the plan for a rejected duplicate name"


class TestAddingNotes:
    def test_adding_one_note_places_it_visibly_without_overlap_and_commits_once(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        before_text = get_plan_text(browser)
        open_picker(browser)
        select_picker_item(browser, "Testing")
        browser.find_element(By.ID, "wbAddNoteSubmit").click()

        WebDriverWait(browser, 3).until_not(lambda d: d.find_elements(By.ID, "wbAddNoteOverlay"))
        after_text = wait_for_stable_plan_text(browser, timeout=5.0, quiet=1.0)

        assert "Testing" in rendered_note_task_names(browser), "the new note actually renders"
        rect = get_note_rect(browser, "Testing")
        assert rect is not None
        assert rect["x"] >= 0 and rect["y"] >= 0, "placed within the visible board area, not at a negative/off-canvas position"

        discovery_rect = get_note_rect(browser, "Discovery")
        build_rect = get_note_rect(browser, "Build")

        def overlaps(a, b):
            return not (
                a["x"] + a["width"] <= b["x"] or b["x"] + b["width"] <= a["x"] or
                a["y"] + a["height"] <= b["y"] or b["y"] + b["height"] <= a["y"]
            )

        assert not overlaps(rect, discovery_rect), "new note does not overlap the existing Discovery note"
        assert not overlaps(rect, build_rect), "new note does not overlap the existing Build note"

        # Exactly one row added (one commit) -- outline text is unaffected.
        assert outline_only(after_text) == outline_only(before_text), "adding a note must never touch the task outline"
        assert after_text.count("| Testing ") == 1, "exactly one new whiteboard row was written"

    def test_adding_is_a_single_undo_step(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        before_text = get_plan_text(browser)
        open_picker(browser)
        select_picker_item(browser, "Testing")
        browser.find_element(By.ID, "wbAddNoteSubmit").click()
        WebDriverWait(browser, 3).until_not(lambda d: d.find_elements(By.ID, "wbAddNoteOverlay"))
        wait_for_stable_plan_text(browser, timeout=5.0, quiet=1.0)

        editor = browser.find_element(By.ID, "planEditor")
        editor.click()
        undo_key = Keys.COMMAND if browser.execute_script("return navigator.platform.includes('Mac')") else Keys.CONTROL
        editor.send_keys(undo_key, "z")
        time.sleep(0.5)
        reverted = get_plan_text(browser)
        assert reverted == before_text, "a single undo (Ctrl/Cmd+Z) fully reverts a one-note add"

    def test_multi_select_add_produces_one_commit_and_one_undo_step(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        before_text = get_plan_text(browser)
        open_picker(browser)
        select_picker_item(browser, "Testing")
        select_picker_item(browser, "Phase 1")
        select_picker_item(browser, "Phase 2")
        submit = browser.find_element(By.ID, "wbAddNoteSubmit")
        assert "3" in submit.text, f"submit button reflects the selection count (got: {submit.text!r})"
        submit.click()

        WebDriverWait(browser, 3).until_not(lambda d: d.find_elements(By.ID, "wbAddNoteOverlay"))
        after_text = wait_for_stable_plan_text(browser, timeout=5.0, quiet=1.0)

        names = rendered_note_task_names(browser)
        assert set(["Testing", "Phase 1", "Phase 2"]).issubset(set(names)), names

        # All three land in distinct, non-overlapping cells.
        rects = {n: get_note_rect(browser, n) for n in ("Testing", "Phase 1", "Phase 2")}

        def overlaps(a, b):
            return not (
                a["x"] + a["width"] <= b["x"] or b["x"] + b["width"] <= a["x"] or
                a["y"] + a["height"] <= b["y"] or b["y"] + b["height"] <= a["y"]
            )

        keys = list(rects.keys())
        for i in range(len(keys)):
            for j in range(i + 1, len(keys)):
                assert not overlaps(rects[keys[i]], rects[keys[j]]), f"{keys[i]} and {keys[j]} overlap"

        assert outline_only(after_text) == outline_only(before_text), "batch add must never touch the task outline"

        # One undo step reverts the whole batch.
        editor = browser.find_element(By.ID, "planEditor")
        editor.click()
        undo_key = Keys.COMMAND if browser.execute_script("return navigator.platform.includes('Mac')") else Keys.CONTROL
        editor.send_keys(undo_key, "z")
        time.sleep(0.5)
        assert get_plan_text(browser) == before_text, "a single undo fully reverts a 3-note batch add"


class TestRemoveFromBoard:
    def test_menu_item_wording_makes_clear_the_task_is_not_deleted(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        btn = note_menu_btn_for(browser, "Build")
        btn.click()
        WebDriverWait(browser, 3).until(EC.presence_of_element_located((By.ID, "wbNoteMenu")))
        remove_btn = browser.find_element(By.CSS_SELECTOR, "#wbNoteMenu .wb-note-menu-remove")

        assert remove_btn.text.strip() == "Remove from board"
        assert "delete" not in remove_btn.text.strip().lower()
        title_and_aria = (remove_btn.get_attribute("title") or "") + " " + (remove_btn.get_attribute("aria-label") or "")
        assert "task and its subtasks stay" in title_and_aria, \
            "the control's own text must spell out that the task is not deleted"

    def test_remove_deletes_only_the_whiteboard_row_outline_is_byte_identical(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        before_text = get_plan_text(browser)
        assert "Build" in rendered_note_task_names(browser)

        click_remove_from_board(browser, "Build")
        after_text = wait_for_stable_plan_text(browser, timeout=5.0, quiet=1.0)

        assert "Build" not in rendered_note_task_names(browser), "the note is gone from the board"
        assert outline_only(after_text) == outline_only(before_text), \
            "the task outline (and every other section) must be byte-for-byte unchanged"
        assert "Build" in after_text, "the task itself still exists in the outline"
        assert "Ship Widget" in after_text, "Build's own children still exist in the outline"
        # The whiteboard table itself lost exactly the Build row.
        assert "| Build " not in after_text
        assert "| Discovery " in after_text, "an unrelated whiteboard row is untouched"

    def test_remove_is_a_single_undo_step(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        before_text = get_plan_text(browser)
        click_remove_from_board(browser, "Build")
        wait_for_stable_plan_text(browser, timeout=5.0, quiet=1.0)

        editor = browser.find_element(By.ID, "planEditor")
        editor.click()
        undo_key = Keys.COMMAND if browser.execute_script("return navigator.platform.includes('Mac')") else Keys.CONTROL
        editor.send_keys(undo_key, "z")
        time.sleep(0.5)
        assert get_plan_text(browser) == before_text, "a single undo fully restores the removed note's row"

    def test_no_confirmation_dialog_is_required(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        # Removal must complete from the one click alone -- no browser
        # confirm()/prompt() blocking it (which would hang this test).
        click_remove_from_board(browser, "Discovery")
        WebDriverWait(browser, 3).until(
            lambda d: "Discovery" not in rendered_note_task_names(d)
        )

    def test_removing_then_readding_the_same_task_works(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        click_remove_from_board(browser, "Build")
        wait_for_stable_plan_text(browser, timeout=5.0, quiet=1.0)
        assert "Build" not in rendered_note_task_names(browser)

        open_picker(browser)
        assert "Build" in picker_item_names(browser), "a removed task is offered again by the picker"
        select_picker_item(browser, "Build")
        browser.find_element(By.ID, "wbAddNoteSubmit").click()
        WebDriverWait(browser, 3).until_not(lambda d: d.find_elements(By.ID, "wbAddNoteOverlay"))
        wait_for_stable_plan_text(browser, timeout=5.0, quiet=1.0)

        assert "Build" in rendered_note_task_names(browser), "the re-added note renders again"
        rect = get_note_rect(browser, "Build")
        discovery_rect = get_note_rect(browser, "Discovery")

        def overlaps(a, b):
            return not (
                a["x"] + a["width"] <= b["x"] or b["x"] + b["width"] <= a["x"] or
                a["y"] + a["height"] <= b["y"] or b["y"] + b["height"] <= a["y"]
            )

        assert not overlaps(rect, discovery_rect), "the freshly re-added note does not overlap what's currently on the board"


class TestEmptyState:
    def test_a_plan_with_no_whiteboard_rows_shows_the_empty_state(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, EMPTY_PLAN)
        switch_to_whiteboard(browser)

        assert rendered_note_task_names(browser) == []
        el = WebDriverWait(browser, 3).until(
            EC.visibility_of_element_located((By.CSS_SELECTOR, ".wb-empty-state"))
        )
        assert el.is_displayed()
        assert browser.find_elements(By.ID, "wbEmptyStateAddBtn")
        assert browser.find_elements(By.ID, "wbEmptyStateAddAllBtn")

    def test_empty_state_hides_once_a_note_exists(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, EMPTY_PLAN)
        switch_to_whiteboard(browser)

        browser.find_element(By.ID, "wbEmptyStateAddAllBtn").click()
        WebDriverWait(browser, 5).until(lambda d: len(rendered_note_task_names(d)) > 0)

        el = browser.find_element(By.CSS_SELECTOR, ".wb-empty-state")
        assert "wb-empty-state-hidden" in el.get_attribute("class")

    def test_add_all_summary_tasks_adds_every_summary_task_in_one_commit(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, EMPTY_PLAN)
        switch_to_whiteboard(browser)

        before_text = get_plan_text(browser)
        browser.find_element(By.ID, "wbEmptyStateAddAllBtn").click()
        after_text = wait_for_stable_plan_text(browser, timeout=5.0, quiet=1.0)

        names = set(rendered_note_task_names(browser))
        assert names == {"Phase 1", "Discovery", "Build"}, names
        assert outline_only(after_text) == outline_only(before_text), "must never touch the task outline"

        editor = browser.find_element(By.ID, "planEditor")
        editor.click()
        undo_key = Keys.COMMAND if browser.execute_script("return navigator.platform.includes('Mac')") else Keys.CONTROL
        editor.send_keys(undo_key, "z")
        time.sleep(0.5)
        assert get_plan_text(browser) == before_text, "Add all summary tasks is a single undo step"

    def test_empty_state_add_note_button_opens_the_picker(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, EMPTY_PLAN)
        switch_to_whiteboard(browser)

        browser.find_element(By.ID, "wbEmptyStateAddBtn").click()
        WebDriverWait(browser, 3).until(
            EC.presence_of_element_located((By.ID, "wbAddNoteOverlay"))
        )
