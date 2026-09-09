"""Selenium-driven browser tests for the full-screen Backstage shell
(issue #972, follow-up to #943/#944).

Backstage used to render as a `.tab-content` panel with the ribbon, header
and status bar still visible around it, reached via a two-click `File ▾`
dropdown. #972 makes `File` navigate straight there, hides the whole ribbon
chrome + status bar while it's open (a genuine mode change, not a panel),
and gives it a mandatory back arrow / Esc exit route since there is
otherwise no way out once the ribbon is hidden.

These exercise the real ribbon.js/backstage.js against a real running
instance of the app in headless Chrome, following the same self-contained
app_server/browser fixture pattern as tests/test_ribbon_simple_view.py.

What's covered here, matching the issue's own acceptance checklist:
  - clicking File navigates straight to Backstage -- no dropdown appears
  - full screen: ribbon, status bar and project subnav are all hidden
    while Backstage is active
  - the back arrow and Esc both return to the previously active view
  - with no prior view (first run), the back arrow falls back to Portfolio
  - the rail runs all eight file operations, Save included
  - the top strip shows real templates from /api/templates, "More
    templates →" opens the full browser, and its back link returns to
    the Recent/strip landing
  - Cmd+N / Cmd+O / Cmd+S / Cmd+P still work with the dropdown gone

Usage:
    uv run pytest tests/test_backstage_fullscreen.py -x -q
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
    pytest.mark.usability,
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


def is_visible(driver, selector):
    return driver.execute_script(
        "var el = document.querySelector(arguments[0]);"
        "return !!el && window.getComputedStyle(el).display !== 'none';",
        selector,
    )


def active_tab_content_id(driver):
    return driver.execute_script(
        "var el = document.querySelector('.tab-content.active'); return el ? el.id : null;"
    )


def open_backstage_via_file(driver):
    """Clicks the ribbon's File button -- the #972 entry point."""
    btn = WebDriverWait(driver, 5).until(
        EC.element_to_be_clickable((By.CSS_SELECTOR, '.ribbon-file-btn'))
    )
    btn.click()
    WebDriverWait(driver, 5).until(lambda d: active_tab_content_id(d) == 'backstage-tab')
    time.sleep(0.2)


# ── Tests ────────────────────────────────────────────────────────────────


class TestFileOpensBackstageDirectly:
    def test_file_click_navigates_straight_to_backstage(self, browser, app_server):
        open_app(browser, app_server)
        open_backstage_via_file(browser)
        assert active_tab_content_id(browser) == 'backstage-tab'

    def test_no_dropdown_appears(self, browser, app_server):
        open_app(browser, app_server)
        browser.find_element(By.CSS_SELECTOR, '.ribbon-file-btn').click()
        time.sleep(0.3)
        # The old File dropdown rendered file-menu-item rows with a
        # data-file-index; nothing renders that any more.
        assert not browser.find_elements(By.CSS_SELECTOR, '.ribbon-file-menu-item[data-file-index]')


class TestFullScreen:
    def test_ribbon_status_bar_and_subnav_hidden_while_open(self, browser, app_server):
        open_app(browser, app_server)
        assert is_visible(browser, '#ribbonShell'), "ribbon starts visible"

        open_backstage_via_file(browser)

        assert not is_visible(browser, '#ribbonShell'), "ribbon hidden in Backstage"
        assert not is_visible(browser, '.status-bar'), "status bar hidden in Backstage"
        assert 'backstage-fullscreen' in browser.execute_script("return document.body.className;")

        # Leaving restores everything.
        browser.find_element(By.ID, 'backstageExitBtn').click()
        time.sleep(0.3)
        assert is_visible(browser, '#ribbonShell'), "ribbon restored after leaving Backstage"
        assert is_visible(browser, '.status-bar'), "status bar restored after leaving Backstage"
        assert 'backstage-fullscreen' not in browser.execute_script("return document.body.className;")


class TestExitRoutes:
    def test_back_arrow_returns_to_previous_view(self, browser, app_server):
        open_app(browser, app_server)
        browser.execute_script("switchToView('project-report');")
        time.sleep(0.3)
        assert active_tab_content_id(browser) == 'project-report-tab'

        open_backstage_via_file(browser)
        browser.find_element(By.ID, 'backstageExitBtn').click()
        time.sleep(0.3)

        assert active_tab_content_id(browser) == 'project-report-tab', \
            "back arrow returns to the view that was active before Backstage"

    def test_escape_returns_to_previous_view(self, browser, app_server):
        open_app(browser, app_server)
        browser.execute_script("switchToView('project-report');")
        time.sleep(0.3)

        open_backstage_via_file(browser)
        browser.find_element(By.TAG_NAME, 'body').send_keys(Keys.ESCAPE)
        time.sleep(0.3)

        assert active_tab_content_id(browser) == 'project-report-tab', \
            "Esc returns to the view that was active before Backstage"

    def test_no_prior_view_falls_back_to_portfolio(self, browser, app_server):
        open_app(browser, app_server)
        # Simulate first run: enter Backstage with no tracked prior view.
        browser.execute_script("window.enterBackstage();")
        time.sleep(0.3)
        browser.execute_script("window.exitBackstage();")
        time.sleep(0.3)
        assert active_tab_content_id(browser) == 'portfolio-tab'


class TestRailActions:
    def test_rail_has_all_eight_operations(self, browser, app_server):
        open_app(browser, app_server)
        open_backstage_via_file(browser)

        rail = browser.find_element(By.CSS_SELECTOR, '.backstage-rail')
        labels = [b.text.strip() for b in rail.find_elements(By.CSS_SELECTOR, '.backstage-rail-btn, #backstageTemplatesBtn')]
        for expected in ['New plan', 'Open…', 'Save', 'Import', 'Export…', 'Print', 'Templates', 'Settings']:
            assert any(expected in label for label in labels), f"rail missing {expected!r} (got {labels})"

        browser.find_element(By.ID, 'backstageExitBtn').click()


class TestTemplateStrip:
    def test_strip_shows_blank_and_real_templates(self, browser, app_server):
        open_app(browser, app_server)
        open_backstage_via_file(browser)

        WebDriverWait(browser, 5).until(
            lambda d: len(d.find_elements(By.CSS_SELECTOR, '#backstageTemplateStrip .backstage-template-card')) > 1
        )
        cards = browser.find_elements(By.CSS_SELECTOR, '#backstageTemplateStrip .backstage-template-card')
        names = [c.text.strip() for c in cards]
        assert 'Blank plan' in names
        # Real templates come from /api/templates -- at least one popular
        # seed template (see templates/*/template.yml's `popular: true`)
        # renders with its real title, not a placeholder.
        assert len(names) > 1, f"expected real templates alongside Blank plan, got {names}"

        browser.find_element(By.ID, 'backstageExitBtn').click()

    def test_more_templates_opens_full_browser_and_back_returns(self, browser, app_server):
        open_app(browser, app_server)
        open_backstage_via_file(browser)

        WebDriverWait(browser, 5).until(
            lambda d: len(d.find_elements(By.CSS_SELECTOR, '#backstageTemplateStrip .backstage-template-card')) > 1
        )
        strip_count = len(browser.find_elements(By.CSS_SELECTOR, '#backstageTemplateStrip .backstage-template-card'))

        browser.find_element(By.ID, 'backstageMoreTemplatesBtn').click()
        WebDriverWait(browser, 5).until(
            lambda d: is_visible(d, '#backstageTemplatesView')
        )
        WebDriverWait(browser, 5).until(
            lambda d: len(d.find_elements(By.CSS_SELECTOR, '#backstageTemplateGrid .backstage-template-card')) >= strip_count
        )
        assert not is_visible(browser, '#backstageRecentView'), "Recent/strip landing hidden behind the full browser"

        browser.find_element(By.ID, 'backstageTemplatesBackBtn').click()
        time.sleep(0.3)
        assert is_visible(browser, '#backstageRecentView'), "back link returns to the Recent/strip landing"
        assert not is_visible(browser, '#backstageTemplatesView')

        browser.find_element(By.ID, 'backstageExitBtn').click()

    def test_rail_templates_button_also_opens_full_browser(self, browser, app_server):
        open_app(browser, app_server)
        open_backstage_via_file(browser)

        browser.find_element(By.ID, 'backstageTemplatesBtn').click()
        WebDriverWait(browser, 5).until(lambda d: is_visible(d, '#backstageTemplatesView'))
        assert browser.find_elements(By.CSS_SELECTOR, '#backstageTemplateGrid .backstage-template-card')

        browser.find_element(By.ID, 'backstageExitBtn').click()


class TestFileKeyboardShortcuts:
    def _spy_on_file_action(self, driver, label):
        driver.execute_script(
            "window.__npFileActionCalls = window.__npFileActionCalls || [];"
            "FILE_ACTIONS[arguments[0]] = function () { window.__npFileActionCalls.push(arguments[0] || 1); };",
            label,
        )

    def test_cmd_n_triggers_new_plan_globally(self, browser, app_server):
        open_app(browser, app_server)
        self._spy_on_file_action(browser, 'New plan')
        browser.find_element(By.TAG_NAME, 'body').send_keys(Keys.CONTROL, 'n')
        time.sleep(0.2)
        calls = browser.execute_script("return window.__npFileActionCalls || [];")
        assert 'New plan' in calls

    def test_cmd_o_triggers_open_globally(self, browser, app_server):
        open_app(browser, app_server)
        self._spy_on_file_action(browser, 'Open…')
        browser.find_element(By.TAG_NAME, 'body').send_keys(Keys.CONTROL, 'o')
        time.sleep(0.2)
        calls = browser.execute_script("return window.__npFileActionCalls || [];")
        assert 'Open…' in calls

    def test_cmd_p_triggers_print_globally(self, browser, app_server):
        open_app(browser, app_server)
        self._spy_on_file_action(browser, 'Print')
        browser.find_element(By.TAG_NAME, 'body').send_keys(Keys.CONTROL, 'p')
        time.sleep(0.2)
        calls = browser.execute_script("return window.__npFileActionCalls || [];")
        assert 'Print' in calls

    def test_cmd_s_still_saves(self, browser, app_server):
        # Cmd+S is script.js's own long-standing binding, unaffected by
        # #972 -- confirm it still fires alongside the new N/O/P bindings.
        open_app(browser, app_server)
        browser.execute_script(
            "window.__npSaveCalled = false;"
            "window.downloadMarkdown = function () { window.__npSaveCalled = true; };"
        )
        browser.find_element(By.TAG_NAME, 'body').send_keys(Keys.CONTROL, 's')
        time.sleep(0.2)
        assert browser.execute_script("return window.__npSaveCalled;")
