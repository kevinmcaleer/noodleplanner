"""Ticking a task's checkbox in the Gantt must not move any pane's scroll.

The tick writes the new % complete into the plan text, which re-renders the
rows from scratch. The rebuild briefly empties both Gantt panes, which clamps
their scroll to the top, so the list jumped back to the first task. The plan
editor (the markdown pane) is also kept where it was, and the three panes are
scrolled together so the line being edited stays beside its row.
"""

from .helpers import open_project_view

PLAN = "---\ntitle: Checkbox Scroll\nstart: 2026-01-05\n---\n\n" + "".join(
    f"Phase {p}\n" + "".join(f"  Task {p}.{t} @sam 3d\n" for t in range(8))
    for p in range(8)
)

SCROLLS = """() => ({
    table: document.querySelector('.gantt-table-side').scrollTop,
    chart: document.querySelector('.gantt-chart-side').scrollTop,
    editor: document.getElementById('planEditor').scrollTop,
})"""


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


def _tick_last_task(page):
    box = page.locator("#ganttInfoBody tr[data-task-index] np-checkbox").last
    box.scroll_into_view_if_needed()
    page.wait_for_timeout(200)
    before = page.evaluate(SCROLLS)
    box.click()
    page.wait_for_timeout(600)
    return before, page.evaluate(SCROLLS)


def test_ticking_a_checkbox_keeps_the_gantt_scroll(page, app_server):
    _open_gantt(page, app_server)
    before, after = _tick_last_task(page)
    assert before["table"] > 100, before
    assert after["table"] == before["table"], (before, after)
    assert after["chart"] == before["chart"], (before, after)
    assert page.locator("#ganttInfoBody tr[data-task-index]").last.inner_text()  # still rendered


def test_ticking_a_checkbox_keeps_the_editor_scroll(page, app_server):
    _open_gantt(page, app_server)
    before, after = _tick_last_task(page)
    assert after["editor"] == before["editor"], (before, after)


def test_scrolling_the_gantt_brings_the_editor_to_the_same_task(page, app_server):
    _open_gantt(page, app_server)
    page.evaluate("() => { document.querySelector('.gantt-table-side').scrollTop = 1200; }")
    page.wait_for_timeout(500)
    state = page.evaluate(
        """() => {
            const pane = document.querySelector('.gantt-table-side');
            const top = pane.getBoundingClientRect().top + pane.querySelector('thead').offsetHeight;
            const row = [...document.querySelectorAll('#ganttInfoBody tr[data-task-index]')]
                .find(r => r.getBoundingClientRect().bottom > top + 1);
            const task = ganttTasks[Number(row.dataset.taskIndex)];
            const ed = document.getElementById('planEditor');
            const cs = getComputedStyle(document.getElementById('highlightLayer'));
            const lh = parseFloat(cs.lineHeight), pad = parseFloat(cs.paddingTop) || 0;
            // The editor can fold lines away, so ask the gutter which plan line is on top.
            const gutterRow = document.querySelector(
                '#lineNumbers .line-number[data-visible-line="' + (Math.round((ed.scrollTop - pad) / lh) + 1) + '"]');
            return {name: task.name, topLine: ed.value.split('\\n')[Number(gutterRow.dataset.lineNumber) - 1]};
        }"""
    )
    assert state["name"] in state["topLine"], state


def test_scrolling_the_editor_brings_the_gantt_to_the_same_task(page, app_server):
    _open_gantt(page, app_server)
    page.evaluate("() => { document.getElementById('planEditor').scrollTop = 1500; }")
    page.wait_for_timeout(500)
    assert page.evaluate("() => document.querySelector('.gantt-table-side').scrollTop") > 300
