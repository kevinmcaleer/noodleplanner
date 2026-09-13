"""Selenium-driven browser tests for the whiteboard parking lot (issue
#1019, part of the #885 epic): a "good idea, not now" holding pen for
whiteboard items that aren't ready to become a task or note yet.

Covers what the pure JS unit tests (tests/test_whiteboard_backmatter.mjs)
can't reach: the real note "..." menu's "Send to parking lot" action, the
real parking lot panel DOM, and the real round trip through a page reload
(the browser's project store, not just plan text in memory).

Follows the same self-contained app_server/browser fixture pattern as
tests/test_whiteboard_board_membership.py (#847) and
tests/test_whiteboard_notes.py (#846).

Usage:
    uv run pytest tests/test_whiteboard_parking_lot.py -x -q
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
    pytest.mark.usability,
    pytest.mark.skipif(not HAS_SELENIUM, reason="selenium not installed"),
    pytest.mark.skipif(not HAS_APP, reason="noodle_web not importable"),
]

SAMPLE_PLAN = """---
title: Whiteboard Parking Lot Test Plan
---

Phase 1
  Discovery
    Research @sam 2d 100%
  Build
    Ship Widget $Widget @sam 3d 100%
  Loose Idea "A stray thought worth keeping."

---whiteboard---
| Task        | X   | Y   | Colour | Width | Height | Collapsed |
|-------------|-----|-----|--------|-------|--------|-----------|
| Discovery   | 120 | 80  |        | 280   | 240    | no        |
| Build       | 480 | 80  |        | 280   | 260    | no        |
| Loose Idea  | 120 | 400 |        | 240   | 180    | no        |
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


# ── Shared helpers (mirrors test_whiteboard_board_membership.py) ──────────


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
    deadline = time.time() + timeout
    while time.time() < deadline:
        if "rag:" in get_plan_text(driver):
            return True
        time.sleep(interval)
    return False


def load_plan(driver, plan_text, with_project=False):
    """Load `plan_text` into #planEditor. `with_project=True` also creates
    and selects a real project first, so a later commit through
    wbCommitMarkdown() actually persists (getCurrentProjectId() must be
    non-null for updateCachedProject()/saveProject() to do anything) --
    only the round-trip-through-reload tests need this; every other test
    here works against the in-memory editor alone, matching the existing
    convention in test_whiteboard_board_membership.py/test_whiteboard_notes.py.
    """
    editor = WebDriverWait(driver, 5).until(
        EC.presence_of_element_located((By.ID, "planEditor"))
    )
    if with_project:
        driver.execute_script(
            "const p = createProject('Parking Lot Round Trip Test');"
            "setCurrentProjectId(p.id);"
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
    # loaded state (see test_whiteboard_board_membership.py's load_plan()
    # for the full rationale) so a test's own `before_text` snapshot
    # always corresponds to an actual undo-stack entry.
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


def click_send_to_parking_lot(driver, task_name):
    btn = note_menu_btn_for(driver, task_name)
    assert btn is not None, f"no note (or menu button) found for {task_name}"
    btn.click()
    WebDriverWait(driver, 3).until(EC.presence_of_element_located((By.ID, "wbNoteMenu")))
    park_btn = None
    for candidate in driver.find_elements(By.CSS_SELECTOR, "#wbNoteMenu .wb-note-menu-action"):
        if candidate.text.strip() == "Send to parking lot":
            park_btn = candidate
            break
    assert park_btn is not None, "no 'Send to parking lot' menu item found"
    park_btn.click()


def open_parking_lot_panel(driver):
    btn = WebDriverWait(driver, 5).until(
        EC.element_to_be_clickable((By.ID, "whiteboardParkingLotBtn"))
    )
    btn.click()
    WebDriverWait(driver, 3).until(EC.presence_of_element_located((By.ID, "wbParkingLotDialog")))


def parking_lot_item_texts(driver):
    return driver.execute_script(
        "return Array.from(document.querySelectorAll('#wbParkingLotList .wb-parking-lot-item-text'))"
        ".map(el => el.textContent);"
    )


class TestSendToParkingLot:
    def test_sends_a_free_form_note_and_removes_it_from_the_board_and_outline(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        assert "Loose Idea" in rendered_note_task_names(browser)

        click_send_to_parking_lot(browser, "Loose Idea")
        after_text = wait_for_stable_plan_text(browser, timeout=5.0, quiet=1.0)

        assert "Loose Idea" not in rendered_note_task_names(browser), "the note is gone from the board"
        assert "  Loose Idea " not in after_text and not after_text.rstrip().endswith("Loose Idea"), \
            "the task itself is gone from the outline, not just the board"
        assert "| Loose Idea " not in after_text.split("---whiteboard---")[-1].split("---parking lot---")[0], \
            "the whiteboard row is gone too"
        assert "---parking lot---" in after_text
        parking_section = after_text.split("---parking lot---")[1]
        assert "Loose Idea" in parking_section
        # The note's own comment (the `"..."` token) was folded into the
        # parked text, not dropped.
        assert "A stray thought worth keeping" in parking_section
        # Unrelated notes/tasks are untouched.
        assert "Discovery" in rendered_note_task_names(browser)
        assert "Ship Widget" in after_text

    def test_send_to_parking_lot_is_a_single_undo_step(self, browser, app_server):
        from selenium.webdriver.common.keys import Keys

        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        before_text = get_plan_text(browser)
        click_send_to_parking_lot(browser, "Loose Idea")
        wait_for_stable_plan_text(browser, timeout=5.0, quiet=1.0)

        editor = browser.find_element(By.ID, "planEditor")
        # Folding headers intentionally sit above their projected marker lines
        # and are clickable across the row. Focus the editor directly instead
        # of clicking an arbitrary centre point that may be occupied by one.
        browser.execute_script("arguments[0].focus()", editor)
        undo_key = Keys.COMMAND if browser.execute_script("return navigator.platform.includes('Mac')") else Keys.CONTROL
        editor.send_keys(undo_key, "z")
        time.sleep(0.5)
        assert get_plan_text(browser) == before_text, "a single undo fully restores the parked note"

    def test_no_confirmation_dialog_is_required(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        browser.execute_script("window.__confirmCalled = false; window.confirm = function() { window.__confirmCalled = true; return true; };")
        click_send_to_parking_lot(browser, "Loose Idea")
        wait_for_stable_plan_text(browser, timeout=5.0, quiet=1.0)
        assert browser.execute_script("return window.__confirmCalled;") is False


class TestParkingLotPanel:
    def test_panel_lists_parked_items(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        click_send_to_parking_lot(browser, "Loose Idea")
        wait_for_stable_plan_text(browser, timeout=5.0, quiet=1.0)

        open_parking_lot_panel(browser)
        texts = parking_lot_item_texts(browser)
        assert any("Loose Idea" in t for t in texts), texts

    def test_panel_shows_empty_message_when_nothing_is_parked(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        open_parking_lot_panel(browser)
        empty = browser.find_elements(By.CSS_SELECTOR, "#wbParkingLotList .wb-parking-lot-empty")
        assert len(empty) == 1

    def test_remove_button_permanently_deletes_a_parked_item(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        click_send_to_parking_lot(browser, "Loose Idea")
        wait_for_stable_plan_text(browser, timeout=5.0, quiet=1.0)

        open_parking_lot_panel(browser)
        remove_btn = browser.find_element(By.CSS_SELECTOR, "#wbParkingLotList .wb-parking-lot-item-remove")
        remove_btn.click()
        time.sleep(0.5)

        after_text = wait_for_stable_plan_text(browser, timeout=5.0, quiet=1.0)
        assert "---parking lot---" not in after_text
        assert parking_lot_item_texts(browser) == []

    def test_escape_closes_the_panel(self, browser, app_server):
        from selenium.webdriver.common.keys import Keys

        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        open_parking_lot_panel(browser)
        browser.find_element(By.TAG_NAME, "body").send_keys(Keys.ESCAPE)
        time.sleep(0.3)
        assert browser.find_elements(By.ID, "wbParkingLotDialog") == []


class TestParkingLotRoundTrip:
    def test_parked_item_survives_a_page_reload(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN, with_project=True)
        switch_to_whiteboard(browser)

        click_send_to_parking_lot(browser, "Loose Idea")
        wait_for_stable_plan_text(browser, timeout=5.0, quiet=1.0)
        time.sleep(0.6)  # let the debounced project-store save settle

        browser.refresh()
        dismiss_tour(browser)
        time.sleep(0.5)
        WebDriverWait(browser, 5).until(
            EC.presence_of_element_located((By.ID, "planEditor"))
        )
        wait_for_stable_plan_text(browser, timeout=10.0, quiet=1.0)

        reloaded_text = get_plan_text(browser)
        assert "---parking lot---" in reloaded_text
        assert "Loose Idea" in reloaded_text.split("---parking lot---")[1]

        switch_to_whiteboard(browser)
        open_parking_lot_panel(browser)
        texts = parking_lot_item_texts(browser)
        assert any("Loose Idea" in t for t in texts), texts
