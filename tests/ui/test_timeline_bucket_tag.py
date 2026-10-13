"""A phase's `{bucket}` tag is metadata, so the timeline names it without braces.

Usage:
    uv run pytest tests/ui/test_timeline_bucket_tag.py -q
"""

from .helpers import open_project_view, set_editor_value

PLAN = """---
title: Buckets
start: 2026-10-05
---

Blueprint {blueprint}
  Design 5d {blueprint}
Build {build}
  Implement 8d {build}
"""


def test_timeline_phase_names_leave_out_the_bucket_tag(page, app_server):
    open_project_view(page, app_server)
    set_editor_value(page, PLAN)
    page.wait_for_function(
        "() => typeof timelineTasks !== 'undefined' && timelineTasks.length > 0"
    )
    assert page.evaluate("() => timelineTasks.map(t => t.name)") == [
        "Blueprint", "Design", "Build", "Implement",
    ]
