"""
Tests for Planning Room API endpoints.

Tests cover:
- YAML outline parsing
- Plan generation from outline + flow
- Validation and error handling
"""

import pytest
from fastapi.testclient import TestClient
from noodle_web.app import app

client = TestClient(app)


class TestParseOutlineEndpoint:
    """Test /api/planning-room/parse-outline endpoint."""

    def test_parse_valid_outline(self):
        """Test parsing a valid markdown outline."""
        outline_content = """Test Project

- Phase 1
  - Task 1.1 5d @alice
"""
        response = client.post(
            "/api/planning-room/parse-outline",
            json={"yaml": outline_content}
        )

        assert response.status_code == 200
        data = response.json()

        assert "project" in data
        assert data["project"]["name"] == "Test Project"

        assert "phases" in data
        assert len(data["phases"]) == 1
        assert data["phases"][0]["name"] == "Phase 1"
        assert len(data["phases"][0]["tasks"]) == 1
        assert data["phases"][0]["tasks"][0]["name"] == "Task 1.1"
        assert data["phases"][0]["tasks"][0]["duration"] == "5d"
        assert "@alice" in data["phases"][0]["tasks"][0]["resources"]

    def test_parse_outline_with_nested_tasks(self):
        """Test parsing outline with nested subtasks."""
        outline_content = """Nested Project

- Phase 1
  - Parent Task 10d
    - Child Task 1 3d
    - Child Task 2 4d
"""
        response = client.post(
            "/api/planning-room/parse-outline",
            json={"yaml": outline_content}
        )

        assert response.status_code == 200
        data = response.json()

        parent_task = data["phases"][0]["tasks"][0]
        assert parent_task["name"] == "Parent Task"
        assert parent_task["duration"] == "10d"
        assert len(parent_task["children"]) == 2
        assert parent_task["children"][0]["name"] == "Child Task 1"
        assert parent_task["children"][0]["duration"] == "3d"

    def test_parse_outline_with_multiple_phases(self):
        """Test parsing outline with multiple phases."""
        outline_content = """Multi-phase Project

- Phase 1: Planning
  - Task 1.1 2d
- Phase 2: Execution
  - Task 2.1 5d
  - Task 2.2 3d
- Phase 3: Review
  - Task 3.1 1d
"""
        response = client.post(
            "/api/planning-room/parse-outline",
            json={"yaml": outline_content}
        )

        assert response.status_code == 200
        data = response.json()

        assert len(data["phases"]) == 3
        assert data["phases"][0]["name"] == "Phase 1: Planning"
        assert data["phases"][1]["name"] == "Phase 2: Execution"
        assert data["phases"][2]["name"] == "Phase 3: Review"
        assert len(data["phases"][1]["tasks"]) == 2

    def test_parse_invalid_outline(self):
        """Test parsing outline with issues."""
        # Totally empty outline returns just project name
        response = client.post(
            "/api/planning-room/parse-outline",
            json={"yaml": ""}
        )
        # Empty string raises ValueError in parse_markdown_outline
        assert response.status_code == 400

    def test_parse_empty_outline(self):
        """Test parsing empty outline."""
        # Empty string should error
        response = client.post(
            "/api/planning-room/parse-outline",
            json={"yaml": "   "}
        )

        assert response.status_code == 400

    def test_parse_outline_only_whitespace(self):
        """Test outline with only whitespace."""
        response = client.post(
            "/api/planning-room/parse-outline",
            json={"yaml": "   \n\n  "}
        )

        # Whitespace only should error
        assert response.status_code == 400

    def test_parse_outline_project_name_only(self):
        """Test outline with only project name."""
        response = client.post(
            "/api/planning-room/parse-outline",
            json={"yaml": "My Project"}
        )

        assert response.status_code == 200
        data = response.json()
        assert data["project"]["name"] == "My Project"
        assert data["phases"] == []

    def test_parse_outline_with_resources(self):
        """Test parsing outline with resource assignments."""
        outline_content = """Resource Test

- Phase 1
  - Task 1 5d @alice @bob
  - Task 2 3d @charlie
"""
        response = client.post(
            "/api/planning-room/parse-outline",
            json={"yaml": outline_content}
        )

        assert response.status_code == 200
        data = response.json()

        task1 = data["phases"][0]["tasks"][0]
        assert "@alice" in task1["resources"]
        assert "@bob" in task1["resources"]
        assert task1["duration"] == "5d"

        task2 = data["phases"][0]["tasks"][1]
        assert "@charlie" in task2["resources"]


class TestGeneratePlanEndpoint:
    """Test /api/planning-room/generate-plan endpoint."""

    def test_generate_plan_basic(self):
        """Test generating a basic plan from outline."""
        outline = """Test Project

- Phase 1
  - Task 1 5d @alice
"""
        response = client.post(
            "/api/planning-room/generate-plan",
            json={
                "outline": outline,
                "flow": {"nodes": [], "edges": []}
            }
        )

        assert response.status_code == 200
        data = response.json()

        assert "plan" in data
        plan = data["plan"]

        # Check basic structure
        assert "Test Project" in plan
        assert "Phase 1" in plan
        assert "Task 1" in plan

    def test_generate_plan_with_multiple_tasks(self):
        """Test generating plan with multiple tasks."""
        outline = """Multi-task Project

- Phase 1
  - Task 1 3d
  - Task 2 5d
  - Task 3 2d
"""
        response = client.post(
            "/api/planning-room/generate-plan",
            json={
                "outline": outline,
                "flow": {"nodes": [], "edges": []}
            }
        )

        assert response.status_code == 200
        data = response.json()
        plan = data["plan"]

        assert "Task 1" in plan
        assert "Task 2" in plan
        assert "Task 3" in plan

    def test_generate_plan_invalid_outline(self):
        """Test generating plan with empty outline."""
        response = client.post(
            "/api/planning-room/generate-plan",
            json={
                "outline": "",
                "flow": {"nodes": [], "edges": []}
            }
        )

        # Empty outline should error
        assert response.status_code == 400

    def test_generate_plan_empty_outline(self):
        """Test generating plan with whitespace only."""
        response = client.post(
            "/api/planning-room/generate-plan",
            json={
                "outline": "   \n\n  ",
                "flow": {"nodes": [], "edges": []}
            }
        )

        # Whitespace only should error
        assert response.status_code == 400

    def test_generate_plan_with_flow_data(self):
        """Test generating plan with flow data (Phase 3 feature)."""
        outline = """Flow Test

- Phase 1
  - Task A 2d
  - Task B 3d
"""
        flow_data = {
            "nodes": [
                {"id": "node1", "name": "Task A"},
                {"id": "node2", "name": "Task B"}
            ],
            "edges": [
                {"id": "edge1", "source": "node1", "target": "node2", "type": "FS"}
            ]
        }

        response = client.post(
            "/api/planning-room/generate-plan",
            json={
                "outline": outline,
                "flow": flow_data
            }
        )

        assert response.status_code == 200
        # Phase 3 will implement dependency injection
        # For now, just verify it doesn't crash with flow data


class TestPlanningRoomValidation:
    """Test validation and error handling for Planning Room."""

    def test_parse_outline_max_size(self):
        """Test parsing outline respects max size limit."""
        # Create a very large YAML (>1MB)
        large_yaml = "project:\n  name: 'Test'\n\nphases:\n"
        large_yaml += "  - name: 'Phase'\n    tasks:\n"
        large_yaml += "".join([f"      - name: 'Task {i}'\n        duration: 1d\n" for i in range(100000)])

        response = client.post(
            "/api/planning-room/parse-outline",
            json={"yaml": large_yaml}
        )

        # Should return 422 (validation error) due to max_length constraint
        assert response.status_code == 422

    def test_generate_plan_max_size(self):
        """Test generating plan respects max size limit."""
        # Create a very large outline
        large_outline = "project:\n  name: 'Test'\n\nphases:\n"
        large_outline += "  - name: 'Phase'\n    tasks:\n"
        large_outline += "".join([f"      - name: 'Task {i}'\n        duration: 1d\n" for i in range(100000)])

        response = client.post(
            "/api/planning-room/generate-plan",
            json={
                "outline": large_outline,
                "flow": {"nodes": [], "edges": []}
            }
        )

        # Should return 422 (validation error) due to max_length constraint
        assert response.status_code == 422


class TestPlanningRoomPerformance:
    """Test Planning Room with large datasets."""

    def test_parse_large_outline(self):
        """Test parsing outline with 100+ tasks performs adequately."""
        outline_content = "Large Project\n\n"
        # Add 10 phases with 10 tasks each
        for phase_num in range(1, 11):
            outline_content += f"- Phase {phase_num}\n"
            for task_num in range(1, 11):
                outline_content += f"  - Task {phase_num}.{task_num} {task_num}d\n"

        response = client.post(
            "/api/planning-room/parse-outline",
            json={"yaml": outline_content}
        )

        assert response.status_code == 200
        data = response.json()

        assert len(data["phases"]) == 10
        # Verify structure is correct
        assert len(data["phases"][0]["tasks"]) == 10

    def test_generate_plan_large_outline(self):
        """Test generating plan from large outline."""
        outline = "Large Project\n\n"
        # Add 10 phases with 10 tasks each
        for phase_num in range(1, 11):
            outline += f"- Phase {phase_num}\n"
            for task_num in range(1, 11):
                outline += f"  - Task {phase_num}.{task_num} {task_num}d\n"

        response = client.post(
            "/api/planning-room/generate-plan",
            json={
                "outline": outline,
                "flow": {"nodes": [], "edges": []}
            }
        )

        assert response.status_code == 200
        data = response.json()
        plan = data["plan"]

        # Verify plan contains all phases
        for phase_num in range(1, 11):
            assert f"Phase {phase_num}" in plan


class TestPlanningRoomFlowDiagram:
    """Test flow diagram node/edge logic (Phase 2)."""

    def test_parse_outline_creates_nodes(self):
        """Test that parsing outline creates appropriate flow nodes structure."""
        # This tests the data structure that would be created
        # Full flow rendering is tested via manual/integration testing
        outline_content = """Flow Test

- Phase 1
  - Task A 2d
  - Task B 3d
"""
        response = client.post(
            "/api/planning-room/parse-outline",
            json={"yaml": outline_content}
        )

        assert response.status_code == 200
        data = response.json()

        # Verify structure suitable for flow node creation
        assert len(data["phases"][0]["tasks"]) == 2
        assert data["phases"][0]["tasks"][0]["name"] == "Task A"
        assert data["phases"][0]["tasks"][1]["name"] == "Task B"

    def test_parse_outline_with_dependencies_structure(self):
        """Test outline parsing preserves task hierarchy for flow diagram."""
        outline_content = """Complex Flow

- Phase 1
  - Parent Task 10d
    - Child 1 3d
    - Child 2 4d
- Phase 2
  - Task X 2d
"""
        response = client.post(
            "/api/planning-room/parse-outline",
            json={"yaml": outline_content}
        )

        assert response.status_code == 200
        data = response.json()

        # Verify nested structure
        assert len(data["phases"]) == 2
        parent = data["phases"][0]["tasks"][0]
        assert parent["name"] == "Parent Task"
        assert len(parent["children"]) == 2

    def test_outline_with_resources_for_flow(self):
        """Test that resource assignments are preserved for flow diagram nodes."""
        outline_content = """Resource Flow Test

- Phase 1
  - Task 1 @alice
  - Task 2 @bob
  - Task 3 @alice @bob
"""
        response = client.post(
            "/api/planning-room/parse-outline",
            json={"yaml": outline_content}
        )

        assert response.status_code == 200
        data = response.json()

        tasks = data["phases"][0]["tasks"]
        assert tasks[0]["resources"] == ['@alice']
        assert tasks[1]["resources"] == ['@bob']
        assert tasks[2]["resources"] == ['@alice', '@bob']
