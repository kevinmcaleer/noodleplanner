"""The Gantt task table and the bar chart must stay row-for-row aligned."""

from .helpers import open_project_view

PLAN = """---
title: Row Alignment
start: 2026-01-05
---

Phase One
  Design @sam 3d
  Review @jo 2d
Phase Two
  Build @sam 4d
  Ship @jo 2d
"""

MEASURE = """() => {
    const info = [...document.querySelectorAll('#ganttInfoBody tr')];
    const bars = [...document.querySelectorAll('#ganttBody .gantt-bar-row')];
    const top = el => Math.round(el.getBoundingClientRect().top);
    return {
        infoTops: info.map(top), barTops: bars.map(top),
        infoH: info.map(r => r.getBoundingClientRect().height),
        barH: bars.map(r => r.getBoundingClientRect().height),
    };
}"""


def test_rows_line_up(page, app_server):
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
    m = page.evaluate(MEASURE)
    assert m["infoTops"] == m["barTops"]
    assert m["infoH"] == m["barH"]
