"""End-to-end cover for the Gantt <-> markdown hover link (#1271).

The feature is a two-way highlight: hovering a Gantt row lights up the plan
line it came from, and hovering a plan line lights up that task's Gantt row.
Both halves of a Gantt row carry the highlight, because the info row
(`#ganttInfoBody tr`) and the bar row (`#ganttBody .gantt-bar-row`) are
separate elements in separately scrolling containers.

What this file pins, and why each case is here rather than left to a smoke
test:

  * **Both directions end to end**, through the real listeners, on a rendered
    plan -- not through the module's internals.

  * **Duplicate task names.** Two tasks called "Review" is the case a
    name-match resolver gets wrong, and it gets it wrong silently: it
    highlights the first one both times and everything still looks like it
    works. `findTaskLineNumber()` resolves through `NoodlePlanModel` by
    `_uid`, so the two must land on different lines. This is asserted by
    hovering *each* of them and comparing the lines.

  * **A collapsed section, and a line the projection does not show at all.**
    `gantt-editor-link.js` lights up the fold header standing in for a
    swallowed line rather than doing nothing or expanding the section, and
    returns "no visible line" when there is no header either. The second is
    end to end (back-matter lines are hidden from the projection since
    #1278); the first is asserted against a synthesised gutter, for the
    reason its own docstring gives.

  * **Non-task lines highlight nothing**, and **leaving clears both halves** --
    the two ways a hover highlight becomes visual noise.

  * **The highlight is drawn in the overlay plane, never on `#planEditor`.**
    The textarea's `color: transparent` contract is what keeps the caret
    aligned with the highlight layer; a band painted onto it would look right
    and break the editor. Asserted by checking the band exists as a child of
    `.editor-link-overlay` and that the textarea's own background is
    untouched.

Hover is driven with `dispatch_event`/`mouse.move` against real coordinates
rather than by calling the module's functions, so the delegated listeners,
the `clientY` -> line arithmetic and the guard against the two directions
feeding each other are all on the path.

Usage:
    uv run pytest tests/ui/test_gantt_editor_link.py -q
"""

import pytest

from .helpers import open_project_view

# Two tasks named "Review" on purpose: the duplicate-name case is the whole
# reason the line lookup has to go through `_uid`.
PLAN = """---
title: Hover Link
start: 2026-01-05
---

Phase One
  Design @sam 3d
  Review @jo 2d
Phase Two
  Build @sam 4d
  Review @jo 2d
"""

# A real back-matter section, so the plan has raw lines the editor's
# projection does not show. `---raid log---` has no end marker, so it runs to
# the end of the text and can only be appended after the tasks.
BACK_MATTER = """
---raid log---

| Type | Description | Owner |
| --- | --- | --- |
| Risk | Scope creep | @sam |
| Issue | Kit late | @jo |
"""


def _open_gantt(page, app_server):
    open_project_view(page, app_server)
    page.evaluate(
        """value => {
            const ed = document.getElementById('planEditor');
            ed.value = value;
            ed.dispatchEvent(new Event('input', { bubbles: true }));
        }""",
        PLAN,
    )
    page.evaluate("() => switchToView('gantt')")
    page.wait_for_selector("#gantt-view.active")
    page.wait_for_function(
        "() => document.querySelectorAll('#ganttInfoBody tr[data-task-index]').length > 0"
    )
    # The module is inert unless both panes are on screen; blur the editor so
    # the auto-scroll guard ("never move a pane the user has focus in") does
    # not suppress the scroll under test.
    page.evaluate("() => document.getElementById('planEditor').blur()")
    return page


def _linked_rows(page):
    """The task indices currently carrying the link highlight, per half."""
    return page.evaluate(
        """() => ({
            info: [...document.querySelectorAll(
                '#ganttInfoBody tr.gantt-linked-row')].map(r => r.dataset.taskIndex),
            bar: [...document.querySelectorAll(
                '#ganttBody .gantt-bar-row.gantt-linked-row')].map(r => r.dataset.taskIndex),
        })"""
    )


def _linked_gutter_lines(page):
    """The raw plan line numbers of the gutter rows lit up right now."""
    return page.evaluate(
        "() => [...document.querySelectorAll('#lineNumbers .gantt-linked-line')]"
        "        .map(n => Number(n.dataset.lineNumber))"
    )


def _band_count(page):
    return page.evaluate(
        "() => document.querySelectorAll('.editor-link-overlay .editor-link-band').length"
    )


def _hover_gantt_row(page, index):
    """Fire the delegated `mouseover` the info body listens for."""
    page.eval_on_selector(
        f"#ganttInfoBody tr[data-task-index='{index}']",
        "row => row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))",
    )


def _visible_line_for_raw(page, raw_line):
    """Translate a raw plan line to the line the editor actually shows.

    They are not the same number and must never be used interchangeably:
    the editor's projection hides the leading front-matter block, so on the
    plan below raw line 7 is visible line 2. Getting this wrong in the test
    would be the same bug the module has to avoid.
    """
    return page.evaluate(
        "n => { const el = document.querySelector("
        "  '#lineNumbers .line-number[data-line-number=\"' + n + '\"]');"
        "  return el ? Number(el.dataset.visibleLine) : -1; }",
        raw_line,
    )


def _hover_editor_raw_line(page, raw_line):
    """Move the real mouse over the plan line `raw_line`, by its geometry.

    The module derives the line from `clientY` against the highlight layer's
    metrics, so the test has to drive it with a coordinate rather than a line
    number -- otherwise the arithmetic under test is not exercised.
    """
    visible_line = _visible_line_for_raw(page, raw_line)
    assert visible_line > 0, f"raw line {raw_line} is not visible in the editor"
    point = page.evaluate(
        """line => {
            const ed = document.getElementById('planEditor');
            const layer = document.getElementById('highlightLayer');
            const s = getComputedStyle(layer);
            const lh = parseFloat(s.lineHeight);
            const pad = parseFloat(s.paddingTop);
            const r = ed.getBoundingClientRect();
            return {
                x: r.left + 40,
                y: r.top + pad + (line - 1) * lh + lh / 2 - ed.scrollTop,
            };
        }""",
        visible_line,
    )
    page.mouse.move(point["x"], point["y"])


def _raw_line_of(page, name, occurrence):
    """The 1-based plan line of the `occurrence`-th task called `name`."""
    return page.evaluate(
        """args => {
            const [name, nth] = args;
            const lines = document.getElementById('planEditor').value.split('\\n');
            let seen = 0;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].trim().startsWith(name)) {
                    seen += 1;
                    if (seen === nth) return i + 1;
                }
            }
            return -1;
        }""",
        [name, occurrence],
    )


def _index_of_task(page, name, occurrence):
    """The `ganttTasks` index of the `occurrence`-th task called `name`."""
    return page.evaluate(
        """args => {
            const [name, nth] = args;
            let seen = 0;
            for (let i = 0; i < ganttTasks.length; i++) {
                if (ganttTasks[i].name === name) {
                    seen += 1;
                    if (seen === nth) return i;
                }
            }
            return -1;
        }""",
        [name, occurrence],
    )


# ── Gantt -> editor ──────────────────────────────────────────────────────


def test_hovering_a_gantt_row_highlights_both_halves(page, app_server):
    _open_gantt(page, app_server)
    index = _index_of_task(page, "Design", 1)
    _hover_gantt_row(page, index)

    linked = _linked_rows(page)
    assert linked["info"] == [str(index)], "the info row should carry the link class"
    assert linked["bar"] == [str(index)], (
        "the bar row is a separate element in a separately scrolling container "
        "and must be highlighted too"
    )


def test_hovering_a_gantt_row_highlights_its_markdown_line(page, app_server):
    _open_gantt(page, app_server)
    _hover_gantt_row(page, _index_of_task(page, "Design", 1))

    assert _band_count(page) == 1, "exactly one band is drawn"
    assert _linked_gutter_lines(page) == [_raw_line_of(page, "Design", 1)]


@pytest.mark.parametrize("occurrence", [1, 2])
def test_duplicate_task_names_resolve_to_their_own_lines(page, app_server, occurrence):
    """The case a bare name match gets wrong without ever looking wrong."""
    _open_gantt(page, app_server)
    index = _index_of_task(page, "Review", occurrence)
    assert index >= 0

    _hover_gantt_row(page, index)
    assert _linked_gutter_lines(page) == [_raw_line_of(page, "Review", occurrence)]


def test_the_two_reviews_do_not_share_a_line(page, app_server):
    """The parametrised test above passes trivially if both lines are equal."""
    _open_gantt(page, app_server)
    seen = []
    for occurrence in (1, 2):
        _hover_gantt_row(page, _index_of_task(page, "Review", occurrence))
        seen.append(_linked_gutter_lines(page))
    assert seen[0] != seen[1], f"both Reviews highlighted the same line: {seen}"


def test_the_band_is_drawn_in_the_overlay_not_on_the_textarea(page, app_server):
    """#planEditor's transparent-text contract is what keeps the caret aligned."""
    _open_gantt(page, app_server)
    _hover_gantt_row(page, _index_of_task(page, "Design", 1))

    assert page.evaluate(
        "() => !!document.querySelector("
        "  '.editor-area > .editor-link-overlay > .editor-link-band')"
    ), "the band must live in the overlay plane"

    background = page.evaluate(
        "() => getComputedStyle(document.getElementById('planEditor')).backgroundColor"
    )
    assert background in ("rgba(0, 0, 0, 0)", "transparent"), (
        f"#planEditor's background was painted on ({background}); the band "
        "belongs in the overlay"
    )


def test_leaving_the_gantt_clears_both_halves(page, app_server):
    _open_gantt(page, app_server)
    _hover_gantt_row(page, _index_of_task(page, "Design", 1))
    assert _band_count(page) == 1

    page.eval_on_selector(
        "#ganttInfoBody",
        "body => body.dispatchEvent(new MouseEvent('mouseleave'))",
    )
    linked = _linked_rows(page)
    assert linked["info"] == [] and linked["bar"] == []
    assert _band_count(page) == 0
    assert _linked_gutter_lines(page) == []


# ── Editor -> Gantt ──────────────────────────────────────────────────────


def test_hovering_a_markdown_line_highlights_its_gantt_row(page, app_server):
    _open_gantt(page, app_server)
    _hover_editor_raw_line(page, _raw_line_of(page, "Build", 1))

    index = _index_of_task(page, "Build", 1)
    linked = _linked_rows(page)
    assert linked["info"] == [str(index)]
    assert linked["bar"] == [str(index)]


def test_a_non_task_line_highlights_nothing(page, app_server):
    """Visible line 1 is the blank line after the (projected-away) front
    matter. Nothing on it maps to a task, so nothing may light up."""
    _open_gantt(page, app_server)
    _hover_editor_raw_line(page, _raw_line_of(page, "---", 2) + 1)

    linked = _linked_rows(page)
    assert linked["info"] == [] and linked["bar"] == []
    assert _band_count(page) == 0


def test_leaving_the_editor_clears_both_halves(page, app_server):
    _open_gantt(page, app_server)
    _hover_editor_raw_line(page, _raw_line_of(page, "Build", 1))
    assert _linked_rows(page)["info"] != []

    page.eval_on_selector(
        "#planEditor", "ed => ed.dispatchEvent(new MouseEvent('mouseleave'))"
    )
    linked = _linked_rows(page)
    assert linked["info"] == [] and linked["bar"] == []
    assert _band_count(page) == 0


# ── Folding and re-render ────────────────────────────────────────────────


def _open_gantt_with_back_matter(page, app_server):
    open_project_view(page, app_server)
    page.evaluate(
        """value => {
            const ed = document.getElementById('planEditor');
            ed.value = value;
            ed.dispatchEvent(new Event('input', { bubbles: true }));
        }""",
        PLAN + BACK_MATTER,
    )
    page.evaluate("() => switchToView('gantt')")
    page.wait_for_selector("#gantt-view.active")
    page.wait_for_function(
        "() => document.getElementById('planEditor').value.includes('---raid log---')"
    )
    page.wait_for_function(
        "() => document.querySelectorAll('#ganttInfoBody tr[data-task-index]').length > 0"
    )
    page.evaluate("() => document.getElementById('planEditor').blur()")
    return page


def test_a_line_the_projection_does_not_show_degrades_silently(page, app_server):
    """The settled editor omits back-matter lines from its projection.

    Since #1278 the back-matter sections are hidden from the editor rather
    than folded -- the Back Matter panel below shows them instead -- so their
    raw lines have no gutter row at all. Nothing maps them to a task either,
    but the resolver must return "no visible line" rather than guessing at
    one, because that is the same path a genuinely folded line takes.
    """
    _open_gantt_with_back_matter(page, app_server)

    raid_raw = _raw_line_of(page, "---raid log---", 1)
    assert raid_raw > 0
    assert _visible_line_for_raw(page, raid_raw) == -1, (
        "back-matter lines are expected to be absent from the projection"
    )

    resolved = page.evaluate(
        "n => window.GanttEditorLink._internals.visibleLineForRawLine(n)", raid_raw
    )
    assert resolved["visibleLine"] == -1
    assert _band_count(page) == 0


def test_a_collapsed_section_resolves_to_its_fold_header(page, app_server):
    """A raw line with no gutter row of its own resolves to the fold header
    standing in for the section that swallowed it.

    This one is asserted against a synthesised gutter rather than end to end,
    and deliberately so. Two things have to be true at once for the case to
    arise in the app: a *task* line inside a foldable section, and that
    section rendered as a collapsible header. Neither holds today --
    `editor.js` attaches the folding controller with the back-matter
    descriptors only (its own comment says front matter comes later), and
    since #1278 those sections are hidden from the projection rather than
    folded, as the test above shows. Waiting for both to change would mean
    shipping the fallback with nothing asserting it.

    So the gutter is put into the shape a folded projection produces -- a
    `data-fold-header` row, and no row for the lines behind it -- and the
    resolver is asked. The recorded decision is to light up the header, not
    to expand the section and not to silently do nothing.
    """
    _open_gantt(page, app_server)

    # Turn the last gutter row into a fold header, as a folded projection
    # would, and drop everything after it from the projection.
    header = page.evaluate(
        """() => {
            const g = document.getElementById('lineNumbers');
            const rows = [...g.querySelectorAll('.line-number')];
            const last = rows[rows.length - 1];
            last.dataset.foldHeader = 'true';
            return { raw: Number(last.dataset.lineNumber),
                     visible: Number(last.dataset.visibleLine) };
        }"""
    )

    resolved = page.evaluate(
        "n => window.GanttEditorLink._internals.visibleLineForRawLine(n)",
        header["raw"] + 5,
    )
    assert resolved["folded"] is True
    assert resolved["visibleLine"] == header["visible"], (
        "a line inside a collapsed section must resolve to the fold header "
        "standing in for it, not to an arbitrary visible line"
    )


def test_a_fold_header_line_highlights_nothing(page, app_server):
    """A fold header is not a task line, so hovering it must light nothing up."""
    _open_gantt(page, app_server)
    header_raw = page.evaluate(
        """() => {
            const g = document.getElementById('lineNumbers');
            const rows = [...g.querySelectorAll('.line-number')];
            const last = rows[rows.length - 1];
            last.dataset.foldHeader = 'true';
            return Number(last.dataset.lineNumber);
        }"""
    )
    _hover_editor_raw_line(page, header_raw)

    linked = _linked_rows(page)
    assert linked["info"] == [] and linked["bar"] == []
    assert _band_count(page) == 0


def test_the_hover_link_still_works_with_back_matter_present(page, app_server):
    """The end-to-end guard on the visible/raw distinction.

    With a back-matter section in the plan the two line numbers diverge, so a
    Gantt hover must still land on the task's *raw* line and draw the band at
    the matching *visible* one -- including for the two tasks that share a
    name.
    """
    _open_gantt_with_back_matter(page, app_server)

    for occurrence in (1, 2):
        _hover_gantt_row(page, _index_of_task(page, "Review", occurrence))
        assert _linked_gutter_lines(page) == [_raw_line_of(page, "Review", occurrence)]
        assert _band_count(page) == 1


def test_no_highlight_survives_an_edit(page, app_server):
    """Every line moves when the gutter is rebuilt, so a stale band would be
    pointing at the wrong text."""
    _open_gantt(page, app_server)
    _hover_gantt_row(page, _index_of_task(page, "Design", 1))
    assert _band_count(page) == 1

    page.evaluate(
        """() => {
            const ed = document.getElementById('planEditor');
            ed.value = '\\n' + ed.value;
            ed.dispatchEvent(new Event('input', { bubbles: true }));
        }"""
    )
    page.wait_for_function(
        "() => document.querySelectorAll('.editor-link-band').length === 0"
    )
    assert _linked_gutter_lines(page) == []
    assert _linked_rows(page)["info"] == []


def test_hover_does_not_rebuild_the_gantt(page, app_server):
    """`renderGanttChart()` is the full rebuild and must not be on this path."""
    _open_gantt(page, app_server)
    page.evaluate(
        "() => { window.__renderCalls = 0;"
        "  const original = window.renderGanttChart;"
        "  window.renderGanttChart = function () {"
        "    window.__renderCalls += 1; return original.apply(this, arguments); }; }"
    )

    for index in range(3):
        _hover_gantt_row(page, index)
    _hover_editor_raw_line(page, _raw_line_of(page, "Build", 1))

    assert page.evaluate("() => window.__renderCalls") == 0


# ── Cost ─────────────────────────────────────────────────────────────────


def test_a_few_hundred_tasks_hover_without_lag(page, app_server):
    """Both halves fire at mousemove frequency, so the cost has a ceiling.

    Three things keep it bounded and all three are on this path: the
    listeners are delegated (four in total, not one per row), the
    line -> task map is built once per plan rather than per hover, and
    `renderGanttChart()` is never called. The budget below is deliberately
    loose -- this is a guard against an O(rows) regression per hover, not a
    benchmark -- but 300 hovers that each rebuilt the map or the chart would
    not come close to fitting in it.
    """
    open_project_view(page, app_server)
    big = ["---", "title: Big Plan", "start: 2026-01-05", "---", ""]
    for phase in range(20):
        big.append(f"Phase {phase}")
        for task in range(15):
            big.append(f"  Task {phase}-{task} @sam 2d")
    page.evaluate(
        """value => {
            const ed = document.getElementById('planEditor');
            ed.value = value;
            ed.dispatchEvent(new Event('input', { bubbles: true }));
        }""",
        "\n".join(big) + "\n",
    )
    page.evaluate("() => switchToView('gantt')")
    page.wait_for_selector("#gantt-view.active")
    page.wait_for_function(
        "() => document.querySelectorAll('#ganttInfoBody tr[data-task-index]').length > 300"
    )
    page.evaluate("() => document.getElementById('planEditor').blur()")

    result = page.evaluate(
        """() => {
            const rows = [...document.querySelectorAll('#ganttInfoBody tr[data-task-index]')];
            const t0 = performance.now();
            for (const row of rows) {
                row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            }
            return { ms: performance.now() - t0, rows: rows.length };
        }"""
    )

    per_hover = result["ms"] / result["rows"]
    assert per_hover < 20, (
        f"{per_hover:.1f}ms per hover across {result['rows']} rows -- the "
        "per-hover cost should not scale with the plan"
    )
