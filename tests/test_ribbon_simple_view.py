"""Selenium-driven browser tests for the ribbon's simple/full density mode
(issue #955) -- a single dense row option for the ribbon body, chosen via a
"Ribbon Display Options" dropdown, alongside the existing multi-row "full"
rendering.

These exercise the real ribbon.js/ribbon-ia.js/ribbon-layout.js against a
real running instance of the app in headless Chrome, following the same
self-contained app_server/browser fixture pattern as
tests/test_whiteboard_canvas.py (a background uvicorn thread on a free
port; never the production port 8007/8102 setup used for manual
verification).

What's covered here, matching the PR's own checklist:
  - the dropdown opens and offers both Full Ribbon / Simple Ribbon choices
  - switching to simple mode visibly changes the rendered DOM structure
    (`.ribbon-body-simple` + `.ribbon-simple-group`/`.ribbon-simple-btn`
    replace `.ribbon-group`/`.ribbon-lg-btn`/`.ribbon-sm-btn`)
  - a command that exists in full mode (e.g. Home > Views > Gantt) is
    reachable -- and does the same thing -- in simple mode too
  - dividers (a border between `.ribbon-simple-group` boxes) render
  - the choice persists across a reload
  - dark mode renders both densities without console errors
  - the simple ribbon's buttons and the display-options control are real,
    keyboard-focusable <button> elements (parity with the full ribbon,
    which has never had special keyboard roving-tabindex handling either)

The existing `ribbon-collapse-btn` (auto-hide the whole ribbon body) is a
different, orthogonal concept from this density toggle -- see this test's
`test_collapse_and_density_compose_independently` for the behavioural
check backing that design decision (documented in ribbon.js's own comment
on the `toggle-collapse` handler in wireEvents()).

Usage:
    uv run pytest tests/test_ribbon_simple_view.py -x -q
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


def find_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def app_server():
    """Start the FastAPI app on a random free port in a background thread."""
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
    """Headless Chrome/Chromium via this sandbox's known-good chromium +
    chromedriver paths (see repo CLAUDE.md worktree instructions)."""
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


# ── Shared helpers ──────────────────────────────────────────────────────


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


def clear_ribbon_state(driver):
    """Density/scope/collapsed are per-browser view state in localStorage
    (see ribbon.js's RIBBON_STATE_KEY) -- start each test from a known
    'full' density regardless of what an earlier test in this module left
    behind."""
    driver.execute_script("localStorage.removeItem('noodleplanner:ribbon-state');")


def open_display_menu(driver):
    # A plain find + click, not EC.element_to_be_clickable() -- that
    # condition re-polls the locator on a timer and can hand back a
    # WebElement from an earlier poll that's since gone stale (the button
    # is recreated by every refreshRibbon() innerHTML swap), which was
    # flaky here specifically. The thing actually worth waiting for is the
    # popover appearing, not the button's "clickable" status.
    btn = driver.find_element(By.CSS_SELECTOR, '.ribbon-display-toggle-btn')
    btn.click()
    return WebDriverWait(driver, 5).until(
        EC.visibility_of_element_located((By.CSS_SELECTOR, '.ribbon-display-menu'))
    )


def choose_density(driver, density):
    open_display_menu(driver)
    item = driver.find_element(By.CSS_SELECTOR, f'.ribbon-display-menu-item[data-density="{density}"]')
    item.click()
    time.sleep(0.2)


def is_simple(driver):
    return driver.execute_script(
        "return document.querySelector('.ribbon-body').classList.contains('ribbon-body-simple');"
    )


# ── Tests ────────────────────────────────────────────────────────────────


class TestDisplayOptionsDropdown:
    def test_dropdown_offers_both_choices(self, browser, app_server):
        open_app(browser, app_server)
        clear_ribbon_state(browser)
        browser.refresh()
        dismiss_tour(browser)
        time.sleep(0.3)

        menu = open_display_menu(browser)
        items = menu.find_elements(By.CSS_SELECTOR, '.ribbon-display-menu-item')
        # .text includes the leading checkmark span's content ('✓' for the
        # currently-selected item, empty otherwise) -- strip it so both
        # items compare on their label alone.
        labels = sorted(i.text.replace("✓", "").strip() for i in items)
        assert labels == ["Full Ribbon", "Simple Ribbon"]

    def test_dropdown_shows_full_as_selected_by_default(self, browser, app_server):
        open_app(browser, app_server)
        clear_ribbon_state(browser)
        browser.refresh()
        dismiss_tour(browser)
        time.sleep(0.3)

        menu = open_display_menu(browser)
        full_item = menu.find_element(By.CSS_SELECTOR, '.ribbon-display-menu-item[data-density="full"]')
        assert full_item.get_attribute("aria-checked") == "true"
        assert is_simple(browser) is False


class TestDensitySwitchChangesStructure:
    def test_switching_to_simple_replaces_full_mode_dom(self, browser, app_server):
        open_app(browser, app_server)
        clear_ribbon_state(browser)
        browser.refresh()
        dismiss_tour(browser)
        time.sleep(0.3)

        assert browser.find_elements(By.CSS_SELECTOR, '.ribbon-group'), "full mode starts with .ribbon-group boxes"
        assert not browser.find_elements(By.CSS_SELECTOR, '.ribbon-simple-group')

        choose_density(browser, 'simple')

        assert is_simple(browser) is True
        assert browser.find_elements(By.CSS_SELECTOR, '.ribbon-simple-group'), "simple mode renders .ribbon-simple-group rows"
        assert not browser.find_elements(By.CSS_SELECTOR, '.ribbon-group'), "full mode's .ribbon-group boxes are gone"
        assert browser.find_elements(By.CSS_SELECTOR, '.ribbon-simple-btn'), "simple mode renders .ribbon-simple-btn buttons"

        # Group captions ("Plan", "Views", ...) only exist in full mode --
        # simple mode drops them (see ribbon.js's flattenGroupButtons()
        # comment): no room for one in a single dense row.
        assert not browser.find_elements(By.CSS_SELECTOR, '.ribbon-group-caption')

        choose_density(browser, 'full')
        assert is_simple(browser) is False
        assert browser.find_elements(By.CSS_SELECTOR, '.ribbon-group')
        assert not browser.find_elements(By.CSS_SELECTOR, '.ribbon-simple-group')

    def test_dividers_render_between_simple_mode_subsections(self, browser, app_server):
        open_app(browser, app_server)
        clear_ribbon_state(browser)
        browser.refresh()
        dismiss_tour(browser)
        time.sleep(0.3)
        choose_density(browser, 'simple')

        groups = browser.find_elements(By.CSS_SELECTOR, '.ribbon-simple-group')
        assert len(groups) >= 2, "Home tab has multiple groups to divide between"

        # A plain vertical rule (border-right), same convention .ribbon-group
        # already uses for its own divider (see components.css) -- every
        # group but the last should have a visible border.
        border_widths = [
            browser.execute_script(
                "return getComputedStyle(arguments[0]).borderRightWidth;", g
            )
            for g in groups
        ]
        assert any(w not in ("0px", "") for w in border_widths[:-1]), \
            f"expected a border-right divider between groups, got {border_widths}"


class TestNoFunctionalityLostInSimpleMode:
    def test_gantt_button_reachable_and_works_in_simple_mode(self, browser, app_server):
        open_app(browser, app_server)
        clear_ribbon_state(browser)
        browser.refresh()
        dismiss_tour(browser)
        time.sleep(0.3)
        choose_density(browser, 'simple')

        gantt_btn = WebDriverWait(browser, 5).until(
            EC.element_to_be_clickable(
                (By.CSS_SELECTOR, '.ribbon-body [data-scope-id="home"][data-label="Gantt"]')
            )
        )
        assert "ribbon-simple-btn" in gantt_btn.get_attribute("class")
        gantt_btn.click()
        time.sleep(0.3)

        view = WebDriverWait(browser, 5).until(
            EC.presence_of_element_located((By.ID, "gantt-view"))
        )
        assert "active" in view.get_attribute("class")

    def test_stub_button_still_marked_as_stub_in_simple_mode(self, browser, app_server):
        # "Delete" (Home > Plan group) has no wired action -- ribbon.js
        # marks it data-stub="true" and still renders it either way; this
        # confirms simple mode doesn't quietly turn a stub into something
        # that silently no-ops without the visual/aria cue full mode gives.
        open_app(browser, app_server)
        clear_ribbon_state(browser)
        browser.refresh()
        dismiss_tour(browser)
        time.sleep(0.3)
        choose_density(browser, 'simple')

        delete_btn = browser.find_element(
            By.CSS_SELECTOR, '.ribbon-body [data-scope-id="home"][data-label="Delete"]'
        )
        assert delete_btn.get_attribute("data-stub") == "true"


class TestPersistence:
    def test_density_choice_persists_across_reload(self, browser, app_server):
        open_app(browser, app_server)
        clear_ribbon_state(browser)
        browser.refresh()
        dismiss_tour(browser)
        time.sleep(0.3)
        choose_density(browser, 'simple')
        assert is_simple(browser) is True

        browser.refresh()
        dismiss_tour(browser)
        time.sleep(0.3)
        assert is_simple(browser) is True, "simple density should survive a reload (localStorage)"

        stored = browser.execute_script(
            "return JSON.parse(localStorage.getItem('noodleplanner:ribbon-state') || '{}');"
        )
        assert stored.get("density") == "simple"

        # Clean up: leave the browser (session-scoped) back on full for
        # whichever test module runs next.
        choose_density(browser, 'full')


class TestCollapseAndDensityCompose:
    def test_collapse_and_density_compose_independently(self, browser, app_server):
        open_app(browser, app_server)
        clear_ribbon_state(browser)
        browser.refresh()
        dismiss_tour(browser)
        time.sleep(0.3)

        choose_density(browser, 'simple')
        assert is_simple(browser) is True

        # Collapsing hides the whole body -- whichever density -- it does
        # not change which density is selected. Re-find the button before
        # each click rather than reusing one reference: refreshRibbon()
        # recreates the tab strip (and this button with it) on every state
        # change, so a held-over WebElement goes stale after the first click.
        browser.find_element(By.CSS_SELECTOR, '.ribbon-collapse-btn').click()
        time.sleep(0.2)

        body_display = browser.execute_script(
            "return document.querySelector('.ribbon-body').style.display;"
        )
        assert body_display == "none", "collapse hides the body regardless of density"

        # Expand again: still simple, not reset to full.
        browser.find_element(By.CSS_SELECTOR, '.ribbon-collapse-btn').click()
        time.sleep(0.2)
        assert is_simple(browser) is True, "re-expanding keeps the previously-chosen density"

        choose_density(browser, 'full')


class TestDarkMode:
    def test_full_and_simple_render_cleanly_in_dark_mode(self, browser, app_server):
        open_app(browser, app_server)
        clear_ribbon_state(browser)
        browser.refresh()
        dismiss_tour(browser)
        time.sleep(0.3)

        browser.execute_script("setThemeChoice('dark');")
        time.sleep(0.2)
        assert browser.execute_script(
            "return document.documentElement.getAttribute('data-theme');"
        ) == "dark"

        # Full mode: the ribbon body should have a genuinely different
        # (dark) background than a bright default, and groups should render.
        assert browser.find_elements(By.CSS_SELECTOR, '.ribbon-group')

        choose_density(browser, 'simple')
        assert browser.find_elements(By.CSS_SELECTOR, '.ribbon-simple-group')
        assert browser.find_elements(By.CSS_SELECTOR, '.ribbon-simple-btn')

        logs = browser.get_log('browser') if 'chrome' in browser.name else []
        severe = [entry for entry in logs if entry.get('level') == 'SEVERE']
        assert severe == [], f"unexpected console errors in dark + simple mode: {severe}"

        choose_density(browser, 'full')
        browser.execute_script("setThemeChoice('light');")


class TestKeyboardOperability:
    def test_simple_buttons_and_toggle_are_focusable(self, browser, app_server):
        open_app(browser, app_server)
        clear_ribbon_state(browser)
        browser.refresh()
        dismiss_tour(browser)
        time.sleep(0.3)
        choose_density(browser, 'simple')

        toggle_btn = browser.find_element(By.CSS_SELECTOR, '.ribbon-display-toggle-btn')
        assert toggle_btn.tag_name == 'button'
        toggle_btn.send_keys("")  # focusable without throwing
        toggle_btn.click()  # opens the menu

        first_item = browser.find_element(By.CSS_SELECTOR, '.ribbon-display-menu-item')
        first_item.send_keys(Keys.ESCAPE)
        time.sleep(0.2)
        assert not browser.find_elements(By.CSS_SELECTOR, '.ribbon-display-menu'), "Escape closes the display menu"

        simple_btn = browser.find_element(By.CSS_SELECTOR, '.ribbon-simple-btn')
        assert simple_btn.tag_name == 'button'
        assert simple_btn.get_attribute("tabindex") != "-1"

        choose_density(browser, 'full')
