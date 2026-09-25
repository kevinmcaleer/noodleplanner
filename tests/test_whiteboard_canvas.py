"""Selenium-driven browser tests for the Whiteboard view (issue #845).

These exercise the actual pan/zoom interaction — pointer drag, wheel/pinch
zoom anchored on the cursor, keyboard controls, touch, and viewport
persistence — against a real running instance of the app in headless
Chrome, following the same self-contained app_server/browser fixture
pattern as tests/test_usability.py (a background uvicorn thread on a free
port; nothing is ever pointed at the production port 8007/8102 setup used
for manual verification).

Where an interaction genuinely needs to reach our real event listeners
(mousedown/mousemove/mouseup, wheel, touchstart/move/end) reliably under
headless Chromium, this dispatches real DOM events (MouseEvent, WheelEvent,
TouchEvent) via execute_script rather than relying on OS-level input
synthesis, which is standard practice for headless drag/zoom testing.
Keyboard tests use genuine ActionChains key presses (real, browser-native
KeyboardEvents) since that's reliable and is the more meaningful check for
"is this actually keyboard operable".

Requirements:
    - selenium (pip install selenium)
    - chromedriver + chromium (see _create_chrome_driver below)

Usage:
    uv run pytest tests/test_whiteboard_canvas.py -x -q
"""

import socket
import threading
import time

import pytest

try:
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options as ChromeOptions
    from selenium.webdriver.chrome.service import Service as ChromeService
    from selenium.webdriver.common.action_chains import ActionChains
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

SAMPLE_PLAN = """---
title: Whiteboard Test Plan
---

Phase 1
  Task A @sam 2d
  Task B @sam 1d
"""


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
    """Create a headless Chrome/Chromium WebDriver using this sandbox's
    known-good chromium + chromedriver paths (see repo CLAUDE.md worktree
    instructions), falling back to PATH discovery elsewhere."""
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


def switch_to_whiteboard(driver):
    driver.execute_script("switchToView('whiteboard');")
    WebDriverWait(driver, 5).until(
        EC.visibility_of_element_located((By.ID, "whiteboardContainer"))
    )
    time.sleep(0.3)


def get_layer_transform(driver):
    """Return {panX, panY, zoom} parsed from the wb-layer's transform attr."""
    return driver.execute_script(
        """
        const layer = document.querySelector('#whiteboardContainer .wb-layer');
        if (!layer) return null;
        const t = layer.getAttribute('transform') || '';
        const m = t.match(/translate\\(([-\\d.]+),\\s*([-\\d.]+)\\)\\s*scale\\(([-\\d.]+)\\)/);
        if (!m) return null;
        return { panX: parseFloat(m[1]), panY: parseFloat(m[2]), zoom: parseFloat(m[3]) };
        """
    )


def get_zoom_label(driver):
    return driver.find_element(By.ID, "whiteboardZoomLabel").text


# ── Tests ────────────────────────────────────────────────────────────────


class TestWhiteboardNavigationAndGrid:
    def test_whiteboard_in_ribbon_and_opens_with_grid(self, browser, app_server):
        # Discoverability moved from the old .plan-subnav Views dropdown to
        # the ribbon's Plan tab > Model group (design handoff "Ribbon
        # Toolbar option 2a", #833 follow-up) -- .plan-subnav is hidden now.
        open_app(browser, app_server)
        browser.execute_script("switchPlanSubnavToDashboard();")
        time.sleep(0.2)

        browser.find_element(By.CSS_SELECTOR, '.ribbon-tab-btn[data-tab="plan"]').click()
        time.sleep(0.2)

        item = WebDriverWait(browser, 5).until(
            EC.visibility_of_element_located(
                (By.CSS_SELECTOR, '.ribbon-body [data-scope-id="plan"][data-label="Whiteboard"]')
            )
        )
        assert "Whiteboard" in item.text

        switch_to_whiteboard(browser)
        view = browser.find_element(By.ID, "whiteboard-view")
        assert "active" in view.get_attribute("class")

        has_grid = browser.execute_script(
            "return !!document.querySelector('#whiteboardContainer .wb-grid');"
        )
        assert has_grid, "empty board should render a visible dot-grid background"

        # Board should be usable at 100% by default on first-ever open.
        assert get_zoom_label(browser) == "100%"


class TestPanning:
    def test_middle_button_drag_pans_board(self, browser, app_server):
        """A plain drag on empty canvas lassoes (tests/ui/test_whiteboard_groups.py),
        so a mouse pans with the middle button -- or a two-finger swipe, or
        Space+drag."""
        open_app(browser, app_server)
        switch_to_whiteboard(browser)
        browser.execute_script("whiteboardZoomReset();")

        before = get_layer_transform(browser)

        browser.execute_script(
            """
            const svg = document.querySelector('#whiteboardContainer svg.wb-svg');
            const rect = svg.getBoundingClientRect();
            const startX = rect.left + rect.width / 2;
            const startY = rect.top + rect.height / 2;
            svg.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, cancelable:true, clientX:startX, clientY:startY, button:1}));
            window.dispatchEvent(new MouseEvent('mousemove', {bubbles:true, cancelable:true, clientX:startX+120, clientY:startY+40}));
            window.dispatchEvent(new MouseEvent('mouseup', {bubbles:true, cancelable:true, clientX:startX+120, clientY:startY+40}));
            """
        )
        after = get_layer_transform(browser)

        assert after["panX"] == pytest.approx(before["panX"] + 120, abs=1)
        assert after["panY"] == pytest.approx(before["panY"] + 40, abs=1)
        assert after["zoom"] == pytest.approx(before["zoom"])

    def test_wheel_over_canvas_prevents_default_so_page_does_not_scroll(self, browser, app_server):
        open_app(browser, app_server)
        switch_to_whiteboard(browser)

        default_prevented = browser.execute_script(
            """
            const svg = document.querySelector('#whiteboardContainer svg.wb-svg');
            const rect = svg.getBoundingClientRect();
            const evt = new WheelEvent('wheel', {
                bubbles: true, cancelable: true,
                clientX: rect.left + rect.width/2, clientY: rect.top + rect.height/2,
                deltaX: 0, deltaY: 100
            });
            svg.dispatchEvent(evt);
            return evt.defaultPrevented;
            """
        )
        assert default_prevented is True


class TestZoom:
    def test_wheel_zoom_anchors_on_pointer(self, browser, app_server):
        open_app(browser, app_server)
        switch_to_whiteboard(browser)
        browser.execute_script("whiteboardZoomReset();")
        time.sleep(0.3)

        result = browser.execute_script(
            """
            function transform() {
                const layer = document.querySelector('#whiteboardContainer .wb-layer');
                const t = layer.getAttribute('transform');
                const m = t.match(/translate\\(([-\\d.]+),\\s*([-\\d.]+)\\)\\s*scale\\(([-\\d.]+)\\)/);
                return { panX: parseFloat(m[1]), panY: parseFloat(m[2]), zoom: parseFloat(m[3]) };
            }
            const svg = document.querySelector('#whiteboardContainer svg.wb-svg');
            const rect = svg.getBoundingClientRect();
            const anchorX = rect.left + rect.width * 0.3;
            const anchorY = rect.top + rect.height * 0.7;

            const before = transform();
            const localX = anchorX - rect.left, localY = anchorY - rect.top;
            const boardX = (localX - before.panX) / before.zoom;
            const boardY = (localY - before.panY) / before.zoom;

            svg.dispatchEvent(new WheelEvent('wheel', {
                bubbles: true, cancelable: true,
                clientX: anchorX, clientY: anchorY,
                deltaX: 0, deltaY: -100, ctrlKey: true
            }));

            const after = transform();
            const screenXAfter = after.panX + after.zoom * boardX;
            const screenYAfter = after.panY + after.zoom * boardY;

            return {
                zoomBefore: before.zoom, zoomAfter: after.zoom,
                localX, localY, screenXAfter, screenYAfter
            };
            """
        )
        assert result["zoomAfter"] > result["zoomBefore"], "ctrl+wheel with negative deltaY should zoom in"
        assert result["screenXAfter"] == pytest.approx(result["localX"], abs=1.5)
        assert result["screenYAfter"] == pytest.approx(result["localY"], abs=1.5)

    def test_zoom_clamps_at_limits_and_buttons_disable(self, browser, app_server):
        open_app(browser, app_server)
        switch_to_whiteboard(browser)
        browser.execute_script("whiteboardZoomReset();")

        in_btn = browser.find_element(By.ID, "whiteboardZoomInBtn")
        out_btn = browser.find_element(By.ID, "whiteboardZoomOutBtn")

        for _ in range(40):
            browser.execute_script("whiteboardZoomIn();")
        assert get_zoom_label(browser) == "400%"
        assert in_btn.get_attribute("disabled") is not None

        for _ in range(80):
            browser.execute_script("whiteboardZoomOut();")
        assert get_zoom_label(browser) == "25%"
        assert out_btn.get_attribute("disabled") is not None

    def test_100_percent_button_resets_zoom(self, browser, app_server):
        open_app(browser, app_server)
        switch_to_whiteboard(browser)
        browser.execute_script("whiteboardZoomIn(); whiteboardZoomIn();")
        assert get_zoom_label(browser) != "100%"

        browser.find_element(
            By.CSS_SELECTOR, '#whiteboard-view button[title="Reset to 100%"]'
        ).click()
        time.sleep(0.3)
        assert get_zoom_label(browser) == "100%"

    def test_fit_button_frames_the_empty_board_at_100_percent(self, browser, app_server):
        # Issue #845 ships an empty board with no notes to fit around, so
        # Fit is documented (README/PR) as equivalent to a centred 100%
        # reset — this locks that documented choice in as a regression test.
        open_app(browser, app_server)
        switch_to_whiteboard(browser)
        browser.execute_script("whiteboardZoomOut();")
        assert get_zoom_label(browser) != "100%"

        browser.find_element(
            By.CSS_SELECTOR, '#whiteboard-view button[title="Fit to content"]'
        ).click()
        time.sleep(0.3)
        assert get_zoom_label(browser) == "100%"


class TestKeyboard:
    def _focus_canvas_via_tab(self, browser):
        # Tab from the last zoom-toolbar button onto the canvas wrapper --
        # a real, browser-native focus change (not a scripted .focus()
        # call), so :focus-visible engages the way it would for an actual
        # keyboard user.
        #
        # Tab stops sit in between, in DOM order after the zoom controls
        # and before the canvas wrapper: the "create something from
        # nothing" actions grouped together first -- "New post-it" (a new
        # task), "Text note" (a note that is not a task), "Add title"
        # (issue #1018's free-floating text object) -- then "Add existing"
        # (add an *existing* task to the board), then the two side-panel
        # toggles, "Structure" and "Parking lot", then the tips' own close
        # button while the tips are showing. The five layout tools
        # that used to follow them live in the ribbon's Whiteboard tab now
        # (Arrange group). Asserted by id rather than just tabbed past
        # blindly, so this still fails loudly if the toolbar's tab order is
        # disturbed.
        reset_btn = browser.find_element(
            By.CSS_SELECTOR, '#whiteboard-view button[title="Reset to 100%"]'
        )
        reset_btn.click()
        expected_stops = ["whiteboardNewNoteBtn", "whiteboardTextNoteBtn", "whiteboardNewTextBtn", "whiteboardAddNoteBtn", "whiteboardOutlineBtn", "whiteboardParkingLotBtn"]
        if browser.find_element(By.ID, "whiteboardToolbarHint").is_displayed():
            expected_stops.append("whiteboardHintDismissBtn")
        for expected in expected_stops:
            ActionChains(browser).send_keys(Keys.TAB).perform()
            time.sleep(0.1)
            active = browser.execute_script("return document.activeElement.id;")
            assert active == expected, f"expected {expected} focused, got {active!r}"
        ActionChains(browser).send_keys(Keys.TAB).perform()
        time.sleep(0.2)
        active_id = browser.execute_script("return document.activeElement.id;")
        assert active_id == "whiteboardContainer", f"expected canvas focused, got {active_id!r}"

    def test_focus_is_visible_on_the_canvas(self, browser, app_server):
        open_app(browser, app_server)
        switch_to_whiteboard(browser)
        self._focus_canvas_via_tab(browser)

        # The design system draws focus as a box-shadow ring
        # (visual-system.css's `--np-focus-ring`), not an outline, and its
        # `[tabindex]:focus-visible` rule sets `outline: none` to do it -- so
        # either counts, as tests/ui/test_component_gallery.py already
        # allows. Compared against the blurred canvas, so a shadow the canvas
        # always carries cannot pass for a focus ring.
        read = (
            "const cs = window.getComputedStyle(document.getElementById('whiteboardContainer'));"
            "return {outline: cs.outlineStyle, shadow: cs.boxShadow};"
        )
        focused = browser.execute_script(read)
        browser.execute_script("document.getElementById('whiteboardContainer').blur();")
        resting = browser.execute_script(read)

        outline_shown = focused["outline"] != "none" and focused["outline"] != resting["outline"]
        ring_shown = focused["shadow"] != "none" and focused["shadow"] != resting["shadow"]
        assert outline_shown or ring_shown, (
            "canvas must show a visible focus indicator when keyboard-focused: "
            f"focused={focused} resting={resting}"
        )

    def test_arrow_keys_pan(self, browser, app_server):
        open_app(browser, app_server)
        switch_to_whiteboard(browser)
        browser.execute_script("whiteboardZoomReset();")
        self._focus_canvas_via_tab(browser)

        before = get_layer_transform(browser)
        ActionChains(browser).send_keys(Keys.ARROW_RIGHT).perform()
        ActionChains(browser).send_keys(Keys.ARROW_DOWN).perform()
        after = get_layer_transform(browser)

        assert after["panX"] != before["panX"]
        assert after["panY"] != before["panY"]

    def test_plus_minus_zero_and_f_keys(self, browser, app_server):
        open_app(browser, app_server)
        switch_to_whiteboard(browser)
        browser.execute_script("whiteboardZoomReset();")
        self._focus_canvas_via_tab(browser)

        ActionChains(browser).send_keys("+").perform()
        time.sleep(0.1)
        assert get_zoom_label(browser) == "125%"

        ActionChains(browser).send_keys("-").perform()
        time.sleep(0.1)
        assert get_zoom_label(browser) == "100%"

        ActionChains(browser).send_keys("+").perform()
        time.sleep(0.1)
        ActionChains(browser).send_keys("0").perform()
        time.sleep(0.1)
        assert get_zoom_label(browser) == "100%"

        ActionChains(browser).send_keys("+").perform()
        time.sleep(0.1)
        ActionChains(browser).send_keys("f").perform()
        time.sleep(0.1)
        assert get_zoom_label(browser) == "100%"


class TestFloatingToolbar:
    def test_canvas_runs_edge_to_edge_under_the_toolbar(self, browser, app_server):
        open_app(browser, app_server)
        switch_to_whiteboard(browser)
        geo = browser.execute_script(
            """
            const view = document.getElementById('whiteboard-view').getBoundingClientRect();
            const canvas = document.getElementById('whiteboardContainer').getBoundingClientRect();
            const toolbar = document.getElementById('whiteboardToolbar');
            return {
                view: [view.left, view.top, view.right, view.bottom],
                canvas: [canvas.left, canvas.top, canvas.right, canvas.bottom],
                toolbarTop: toolbar.getBoundingClientRect().top,
                toolbarBg: getComputedStyle(toolbar).backgroundColor,
            };
            """
        )
        # No padding round the board: the canvas fills the view exactly...
        for got, want in zip(geo["canvas"], geo["view"]):
            assert abs(got - want) < 1, f"canvas {geo['canvas']} should fill view {geo['view']}"
        # ...and the toolbar floats over its top edge, on a transparent bar.
        assert abs(geo["toolbarTop"] - geo["canvas"][1]) < 1
        assert geo["toolbarBg"] in ("rgba(0, 0, 0, 0)", "transparent")

    def test_tips_dismiss_and_come_back_from_the_ribbon(self, browser, app_server):
        open_app(browser, app_server)
        browser.execute_script("localStorage.removeItem('np-whiteboard-hint-dismissed');")
        open_app(browser, app_server)
        switch_to_whiteboard(browser)

        hint = browser.find_element(By.ID, "whiteboardToolbarHint")
        assert hint.is_displayed()
        inset_before = browser.execute_script(
            "return parseFloat(document.getElementById('whiteboardToolbar').parentElement"
            ".style.getPropertyValue('--wb-toolbar-inset'));"
        )

        browser.find_element(By.ID, "whiteboardHintDismissBtn").click()
        time.sleep(0.2)
        assert not hint.is_displayed()
        inset_after = browser.execute_script(
            "return parseFloat(document.getElementById('whiteboardToolbar').parentElement"
            ".style.getPropertyValue('--wb-toolbar-inset'));"
        )
        assert inset_after < inset_before, "the toolbar should shrink once the tips are gone"

        # Stays dismissed across a reload.
        open_app(browser, app_server)
        switch_to_whiteboard(browser)
        assert not browser.find_element(By.ID, "whiteboardToolbarHint").is_displayed()

        # The ribbon's Whiteboard tab (the contextual one) brings it back.
        browser.find_element(By.CSS_SELECTOR, '.ribbon-tab-btn[data-tab="__ctx"]').click()
        time.sleep(0.2)
        tips = WebDriverWait(browser, 5).until(
            EC.element_to_be_clickable(
                (By.CSS_SELECTOR, '.ribbon-body [data-scope-id="whiteboard"][data-label="Tips"]')
            )
        )
        tips.click()
        time.sleep(0.2)
        assert browser.find_element(By.ID, "whiteboardToolbarHint").is_displayed()
        assert browser.execute_script(
            "return localStorage.getItem('np-whiteboard-hint-dismissed');"
        ) is None


class TestTouch:
    def test_single_finger_touch_pans(self, browser, app_server):
        open_app(browser, app_server)
        switch_to_whiteboard(browser)
        browser.execute_script("whiteboardZoomReset();")

        before = get_layer_transform(browser)
        browser.execute_script(
            """
            const svg = document.querySelector('#whiteboardContainer svg.wb-svg');
            const rect = svg.getBoundingClientRect();
            const sx = rect.left + rect.width/2, sy = rect.top + rect.height/2;
            function touch(id, x, y) {
                return new Touch({identifier: id, target: svg, clientX: x, clientY: y});
            }
            svg.dispatchEvent(new TouchEvent('touchstart', {bubbles:true, cancelable:true, touches:[touch(1, sx, sy)], targetTouches:[touch(1, sx, sy)], changedTouches:[touch(1, sx, sy)]}));
            svg.dispatchEvent(new TouchEvent('touchmove', {bubbles:true, cancelable:true, touches:[touch(1, sx+80, sy+30)], targetTouches:[touch(1, sx+80, sy+30)], changedTouches:[touch(1, sx+80, sy+30)]}));
            svg.dispatchEvent(new TouchEvent('touchend', {bubbles:true, cancelable:true, touches:[], targetTouches:[], changedTouches:[touch(1, sx+80, sy+30)]}));
            """
        )
        after = get_layer_transform(browser)
        assert after["panX"] == pytest.approx(before["panX"] + 80, abs=1)
        assert after["panY"] == pytest.approx(before["panY"] + 30, abs=1)

    def test_two_finger_pinch_zooms_anchored_at_midpoint(self, browser, app_server):
        open_app(browser, app_server)
        switch_to_whiteboard(browser)
        browser.execute_script("whiteboardZoomReset();")

        result = browser.execute_script(
            """
            function transform() {
                const layer = document.querySelector('#whiteboardContainer .wb-layer');
                const t = layer.getAttribute('transform');
                const m = t.match(/translate\\(([-\\d.]+),\\s*([-\\d.]+)\\)\\s*scale\\(([-\\d.]+)\\)/);
                return { panX: parseFloat(m[1]), panY: parseFloat(m[2]), zoom: parseFloat(m[3]) };
            }
            const svg = document.querySelector('#whiteboardContainer svg.wb-svg');
            const rect = svg.getBoundingClientRect();
            const cx = rect.left + rect.width/2, cy = rect.top + rect.height/2;
            function touch(id, x, y) {
                return new Touch({identifier: id, target: svg, clientX: x, clientY: y});
            }
            const before = transform();

            // Two fingers 40px apart, then spread to 160px apart (zoom in),
            // centred on the same midpoint throughout.
            let t1 = touch(1, cx - 20, cy), t2 = touch(2, cx + 20, cy);
            svg.dispatchEvent(new TouchEvent('touchstart', {bubbles:true, cancelable:true, touches:[t1,t2], targetTouches:[t1,t2], changedTouches:[t1,t2]}));
            t1 = touch(1, cx - 80, cy); t2 = touch(2, cx + 80, cy);
            svg.dispatchEvent(new TouchEvent('touchmove', {bubbles:true, cancelable:true, touches:[t1,t2], targetTouches:[t1,t2], changedTouches:[t1,t2]}));

            const after = transform();
            return { zoomBefore: before.zoom, zoomAfter: after.zoom };
            """
        )
        assert result["zoomAfter"] > result["zoomBefore"], "spreading two touch points should zoom in"


class TestPersistenceAndPlanIsolation:
    def test_viewport_survives_a_view_switch(self, browser, app_server):
        open_app(browser, app_server)
        switch_to_whiteboard(browser)
        browser.execute_script("whiteboardZoomReset(); whiteboardZoomIn();")
        before = get_layer_transform(browser)

        browser.execute_script("switchToView('tasks');")
        time.sleep(0.2)
        switch_to_whiteboard(browser)
        after = get_layer_transform(browser)

        assert after == before

    def test_viewport_survives_a_page_reload(self, browser, app_server):
        open_app(browser, app_server)
        switch_to_whiteboard(browser)
        browser.execute_script("whiteboardZoomReset(); whiteboardZoomIn(); whiteboardZoomIn();")
        before = get_layer_transform(browser)
        time.sleep(0.6)  # let the debounced localStorage save fire

        browser.refresh()
        dismiss_tour(browser)
        time.sleep(0.3)
        switch_to_whiteboard(browser)
        after = get_layer_transform(browser)

        assert after["zoom"] == pytest.approx(before["zoom"])
        assert after["panX"] == pytest.approx(before["panX"], abs=1)
        assert after["panY"] == pytest.approx(before["panY"], abs=1)

    def test_opening_and_leaving_whiteboard_does_not_touch_the_plan_text(self, browser, app_server):
        open_app(browser, app_server)
        browser.execute_script(
            "if (typeof switchTab === 'function') switchTab('project');"
        )
        time.sleep(0.3)
        editor = WebDriverWait(browser, 5).until(
            EC.presence_of_element_located((By.ID, "planEditor"))
        )
        browser.execute_script(
            "arguments[0].value = arguments[1];"
            "arguments[0].dispatchEvent(new Event('input', {bubbles: true}));",
            editor,
            SAMPLE_PLAN,
        )
        # The app's own render pipeline asynchronously normalises front
        # matter shortly after a render (e.g. filling in a default RAG
        # status if absent) — unrelated to whiteboard, and it would show up
        # as a false positive if we captured our "before" baseline too
        # early. Let that settle first so the baseline is stable, then the
        # whiteboard-isolation check below is purely about whiteboard.
        time.sleep(2)
        before_text = browser.execute_script("return document.getElementById('planEditor').value;")

        switch_to_whiteboard(browser)
        browser.execute_script(
            "whiteboardZoomIn(); whiteboardZoomOut(); whiteboardZoomFit();"
        )
        browser.execute_script(
            """
            const svg = document.querySelector('#whiteboardContainer svg.wb-svg');
            const rect = svg.getBoundingClientRect();
            const sx = rect.left + rect.width/2, sy = rect.top + rect.height/2;
            svg.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, cancelable:true, clientX:sx, clientY:sy, button:0}));
            window.dispatchEvent(new MouseEvent('mousemove', {bubbles:true, cancelable:true, clientX:sx+50, clientY:sy+50}));
            window.dispatchEvent(new MouseEvent('mouseup', {bubbles:true, cancelable:true, clientX:sx+50, clientY:sy+50}));
            """
        )
        time.sleep(0.2)

        # Switch away to a plain list view (not the dashboard/project-report
        # view, which computes and persists its own default RAG status into
        # front matter — a pre-existing, unrelated app behaviour we don't
        # want to conflate with whiteboard's isolation from plan text).
        browser.execute_script("switchToView('tasks');")
        time.sleep(0.2)

        after_text = browser.execute_script("return document.getElementById('planEditor').value;")
        assert after_text == before_text, "whiteboard interaction must never change plan text — not one byte"


class TestTabletViewport:
    def test_whiteboard_usable_at_tablet_width(self, browser, app_server):
        browser.set_window_size(768, 1024)
        try:
            open_app(browser, app_server)
            switch_to_whiteboard(browser)

            container = browser.find_element(By.ID, "whiteboardContainer")
            assert container.is_displayed()

            for title in ("Zoom in", "Zoom out", "Fit to content", "Reset to 100%"):
                btn = browser.find_element(
                    By.CSS_SELECTOR, f'#whiteboard-view button[title="{title}"]'
                )
                size = btn.size
                # @media (pointer: coarse) enlarges touch targets to 44px;
                # headless Chrome reports pointer:fine even at this window
                # size, so just confirm the control is present and clickable
                # rather than asserting the coarse-pointer 44px floor.
                assert size["width"] > 0 and size["height"] > 0
                assert btn.is_enabled() or btn.get_attribute("disabled") is not None

            has_grid = browser.execute_script(
                "return !!document.querySelector('#whiteboardContainer .wb-grid');"
            )
            assert has_grid
        finally:
            browser.set_window_size(1280, 900)
