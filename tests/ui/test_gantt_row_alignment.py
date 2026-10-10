"""The Gantt task table and the bar chart must stay row-for-row aligned.

They are two separately scrolling panes, so alignment is by construction: both
headers and every row take their height from `--gantt-row-h` /
`--gantt-header-h` on `.gantt-wrapper`, rather than being measured at render
time. These tests compare real geometry, at the top and scrolled to the
bottom, and with a table header whose content is deliberately taller than its
natural height (a different font, a zoomed browser).
"""

from .helpers import open_project_view

PLAN = "---\ntitle: Row Alignment\nstart: 2026-01-05\n---\n\n" + "".join(
    f"Phase {p}\n" + "".join(f"  Task {p}.{t} @sam 3d\n" for t in range(8))
    for p in range(5)
)

MEASURE = """() => {
    const q = s => document.querySelector(s);
    const r = el => el.getBoundingClientRect();
    const info = [...document.querySelectorAll('#ganttInfoBody tr')];
    const bars = [...document.querySelectorAll('#ganttBody .gantt-bar-row')];
    return {
        n: [info.length, bars.length],
        header: [r(q('#ganttInfoBody').closest('table').tHead).height, r(q('#ganttHeader')).height],
        offsets: [...new Set(info.map((row, i) =>
            Math.round((r(row).top - r(bars[i]).top) * 100) / 100))],
        heights: [...new Set([...info, ...bars].map(row => r(row).height))],
        scroll: [q('.gantt-table-side').scrollTop, q('.gantt-chart-side').scrollTop],
    };
}"""


def _open_gantt(page, app_server):
    open_project_view(page, app_server)
    page.evaluate(
        """v => { const ed = document.getElementById('planEditor');
            ed.value = v; ed.dispatchEvent(new Event('input', {bubbles: true})); }""",
        PLAN,
    )
    page.evaluate("() => switchToView('gantt')")
    page.wait_for_selector("#gantt-view.active")
    page.wait_for_function(
        "() => document.querySelectorAll('#ganttInfoBody tr[data-task-index]').length > 0"
    )
    page.wait_for_timeout(500)


def _assert_locked(page):
    m = page.evaluate(MEASURE)
    assert m["n"][0] == m["n"][1] > 0
    assert m["header"][0] == m["header"][1], m
    assert m["offsets"] == [0], m
    assert len(m["heights"]) == 1, m


def test_rows_line_up(page, app_server):
    _open_gantt(page, app_server)
    _assert_locked(page)
    page.evaluate("() => { document.querySelector('.gantt-table-side').scrollTop = 1e5; }")
    page.wait_for_timeout(300)
    _assert_locked(page)


def test_rows_line_up_with_a_taller_table_header(page, app_server):
    _open_gantt(page, app_server)
    page.add_style_tag(
        content=".gantt-info-table th { font-size: 22px; line-height: 1.6; }"
    )
    page.evaluate("() => relayoutGanttChart()")
    page.wait_for_timeout(300)
    _assert_locked(page)


def test_rows_line_up_on_a_phone(phone, app_server):
    _open_gantt(phone, app_server)
    _assert_locked(phone)

