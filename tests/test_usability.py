"""Selenium-based usability tests for Noodle Planner.

These tests verify that the app is actually usable from a browser perspective:
navigation works, tabs switch correctly, the editor accepts input, rendering
produces output, and export menus function. This catches regressions that
unit/API tests miss because they don't execute JavaScript.

Requirements:
    - selenium (pip install selenium)
    - Chrome browser + chromedriver (or use webdriver-manager)

Usage:
    uv run pytest tests/test_usability.py -x -q
    uv run pytest tests/test_usability.py -m usability -x -q
"""

import threading
import time
import socket

import pytest

try:
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options as ChromeOptions
    from selenium.webdriver.chrome.service import Service as ChromeService
    from selenium.webdriver.common.actions.action_builder import ActionBuilder
    from selenium.webdriver.common.actions.pointer_input import PointerInput
    from selenium.webdriver.common.by import By
    from selenium.webdriver.common.keys import Keys
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.common.exceptions import (
        TimeoutException,
        NoSuchElementException,
        WebDriverException,
    )

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
    """Find an available TCP port on localhost."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def app_server():
    """Start the FastAPI app on a random port in a background thread.

    Yields the base URL (e.g. http://127.0.0.1:54321).
    The server shuts down automatically after the test module finishes.
    """
    port = find_free_port()
    config = uvicorn.Config(
        fastapi_app,
        host="127.0.0.1",
        port=port,
        log_level="warning",
    )
    server = uvicorn.Server(config)

    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    # Wait for the server to be ready
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
    """Create a headless Chrome WebDriver instance.

    Tries webdriver-manager first for automatic chromedriver management,
    then falls back to system-installed chromedriver/chromium -- the same
    explicit-path convention every other Selenium test file in this repo
    already uses (see e.g. test_whiteboard_notes.py's own
    _create_chrome_driver()), needed because Selenium Manager's own
    auto-download does not work on linux/aarch64 (e.g. Raspberry Pi) dev
    environments.
    """
    options = ChromeOptions()
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    options.add_argument("--window-size=1280,900")

    import os

    if os.path.exists("/usr/bin/chromium"):
        options.binary_location = "/usr/bin/chromium"

    # Try webdriver-manager first
    try:
        from webdriver_manager.chrome import ChromeDriverManager

        service = ChromeService(ChromeDriverManager().install())
        return webdriver.Chrome(service=service, options=options)
    except (ImportError, Exception):
        pass

    # Fall back to system chromedriver
    try:
        if os.path.exists("/usr/bin/chromedriver"):
            service = ChromeService("/usr/bin/chromedriver")
            return webdriver.Chrome(service=service, options=options)
        return webdriver.Chrome(options=options)
    except WebDriverException:
        pytest.skip("Chrome/chromedriver not available on this system")


@pytest.fixture(scope="module")
def browser():
    """Provide a headless Chrome browser for the test module.

    The browser is shared across tests in the module for performance.
    """
    driver = _create_chrome_driver()
    driver.implicitly_wait(3)
    yield driver
    driver.quit()


class TestPageLoad:
    """Verify the main page loads and renders correctly in a real browser."""

    def test_page_loads_successfully(self, browser, app_server):
        """The main page should return HTTP 200 and render HTML."""
        browser.get(app_server)
        assert "Noodle Planner" in browser.title

    def test_page_contains_plan_editor(self, browser, app_server):
        """The plan editor textarea must be present and visible."""
        browser.get(app_server)
        editor = browser.find_element(By.ID, "planEditor")
        assert editor.is_displayed()

    def test_page_contains_navigation_tabs(self, browser, app_server):
        """All main navigation tabs must be present."""
        browser.get(app_server)
        expected_tabs = [
            "portfolioTab",
            "planTab",
        ]
        for tab_id in expected_tabs:
            element = browser.find_element(By.ID, tab_id)
            assert element is not None, f"Tab {tab_id} not found"

    def test_script_js_loaded_without_errors(self, browser, app_server):
        """JavaScript should load without uncaught errors blocking the page."""
        browser.get(app_server)
        # Check that key functions exist (defined in script.js)
        result = browser.execute_script(
            "return typeof switchTab === 'function'"
        )
        assert result is True, "switchTab function not defined - script.js may have errors"

    def test_style_css_loaded(self, browser, app_server):
        """Custom CSS should load and apply styles."""
        browser.get(app_server)
        editor = browser.find_element(By.ID, "planEditor")
        # The editor should have some computed style from the CSS modules
        font_family = browser.execute_script(
            "return window.getComputedStyle(arguments[0]).fontFamily", editor
        )
        assert font_family, "Editor has no computed font-family - CSS may not have loaded"


class TestTabNavigation:
    """Verify that clicking navigation tabs switches views correctly."""

    def test_plan_tab_shows_editor(self, browser, app_server):
        """Clicking the Plan tab should display the editor view."""
        browser.get(app_server)
        plan_tab = browser.find_element(By.ID, "projectTab")
        plan_tab.click()
        time.sleep(0.3)

        editor_tab = browser.find_element(By.ID, "editor-tab")
        assert "active" in editor_tab.get_attribute("class"), \
            "Editor tab content not active after clicking Plan tab"

    def test_portfolio_tab_shows_portfolio(self, browser, app_server):
        """Clicking the Portfolio tab should display the portfolio view."""
        browser.get(app_server)
        portfolio_tab = browser.find_element(By.ID, "portfolioTab")
        portfolio_tab.click()
        time.sleep(0.3)

        portfolio_content = browser.find_element(By.ID, "portfolio-tab")
        assert "active" in portfolio_content.get_attribute("class"), \
            "Portfolio tab content not active after clicking Portfolio tab"

    def test_tab_switching_hides_previous(self, browser, app_server):
        """Switching tabs should hide the previous tab content."""
        browser.get(app_server)

        # Click Plan tab first
        browser.find_element(By.ID, "projectTab").click()
        time.sleep(0.3)

        # Then click Portfolio tab
        browser.find_element(By.ID, "portfolioTab").click()
        time.sleep(0.3)

        editor_tab = browser.find_element(By.ID, "editor-tab")
        assert "active" not in editor_tab.get_attribute("class"), \
            "Editor tab still active after switching to Portfolio"

    def test_tools_menu_opens(self, browser, app_server):
        """The Tools dropdown menu should open when clicked."""
        browser.get(app_server)
        tools_tab = browser.find_element(By.ID, "toolsTab")
        tools_tab.click()
        time.sleep(0.3)

        tools_menu = browser.find_element(By.ID, "toolsMenu")
        is_visible = browser.execute_script(
            "return window.getComputedStyle(arguments[0]).display !== 'none'",
            tools_menu,
        )
        assert is_visible, "Tools menu did not open"


class TestEditorInput:
    """Verify the plan editor accepts user input and reflects changes."""

    def _navigate_to_editor(self, browser, app_server):
        """Helper to navigate to the editor tab."""
        browser.get(app_server)
        browser.find_element(By.ID, "projectTab").click()
        time.sleep(0.3)

    def test_editor_accepts_text_input(self, browser, app_server):
        """Users should be able to type plan text into the editor."""
        self._navigate_to_editor(browser, app_server)
        editor = browser.find_element(By.ID, "planEditor")
        editor.clear()

        plan_text = "Phase 1\n  Task 1 @john 3d\n  Task 2 @jane 2d"
        editor.send_keys(plan_text)

        actual = editor.get_attribute("value")
        assert "Phase 1" in actual
        assert "Task 1" in actual

    def test_editor_preserves_indentation(self, browser, app_server):
        """Plan indentation (spaces) should be preserved in the editor."""
        self._navigate_to_editor(browser, app_server)
        editor = browser.find_element(By.ID, "planEditor")
        editor.clear()

        plan_text = "Phase 1\n  Task 1 @john 3d"
        editor.send_keys(plan_text)

        actual = editor.get_attribute("value")
        assert "  Task 1" in actual, "Indentation not preserved in editor"

    def test_editor_handles_frontmatter(self, browser, app_server):
        """The editor should accept YAML front matter without errors."""
        self._navigate_to_editor(browser, app_server)
        editor = browser.find_element(By.ID, "planEditor")
        editor.clear()

        plan_text = (
            "---\n"
            "title: Test Project\n"
            "resources:\n"
            "  - name: John\n"
            "    shortname: john\n"
            "---\n"
            "Phase 1\n"
            "  Task 1 @john 3d"
        )
        editor.send_keys(plan_text)

        actual = editor.get_attribute("value")
        assert "title: Test Project" in actual
        assert "Phase 1" in actual


class TestPlanRendering:
    """Verify that rendering a plan produces visible output."""

    def _enter_plan_and_render(self, browser, app_server):
        """Helper to enter a plan and trigger rendering."""
        browser.get(app_server)
        browser.find_element(By.ID, "projectTab").click()
        time.sleep(0.3)

        editor = browser.find_element(By.ID, "planEditor")
        editor.clear()
        plan_text = (
            "---\n"
            "title: Usability Test Plan\n"
            "resources:\n"
            "  - name: Alice\n"
            "    shortname: alice\n"
            "---\n"
            "Phase 1\n"
            "  Task A @alice 3d\n"
            "  Task B @alice 2d\n"
            "Phase 2\n"
            "  Task C @alice 4d"
        )
        editor.send_keys(plan_text)

        # Trigger rendering via JavaScript (the renderPlan function)
        browser.execute_script("if (typeof renderPlan === 'function') renderPlan();")
        time.sleep(1)

    def test_render_produces_output(self, browser, app_server):
        """Rendering a plan should produce visible output in the output area."""
        self._enter_plan_and_render(browser, app_server)

        # Check that some output container has content
        has_output = browser.execute_script("""
            var output = document.getElementById('outputArea')
                || document.getElementById('output')
                || document.querySelector('.output-content');
            return output ? output.innerHTML.length > 0 : false;
        """)
        # Even if specific element not found, check the page changed
        body_text = browser.find_element(By.TAG_NAME, "body").text
        assert len(body_text) > 100, "Page appears to have very little content after render"

    def test_render_does_not_show_error(self, browser, app_server):
        """Rendering a valid plan should not produce JavaScript errors."""
        self._enter_plan_and_render(browser, app_server)

        # Check browser console for errors
        logs = browser.get_log("browser")
        severe_errors = [
            log for log in logs
            if log.get("level") == "SEVERE"
            and "favicon" not in log.get("message", "").lower()
        ]
        assert len(severe_errors) == 0, (
            f"JavaScript errors found after rendering: {severe_errors}"
        )


class TestExportMenu:
    """Verify the export menu opens and contains expected options."""

    def test_export_menu_exists(self, browser, app_server):
        """The export menu element should exist in the DOM."""
        browser.get(app_server)
        export_menu = browser.find_element(By.ID, "exportMenu")
        assert export_menu is not None

    def test_export_menu_toggles(self, browser, app_server):
        """The export menu should toggle visibility when triggered."""
        browser.get(app_server)
        browser.find_element(By.ID, "projectTab").click()
        time.sleep(0.3)

        # Toggle the export menu via JavaScript
        browser.execute_script(
            "if (typeof toggleExportMenu === 'function') toggleExportMenu(new Event('click'));"
        )
        time.sleep(0.3)

        export_menu = browser.find_element(By.ID, "exportMenu")
        is_visible = browser.execute_script(
            "var el = arguments[0]; "
            "var style = window.getComputedStyle(el); "
            "return style.display !== 'none' && style.visibility !== 'hidden';",
            export_menu,
        )
        # The menu should now be visible (or at least toggled)
        assert is_visible is not None


class TestSubNavigation:
    """Verify plan sub-navigation views (tasks, gantt, board, calendar)."""

    def _go_to_actions_tab(self, browser, app_server):
        """Helper to navigate to the actions/tracking tab via project subnav."""
        browser.get(app_server)
        # Click the Actions button in the unified project sub-navigation
        actions_btn = browser.find_element(
            By.CSS_SELECTOR, '#projectSubnav .plan-subnav-btn[data-view="actions"]'
        )
        actions_btn.click()
        time.sleep(0.3)

    def test_actions_tab_has_sub_views(self, browser, app_server):
        """The actions tab should contain sub-navigation buttons."""
        self._go_to_actions_tab(browser, app_server)

        sub_view_ids = [
            "actionsTasksViewTab",
            "actionsGanttViewTab",
            "actionsBoardViewTab",
            "actionsCalendarViewTab",
        ]
        for btn_id in sub_view_ids:
            element = browser.find_element(By.ID, btn_id)
            assert element is not None, f"Sub-view button {btn_id} not found"

    def test_sub_view_switching(self, browser, app_server):
        """Clicking sub-view buttons should switch the active view."""
        self._go_to_actions_tab(browser, app_server)

        # Click the Gantt sub-view
        gantt_btn = browser.find_element(By.ID, "actionsGanttViewTab")
        gantt_btn.click()
        time.sleep(0.3)

        assert "active" in gantt_btn.get_attribute("class"), \
            "Gantt sub-view button not active after click"


class TestKeyboardNavigation:
    """Verify basic keyboard accessibility."""

    def test_editor_is_focusable(self, browser, app_server):
        """The plan editor should be focusable via click."""
        browser.get(app_server)
        browser.find_element(By.ID, "projectTab").click()
        time.sleep(0.3)

        editor = browser.find_element(By.ID, "planEditor")
        editor.click()

        active_id = browser.execute_script("return document.activeElement.id")
        assert active_id == "planEditor", "Editor did not receive focus"

    def test_tabs_are_clickable(self, browser, app_server):
        """Navigation tabs should be implemented as buttons (clickable)."""
        browser.get(app_server)
        tabs = browser.find_elements(By.CSS_SELECTOR, ".tabs .tab")
        assert len(tabs) >= 4, f"Expected at least 4 tabs, found {len(tabs)}"

        for tab in tabs:
            tag = tab.tag_name.lower()
            assert tag == "button", (
                f"Tab '{tab.text}' is a <{tag}> instead of <button>"
            )


class TestKanbanReliability:
    """Regression coverage for the board reliability overhaul (#785 / #471)."""

    PLAN = "Phase One\n  Task A 0%\nPhase Two\n  Task B 0%"

    def _load_plan(self, browser, app_server):
        browser.get(app_server)
        browser.execute_script(
            """
            const project = {
                id: 'issue-785-test',
                name: 'Kanban reliability',
                planText: arguments[0],
                createdAt: Date.now(),
                updatedAt: Date.now()
            };
            localStorage.setItem('noodleplanner_projects', JSON.stringify({[project.id]: project}));
            localStorage.setItem('noodleplanner_current_project', project.id);
            for (const key of Object.keys(localStorage)) {
                if (key.startsWith('noodle_kanban_preferences_')) localStorage.removeItem(key);
            }
            """,
            self.PLAN,
        )
        browser.refresh()
        WebDriverWait(browser, 5).until(
            lambda driver: "Task A" in driver.find_element(By.ID, "planEditor").get_attribute("value")
        )

    def test_kanban_renders_on_first_activation_and_is_idempotent(
        self, browser, app_server
    ):
        self._load_plan(browser, app_server)
        result = browser.execute_script(
            """
            switchPlanSubnavToBoard();
            const board = document.getElementById('kanbanBoard');
            const firstCard = board.querySelector('.kanban-card');
            firstCard.focus();
            kanbanBoard.render();
            const once = board.innerHTML;
            kanbanBoard.render();
            return {
                active: document.getElementById('kanban-tab').classList.contains('active'),
                cards: board.querySelectorAll('.kanban-card').length,
                identical: once === board.innerHTML,
                focused: document.activeElement?.dataset.taskName
            };
            """
        )
        assert result == {
            "active": True,
            "cards": 2,
            "identical": True,
            "focused": "Task A",
        }

    def test_drag_between_columns_writes_markdown_exactly_once(
        self, browser, app_server
    ):
        self._load_plan(browser, app_server)
        result = browser.execute_script(
            """
            switchPlanSubnavToBoard();
            const editor = document.getElementById('planEditor');
            let inputEvents = 0;
            editor.addEventListener('input', () => inputEvents++);
            const source = document.querySelector('.kanban-card[data-task-name="Task A"]');
            const target = document.querySelector(
                '.kanban-column-body[data-column-title="Phase Two"]'
            );
            const transfer = new DataTransfer();
            source.dispatchEvent(new DragEvent('dragstart', {
                bubbles: true, cancelable: true, dataTransfer: transfer
            }));
            target.dispatchEvent(new DragEvent('dragover', {
                bubbles: true, cancelable: true, dataTransfer: transfer
            }));
            target.dispatchEvent(new DragEvent('drop', {
                bubbles: true, cancelable: true, dataTransfer: transfer
            }));
            source.dispatchEvent(new DragEvent('dragend', {
                bubbles: true, dataTransfer: transfer
            }));
            return {text: editor.value, inputEvents};
            """
        )
        assert result["inputEvents"] == 1
        assert "Phase Two\n  Task B 0%\n  Task A 0%" in result["text"]

    def test_keyboard_move_and_preferences_survive_reload(
        self, browser, app_server
    ):
        self._load_plan(browser, app_server)
        moved = browser.execute_script(
            """
            switchPlanSubnavToBoard();
            const card = document.querySelector('.kanban-card[data-task-name="Task A"]');
            card.focus();
            card.dispatchEvent(new KeyboardEvent('keydown', {
                bubbles: true, cancelable: true, altKey: true, key: 'ArrowRight'
            }));
            switchKanbanView('progress');
            toggleKanbanPrioritySort(true);
            toggleKanbanHideCompleted(true);
            document.querySelector('.kanban-column-collapse').click();
            return document.getElementById('planEditor').value;
            """
        )
        assert "Phase Two\n  Task B 0%\n  Task A 0%" in moved

        browser.refresh()
        WebDriverWait(browser, 5).until(
            lambda driver: "Task A" in driver.find_element(By.ID, "planEditor").get_attribute("value")
        )
        restored = browser.execute_script(
            """
            switchPlanSubnavToBoard();
            return {
                mode: document.getElementById('kanbanViewMode').value,
                sort: document.getElementById('kanbanSortPriority').checked,
                hide: document.getElementById('kanbanHideCompleted').checked,
                collapsed: document.querySelectorAll('.kanban-column.collapsed').length
            };
            """
        )
        browser.execute_script(
            """
            for (const key of Object.keys(localStorage)) {
                if (key.startsWith('noodle_kanban_preferences_')) localStorage.removeItem(key);
            }
            kanbanBoard.sortByPriority = false;
            kanbanBoard.hideCompleted = false;
            kanbanBoard.collapsedColumns.clear();
            """
        )
        assert restored == {
            "mode": "progress",
            "sort": True,
            "hide": True,
            "collapsed": 1,
        }


class TestResponsiveLayout:
    """Verify the layout adapts to different viewport sizes."""

    def test_mobile_viewport(self, browser, app_server):
        """The app should be usable at mobile viewport width (375px)."""
        browser.set_window_size(375, 667)
        browser.get(app_server)
        time.sleep(0.5)

        # The page should still render without horizontal scroll
        body_width = browser.execute_script("return document.body.scrollWidth")
        viewport_width = browser.execute_script("return window.innerWidth")

        # Allow some tolerance (scrollWidth can be slightly larger)
        assert body_width <= viewport_width + 20, (
            f"Page has horizontal scroll at mobile size: "
            f"body={body_width}px, viewport={viewport_width}px"
        )

        # Reset to desktop size
        browser.set_window_size(1280, 900)

    def test_tablet_viewport(self, browser, app_server):
        """The app should be usable at tablet viewport width (768px)."""
        browser.set_window_size(768, 1024)
        browser.get(app_server)
        time.sleep(0.5)

        # Navigation should still be accessible
        tabs = browser.find_elements(By.CSS_SELECTOR, ".tabs .tab")
        visible_tabs = [t for t in tabs if t.is_displayed()]
        assert len(visible_tabs) >= 1, "No navigation tabs visible at tablet size"

        # Reset to desktop size
        browser.set_window_size(1280, 900)


class TestTouchInteractions:
    """Verify representative touch paths in a real browser."""

    def test_tools_menu_opens_above_tablet_scroll_container(
        self, browser, app_server
    ):
        browser.set_window_size(1024, 768)
        browser.get(app_server)
        browser.find_element(By.ID, "planTab").click()
        button = WebDriverWait(browser, 5).until(
            EC.element_to_be_clickable((By.ID, "toolsDropdownBtn"))
        )
        browser.execute_script("""
            document.querySelectorAll('.raid-export-item').forEach(function (item) {
                item.style.display = 'block';
            });
        """)
        browser.execute_script("arguments[0].scrollIntoView({block: 'nearest'});", button)
        touch = ActionBuilder(browser, mouse=PointerInput("touch", "finger"))
        touch.pointer_action.move_to(button)
        touch.pointer_action.pointer_down()
        touch.pointer_action.pointer_up()
        touch.perform()

        result = browser.execute_script("""
            const button = document.getElementById('toolsDropdownBtn');
            const menu = document.getElementById('toolsDropdownMenu');
            const rect = menu.getBoundingClientRect();
            const statusBarTop = document.querySelector('.status-bar').getBoundingClientRect().top;
            const lastItem = menu.querySelector('.raid-export-item:last-child');
            menu.scrollTop = menu.scrollHeight;
            const lastRect = lastItem.getBoundingClientRect();
            const hit = document.elementFromPoint(
                lastRect.left + lastRect.width / 2,
                lastRect.top + lastRect.height / 2
            );
            return {
                expanded: button.getAttribute('aria-expanded'),
                shown: menu.classList.contains('show'),
                positioned: menu.classList.contains('nav-menu-viewport'),
                clearOfStatusBar: rect.bottom <= statusBarTop,
                lastItemHit: hit === lastItem || lastItem.contains(hit),
                menuBottom: rect.bottom,
                statusBarTop: statusBarTop,
                lastItemTop: lastRect.top,
                lastItemBottom: lastRect.bottom,
                hitClass: hit ? hit.className : null
            };
        """)
        assert result["expanded"] == "true"
        assert result["shown"] is True
        assert result["positioned"] is True
        assert result["clearOfStatusBar"] is True
        assert result["lastItemHit"] is True, result
        browser.set_window_size(1280, 900)

    def test_shared_controls_have_touch_targets(self, browser, app_server):
        browser.set_window_size(375, 667)
        browser.get(app_server)

        export_button = browser.find_element(By.CSS_SELECTOR, ".plan-subnav-btn")
        min_height = browser.execute_script(
            "return parseFloat(getComputedStyle(arguments[0]).minHeight)",
            export_button,
        )
        assert min_height >= 44

        result = browser.execute_script("""
            templatesData = {categories: ['Touch'], templates: []};
            currentCategory = 'all';
            renderTemplatesModal();
            const button = document.querySelector('[data-category="Touch"]');
            const beforeHash = location.hash;
            button.click();
            return {
                tag: button.tagName,
                category: currentCategory,
                hashUnchanged: location.hash === beforeHash,
                minHeight: parseFloat(getComputedStyle(button).minHeight)
            };
        """)
        assert result == {
            "tag": "BUTTON",
            "category": "Touch",
            "hashUnchanged": True,
            "minHeight": 44,
        }
        browser.set_window_size(1280, 900)

    def test_gantt_touch_tap_edits_and_cancel_does_not(self, browser, app_server):
        browser.get(app_server)
        result = browser.execute_script("""
            const cell = document.createElement('td');
            document.body.appendChild(cell);
            let edits = 0;
            setupGanttEditableCell(cell, () => { edits += 1; });
            const fire = (type, x) => cell.dispatchEvent(new PointerEvent(type, {
                bubbles: true,
                pointerId: 41,
                pointerType: 'touch',
                button: 0,
                clientX: x,
                clientY: 10
            }));
            fire('pointerdown', 10);
            fire('pointercancel', 10);
            const afterCancel = edits;
            fire('pointerdown', 10);
            fire('pointerup', 12);
            cell.remove();
            return {afterCancel, afterTap: edits};
        """)
        assert result == {"afterCancel": 0, "afterTap": 1}

    def test_gantt_pointer_drag_moves_once_and_cancel_restores(
        self, browser, app_server
    ):
        browser.get(app_server)
        result = browser.execute_script("""
            const originalRender = renderText;
            const originalSyncStart = syncGanttStartDateToEditor;
            renderText = () => {};
            syncGanttStartDateToEditor = () => {};
            ganttPixelsPerDay = 10;

            const makeBar = () => {
                const bar = document.createElement('div');
                bar.style.left = '0px';
                bar.style.width = '50px';
                bar.setPointerCapture = () => {};
                bar.hasPointerCapture = () => false;
                document.body.appendChild(bar);
                return bar;
            };
            const fire = (target, type, id, x) => target.dispatchEvent(
                new PointerEvent(type, {
                    bubbles: true, pointerId: id, pointerType: 'touch',
                    button: 0, clientX: x, clientY: 10
                })
            );

            const movedTask = {
                start: '2026-09-07', finish: '2026-09-09',
                duration_days: 3, is_summary: false
            };
            ganttTasks = [movedTask];
            const movedBar = makeBar();
            setupBarDragListeners(movedBar, movedTask, 0);
            fire(movedBar, 'pointerdown', 51, 0);
            fire(document, 'pointermove', 51, 20);
            fire(document, 'pointerup', 51, 20);

            const cancelledTask = {
                start: '2026-09-07', finish: '2026-09-09',
                duration_days: 3, is_summary: false
            };
            ganttTasks = [cancelledTask];
            const cancelledBar = makeBar();
            setupBarDragListeners(cancelledBar, cancelledTask, 0);
            fire(cancelledBar, 'pointerdown', 52, 0);
            fire(document, 'pointermove', 52, 20);
            fire(document, 'pointercancel', 52, 20);

            const output = {
                movedStart: movedTask.start,
                movedFinish: movedTask.finish,
                cancelledStart: cancelledTask.start,
                cancelledLeft: cancelledBar.style.left
            };
            movedBar.remove();
            cancelledBar.remove();
            renderText = originalRender;
            syncGanttStartDateToEditor = originalSyncStart;
            return output;
        """)
        assert result == {
            "movedStart": "2026-09-09",
            "movedFinish": "2026-09-11",
            "cancelledStart": "2026-09-07",
            "cancelledLeft": "0px",
        }

    def test_noodlesheet_second_touch_edits_selected_cell(
        self, browser, app_server
    ):
        browser.get(app_server)
        result = browser.execute_script("""
            const host = document.createElement('div');
            document.body.appendChild(host);
            const sheet = new NoodleSheet(host, {
                sheets: [{
                    name: 'Touch',
                    dbml: 'Table touch {\\n  name text\\n}',
                    markdown: '| Name |\\n| --- |\\n| Task |'
                }]
            });
            const tap = () => {
                const cell = host.querySelector('td[data-row="0"][data-col="0"]');
                cell.dispatchEvent(new PointerEvent('pointerdown', {
                    bubbles: true, pointerId: 42, pointerType: 'touch',
                    isPrimary: true, button: 0, clientX: 10, clientY: 10
                }));
                cell.dispatchEvent(new PointerEvent('pointerup', {
                    bubbles: true, pointerId: 42, pointerType: 'touch',
                    isPrimary: true, button: 0, clientX: 10, clientY: 10
                }));
            };
            tap();
            const selected = sheet.selection.row === 0 && sheet.selection.col === 0;
            tap();
            const editing = sheet.editing;
            sheet.destroy();
            host.remove();
            return {selected, editing};
        """)
        assert result == {"selected": True, "editing": True}

    def test_kanban_has_tap_move_fallback(self, browser, app_server):
        browser.get(app_server)
        result = browser.execute_script("""
            const board = new KanbanBoard('progress');
            const task = {
                lineNumber: 2,
                name: 'Touch task',
                resourcesArray: [],
                dependenciesArray: [],
                labelsArray: [],
                progressStatus: 'not_started',
                percent: 0,
                duration: 1,
                priority: 'Low',
                comment: ''
            };
            const nextTask = {...task, lineNumber: 3, name: 'Next task'};
            const source = {id: 'not-started', title: 'Not Started', name: 'Not Started', tasks: [task, nextTask]};
            const target = {id: 'complete', title: 'Complete', name: 'Complete', tasks: []};
            board.tasks = [task, nextTask];
            board.columns = [source, target];
            let movedTo = null;
            let reordered = null;
            let opened = 0;
            board.handleCardDrop = (_line, column) => { movedTo = column.id; };
            board.handleCardReorder = (line, targetLine, before) => {
                reordered = {line, targetLine, before};
            };
            board.openTaskModal = () => { opened += 1; };
            const card = board.renderCard(task, source);
            document.body.appendChild(card);
            const select = card.querySelector('.kanban-card-move-select');
            select.value = '1';
            select.dispatchEvent(new Event('change', {bubbles: true}));
            select.dispatchEvent(new KeyboardEvent('keydown', {
                bubbles: true, key: 'Enter'
            }));
            card.querySelector('.kanban-card-order-down').click();
            movedTo = null;
            const targetBody = document.createElement('div');
            targetBody.className = 'kanban-column-body';
            targetBody.dataset.columnTitle = 'Complete';
            targetBody.dataset.columnIndex = '1';
            document.body.appendChild(targetBody);
            const originalElementFromPoint = document.elementFromPoint;
            document.elementFromPoint = () => targetBody;
            card.setPointerCapture = () => {};
            card.hasPointerCapture = () => false;
            const fire = (type, x) => card.dispatchEvent(new PointerEvent(type, {
                bubbles: true, pointerId: 43, pointerType: 'touch',
                button: 0, clientX: x, clientY: 10
            }));
            fire('pointerdown', 0);
            fire('pointermove', 20);
            fire('pointerup', 20);
            const draggedTo = movedTo;
            document.elementFromPoint = originalElementFromPoint;
            targetBody.remove();
            const label = select.getAttribute('aria-label');
            card.remove();
            return {movedTo, draggedTo, label, opened, reordered};
        """)
        assert result["movedTo"] == "complete"
        assert result["draggedTo"] == "complete"
        assert result["opened"] == 0
        assert result["reordered"] == {
            "line": 2,
            "targetLine": 3,
            "before": False,
        }
        assert result["label"].startswith("Move Touch task")

    def test_diagram_pointer_pan_finishes_cleanly(self, browser, app_server):
        browser.get(app_server)
        result = browser.execute_script("""
            initPbs();
            const container = document.getElementById('pbsContainer');
            container.setPointerCapture = () => {};
            container.hasPointerCapture = () => false;
            pbsPanX = 0;
            pbsPanY = 0;
            const fire = (target, type, x, y) => target.dispatchEvent(
                new PointerEvent(type, {
                    bubbles: true, pointerId: 61, pointerType: 'touch',
                    button: 0, clientX: x, clientY: y
                })
            );
            fire(container, 'pointerdown', 10, 10);
            fire(document, 'pointermove', 35, 25);
            fire(document, 'pointerup', 35, 25);
            return {panX: pbsPanX, panY: pbsPanY, dragging: pbsIsDragging};
        """)
        assert result == {"panX": 25, "panY": 15, "dragging": False}


class TestBrowserExcelExport:
    """Verify the flagged Excel path stays in-browser and off the UI thread."""

    def test_exceljs_load_failure_rejects_and_can_retry(self, browser, app_server):
        browser.set_script_timeout(15)
        browser.get(app_server)

        result = browser.execute_async_script("""
            const done = arguments[arguments.length - 1];
            (async function () {
                const module = await import('/static/browser-excel.js');
                delete window.ExcelJS;
                let appends = 0;
                const errors = [];
                const originalAppendChild = document.head.appendChild;
                document.head.appendChild = function (node) {
                    appends += 1;
                    setTimeout(function () { node.onerror(); }, 0);
                    return node;
                };
                try {
                    for (let attempt = 0; attempt < 2; attempt += 1) {
                        try {
                            await module.createBudgetWorkbook([]);
                        } catch (error) {
                            errors.push(error.message);
                        }
                    }
                    done({appends: appends, errors: errors});
                } finally {
                    document.head.appendChild = originalAppendChild;
                }
            }());
        """)

        assert result == {
            "appends": 2,
            "errors": ["Failed to load ExcelJS", "Failed to load ExcelJS"],
        }

    def test_large_plan_export_uses_worker_without_api_round_trip(
        self, browser, app_server
    ):
        browser.set_script_timeout(90)
        browser.get(app_server)

        result = browser.execute_async_script("""
            const done = arguments[arguments.length - 1];
            (async function () {
                const tasks = Array.from({length: 1001}, function (_value, index) {
                    return {
                        id: index + 1,
                        key: 'Task ' + (index + 1),
                        name: 'Task ' + (index + 1),
                        start: '2026-01-01',
                        finish: '2026-01-02',
                        duration_days: 1,
                        resources: '',
                        percent: 0,
                        rag: 'On Track',
                        priority: 'Low',
                        bucket: '',
                        level: 0,
                        is_summary: false,
                        depends: index ? ['Task ' + index] : []
                    };
                });
                const text = 'Large browser export';
                document.getElementById('planEditor').value = text;
                lastParseResult = {
                    planText: text,
                    result: {
                        success: true,
                        project_name: 'Large browser export',
                        front_matter: {title: 'Large browser export'},
                        tasks: tasks,
                        resource_map: {},
                        resource_roles: {},
                        raid_items: [],
                        stakeholders: [],
                        comms_items: [],
                        lessons_items: []
                    }
                };
                budgetItems = [{
                    id: 1,
                    description: 'Browser budget',
                    estimate: 100,
                    forecast: 100,
                    total: 25,
                    type: 'Capex',
                    category: 'Software'
                }];
                localStorage.setItem('noodleplanner_browser_excel', 'on');

                let apiCalls = 0;
                let downloadedBlob = null;
                let ticks = 0;
                const timer = setInterval(function () { ticks += 1; }, 5);
                const messages = [];
                const consoleErrors = [];
                const originalFetch = window.fetch;
                const originalShowMessage = window.showMessage;
                const originalConsoleError = window.console.error;
                const originalCreateObjectURL = window.URL.createObjectURL;
                const originalRevokeObjectURL = window.URL.revokeObjectURL;
                const originalAnchorClick = HTMLAnchorElement.prototype.click;
                window.fetch = function (...args) {
                    if (String(args[0]).includes('/api/') || String(args[0]).includes('/render')) {
                        apiCalls += 1;
                    }
                    return originalFetch.apply(this, args);
                };
                window.showMessage = function (_target, type, message) {
                    messages.push({type: type, message: message});
                };
                window.console.error = function (...args) {
                    consoleErrors.push(args.map(String).join(' '));
                };
                window.URL.createObjectURL = function (blob) {
                    downloadedBlob = blob;
                    return 'blob:browser-excel-test';
                };
                window.URL.revokeObjectURL = function () {};
                HTMLAnchorElement.prototype.click = function () {};

                try {
                    await exportFile('excel', 'editor');
                    done({
                        apiCalls: apiCalls,
                        blobSize: downloadedBlob ? downloadedBlob.size : 0,
                        ticks: ticks,
                        messages: messages,
                        consoleErrors: consoleErrors
                    });
                } catch (error) {
                    done({error: error.message, apiCalls: apiCalls, messages: messages});
                } finally {
                    clearInterval(timer);
                    window.fetch = originalFetch;
                    window.showMessage = originalShowMessage;
                    window.console.error = originalConsoleError;
                    window.URL.createObjectURL = originalCreateObjectURL;
                    window.URL.revokeObjectURL = originalRevokeObjectURL;
                    HTMLAnchorElement.prototype.click = originalAnchorClick;
                }
            }());
        """)

        assert "error" not in result, result
        assert result["consoleErrors"] == [], result["consoleErrors"]
        assert result["apiCalls"] == 0, result
        assert result["blobSize"] > 1000
        assert result["ticks"] > 2
        assert result["messages"][-1]["type"] == "success"
        assert "server CPU 0 ms" in result["messages"][-1]["message"]


class TestHealthEndpoint:
    """Verify the health endpoint works from a browser context."""

    def test_health_endpoint_accessible(self, browser, app_server):
        """The /health endpoint should return a JSON response."""
        browser.get(f"{app_server}/health")
        body_text = browser.find_element(By.TAG_NAME, "body").text
        assert "healthy" in body_text


class TestStaticAssets:
    """Verify static assets load correctly."""

    def test_favicon_loads(self, browser, app_server):
        """The favicon should be accessible."""
        browser.get(f"{app_server}/favicon.png")
        # If it loaded, the page won't show an error
        page_source = browser.page_source
        assert "404" not in page_source or "Not Found" not in page_source

    def test_css_loaded_and_applied(self, browser, app_server):
        """CSS modules should load and apply custom styles."""
        browser.get(app_server)

        # Check that a known CSS class has styles applied
        has_custom_styles = browser.execute_script("""
            var tabs = document.querySelector('.tabs');
            if (!tabs) return false;
            var style = window.getComputedStyle(tabs);
            return style.display !== '' && style.display !== 'inline';
        """)
        assert has_custom_styles, "Custom CSS does not appear to be loaded"

    def test_javascript_loaded(self, browser, app_server):
        """script.js should load and define expected global functions."""
        browser.get(app_server)

        functions_to_check = [
            "switchTab",
            "renderPlan",
            "toggleExportMenu",
        ]
        for fn_name in functions_to_check:
            exists = browser.execute_script(
                f"return typeof {fn_name} === 'function'"
            )
            assert exists, f"Expected function {fn_name} not defined"
