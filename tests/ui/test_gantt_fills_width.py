"""A short Gantt project's timeline fills the chart pane, however wide."""

from .helpers import open_project_view

PLAN = """---
title: Short Plan
start: 2026-01-05
---

Design 2d
Build 2d
"""


def test_timeline_fills_chart_pane(page, app_server):
    page.set_viewport_size({"width": 2400, "height": 900})
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
    m = page.evaluate(
        """() => {
            const pane = document.querySelector('.gantt-chart-side').getBoundingClientRect();
            const cells = [...document.querySelectorAll('#ganttHeader .gantt-header-cell')];
            return {
                paneRight: pane.right,
                lastCellRight: Math.max(...cells.map(c => c.getBoundingClientRect().right)),
                dayWidth: ganttPixelsPerDay,
            };
        }"""
    )
    # Header cells run to the pane's right edge, not stopping at the last task.
    assert m["lastCellRight"] >= m["paneRight"] - m["dayWidth"] - 1
