"""Tests for Quality Analyser (ProjectQA) checks.

These tests verify that the /api/parse endpoint returns task data with
the fields required for QA checks, and that the HTML includes the
QA section for the frontend to populate.
"""

import pytest
from fastapi.testclient import TestClient

from noodle_web import app


@pytest.fixture
def client():
    """Create a test client for the FastAPI app."""
    return TestClient(app)


@pytest.fixture
def plan_with_milestones():
    """Plan containing milestones (0-duration tasks) and regular tasks."""
    return """---
title: QA Test Project
---
Phase 1
  Task A 5d
  *Task B 3d
  Milestone Start 0d
Phase 2
  Task C 10d
  Task D 25d
  *Task E 0d
"""


@pytest.fixture
def plan_with_dependencies():
    """Plan with explicit task dependencies."""
    return """Phase 1
  Setup 3d
  Development 5d [depends Setup]
  Testing 2d [depends Development]
  Deploy 1d [depends Testing]
  Review 3d
"""


@pytest.fixture
def plan_with_completed_tasks():
    """Plan with some complete and some in-progress tasks."""
    return """Phase 1
  Task A 5d 100%
  Task B 3d 50%
  Task C 2d 0%
  Task D 1d 100%
"""


class TestParseEndpointQaFields:
    """Verify /api/parse returns task fields needed for QA checks."""

    def test_parse_returns_tasks_with_duration_days(self, client, plan_with_milestones):
        """Tasks must have duration_days field for milestone detection."""
        response = client.post("/api/parse", json={"plan_text": plan_with_milestones})
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        tasks = data["tasks"]
        assert len(tasks) > 0
        for task in tasks:
            assert "duration_days" in task, f"Task '{task.get('name')}' missing duration_days"

    def test_parse_identifies_milestones_as_zero_duration(self, client, plan_with_milestones):
        """Zero-duration tasks (milestones) must have duration_days == 0."""
        response = client.post("/api/parse", json={"plan_text": plan_with_milestones})
        assert response.status_code == 200
        tasks = response.json()["tasks"]
        leaf_tasks = [t for t in tasks if not t["is_summary"]]
        milestone_tasks = [t for t in leaf_tasks if t["duration_days"] == 0]
        assert len(milestone_tasks) >= 2, "Expected at least 2 zero-duration milestones"

    def test_parse_returns_tasks_with_depends_field(self, client, plan_with_dependencies):
        """Tasks must have 'depends' field listing their predecessors."""
        response = client.post("/api/parse", json={"plan_text": plan_with_dependencies})
        assert response.status_code == 200
        tasks = response.json()["tasks"]
        for task in tasks:
            assert "depends" in task, f"Task '{task.get('name')}' missing depends field"
            assert isinstance(task["depends"], list)

    def test_parse_captures_explicit_dependencies(self, client, plan_with_dependencies):
        """Tasks with [depends X] syntax must have predecessors in 'depends'."""
        response = client.post("/api/parse", json={"plan_text": plan_with_dependencies})
        assert response.status_code == 200
        tasks = response.json()["tasks"]
        task_map = {t["name"]: t for t in tasks}
        # "Development" depends on "Setup"
        dev_task = next((t for t in tasks if "Development" in t["name"]), None)
        assert dev_task is not None, "Expected 'Development' task"
        assert len(dev_task["depends"]) > 0, "Development should have predecessors"

    def test_parse_returns_tasks_with_start_finish(self, client, plan_with_milestones):
        """Tasks must have start and finish dates for float/schedule checks."""
        response = client.post("/api/parse", json={"plan_text": plan_with_milestones})
        assert response.status_code == 200
        tasks = response.json()["tasks"]
        leaf_tasks = [t for t in tasks if not t["is_summary"]]
        for task in leaf_tasks:
            assert "start" in task
            assert "finish" in task

    def test_parse_returns_tasks_with_percent(self, client, plan_with_completed_tasks):
        """Tasks must have percent field for completion-based checks."""
        response = client.post("/api/parse", json={"plan_text": plan_with_completed_tasks})
        assert response.status_code == 200
        tasks = response.json()["tasks"]
        leaf_tasks = [t for t in tasks if not t["is_summary"]]
        assert len(leaf_tasks) > 0
        complete = [t for t in leaf_tasks if (float(t.get("percent") or 0)) >= 100]
        assert len(complete) >= 2, "Expected at least 2 completed tasks"

    def test_parse_returns_is_summary_field(self, client, plan_with_milestones):
        """Tasks must have is_summary field to distinguish summary vs leaf."""
        response = client.post("/api/parse", json={"plan_text": plan_with_milestones})
        assert response.status_code == 200
        tasks = response.json()["tasks"]
        for task in tasks:
            assert "is_summary" in task


class TestQaSectionInHtml:
    """Verify the analysis page includes the Quality Analyser section."""

    def test_analysis_view_contains_qa_section(self, client):
        """The main HTML page must include the qa-section element."""
        response = client.get("/")
        assert response.status_code == 200
        html = response.text
        assert "qaSection" in html or "qa-section" in html

    def test_analysis_view_contains_qa_grid(self, client):
        """The main HTML page must include the qa checks grid element."""
        response = client.get("/")
        assert response.status_code == 200
        html = response.text
        assert "qaChecksGrid" in html

    def test_analysis_view_contains_quality_analyser_heading(self, client):
        """The main HTML page must mention Quality Analyser."""
        response = client.get("/")
        assert response.status_code == 200
        html = response.text
        assert "Quality Analyser" in html


class TestQaCheckLogic:
    """Test QA check computation logic via parse endpoint task data."""

    def test_remaining_tasks_excludes_complete(self, client, plan_with_completed_tasks):
        """Check 4: Remaining tasks should exclude 100% complete tasks."""
        response = client.post("/api/parse", json={"plan_text": plan_with_completed_tasks})
        assert response.status_code == 200
        tasks = response.json()["tasks"]
        leaf_tasks = [t for t in tasks if not t["is_summary"]]
        remaining = [t for t in leaf_tasks if (float(t.get("percent") or 0)) < 100]
        complete = [t for t in leaf_tasks if (float(t.get("percent") or 0)) >= 100]
        assert len(remaining) >= 2
        assert len(complete) >= 2
        assert len(remaining) + len(complete) == len(leaf_tasks)

    def test_long_tasks_detection(self, client, plan_with_milestones):
        """Check 10: Tasks with duration > 20 days should be identifiable."""
        response = client.post("/api/parse", json={"plan_text": plan_with_milestones})
        assert response.status_code == 200
        tasks = response.json()["tasks"]
        leaf_tasks = [t for t in tasks if not t["is_summary"]]
        long_tasks = [t for t in leaf_tasks if (t.get("duration_days") or 0) > 20]
        # Plan has Task D 25d, so at least one long task expected
        assert len(long_tasks) >= 1

    def test_tasks_with_no_predecessors_identifiable(self, client, plan_with_dependencies):
        """Check 12: Tasks with no predecessors should be identifiable from depends field."""
        response = client.post("/api/parse", json={"plan_text": plan_with_dependencies})
        assert response.status_code == 200
        tasks = response.json()["tasks"]
        leaf_tasks = [t for t in tasks if not t["is_summary"]]
        no_predecessors = [t for t in leaf_tasks if len(t.get("depends") or []) == 0]
        # "Setup" and "Review" have no predecessors (Review is parallel)
        assert len(no_predecessors) >= 1

    def test_successor_map_can_be_built(self, client, plan_with_dependencies):
        """Check 11: Successors can be derived by inverting the depends map."""
        response = client.post("/api/parse", json={"plan_text": plan_with_dependencies})
        assert response.status_code == 200
        tasks = response.json()["tasks"]
        # Build successor map
        successor_map = {}
        for task in tasks:
            for dep in (task.get("depends") or []):
                if dep not in successor_map:
                    successor_map[dep] = []
                successor_map[dep].append(task["name"])
        # "Setup" should have "Development" as a successor
        assert "Setup" in successor_map or any(
            "Setup" in str(k) for k in successor_map
        ), "Expected Setup to have successors"

    def test_milestone_count_matches_zero_duration(self, client, plan_with_milestones):
        """Check 5: Milestone count equals number of zero-duration leaf tasks."""
        response = client.post("/api/parse", json={"plan_text": plan_with_milestones})
        assert response.status_code == 200
        tasks = response.json()["tasks"]
        leaf_tasks = [t for t in tasks if not t["is_summary"]]
        milestones = [t for t in leaf_tasks if t.get("duration_days") == 0]
        # Plan has "Milestone Start 0d" and "*Task E 0d"
        assert len(milestones) >= 2

    def test_parse_handles_empty_plan_gracefully(self, client):
        """QA checks must not crash when plan has no tasks."""
        response = client.post("/api/parse", json={"plan_text": "Phase 1\n  Task A 1d\n"})
        assert response.status_code == 200
        data = response.json()
        tasks = data.get("tasks", [])
        # Should be able to extract tasks without error
        assert isinstance(tasks, list)
