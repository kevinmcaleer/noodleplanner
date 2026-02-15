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
        """Test parsing a valid YAML outline."""
        yaml_content = """
project:
  name: 'Test Project'
  start_date: 2026-03-01
  resources:
    - {id: alice, name: 'Alice Smith', role: 'Developer'}

phases:
  - name: 'Phase 1'
    tasks:
      - name: 'Task 1.1'
        duration: 5d
        resources: ['@alice']
"""
        response = client.post(
            "/api/planning-room/parse-outline",
            json={"yaml": yaml_content}
        )

        assert response.status_code == 200
        data = response.json()

        assert "project" in data
        assert data["project"]["name"] == "Test Project"
        assert data["project"]["start_date"] == "2026-03-01"

        assert "phases" in data
        assert len(data["phases"]) == 1
        assert data["phases"][0]["name"] == "Phase 1"
        assert len(data["phases"][0]["tasks"]) == 1

    def test_parse_outline_with_nested_tasks(self):
        """Test parsing outline with nested subtasks."""
        yaml_content = """
project:
  name: 'Nested Project'

phases:
  - name: 'Phase 1'
    tasks:
      - name: 'Parent Task'
        duration: 10d
        children:
          - name: 'Child Task 1'
            duration: 3d
          - name: 'Child Task 2'
            duration: 4d
"""
        response = client.post(
            "/api/planning-room/parse-outline",
            json={"yaml": yaml_content}
        )

        assert response.status_code == 200
        data = response.json()

        parent_task = data["phases"][0]["tasks"][0]
        assert parent_task["name"] == "Parent Task"
        assert len(parent_task["children"]) == 2
        assert parent_task["children"][0]["name"] == "Child Task 1"

    def test_parse_outline_with_multiple_phases(self):
        """Test parsing outline with multiple phases."""
        yaml_content = """
project:
  name: 'Multi-phase Project'

phases:
  - name: 'Phase 1: Planning'
    tasks:
      - name: 'Task 1.1'
        duration: 2d
  - name: 'Phase 2: Execution'
    tasks:
      - name: 'Task 2.1'
        duration: 5d
      - name: 'Task 2.2'
        duration: 3d
  - name: 'Phase 3: Review'
    tasks:
      - name: 'Task 3.1'
        duration: 1d
"""
        response = client.post(
            "/api/planning-room/parse-outline",
            json={"yaml": yaml_content}
        )

        assert response.status_code == 200
        data = response.json()

        assert len(data["phases"]) == 3
        assert data["phases"][0]["name"] == "Phase 1: Planning"
        assert data["phases"][1]["name"] == "Phase 2: Execution"
        assert data["phases"][2]["name"] == "Phase 3: Review"

    def test_parse_invalid_yaml(self):
        """Test parsing invalid YAML returns error."""
        yaml_content = """
project:
  name: 'Test'
  invalid: [unclosed bracket
"""
        response = client.post(
            "/api/planning-room/parse-outline",
            json={"yaml": yaml_content}
        )

        assert response.status_code == 400
        assert "Invalid YAML" in response.json()["detail"]

    def test_parse_empty_yaml(self):
        """Test parsing empty YAML returns error."""
        response = client.post(
            "/api/planning-room/parse-outline",
            json={"yaml": ""}
        )

        assert response.status_code == 400

    def test_parse_yaml_non_dict_root(self):
        """Test YAML with non-dict root returns error."""
        yaml_content = """
- item1
- item2
"""
        response = client.post(
            "/api/planning-room/parse-outline",
            json={"yaml": yaml_content}
        )

        assert response.status_code == 400
        assert "dictionary" in response.json()["detail"].lower()

    def test_parse_yaml_phases_not_list(self):
        """Test YAML with phases not a list returns error."""
        yaml_content = """
project:
  name: 'Test'

phases: not_a_list
"""
        response = client.post(
            "/api/planning-room/parse-outline",
            json={"yaml": yaml_content}
        )

        assert response.status_code == 400
        assert "list" in response.json()["detail"].lower()

    def test_parse_outline_with_resources(self):
        """Test parsing outline with resource definitions."""
        yaml_content = """
project:
  name: 'Resource Test'
  resources:
    - {id: alice, name: 'Alice Smith', role: 'Developer'}
    - {id: bob, name: 'Bob Jones', role: 'Designer'}
    - {id: charlie, name: 'Charlie Brown', role: 'Manager'}

phases:
  - name: 'Phase 1'
    tasks:
      - name: 'Task 1'
        resources: ['@alice', '@bob']
"""
        response = client.post(
            "/api/planning-room/parse-outline",
            json={"yaml": yaml_content}
        )

        assert response.status_code == 200
        data = response.json()

        assert len(data["project"]["resources"]) == 3
        assert data["project"]["resources"][0]["id"] == "alice"
        assert data["project"]["resources"][1]["id"] == "bob"


class TestGeneratePlanEndpoint:
    """Test /api/planning-room/generate-plan endpoint."""

    def test_generate_plan_basic(self):
        """Test generating a basic plan from outline."""
        outline = """
project:
  name: 'Test Project'
  start_date: 2026-03-01
  resources:
    - {id: alice, name: 'Alice Smith', role: 'Developer'}

phases:
  - name: 'Phase 1'
    tasks:
      - name: 'Task 1'
        duration: 5d
        resources: ['@alice']
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
        assert "start: 2026-03-01" in plan
        assert "@alice: Alice Smith, Developer" in plan
        assert "Phase 1" in plan
        assert "Task 1" in plan

    def test_generate_plan_with_multiple_tasks(self):
        """Test generating plan with multiple tasks."""
        outline = """
project:
  name: 'Multi-task Project'

phases:
  - name: 'Phase 1'
    tasks:
      - name: 'Task 1'
        duration: 3d
      - name: 'Task 2'
        duration: 5d
      - name: 'Task 3'
        duration: 2d
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

    def test_generate_plan_invalid_yaml(self):
        """Test generating plan with invalid YAML returns error."""
        response = client.post(
            "/api/planning-room/generate-plan",
            json={
                "outline": "invalid: [unclosed",
                "flow": {"nodes": [], "edges": []}
            }
        )

        assert response.status_code == 400
        assert "Invalid outline YAML" in response.json()["detail"]

    def test_generate_plan_empty_outline(self):
        """Test generating plan with empty outline returns error."""
        response = client.post(
            "/api/planning-room/generate-plan",
            json={
                "outline": "",
                "flow": {"nodes": [], "edges": []}
            }
        )

        assert response.status_code == 400

    def test_generate_plan_with_flow_data(self):
        """Test generating plan with flow data (Phase 3 feature)."""
        outline = """
project:
  name: 'Flow Test'

phases:
  - name: 'Phase 1'
    tasks:
      - name: 'Task A'
        duration: 2d
      - name: 'Task B'
        duration: 3d
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
        yaml_content = """
project:
  name: 'Large Project'
  start_date: 2026-03-01

phases:
"""
        # Add 10 phases with 10 tasks each
        for phase_num in range(1, 11):
            yaml_content += f"  - name: 'Phase {phase_num}'\n    tasks:\n"
            for task_num in range(1, 11):
                yaml_content += f"      - name: 'Task {phase_num}.{task_num}'\n        duration: {task_num}d\n"

        response = client.post(
            "/api/planning-room/parse-outline",
            json={"yaml": yaml_content}
        )

        assert response.status_code == 200
        data = response.json()

        assert len(data["phases"]) == 10
        # Verify structure is correct
        assert len(data["phases"][0]["tasks"]) == 10

    def test_generate_plan_large_outline(self):
        """Test generating plan from large outline."""
        outline = """
project:
  name: 'Large Project'
  start_date: 2026-03-01

phases:
"""
        # Add 10 phases with 10 tasks each
        for phase_num in range(1, 11):
            outline += f"  - name: 'Phase {phase_num}'\n    tasks:\n"
            for task_num in range(1, 11):
                outline += f"      - name: 'Task {phase_num}.{task_num}'\n        duration: {task_num}d\n"

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
        yaml_content = """
project:
  name: 'Flow Test'

phases:
  - name: 'Phase 1'
    tasks:
      - name: 'Task A'
        duration: 2d
      - name: 'Task B'
        duration: 3d
"""
        response = client.post(
            "/api/planning-room/parse-outline",
            json={"yaml": yaml_content}
        )

        assert response.status_code == 200
        data = response.json()

        # Verify structure suitable for flow node creation
        assert len(data["phases"][0]["tasks"]) == 2
        assert data["phases"][0]["tasks"][0]["name"] == "Task A"
        assert data["phases"][0]["tasks"][1]["name"] == "Task B"

    def test_parse_outline_with_dependencies_structure(self):
        """Test outline parsing preserves task hierarchy for flow diagram."""
        yaml_content = """
project:
  name: 'Complex Flow'

phases:
  - name: 'Phase 1'
    tasks:
      - name: 'Parent Task'
        duration: 10d
        children:
          - name: 'Child 1'
            duration: 3d
          - name: 'Child 2'
            duration: 4d
  - name: 'Phase 2'
    tasks:
      - name: 'Task X'
        duration: 2d
"""
        response = client.post(
            "/api/planning-room/parse-outline",
            json={"yaml": yaml_content}
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
        yaml_content = """
project:
  name: 'Resource Flow Test'
  resources:
    - {id: alice, name: 'Alice', role: 'Dev'}
    - {id: bob, name: 'Bob', role: 'Designer'}

phases:
  - name: 'Phase 1'
    tasks:
      - name: 'Task 1'
        resources: ['@alice']
      - name: 'Task 2'
        resources: ['@bob']
      - name: 'Task 3'
        resources: ['@alice', '@bob']
"""
        response = client.post(
            "/api/planning-room/parse-outline",
            json={"yaml": yaml_content}
        )

        assert response.status_code == 200
        data = response.json()

        tasks = data["phases"][0]["tasks"]
        assert tasks[0]["resources"] == ['@alice']
        assert tasks[1]["resources"] == ['@bob']
        assert tasks[2]["resources"] == ['@alice', '@bob']
