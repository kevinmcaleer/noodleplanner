"""Selenium-driven browser tests for the ribbon's display selector (issues
#955, #1026, #1027) -- a combined "Just Tabs / Simple Ribbon / Full Ribbon"
dropdown in the tab strip, replacing the old separate "collapse the ribbon"
chevron and Full/Simple-only toggle.

These exercise the real ribbon.js/ribbon-ia.js/ribbon-layout.js against a
real running instance of the app in headless Chrome, following the same
self-contained app_server/browser fixture pattern as
tests/test_whiteboard_canvas.py (a background uvicorn thread on a free
port; never the production port 8007/8102 setup used for manual
verification).

What's covered here, matching the parent epic's (#998) own checklist:
  - the dropdown opens and offers all three choices (Just Tabs/Simple/Full)
  - switching to Simple Ribbon visibly changes the rendered DOM structure
    (`.ribbon-body-simple` + `.ribbon-simple-group`/`.ribbon-simple-btn`
    replace `.ribbon-group`/`.ribbon-lg-btn`/`.ribbon-sm-btn`)
  - a command that exists in full mode (e.g. Home > Views > Gantt) is
    reachable -- and does the same thing -- in simple mode too
  - dividers (a border between `.ribbon-simple-group` boxes) render
  - the choice persists across a reload
  - Just Tabs hides the ribbon body but keeps the selector reachable, and
    returns to whichever expanded mode was previously selected
  - dark mode renders every mode without console errors
  - the simple ribbon's buttons and the display selector are real,
    keyboard-focusable <button> elements (parity with the full ribbon,
    which has never had special keyboard roving-tabindex handling either)
  - a very narrow window collapses individual simple-ribbon groups into
    their own per-group dropdown triggers (#1026), each still exposing
    every command in that group

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
    """Headless Chrome/Chromium. Tries a handful of known-good binary/driver
    locations across the environments this suite runs in -- a system
    chromium+chromedriver install (Debian/Raspberry Pi CI images), then this
    sandbox's own pre-installed Playwright Chromium build (see repo
    CLAUDE.md / the Claude Code web sandbox's pre-installed browser), before
    falling back to Selenium's own default discovery."""
    options = ChromeOptions()
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    options.add_argument("--window-size=1280,900")

    import glob
    import os

    binary_candidates = [
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        *sorted(glob.glob("/opt/pw-browsers/chromium-*/chrome-linux/chrome")),
    ]
    for path in binary_candidates:
        if os.path.exists(path):
            options.binary_location = path
            break

    driver_candidates = [
        "/usr/bin/chromedriver",
        "/opt/node22/bin/chromedriver",
    ]
    last_error = None
    found_local_driver = False
    for drv_path in driver_candidates:
        if os.path.exists(drv_path):
            found_local_driver = True
            try:
                service = ChromeService(drv_path)
                return webdriver.Chrome(service=service, options=options)
            except WebDriverException as exc:
                last_error = exc
                continue

    if found_local_driver:
        # A local chromedriver exists but couldn't drive the detected Chrome
        # binary -- most likely version skew between this sandbox's pinned
        # Playwright Chromium build and the globally-installed chromedriver
        # npm package, which drifts independently. Falling through to
        # Selenium's own discovery below would just make Selenium Manager
        # hit the network trying to find/download a matching driver, which
        # can hang for a long time on a restricted network instead of
        # failing fast -- skip now rather than risk that.
        pytest.skip(f"local chromedriver incompatible with detected Chrome: {last_error}")

    try:
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
    """displayMode/scope are per-browser view state in localStorage (see
    ribbon.js's RIBBON_STATE_KEY) -- start each test from a known 'full'
    displayMode regardless of what an earlier test in this module left
    behind."""
    driver.execute_script("localStorage.removeItem('noodleplanner:ribbon-state');")


def reset_window_size(driver):
    driver.set_window_size(1280, 900)
    time.sleep(0.2)


def displayed_group_triggers(driver):
    return driver.find_elements(
        By.CSS_SELECTOR,
        '.ribbon-simple-group-trigger:not([hidden])',
    )


def actionable_console_errors(driver):
    logs = driver.get_log('browser') if 'chrome' in driver.name else []
    ignored_prefixes = (
        'https://cdn.jsdelivr.net/',
        'https://fonts.googleapis.com/',
    )
    actionable = []
    for entry in logs:
        if entry.get('level') != 'SEVERE':
            continue
        message = entry.get('message', '')
        if 'ERR_NAME_NOT_RESOLVED' in message and message.startswith(ignored_prefixes):
            continue
        actionable.append(entry)
    return actionable


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


def choose_display_mode(driver, mode):
    open_display_menu(driver)
    item = driver.find_element(By.CSS_SELECTOR, f'.ribbon-display-menu-item[data-display-mode="{mode}"]')
    item.click()
    time.sleep(0.2)


def is_simple(driver):
    return driver.execute_script(
        "return document.querySelector('.ribbon-body').classList.contains('ribbon-body-simple');"
    )


def is_collapsed(driver):
    return driver.execute_script(
        "return document.querySelector('.ribbon-shell').classList.contains('collapsed');"
    )


# ── Tests ────────────────────────────────────────────────────────────────


class TestDisplaySelectorDropdown:
    def test_dropdown_offers_all_three_choices(self, browser, app_server):
        open_app(browser, app_server)
        clear_ribbon_state(browser)
        browser.refresh()
        dismiss_tour(browser)
        time.sleep(0.3)

        menu = open_display_menu(browser)
        items = menu.find_elements(By.CSS_SELECTOR, '.ribbon-display-menu-item')
        # .text includes the leading checkmark span's content ('✓' for the
        # currently-selected item, empty otherwise) -- strip it so items
        # compare on their label alone.
        labels = sorted(i.text.replace("✓", "").strip() for i in items)
        assert labels == ["Full Ribbon", "Just Tabs", "Simple Ribbon"]

    def test_dropdown_shows_full_as_selected_by_default(self, browser, app_server):
        open_app(browser, app_server)
        clear_ribbon_state(browser)
        browser.refresh()
        dismiss_tour(browser)
        time.sleep(0.3)

        menu = open_display_menu(browser)
        full_item = menu.find_element(By.CSS_SELECTOR, '.ribbon-display-menu-item[data-display-mode="full"]')
        assert full_item.get_attribute("aria-checked") == "true"
        assert is_simple(browser) is False
        assert is_collapsed(browser) is False

    def test_toggle_shows_no_icon_just_the_caret(self, browser, app_server):
        # #1027: "remove the icon and any button border -- just show the
        # dropdown arrow".
        open_app(browser, app_server)
        clear_ribbon_state(browser)
        browser.refresh()
        dismiss_tour(browser)
        time.sleep(0.3)

        toggle = browser.find_element(By.CSS_SELECTOR, '.ribbon-display-toggle-btn')
        assert not toggle.find_elements(By.CSS_SELECTOR, 'svg'), "no icon inside the toggle button"
        border_width = browser.execute_script(
            "return getComputedStyle(arguments[0]).borderWidth;", toggle
        )
        assert border_width in ("0px", ""), f"expected no visible border, got {border_width}"


class TestDisplayModeChangesStructure:
    def test_switching_to_simple_replaces_full_mode_dom(self, browser, app_server):
        open_app(browser, app_server)
        clear_ribbon_state(browser)
        browser.refresh()
        dismiss_tour(browser)
        time.sleep(0.3)

        assert browser.find_elements(By.CSS_SELECTOR, '.ribbon-group'), "full mode starts with .ribbon-group boxes"
        assert not browser.find_elements(By.CSS_SELECTOR, '.ribbon-simple-group')

        choose_display_mode(browser, 'simple')

        assert is_simple(browser) is True
        assert browser.find_elements(By.CSS_SELECTOR, '.ribbon-simple-group'), "simple mode renders .ribbon-simple-group rows"
        assert not browser.find_elements(By.CSS_SELECTOR, '.ribbon-group'), "full mode's .ribbon-group boxes are gone"
        assert browser.find_elements(By.CSS_SELECTOR, '.ribbon-simple-btn'), "simple mode renders .ribbon-simple-btn buttons"

        # Group captions ("Plan", "Views", ...) only exist in full mode --
        # simple mode drops them (see ribbon.js's flattenGroupButtons()
        # comment): no room for one in a single dense row.
        assert not browser.find_elements(By.CSS_SELECTOR, '.ribbon-group-caption')

        choose_display_mode(browser, 'full')
        assert is_simple(browser) is False
        assert browser.find_elements(By.CSS_SELECTOR, '.ribbon-group')
        assert not browser.find_elements(By.CSS_SELECTOR, '.ribbon-simple-group')

    def test_dividers_render_between_simple_mode_subsections(self, browser, app_server):
        open_app(browser, app_server)
        clear_ribbon_state(browser)
        browser.refresh()
        dismiss_tour(browser)
        time.sleep(0.3)
        choose_display_mode(browser, 'simple')

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

        choose_display_mode(browser, 'full')


class TestNoFunctionalityLostInSimpleMode:
    def test_gantt_button_reachable_and_works_in_simple_mode(self, browser, app_server):
        open_app(browser, app_server)
        clear_ribbon_state(browser)
        browser.refresh()
        dismiss_tour(browser)
        time.sleep(0.3)
        choose_display_mode(browser, 'simple')
        browser.find_element(By.CSS_SELECTOR, '.ribbon-tab-btn[data-tab="home"]').click()
        time.sleep(0.3)

        visible_gantt = browser.find_elements(
            By.CSS_SELECTOR,
            '.ribbon-body .ribbon-simple-btn[data-scope-id="home"][data-label="Gantt"]',
        )
        if visible_gantt and visible_gantt[0].is_displayed():
            gantt_btn = visible_gantt[0]
        else:
            browser.find_element(
                By.CSS_SELECTOR,
                '.ribbon-simple-group-trigger[data-group="Views"]:not([hidden])',
            ).click()
            gantt_btn = WebDriverWait(browser, 5).until(
                EC.element_to_be_clickable(
                    (By.CSS_SELECTOR, '.ribbon-simple-group-popover [data-scope-id="home"][data-label="Gantt"]')
                )
            )

        assert "Gantt" in gantt_btn.get_attribute("aria-label")
        gantt_btn.click()
        time.sleep(0.3)

        view = WebDriverWait(browser, 5).until(
            EC.presence_of_element_located((By.ID, "gantt-view"))
        )
        assert "active" in view.get_attribute("class")

        choose_display_mode(browser, 'full')

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
        choose_display_mode(browser, 'simple')

        delete_btn = browser.find_element(
            By.CSS_SELECTOR, '.ribbon-body [data-scope-id="home"][data-label="Delete"]'
        )
        assert delete_btn.get_attribute("data-stub") == "true"

        choose_display_mode(browser, 'full')


class TestPersistence:
    def test_display_mode_persists_across_reload(self, browser, app_server):
        open_app(browser, app_server)
        clear_ribbon_state(browser)
        browser.refresh()
        dismiss_tour(browser)
        time.sleep(0.3)
        choose_display_mode(browser, 'simple')
        assert is_simple(browser) is True

        browser.refresh()
        dismiss_tour(browser)
        time.sleep(0.3)
        assert is_simple(browser) is True, "simple mode should survive a reload (localStorage)"

        stored = browser.execute_script(
            "return JSON.parse(localStorage.getItem('noodleplanner:ribbon-state') || '{}');"
        )
        assert stored.get("displayMode") == "simple"

        # Clean up: leave the browser (session-scoped) back on full for
        # whichever test module runs next.
        choose_display_mode(browser, 'full')

    def test_legacy_collapsed_and_density_preference_migrates(self, browser, app_server):
        # A browser that persisted state under the pre-#1027 shape
        # (collapsed/density) still gets a sensible mode after this change
        # ships -- see ribbon.js's resolveDisplayMode().
        open_app(browser, app_server)
        browser.execute_script(
            "localStorage.setItem('noodleplanner:ribbon-state', "
            "JSON.stringify({scope: 'project', collapsed: false, density: 'simple'}));"
        )
        browser.refresh()
        dismiss_tour(browser)
        time.sleep(0.3)
        assert is_simple(browser) is True, "a legacy density:'simple' preference migrates to simple mode"

        clear_ribbon_state(browser)
        choose_display_mode(browser, 'full')


class TestJustTabsMode:
    def test_just_tabs_hides_body_and_selector_stays_reachable(self, browser, app_server):
        open_app(browser, app_server)
        clear_ribbon_state(browser)
        browser.refresh()
        dismiss_tour(browser)
        time.sleep(0.3)

        choose_display_mode(browser, 'simple')
        assert is_simple(browser) is True

        choose_display_mode(browser, 'tabs')
        assert is_collapsed(browser) is True

        body_display = browser.execute_script(
            "return document.querySelector('.ribbon-body').style.display;"
        )
        assert body_display == "none", "Just Tabs hides the ribbon body"

        # The selector itself must stay visible/reachable -- it lives in the
        # tab strip, which Just Tabs never hides.
        toggle = browser.find_element(By.CSS_SELECTOR, '.ribbon-display-toggle-btn')
        assert toggle.is_displayed()

        # Returning to an expanded mode restores simple, not full -- Just
        # Tabs doesn't reset whichever expanded mode was previously chosen.
        choose_display_mode(browser, 'simple')
        assert is_collapsed(browser) is False
        assert is_simple(browser) is True, "re-expanding from Just Tabs restores the previously-chosen mode"

        choose_display_mode(browser, 'full')


class TestDarkMode:
    def test_every_mode_renders_cleanly_in_dark_mode(self, browser, app_server):
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

        # Full mode: groups should render.
        assert browser.find_elements(By.CSS_SELECTOR, '.ribbon-group')

        choose_display_mode(browser, 'simple')
        assert browser.find_elements(By.CSS_SELECTOR, '.ribbon-simple-group')
        assert browser.find_elements(By.CSS_SELECTOR, '.ribbon-simple-btn')

        choose_display_mode(browser, 'tabs')
        assert is_collapsed(browser) is True

        severe = actionable_console_errors(browser)
        assert severe == [], f"unexpected console errors across dark-mode display modes: {severe}"

        choose_display_mode(browser, 'full')
        browser.execute_script("setThemeChoice('light');")


class TestKeyboardOperability:
    def test_simple_buttons_and_toggle_are_focusable(self, browser, app_server):
        open_app(browser, app_server)
        clear_ribbon_state(browser)
        browser.refresh()
        dismiss_tour(browser)
        time.sleep(0.3)
        choose_display_mode(browser, 'simple')

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

        choose_display_mode(browser, 'full')


class TestNarrowWindowGroupCollapse:
    """#1026: once every simple-ribbon button in the row has already lost
    its label (icon-only) and the row still doesn't fit, individual groups
    collapse into their own small, identifiable dropdown -- never into a
    single shared "More" catch-all."""

    def test_narrow_window_collapses_individual_groups_into_their_own_dropdowns(self, browser, app_server):
        open_app(browser, app_server)
        clear_ribbon_state(browser)
        browser.refresh()
        dismiss_tour(browser)
        time.sleep(0.3)
        choose_display_mode(browser, 'simple')
        browser.find_element(By.CSS_SELECTOR, '.ribbon-tab-btn[data-tab="plan"]').click()
        time.sleep(0.3)

        baseline_triggers = len(displayed_group_triggers(browser))

        browser.set_window_size(900, 900)
        time.sleep(0.4)
        # Resize fires ribbon.js's own debounced (100ms) handler.
        time.sleep(0.3)

        triggers = displayed_group_triggers(browser)
        assert len(triggers) > baseline_triggers, (
            "a narrower window collapses additional simple-ribbon groups into their own triggers"
        )
        for t in triggers:
            assert t.get_attribute("aria-label"), "each collapsed group's trigger has an accessible name"
            assert t.text.replace('▼', '').strip() == t.get_attribute("data-group"), \
                "each collapsed group's trigger shows the group's name, not a generic icon"

        # Labels go all at once: with groups collapsing, no visible button
        # is left holding its label beside icon-only neighbours.
        labelled = browser.execute_script("""
            return Array.from(document.querySelectorAll('.ribbon-body .ribbon-simple-btn'))
                .filter((b) => b.offsetParent !== null && !b.classList.contains('icon-only')).length;
        """)
        assert labelled == 0, "every visible button in a collapsing row is icon-only"

        # No shared "More" tile in simple mode any more (#1026) -- each
        # collapsed group gets its own trigger instead.
        assert not browser.find_elements(By.CSS_SELECTOR, '.ribbon-body-simple .ribbon-more')

        # Every command icon that's still part of a *visible* (uncollapsed)
        # group stays reachable -- only once a group's own trigger has been
        # clicked does its full command set (with labels) appear.
        first_trigger = triggers[0]
        group_name = first_trigger.get_attribute("data-group")
        first_trigger.click()
        popover = WebDriverWait(browser, 5).until(
            EC.visibility_of_element_located((By.CSS_SELECTOR, '.ribbon-simple-group-popover'))
        )
        items = popover.find_elements(By.CSS_SELECTOR, '.ribbon-simple-menu-item[role="menuitem"]')
        assert items, f"the '{group_name}' group's popover lists its commands as menu items"
        for item in items:
            label = item.find_element(By.CSS_SELECTOR, '.ribbon-simple-btn-label')
            assert label.is_displayed() and label.text, "each menu item shows its label"
            svg = item.find_element(By.CSS_SELECTOR, 'svg')
            assert svg.location['x'] < label.location['x'], "icon sits to the left of the label"
        xs = {item.location['x'] for item in items}
        assert len(xs) == 1 and len({item.location['y'] for item in items}) == len(items), \
            "the menu stacks its items vertically"

        reset_window_size(browser)
        choose_display_mode(browser, 'full')

    def test_widening_back_restores_the_full_row(self, browser, app_server):
        open_app(browser, app_server)
        clear_ribbon_state(browser)
        browser.refresh()
        dismiss_tour(browser)
        time.sleep(0.3)
        choose_display_mode(browser, 'simple')
        browser.find_element(By.CSS_SELECTOR, '.ribbon-tab-btn[data-tab="plan"]').click()
        time.sleep(0.3)

        # Baseline at the fixture's normal 1280px width: the Home tab alone
        # has more buttons than 1280px can label in full, so some are
        # already icon-only here -- this test is about the row correctly
        # RE-DERIVING itself after a narrow-then-wide round trip, not about
        # reaching some absolute zero-collapsed state.
        baseline_icon_only = len(browser.find_elements(By.CSS_SELECTOR, '.ribbon-simple-btn.icon-only'))
        baseline_triggers = len(displayed_group_triggers(browser))

        browser.set_window_size(900, 900)
        time.sleep(0.4)
        assert len(displayed_group_triggers(browser)) > baseline_triggers, \
            "narrowing the window increases the number of collapsed simple-ribbon groups"

        reset_window_size(browser)
        time.sleep(0.4)
        assert len(displayed_group_triggers(browser)) == baseline_triggers, \
            "widening the window back out restores the original collapsed-group count"
        assert len(browser.find_elements(By.CSS_SELECTOR, '.ribbon-simple-btn.icon-only')) == baseline_icon_only, \
            "widening the window back out re-derives the same label/icon-only split as the original 1280px layout"

        choose_display_mode(browser, 'full')
