"""Selenium-driven browser tests for the whiteboard note colour menu
(issue #849): the `...` button's open/close/keyboard behaviour, picking
and clearing a swatch, the row-Colour -> Theme: -> derived-palette
precedence actually taking effect in the rendered DOM, colour following a
task through a Kanban-style rename, and WCAG AA contrast on real rendered
elements in both themes.

Follows the same self-contained app_server/browser fixture pattern as
tests/test_whiteboard_notes.py (#846) and tests/test_whiteboard_canvas.py
(#845). The pure precedence/contrast math itself is already covered by
tests/test_whiteboard_notes.js and the Theme:/Colour write-path round trip
by tests/test_note_colour_writer.mjs; this file is only for what those
can't reach: the real menu DOM, real focus/keyboard behaviour, and the
real rendered colours.

Usage:
    uv run pytest tests/test_whiteboard_note_colour.py -x -q
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

SAMPLE_PLAN = """---
title: Whiteboard Note Colour Test Plan
Theme:
- Discovery: #4A90D9
---

Phase 1
  Discovery
    Research @sam 2d 100%
    Interviews @sam 2d
  Build
    Ship Widget $Widget @sam 3d 100%

---whiteboard---
| Task      | X   | Y  | Colour | Width | Height | Collapsed |
|-----------|-----|----|--------|-------|--------|-----------|
| Discovery | 120 | 80 |        | 280   | 240    | no        |
| Build     | 480 | 80 |        | 280   | 260    | no        |
"""

RENAME_PLAN = """---
title: Whiteboard Note Colour Rename Test Plan
Theme:
- Phase Alpha: #223344
---

Phase Alpha
  Task 1 3d

---whiteboard---
| Task        | X   | Y  | Colour | Width | Height | Collapsed |
|-------------|-----|----|--------|-------|--------|-----------|
| Phase Alpha | 120 | 80 |        | 280   | 240    | no        |
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


# ── Shared helpers (mirrors test_whiteboard_notes.py) ──────────────────


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


def menu_btn_for(driver, task_name):
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


def open_menu(driver, task_name):
    btn = menu_btn_for(driver, task_name)
    assert btn is not None, f"no note (or no menu button) found for {task_name}"
    btn.click()
    WebDriverWait(driver, 3).until(
        EC.presence_of_element_located((By.ID, "wbNoteMenu"))
    )
    return driver.find_element(By.ID, "wbNoteMenu")


def pick_swatch(driver, task_name, colour_hex):
    open_menu(driver, task_name)
    swatch = driver.execute_script(
        """
        const menu = document.getElementById('wbNoteMenu');
        const target = arguments[0].toUpperCase();
        return Array.from(menu.querySelectorAll('.wb-note-menu-swatch'))
            .find(b => b.title.toUpperCase() === target) || null;
        """,
        colour_hex,
    )
    assert swatch is not None, f"no swatch button found for {colour_hex}"
    swatch.click()


def pick_default(driver, task_name):
    open_menu(driver, task_name)
    driver.find_element(By.CSS_SELECTOR, "#wbNoteMenu .wb-note-menu-default").click()


def note_header_style(driver, task_name):
    """{background, color} computed style of one note's header, plus the
    --wb-note-accent custom property on its card."""
    return driver.execute_script(
        """
        const notes = document.querySelectorAll('#whiteboardContainer .wb-note');
        for (const n of notes) {
            if (n.dataset.wbTask !== arguments[0]) continue;
            const card = n.querySelector('.wb-note-card');
            const header = n.querySelector('.wb-note-header');
            const style = getComputedStyle(header);
            return {
                background: style.backgroundColor,
                color: style.color,
                accent: card.style.getPropertyValue('--wb-note-accent'),
            };
        }
        return null;
        """,
        task_name,
    )


def rgb_to_hex(rgb_string):
    """'rgb(74, 144, 217)' -> '#4A90D9'."""
    nums = [int(n) for n in rgb_string.strip("rgba()").split(",")[:3]]
    return "#" + "".join(f"{n:02X}" for n in nums)


def contrast_ratio(driver, hex_a, hex_b):
    """Delegate to the app's own real wbContrastRatio() (not a re-derived
    Python copy), so this test can never silently disagree with the code
    it is meant to be checking."""
    return driver.execute_script(
        "return wbContrastRatio(arguments[0], arguments[1]);", hex_a, hex_b
    )


# ── Tests ────────────────────────────────────────────────────────────────


class TestNoteMenuOpenClose:
    def test_menu_button_exists_and_starts_closed(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        btn = menu_btn_for(browser, "Discovery")
        assert btn is not None
        assert btn.get_attribute("aria-haspopup") == "true"
        assert btn.get_attribute("aria-expanded") == "false"
        assert browser.find_elements(By.ID, "wbNoteMenu") == []

    def test_click_opens_menu_with_colour_swatches(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        btn = menu_btn_for(browser, "Discovery")
        menu = open_menu(browser, "Discovery")
        assert btn.get_attribute("aria-expanded") == "true"
        swatches = menu.find_elements(By.CSS_SELECTOR, ".wb-note-menu-swatch")
        assert len(swatches) > 0, "the menu must offer at least one colour swatch"
        assert menu.find_elements(By.CSS_SELECTOR, ".wb-note-menu-default"), \
            "a default/no-colour option must be present"

    def test_click_again_toggles_menu_closed(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        btn = menu_btn_for(browser, "Discovery")
        open_menu(browser, "Discovery")
        btn.click()
        WebDriverWait(browser, 3).until_not(
            lambda d: d.find_elements(By.ID, "wbNoteMenu")
        )
        assert btn.get_attribute("aria-expanded") == "false"

    def test_escape_closes_menu_and_refocuses_button(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        btn = menu_btn_for(browser, "Discovery")
        open_menu(browser, "Discovery")
        browser.switch_to.active_element.send_keys(Keys.ESCAPE)
        WebDriverWait(browser, 3).until_not(
            lambda d: d.find_elements(By.ID, "wbNoteMenu")
        )
        active = browser.execute_script("return document.activeElement.className;")
        assert "wb-note-menu-btn" in active, "focus must return to the `...` button on Escape"

    def test_outside_click_closes_menu(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        open_menu(browser, "Discovery")
        # A real Selenium click resolves by screen geometry and can land on
        # the menu itself if it happens to overlap the target element at
        # that point; dispatch the mousedown directly on <body> instead, so
        # this test exercises wbNoteMenuOutsideClick()'s own e.target check
        # rather than depending on where the menu happens to be positioned.
        browser.execute_script(
            "document.body.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));"
        )
        WebDriverWait(browser, 3).until_not(
            lambda d: d.find_elements(By.ID, "wbNoteMenu")
        )

    def test_arrow_keys_move_focus_between_swatches(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        open_menu(browser, "Discovery")
        first_item = browser.execute_script(
            "return document.activeElement.getAttribute('role');"
        )
        assert first_item == "menuitem", "opening the menu focuses its first item"

        browser.switch_to.active_element.send_keys(Keys.ARROW_DOWN)
        second_active = browser.execute_script(
            """
            const menu = document.getElementById('wbNoteMenu');
            const items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
            return items.indexOf(document.activeElement);
            """
        )
        assert second_active == 1, "ArrowDown must move focus to the next menu item"


class TestNoteColourPrecedenceAndPersistence:
    def test_picking_a_swatch_recolours_the_note_immediately(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        before = note_header_style(browser, "Build")
        pick_swatch(browser, "Build", "#D95B5B")
        after = note_header_style(browser, "Build")

        assert after["accent"].upper() == "#D95B5B", \
            "the accent bar takes the raw swatch colour right away, before the debounced commit lands"
        assert after["background"] != before["background"]

    def test_picking_a_swatch_persists_to_theme_front_matter(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        pick_swatch(browser, "Build", "#D95B5B")
        after = wait_for_stable_plan_text(browser, timeout=5.0, quiet=1.0)

        assert "- Build: #D95B5B" in after, after
        assert "- Discovery: #4A90D9" in after, "an unrelated Theme: entry must survive untouched"

    def test_clearing_returns_to_derived_palette_and_leaves_no_residue(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        pick_swatch(browser, "Build", "#D95B5B")
        wait_for_stable_plan_text(browser, timeout=5.0, quiet=1.0)

        pick_default(browser, "Build")
        after = wait_for_stable_plan_text(browser, timeout=5.0, quiet=1.0)

        assert "Build: #D95B5B" not in after
        assert "- Build:" not in after, "clearing must remove the Theme: entry, not blank it"

        style = note_header_style(browser, "Build")
        assert style["accent"], "a colour (the derived palette fallback) is always applied -- never blank"

    def test_kanban_style_theme_colour_shows_on_the_whiteboard(self, browser, app_server):
        # SAMPLE_PLAN already declares `Theme:\n- Discovery: #4A90D9`,
        # simulating a colour set from the Kanban board (tier 2 of the
        # precedence) before the whiteboard was ever opened.
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)

        style = note_header_style(browser, "Discovery")
        assert style["accent"].upper() == "#4A90D9", \
            "a Theme:-sourced colour (as Kanban would write) must show on the whiteboard note"

    def test_whiteboard_row_colour_overrides_theme_entry(self, browser, app_server):
        plan = SAMPLE_PLAN.replace(
            "| Discovery | 120 | 80 |        | 280   | 240    | no        |",
            "| Discovery | 120 | 80 | #1C9E41 | 280   | 240    | no        |",
        )
        open_app(browser, app_server)
        load_plan(browser, plan)
        switch_to_whiteboard(browser)

        style = note_header_style(browser, "Discovery")
        assert style["accent"].upper() == "#1C9E41", \
            "a hand-set whiteboard-row Colour (tier 1) must still win over the Theme: entry (tier 2)"


class TestNoteColourRename:
    def test_renaming_a_summary_task_carries_its_colour(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, RENAME_PLAN)
        switch_to_whiteboard(browser)

        before_style = note_header_style(browser, "Phase Alpha")
        assert before_style["accent"].upper() == "#223344"

        browser.execute_script(
            """
            window.prompt = function() { return 'Phase Beta'; };
            kanbanBoard.parse();
            kanbanBoard.renamePhase('Phase Alpha');
            """
        )
        wait_for_stable_plan_text(browser, timeout=5.0, quiet=1.0)
        time.sleep(0.3)

        after_text = get_plan_text(browser)
        assert "- Phase Beta: #223344" in after_text
        assert "Phase Alpha" not in after_text

        renamed_style = note_header_style(browser, "Phase Beta")
        assert renamed_style is not None, "the note must re-render under the new task name"
        assert renamed_style["accent"].upper() == "#223344", \
            "the colour must follow the task through the rename"


class TestNoteColourContrast:
    """Programmatic WCAG AA contrast checks against the *real* rendered
    header, in both themes, for every swatch the menu offers -- not an
    eyeballed screenshot."""

    def _swatch_hexes(self, driver):
        return driver.execute_script(
            """
            return wbPalette()
                .concat(typeof CF_PASTEL_COLOURS !== 'undefined' ? CF_PASTEL_COLOURS : [])
                .concat(typeof CF_DARK_COLOURS !== 'undefined' ? CF_DARK_COLOURS : []);
            """
        )

    def _assert_all_swatches_meet_aa(self, driver, task_name):
        for colour in self._swatch_hexes(driver):
            pick_swatch(driver, task_name, colour)
            style = note_header_style(driver, task_name)
            bg_hex = rgb_to_hex(style["background"])
            text_hex = rgb_to_hex(style["color"])
            ratio = contrast_ratio(driver, bg_hex, text_hex)
            assert ratio >= 4.5, (
                f"{colour} -> header bg {bg_hex} / text {text_hex} only reaches "
                f"{ratio:.2f}:1, below WCAG AA (4.5:1)"
            )

    def test_every_swatch_meets_aa_contrast_in_light_mode(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)
        browser.execute_script("document.documentElement.setAttribute('data-theme', 'light');")

        self._assert_all_swatches_meet_aa(browser, "Build")

    def test_every_swatch_meets_aa_contrast_in_dark_mode(self, browser, app_server):
        open_app(browser, app_server)
        load_plan(browser, SAMPLE_PLAN)
        switch_to_whiteboard(browser)
        browser.execute_script("document.documentElement.setAttribute('data-theme', 'dark');")

        self._assert_all_swatches_meet_aa(browser, "Build")
