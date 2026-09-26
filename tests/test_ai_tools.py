"""Tests for AI tool definitions and executor functions."""

import pytest

from noodle_web.ai_tools import (
    TOOL_DEFINITIONS,
    TOOL_EXECUTORS,
    execute_tool,
    _parse_front_matter,
    _find_task_line,
)

# ---------------------------------------------------------------------------
# Sample plan text used across tests
# ---------------------------------------------------------------------------

SAMPLE_PLAN = """\
---
title: Test Project
project manager: Alice
start date: 2026-01-19
budget: 500000
stakeholders:
  - @Bob {High} {Medium}
  - @Charlie {Low} {High}
resources:
  - @AL: Alice Smith, PM, alice@example.com
  - @BL: Bob Lee, Developer, bob@example.com
non-working-days:
  - Easter: 2026-04-03:2026-04-06
---
Phase 1
  *Design 5d @AL
  *Build 10d @BL
  Review 2d @AL !"check quality"

Phase 2 [depends Phase 1]
  *Testing 5d @BL %50
  Deployment 1d @AL $release_v1
"""

PLAN_WITH_SECTIONS = SAMPLE_PLAN.rstrip() + """

---budget---
| ID | Description | Estimate | Forecast | Type  | Invoice | PO | Supplier | Total | Ordered | Received | Category    |
|----|-------------|----------|----------|-------|---------|----|----------|-------|---------|----------|-------------|
| 1  | Server      | 5000     | 5000     | Capex |         |    | Acme     | 0     |         |          | Hardware    |

---benefits---
| ID | Type    | Title          | Description    | Objective Type | Target Value | Current Value | Target Date | Measurement | Linked To | Contribution % |
|----|---------|----------------|----------------|----------------|--------------|---------------|-------------|-------------|-----------|----------------|
| 1  | Benefit | Faster builds  | Reduce CI time |                | 50%          |               |             |             |           | 0              |

---raid log---
| ID | Type | Title       | Description    | Raised By | Owner | Mitigation Actions | Impact | Likelihood | Score | Status | Priority | Target Date |
|----|------|-------------|----------------|-----------|-------|--------------------|--------|------------|-------|--------|----------|-------------|
| 1  | Risk | Server risk | Might go down  |           | Alice |                    | 4      | 3          | 12    | Open   |          |             |

---comms---
| ID | Activity      | Audience   | Content       | Frequency | Channel | Owner | Status  |
|----|---------------|------------|---------------|-----------|---------|-------|---------|
| 1  | Status update | Team       | Weekly status | Weekly    | Email   | Alice | Active  |

---baseline---
| Task Name  | Start      | Finish     | Duration |
|------------|------------|------------|----------|
| Design     | 2026-01-19 | 2026-01-23 | 5d       |
"""


# ===================================================================
# Tool definition tests
# ===================================================================

class TestToolDefinitions:
    def test_tool_count(self):
        assert len(TOOL_DEFINITIONS) >= 33

    def test_all_tools_have_executors(self):
        tool_names = {t["function"]["name"] for t in TOOL_DEFINITIONS}
        executor_names = set(TOOL_EXECUTORS.keys())
        assert tool_names == executor_names

    def test_tool_definition_structure(self):
        for tool in TOOL_DEFINITIONS:
            assert tool["type"] == "function"
            func = tool["function"]
            assert "name" in func
            assert "description" in func
            assert "parameters" in func
            assert func["parameters"]["type"] == "object"

    def test_required_fields_present(self):
        for tool in TOOL_DEFINITIONS:
            func = tool["function"]
            params = func["parameters"]
            if "required" in params:
                props = params.get("properties", {})
                for req in params["required"]:
                    assert req in props, f"{func['name']} requires '{req}' but it's not in properties"


# ===================================================================
# Front matter parsing tests
# ===================================================================

class TestFrontMatter:
    def test_parse_front_matter(self):
        data, start, end = _parse_front_matter(SAMPLE_PLAN)
        assert data["title"] == "Test Project"
        assert data["project manager"] == "Alice"
        assert start == 0
        assert end > 0

    def test_parse_front_matter_no_front_matter(self):
        data, start, end = _parse_front_matter("No front matter here")
        assert data == {}
        assert start == -1


# ===================================================================
# Stakeholder tests
# ===================================================================

class TestStakeholders:
    def test_add_stakeholder(self):
        result, msg = execute_tool("add_stakeholder", SAMPLE_PLAN,
                                   {"name": "Diana", "interest": "High", "influence": "Low"})
        assert "@Diana {High} {Low}" in result
        assert "Added stakeholder" in msg

    def test_add_duplicate_stakeholder(self):
        result, msg = execute_tool("add_stakeholder", SAMPLE_PLAN, {"name": "Bob"})
        assert result == SAMPLE_PLAN
        assert "already exists" in msg

    def test_update_stakeholder(self):
        result, msg = execute_tool("update_stakeholder", SAMPLE_PLAN,
                                   {"name": "Bob", "interest": "Low", "influence": "Low"})
        assert "@Bob {Low} {Low}" in result
        assert "Updated stakeholder" in msg

    def test_update_missing_stakeholder(self):
        result, msg = execute_tool("update_stakeholder", SAMPLE_PLAN,
                                   {"name": "Nobody", "interest": "High"})
        assert result == SAMPLE_PLAN
        assert "not found" in msg

    def test_remove_stakeholder(self):
        result, msg = execute_tool("remove_stakeholder", SAMPLE_PLAN, {"name": "Charlie"})
        assert "@Charlie" not in result
        assert "@Bob" in result
        assert "Removed stakeholder" in msg


# ===================================================================
# Resource tests
# ===================================================================

class TestResources:
    def test_add_resource(self):
        result, msg = execute_tool("add_resource", SAMPLE_PLAN,
                                   {"name": "CD", "full_name": "Carol Davis",
                                    "role": "Tester", "email": "carol@example.com"})
        assert "@CD: Carol Davis, Tester, carol@example.com" in result
        assert "Added resource" in msg

    def test_add_duplicate_resource(self):
        result, msg = execute_tool("add_resource", SAMPLE_PLAN, {"name": "AL"})
        assert result == SAMPLE_PLAN
        assert "already exists" in msg

    def test_remove_resource(self):
        result, msg = execute_tool("remove_resource", SAMPLE_PLAN, {"name": "BL"})
        assert "@BL:" not in result
        assert "@AL:" in result

    def test_update_resource(self):
        result, msg = execute_tool("update_resource", SAMPLE_PLAN,
                                   {"name": "AL", "role": "Lead PM"})
        assert "Lead PM" in result
        assert "Updated resource" in msg


# ===================================================================
# Task tests
# ===================================================================

class TestTasks:
    def test_find_task_line(self):
        idx = _find_task_line(SAMPLE_PLAN, "Design")
        assert idx is not None
        assert "Design" in SAMPLE_PLAN.split('\n')[idx]

    def test_find_task_case_insensitive(self):
        idx = _find_task_line(SAMPLE_PLAN, "design")
        assert idx is not None

    def test_add_task_at_root(self):
        result, msg = execute_tool("add_task", SAMPLE_PLAN,
                                   {"name": "Phase 3", "duration": "10d"})
        assert "Phase 3 10d" in result
        assert "Added task" in msg

    def test_add_task_under_parent(self):
        result, msg = execute_tool("add_task", SAMPLE_PLAN,
                                   {"name": "Code Review", "parent": "Phase 1",
                                    "duration": "3d", "resource": "AL",
                                    "sequential": True})
        assert "*Code Review 3d @AL" in result

    def test_add_task_missing_parent(self):
        result, msg = execute_tool("add_task", SAMPLE_PLAN,
                                   {"name": "Orphan", "parent": "NonExistent"})
        assert result == SAMPLE_PLAN
        assert "not found" in msg

    def test_update_task_duration(self):
        result, msg = execute_tool("update_task", SAMPLE_PLAN,
                                   {"name": "Design", "duration": "8d"})
        lines = result.split('\n')
        design_line = [l for l in lines if 'Design' in l and '8d' in l]
        assert len(design_line) == 1
        assert "duration=8d" in msg

    def test_update_task_rename(self):
        result, msg = execute_tool("update_task", SAMPLE_PLAN,
                                   {"name": "Build", "new_name": "Construction"})
        assert "Construction" in result
        assert "renamed" in msg

    def test_update_task_not_found(self):
        result, msg = execute_tool("update_task", SAMPLE_PLAN,
                                   {"name": "FakeTask", "duration": "1d"})
        assert result == SAMPLE_PLAN
        assert "not found" in msg

    def test_remove_task(self):
        result, msg = execute_tool("remove_task", SAMPLE_PLAN, {"name": "Build"})
        assert "Build" not in result
        assert "Design" in result

    def test_remove_task_with_children(self):
        result, msg = execute_tool("remove_task", SAMPLE_PLAN, {"name": "Phase 1"})
        lines = result.split('\n')
        # Phase 1 task line itself should be gone
        phase1_lines = [l for l in lines if l.strip() == 'Phase 1'
                        or l.strip().startswith('Phase 1 ')]
        assert len(phase1_lines) == 0
        assert "Design" not in result
        assert "Build" not in result
        assert "Phase 2" in result

    def test_set_dependency(self):
        result, msg = execute_tool("set_dependency", SAMPLE_PLAN,
                                   {"task_name": "Design", "depends_on": "Review"})
        lines = result.split('\n')
        design_line = [l for l in lines if 'Design' in l][0]
        assert "[depends Review]" in design_line

    def test_set_dependency_with_type_and_lag(self):
        result, msg = execute_tool("set_dependency", SAMPLE_PLAN,
                                   {"task_name": "Build", "depends_on": "Design",
                                    "dep_type": "SS", "lag": "+2d"})
        lines = result.split('\n')
        build_line = [l for l in lines if 'Build' in l][0]
        assert "[depends Design:SS +2d]" in build_line

    def test_assign_resource(self):
        result, msg = execute_tool("assign_resource", SAMPLE_PLAN,
                                   {"task_name": "Testing", "resource_name": "AL"})
        lines = result.split('\n')
        test_line = [l for l in lines if 'Testing' in l][0]
        assert "@AL" in test_line

    def test_move_task(self):
        result, msg = execute_tool("move_task", SAMPLE_PLAN,
                                   {"name": "Review", "new_parent": "Phase 2"})
        assert "Moved task" in msg
        # Review should now be indented under Phase 2
        lines = result.split('\n')
        review_idx = None
        phase2_idx = None
        for i, l in enumerate(lines):
            if 'Review' in l and 'check quality' in l:
                review_idx = i
            if 'Phase 2' in l:
                phase2_idx = i
        assert review_idx is not None
        assert phase2_idx is not None
        assert review_idx > phase2_idx


# ===================================================================
# update_task edits tokens in place
# ===================================================================

RICH_PLAN = """\
---
title: Rich
start date: 2026-01-19
resources:
  - @alice: Alice
  - @bob: Bob
---
Phase 1
  Kickoff 1d @alice
  Design @alice @bob[50%] 3d 75% #urgent #ux 2026-02-02 $spec [depends Kickoff] !"needs sign-off"
  Build 5d @bob p40 [depends Design +2d] @alice:A
  Sign-off
"""


def _task_line(plan_text, name):
    from noodle_web.ai_tools import _find_task_line
    idx = _find_task_line(plan_text, name)
    assert idx is not None, f"{name} not found"
    return plan_text.split('\n')[idx]


def _task_meta(plan_text, name):
    from noodle_core.metadata import extract_metadata
    return extract_metadata(_task_line(plan_text, name).strip())


class TestUpdateTaskPreservesMetadata:
    """update_task used to rebuild the line from seven regex captures,
    dropping every resource and label but the first, allocations, dates and
    N%/pN progress, and writing completion as "%80", which the core never
    reads."""

    def test_duration_change_keeps_every_other_token(self):
        result, msg = execute_tool("update_task", RICH_PLAN,
                                   {"name": "Design", "duration": "5d"})
        assert "duration=5d" in msg
        line = _task_line(result, "Design")
        assert line == ('  Design @alice @bob[50%] 5d 75% #urgent #ux 2026-02-02 '
                        '$spec [depends Kickoff] !"needs sign-off"')
        meta = _task_meta(result, "Design")
        assert meta['resources'] == 'alice, bob[50%]'
        assert meta['labels'] == ['urgent', 'ux']
        assert meta['percent'] == 75
        assert meta['due'] == '2026-02-02'
        assert meta['duration'].days == 5

    def test_lag_is_not_mistaken_for_duration(self):
        result, _ = execute_tool("update_task", RICH_PLAN,
                                 {"name": "Build", "duration": "8d"})
        line = _task_line(result, "Build")
        assert line == '  Build 8d @bob p40 [depends Design +2d] @alice:A'

    def test_duration_appended_when_absent(self):
        result, _ = execute_tool("update_task", RICH_PLAN,
                                 {"name": "Sign-off", "duration": "1d"})
        assert _task_line(result, "Sign-off") == '  Sign-off 1d'

    def test_completion_written_as_core_percent(self):
        result, msg = execute_tool("update_task", RICH_PLAN,
                                   {"name": "Design", "completion": 80})
        assert "completion=80%" in msg
        line = _task_line(result, "Design")
        assert ' 80% ' in line
        assert '75%' not in line and '%80' not in line
        # The allocation's [50%] is not progress and is left alone.
        assert '@bob[50%]' in line
        assert _task_meta(result, "Design")['percent'] == 80

    def test_completion_replaces_legacy_progress(self):
        result, _ = execute_tool("update_task", RICH_PLAN,
                                 {"name": "Build", "completion": 90})
        line = _task_line(result, "Build")
        assert line == '  Build 5d @bob 90% [depends Design +2d] @alice:A'
        assert _task_meta(result, "Build")['percent'] == 90

    def test_completion_replaces_old_ai_percent_form(self):
        # SAMPLE_PLAN's Testing line carries "%50", the form this tool used
        # to write; it is replaced rather than left beside the new value.
        result, _ = execute_tool("update_task", SAMPLE_PLAN,
                                 {"name": "Testing", "completion": 60})
        assert _task_line(result, "Testing") == '  *Testing 5d @BL 60%'
        assert _task_meta(result, "Testing")['percent'] == 60

    def test_task_still_found_after_completion_on_bare_name(self):
        result, _ = execute_tool("update_task", RICH_PLAN,
                                 {"name": "Sign-off", "completion": 20})
        assert _task_line(result, "Sign-off") == '  Sign-off 20%'
        result, msg = execute_tool("update_task", result,
                                   {"name": "Sign-off", "duration": "1d"})
        assert "not found" not in msg
        assert _task_line(result, "Sign-off") == '  Sign-off 20% 1d'

    def test_resource_change_keeps_labels_and_quality_roles(self):
        result, msg = execute_tool("update_task", RICH_PLAN,
                                   {"name": "Build", "resource": "carol"})
        assert "resource=@carol" in msg
        line = _task_line(result, "Build")
        assert line == '  Build 5d @carol p40 [depends Design +2d] @alice:A'

    def test_resource_replaces_all_assigned_resources(self):
        result, _ = execute_tool("update_task", RICH_PLAN,
                                 {"name": "Design", "resource": "carol"})
        meta = _task_meta(result, "Design")
        assert meta['resources'] == 'carol'
        assert meta['labels'] == ['urgent', 'ux']
        assert meta['percent'] == 75

    def test_rename_and_comment_keep_metadata(self):
        result, _ = execute_tool("update_task", RICH_PLAN,
                                 {"name": "Design", "new_name": "UX Design",
                                  "comment": "approved"})
        line = _task_line(result, "UX Design")
        assert line == ('  UX Design @alice @bob[50%] 3d 75% #urgent #ux 2026-02-02 '
                        '$spec [depends Kickoff] !"approved"')

    def test_comment_appended_when_absent(self):
        result, _ = execute_tool("update_task", RICH_PLAN,
                                 {"name": "Kickoff", "comment": "all hands"})
        assert _task_line(result, "Kickoff") == '  Kickoff 1d @alice !"all hands"'

    def test_sequential_marker_kept(self):
        result, _ = execute_tool("update_task", SAMPLE_PLAN,
                                 {"name": "Design", "duration": "8d"})
        assert _task_line(result, "Design") == '  *Design 8d @AL'


# ===================================================================
# Labels, recurrence, milestones and non-working-day updates
# ===================================================================

def _changed_lines(before, after):
    """The lines of *after* that differ from *before* (same line count)."""
    old, new = before.split('\n'), after.split('\n')
    assert len(old) == len(new)
    return [n for o, n in zip(old, new) if o != n]


class TestLabelTools:
    """add_label/remove_label unpacked _get_task_area's (str, int, int) as
    (text, before, after) and concatenated them: a TypeError on every call,
    reported to the model as "Invalid arguments"."""

    def test_add_label(self):
        result, msg = execute_tool("add_label", SAMPLE_PLAN,
                                   {"task_name": "Build", "label": "backend"})
        assert "Added #backend" in msg
        assert _changed_lines(SAMPLE_PLAN, result) == ['  *Build 10d @BL #backend']

    def test_add_label_already_present(self):
        result, msg = execute_tool("add_label", RICH_PLAN,
                                   {"task_name": "Design", "label": "#ux"})
        assert result == RICH_PLAN
        assert "already has label" in msg

    def test_add_label_missing_task(self):
        result, msg = execute_tool("add_label", SAMPLE_PLAN,
                                   {"task_name": "Nope", "label": "x"})
        assert result == SAMPLE_PLAN
        assert "not found" in msg

    def test_remove_label(self):
        result, msg = execute_tool("remove_label", RICH_PLAN,
                                   {"task_name": "Design", "label": "ux"})
        assert "Removed #ux" in msg
        assert _task_meta(result, "Design")['labels'] == ['urgent']

    def test_remove_label_does_not_eat_a_longer_label(self):
        result, msg = execute_tool("remove_label", RICH_PLAN,
                                   {"task_name": "Design", "label": "urg"})
        assert result == RICH_PLAN
        assert "does not have label" in msg


class TestRecurrenceTools:
    """set_recurrence/remove_recurrence had the same TypeError as the label
    tools."""

    def test_set_recurrence(self):
        result, msg = execute_tool("set_recurrence", RICH_PLAN,
                                   {"task_name": "Kickoff", "pattern": "weekly mon"})
        assert "Set recurrence" in msg
        assert _changed_lines(RICH_PLAN, result) == ['  Kickoff 1d @alice [repeats weekly mon]']
        assert _task_meta(result, "Kickoff")['recurrence']['days'] == ['mon']

    def test_set_recurrence_replaces_existing(self):
        plan, _ = execute_tool("set_recurrence", RICH_PLAN,
                               {"task_name": "Kickoff", "pattern": "daily"})
        result, _ = execute_tool("set_recurrence", plan,
                                 {"task_name": "Kickoff", "pattern": "monthly 1st mon"})
        assert _task_line(result, "Kickoff") == '  Kickoff 1d @alice [repeats monthly 1st mon]'

    def test_remove_recurrence_on_task_with_no_other_metadata(self):
        plan = RICH_PLAN.replace("  Sign-off\n", "  Standup [repeats daily]\n")
        result, msg = execute_tool("remove_recurrence", plan,
                                   {"task_name": "Standup"})
        assert "Removed recurrence" in msg
        assert _changed_lines(plan, result) == ['  Standup']

    def test_remove_recurrence_when_none(self):
        result, msg = execute_tool("remove_recurrence", RICH_PLAN,
                                   {"task_name": "Kickoff"})
        assert result == RICH_PLAN
        assert "has no recurrence" in msg


class TestUpdateNonWorkingDay:
    """update_non_working_day called an undefined _split_front_matter, so
    every call failed with a NameError."""

    def _named(self, plan_text):
        from noodle_core import FrontMatterParser
        return FrontMatterParser(plan_text).parse_named_non_working_days()

    def test_update_end_date(self):
        result, msg = execute_tool("update_non_working_day", SAMPLE_PLAN,
                                   {"name": "Easter", "end_date": "2026-04-07"})
        assert "Updated non-working day" in msg
        assert self._named(result) == [
            {'name': 'Easter', 'start': '2026-04-03', 'finish': '2026-04-07'}]
        assert _changed_lines(SAMPLE_PLAN, result) == ['  - Easter: 2026-04-03:2026-04-07']

    def test_rename_keeps_dates(self):
        result, _ = execute_tool("update_non_working_day", SAMPLE_PLAN,
                                 {"name": "Easter", "new_name": "Easter break"})
        assert self._named(result) == [
            {'name': 'Easter break', 'start': '2026-04-03', 'finish': '2026-04-06'}]

    def test_not_found(self):
        result, msg = execute_tool("update_non_working_day", SAMPLE_PLAN,
                                   {"name": "Christmas", "start_date": "2026-12-25"})
        assert result == SAMPLE_PLAN
        assert "not found" in msg


class TestMilestoneDates:
    """add_milestone/update_milestone accepted a date and dropped it."""

    def test_add_milestone_with_date(self):
        result, msg = execute_tool("add_milestone", SAMPLE_PLAN,
                                   {"name": "Go Live", "parent": "Phase 2",
                                    "date": "2026-06-01"})
        assert "Added task 'Go Live'" in msg
        assert _task_line(result, "Go Live") == '  Go Live 0d 2026-06-01'
        meta = _task_meta(result, "Go Live")
        assert meta['due'] == '2026-06-01'
        assert meta['duration'].days == 0

    def test_add_milestone_rejects_non_iso_date(self):
        result, msg = execute_tool("add_milestone", SAMPLE_PLAN,
                                   {"name": "Go Live", "date": "June 1st"})
        assert result == SAMPLE_PLAN
        assert "YYYY-MM-DD" in msg

    def test_update_milestone_date_replaces_existing(self):
        plan, _ = execute_tool("add_milestone", SAMPLE_PLAN,
                               {"name": "Go Live", "date": "2026-06-01"})
        result, msg = execute_tool("update_milestone", plan,
                                   {"name": "Go Live", "new_name": "Launch",
                                    "date": "2026-07-01"})
        assert "not found" not in msg
        assert _changed_lines(plan, result) == ['Launch 0d 2026-07-01']

    def test_update_milestone_date_appended_when_absent(self):
        plan = SAMPLE_PLAN.replace("  Deployment 1d @AL $release_v1\n",
                                   "  Deployment 1d @AL $release_v1\n  Go Live 0d\n")
        result, _ = execute_tool("update_milestone", plan,
                                 {"name": "Go Live", "date": "2026-07-01"})
        assert _changed_lines(plan, result) == ['  Go Live 0d 2026-07-01']

    def test_update_milestone_leaves_deadline_alone(self):
        plan = SAMPLE_PLAN.replace("  Deployment 1d @AL $release_v1\n",
                                   "  Deployment 1d @AL $release_v1\n"
                                   "  Go Live 0d D2026-08-01 2026-06-01\n")
        result, _ = execute_tool("update_milestone", plan,
                                 {"name": "Go Live", "date": "2026-07-01"})
        assert _changed_lines(plan, result) == ['  Go Live 0d D2026-08-01 2026-07-01']


# ===================================================================
# Task area ends at every back-matter section
# ===================================================================

def _scheduled_task_names(plan_text):
    from noodle_web.plan_service import PlanService
    result = PlanService().parse(plan_text)
    assert result.success, result.error
    return [t.get('name') for t in result.tasks]


class TestTaskAreaBoundary:
    """The task area used to end only at the six markers ai_tools listed
    itself, so a task added to a plan whose first back-matter section was
    lessons learned, parking lot, estimates or highlights went to the end of
    the file -- inside that section, where it was never scheduled."""

    @pytest.mark.parametrize("section", [
        "---lessons learned---\n"
        "| ID | Observation | Impact Type |\n"
        "|----|-------------|-------------|\n"
        "| 1  | Plan early  | Went Well   |\n",
        "---parking lot---\n- Maybe a mobile app\n",
        "---estimates---\n| Task | Optimistic | Likely | Pessimistic |\n"
        "|------|------------|--------|-------------|\n"
        "| Build | 5d | 10d | 20d |\n",
    ], ids=["lessons-learned", "parking-lot", "estimates"])
    def test_add_task_lands_before_section(self, section):
        plan = SAMPLE_PLAN.rstrip() + "\n\n" + section
        result, msg = execute_tool("add_task", plan,
                                   {"name": "Launch prep", "duration": "2d"})
        assert "Added task" in msg
        marker = section.split('\n')[0]
        assert result.index("Launch prep 2d") < result.index(marker)
        assert "Launch prep" in _scheduled_task_names(result)

    def test_add_task_lands_before_highlights_separator(self):
        # update_plan_highlights writes a bare "---" lead-in before the
        # highlights marker; a task inserted between the two would sit
        # after a stray separator rather than in the task list.
        from noodle_core.format_converter import update_plan_highlights
        plan = update_plan_highlights(SAMPLE_PLAN, [
            {'date': '2026-01-20', 'author': 'AL', 'content': 'On track'},
        ])
        result, _ = execute_tool("add_task", plan,
                                 {"name": "Launch prep", "duration": "2d"})
        lines = result.split('\n')
        marker_idx = lines.index("---highlights---")
        separator_idx = max(i for i in range(marker_idx) if lines[i] == "---")
        assert lines.index("Launch prep 2d") < separator_idx
        assert "Launch prep" in _scheduled_task_names(result)


# ===================================================================
# Non-working day tests
# ===================================================================

class TestNonWorkingDays:
    def test_add_non_working_day(self):
        result, msg = execute_tool("add_non_working_day", SAMPLE_PLAN,
                                   {"name": "Christmas", "start_date": "2026-12-25",
                                    "end_date": "2026-12-28"})
        assert "Christmas: 2026-12-25:2026-12-28" in result

    def test_add_single_day(self):
        result, msg = execute_tool("add_non_working_day", SAMPLE_PLAN,
                                   {"name": "Bank Holiday", "start_date": "2026-05-01"})
        assert "Bank Holiday: 2026-05-01" in result

    def test_remove_non_working_day(self):
        result, msg = execute_tool("remove_non_working_day", SAMPLE_PLAN, {"name": "Easter"})
        assert "Easter" not in result


# ===================================================================
# RAID tests
# ===================================================================

class TestRAID:
    def test_add_raid_item(self):
        result, msg = execute_tool("add_raid_item", PLAN_WITH_SECTIONS,
                                   {"type": "Risk", "title": "Budget overrun",
                                    "owner": "Alice", "impact": "High"})
        assert "Budget overrun" in result
        assert "ID 2" in msg

    def test_update_raid_item(self):
        result, msg = execute_tool("update_raid_item", PLAN_WITH_SECTIONS,
                                   {"id": 1, "status": "Closed"})
        assert "Closed" in result
        assert "Updated RAID item 1" in msg

    def test_remove_raid_item(self):
        result, msg = execute_tool("remove_raid_item", PLAN_WITH_SECTIONS, {"id": 1})
        assert "Server risk" not in result
        assert "Removed RAID item 1" in msg

    def test_update_missing_raid_item(self):
        result, msg = execute_tool("update_raid_item", PLAN_WITH_SECTIONS,
                                   {"id": 999, "status": "Closed"})
        assert "not found" in msg


# ===================================================================
# Budget tests
# ===================================================================

class TestBudget:
    def test_add_budget_item(self):
        result, msg = execute_tool("add_budget_item", PLAN_WITH_SECTIONS,
                                   {"description": "Software License",
                                    "estimate": 1200, "type": "Opex",
                                    "category": "Software"})
        assert "Software License" in result
        assert "ID 2" in msg

    def test_update_budget_item(self):
        result, msg = execute_tool("update_budget_item", PLAN_WITH_SECTIONS,
                                   {"id": 1, "estimate": 7500})
        assert "7500" in result

    def test_remove_budget_item(self):
        result, msg = execute_tool("remove_budget_item", PLAN_WITH_SECTIONS, {"id": 1})
        assert "Removed budget item 1" in msg

    def test_budget_preserves_other_sections(self):
        result, msg = execute_tool("add_budget_item", PLAN_WITH_SECTIONS,
                                   {"description": "New item"})
        assert "---raid log---" in result
        assert "---comms---" in result
        assert "---baseline---" in result


# ===================================================================
# Benefits tests
# ===================================================================

class TestBenefits:
    def test_add_benefit(self):
        result, msg = execute_tool("add_benefit", PLAN_WITH_SECTIONS,
                                   {"type": "Benefit", "title": "Cost savings",
                                    "target_value": "20%"})
        assert "Cost savings" in result
        assert "ID 2" in msg

    def test_update_benefit(self):
        result, msg = execute_tool("update_benefit", PLAN_WITH_SECTIONS,
                                   {"id": 1, "title": "Much faster builds"})
        assert "Much faster builds" in result

    def test_remove_benefit(self):
        result, msg = execute_tool("remove_benefit", PLAN_WITH_SECTIONS, {"id": 1})
        assert "Removed benefit 1" in msg

    def test_link_benefit(self):
        # Add a second benefit first, then link
        plan, _ = execute_tool("add_benefit", PLAN_WITH_SECTIONS,
                               {"type": "Benefit", "title": "Savings"})
        result, msg = execute_tool("link_benefit", plan, {"from_id": 1, "to_id": 2})
        assert "Linked benefit 1 to benefit 2" in msg


# ===================================================================
# Comms tests
# ===================================================================

class TestComms:
    def test_add_comms_activity(self):
        result, msg = execute_tool("add_comms_activity", PLAN_WITH_SECTIONS,
                                   {"audience": "Stakeholders",
                                    "message": "Monthly report",
                                    "frequency": "Monthly"})
        assert "Monthly report" in result
        assert "ID 2" in msg

    def test_update_comms_activity(self):
        result, msg = execute_tool("update_comms_activity", PLAN_WITH_SECTIONS,
                                   {"id": 1, "frequency": "Daily"})
        assert "Updated comms activity 1" in msg

    def test_remove_comms_activity(self):
        result, msg = execute_tool("remove_comms_activity", PLAN_WITH_SECTIONS, {"id": 1})
        assert "Removed comms activity 1" in msg


# ===================================================================
# Deliverable tests
# ===================================================================

class TestDeliverables:
    def test_add_deliverable(self):
        result, msg = execute_tool("add_deliverable", SAMPLE_PLAN, {"name": "docs_v1"})
        assert "$docs_v1" in result
        assert "milestone" in msg

    def test_add_existing_deliverable(self):
        result, msg = execute_tool("add_deliverable", SAMPLE_PLAN, {"name": "release_v1"})
        assert "already exists" in msg

    def test_update_deliverable(self):
        result, msg = execute_tool("update_deliverable", SAMPLE_PLAN,
                                   {"name": "release_v1", "new_name": "release_v2"})
        assert "$release_v2" in result
        assert "$release_v1" not in result

    def test_remove_deliverable(self):
        result, msg = execute_tool("remove_deliverable", SAMPLE_PLAN, {"name": "release_v1"})
        assert "$release_v1" not in result


# ===================================================================
# Baseline tests
# ===================================================================

class TestBaseline:
    def test_create_baseline(self):
        result, msg = execute_tool("create_baseline", SAMPLE_PLAN, {})
        assert "---baseline---" in result
        assert "Design" in result
        assert "Created baseline" in msg


# ===================================================================
# Plan structure tests
# ===================================================================

class TestPlanStructure:
    def test_create_plan(self):
        result, msg = execute_tool("create_plan", "",
                                   {"title": "New Project",
                                    "project_manager": "Bob",
                                    "start_date": "2026-06-01"})
        assert "title: New Project" in result
        assert "project manager: Bob" in result
        assert "start date: 2026-06-01" in result

    def test_update_front_matter(self):
        result, msg = execute_tool("update_front_matter", SAMPLE_PLAN,
                                   {"field": "budget", "value": "750000"})
        assert "budget: 750000" in result


# ===================================================================
# Error handling tests
# ===================================================================

class TestErrorHandling:
    def test_unknown_tool(self):
        result, msg = execute_tool("nonexistent_tool", SAMPLE_PLAN, {})
        assert result == SAMPLE_PLAN
        assert "Unknown tool" in msg

    def test_invalid_arguments(self):
        result, msg = execute_tool("add_stakeholder", SAMPLE_PLAN,
                                   {"invalid_arg": "value"})
        assert "Invalid arguments" in msg or "Error" in msg

    def test_no_front_matter(self):
        plain = "Just some text\nNo front matter"
        result, msg = execute_tool("add_stakeholder", plain, {"name": "Test"})
        assert "No front matter" in msg
