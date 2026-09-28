"""The reports' tasks as <np-task-row>s, and their tables' cells as its parts.

Every report used to draw a task its own way: tables with a whole cell
filled in one of three hex RAG palettes, "NN%" as text, "@sam" as text. A
report that is a list of tasks is now a list of read-only rows -- the
dashboard's Milestones and Up Next, the Look Ahead, the User Workload and
the portfolio Look-Ahead -- and a report that is genuinely a table uses the
row's box, <np-rag> dot and people stack in its cells. These pin that each
report still shows, opens, copies, exports, sorts and filters what it did.

Usage:
    uv run pytest tests/ui/test_report_rows.py -q
"""

from datetime import date, timedelta

import pytest

from .helpers import click_scope, load_plan, open_app

pytestmark = pytest.mark.ui

TODAY = date.today()


def _day(offset):
    return (TODAY + timedelta(days=offset)).isoformat()


# Dates relative to today, so the Look Ahead always has one overdue task and
# the dashboard always has milestones ahead.
PLAN = f"""---
title: Report rows
Resources:
  - @sam: Sam Smith, Developer
  - @jo: Jo Lee, Reviewer
---

Discovery
  Research @sam 3d {_day(-20)} 40%
  Sign-off 0d {_day(-10)} 100%
Build
  API @sam @jo 5d {_day(2)}
  Launch 0d {_day(9)}
"""

NO_MILESTONES = """---
title: No milestones
---

Work
  Only task 2d
"""


def _rows(page, selector):
    return page.evaluate(
        """sel => [...document.querySelectorAll(sel)].map(r => ({
            name: r.getAttribute('name'),
            density: r.getAttribute('density'),
            readonly: r.hasAttribute('readonly'),
            percent: r.getAttribute('percent'),
            meta: r.getAttribute('meta'),
            rag: r.getAttribute('rag'),
            ragLabel: r.getAttribute('rag-label'),
            resources: r.getAttribute('resources'),
            data: { ...r.dataset },
        }))""",
        selector,
    )


def _view(page, view_id):
    page.evaluate(f"switchToView('{view_id}')")


@pytest.fixture
def reported(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    return page


# ── The dashboard ───────────────────────────────────────────────────────


def test_dashboard_milestones_are_compact_read_only_rows(reported):
    _view(reported, "project-report")
    reported.wait_for_selector("#reportMilestonesTable np-task-row")
    rows = _rows(reported, "#reportMilestonesTable np-task-row")
    assert [r["name"] for r in rows] == ["Sign-off", "Launch"]
    assert all(r["density"] == "compact" and r["readonly"] for r in rows), rows
    sign_off, launch = rows
    assert sign_off["percent"] == "100" and sign_off["rag"] == "Complete"
    assert launch["data"]["date"] == _day(9)
    assert launch["meta"], "the milestone's date is in its details"


def test_a_dashboard_row_name_opens_the_task(reported):
    _view(reported, "project-report")
    reported.locator("#reportMilestonesTable np-task-row[name='Launch'] button.name").click()
    reported.wait_for_function("() => document.getElementById('taskName').value === 'Launch'")


def test_a_report_row_shows_progress_but_does_not_tick(reported):
    _view(reported, "project-report")
    row = reported.locator("#reportMilestonesTable np-task-row[name='Launch']")
    assert row.locator("np-checkbox").evaluate("cb => cb.inert")


def test_milestones_show_the_baseline_variance(reported):
    reported.evaluate(
        """day => { baselineItems = [{ name: 'Launch', start: day, finish: day }];
            updateReportMilestones(lastRenderedTasks); }""",
        _day(7),
    )
    rows = {r["name"]: r for r in _rows(reported, "#reportMilestonesTable np-task-row")}
    assert rows["Launch"]["meta"].endswith("vs baseline"), rows["Launch"]["meta"]
    assert rows["Sign-off"]["meta"].endswith("new since baseline")
    header = reported.eval_on_selector("#reportMilestonesTable", "l => l.dataset.copyHeader")
    assert header == "Milestone\tDate\tBL Finish\tVariance\tRAG"


def test_up_next_rows_keep_their_status_words(reported):
    _view(reported, "project-report")
    reported.wait_for_selector("#reportUpNextTable np-task-row")
    rows = _rows(reported, "#reportUpNextTable np-task-row")
    names = [r["name"] for r in rows]
    assert "API" in names, rows
    api = next(r for r in rows if r["name"] == "API")
    assert api["density"] == "compact" and api["readonly"]
    assert api["ragLabel"] == api["data"]["rag"], "the dot is named by the status the slide shows"
    assert api["data"]["start"] and api["data"]["finish"]


def test_copy_as_text_still_copies_the_table(reported):
    _view(reported, "project-report")
    reported.wait_for_selector("#reportMilestonesTable np-task-row")
    reported.evaluate(
        """() => { window.__copied = null;
            Object.defineProperty(navigator, 'clipboard', { configurable: true,
                value: { writeText: t => { window.__copied = t; return Promise.resolve(); } } }); }"""
    )
    reported.locator("button[aria-label='Copy milestones as text']").click()
    reported.wait_for_function("() => window.__copied !== null")
    lines = reported.evaluate("() => window.__copied").split("\n")
    assert lines[0] == "Milestone\tDate\tRAG"
    assert lines[1:] == ["Sign-off\t" + _day(-10) + "\tComplete", "Launch\t" + _day(9) + "\tNot Started"]


def test_the_powerpoint_export_reads_the_rows(reported):
    _view(reported, "project-report")
    reported.wait_for_selector("#reportUpNextTable np-task-row")
    captured = {}

    def handle(route):
        captured["payload"] = route.request.post_data_json
        route.fulfill(status=200, body=b"pptx", content_type="application/octet-stream")

    reported.route("**/api/export-report-pptx", handle)
    reported.evaluate("() => localStorage.setItem('np-server-exports', '1')")
    reported.evaluate("exportReportPptx()")  # awaited: the request has been made
    payload = captured["payload"]
    assert payload["milestones"] == [
        {"name": "Sign-off", "date": _day(-10), "rag": "Complete"},
        {"name": "Launch", "date": _day(9), "rag": "Not Started"},
    ]
    up_next = {u["name"]: u for u in payload["up_next"]}
    rows = {r["name"]: r for r in _rows(reported, "#reportUpNextTable np-task-row")}
    assert set(up_next) == set(rows)
    for name, item in up_next.items():
        assert item == {"name": name, "start": rows[name]["data"]["start"],
                        "finish": rows[name]["data"]["finish"], "rag": rows[name]["data"]["rag"]}


def test_an_empty_quad_says_so(page, app_server):
    open_app(page, app_server)
    load_plan(page, NO_MILESTONES)
    _view(page, "project-report")
    page.wait_for_selector("#reportMilestonesTable", state="attached")
    assert page.locator("#reportMilestonesTable np-task-row").count() == 0
    content = page.evaluate(
        "() => getComputedStyle(document.getElementById('reportMilestonesTable'), '::after').content"
    )
    assert "No upcoming milestones" in content


# ── Look Ahead and User Workload ────────────────────────────────────────


def test_look_ahead_lists_are_task_rows(reported):
    _view(reported, "lookahead")
    reported.wait_for_selector("#lookaheadOverdueList np-task-row")
    overdue = _rows(reported, "#lookaheadOverdueList np-task-row")
    assert [r["name"] for r in overdue] == ["Research"]
    research = overdue[0]
    assert research["readonly"] and research["density"] is None
    assert "late" in research["meta"], research["meta"]
    assert research["resources"] == "Sam Smith"
    upcoming = {r["name"]: r for r in _rows(reported, "#lookaheadUpcomingList np-task-row")}
    assert "API" in upcoming, upcoming
    assert upcoming["API"]["resources"] == "Sam Smith, Jo Lee"


def test_a_look_ahead_name_opens_the_task(reported):
    _view(reported, "lookahead")
    reported.locator("#lookaheadOverdueList np-task-row[name='Research'] button.name").click()
    reported.wait_for_function("() => document.getElementById('taskName').value === 'Research'")


def test_user_workload_is_a_list_of_rows_per_user(reported):
    _view(reported, "user-workload")
    reported.wait_for_selector("#userWorkloadSections .user-workload-list np-task-row")
    lists = reported.evaluate(
        """() => [...document.querySelectorAll('#userWorkloadSections .user-workload-section')].map(s => ({
            user: s.querySelector('h3').textContent,
            rows: [...s.querySelectorAll('np-task-row')].map(r => [r.getAttribute('name'), r.hasAttribute('resources')]),
        }))"""
    )
    by_user = {entry["user"]: entry["rows"] for entry in lists}
    assert by_user["👤 Sam Smith"] == [["Research", False], ["API", False]], lists
    assert by_user["👤 Jo Lee"] == [["API", False]], lists


# ── Tables: the row's parts in their cells ──────────────────────────────


def test_the_milestones_table_uses_the_box_and_the_dot(reported):
    _view(reported, "milestones")
    reported.wait_for_selector("#milestonesTableBody tr")
    cells = reported.evaluate(
        """() => [...document.querySelectorAll('#milestonesTableBody tr')].map(tr => {
            const box = tr.querySelector('.report-completion np-checkbox');
            const dot = tr.querySelector('np-rag');
            return { box: !!box && box.inert, checked: !!box && box.hasAttribute('checked'),
                     figure: tr.querySelector('.report-completion').textContent,
                     rag: dot && dot.getAttribute('status'), labelled: !!dot && dot.hasAttribute('labelled'),
                     hexFill: [...tr.children].some(td => /rag-/.test(td.className)) };
        })"""
    )
    assert cells[0] == {"box": True, "checked": True, "figure": "100%", "rag": "Complete",
                        "labelled": True, "hexFill": False}, cells


def test_the_rag_dot_says_its_status(reported):
    _view(reported, "milestones")
    reported.wait_for_selector("#milestonesTableBody np-rag")
    dot = reported.evaluate(
        """() => { const r = document.querySelector('#milestonesTableBody np-rag');
            const d = r.shadowRoot.querySelector('.dot'), l = r.shadowRoot.querySelector('.label');
            return { colour: d.dataset.rag, label: l.textContent, shown: !l.hidden,
                     hidden: d.getAttribute('aria-hidden') }; }"""
    )
    assert dot == {"colour": "blue", "label": "Complete", "shown": True, "hidden": "true"}


def test_tasks_by_assignment_use_the_rows_parts(reported):
    _view(reported, "assignments")
    reported.wait_for_selector("#assignmentsGroups .assignment-group")
    api = reported.locator('#assignmentsGroups .assignment-group[data-person="sam smith"] tr', has_text="API")
    assert api.locator(".report-completion np-checkbox").count() == 1
    assert api.locator(".report-status np-rag").count() == 1
    assert api.locator("np-resource-stack").get_attribute("names") == "Jo Lee"


def test_slippage_status_is_a_labelled_dot(reported):
    reported.evaluate(
        """days => { baselineItems = [{ name: 'API', start: days[0], finish: days[0] }];
            updateSlippageView({ tasks: lastRenderedTasks }, ''); }""",
        [_day(-5)],
    )
    _view(reported, "slippage")
    reported.wait_for_selector("#slippageReport .slippage-section--tasks np-rag")
    dot = reported.locator("#slippageReport .slippage-section--tasks tr", has_text="API").locator("np-rag")
    assert dot.get_attribute("label") == "Slipped"
    assert dot.get_attribute("status") == "red"


# ── The portfolio ───────────────────────────────────────────────────────

HARBOUR = f"""---
title: Harbour
Resources:
  - @kim: Kim Ito, Lead
---

Move
  Pack @kim 4d {_day(-12)} 25%
  Ship @kim 2d {_day(3)}
"""


@pytest.fixture
def portfolio(page, app_server):
    open_app(page, app_server)
    ids = page.evaluate(
        "([a, b]) => [createProject('Riverside', a).id, createProject('Harbour', b).id]", [PLAN, HARBOUR]
    )
    click_scope(page, "portfolio")
    return page, ids


def test_portfolio_look_ahead_rows_sort_and_filter(portfolio):
    page, _ = portfolio
    page.evaluate("switchPortfolioView('lookahead')")
    page.wait_for_selector("#portfolioOverdueList np-task-row")
    overdue = _rows(page, "#portfolioOverdueList np-task-row")
    assert {r["name"] for r in overdue} == {"Research", "Pack"}
    assert all(r["readonly"] and r["data"]["project"] in r["meta"] for r in overdue), overdue

    page.select_option("#portfolioOverdueSort", "daysLate:desc")
    assert [r["name"] for r in _rows(page, "#portfolioOverdueList np-task-row")] == ["Research", "Pack"]
    page.select_option("#portfolioOverdueSort", "project")
    assert [r["name"] for r in _rows(page, "#portfolioOverdueList np-task-row")] == ["Pack", "Research"]

    page.select_option("#portfolioLookAheadProjectFilter", "Harbour")
    visible = page.eval_on_selector_all(
        ".portfolio-lookahead-row", "els => els.filter(e => e.offsetParent).map(e => e.getAttribute('name'))"
    )
    assert set(visible) == {"Pack", "Ship"}


def test_a_portfolio_look_ahead_name_opens_its_task(portfolio):
    page, ids = portfolio
    page.evaluate("switchPortfolioView('lookahead')")
    page.wait_for_selector("#portfolioOverdueList np-task-row[name='Pack']")
    page.evaluate("() => { window.__opened = null; openPortfolioLookAheadTask = (p, t) => { window.__opened = [p, t]; }; }")
    page.locator("#portfolioOverdueList np-task-row[name='Pack'] button.name").click()
    assert page.evaluate("() => window.__opened") == [ids[1], "Pack"]


def test_programme_dependencies_use_the_dot(portfolio):
    page, ids = portfolio
    page.evaluate(
        """([a, b]) => saveAllProgrammeDependencies([{ id: 'd1', from_project_id: a, from_task_name: 'API',
            to_project_id: b, to_task_name: 'Ship', lag_days: 0 }])""",
        ids,
    )
    page.evaluate("switchPortfolioView('dependencies')")
    page.wait_for_selector("#portfolioDependenciesView .dep-table np-rag.dep-rag")
    dot = page.locator("#portfolioDependenciesView .dep-table tbody np-rag.dep-rag")
    reason = page.text_content("#portfolioDependenciesView .dep-table tbody .dep-reason")
    assert dot.get_attribute("label") == reason
    assert dot.get_attribute("status") in {"red", "amber", "green", ""}
