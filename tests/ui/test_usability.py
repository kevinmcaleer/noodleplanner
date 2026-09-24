"""The broad usability sweep, on Playwright.

Navigation works, tabs switch, the editor accepts input, rendering produces
output, Backstage is a full-screen mode with one exit, the board and notepad
stay in step with the one #planEditor document every view shares, touch paths
behave, and the browser-side Excel export stays off the UI thread and off the
API. This catches regressions unit and API tests miss, because it executes the
JavaScript.

Ported from tests/test_usability.py, the largest of the Selenium files at 50
tests. Three things are worth knowing about the port:

  * **It removes the suite's order dependency.** The Selenium original's
    `test_render_does_not_show_error` read `get_log("browser")`, a buffer
    shared by every test in the module and drained by whoever read it first.
    That test passed as part of its file and failed run on its own, which is
    why ci/jobs/usability.sh has to pass `--dist loadfile` -- per-test
    distribution reordered it and turned the file red. Here the console
    listener belongs to a page that belongs to one test, so the question
    "did *this* test produce console errors" has an answer that does not
    depend on what ran before it.
  * **Window size is per test, not per driver.** Several tests here resize to
    375px or 768px and the original had to remember to set 1280x900 back
    afterwards, from a `finally` in some cases and not at all in others -- a
    leak waiting to happen on any failure. A context per test makes the reset
    unnecessary.
  * **`execute_async_script` becomes an ordinary evaluate.** Playwright awaits
    a promise returned from `page.evaluate`, so the Excel tests lose their
    callback plumbing and their bespoke script timeouts.

Usage:
    uv run pytest tests/ui/test_usability.py -q
"""

from .helpers import (
    actionable_console_errors,
    click_scope,
    open_app,
    open_portfolio_view,
    open_project_view,
    plan_text,
    set_editor_value,
)


class TestPageLoad:
    """Verify the main page loads and renders correctly in a real browser."""

    def test_page_loads_successfully(self, page, app_server):
        """The main page should return HTTP 200 and render HTML."""
        open_app(page, app_server)
        assert "Noodle Planner" in page.title()

    def test_page_contains_plan_editor(self, page, app_server):
        """The plan editor textarea must be present and visible."""
        open_app(page, app_server)
        assert page.locator("#planEditor").is_visible()

    def test_page_contains_navigation_tabs(self, page, app_server):
        """All main navigation tabs must be present."""
        open_app(page, app_server)
        for scope in ("project", "portfolio"):
            assert page.locator(f'.ribbon-scope-btn[data-scope="{scope}"]').count() == 1, (
                f"Scope button {scope} not found"
            )

    def test_script_js_loaded_without_errors(self, page, app_server):
        """JavaScript should load without uncaught errors blocking the page."""
        open_app(page, app_server)
        assert page.evaluate("() => typeof switchTab === 'function'") is True, (
            "switchTab function not defined - script.js may have errors"
        )

    def test_style_css_loaded(self, page, app_server):
        """Custom CSS should load and apply styles."""
        open_app(page, app_server)
        font_family = page.eval_on_selector(
            "#planEditor", "el => getComputedStyle(el).fontFamily"
        )
        assert font_family, "Editor has no computed font-family - CSS may not have loaded"


class TestTabNavigation:
    """Verify that clicking navigation tabs switches views correctly.

    Each of these waits for the state and stops there, rather than waiting and
    then re-reading the class in a second call. The two-step form is a
    check-then-act race: `wait_for_selector` retries until the class appears,
    but the `get_attribute` that followed it was a fresh, non-retrying query,
    and the app re-applies these classes during a view switch. So there is a
    window where the wait has already succeeded and the re-read sees
    `class="tab-content"` without `active` -- which is exactly what CI reported
    on a loaded runner, and why it never reproduced serially.

    `wait_for_selector` raises on timeout, so it is the assertion; the second
    statement only ever weakened it. `test_tools_menu_opens` below already
    carries the same reasoning in its own comment.
    """

    # These used to carry a 15s budget of their own, on a theory that a page
    # load plus a view rebuild could eat the suite-wide 5s default before the
    # wait even started. That theory was wrong, and the timeout was hiding the
    # real fault rather than absorbing it: each of these clicks two scopes in
    # quick succession, and NavigationController used to *discard* a
    # navigation that arrived during the 150ms context fade the first click
    # started. Nothing retried, so the second view never arrived -- no budget
    # would have been long enough. See the queue in navigateTo(), and
    # test_a_second_scope_click_during_the_fade_still_lands below.
    #
    # They are back on the default, which is what makes them worth running:
    # the wait now fails on a real hang instead of on a race.

    def test_plan_tab_shows_editor(self, page, app_server):
        """Clicking the Plan tab should display the editor view."""
        open_portfolio_view(page, app_server)
        click_scope(page, "project")

        page.wait_for_selector("#editor-tab.active")

    def test_portfolio_tab_shows_portfolio(self, page, app_server):
        """Clicking the Portfolio tab should display the portfolio view."""
        open_portfolio_view(page, app_server)

        page.wait_for_selector("#portfolio-tab.active")

    def test_tab_switching_hides_previous(self, page, app_server):
        """Switching tabs should hide the previous tab content."""
        open_project_view(page, app_server)
        click_scope(page, "portfolio")

        page.wait_for_selector("#editor-tab.active", state="detached")

    def test_a_second_scope_click_during_the_fade_still_lands(self, page, app_server):
        """A scope click made mid-fade is honoured, not thrown away.

        Both clicks are raw rather than `click_scope`, because the helper now
        waits for each switch to land and so cannot produce the overlap this
        is about. The first assertion is load bearing for the same reason:
        without it, a machine on which the two clicks happened to straddle the
        150ms window would pass this test having never entered the state that
        used to swallow the second one.

        `getCurrentView()` is the subject rather than a pane, because
        `#editor-tab` is already active on boot -- asserting on it here would
        pass against the very bug this covers.
        """
        open_app(page, app_server)
        page.click('.ribbon-scope-btn[data-scope="portfolio"]')

        assert page.evaluate(
            "() => NavigationController.isTransitioning()"
        ), "the first click did not start a transition -- this test proves nothing"

        page.click('.ribbon-scope-btn[data-scope="project"]')

        page.wait_for_function("() => NavigationController.getCurrentView() === 'editor'")

    def test_tools_menu_opens(self, page, app_server):
        """The ribbon display menu should open when clicked."""
        open_app(page, app_server)
        page.click('[data-action="toggle-display-menu"]')
        # Wait for it rather than asserting the instant after the click: the
        # menu is revealed by a class change the click schedules, so reading
        # visibility synchronously is a race that happens to win on a quiet
        # machine and lose on a busy one.
        page.wait_for_selector(".ribbon-display-menu", state="visible")


class TestBackstageFullScreen:
    """#972: Backstage is a full-screen mode with a single exit route -- the
    ribbon/status bar hide while it's open, and the back arrow / Esc is the
    only way out, returning to whatever view was active on entry.
    """

    @staticmethod
    def _ribbon_is_hidden(page):
        return page.evaluate(
            "() => { const el = document.getElementById('ribbonShell');"
            "  return !el || getComputedStyle(el).display === 'none'; }"
        )

    def test_file_button_opens_fullscreen_backstage(self, page, app_server):
        """Clicking the ribbon's File button navigates straight into a
        full-screen Backstage -- no dropdown, ribbon/status bar hidden."""
        open_app(page, app_server)
        page.click('[data-action="open-backstage"]')
        page.wait_for_selector("#backstage-tab.active")

        assert page.evaluate(
            "() => document.body.classList.contains('backstage-fullscreen')"
        ), "body did not gain backstage-fullscreen on entry"
        assert self._ribbon_is_hidden(page), "Ribbon still visible in full-screen Backstage"

        # No File dropdown should exist anymore (#972 retired it).
        assert page.locator(".ribbon-file-menu-item[data-file-index]").count() == 0

    def test_back_arrow_exits_to_previous_view_and_restores_chrome(self, page, app_server):
        """The back arrow returns to the view that was active on entry and
        un-hides the ribbon/status bar."""
        open_app(page, app_server)
        page.evaluate("() => switchToView('editor')")
        page.wait_for_selector("#editor-tab.active")
        page.evaluate("() => switchToView('backstage')")
        page.wait_for_selector("#backstage-tab.active")

        page.click("#backstageBackBtn")
        page.wait_for_selector("#editor-tab.active")

        assert not page.evaluate(
            "() => document.body.classList.contains('backstage-fullscreen')"
        ), "backstage-fullscreen not cleared after exiting"
        assert not self._ribbon_is_hidden(page), "Ribbon still hidden after exiting Backstage"

    def test_escape_key_exits_backstage(self, page, app_server):
        """Esc is the same exit route as the back arrow."""
        open_app(page, app_server)
        page.evaluate("() => switchToView('portfolio')")
        page.wait_for_selector("#portfolio-tab.active")
        page.evaluate("() => switchToView('backstage')")
        page.wait_for_selector("#backstage-tab.active")

        page.keyboard.press("Escape")
        page.wait_for_selector("#backstage-tab.active", state="detached")
        assert "active" not in (page.locator("#backstage-tab").get_attribute("class") or ""), (
            "Esc did not exit Backstage"
        )


class TestEditorInput:
    """Verify the plan editor accepts user input and reflects changes."""

    def test_editor_accepts_text_input(self, page, app_server):
        """Users should be able to type plan text into the editor."""
        open_project_view(page, app_server)
        set_editor_value(page, "Phase 1\n  Task 1 @john 3d\n  Task 2 @jane 2d")

        actual = plan_text(page)
        assert "Phase 1" in actual
        assert "Task 1" in actual

    def test_editor_preserves_indentation(self, page, app_server):
        """Plan indentation (spaces) should be preserved in the editor."""
        open_project_view(page, app_server)
        set_editor_value(page, "Phase 1\n  Task 1 @john 3d")

        assert "  Task 1" in plan_text(page), "Indentation not preserved in editor"

    def test_editor_handles_frontmatter(self, page, app_server):
        """The editor should accept YAML front matter without errors."""
        open_project_view(page, app_server)
        set_editor_value(
            page,
            "---\ntitle: Test Project\nresources:\n  - name: John\n"
            "    shortname: john\n---\nPhase 1\n  Task 1 @john 3d",
        )

        actual = plan_text(page)
        assert "title: Test Project" in actual
        assert "Phase 1" in actual


RENDER_PLAN = (
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


def _enter_plan_and_render(page, app_server):
    open_project_view(page, app_server)
    set_editor_value(page, RENDER_PLAN)
    page.evaluate("() => { if (typeof renderPlan === 'function') renderPlan(); }")
    # The original slept a flat second here. The app writes the computed `rag:`
    # key back into the front matter when the parse completes, which is both a
    # real signal and a faster one.
    page.wait_for_function(
        "() => document.getElementById('planEditor').value.includes('rag:')"
    )


class TestPlanRendering:
    """Verify that rendering a plan produces visible output."""

    def test_render_produces_output(self, page, app_server):
        """Rendering a plan should produce visible output in the output area."""
        _enter_plan_and_render(page, app_server)
        body_text = page.locator("body").inner_text()
        assert len(body_text) > 100, "Page appears to have very little content after render"

    def test_render_does_not_show_error(self, page, app_server):
        """Rendering a valid plan should not produce JavaScript errors.

        This is the test whose Selenium original only passed as part of its
        file. Reading the console per page rather than per driver makes it
        honest. It used to fail whenever the plan (which starts today and runs
        about a week) fell inside one calendar month, with 24 SVG geometry
        errors from the EVM chart:

            <polyline> attribute points: Expected number, "NaN,290".
            <circle> attribute cx: Expected length, "NaN".

        The EVM series is sampled monthly, so such a plan has one sample and
        renderEvmChart() spread it by i / (count - 1) = 0 / 0.
        evmChartXScale() now centres a lone sample;
        tests/test_evm_chart_single_sample.mjs pins that down without
        depending on today's date.
        """
        _enter_plan_and_render(page, app_server)
        errors = actionable_console_errors(page)
        assert errors == [], f"JavaScript errors found after rendering: {errors}"


class TestExportMenu:
    """Verify the export menu opens and contains expected options."""

    def test_export_menu_exists(self, page, app_server):
        """The export menu element should exist in the DOM."""
        open_app(page, app_server)
        assert page.locator("#exportMenu").count() == 1

    def test_export_menu_toggles(self, page, app_server):
        """The export menu should toggle visibility when triggered."""
        open_project_view(page, app_server)
        page.evaluate(
            "() => { if (typeof toggleExportMenu === 'function')"
            "  toggleExportMenu(new Event('click')); }"
        )
        visibility = page.eval_on_selector(
            "#exportMenu",
            "el => { const s = getComputedStyle(el);"
            "  return s.display !== 'none' && s.visibility !== 'hidden'; }",
        )
        assert visibility is not None


class TestSubNavigation:
    """Verify plan sub-navigation views (tasks, gantt, board, calendar)."""

    @staticmethod
    def _go_to_actions_tab(page, app_server):
        open_project_view(page, app_server)
        page.evaluate("() => switchToView('actions')")
        page.wait_for_selector("#actionsTasksView.active")

    def test_actions_tab_has_sub_views(self, page, app_server):
        """The actions view should render its default table view."""
        self._go_to_actions_tab(page, app_server)
        assert "active" in (page.locator("#actionsTasksView").get_attribute("class") or "")
        assert page.locator("#actionsTable").is_visible()

    def test_sub_view_switching(self, page, app_server):
        """The actions view should expose its filters when active."""
        self._go_to_actions_tab(page, app_server)
        for filter_id in ("actionsFilterStatus", "actionsFilterResource", "actionsFilterPriority"):
            assert page.locator(f"#{filter_id}").is_visible(), (
                f"{filter_id} not visible in actions view"
            )


class TestKeyboardNavigation:
    """Verify basic keyboard accessibility."""

    def test_editor_is_focusable(self, page, app_server):
        """The plan editor should be focusable via click."""
        open_project_view(page, app_server)
        page.click("#planEditor")
        assert page.evaluate("() => document.activeElement.id") == "planEditor", (
            "Editor did not receive focus"
        )

    def test_tabs_are_clickable(self, page, app_server):
        """Navigation tabs should be implemented as buttons (clickable)."""
        open_app(page, app_server)
        tags = page.eval_on_selector_all(
            ".ribbon-file-btn, .ribbon-scope-btn, .ribbon-tab-btn",
            "els => els.map(el => [el.tagName.toLowerCase(), (el.textContent || '').trim()])",
        )
        assert len(tags) >= 4, f"Expected at least 4 ribbon buttons, found {len(tags)}"
        for tag, text in tags:
            assert tag == "button", f"Tab '{text}' is a <{tag}> instead of <button>"


class TestKanbanReliability:
    """Regression coverage for the board reliability overhaul (#785 / #471)."""

    PLAN = "Phase One\n  Task A 0%\nPhase Two\n  Task B 0%"

    @classmethod
    def _load_plan(cls, page, app_server):
        open_project_view(page, app_server)
        set_editor_value(page, cls.PLAN)
        page.wait_for_function(
            "() => document.getElementById('planEditor').value.includes('Task A')"
        )
        page.evaluate(
            """() => {
                for (const key of Object.keys(localStorage)) {
                    if (key.startsWith('noodle_kanban_preferences_')) {
                        localStorage.removeItem(key);
                    }
                }
            }"""
        )

    def test_kanban_renders_on_first_activation_and_is_idempotent(self, page, app_server):
        self._load_plan(page, app_server)
        result = page.evaluate(
            """() => {
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
            }"""
        )
        assert result == {
            "active": True,
            "cards": 2,
            "identical": True,
            "focused": "Task A",
        }

    def test_drag_between_columns_writes_markdown_exactly_once(self, page, app_server):
        self._load_plan(page, app_server)
        result = page.evaluate(
            """() => {
                switchPlanSubnavToBoard();
                const editor = document.getElementById('planEditor');
                let inputEvents = 0;
                editor.addEventListener('input', () => inputEvents++);
                const source = document.querySelector('.kanban-card[data-task-name="Task A"]');
                const target = document.querySelector(
                    '.kanban-column-body[data-column-title="Phase Two"]');
                const transfer = new DataTransfer();
                source.dispatchEvent(new DragEvent('dragstart', {
                    bubbles: true, cancelable: true, dataTransfer: transfer}));
                target.dispatchEvent(new DragEvent('dragover', {
                    bubbles: true, cancelable: true, dataTransfer: transfer}));
                target.dispatchEvent(new DragEvent('drop', {
                    bubbles: true, cancelable: true, dataTransfer: transfer}));
                source.dispatchEvent(new DragEvent('dragend', {
                    bubbles: true, dataTransfer: transfer}));
                return {text: editor.value, inputEvents};
            }"""
        )
        assert result["inputEvents"] == 1
        assert "Phase Two\n  Task B 0%\n  Task A 0%" in result["text"]

    def test_drag_to_add_phase_creates_column_and_moves_card(self, page, app_server):
        """Issue #1070: the right-edge Add Phase tile is a drop target."""
        self._load_plan(page, app_server)
        result = page.evaluate(
            """() => {
                switchPlanSubnavToBoard();
                window.prompt = () => 'Phase Three';
                const editor = document.getElementById('planEditor');
                let inputEvents = 0;
                editor.addEventListener('input', () => inputEvents++);
                const source = document.querySelector('.kanban-card[data-task-name="Task A"]');
                const target = document.querySelector('[data-drop-target="new-column"]');
                const transfer = new DataTransfer();
                source.dispatchEvent(new DragEvent('dragstart', {
                    bubbles: true, cancelable: true, dataTransfer: transfer}));
                target.dispatchEvent(new DragEvent('dragover', {
                    bubbles: true, cancelable: true, dataTransfer: transfer}));
                const highlighted = target.classList.contains('drag-over');
                target.dispatchEvent(new DragEvent('drop', {
                    bubbles: true, cancelable: true, dataTransfer: transfer}));
                source.dispatchEvent(new DragEvent('dragend', {
                    bubbles: true, dataTransfer: transfer}));
                return {
                    text: editor.value,
                    inputEvents,
                    highlighted,
                    columns: [...document.querySelectorAll('.kanban-column-title')]
                        .map(element => element.textContent)
                };
            }"""
        )
        assert result["highlighted"] is True
        assert result["inputEvents"] == 1
        assert "Phase Three\n  Task A 0%" in result["text"]
        assert "Phase Three" in result["columns"]

    def test_keyboard_move_and_preferences_survive_reload(self, page, app_server):
        self._load_plan(page, app_server)
        moved = page.evaluate(
            """() => {
                switchPlanSubnavToBoard();
                const card = document.querySelector('.kanban-card[data-task-name="Task A"]');
                card.focus();
                card.dispatchEvent(new KeyboardEvent('keydown', {
                    bubbles: true, cancelable: true, altKey: true, key: 'ArrowRight'}));
                switchKanbanView('progress');
                toggleKanbanPrioritySort(true);
                toggleKanbanHideCompleted(true);
                return document.getElementById('planEditor').value;
            }"""
        )
        assert "Phase Two\n  Task B 0%\n  Task A 0%" in moved

        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector("#planEditor", state="attached")
        set_editor_value(page, moved)
        restored = page.evaluate(
            """() => {
                switchPlanSubnavToBoard();
                return {
                    mode: document.getElementById('kanbanViewMode').value,
                    sort: document.getElementById('kanbanSortPriority').checked,
                    hide: document.getElementById('kanbanHideCompleted').checked
                };
            }"""
        )
        assert restored == {"mode": "progress", "sort": True, "hide": True}

    def test_column_reorder_moves_the_complete_phase_model(self, page, app_server):
        self._load_plan(page, app_server)
        result = page.evaluate(
            """() => {
                switchPlanSubnavToBoard();
                const editor = document.getElementById('planEditor');
                let inputEvents = 0;
                editor.addEventListener('input', () => inputEvents++);
                kanbanBoard.handleColumnReorder('Phase One', 'Phase Two', false);
                return {text: editor.value, inputEvents};
            }"""
        )
        assert result["text"].endswith("Phase Two\n  Task B 0%\nPhase One\n  Task A 0%")

    def test_task_form_style_save_updates_board_without_waiting_for_debounce(
        self, page, app_server
    ):
        """Regression test for #1063: saving the task detail form (which writes
        editor.value directly and dispatches a synthetic, untrusted 'input'
        event -- exactly like saveTask() in script.js) must refresh the board
        card immediately, not only after the 1s debounce used for real
        keystrokes typed directly into the editor."""
        self._load_plan(page, app_server)
        result = page.evaluate(
            """() => {
                switchPlanSubnavToBoard();
                const editor = document.getElementById('planEditor');
                editor.value = editor.value.replace('Task A 0%', 'Renamed Task 0%');
                // Mirrors saveTask(): a programmatic value write followed by an
                // untrusted 'input' event, with no explicit board render call.
                editor.dispatchEvent(new Event('input'));
                return {
                    cardTextImmediate: [...document.querySelectorAll('.kanban-card')]
                        .map(el => el.dataset.taskName)
                };
            }"""
        )
        assert "Renamed Task" in result["cardTextImmediate"]
        assert "Task A" not in result["cardTextImmediate"]


class TestNotepadView:
    """Coverage for the notepad list surface (#1049): typing a line and
    pressing Enter creates a task, Tab/Shift+Tab indent and outdent, Backspace
    removes an emptied leaf row, and drag-to-reorder works -- all exercised in
    a real browser, on the same #planEditor document every other view shares.
    """

    PLAN = "Phase One\n  Task A 1d\n  Task B 1d\n"

    @classmethod
    def _load_plan(cls, page, app_server):
        open_project_view(page, app_server)
        set_editor_value(page, cls.PLAN)
        page.wait_for_function(
            "() => document.getElementById('planEditor').value.includes('Task A')"
        )
        page.evaluate("() => switchToView('notepad')")
        page.wait_for_selector("#notepad-view.active")
        page.wait_for_function(
            "() => document.querySelectorAll("
            "  '#notepadContainer .notepad-row').length >= 4"
        )

    @staticmethod
    def _row_values(page):
        return page.eval_on_selector_all(
            "#notepadContainer .notepad-row .notepad-input", "els => els.map(el => el.value)"
        )

    @staticmethod
    def _row_input(page, text):
        # Locators match on rendered text, and these rows carry their text as
        # an input *value*, which is not text -- so the row is found by index.
        values = TestNotepadView._row_values(page)
        assert text in values, f"no notepad row with value {text!r}"
        return page.locator("#notepadContainer .notepad-row .notepad-input").nth(
            values.index(text)
        )

    @staticmethod
    def _draft(page):
        return page.locator("#notepadContainer .notepad-row .notepad-input").last

    def test_notepad_view_shows_a_clean_task_list(self, page, app_server):
        """The surface renders one row per task, with the raw task name only --
        no front matter, no Markdown syntax -- plus a trailing draft row."""
        self._load_plan(page, app_server)
        assert self._row_values(page) == ["Phase One", "Task A", "Task B", ""]

    def test_typing_and_enter_creates_a_task(self, page, app_server):
        self._load_plan(page, app_server)
        draft = self._draft(page)
        draft.click()
        draft.type("Task C")
        draft.press("Enter")
        page.wait_for_function(
            "() => document.getElementById('planEditor').value.includes('Task C')"
        )

        editor_value = plan_text(page)
        assert "Task B" in editor_value and "Task C" in editor_value
        # A fresh, empty draft row is ready right after the new task.
        assert self._row_values(page)[-1] == ""

    def test_tab_indents_and_preserves_the_typed_text(self, page, app_server):
        self._load_plan(page, app_server)
        draft = self._draft(page)
        draft.click()
        draft.type("Task C")
        draft.press("Tab")
        # Tab re-renders the draft row (its position/indent changes), so the
        # element above is gone -- `.last` re-resolves, the same way a real
        # user's focus follows the rebuilt row rather than a held reference.
        assert self._draft(page).input_value() == "Task C", (
            "Tab must not discard text already typed into the draft row"
        )
        self._draft(page).press("Enter")
        page.wait_for_function(
            "() => document.getElementById('planEditor').value.includes('Task C')"
        )
        assert "  Task B 1d\n    Task C" in plan_text(page)

    def test_shift_tab_outdents_an_existing_task(self, page, app_server):
        self._load_plan(page, app_server)
        field = self._row_input(page, "Task B")
        field.click()
        field.press("Shift+Tab")
        page.wait_for_function(
            "() => document.getElementById('planEditor').value.includes('\\nTask B 1d')"
        )

    def test_backspace_removes_an_emptied_leaf_task(self, page, app_server):
        self._load_plan(page, app_server)
        field = self._row_input(page, "Task B")
        field.click()
        # Select-all then Backspace empties the field without ever losing
        # focus; the *second* Backspace, on an already-empty field, is the one
        # that should trigger removal.
        field.press("Control+a")
        field.press("Backspace")
        field.press("Backspace")
        page.wait_for_function(
            "() => !document.getElementById('planEditor').value.includes('Task B')"
        )
        assert "Task A" in plan_text(page)

    def test_drag_reorders_through_the_same_model_used_elsewhere(self, page, app_server):
        self._load_plan(page, app_server)
        result = page.evaluate(
            """() => {
                const rows = [...document.querySelectorAll('#notepadContainer .notepad-row')];
                const sourceRow = rows.find(
                    row => row.querySelector('.notepad-input')?.value === 'Task A');
                const target = rows.find(
                    row => row.querySelector('.notepad-input')?.value === 'Task B');
                const source = sourceRow.querySelector('.notepad-drag-handle');
                const transfer = new DataTransfer();
                const y = target.getBoundingClientRect().bottom - 1;
                source.dispatchEvent(new DragEvent('dragstart', {
                    bubbles: true, cancelable: true, dataTransfer: transfer}));
                target.dispatchEvent(new DragEvent('dragover', {
                    bubbles: true, cancelable: true, dataTransfer: transfer, clientY: y}));
                target.dispatchEvent(new DragEvent('drop', {
                    bubbles: true, cancelable: true, dataTransfer: transfer, clientY: y}));
                source.dispatchEvent(new DragEvent('dragend', {
                    bubbles: true, dataTransfer: transfer}));
                return document.getElementById('planEditor').value;
            }"""
        )
        assert "  Task B 1d\n  Task A 1d" in result

    def test_board_button_switches_to_the_kanban_view_on_the_same_document(
        self, page, app_server
    ):
        self._load_plan(page, app_server)
        page.click(".notepad-kanban-btn")
        page.wait_for_selector("#kanban-tab.active")
        # Same #planEditor, same tasks -- the board is a different lens over
        # the identical document, not a fork of it.
        editor_value = plan_text(page)
        assert "Task A" in editor_value and "Task B" in editor_value


class TestResponsiveLayout:
    """Verify the layout adapts to different viewport sizes.

    The Selenium original resized the shared driver and had to remember to set
    1280x900 back at the end of each test -- which a failure would skip,
    leaking a narrow window into whatever ran next. This page belongs to one
    test, so there is nothing to restore.
    """

    def test_mobile_viewport(self, page, app_server):
        """The app should be usable at mobile viewport width (375px)."""
        page.set_viewport_size({"width": 375, "height": 667})
        open_app(page, app_server)

        body_width = page.evaluate("() => document.body.scrollWidth")
        viewport_width = page.evaluate("() => window.innerWidth")
        # Allow some tolerance (scrollWidth can be slightly larger).
        assert body_width <= viewport_width + 20, (
            f"Page has horizontal scroll at mobile size: "
            f"body={body_width}px, viewport={viewport_width}px"
        )

    def test_tablet_viewport(self, page, app_server):
        """The app should be usable at tablet viewport width (768px)."""
        page.set_viewport_size({"width": 768, "height": 1024})
        open_app(page, app_server)

        visible = page.eval_on_selector_all(
            ".ribbon-file-btn, .ribbon-scope-btn, .ribbon-tab-btn",
            "els => els.filter(el => el.offsetParent !== null).length",
        )
        assert visible >= 1, "No navigation tabs visible at tablet size"


class TestHealthEndpoint:
    """Verify the health endpoint works from a browser context."""

    def test_health_endpoint_accessible(self, page, app_server):
        """The /health endpoint should return a JSON response."""
        page.goto(f"{app_server}/health")
        assert "healthy" in page.locator("body").inner_text()


class TestStaticAssets:
    """Verify static assets load correctly."""

    def test_favicon_loads(self, page, app_server):
        """The favicon should be accessible."""
        response = page.goto(f"{app_server}/favicon.png")
        assert response is not None and response.status == 200

    def test_css_loaded_and_applied(self, page, app_server):
        """CSS modules should load and apply custom styles."""
        open_app(page, app_server)
        display = page.eval_on_selector("#ribbonShell", "el => getComputedStyle(el).display")
        assert display in ("flex", "block"), "Custom CSS does not appear to be loaded"

    def test_javascript_loaded(self, page, app_server):
        """script.js should load and define expected global functions."""
        open_app(page, app_server)
        for fn_name in ("switchTab", "renderPlan", "toggleExportMenu"):
            assert page.evaluate(f"() => typeof {fn_name} === 'function'"), (
                f"Expected function {fn_name} not defined"
            )


class TestTouchInteractions:
    """Verify representative touch paths in a real browser."""

    def test_shared_controls_have_touch_targets(self, page, app_server):
        page.set_viewport_size({"width": 375, "height": 667})
        open_app(page, app_server)

        min_height = page.eval_on_selector(
            ".plan-subnav-btn", "el => parseFloat(getComputedStyle(el).minHeight)"
        )
        assert min_height >= 44

        result = page.evaluate(
            """() => {
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
            }"""
        )
        assert result == {
            "tag": "BUTTON",
            "category": "Touch",
            "hashUnchanged": True,
            "minHeight": 44,
        }

    def test_gantt_touch_tap_edits_and_cancel_does_not(self, page, app_server):
        open_app(page, app_server)
        result = page.evaluate(
            """() => {
                const cell = document.createElement('td');
                document.body.appendChild(cell);
                let edits = 0;
                setupGanttEditableCell(cell, () => { edits += 1; });
                const fire = (type, x) => cell.dispatchEvent(new PointerEvent(type, {
                    bubbles: true, pointerId: 41, pointerType: 'touch',
                    button: 0, clientX: x, clientY: 10}));
                fire('pointerdown', 10);
                fire('pointercancel', 10);
                const afterCancel = edits;
                fire('pointerdown', 10);
                fire('pointerup', 12);
                cell.remove();
                return {afterCancel, afterTap: edits};
            }"""
        )
        assert result == {"afterCancel": 0, "afterTap": 1}

    def test_gantt_pointer_drag_moves_once_and_cancel_restores(self, page, app_server):
        open_app(page, app_server)
        result = page.evaluate(
            """() => {
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
                        button: 0, clientX: x, clientY: 10}));

                const movedTask = {
                    start: '2026-09-07', finish: '2026-09-09',
                    duration_days: 3, is_summary: false};
                ganttTasks = [movedTask];
                const movedBar = makeBar();
                setupBarDragListeners(movedBar, movedTask, 0);
                fire(movedBar, 'pointerdown', 51, 0);
                fire(document, 'pointermove', 51, 20);
                fire(document, 'pointerup', 51, 20);

                const cancelledTask = {
                    start: '2026-09-07', finish: '2026-09-09',
                    duration_days: 3, is_summary: false};
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
                    cancelledLeft: cancelledBar.style.left};
                movedBar.remove();
                cancelledBar.remove();
                renderText = originalRender;
                syncGanttStartDateToEditor = originalSyncStart;
                return output;
            }"""
        )
        assert result == {
            "movedStart": "2026-09-09",
            "movedFinish": "2026-09-11",
            "cancelledStart": "2026-09-07",
            "cancelledLeft": "0px",
        }

    def test_noodlesheet_second_touch_edits_selected_cell(self, page, app_server):
        open_app(page, app_server)
        result = page.evaluate(
            r"""() => {
                const host = document.createElement('div');
                document.body.appendChild(host);
                const sheet = new NoodleSheet(host, {
                    sheets: [{
                        name: 'Touch',
                        dbml: 'Table touch {\n  name text\n}',
                        markdown: '| Name |\n| --- |\n| Task |'
                    }]
                });
                const tap = () => {
                    const cell = host.querySelector('td[data-row="0"][data-col="0"]');
                    cell.dispatchEvent(new PointerEvent('pointerdown', {
                        bubbles: true, pointerId: 42, pointerType: 'touch',
                        isPrimary: true, button: 0, clientX: 10, clientY: 10}));
                    cell.dispatchEvent(new PointerEvent('pointerup', {
                        bubbles: true, pointerId: 42, pointerType: 'touch',
                        isPrimary: true, button: 0, clientX: 10, clientY: 10}));
                };
                tap();
                const selected = sheet.selection.row === 0 && sheet.selection.col === 0;
                tap();
                const editing = sheet.editing;
                sheet.destroy();
                host.remove();
                return {selected, editing};
            }"""
        )
        assert result == {"selected": True, "editing": True}

    def test_kanban_has_tap_move_fallback(self, page, app_server):
        open_app(page, app_server)
        result = page.evaluate(
            """() => {
                const board = new KanbanBoard('progress');
                const task = {
                    lineNumber: 2, name: 'Touch task', resourcesArray: [],
                    dependenciesArray: [], labelsArray: [],
                    progressStatus: 'not_started', percent: 0, duration: 1,
                    priority: 'Low', comment: ''};
                const nextTask = {...task, lineNumber: 3, name: 'Next task'};
                const source = {id: 'not-started', title: 'Not Started',
                    name: 'Not Started', tasks: [task, nextTask]};
                const target = {id: 'complete', title: 'Complete',
                    name: 'Complete', tasks: []};
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
                    bubbles: true, key: 'Enter'}));
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
                    button: 0, clientX: x, clientY: 10}));
                fire('pointerdown', 0);
                fire('pointermove', 20);
                fire('pointerup', 20);
                const draggedTo = movedTo;
                document.elementFromPoint = originalElementFromPoint;
                targetBody.remove();
                const label = select.getAttribute('aria-label');
                card.remove();
                return {movedTo, draggedTo, label, opened, reordered};
            }"""
        )
        assert result["movedTo"] == "complete"
        assert result["draggedTo"] == "complete"
        assert result["opened"] == 0
        assert result["reordered"] is None
        assert result["label"].startswith("Move Touch task")

    def test_diagram_pointer_pan_finishes_cleanly(self, page, app_server):
        open_app(page, app_server)
        result = page.evaluate(
            """() => {
                initPbs();
                const container = document.getElementById('pbsContainer');
                container.setPointerCapture = () => {};
                container.hasPointerCapture = () => false;
                pbsPanX = 0;
                pbsPanY = 0;
                const fire = (target, type, x, y) => target.dispatchEvent(
                    new PointerEvent(type, {
                        bubbles: true, pointerId: 61, pointerType: 'touch',
                        button: 0, clientX: x, clientY: y}));
                fire(container, 'pointerdown', 10, 10);
                fire(document, 'pointermove', 35, 25);
                fire(document, 'pointerup', 35, 25);
                return {panX: pbsPanX, panY: pbsPanY, dragging: pbsIsDragging};
            }"""
        )
        assert result == {"panX": 25, "panY": 15, "dragging": False}


class TestBrowserExcelExport:
    """Verify the flagged Excel path stays in-browser and off the UI thread.

    Both of these were `execute_async_script` with a done() callback and a
    bespoke `set_script_timeout`. `page.evaluate` awaits a returned promise, so
    the callback plumbing goes; the timeouts stay, because the second one
    really does build a 1001-task workbook.
    """

    def test_exceljs_load_failure_rejects_and_can_retry(self, page, app_server):
        open_app(page, app_server)
        result = page.evaluate(
            """async () => {
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
                    return {appends: appends, errors: errors};
                } finally {
                    document.head.appendChild = originalAppendChild;
                }
            }""",
        )
        assert result == {
            "appends": 2,
            "errors": ["Failed to load ExcelJS", "Failed to load ExcelJS"],
        }

    def test_large_plan_export_uses_worker_without_api_round_trip(self, page, app_server):
        open_app(page, app_server)
        result = page.evaluate(
            """async () => {
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
                    if (String(args[0]).includes('/api/')
                        || String(args[0]).includes('/render')) {
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
                    return {
                        apiCalls: apiCalls,
                        blobSize: downloadedBlob ? downloadedBlob.size : 0,
                        ticks: ticks,
                        messages: messages,
                        consoleErrors: consoleErrors
                    };
                } catch (error) {
                    return {error: error.message, apiCalls: apiCalls, messages: messages};
                } finally {
                    clearInterval(timer);
                    window.fetch = originalFetch;
                    window.showMessage = originalShowMessage;
                    window.console.error = originalConsoleError;
                    window.URL.createObjectURL = originalCreateObjectURL;
                    window.URL.revokeObjectURL = originalRevokeObjectURL;
                    HTMLAnchorElement.prototype.click = originalAnchorClick;
                }
            }""",
        )

        assert "error" not in result, result
        assert result["consoleErrors"] == [], result["consoleErrors"]
        assert result["apiCalls"] == 0, result
        assert result["blobSize"] > 1000
        assert result["ticks"] > 2
        assert result["messages"][-1]["type"] == "success"
        assert "server CPU 0 ms" in result["messages"][-1]["message"]
