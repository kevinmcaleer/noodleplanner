"""Tests for the Programme Dependencies API endpoints."""

import pytest
from datetime import date, timedelta
from fastapi.testclient import TestClient

from noodle_web import app
from noodle_web.app import (
    _find_task_in_project,
    _calculate_dependency_rag,
)


@pytest.fixture
def client():
    """Create a test client for the FastAPI app."""
    return TestClient(app)


# ---------------------------------------------------------------------------
# Helper unit tests
# ---------------------------------------------------------------------------

class TestFindTaskInProject:
    """Tests for _find_task_in_project helper."""

    def test_finds_exact_match(self):
        tasks = [{"name": "Deploy API"}, {"name": "Run Tests"}]
        result = _find_task_in_project(tasks, "Deploy API")
        assert result == {"name": "Deploy API"}

    def test_case_insensitive_exact_match(self):
        tasks = [{"name": "Deploy API"}, {"name": "Run Tests"}]
        result = _find_task_in_project(tasks, "deploy api")
        assert result == {"name": "Deploy API"}

    def test_partial_match_fallback(self):
        tasks = [{"name": "Deploy API to Production"}]
        result = _find_task_in_project(tasks, "Deploy API")
        assert result == {"name": "Deploy API to Production"}

    def test_returns_none_when_not_found(self):
        tasks = [{"name": "Run Tests"}]
        result = _find_task_in_project(tasks, "Deploy API")
        assert result is None

    def test_empty_list_returns_none(self):
        result = _find_task_in_project([], "Deploy API")
        assert result is None

    def test_exact_match_preferred_over_partial(self):
        tasks = [
            {"name": "Deploy API to Production"},
            {"name": "Deploy API"},
        ]
        result = _find_task_in_project(tasks, "Deploy API")
        assert result == {"name": "Deploy API"}


class TestCalculateDependencyRAG:
    """Tests for _calculate_dependency_rag helper."""

    def _task(self, finish=None, start=None, percent=0, duration_days=5):
        return {
            "name": "Test Task",
            "finish": finish,
            "start": start,
            "percent": percent,
            "duration_days": duration_days,
        }

    def test_green_when_dependency_satisfied(self):
        today = date.today()
        from_task = self._task(finish=(today - timedelta(days=10)).isoformat())
        to_task = self._task(
            start=(today - timedelta(days=8)).isoformat(),
            finish=(today + timedelta(days=5)).isoformat(),
            percent=50,
        )
        result = _calculate_dependency_rag(from_task, to_task, lag_days=0)
        assert result["rag"] == "green"

    def test_red_when_dependent_starts_before_source_finishes(self):
        today = date.today()
        from_task = self._task(finish=(today + timedelta(days=10)).isoformat())
        to_task = self._task(
            start=(today + timedelta(days=5)).isoformat(),
            finish=(today + timedelta(days=20)).isoformat(),
            percent=0,
        )
        result = _calculate_dependency_rag(from_task, to_task, lag_days=0)
        assert result["rag"] == "red"
        assert "Dependency violated" in result["reason"]

    def test_red_with_positive_lag_violated(self):
        today = date.today()
        from_task = self._task(finish=(today - timedelta(days=5)).isoformat())
        # Source finishes -5d, lag=3, so required start = -2d
        # to_task starts -4d → violated
        to_task = self._task(
            start=(today - timedelta(days=4)).isoformat(),
            finish=(today + timedelta(days=10)).isoformat(),
            percent=30,
        )
        result = _calculate_dependency_rag(from_task, to_task, lag_days=3)
        assert result["rag"] == "red"

    def test_propagated_start_returned(self):
        today = date.today()
        from_finish = today - timedelta(days=5)
        from_task = self._task(finish=from_finish.isoformat())
        to_task = self._task(
            start=(today + timedelta(days=2)).isoformat(),
            finish=(today + timedelta(days=10)).isoformat(),
            percent=0,
        )
        result = _calculate_dependency_rag(from_task, to_task, lag_days=2)
        expected = (from_finish + timedelta(days=2)).isoformat()
        assert result["propagated_start"] == expected

    def test_grey_when_source_has_no_finish(self):
        from_task = self._task(finish=None)
        to_task = self._task(start="2026-01-01", finish="2026-02-01", percent=0)
        result = _calculate_dependency_rag(from_task, to_task, lag_days=0)
        assert result["rag"] == "grey"

    def test_amber_when_no_to_start(self):
        from_task = self._task(finish="2026-01-01")
        to_task = self._task(start=None, finish=None, percent=0)
        result = _calculate_dependency_rag(from_task, to_task, lag_days=0)
        assert result["rag"] == "amber"
        assert result["propagated_start"] == "2026-01-01"

    def test_red_when_dependent_task_overdue(self):
        today = date.today()
        from_task = self._task(finish=(today - timedelta(days=30)).isoformat())
        to_task = self._task(
            start=(today - timedelta(days=25)).isoformat(),
            finish=(today - timedelta(days=5)).isoformat(),  # finish in past
            percent=40,  # not complete
        )
        result = _calculate_dependency_rag(from_task, to_task, lag_days=0)
        assert result["rag"] == "red"

    def test_complete_task_is_green(self):
        today = date.today()
        from_task = self._task(finish=(today - timedelta(days=30)).isoformat())
        to_task = self._task(
            start=(today - timedelta(days=25)).isoformat(),
            finish=(today - timedelta(days=5)).isoformat(),
            percent=100,
        )
        result = _calculate_dependency_rag(from_task, to_task, lag_days=0)
        assert result["rag"] == "green"


# ---------------------------------------------------------------------------
# API endpoint tests
# ---------------------------------------------------------------------------

class TestPropagateProgrammeDependencies:
    """Tests for POST /api/programme-dependencies/propagate."""

    def _build_request(self, deps, projects):
        return {"dependencies": deps, "projects": projects}

    def test_empty_request_returns_grey(self, client):
        resp = client.post(
            "/api/programme-dependencies/propagate",
            json={"dependencies": [], "projects": []},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["overall_rag"] == "grey"
        assert data["dependency_count"] == 0
        assert data["results"] == []

    def test_single_green_dependency(self, client):
        today = date.today()
        dep = {
            "id": "dep-1",
            "from_project_id": "proj-a",
            "from_task_name": "Phase 1",
            "to_project_id": "proj-b",
            "to_task_name": "Phase 2",
            "lag_days": 0,
            "notes": "",
        }
        projects = [
            {
                "project_id": "proj-a",
                "project_name": "Project A",
                "tasks": [
                    {
                        "name": "Phase 1",
                        "start": (today - timedelta(days=20)).isoformat(),
                        "finish": (today - timedelta(days=5)).isoformat(),
                        "duration_days": 15,
                        "percent": 100,
                        "is_summary": True,
                    }
                ],
            },
            {
                "project_id": "proj-b",
                "project_name": "Project B",
                "tasks": [
                    {
                        "name": "Phase 2",
                        "start": (today - timedelta(days=3)).isoformat(),
                        "finish": (today + timedelta(days=10)).isoformat(),
                        "duration_days": 13,
                        "percent": 20,
                        "is_summary": True,
                    }
                ],
            },
        ]
        resp = client.post(
            "/api/programme-dependencies/propagate",
            json=self._build_request([dep], projects),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["dependency_count"] == 1
        assert data["results"][0]["dependency_id"] == "dep-1"
        assert data["results"][0]["rag"] == "green"
        assert data["overall_rag"] == "green"

    def test_red_dependency_makes_overall_red(self, client):
        today = date.today()
        dep = {
            "id": "dep-2",
            "from_project_id": "proj-a",
            "from_task_name": "Phase 1",
            "to_project_id": "proj-b",
            "to_task_name": "Phase 2",
            "lag_days": 0,
            "notes": "",
        }
        projects = [
            {
                "project_id": "proj-a",
                "project_name": "Project A",
                "tasks": [
                    {
                        "name": "Phase 1",
                        "start": (today + timedelta(days=10)).isoformat(),
                        "finish": (today + timedelta(days=20)).isoformat(),
                        "duration_days": 10,
                        "percent": 0,
                        "is_summary": True,
                    }
                ],
            },
            {
                "project_id": "proj-b",
                "project_name": "Project B",
                "tasks": [
                    {
                        "name": "Phase 2",
                        "start": (today + timedelta(days=5)).isoformat(),  # before source finishes
                        "finish": (today + timedelta(days=15)).isoformat(),
                        "duration_days": 10,
                        "percent": 0,
                        "is_summary": True,
                    }
                ],
            },
        ]
        resp = client.post(
            "/api/programme-dependencies/propagate",
            json=self._build_request([dep], projects),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["results"][0]["rag"] == "red"
        assert data["overall_rag"] == "red"

    def test_missing_source_task_returns_grey(self, client):
        dep = {
            "id": "dep-3",
            "from_project_id": "proj-a",
            "from_task_name": "NonExistent Phase",
            "to_project_id": "proj-b",
            "to_task_name": "Phase 2",
            "lag_days": 0,
            "notes": "",
        }
        projects = [
            {
                "project_id": "proj-a",
                "project_name": "Project A",
                "tasks": [{"name": "Phase 1", "start": None, "finish": None, "duration_days": 5, "percent": 0, "is_summary": True}],
            },
            {
                "project_id": "proj-b",
                "project_name": "Project B",
                "tasks": [{"name": "Phase 2", "start": None, "finish": None, "duration_days": 5, "percent": 0, "is_summary": True}],
            },
        ]
        resp = client.post(
            "/api/programme-dependencies/propagate",
            json=self._build_request([dep], projects),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["results"][0]["rag"] == "grey"
        assert "not found" in data["results"][0]["reason"].lower()

    def test_multiple_deps_worst_case_wins(self, client):
        today = date.today()
        deps = [
            {
                "id": "dep-green",
                "from_project_id": "proj-a",
                "from_task_name": "Phase 1",
                "to_project_id": "proj-b",
                "to_task_name": "Phase 2",
                "lag_days": 0,
                "notes": "",
            },
            {
                "id": "dep-red",
                "from_project_id": "proj-a",
                "from_task_name": "Phase 1",
                "to_project_id": "proj-b",
                "to_task_name": "Phase 3",
                "lag_days": 0,
                "notes": "",
            },
        ]
        projects = [
            {
                "project_id": "proj-a",
                "project_name": "Project A",
                "tasks": [
                    {
                        "name": "Phase 1",
                        "start": (today + timedelta(days=10)).isoformat(),
                        "finish": (today + timedelta(days=20)).isoformat(),
                        "duration_days": 10,
                        "percent": 0,
                        "is_summary": True,
                    }
                ],
            },
            {
                "project_id": "proj-b",
                "project_name": "Project B",
                "tasks": [
                    {
                        "name": "Phase 2",
                        "start": (today + timedelta(days=22)).isoformat(),
                        "finish": (today + timedelta(days=30)).isoformat(),
                        "duration_days": 8,
                        "percent": 0,
                        "is_summary": True,
                    },
                    {
                        "name": "Phase 3",
                        "start": (today + timedelta(days=5)).isoformat(),  # before source finishes - RED
                        "finish": (today + timedelta(days=15)).isoformat(),
                        "duration_days": 10,
                        "percent": 0,
                        "is_summary": True,
                    },
                ],
            },
        ]
        resp = client.post(
            "/api/programme-dependencies/propagate",
            json=self._build_request(deps, projects),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["overall_rag"] == "red"
        assert data["dependency_count"] == 2

    def test_propagated_start_included_in_result(self, client):
        from_finish = "2026-03-01"
        lag = 5
        dep = {
            "id": "dep-4",
            "from_project_id": "proj-a",
            "from_task_name": "Milestone",
            "to_project_id": "proj-b",
            "to_task_name": "Start Work",
            "lag_days": lag,
            "notes": "",
        }
        projects = [
            {
                "project_id": "proj-a",
                "project_name": "A",
                "tasks": [
                    {"name": "Milestone", "start": "2026-02-01", "finish": from_finish,
                     "duration_days": 0, "percent": 100, "is_summary": False}
                ],
            },
            {
                "project_id": "proj-b",
                "project_name": "B",
                "tasks": [
                    {"name": "Start Work", "start": "2026-03-10", "finish": "2026-04-01",
                     "duration_days": 22, "percent": 0, "is_summary": False}
                ],
            },
        ]
        resp = client.post(
            "/api/programme-dependencies/propagate",
            json=self._build_request([dep], projects),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["results"][0]["propagated_start"] == "2026-03-06"

    def test_invalid_request_returns_422(self, client):
        resp = client.post(
            "/api/programme-dependencies/propagate",
            json={"dependencies": "not-a-list"},
        )
        assert resp.status_code == 422
