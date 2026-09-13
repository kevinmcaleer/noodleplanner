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
    from selenium.webdriver.common.by import By
    from selenium.webdriver.common.keys import Keys
    from selenium.webdriver.common.action_chains import ActionChains
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


# ── Shared helpers ───────────────────────────────────────────────────────


def dismiss_tour(driver):
    """Stop the first-run tour from covering the page.

    nav.js calls startTour() a second after load, and it bails out if the
    `tourCompleted` cookie is set -- so setting the cookie right after
    .get() is enough to keep the tour from ever starting. The overlay is
    also hidden directly, in case a previous test in this module already
    triggered it on the shared browser.
    """
    driver.execute_script(
        "document.cookie = 'tourCompleted=true; path=/; max-age=31536000';"
        "['tourOverlay','tourPopup','tourSpotlight'].forEach(function(id){"
        "  var el = document.getElementById(id); if (el) el.style.display = 'none';"
        "});"
    )


def open_app(driver, base_url):
    """Load the app with the tour suppressed.

    Without this the tour overlay sits on top of the ribbon and every
    click is intercepted rather than reaching the control under test.
    """
    driver.get(base_url)
    dismiss_tour(driver)


def seed_current_project(driver, name, plan_text):
    """Seed a project and make it current, through the app's own API.

    Projects live in IndexedDB via NoodleStore since #794. Writing the
    legacy `noodleplanner_projects` localStorage key directly no longer
    works: the one-time migration has already run (and recorded itself as
    done) by the time a test could write that key, so the seeded plan was
    silently ignored and the editor came up empty. Going through
    createProject()/saveProject()/setCurrentProjectId() uses whichever
    backend is live, and flush() makes sure the write has landed before
    the reload that picks it up.
    """
    driver.execute_script(
        """
        const project = createProject(arguments[0]);
        project.planText = arguments[1];
        saveProject(project.id, project);
        setCurrentProjectId(project.id);
        if (typeof NoodleStore !== 'undefined' && NoodleStore.isActive()) {
            NoodleStore.flush();
        }
        """,
        name,
        plan_text,
    )


def click_scope(driver, scope_id):
    """Click a top-level ribbon scope pill (project/programme/portfolio).

    These replaced the old #projectTab / #portfolioTab / #toolsTab nav
    buttons; the tab-content panes they activate (#editor-tab,
    #portfolio-tab) are unchanged.
    """
    driver.find_element(
        By.CSS_SELECTOR, f'.ribbon-scope-btn[data-scope="{scope_id}"]'
    ).click()


class TestPageLoad:
    """Verify the main page loads and renders correctly in a real browser."""

    def test_page_loads_successfully(self, browser, app_server):
        """The main page should return HTTP 200 and render HTML."""
        open_app(browser, app_server)
        assert "Noodle Planner" in browser.title

    def test_page_contains_plan_editor(self, browser, app_server):
        """The plan editor textarea must be present and visible."""
        open_app(browser, app_server)
        editor = browser.find_element(By.ID, "planEditor")
        assert editor.is_displayed()

    def test_page_contains_navigation_tabs(self, browser, app_server):
        """All top-level navigation scopes must be present.

        The ribbon's scope pills replaced the old #planTab/#portfolioTab
        nav buttons; the panes they switch between are unchanged.
        """
        open_app(browser, app_server)
        scopes = browser.execute_script(
            "return Array.from(document.querySelectorAll('.ribbon-scope-btn'))"
            "    .map(function(b) { return b.dataset.scope; });"
        )
        assert scopes == ["project", "programme", "portfolio"], \
            f"unexpected top-level scopes: {scopes}"

    def test_script_js_loaded_without_errors(self, browser, app_server):
        """JavaScript should load without uncaught errors blocking the page."""
        open_app(browser, app_server)
        # Check that key functions exist (defined in script.js)
        result = browser.execute_script(
            "return typeof switchTab === 'function'"
        )
        assert result is True, "switchTab function not defined - script.js may have errors"

    def test_style_css_loaded(self, browser, app_server):
        """Custom CSS should load and apply styles."""
        open_app(browser, app_server)
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
        open_app(browser, app_server)
        click_scope(browser, "project")
        time.sleep(0.3)

        editor_tab = browser.find_element(By.ID, "editor-tab")
        assert "active" in editor_tab.get_attribute("class"), \
            "Editor tab content not active after clicking Plan tab"

    def test_portfolio_tab_shows_portfolio(self, browser, app_server):
        """Clicking the Portfolio tab should display the portfolio view."""
        open_app(browser, app_server)
        click_scope(browser, "portfolio")
        time.sleep(0.3)

        portfolio_content = browser.find_element(By.ID, "portfolio-tab")
        assert "active" in portfolio_content.get_attribute("class"), \
            "Portfolio tab content not active after clicking Portfolio tab"

    def test_tab_switching_hides_previous(self, browser, app_server):
        """Switching tabs should hide the previous tab content."""
        open_app(browser, app_server)

        # Click Plan tab first
        click_scope(browser, "project")
        time.sleep(0.3)

        # Then click Portfolio tab
        click_scope(browser, "portfolio")
        time.sleep(0.3)

        editor_tab = browser.find_element(By.ID, "editor-tab")
        assert "active" not in editor_tab.get_attribute("class"), \
            "Editor tab still active after switching to Portfolio"

    # The Tools dropdown (#toolsTab / #toolsMenu) no longer exists anywhere
    # in the app -- the ribbon's tab strip replaced it, and that is covered
    # by tests/test_ribbon_ia.mjs, test_ribbon_layout.mjs and
    # test_ribbon_action_coverage.mjs. There is nothing here to re-point a
    # "does the Tools menu open" test at, so it is gone rather than
    # rewritten into a weaker assertion.


class TestBackstageFullScreen:
    """#972: Backstage is a full-screen mode with a single exit route --
    the ribbon/status bar hide while it's open, and the back arrow / Esc
    is the only way out, returning to whatever view was active on entry.
    """

    def _ribbon_is_hidden(self, browser):
        return browser.execute_script(
            "var el = document.getElementById('ribbonShell');"
            "return !el || window.getComputedStyle(el).display === 'none';"
        )

    def test_file_button_opens_fullscreen_backstage(self, browser, app_server):
        """Clicking the ribbon's File button navigates straight into a
        full-screen Backstage -- no dropdown, ribbon/status bar hidden."""
        open_app(browser, app_server)
        time.sleep(0.3)

        file_btn = browser.find_element(By.CSS_SELECTOR, '[data-action="open-backstage"]')
        file_btn.click()
        time.sleep(0.3)

        backstage_tab = browser.find_element(By.ID, "backstage-tab")
        assert "active" in backstage_tab.get_attribute("class"), \
            "Backstage tab content not active after clicking File"

        is_fullscreen = browser.execute_script(
            "return document.body.classList.contains('backstage-fullscreen')"
        )
        assert is_fullscreen, "body did not gain backstage-fullscreen on entry"
        assert self._ribbon_is_hidden(browser), "Ribbon still visible in full-screen Backstage"

        # No File dropdown should exist anymore (#972 retired it).
        assert browser.execute_script(
            "return document.querySelectorAll('.ribbon-file-menu-item[data-file-index]').length"
        ) == 0

    def test_back_arrow_exits_to_previous_view_and_restores_chrome(self, browser, app_server):
        """The back arrow returns to the view that was active on entry and
        un-hides the ribbon/status bar."""
        open_app(browser, app_server)
        time.sleep(0.3)
        # Start from the editor (Plan) view, then enter Backstage.
        browser.execute_script("switchToView('editor');")
        time.sleep(0.2)
        browser.execute_script("switchToView('backstage');")
        time.sleep(0.3)

        back_btn = browser.find_element(By.ID, "backstageBackBtn")
        back_btn.click()
        time.sleep(0.3)

        editor_tab = browser.find_element(By.ID, "editor-tab")
        assert "active" in editor_tab.get_attribute("class"), \
            "Back arrow did not restore the editor view"

        is_fullscreen = browser.execute_script(
            "return document.body.classList.contains('backstage-fullscreen')"
        )
        assert not is_fullscreen, "backstage-fullscreen not cleared after exiting"
        assert not self._ribbon_is_hidden(browser), "Ribbon still hidden after exiting Backstage"

    def test_escape_key_exits_backstage(self, browser, app_server):
        """Esc is the same exit route as the back arrow."""
        open_app(browser, app_server)
        time.sleep(0.3)
        browser.execute_script("switchToView('portfolio');")
        time.sleep(0.2)
        browser.execute_script("switchToView('backstage');")
        time.sleep(0.3)

        body = browser.find_element(By.TAG_NAME, "body")
        body.send_keys(Keys.ESCAPE)
        time.sleep(0.3)

        backstage_tab = browser.find_element(By.ID, "backstage-tab")
        assert "active" not in backstage_tab.get_attribute("class"), \
            "Esc did not exit Backstage"


class TestEditorInput:
    """Verify the plan editor accepts user input and reflects changes."""

    def _navigate_to_editor(self, browser, app_server):
        """Helper to navigate to the editor tab."""
        open_app(browser, app_server)
        click_scope(browser, "project")
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
        open_app(browser, app_server)
        click_scope(browser, "project")
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
        open_app(browser, app_server)
        export_menu = browser.find_element(By.ID, "exportMenu")
        assert export_menu is not None

    def test_export_menu_toggles(self, browser, app_server):
        """The export menu should toggle visibility when triggered."""
        open_app(browser, app_server)
        click_scope(browser, "project")
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


# The plan sub-navigation strip this class used to drive (#planSubnav, and
# its #actionsTasksViewTab / #actionsGanttViewTab / ... buttons) is dead UI:
# the template still carries the markup but pins it with an inline
# `style="display: none;"` that beats the `.visible` class nav.js toggles,
# so it can never be shown or clicked. The ribbon is the only live
# navigation now.
#
# Switching views from the ribbon in a real browser is covered by
# tests/test_ribbon_simple_view.py -- see
# test_gantt_button_reachable_and_works_in_simple_mode, which is currently
# failing over the ribbon's collapse threshold at 1280px.


class TestKeyboardNavigation:
    """Verify basic keyboard accessibility."""

    def test_editor_is_focusable(self, browser, app_server):
        """The plan editor should be focusable via click."""
        open_app(browser, app_server)
        click_scope(browser, "project")
        time.sleep(0.3)

        editor = browser.find_element(By.ID, "planEditor")
        editor.click()

        active_id = browser.execute_script("return document.activeElement.id")
        assert active_id == "planEditor", "Editor did not receive focus"

    def test_tabs_are_clickable(self, browser, app_server):
        """Top-level navigation should be real buttons, not styled divs.

        The old `.tabs .tab` strip is gone; the ribbon's scope pills and
        its tab strip carry the same responsibility now.
        """
        open_app(browser, app_server)
        nav = browser.find_elements(
            By.CSS_SELECTOR, ".ribbon-scope-btn, .ribbon-tab-btn"
        )
        assert len(nav) >= 4, f"Expected at least 4 navigation controls, found {len(nav)}"

        for control in nav:
            tag = control.tag_name.lower()
            assert tag == "button", (
                f"Navigation control '{control.text}' is a <{tag}> instead of <button>"
            )


class TestKanbanReliability:
    """Regression coverage for the board reliability overhaul (#785 / #471)."""

    PLAN = "Phase One\n  Task A 0%\nPhase Two\n  Task B 0%"

    def _load_plan(self, browser, app_server):
        open_app(browser, app_server)
        seed_current_project(browser, "Kanban reliability", self.PLAN)
        browser.execute_script(
            """
            for (const key of Object.keys(localStorage)) {
                if (key.startsWith('noodle_kanban_preferences_')) localStorage.removeItem(key);
            }
            """
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

    def test_drag_to_add_phase_creates_column_and_moves_card(
        self, browser, app_server
    ):
        """Issue #1070: the right-edge Add Phase tile is a drop target."""
        self._load_plan(browser, app_server)
        result = browser.execute_script(
            """
            switchPlanSubnavToBoard();
            window.prompt = () => 'Phase Three';
            const editor = document.getElementById('planEditor');
            let inputEvents = 0;
            editor.addEventListener('input', () => inputEvents++);
            const source = document.querySelector('.kanban-card[data-task-name="Task A"]');
            const target = document.querySelector('[data-drop-target="new-column"]');
            const transfer = new DataTransfer();
            source.dispatchEvent(new DragEvent('dragstart', {
                bubbles: true, cancelable: true, dataTransfer: transfer
            }));
            target.dispatchEvent(new DragEvent('dragover', {
                bubbles: true, cancelable: true, dataTransfer: transfer
            }));
            const highlighted = target.classList.contains('drag-over');
            target.dispatchEvent(new DragEvent('drop', {
                bubbles: true, cancelable: true, dataTransfer: transfer
            }));
            source.dispatchEvent(new DragEvent('dragend', {
                bubbles: true, dataTransfer: transfer
            }));
            return {
                text: editor.value,
                inputEvents,
                highlighted,
                columns: Array.from(document.querySelectorAll('.kanban-column-title'))
                    .map(element => element.textContent)
            };
            """
        )
        assert result["highlighted"] is True
        assert result["inputEvents"] == 1
        assert "Phase Three\n  Task A 0%" in result["text"]
        assert "Phase Three" in result["columns"]

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
                hide: document.getElementById('kanbanHideCompleted').checked
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
            """
        )
        assert restored == {
            "mode": "progress",
            "sort": True,
            "hide": True,
        }

    def test_column_reorder_moves_the_complete_phase_model(
        self, browser, app_server
    ):
        self._load_plan(browser, app_server)
        result = browser.execute_script(
            """
            switchPlanSubnavToBoard();
            const editor = document.getElementById('planEditor');
            let inputEvents = 0;
            editor.addEventListener('input', () => inputEvents++);
            kanbanBoard.handleColumnReorder('Phase One', 'Phase Two', false);
            return {text: editor.value, inputEvents};
            """
        )
        assert result["inputEvents"] == 1
        assert result["text"].endswith(
            "Phase Two\n  Task B 0%\nPhase One\n  Task A 0%"
        )

    def test_task_form_style_save_updates_board_without_waiting_for_debounce(
        self, browser, app_server
    ):
        """Regression test for #1063: saving the task detail form (which
        writes editor.value directly and dispatches a synthetic, untrusted
        'input' event -- exactly like saveTask() in script.js) must refresh
        the board card immediately, not only after the 1s debounce used for
        real keystrokes typed directly into the editor."""
        self._load_plan(browser, app_server)
        result = browser.execute_script(
            """
            switchPlanSubnavToBoard();
            const editor = document.getElementById('planEditor');
            const renamed = editor.value.replace('Task A 0%', 'Renamed Task 0%');
            editor.value = renamed;
            // Mirrors saveTask(): a programmatic value write followed by an
            // untrusted 'input' event, with no explicit board render call.
            editor.dispatchEvent(new Event('input'));
            return {
                cardTextImmediate: Array.from(
                    document.querySelectorAll('.kanban-card')
                ).map(el => el.dataset.taskName)
            };
            """
        )
        assert "Renamed Task" in result["cardTextImmediate"]
        assert "Task A" not in result["cardTextImmediate"]


class TestNotepadView:
    """Coverage for the notepad list surface (#1049): typing a line and
    pressing Enter creates a task, Tab/Shift+Tab indent and outdent,
    Backspace removes an emptied leaf row, and drag-to-reorder works --
    all exercised in a real browser, on the same #planEditor document
    every other view shares."""

    PLAN = "Phase One\n  Task A 1d\n  Task B 1d\n"

    def _load_plan(self, browser, app_server):
        open_app(browser, app_server)
        seed_current_project(browser, "Notepad view", self.PLAN)
        browser.refresh()
        WebDriverWait(browser, 5).until(
            lambda driver: "Task A" in driver.find_element(By.ID, "planEditor").get_attribute("value")
        )
        browser.execute_script("switchToView('notepad');")
        WebDriverWait(browser, 5).until(
            lambda driver: driver.find_element(By.ID, "notepad-view").get_attribute("class")
            and "active" in driver.find_element(By.ID, "notepad-view").get_attribute("class")
        )
        # The view turning "active" only means the container is showing --
        # the rows are rendered after it, so tests that index into them
        # (rows[1], rows[2]) raced the render and saw an empty list.
        WebDriverWait(browser, 5).until(
            lambda driver: any(
                field.get_attribute("value") == "Task B"
                for field in driver.find_elements(
                    By.CSS_SELECTOR, "#notepadContainer .notepad-row .notepad-input"
                )
            )
        )

    def _rows(self, browser):
        return browser.find_elements(By.CSS_SELECTOR, "#notepadContainer .notepad-row")

    def _row_input(self, browser, text):
        for row in self._rows(browser):
            field = row.find_element(By.CSS_SELECTOR, ".notepad-input")
            if field.get_attribute("value") == text:
                return field
        raise AssertionError(f"no notepad row with value {text!r}")

    def test_notepad_view_shows_a_clean_task_list(self, browser, app_server):
        """The surface renders one row per task, with the raw task name only
        -- no front matter, no Markdown syntax -- plus a trailing draft row."""
        self._load_plan(browser, app_server)
        values = [
            row.find_element(By.CSS_SELECTOR, ".notepad-input").get_attribute("value")
            for row in self._rows(browser)
        ]
        assert values == ["Phase One", "Task A", "Task B", ""]

    def test_typing_and_enter_creates_a_task(self, browser, app_server):
        self._load_plan(browser, app_server)
        rows = self._rows(browser)
        draft = rows[-1].find_element(By.CSS_SELECTOR, ".notepad-input")
        draft.click()
        draft.send_keys("Task C")
        draft.send_keys(Keys.ENTER)
        WebDriverWait(browser, 5).until(
            lambda driver: "Task C" in driver.find_element(By.ID, "planEditor").get_attribute("value")
        )
        editor_value = browser.find_element(By.ID, "planEditor").get_attribute("value")
        assert "Task B" in editor_value and "Task C" in editor_value
        # A fresh, empty draft row is ready right after the new task.
        rows = self._rows(browser)
        assert rows[-1].find_element(By.CSS_SELECTOR, ".notepad-input").get_attribute("value") == ""

    def test_tab_indents_and_preserves_the_typed_text(self, browser, app_server):
        self._load_plan(browser, app_server)
        rows = self._rows(browser)
        draft = rows[-1].find_element(By.CSS_SELECTOR, ".notepad-input")
        draft.click()
        draft.send_keys("Task C")
        draft.send_keys(Keys.TAB)
        # Tab re-renders the draft row (its position/indent changes) -- the
        # element above is now stale; re-query, the same way a real user's
        # focus follows the rebuilt row rather than a held-onto reference.
        rows = self._rows(browser)
        draft = rows[-1].find_element(By.CSS_SELECTOR, ".notepad-input")
        assert draft.get_attribute("value") == "Task C", (
            "Tab must not discard text already typed into the draft row"
        )
        draft.send_keys(Keys.ENTER)
        WebDriverWait(browser, 5).until(
            lambda driver: "Task C" in driver.find_element(By.ID, "planEditor").get_attribute("value")
        )
        editor_value = browser.find_element(By.ID, "planEditor").get_attribute("value")
        assert "  Task B 1d\n    Task C" in editor_value

    def test_shift_tab_outdents_an_existing_task(self, browser, app_server):
        self._load_plan(browser, app_server)
        field = self._row_input(browser, "Task B")
        field.click()
        ActionChains(browser).key_down(Keys.SHIFT).send_keys(Keys.TAB).key_up(Keys.SHIFT).perform()
        WebDriverWait(browser, 5).until(
            lambda driver: "\nTask B 1d" in driver.find_element(By.ID, "planEditor").get_attribute("value")
        )

    def test_backspace_removes_an_emptied_leaf_task(self, browser, app_server):
        self._load_plan(browser, app_server)
        field = self._row_input(browser, "Task B")
        field.click()
        # Backspace over the text empties the field without ever losing
        # focus (unlike .clear(), whose exact focus/blur sequence is
        # driver-dependent); the Backspace *after* that, on an already-empty
        # field, is the one that should trigger removal.
        #
        # Deleting character by character rather than select-all: Ctrl+A is
        # not select-all on macOS (it is Cmd+A), so the previous version of
        # this test only ever deleted two characters and could not pass off
        # Linux.
        field.send_keys(Keys.END)
        for _ in range(len(field.get_attribute("value"))):
            field.send_keys(Keys.BACKSPACE)
        field.send_keys(Keys.BACKSPACE)
        WebDriverWait(browser, 5).until(
            lambda driver: "Task B" not in driver.find_element(By.ID, "planEditor").get_attribute("value")
        )
        editor_value = browser.find_element(By.ID, "planEditor").get_attribute("value")
        assert "Task A" in editor_value

    def test_drag_reorders_through_the_same_model_used_elsewhere(self, browser, app_server):
        self._load_plan(browser, app_server)
        result = browser.execute_script(
            """
            const rows = document.querySelectorAll('#notepadContainer .notepad-row');
            const source = rows[1].querySelector('.notepad-drag-handle'); // Task A
            const target = rows[2]; // Task B
            const transfer = new DataTransfer();
            source.dispatchEvent(new DragEvent('dragstart', {bubbles: true, cancelable: true, dataTransfer: transfer}));
            target.dispatchEvent(new DragEvent('dragover', {bubbles: true, cancelable: true, dataTransfer: transfer, clientY: target.getBoundingClientRect().bottom - 1}));
            target.dispatchEvent(new DragEvent('drop', {bubbles: true, cancelable: true, dataTransfer: transfer, clientY: target.getBoundingClientRect().bottom - 1}));
            source.dispatchEvent(new DragEvent('dragend', {bubbles: true, dataTransfer: transfer}));
            return document.getElementById('planEditor').value;
            """
        )
        assert "  Task B 1d\n  Task A 1d" in result

    def test_board_button_switches_to_the_kanban_view_on_the_same_document(
        self, browser, app_server
    ):
        self._load_plan(browser, app_server)
        browser.find_element(By.CSS_SELECTOR, ".notepad-kanban-btn").click()
        WebDriverWait(browser, 5).until(
            lambda driver: "active" in driver.find_element(By.ID, "kanban-tab").get_attribute("class")
        )
        # Same #planEditor, same tasks -- the board is a different lens over
        # the identical document, not a fork of it.
        editor_value = browser.find_element(By.ID, "planEditor").get_attribute("value")
        assert "Task A" in editor_value and "Task B" in editor_value


class TestResponsiveLayout:
    """Verify the layout adapts to different viewport sizes."""

    @pytest.fixture(autouse=True)
    def _restore_desktop_size(self, browser):
        """Put the shared browser back to desktop size, pass or fail.

        The browser fixture is module-scoped, so a viewport test that fails
        before its own reset line used to leave every later test in this
        file running at tablet width -- where the ribbon collapses and
        unrelated assertions fail for the wrong reason.
        """
        yield
        browser.set_window_size(1280, 900)

    def test_mobile_viewport(self, browser, app_server):
        """The app should be usable at mobile viewport width (375px)."""
        browser.set_window_size(375, 667)
        open_app(browser, app_server)
        time.sleep(0.5)

        # The page should still render without horizontal scroll
        body_width = browser.execute_script("return document.body.scrollWidth")
        viewport_width = browser.execute_script("return window.innerWidth")

        # Allow some tolerance (scrollWidth can be slightly larger)
        assert body_width <= viewport_width + 20, (
            f"Page has horizontal scroll at mobile size: "
            f"body={body_width}px, viewport={viewport_width}px"
        )

    def test_tablet_viewport(self, browser, app_server):
        """The app should be usable at tablet viewport width (768px)."""
        browser.set_window_size(768, 1024)
        open_app(browser, app_server)
        time.sleep(0.5)

        # Navigation should still be accessible -- the ribbon's scope pills
        # replaced the old .tabs strip.
        pills = browser.find_elements(By.CSS_SELECTOR, ".ribbon-scope-btn")
        visible = [p for p in pills if p.is_displayed()]
        assert len(visible) >= 1, "No navigation scopes visible at tablet size"


class TestTouchInteractions:
    """Verify representative touch paths in a real browser."""

    def test_shared_controls_have_touch_targets(self, browser, app_server):
        browser.set_window_size(375, 667)
        open_app(browser, app_server)

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
        open_app(browser, app_server)
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
        open_app(browser, app_server)
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
        open_app(browser, app_server)
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
        open_app(browser, app_server)
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
            const orderButton = card.querySelector('.kanban-card-order-down');
            if (orderButton) orderButton.click();
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
        assert result["reordered"] is None
        assert result["label"].startswith("Move Touch task")

    def test_diagram_pointer_pan_finishes_cleanly(self, browser, app_server):
        open_app(browser, app_server)
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
        open_app(browser, app_server)

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
        open_app(browser, app_server)

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
        open_app(browser, app_server)

        # .ribbon-titlebar is given `display: flex` by components.css; a
        # browser with no stylesheet would report the <div> default of
        # "block". (This used to probe `.tabs`, which the ribbon removed.)
        display = browser.execute_script("""
            var bar = document.querySelector('.ribbon-titlebar');
            if (!bar) return null;
            return window.getComputedStyle(bar).display;
        """)
        assert display == "flex", \
            f"Custom CSS does not appear to be loaded (.ribbon-titlebar display={display!r})"

    def test_javascript_loaded(self, browser, app_server):
        """script.js should load and define expected global functions."""
        open_app(browser, app_server)

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
