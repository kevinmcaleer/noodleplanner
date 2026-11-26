"""The table views interface (static/table-shell.js, ui-mode.js).

Opt-in: with `<html data-ui="tables">` the ribbon's tabs give way to a list
of tables down the left (Plan, RAID log, Budget, Resources ...) and a bar of
the open table's views, and the plan's Markdown sits to the left of whichever
view is open. These check, in a real browser:

* the classic interface is untouched until it is switched on, and switching
  back restores it without a reload;
* the sidebar lists the tables, a table opens on its views, and a tab switches
  view through the router;
* the Markdown panel shows beside views that have no editor of their own
  (RAID, the board), opens and closes from the bar, and an edit in it reaches
  the view;
* "New" and the commands sheet stand in for the hidden ribbon;
* a tablet starts on the icon rail with 44px targets, and a phone keeps its
  own shell, fed the same tables.
"""

import pytest

from .helpers import actionable_console_errors, load_plan, open_app

PLAN = """---
title: Table shell
---

Design
  Research @alex 2d
  Wireframes @alex 3d
"""

SHELL_STATE = """() => {
    const shown = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
    return {
        ui: document.documentElement.dataset.ui,
        side: shown(document.getElementById('tableShellSide')),
        bar: shown(document.getElementById('tableShellBar')),
        ribbonTabs: shown(document.querySelector('.ribbon-tabstrip')),
        ribbonBody: shown(document.querySelector('.ribbon-body')),
        titlebar: shown(document.querySelector('.ribbon-titlebar')),
        editorIn: document.querySelector('.editor-panel').parentElement.id
            || document.querySelector('.editor-panel').parentElement.className,
    };
}"""

SIDE_ITEMS = """() => [...document.getElementById('tableShellSide').shadowRoot
    .querySelectorAll('button[data-id]')].map(b => b.dataset.id)"""

TABS = """() => [...document.getElementById('tableShellTabs').shadowRoot
    .querySelectorAll('button[data-id]')].map(b => b.dataset.id)"""


# The toolbar's buttons: inline ones (a trailing * marks a pressed toggle)
# and the menus pinned to its end.
TOOLS = """() => {
    const root = document.getElementById('tableShellTools').shadowRoot;
    const text = (b) => b.textContent.trim() + (b.getAttribute('aria-pressed') === 'true' ? '*' : '');
    return {
        hidden: document.getElementById('tableShellTools').hidden,
        inline: [...root.querySelectorAll('.strip button')].map(text),
        menus: [...root.querySelectorAll('.end button')].map(text),
        open: [...root.querySelectorAll('.menu button')].map(text),
    };
}"""


def tool_click(pg, label, where=".strip, .end"):
    pg.evaluate(
        """([label, where]) => {
            const root = document.getElementById('tableShellTools').shadowRoot;
            const scope = [...root.querySelectorAll(where)];
            const button = scope.flatMap(el => [...el.querySelectorAll('button')])
                .find(b => b.textContent.trim() === label);
            if (!button) throw new Error('no toolbar button ' + label);
            button.click();
        }""",
        [label, where],
    )


def open_tables(pg, app_server, plan=PLAN):
    pg.goto(app_server + "/?ui=tables", wait_until="domcontentloaded")
    pg.wait_for_selector(".ribbon-scope-btn, np-app-bar", state="attached")
    pg.wait_for_function(
        "() => !!window.NoodleTableShell && !!customElements.get('np-side-nav') && !!customElements.get('np-toolbar')"
    )
    if plan:
        load_plan(pg, plan)
    return pg


def current(pg):
    pg.wait_for_function("() => !NavigationController.isTransitioning()")
    return pg.evaluate("() => NavigationController.getCurrentView()")


def side_click(pg, item):
    pg.evaluate(
        """(id) => document.getElementById('tableShellSide').shadowRoot
            .querySelector(`button[data-id="${id}"]`).click()""",
        item,
    )
    pg.wait_for_function("() => !NavigationController.isTransitioning()")


def tab_click(pg, view):
    pg.evaluate(
        """(id) => document.getElementById('tableShellTabs').shadowRoot
            .querySelector(`button[data-id="${id}"]`).click()""",
        view,
    )
    pg.wait_for_function("(id) => NavigationController.getCurrentView() === id", arg=view)


def markdown_open(pg):
    return pg.evaluate(
        """() => {
            const panel = document.querySelector('.editor-panel');
            return !panel.classList.contains('collapsed') && panel.getBoundingClientRect().width > 100;
        }"""
    )


def test_the_classic_interface_is_untouched_by_default(page, app_server):
    open_app(page, app_server)
    state = page.evaluate(SHELL_STATE)
    assert state["ui"] == "classic"
    assert not state["side"] and not state["bar"]
    assert state["ribbonTabs"] and state["ribbonBody"]
    assert state["editorIn"] == "editor-layout"


def test_ui_tables_swaps_the_ribbon_tabs_for_the_sidebar_and_bar(page, app_server):
    open_tables(page, app_server)
    state = page.evaluate(SHELL_STATE)
    assert state["ui"] == "tables"
    assert state["side"] and state["bar"] and state["titlebar"]
    assert not state["ribbonTabs"] and not state["ribbonBody"]
    assert state["editorIn"] == "tableShellMarkdown"
    # It opens on the Dashboard, as the mock-up does.
    assert current(page) == "project-report"
    # ?ui=tables is remembered for the next visit.
    assert page.evaluate("() => localStorage.getItem('np-ui')") == "tables"
    assert actionable_console_errors(page) == []


def test_the_sidebar_lists_the_tables_in_order(page, app_server):
    open_tables(page, app_server)
    assert page.evaluate(SIDE_ITEMS) == [
        "table:dashboard", "table:plan", "table:raid", "table:highlights", "table:lessons",
        "table:budget", "table:benefits", "table:resources", "table:stakeholders",
        "cmd:guide", "cmd:settings",
    ]


def test_a_table_opens_on_its_views_and_a_tab_switches_view(page, app_server):
    open_tables(page, app_server)
    side_click(page, "table:plan")
    assert current(page) == "tasks"
    assert page.evaluate(TABS)[:4] == ["tasks", "gantt", "kanban", "calendar"]
    assert page.inner_text("#tableShellTitle") == "Plan"

    tab_click(page, "gantt")
    assert page.get_attribute("#tableShellTabs", "active") == "gantt"
    assert page.locator("#gantt-view").is_visible()

    side_click(page, "table:resources")
    assert current(page) == "resources"
    assert page.evaluate(TABS) == ["resources", "resource-sheet", "user-workload", "timesheet"]
    marked = page.evaluate(
        """() => document.getElementById('tableShellSide').shadowRoot
            .querySelector('button[aria-current="page"]').dataset.id"""
    )
    assert marked == "table:resources"

    # Back to Plan: on the view it was left on, not its first.
    side_click(page, "table:plan")
    assert current(page) == "gantt"


def test_every_table_view_is_reachable_from_its_tab(page, app_server):
    open_tables(page, app_server)
    tables = page.evaluate("() => NoodleTableCatalogue.tables().map(t => [t.id, t.views.map(v => v.id)])")
    for table, views in tables:
        side_click(page, f"table:{table}")
        assert page.evaluate(TABS) == views
        for view in views:
            tab_click(page, view)
    assert actionable_console_errors(page) == []


def test_the_markdown_sits_beside_views_that_have_no_editor_of_their_own(page, app_server):
    open_tables(page, app_server)
    for table in ("raid", "budget", "plan"):
        side_click(page, f"table:{table}")
        if not markdown_open(page):
            page.click("#tableShellMarkdownBtn")
            page.wait_for_function("() => !document.querySelector('.editor-panel').classList.contains('collapsed')")
        boxes = page.evaluate(
            """() => {
                const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width }; };
                return {
                    side: box(document.getElementById('tableShellSide')),
                    editor: box(document.querySelector('.editor-panel')),
                    view: box(document.querySelector('#main-content > .tab-content.active')),
                };
            }"""
        )
        assert boxes["editor"]["width"] > 200, table
        assert boxes["side"]["right"] <= boxes["editor"]["left"] + 1, table
        assert boxes["editor"]["right"] <= boxes["view"]["left"] + 1, table
        assert boxes["view"]["width"] > 300, table


def test_the_markdown_button_opens_and_closes_the_panel(page, app_server):
    open_tables(page, app_server)
    side_click(page, "table:raid")
    button = page.locator("#tableShellMarkdownBtn")
    was_open = markdown_open(page)
    assert button.get_attribute("aria-pressed") == str(was_open).lower()

    button.click()
    page.wait_for_function(
        "(was) => document.querySelector('.editor-panel').classList.contains('collapsed') === was", arg=was_open
    )
    assert button.get_attribute("aria-pressed") == str(not was_open).lower()
    if was_open:
        # Closed, it leaves the view the whole width: no strip is left behind.
        # (once the panel's width transition has run).
        page.wait_for_function("() => document.getElementById('tableShellMarkdown').getBoundingClientRect().width < 2")

    button.click()
    page.wait_for_function(
        "(was) => document.querySelector('.editor-panel').classList.contains('collapsed') !== was", arg=was_open
    )
    assert markdown_open(page) == was_open


def test_an_edit_in_the_markdown_reaches_the_board_beside_it(page, app_server):
    open_tables(page, app_server)
    side_click(page, "table:plan")
    tab_click(page, "kanban")
    # The board's own copy of the editor is the classic interface's.
    assert not page.locator("#kanbanEditorPanel").is_visible()
    page.evaluate(
        """() => {
            const editor = document.getElementById('planEditor');
            editor.value = editor.value.replace('Wireframes', 'Storyboards');
            editor.dispatchEvent(new Event('input', { bubbles: true }));
        }"""
    )
    page.wait_for_function("() => document.getElementById('kanban-tab').innerText.includes('Storyboards')")


def test_new_creates_in_the_open_table_even_from_a_view_with_no_create_action(page, app_server):
    open_tables(page, app_server)
    side_click(page, "table:plan")
    new = page.locator("#tableShellNewBtn")
    page.wait_for_function("() => !document.getElementById('tableShellNewBtn').hidden")
    label = page.inner_text("#tableShellNewLabel")
    assert label

    # The Gantt has no create action of its own; it still adds a task.
    tab_click(page, "gantt")
    page.wait_for_function("() => !document.getElementById('tableShellNewBtn').hidden")
    assert page.inner_text("#tableShellNewLabel") == label
    assert new.is_visible()

    # And it is the table's own: the RAID log adds a RAID item, not a task.
    side_click(page, "table:raid")
    page.wait_for_function("(was) => document.getElementById('tableShellNewLabel').textContent !== was", arg=label)
    assert "RAID" in page.inner_text("#tableShellNewLabel")


def test_the_commands_button_opens_the_ribbon_s_commands_for_the_view(page, app_server):
    open_tables(page, app_server)
    side_click(page, "table:raid")
    page.click("#tableShellMoreBtn")
    page.wait_for_function("() => document.getElementById('phoneSheet').isOpen")
    labels = page.evaluate(
        """() => [...document.getElementById('phoneSheet').shadowRoot.querySelectorAll('button')]
            .map(b => b.textContent.trim().split('\\n')[0].trim())"""
    )
    assert "New Risk" in labels
    page.keyboard.press("Escape")
    page.wait_for_function("() => !document.getElementById('phoneSheet').isOpen")


def test_outside_a_project_s_tables_the_bar_and_markdown_step_aside(page, app_server):
    open_tables(page, app_server)
    page.evaluate("() => switchToView('guide')")
    page.wait_for_function("() => NavigationController.getCurrentView() === 'guide'")
    state = page.evaluate(SHELL_STATE)
    assert state["side"] and not state["bar"]
    assert not page.locator("#tableShellMarkdown").is_visible()
    assert not page.locator("#tableShellTools").is_visible()
    widths = page.evaluate(
        """() => [document.getElementById('guide-tab').getBoundingClientRect().width,
                  document.getElementById('main-content').getBoundingClientRect().width,
                  document.getElementById('tableShellSide').getBoundingClientRect().width]"""
    )
    assert widths[0] == pytest.approx(widths[1] - widths[2], abs=2)

    side_click(page, "table:plan")
    assert page.evaluate(SHELL_STATE)["bar"]


def test_the_portfolio_keeps_the_bar_with_its_sub_views_as_tabs(page, app_server):
    """The ribbon was the portfolio's only navigation (#1513); with it hidden
    the bar has to be."""
    open_tables(page, app_server)
    page.evaluate("() => switchToView('portfolio')")
    page.wait_for_function("() => NavigationController.getCurrentView() === 'portfolio'")
    page.wait_for_function("() => document.documentElement.dataset.tableScope === 'portfolio'")
    assert page.evaluate(SHELL_STATE)["bar"]
    assert page.inner_text("#tableShellTitle") == "Portfolio"
    assert page.evaluate(TABS) == page.evaluate("() => NoodleViewCatalogue.portfolioViews().map(v => v.id)")
    # No plan text to show beside a portfolio.
    assert not page.locator("#tableShellMarkdown").is_visible()
    assert not page.locator("#tableShellMarkdownBtn").is_visible()

    page.evaluate(
        """() => document.getElementById('tableShellTabs').shadowRoot
            .querySelector('button[data-id="status"]').click()"""
    )
    page.wait_for_function("() => currentPortfolioSubview === 'status'")
    assert page.get_attribute("#tableShellTabs", "active") == "status"
    # Its commands that are not view switches are on the toolbar.
    page.wait_for_function("(js) => eval(js)().inline.includes('New Project')", arg=TOOLS)


def test_the_toolbar_shows_the_view_s_commands_and_the_report_menus(page, app_server):
    open_tables(page, app_server)
    side_click(page, "table:plan")
    tab_click(page, "gantt")
    page.wait_for_function("(js) => eval(js)().inline.includes('Critical Path')", arg=TOOLS)
    tools = page.evaluate(TOOLS)
    assert not tools["hidden"] and page.locator("#tableShellTools").is_visible()
    # Gantt Tools, in the ribbon's own groups; the scale in use is pressed.
    assert {"Link", "Critical Path", "Weeks", "Months", "Set Baseline"} <= set(tools["inline"])
    assert sum(1 for label in tools["inline"] if label.rstrip("*") in ("Days", "Weeks", "Months", "Quarters", "Years")
               and label.endswith("*")) == 1
    assert tools["menus"] == ["Reports", "Export", "Import"]
    # Nothing that only switches view (the tabs do that), and nothing the
    # ribbon marks "not available yet".
    labels = {label.rstrip("*") for label in tools["inline"]}
    assert not labels & {"Gantt", "Board", "Tasks", "Timeline", "Calendar"}
    unavailable = page.evaluate(
        """async () => (await ribbonCommandTabs()).flatMap(t => t.groups.flatMap(g => g.items))
            .filter(i => i.disabled).map(i => i.label)"""
    )
    assert not labels & set(unavailable)


def test_a_toolbar_toggle_runs_the_ribbon_command_and_shows_pressed(page, app_server):
    open_tables(page, app_server)
    side_click(page, "table:plan")
    tab_click(page, "gantt")
    page.wait_for_function("(js) => eval(js)().inline.some(l => l.startsWith('Weeks'))", arg=TOOLS)
    tool_click(page, "Weeks")
    page.wait_for_function("(js) => eval(js)().inline.includes('Weeks*')", arg=TOOLS)
    assert page.evaluate("() => ganttScale") == "weeks"
    assert "Days" in page.evaluate(TOOLS)["inline"]


def test_export_opens_the_ribbon_s_formats_as_a_menu_under_the_button(page, app_server):
    open_tables(page, app_server)
    side_click(page, "table:plan")
    page.wait_for_function("(js) => eval(js)().menus.includes('Export')", arg=TOOLS)
    tool_click(page, "Export")
    page.wait_for_function("(js) => eval(js)().open.length > 0", arg=TOOLS)
    formats = page.evaluate(TOOLS)["open"]
    assert "PDF" in formats and "PowerPoint" in formats and any("Excel" in f for f in formats)
    # A menu, not the phone's sheet, and placed under its button.
    assert not page.evaluate("() => document.getElementById('phoneSheet').isOpen")
    boxes = page.evaluate(
        """() => {
            const root = document.getElementById('tableShellTools').shadowRoot;
            const button = [...root.querySelectorAll('.end button')].find(b => b.textContent.trim() === 'Export');
            const menu = root.querySelector('.menu').getBoundingClientRect();
            const b = button.getBoundingClientRect();
            return { below: menu.top >= b.bottom, inside: menu.right <= window.innerWidth && menu.left >= 0,
                     expanded: button.getAttribute('aria-expanded') };
        }"""
    )
    assert boxes == {"below": True, "inside": True, "expanded": "true"}

    page.keyboard.press("Escape")
    page.wait_for_function("(js) => eval(js)().open.length === 0", arg=TOOLS)
    focused = page.evaluate(
        "() => document.getElementById('tableShellTools').shadowRoot.activeElement?.textContent.trim()"
    )
    assert focused == "Export"


def test_the_reports_menu_opens_a_report(page, app_server):
    open_tables(page, app_server)
    side_click(page, "table:plan")
    page.wait_for_function("(js) => eval(js)().menus.includes('Reports')", arg=TOOLS)
    tool_click(page, "Reports")
    page.wait_for_function("(js) => eval(js)().open.includes('Slippage')", arg=TOOLS)
    assert {"Project Report", "Highlights", "Analysis", "By Assignment"} <= set(page.evaluate(TOOLS)["open"])
    tool_click(page, "Slippage", where=".menu")
    page.wait_for_function("() => NavigationController.getCurrentView() === 'slippage'")
    assert page.get_attribute("#tableShellTabs", "active") == "slippage"


def test_a_view_s_own_export_is_told_apart_from_the_plan_s(page, app_server):
    open_tables(page, app_server)
    side_click(page, "table:raid")
    page.wait_for_function("(js) => eval(js)().inline.includes('New Risk')", arg=TOOLS)
    tools = page.evaluate(TOOLS)
    assert "Export" in tools["inline"]
    assert tools["menus"] == ["Reports", "Export plan", "Import plan"]
    tool_click(page, "Export", where=".strip")
    page.wait_for_function("(js) => eval(js)().open.length > 0", arg=TOOLS)
    assert page.evaluate(TOOLS)["open"] == ["Excel (.xlsx)", "Markdown (.md)"]


def test_switching_back_to_classic_restores_the_ribbon_without_a_reload(page, app_server):
    open_tables(page, app_server)
    side_click(page, "table:plan")
    page.evaluate("() => NoodleUiMode.set('classic')")
    state = page.evaluate(SHELL_STATE)
    assert state["ui"] == "classic"
    assert not state["side"] and not state["bar"]
    assert state["ribbonTabs"] and state["ribbonBody"]
    assert state["editorIn"] == "editor-layout"
    # In its old place: before the splitter, before the view.
    order = page.evaluate("() => [...document.querySelector('.editor-layout').children].map(e => e.className.split(' ')[0])")
    assert order[:3] == ["editor-panel", "editor-splitter", "output-panel"]

    page.evaluate("() => NoodleUiMode.set('tables')")
    assert page.evaluate(SHELL_STATE)["editorIn"] == "tableShellMarkdown"
    assert actionable_console_errors(page) == []


def test_settings_layout_offers_the_interface(page, app_server):
    open_app(page, app_server)
    page.evaluate("() => { openSettingsPanel(); switchSettingsTab('layout'); }")
    assert page.locator('input[name="settingsUiMode"][value="classic"]').is_checked()
    page.locator('input[name="settingsUiMode"][value="tables"]').check()
    assert page.evaluate("() => document.documentElement.dataset.ui") == "tables"
    assert page.evaluate(SHELL_STATE)["side"]


@pytest.mark.parametrize("device", ["tablet_portrait", "tablet_landscape"])
def test_a_tablet_starts_on_the_icon_rail_with_touch_targets(device, device_page, app_server):
    pg = open_tables(device_page(device), app_server)
    side_click(pg, "table:plan")
    assert pg.evaluate("() => document.getElementById('tableShellSide').hasAttribute('collapsed')")
    assert pg.evaluate("() => document.getElementById('tableShellSide').getBoundingClientRect().width") <= 64
    small = pg.evaluate(
        """() => {
            const out = [];
            const walk = (root) => {
                for (const el of root.querySelectorAll('*')) {
                    if (el.shadowRoot) walk(el.shadowRoot);
                    if (el.tagName !== 'BUTTON') continue;
                    const r = el.getBoundingClientRect();
                    if (r.width && (r.width < 44 || r.height < 44)) {
                        out.push(`${el.getAttribute('aria-label') || el.textContent.trim()} ${Math.round(r.width)}x${Math.round(r.height)}`);
                    }
                }
            };
            walk(document.getElementById('tableShellSide'));
            walk(document.getElementById('tableShellBar'));
            walk(document.getElementById('tableShellTools'));
            return out;
        }"""
    )
    assert small == []
    # The rail's buttons keep their names for a screen reader.
    names = pg.evaluate(
        """() => [...document.getElementById('tableShellSide').shadowRoot.querySelectorAll('button[data-id]')]
            .map(b => b.getAttribute('aria-label'))"""
    )
    assert "RAID log" in names and all(names)

    # The view keeps most of the screen, and nothing scrolls sideways.
    share = pg.evaluate(
        """() => document.querySelector('#main-content > .tab-content.active').getBoundingClientRect().width
            / window.innerWidth"""
    )
    if not markdown_open(pg):
        assert share > 0.85
    assert pg.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth")


def test_the_markdown_fits_beside_a_view_on_a_portrait_tablet(tablet_portrait, app_server):
    pg = open_tables(tablet_portrait, app_server)
    side_click(pg, "table:plan")
    if not markdown_open(pg):
        pg.evaluate("() => document.getElementById('tableShellMarkdownBtn').click()")
        pg.wait_for_function("() => !document.querySelector('.editor-panel').classList.contains('collapsed')")
    pg.wait_for_function("() => document.querySelector('.editor-panel').getBoundingClientRect().width > 200")
    boxes = pg.evaluate(
        """() => {
            const e = document.querySelector('.editor-panel').getBoundingClientRect();
            const v = document.querySelector('#main-content > .tab-content.active').getBoundingClientRect();
            return { editorHeight: e.height, viewHeight: v.height, editorRight: e.right, viewLeft: v.left, viewWidth: v.width };
        }"""
    )
    # A column the height of the view, not the classic 40vh strip above it.
    assert boxes["editorHeight"] == pytest.approx(boxes["viewHeight"], abs=2)
    assert boxes["editorRight"] <= boxes["viewLeft"] + 1
    assert boxes["viewWidth"] > 280


def test_a_phone_keeps_its_shell_with_the_tables_in_the_drawer(phone, app_server):
    pg = open_tables(phone, app_server)
    state = pg.evaluate(SHELL_STATE)
    assert not state["side"] and not state["bar"]
    assert state["editorIn"] == "editor-layout"

    pg.evaluate("() => document.getElementById('phoneAppBar').menuButton.click()")
    pg.wait_for_function("() => document.getElementById('phoneNavDrawer').hasAttribute('open')")
    listed = pg.evaluate(
        """() => [...document.getElementById('phoneNavDrawer').shadowRoot
            .querySelectorAll('button[data-id^="table:"]')].map(b => b.dataset.id)"""
    )
    assert listed[:3] == ["table:dashboard", "table:plan", "table:raid"]
    assert len(listed) == 9

    pg.evaluate(
        """() => document.getElementById('phoneNavDrawer').shadowRoot
            .querySelector('button[data-id="table:resources"]').click()"""
    )
    pg.wait_for_function("() => NavigationController.getCurrentView() === 'resources'")
    chips = pg.evaluate(
        """() => [...document.getElementById('phoneViewChips').shadowRoot
            .querySelectorAll('button[data-id]')].map(b => b.dataset.id)"""
    )
    assert chips == ["resources", "resource-sheet", "user-workload", "timesheet"]
    assert pg.get_attribute("#phoneViewChips", "active") == "resources"
