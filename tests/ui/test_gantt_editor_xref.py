"""The two-way hover cross-reference between the Gantt and the editor (#1271).

Both directions are driven with a real pointer where the element can be
hovered, because the whole feature is a hover: a test that only called the
exported functions would not exercise the delegated listeners, the clientY ->
line arithmetic or the loop guard.

Two cases carry most of the weight:

*   **Duplicate task names.** Two tasks called "Review" in different phases.
    The mapping goes through `findTaskLineNumber()`, which resolves by `_uid`
    through NoodlePlanModel and only falls back to a name match, so the second
    "Review" must highlight the second "Review"'s line -- a bare name match
    would highlight the first for both.

*   **Collapsed sections.** Two different collapses, because the two halves
    hide rows in unrelated ways. Collapsing a Gantt summary hides its children
    with `display: none`; collapsing a back-matter section in the editor makes
    visible line numbers diverge from raw ones.
"""

import pytest

from .helpers import load_plan, open_project_view

pytestmark = pytest.mark.ui


PLAN = """---
title: Xref Plan
---

Phase A
  Design 3days
  Review 2days
Phase B
  Build 4days
  Review 2days

---highlights---
- Something worth noting
- And another
- And a third
---end-highlights---
"""


def open_gantt(page, app_server, plan=PLAN):
    open_project_view(page, app_server)
    load_plan(page, plan)
    page.evaluate("() => switchToView('gantt')")
    page.wait_for_selector("#gantt-view.active")
    page.wait_for_function(
        "() => document.querySelectorAll('#ganttInfoBody tr[data-task-index]').length > 3"
    )
    return page


def task_index(page, name, occurrence=1):
    """The Gantt row index of the `occurrence`-th task called `name`."""
    return page.evaluate(
        """([name, occurrence]) => {
            let seen = 0;
            for (let i = 0; i < ganttTasks.length; i++) {
                if (ganttTasks[i].name === name) {
                    seen += 1;
                    if (seen === occurrence) return i;
                }
            }
            return -1;
        }""",
        [name, occurrence],
    )


def raw_line_of(page, text):
    return page.evaluate(
        "t => document.getElementById('planEditor').value"
        "      .split('\\n').findIndex(l => l.includes(t)) + 1",
        text,
    )


def xref_state(page):
    return page.evaluate("() => GanttEditorXref.state()")


def hover_editor_line(page, raw_line):
    """Move the real mouse over the text of `raw_line` in the textarea."""
    point = page.evaluate(
        """rawLine => {
            const editor = document.getElementById('planEditor');
            const style = getComputedStyle(editor);
            const lineHeight = parseFloat(style.lineHeight);
            const padTop = parseFloat(style.paddingTop) || 0;
            const rect = editor.getBoundingClientRect();
            const visible = GanttEditorXref.visibleLineForRaw(rawLine).line;
            return {
                x: rect.left + 40,
                y: rect.top + padTop + (visible - 0.5) * lineHeight - editor.scrollTop,
            };
        }""",
        raw_line,
    )
    # Two moves: the handler ignores an event that did not actually move.
    page.mouse.move(point["x"] - 3, point["y"])
    page.mouse.move(point["x"], point["y"])


# ── Gantt → editor ───────────────────────────────────────────────────────


def test_hovering_a_gantt_row_highlights_both_halves_and_its_markdown_line(
    page, app_server
):
    open_gantt(page, app_server)
    index = task_index(page, "Design")
    page.hover(f'#ganttInfoBody tr[data-task-index="{index}"]')

    page.wait_for_selector(f'#ganttInfoBody tr[data-task-index="{index}"].np-xref-highlight')
    # The bar row is a separate element in a separately scrolling container.
    assert page.locator(
        f'#ganttBody .gantt-bar-row[data-task-index="{index}"].np-xref-highlight'
    ).count() == 1

    state = xref_state(page)
    assert state["source"] == "gantt"
    assert state["rawLine"] == raw_line_of(page, "Design")

    # The band is drawn in the overlay plane, not on the textarea.
    band = page.locator(".editor-xref-band")
    assert band.count() == 1
    assert band.evaluate("b => getComputedStyle(b).display") != "none"
    assert page.locator(".line-numbers .line-number.np-xref-highlight").count() == 1


def test_duplicate_task_names_highlight_their_own_line(page, app_server):
    open_gantt(page, app_server)
    first = task_index(page, "Review", 1)
    second = task_index(page, "Review", 2)
    assert first != second

    lines = page.evaluate(
        "() => document.getElementById('planEditor').value.split('\\n')"
        "        .map((l, i) => [l, i + 1]).filter(([l]) => l.includes('Review'))"
        "        .map(([, n]) => n)"
    )
    assert len(lines) == 2

    page.hover(f'#ganttInfoBody tr[data-task-index="{first}"]')
    page.wait_for_function(
        "n => GanttEditorXref.state().rawLine === n", arg=lines[0]
    )

    page.hover(f'#ganttInfoBody tr[data-task-index="{second}"]')
    page.wait_for_function(
        "n => GanttEditorXref.state().rawLine === n", arg=lines[1]
    )


def test_leaving_the_gantt_clears_both_highlights(page, app_server):
    open_gantt(page, app_server)
    index = task_index(page, "Build")
    page.hover(f'#ganttInfoBody tr[data-task-index="{index}"]')
    page.wait_for_selector(".editor-xref-band")
    page.evaluate(
        "() => document.getElementById('ganttInfoBody')"
        "        .dispatchEvent(new MouseEvent('mouseleave'))"
    )
    assert page.locator("#ganttInfoBody tr.np-xref-highlight").count() == 0
    assert page.locator(".line-numbers .line-number.np-xref-highlight").count() == 0
    assert xref_state(page)["source"] is None


# ── Editor → Gantt ───────────────────────────────────────────────────────


def test_hovering_a_markdown_line_highlights_its_gantt_rows(page, app_server):
    open_gantt(page, app_server)
    index = task_index(page, "Build")
    hover_editor_line(page, raw_line_of(page, "Build"))

    page.wait_for_selector(f'#ganttInfoBody tr[data-task-index="{index}"].np-xref-highlight')
    assert page.locator(
        f'#ganttBody .gantt-bar-row[data-task-index="{index}"].np-xref-highlight'
    ).count() == 1
    assert xref_state(page)["source"] == "editor"


def test_a_non_task_line_highlights_nothing(page, app_server):
    open_gantt(page, app_server)
    hover_editor_line(page, raw_line_of(page, "title: Xref Plan"))
    assert page.locator("#ganttInfoBody tr.np-xref-highlight").count() == 0
    assert xref_state(page)["taskIndex"] == -1


def test_a_row_hidden_under_a_collapsed_summary_falls_back_to_the_summary(
    page, app_server
):
    """Editor -> Gantt with the target row `display: none`.

    Collapsing "Phase B" hides "Build", so there is no row to scroll to.
    The highlight lands on the visible summary standing in for it rather than
    on a zero-height row.
    """
    open_gantt(page, app_server)
    phase_b = task_index(page, "Phase B")
    build = task_index(page, "Build")
    page.evaluate(
        "i => { collapsedSummaryTasks.add(ganttTasks[i].id); renderGanttRows(); }",
        phase_b,
    )
    page.wait_for_function(
        "i => document.querySelector(`#ganttInfoBody tr[data-task-index=\"${i}\"]`)"
        "       .style.display === 'none'",
        arg=build,
    )

    hover_editor_line(page, raw_line_of(page, "Build"))
    page.wait_for_selector(
        f'#ganttInfoBody tr[data-task-index="{phase_b}"].np-xref-highlight'
    )
    assert page.locator(
        f'#ganttInfoBody tr[data-task-index="{build}"].np-xref-highlight'
    ).count() == 0


def test_mapping_is_correct_with_a_back_matter_section_collapsed(page, app_server):
    """Gantt -> editor when visible and raw line numbers have diverged.

    Folding the Highlights section shortens the displayed document, so the
    visible line of every later line is no longer its raw line. The state
    still reports a raw line, and the gutter row that lights up is the one
    whose data-line-number is that raw line.
    """
    open_gantt(page, app_server)
    collapsed = page.evaluate(
        """() => {
            const c = SectionFolding.controllerFor(document.getElementById('planEditor'));
            if (!c) return false;
            const section = (c.getProjection().sections || [])[0];
            if (!section) return false;
            c.setExpanded(section.marker, false);
            return true;
        }"""
    )
    if not collapsed:
        pytest.skip("no foldable back-matter section in this plan")

    index = task_index(page, "Design")
    page.hover(f'#ganttInfoBody tr[data-task-index="{index}"]')
    page.wait_for_selector(".line-numbers .line-number.np-xref-highlight")

    raw = raw_line_of(page, "Design")
    # The point of the test: the two numbers really have diverged, so using
    # one where the other belongs would be caught.
    visible = page.evaluate("n => GanttEditorXref.visibleLineForRaw(n).line", raw)
    assert visible != raw
    assert xref_state(page)["rawLine"] == raw
    assert page.evaluate(
        "() => document.querySelector('.line-numbers .line-number.np-xref-highlight')"
        "        .dataset.lineNumber"
    ) == str(raw)


def test_a_coarse_pointer_leaves_no_stuck_highlight(page, app_server):
    open_gantt(page, app_server)
    index = task_index(page, "Design")
    page.hover(f'#ganttInfoBody tr[data-task-index="{index}"]')
    page.wait_for_selector("#ganttInfoBody tr.np-xref-highlight")
    page.evaluate(
        "() => document.dispatchEvent("
        "  new PointerEvent('pointerdown', {pointerType: 'touch', bubbles: true}))"
    )
    assert page.locator("#ganttInfoBody tr.np-xref-highlight").count() == 0
    # And it stays off for the rest of that pointer's life.
    page.hover(f'#ganttInfoBody tr[data-task-index="{index}"]')
    assert page.locator("#ganttInfoBody tr.np-xref-highlight").count() == 0
    page.evaluate("() => GanttEditorXref.setCoarsePointer(false)")
