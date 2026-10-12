"""The timeline's phase bars show progress rolled up from their subtasks.

A phase's green band covers the share of its subtasks that is done, weighted by
duration and including the tasks inside nested phases, rather than whatever
single percent the phase row itself carried.

Usage:
    uv run pytest tests/ui/test_timeline_rollup_progress.py -q
"""

from .helpers import open_project_view, set_editor_value

PLAN = """---
title: Rollup
start: 2026-01-05
---

Phase One
  Research @sam 3d 100%
  Build @jo 7d 0%
  Sub Phase
    Deep Dive @sam 10d 100%
Phase Two
  Ship @sam 2d
"""


def _render(page, app_server):
    open_project_view(page, app_server)
    set_editor_value(page, PLAN)
    page.wait_for_function(
        "() => typeof timelineTasks !== 'undefined' && timelineTasks.length > 0"
    )


def _rolled_up(page, name):
    return page.evaluate(
        """name => {
            const phase = timelineTasks.find(t => t.name === name);
            return phaseRolledUpPercent(phase, timelineTasks);
        }""",
        name,
    )


def test_percent_is_weighted_by_duration_across_nested_phases(page, app_server):
    _render(page, app_server)
    # (3*100 + 7*0 + 10*100) / 20 -- an unweighted mean of the direct
    # children would say 50, and ignoring the sub-phase would say 30.
    assert _rolled_up(page, "Phase One") == 65


def test_phase_without_progress_stays_at_zero(page, app_server):
    _render(page, app_server)
    assert _rolled_up(page, "Phase Two") == 0


def test_minimal_timeline_draws_the_green_band(page, app_server):
    _render(page, app_server)
    page.evaluate(
        """() => {
            const toggle = document.getElementById('minimalTimelineToggle');
            toggle.checked = true;
            toggle.dispatchEvent(new Event('change', { bubbles: true }));
        }"""
    )
    page.evaluate("() => switchOutputTab('timeline')")
    page.wait_for_selector(".minimal-timeline-svg rect")
    ratios = page.evaluate(
        """() => {
            const rects = [...document.querySelectorAll(
                '#timeline-view .minimal-timeline-svg rect[fill="#4caf50"]')];
            return rects.map(r => parseFloat(r.getAttribute('width')));
        }"""
    )
    assert ratios, "expected a green progress band for the partly done phase"
