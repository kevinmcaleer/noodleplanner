"""Selenium regression test for the Settings panel (issues #853, #883).

`style.css` defined `.settings-tab-content { display: none }` /
`.settings-tab-content.active { display: block }` but was never linked by
index.html, so every settings tab rendered simultaneously, stacked, no
matter which one had `.active`. The rules now live in components.css
(which is linked); this test drives a real browser so a future refactor
that moves them again shows up here rather than as a silent regression.

Usage:
    uv run pytest tests/test_settings_panel.py -x -q
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

SETTINGS_TABS = ["gantt", "board", "timeline", "theme", "ai", "storage", "sync"]


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
    """Same explicit-path convention as test_usability.py's driver setup."""
    import os

    options = ChromeOptions()
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    options.add_argument("--window-size=1280,900")

    if os.path.exists("/usr/bin/chromium"):
        options.binary_location = "/usr/bin/chromium"

    try:
        from webdriver_manager.chrome import ChromeDriverManager

        service = ChromeService(ChromeDriverManager().install())
        return webdriver.Chrome(service=service, options=options)
    except (ImportError, Exception):
        pass

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


def _visible_settings_tabs(browser):
    """Which settingsTab-* panes currently compute to display:block."""
    return browser.execute_script(
        """
        return [...document.querySelectorAll('.settings-tab-content')]
            .filter(el => getComputedStyle(el).display !== 'none')
            .map(el => el.id);
        """
    )


class TestSettingsPanelTabs:
    def test_only_the_default_tab_is_visible_on_open(self, browser, app_server):
        browser.get(app_server)
        browser.execute_script("openSettingsPanel();")
        visible = _visible_settings_tabs(browser)
        assert visible == ["settingsTab-gantt"], (
            f"expected only the Gantt tab visible, got {visible}"
        )

    @pytest.mark.parametrize("tab", SETTINGS_TABS)
    def test_switching_tabs_shows_exactly_one_pane(self, browser, app_server, tab):
        browser.get(app_server)
        browser.execute_script("openSettingsPanel();")
        browser.execute_script(f"switchSettingsTab('{tab}');")
        visible = _visible_settings_tabs(browser)
        assert visible == [f"settingsTab-{tab}"], (
            f"switching to {tab!r} should show only its pane, got {visible}"
        )

    def test_active_tab_button_has_the_accent_underline(self, browser, app_server):
        browser.get(app_server)
        browser.execute_script("openSettingsPanel();")
        browser.execute_script("switchSettingsTab('theme');")
        btn = browser.find_element(By.CSS_SELECTOR, '.settings-tab-btn[data-tab="theme"]')
        assert "active" in btn.get_attribute("class").split()
        border_width = browser.execute_script(
            "return getComputedStyle(arguments[0]).borderBottomWidth;", btn
        )
        assert border_width != "0px", "the active tab should have a visible underline"
