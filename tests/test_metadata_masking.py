"""Words inside a comment or a ``[depends …]`` block are not this task's metadata.

``extract_metadata`` finds the comment and the dependency list correctly, then
runs every other pattern over the whole line, so a note such as ``"needs @alex
review"`` assigns alex and a predecessor called ``Fix bug #42`` labels the
dependant ``42]``. The editor's ``task-tokenizer.js`` masks those spans first,
so the form disagrees with the schedule. Issues #1564 (comments), #1565
(dependency blocks) and #1571 (fractional effort) under epic #1563.

Each case states the reading the line should have. The ones the engine gets
wrong today are ``xfail(strict=True)`` with the issue number: fixing the engine
turns them red until the marker comes off, so this file is the issues'
acceptance test. The engine's browser twin, ``static/engine/tokeniser.js``, is
held to the same answers line for line by tests/test_task_line_contract.py.
"""

from datetime import timedelta

import pytest

from noodle_core.metadata import extract_metadata


def xfail(issue):
    return pytest.mark.xfail(reason=issue, strict=True)


# ---------------------------------------------------------------------------
# #1564: text inside a quoted comment
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("line, field, expected", [
    pytest.param('Build 3d "needs @alex review"', "resources", None, marks=xfail("#1564")),
    pytest.param('Build 3d "50% done"', "percent", None, marks=xfail("#1564")),
    pytest.param('Build 3d "due 2026-01-01"', "due", None, marks=xfail("#1564")),
    pytest.param('Build 3d "due 2026-01-01" 2026-03-02', "due", "2026-03-02", marks=xfail("#1564")),
    pytest.param('Build "has #hash" 3d', "labels", None, marks=xfail("#1564")),
    pytest.param('Build "2d later"', "duration", None, marks=xfail("#1564")),
    pytest.param('Build 3d "see {Backlog}"', "bucket", None, marks=xfail("#1564")),
    pytest.param('Build 3d "see [depends X]"', "depends", None, marks=xfail("#1564")),
    pytest.param('Build 3d "~2h"', "effort_total", None, marks=xfail("#1564")),
    pytest.param('Build 3d "costs $core"', "deliverable", None, marks=xfail("#1564")),
    # already right: `!` inside a word is not a priority, `$5k` is not an id
    ('Build 3d "stop!"', "priority", "Low"),
    ('Build 3d "costs $5k"', "deliverable", None),
])
def test_comment_text_is_only_the_comment(line, field, expected):
    meta = extract_metadata(line)
    assert meta.get(field) == expected, meta


def test_the_comment_itself_is_still_read():
    assert extract_metadata('Build 3d "needs @alex review"')["comment"] == "needs @alex review"
    assert extract_metadata("Build 3d 'single'")["comment"] == "single"
    assert extract_metadata('Build 3d !"bang"')["comment"] == "bang"


# ---------------------------------------------------------------------------
# #1565: text inside [depends …]
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("line, field, expected", [
    pytest.param("Build 3d [depends Fix bug #42]", "labels", None, marks=xfail("#1565")),
    pytest.param("Build 3d [depends @alex review]", "resources", None, marks=xfail("#1565")),
    pytest.param("Build 3d [depends Sprint 2026-01-05]", "due", None, marks=xfail("#1565")),
    pytest.param("Build 3d [depends Task 50%]", "percent", None, marks=xfail("#1565")),
    pytest.param("Build [depends Phase 2d]", "duration", None, marks=xfail("#1565")),
    pytest.param("Build [depends A +2d] 10d", "duration", timedelta(days=10), marks=xfail("#1565")),
    pytest.param("Build [depends A -1w]", "duration", None, marks=xfail("#1565")),
    # already right: the deliverable search strips the block first
    ("Build 3d [depends $core]", "deliverable", None),
    ("Build 10d [depends A +2d]", "duration", timedelta(days=10)),
])
def test_dependency_text_is_only_the_dependency(line, field, expected):
    meta = extract_metadata(line)
    assert meta.get(field) == expected, meta


def test_the_dependencies_themselves_are_still_read():
    meta = extract_metadata("Build 3d [depends Fix bug #42, Sprint 2026-01-05:SS +2d]")
    assert meta["depends"] == ["Fix bug #42", "Sprint 2026-01-05"]
    assert meta["dependency_types"] == {"Sprint 2026-01-05": "SS"}
    assert meta["lag_lead"] == {"Sprint 2026-01-05": "+2d"}


# ---------------------------------------------------------------------------
# #1571: a fractional effort is not a duration
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("line, expected", [
    pytest.param("Build ~1.5d/3d", None, marks=xfail("#1571")),
    pytest.param("Build ~0.5d", None, marks=xfail("#1571")),
    pytest.param("Build ~2.25d/4d 3d", timedelta(days=3), marks=xfail("#1571")),
    ("Build ~2d/3d", None),
    ("Build ~8h 3d", timedelta(days=3)),
])
def test_effort_is_not_read_as_duration(line, expected):
    assert extract_metadata(line).get("duration") == expected


def test_fractional_effort_is_still_read():
    meta = extract_metadata("Build ~1.5d/3d")
    assert (meta["effort_completed"], meta["effort_total"]) == (1.5, 3.0)
    assert meta["percent"] == 50
