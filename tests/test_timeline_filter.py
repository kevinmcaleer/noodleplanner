"""Tests for timeline top-level task filtering (issue #175).

The updateTimeline function in script.js filters out the single top-level
task when there is exactly one, since it represents the project container
and clutters the timeline. The "top level" is defined as the minimum level
in the task list (typically level 1 from the parse API).

These tests verify the task level structure from the parse API and validate
the filtering logic.
"""

import pytest
from fastapi.testclient import TestClient

from noodle_web import app


@pytest.fixture
def client():
    """Create a test client for the FastAPI app."""
    return TestClient(app)


def filter_top_level_tasks(tasks):
    """Python implementation of the JS timeline top-level filtering logic.

    If there is exactly one task at the minimum level, filter it out so it
    does not appear on the timeline. This mirrors the logic in
    updateTimeline() in script.js.
    """
    if not tasks:
        return tasks
    min_level = min(t["level"] for t in tasks)
    top_level = [t for t in tasks if t["level"] == min_level]
    if len(top_level) == 1:
        return [t for t in tasks if t["level"] != min_level]
    return tasks


class TestTimelineTopLevelFilter:
    """Test that the top-level project task is filtered from the timeline."""

    def test_single_top_level_task_is_filtered(self):
        """When there is exactly one task at the minimum level, remove it."""
        tasks = [
            {"name": "Project Alpha", "level": 1, "is_summary": True},
            {"name": "Phase 1", "level": 2, "is_summary": True},
            {"name": "Task A", "level": 3, "is_summary": False},
            {"name": "Task B", "level": 3, "is_summary": False},
            {"name": "Phase 2", "level": 2, "is_summary": True},
            {"name": "Task C", "level": 3, "is_summary": False},
        ]
        filtered = filter_top_level_tasks(tasks)
        assert len(filtered) == 5
        assert all(t["level"] != 1 for t in filtered)
        assert filtered[0]["name"] == "Phase 1"

    def test_multiple_top_level_tasks_are_kept(self):
        """When there are multiple tasks at the minimum level, keep all."""
        tasks = [
            {"name": "Phase 1", "level": 1, "is_summary": True},
            {"name": "Task A", "level": 2, "is_summary": False},
            {"name": "Phase 2", "level": 1, "is_summary": True},
            {"name": "Task B", "level": 2, "is_summary": False},
        ]
        filtered = filter_top_level_tasks(tasks)
        assert len(filtered) == 4
        assert filtered[0]["name"] == "Phase 1"
        assert filtered[2]["name"] == "Phase 2"

    def test_empty_task_list(self):
        """An empty list stays empty."""
        filtered = filter_top_level_tasks([])
        assert filtered == []

    def test_only_top_level_task(self):
        """A single top-level task with no children is filtered out."""
        tasks = [
            {"name": "Project", "level": 1, "is_summary": True},
        ]
        filtered = filter_top_level_tasks(tasks)
        assert filtered == []

    def test_children_of_filtered_task_remain(self):
        """Children at deeper levels are preserved after filtering."""
        tasks = [
            {"name": "Project", "level": 1, "is_summary": True},
            {"name": "Phase 1", "level": 2, "is_summary": True},
            {"name": "Sub-phase", "level": 3, "is_summary": True},
            {"name": "Task", "level": 4, "is_summary": False},
        ]
        filtered = filter_top_level_tasks(tasks)
        assert len(filtered) == 3
        assert [t["name"] for t in filtered] == ["Phase 1", "Sub-phase", "Task"]

    def test_filter_works_with_level_zero(self):
        """Filter also works if levels start at 0."""
        tasks = [
            {"name": "Root", "level": 0, "is_summary": True},
            {"name": "Child 1", "level": 1, "is_summary": False},
            {"name": "Child 2", "level": 1, "is_summary": False},
        ]
        filtered = filter_top_level_tasks(tasks)
        assert len(filtered) == 2
        assert all(t["level"] == 1 for t in filtered)

    def test_all_tasks_same_level_multiple(self):
        """When all tasks are at the same level and there are many, keep all."""
        tasks = [
            {"name": "Task A", "level": 2, "is_summary": False},
            {"name": "Task B", "level": 2, "is_summary": False},
            {"name": "Task C", "level": 2, "is_summary": False},
        ]
        filtered = filter_top_level_tasks(tasks)
        assert len(filtered) == 3

    def test_all_tasks_same_level_single(self):
        """When there is a single task, it gets filtered as the lone top level."""
        tasks = [
            {"name": "Only Task", "level": 5, "is_summary": False},
        ]
        filtered = filter_top_level_tasks(tasks)
        assert filtered == []


class TestParseEndpointTaskLevels:
    """Test that the /api/parse endpoint returns tasks with correct levels."""

    def test_parse_returns_tasks_with_level(self, client):
        """Parse endpoint returns tasks with a level property."""
        plan = """Phase 1
  Task 1 @john 3d
  Task 2 @jane 2d
Phase 2
  Task 3 @john 5d"""
        response = client.post(
            "/api/parse",
            json={"plan_text": plan, "project_name": "Test Project"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        tasks = data["tasks"]
        assert len(tasks) > 0
        for task in tasks:
            assert "level" in task
            assert "is_summary" in task

    def test_parse_multiple_phases_not_filtered(self, client):
        """A plan with multiple phases at the same level keeps all tasks."""
        plan = """Phase 1
  Task A 3d
Phase 2
  Task B 2d
Phase 3
  Task C 4d"""
        response = client.post(
            "/api/parse",
            json={"plan_text": plan, "project_name": "Multi Phase"}
        )
        assert response.status_code == 200
        data = response.json()
        tasks = data["tasks"]

        # Multiple phases at the top level means filter should not remove any
        filtered = filter_top_level_tasks(tasks)
        assert len(filtered) == len(tasks)

    def test_parse_wrapped_plan_single_top_level_filtered(self, client):
        """A plan with an explicit project wrapper has one top-level task
        that should be filtered by the JS logic."""
        plan = """Website Rebuild
  Design Phase
    Wireframes 3d
    Mockups 2d
  Build Phase
    Frontend 5d
    Backend 5d"""
        response = client.post(
            "/api/parse",
            json={"plan_text": plan, "project_name": "Website Rebuild"}
        )
        assert response.status_code == 200
        data = response.json()
        tasks = data["tasks"]

        # Find the minimum level
        min_level = min(t["level"] for t in tasks)
        top_level_before = [t for t in tasks if t["level"] == min_level]

        # There should be exactly one task at the top level (the project wrapper)
        assert len(top_level_before) == 1
        assert top_level_before[0]["name"] == "Website Rebuild"
        assert top_level_before[0]["is_summary"] is True

        # After filtering, the project wrapper should be removed
        filtered = filter_top_level_tasks(tasks)
        assert len(filtered) == len(tasks) - 1
        top_level_after = [t for t in filtered if t["level"] == min_level]
        assert len(top_level_after) == 0

        # Phases and tasks should still be present
        phase_names = [t["name"] for t in filtered if t["is_summary"]]
        assert "Design Phase" in phase_names
        assert "Build Phase" in phase_names


class TestTimelineFilterEdgeCases:
    """Edge case tests for the timeline filtering logic."""

    def test_filter_preserves_task_data(self):
        """Filtering does not mutate or lose task properties."""
        tasks = [
            {"name": "Project", "level": 1, "is_summary": True,
             "start": "2025-01-01", "finish": "2025-06-30", "duration_days": 180},
            {"name": "Phase 1", "level": 2, "is_summary": True,
             "start": "2025-01-01", "finish": "2025-03-31", "duration_days": 90},
            {"name": "Task 1", "level": 3, "is_summary": False,
             "start": "2025-01-01", "finish": "2025-01-15", "duration_days": 14},
        ]
        filtered = filter_top_level_tasks(tasks)
        assert len(filtered) == 2
        phase = filtered[0]
        assert phase["name"] == "Phase 1"
        assert phase["start"] == "2025-01-01"
        assert phase["finish"] == "2025-03-31"
        assert phase["duration_days"] == 90
        assert phase["is_summary"] is True

    def test_filter_with_milestone_tasks(self):
        """Milestones (duration 0) at deeper levels are preserved."""
        tasks = [
            {"name": "Project", "level": 1, "is_summary": True,
             "duration_days": 30},
            {"name": "Kickoff", "level": 2, "is_summary": False,
             "duration_days": 0},
            {"name": "Go Live", "level": 2, "is_summary": False,
             "duration_days": 0},
            {"name": "Dev Work", "level": 3, "is_summary": False,
             "duration_days": 10},
        ]
        filtered = filter_top_level_tasks(tasks)
        assert len(filtered) == 3
        milestone_names = [t["name"] for t in filtered if t["duration_days"] == 0]
        assert "Kickoff" in milestone_names
        assert "Go Live" in milestone_names

    def test_filter_does_not_modify_original_list(self):
        """The original task list is not modified by filtering."""
        tasks = [
            {"name": "Project", "level": 1, "is_summary": True},
            {"name": "Phase 1", "level": 2, "is_summary": True},
        ]
        original_len = len(tasks)
        filter_top_level_tasks(tasks)
        assert len(tasks) == original_len
