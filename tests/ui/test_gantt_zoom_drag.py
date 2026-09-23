"""End-to-end cover for the Gantt's zoom slider and drag-to-reschedule (#787).

What this file pins, through the real page rather than the module internals:

  * **Zoom is continuous and anchored.** The slider moves `ganttPixelsPerDay`
    through the whole range; the date under the centre of the chart stays
    put while it does; the header bands are re-derived at every density and
    no label is ever wider than its cell.

  * **The first render matches the control.** The old chart drew at 14 px/day
    under a selector reading "Days" (28) until something re-rendered it.

  * **Zoom persists per project.**

  * **Drag writes the plan, on the right line.** The right handle changes the
    duration, the left handle the start (the finish holding still), on tasks
    carrying `$product`, `!!`, `{bucket}` and on a task whose name is a prefix
    of another's -- the lines the old name-regex write path either missed or
    mis-edited (#747).

  * **Dependants move during the drag**, before the pointer is released, and
    land where the preview showed them once the plan is re-scheduled.

  * **One undo reverses a drag.** At the Years zoom a drag moves by whole
    months rather than by a pixel-per-day. Summary bars cannot be dragged.

  * **Overlays stay on the bars.** A dependency arrow starts at its
    predecessor's right edge and ends at its dependant's left edge at every
    zoom.

Usage:
    uv run pytest tests/ui/test_gantt_zoom_drag.py -q
"""

import pytest

from .helpers import load_plan, open_project_view, plan_text

PLAN = """---
title: Gantt Drag
---

Phase One
  Spec 3d @dev 2026-03-02
  Build 4d @dev [depends Spec]
  $GW1 Gate review 1d !! {QA} [depends Build]
  Design 2d 2026-03-02
  Design UI 2d [depends Design]
"""


@pytest.fixture
def gantt(page, app_server):
    open_project_view(page, app_server)
    page.evaluate(
        """() => {
            window.__lastGanttRender = performance.now();
            const original = window.updateGantt;
            window.updateGantt = function (...args) {
                window.__lastGanttRender = performance.now();
                return original.apply(this, args);
            };
        }"""
    )
    load_plan(page, PLAN, with_project="Gantt drag")
    page.evaluate("switchToView('gantt')")
    page.wait_for_selector("#ganttBody .gantt-task-bar")
    # load_plan returns once the parse has written `rag:` back into the front
    # matter; that write is itself an edit, and the editor's 1s debounce
    # re-parses it once more. A drag that starts inside that window has its
    # rows re-laid out under the pointer, so wait until the chart is quiet.
    page.wait_for_function("() => performance.now() - window.__lastGanttRender > 1200")
    return page


def task_index(page, name):
    return page.evaluate("name => ganttTasks.findIndex(t => t.name === name)", name)


def bar_box(page, name):
    index = task_index(page, name)
    return page.evaluate(
        """index => {
            const row = document.querySelector(`#ganttBody .gantt-bar-row[data-task-index="${index}"]`);
            const bar = row.querySelector('[data-gantt-kind="task"], [data-gantt-kind="milestone"]');
            const r = bar.getBoundingClientRect();
            return { x: r.left, y: r.top, width: r.width, height: r.height,
                     left: parseFloat(bar.style.left), barWidth: parseFloat(bar.style.width) };
        }""",
        index,
    )


def task_field(page, name, field):
    return page.evaluate(
        "([name, field]) => ganttTasks.find(t => t.name === name)[field]", [name, field]
    )


def set_zoom(page, ppd):
    page.evaluate("ppd => setGanttZoom(ppd)", ppd)


def drag(page, name, handle, dx, release=True):
    """Press on `handle` ('left', 'right' or 'middle') of `name`'s bar and
    move the pointer `dx` pixels in small steps. The bar is scrolled into
    the middle of the chart first: the task table takes most of a 1280px
    viewport, and the status bar covers the bottom rows."""
    page.evaluate(
        """index => {
            const bar = ganttMainBar(index);
            bar.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
            const side = document.querySelector('.gantt-chart-side');
            side.scrollLeft = Math.max(0, parseFloat(bar.style.left) - 120);
        }""",
        task_index(page, name),
    )
    box = bar_box(page, name)
    y = box["y"] + box["height"] / 2
    if handle == "left":
        x = box["x"] + 3
    elif handle == "right":
        x = box["x"] + box["width"] - 3
    else:
        x = box["x"] + box["width"] / 2
    hit = page.evaluate(
        """([x, y]) => {
            const el = document.elementFromPoint(x, y);
            const bar = el && el.closest('[data-gantt-kind]');
            if (bar) return bar.dataset.taskIndex;
            return el ? `${el.tagName}#${el.id}.${el.className} in ${el.parentElement && el.parentElement.className}` : null;
        }""",
        [x, y],
    )
    assert hit == str(task_index(page, name)), f"the pointer at ({x}, {y}) is over {hit!r}, not {name}"
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + dx / 2, y, steps=4)
    page.mouse.move(x + dx, y, steps=4)
    page.wait_for_timeout(80)  # one animation frame for the preview
    if release:
        page.mouse.up()
    return x + dx, y


def wait_for_plan(page, needle):
    page.wait_for_function(
        "needle => document.getElementById('planEditor').value.includes(needle)", arg=needle
    )


# ----- zoom ----------------------------------------------------------------


def test_first_render_matches_the_zoom_control(gantt):
    page = gantt
    assert page.evaluate("ganttPixelsPerDay") == 28
    assert page.evaluate("ganttScale") == "days"
    assert page.input_value("#ganttZoomSlider") == str(
        page.evaluate("GanttScale.pixelsPerDayToSlider(28)")
    )
    assert page.text_content("#ganttZoomReadout") == "Days"
    assert page.get_attribute("#ganttHeader", "data-fine-unit") == "day"
    # a 3-day task at 28px/day is 84px wide
    assert bar_box(page, "Spec")["barWidth"] == 84


def test_slider_zooms_continuously_about_the_centre(gantt):
    page = gantt
    centre_day = """() => {
        const side = document.querySelector('.gantt-chart-side');
        return (side.scrollLeft + side.clientWidth / 2) / ganttPixelsPerDay;
    }"""
    set_zoom(page, 12)
    page.evaluate("document.querySelector('.gantt-chart-side').scrollLeft = 150")
    before = page.evaluate(centre_day)
    seen = set()
    for position in range(700, 250, -25):
        page.eval_on_selector(
            "#ganttZoomSlider",
            "(el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }",
            str(position),
        )
        seen.add(round(page.evaluate("ganttPixelsPerDay"), 3))
        after = page.evaluate(centre_day)
        scroll = page.evaluate("document.querySelector('.gantt-chart-side').scrollLeft")
        if scroll > 0:  # clamped at the left edge once the chart is narrower than the view
            assert abs(after - before) < 0.5, f"centre drifted from {before} to {after}"
    # values between the detents, not just the five named ones
    assert len(seen) > 8


def test_header_labels_never_overflow_their_cells(gantt):
    page = gantt
    for ppd in (48, 28, 16, 12, 7, 5, 3, 1.6, 1, 0.5):
        set_zoom(page, ppd)
        overflowing = page.evaluate(
            """() => [...document.querySelectorAll('#ganttHeader .gantt-header-cell')]
                .filter(c => c.textContent && c.scrollWidth > c.clientWidth + 1)
                .map(c => c.textContent)"""
        )
        assert overflowing == [], f"at {ppd}px/day: {overflowing}"
        bands = page.eval_on_selector_all("#ganttHeader .gantt-header-band", "els => els.length")
        assert bands == 2


def test_ribbon_scale_buttons_land_on_detents_and_zoom_persists(gantt):
    page = gantt
    page.evaluate(
        "() => { const s = document.getElementById('ganttScale'); s.value = 'months';"
        " s.dispatchEvent(new Event('change')); }"
    )
    assert page.evaluate("ganttPixelsPerDay") == 5
    assert page.evaluate("ganttScale") == "months"
    set_zoom(page, 7.5)
    assert page.evaluate("ganttScale") == ""
    key = page.evaluate("ganttZoomStorageKey(getCurrentProjectId())")
    assert page.evaluate("key => localStorage.getItem(key)", key) == "7.5"

    # Another project starts at its own (default) zoom; coming back restores 7.5
    page.evaluate("() => { const p = createProject('Other'); setCurrentProjectId(p.id); }")
    page.evaluate("renderGanttChart(); updateGantt(ganttTasks)")
    assert page.evaluate("ganttPixelsPerDay") == 28
    page.evaluate(
        "key => { setCurrentProjectId(key.replace('noodle_gantt_zoom_', '')); updateGantt(ganttTasks); }",
        key,
    )
    assert page.evaluate("ganttPixelsPerDay") == 7.5


def test_dependency_arrows_stay_on_the_bars_at_every_zoom(gantt):
    page = gantt
    page.evaluate(
        "() => { const t = document.getElementById('ganttShowDependencies');"
        " t.checked = true; t.dispatchEvent(new Event('change')); }"
    )
    for ppd in (28, 9, 3, 1):
        set_zoom(page, ppd)
        spec, build = bar_box(page, "Spec"), bar_box(page, "Build")
        ends = page.evaluate(
            """() => [...document.querySelectorAll('#ganttDependencySvg path')].map(p => {
                const nums = p.getAttribute('d').match(/-?[\\d.]+/g).map(Number);
                return { x0: nums[0], x1: nums[nums.length - 2] };
            })"""
        )
        starts = [e["x0"] for e in ends]
        finishes = [e["x1"] for e in ends]
        assert any(abs(x - (spec["left"] + spec["barWidth"])) < 0.01 for x in starts), ppd
        assert any(abs(x - build["left"]) < 0.01 for x in finishes), ppd


# ----- drag ------------------------------------------------------------------


def test_right_handle_changes_duration_and_moves_dependants_live(gantt):
    page = gantt
    build_before = bar_box(page, "Build")["left"]
    gate_before = bar_box(page, "$GW1 Gate review")["left"]

    # two days to the right, still holding the pointer
    drag(page, "Spec", "right", 2 * 28, release=False)
    build_live = bar_box(page, "Build")["left"]
    gate_live = bar_box(page, "$GW1 Gate review")["left"]
    assert build_live > build_before, "the dependant did not move during the drag"
    assert gate_live > gate_before, "the second-order dependant did not move during the drag"
    assert page.locator(".gantt-bar-preview").count() >= 2
    assert "Spec 3d @dev 2026-03-02" in plan_text(page), "written before release"

    page.mouse.up()
    wait_for_plan(page, "Spec 5d @dev 2026-03-02")
    page.wait_for_function("() => ganttTasks.find(t => t.name === 'Spec').duration_days === 5")
    # no snap-back: the committed schedule is where the preview put them
    assert bar_box(page, "Build")["left"] == build_live
    assert bar_box(page, "$GW1 Gate review")["left"] == gate_live


def test_drag_on_a_product_priority_bucket_line_writes_to_it(gantt):
    page = gantt
    drag(page, "$GW1 Gate review", "right", 28)
    wait_for_plan(page, "$GW1 Gate review 2d !! {QA} [depends Build]")


def test_drag_on_a_prefix_named_task_edits_only_that_task(gantt):
    page = gantt
    drag(page, "Design", "right", 28)
    wait_for_plan(page, "  Design 3d 2026-03-02\n")
    assert "  Design UI 2d [depends Design]" in plan_text(page)


def test_left_handle_changes_the_start_and_keeps_the_finish(gantt):
    page = gantt
    finish = task_field(page, "Spec", "finish")
    drag(page, "Spec", "left", 28)
    wait_for_plan(page, "Spec 2d @dev 2026-03-03")
    page.wait_for_function("() => ganttTasks.find(t => t.name === 'Spec').start === '2026-03-03'")
    assert task_field(page, "Spec", "finish") == finish


def test_one_undo_reverses_a_drag(gantt):
    page = gantt
    before = plan_text(page)
    # Wed finish + 3 days is a Sunday: two more working days
    drag(page, "Spec", "right", 3 * 28)
    wait_for_plan(page, "Spec 5d")
    page.evaluate("EditorUndoManager.undo()")
    page.wait_for_function(
        "before => document.getElementById('planEditor').value === before", arg=before
    )


def test_drag_at_the_years_zoom_moves_by_whole_months(gantt):
    page = gantt
    set_zoom(page, 1)
    # a 2-day task is 2px wide here: move-only, with a wider hit area
    assert page.evaluate(
        "() => ganttMainBar(ganttTasks.findIndex(t => t.name === 'Design'))"
        ".classList.contains('gantt-bar-narrow')"
    )
    # A 12px drag -- past the 5px press/drag threshold, but under half a
    # month at 1px/day -- is inside the dead zone and writes nothing...
    drag(page, "Design", "middle", 12)
    page.wait_for_timeout(150)
    assert "  Design 2d 2026-03-02\n" in plan_text(page)
    # ...and 30px is one month
    drag(page, "Design", "middle", 30)
    wait_for_plan(page, "  Design 2d 2026-04-02\n")


def test_escape_cancels_a_drag(gantt):
    page = gantt
    before = plan_text(page)
    left = bar_box(page, "Spec")["left"]
    drag(page, "Spec", "middle", 3 * 28, release=False)
    page.keyboard.press("Escape")
    page.mouse.up()
    page.wait_for_timeout(150)
    assert plan_text(page) == before
    assert bar_box(page, "Spec")["left"] == left


def test_summary_bars_cannot_be_dragged(gantt):
    page = gantt
    before = plan_text(page)
    box = page.evaluate(
        """() => {
            const bar = document.querySelector('#ganttBody .gantt-phase-bar');
            const r = bar.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2,
                     handles: bar.querySelectorAll('.gantt-bar-handle').length };
        }"""
    )
    assert box["handles"] == 0
    page.mouse.move(box["x"], box["y"])
    page.mouse.down()
    page.mouse.move(box["x"] + 90, box["y"], steps=5)
    page.mouse.up()
    page.wait_for_timeout(150)
    assert plan_text(page) == before
