"""The Timeline panel above the Gantt chart follows its pane's width.

#1523 stretched the chart *below* it; the panel's own axis was sized once, at
render, so a pane that changed width without a window resize or a splitter
drag (the properties panel opening or closing, say) left it short of the
right edge.
"""

from .helpers import open_project_view, set_editor_value

PLAN = """---
title: Panel Plan
start: 2026-01-05
---

Phase One
  Research @sam 3d 100%
  Build @jo 7d
Phase Two
  Ship @sam 2d
"""

WIDTHS = """() => {
    const w = document.querySelector('#gantt-view .embedded-timeline-wrapper');
    const l = document.getElementById('gantt-view-timeline-line');
    return {wrapper: w.offsetWidth, line: l.offsetWidth};
}"""

SET_WRAPPER_WIDTH = """px => {
    const w = document.querySelector('#gantt-view .embedded-timeline-wrapper');
    w.style.width = px + 'px';
}"""


def test_timeline_panel_refills_when_its_pane_widens(page, app_server):
    page.set_viewport_size({"width": 1600, "height": 900})
    open_project_view(page, app_server)
    set_editor_value(page, PLAN)
    page.evaluate("() => switchToView('gantt')")
    page.wait_for_selector("#gantt-view.active")
    page.wait_for_function(
        "() => !!document.querySelector('#gantt-view .minimal-timeline-container')"
    )

    # Narrow the pane, let the panel settle, then widen it again with no
    # window resize in between.
    page.evaluate(SET_WRAPPER_WIDTH, 600)
    page.wait_for_function(
        "() => document.getElementById('gantt-view-timeline-line').offsetWidth <= 600 - 20"
    )
    page.evaluate(SET_WRAPPER_WIDTH, 1000)
    page.wait_for_function(
        "() => document.getElementById('gantt-view-timeline-line').offsetWidth > 800"
    )
    m = page.evaluate(WIDTHS)
    assert m["wrapper"] - m["line"] <= 100
