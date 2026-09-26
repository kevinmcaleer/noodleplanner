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
