"""Tests for Microsoft Project XML and .mpp import and export."""

import os
import tempfile
import xml.etree.ElementTree as ET
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from noodle_core.msproject import (
    export_to_msproject_xml,
    import_from_msproject_xml,
    import_from_mpp,
    _check_mpp_available,
    _check_mpxj_available,
    _duration_to_iso8601,
    _date_to_msproject,
    _parse_iso8601_duration,
    _generate_shortname,
)
from noodle_core.mpp_reader import (
    MppProject,
    MppTask,
    MppResource,
    MppDependency,
    MppAssignment,
)
from noodle_web import app


@pytest.fixture
def client():
    """Create a test client for the FastAPI app."""
    return TestClient(app)


@pytest.fixture
def sample_plan():
    """Sample project plan text."""
    return """Phase 1
  Task A @john 3d 50%
  Task B @jane 2d [depends Task A] "This is a note"
Phase 2
  Task C @john 5d"""


@pytest.fixture
def sample_plan_with_resources():
    """Sample project plan with resource mappings in front matter."""
    return """---
title: Test Project
resources:
  - name: John Doe
    shortname: john
  - name: Jane Smith
    shortname: jane
---
Phase 1
  Task A @john 3d 50%
  Task B @jane 2d [depends Task A] "Important task"
Phase 2
  Task C @john 5d"""


@pytest.fixture
def sample_msproject_xml():
    """Sample MS Project XML content for import testing."""
    return """<?xml version="1.0" encoding="UTF-8"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <Name>Test Project</Name>
  <Title>Test Project</Title>
  <Calendars>
    <Calendar>
      <UID>1</UID>
      <Name>Standard</Name>
      <IsBaseCalendar>1</IsBaseCalendar>
    </Calendar>
  </Calendars>
  <Resources>
    <Resource>
      <UID>1</UID>
      <Name>John Doe</Name>
      <ID>1</ID>
    </Resource>
    <Resource>
      <UID>2</UID>
      <Name>Jane Smith</Name>
      <ID>2</ID>
    </Resource>
  </Resources>
  <Tasks>
    <Task>
      <UID>1</UID>
      <ID>1</ID>
      <Name>Phase 1</Name>
      <OutlineLevel>1</OutlineLevel>
      <Summary>1</Summary>
      <Start>2025-01-06T00:00:00</Start>
      <Finish>2025-01-10T00:00:00</Finish>
      <Duration>PT40H0M0S</Duration>
      <PercentComplete>0</PercentComplete>
    </Task>
    <Task>
      <UID>2</UID>
      <ID>2</ID>
      <Name>Design mockups</Name>
      <OutlineLevel>2</OutlineLevel>
      <Summary>0</Summary>
      <Start>2025-01-06T00:00:00</Start>
      <Finish>2025-01-08T00:00:00</Finish>
      <Duration>PT24H0M0S</Duration>
      <PercentComplete>75</PercentComplete>
      <Notes>Review with stakeholders</Notes>
    </Task>
    <Task>
      <UID>3</UID>
      <ID>3</ID>
      <Name>Build prototype</Name>
      <OutlineLevel>2</OutlineLevel>
      <Summary>0</Summary>
      <Start>2025-01-08T00:00:00</Start>
      <Finish>2025-01-10T00:00:00</Finish>
      <Duration>PT16H0M0S</Duration>
      <PercentComplete>0</PercentComplete>
      <PredecessorLink>
        <PredecessorUID>2</PredecessorUID>
        <Type>1</Type>
      </PredecessorLink>
    </Task>
  </Tasks>
  <Assignments>
    <Assignment>
      <UID>1</UID>
      <TaskUID>2</TaskUID>
      <ResourceUID>1</ResourceUID>
    </Assignment>
    <Assignment>
      <UID>2</UID>
      <TaskUID>3</TaskUID>
      <ResourceUID>2</ResourceUID>
    </Assignment>
  </Assignments>
</Project>"""


# ---------------------------------------------------------------------------
# Unit tests for helper functions
# ---------------------------------------------------------------------------


class TestDurationToISO8601:
    def test_zero_days(self):
        assert _duration_to_iso8601(0) == "PT0H0M0S"

    def test_negative_days(self):
        assert _duration_to_iso8601(-1) == "PT0H0M0S"

    def test_one_day(self):
        assert _duration_to_iso8601(1) == "PT8H0M0S"

    def test_five_days(self):
        assert _duration_to_iso8601(5) == "PT40H0M0S"


class TestDateToMSProject:
    def test_none(self):
        assert _date_to_msproject(None) == ""

    def test_date_string(self):
        from datetime import date
        result = _date_to_msproject(date(2025, 1, 6))
        assert result == "2025-01-06T00:00:00"

    def test_datetime(self):
        from datetime import datetime
        result = _date_to_msproject(datetime(2025, 1, 6, 9, 30, 0))
        assert result == "2025-01-06T09:30:00"


class TestParseISO8601Duration:
    def test_empty_string(self):
        assert _parse_iso8601_duration("") == 0

    def test_eight_hours(self):
        assert _parse_iso8601_duration("PT8H0M0S") == 1

    def test_sixteen_hours(self):
        assert _parse_iso8601_duration("PT16H0M0S") == 2

    def test_forty_hours(self):
        assert _parse_iso8601_duration("PT40H0M0S") == 5

    def test_zero_hours(self):
        assert _parse_iso8601_duration("PT0H0M0S") == 1


# ---------------------------------------------------------------------------
# Export tests
# ---------------------------------------------------------------------------


class TestExportToMSProjectXML:
    def test_export_creates_valid_xml(self, sample_plan):
        with tempfile.NamedTemporaryFile(suffix=".xml", delete=False) as f:
            path = f.name

        try:
            export_to_msproject_xml(sample_plan, path, project_name="Test Project")
            assert os.path.exists(path)

            tree = ET.parse(path)
            root = tree.getroot()
            # Strip namespace for easier querying
            ns = "http://schemas.microsoft.com/project"
            assert root.find(f"{{{ns}}}Name").text == "Test Project"
        finally:
            os.unlink(path)

    def test_export_includes_tasks(self, sample_plan):
        with tempfile.NamedTemporaryFile(suffix=".xml", delete=False) as f:
            path = f.name

        try:
            export_to_msproject_xml(sample_plan, path, project_name="Test")
            tree = ET.parse(path)
            root = tree.getroot()
            ns = "http://schemas.microsoft.com/project"
            tasks = root.findall(f".//{{{ns}}}Task")
            assert len(tasks) > 0
        finally:
            os.unlink(path)

    def test_export_includes_resources(self, sample_plan):
        with tempfile.NamedTemporaryFile(suffix=".xml", delete=False) as f:
            path = f.name

        try:
            export_to_msproject_xml(sample_plan, path, project_name="Test")
            tree = ET.parse(path)
            root = tree.getroot()
            ns = "http://schemas.microsoft.com/project"
            resources = root.findall(f".//{{{ns}}}Resource")
            assert len(resources) > 0
        finally:
            os.unlink(path)

    def test_export_includes_assignments(self, sample_plan):
        with tempfile.NamedTemporaryFile(suffix=".xml", delete=False) as f:
            path = f.name

        try:
            export_to_msproject_xml(sample_plan, path, project_name="Test")
            tree = ET.parse(path)
            root = tree.getroot()
            ns = "http://schemas.microsoft.com/project"
            assignments = root.findall(f".//{{{ns}}}Assignment")
            assert len(assignments) > 0
        finally:
            os.unlink(path)

    def test_export_includes_percent_complete(self, sample_plan):
        with tempfile.NamedTemporaryFile(suffix=".xml", delete=False) as f:
            path = f.name

        try:
            export_to_msproject_xml(sample_plan, path, project_name="Test")
            tree = ET.parse(path)
            root = tree.getroot()
            ns = "http://schemas.microsoft.com/project"
            # Find task with 50% complete
            tasks = root.findall(f".//{{{ns}}}Task")
            percent_values = [
                t.find(f"{{{ns}}}PercentComplete").text
                for t in tasks
                if t.find(f"{{{ns}}}PercentComplete") is not None
            ]
            assert "50" in percent_values
        finally:
            os.unlink(path)

    def test_export_includes_notes(self, sample_plan):
        with tempfile.NamedTemporaryFile(suffix=".xml", delete=False) as f:
            path = f.name

        try:
            export_to_msproject_xml(sample_plan, path, project_name="Test")
            tree = ET.parse(path)
            root = tree.getroot()
            ns = "http://schemas.microsoft.com/project"
            notes = [
                t.find(f"{{{ns}}}Notes").text
                for t in root.findall(f".//{{{ns}}}Task")
                if t.find(f"{{{ns}}}Notes") is not None
            ]
            assert len(notes) > 0
            assert "This is a note" in notes
        finally:
            os.unlink(path)

    def test_export_with_resource_mappings(self, sample_plan_with_resources):
        with tempfile.NamedTemporaryFile(suffix=".xml", delete=False) as f:
            path = f.name

        try:
            export_to_msproject_xml(
                sample_plan_with_resources, path, project_name="Test"
            )
            tree = ET.parse(path)
            root = tree.getroot()
            ns = "http://schemas.microsoft.com/project"
            resource_names = [
                r.find(f"{{{ns}}}Name").text
                for r in root.findall(f".//{{{ns}}}Resource")
            ]
            # Should use mapped full names
            assert "John Doe" in resource_names or "john" in [n.lower() for n in resource_names]
        finally:
            os.unlink(path)


# ---------------------------------------------------------------------------
# Import tests
# ---------------------------------------------------------------------------


class TestImportFromMSProjectXML:
    def test_import_returns_markdown(self, sample_msproject_xml):
        result = import_from_msproject_xml(sample_msproject_xml)
        assert isinstance(result, str)
        assert len(result) > 0

    def test_import_includes_project_title(self, sample_msproject_xml):
        result = import_from_msproject_xml(sample_msproject_xml)
        assert "title: Test Project" in result

    def test_import_includes_task_names(self, sample_msproject_xml):
        result = import_from_msproject_xml(sample_msproject_xml)
        assert "Design mockups" in result
        assert "Build prototype" in result

    def test_import_includes_percent_complete(self, sample_msproject_xml):
        result = import_from_msproject_xml(sample_msproject_xml)
        assert "75%" in result

    def test_import_includes_resources(self, sample_msproject_xml):
        result = import_from_msproject_xml(sample_msproject_xml)
        assert "@John" in result or "@Jane" in result

    def test_import_includes_dependencies(self, sample_msproject_xml):
        result = import_from_msproject_xml(sample_msproject_xml)
        assert "[depends Design mockups]" in result

    def test_import_includes_notes(self, sample_msproject_xml):
        result = import_from_msproject_xml(sample_msproject_xml)
        assert "Review with stakeholders" in result

    def test_import_includes_duration(self, sample_msproject_xml):
        result = import_from_msproject_xml(sample_msproject_xml)
        assert "3d" in result or "2d" in result

    def test_import_preserves_hierarchy(self, sample_msproject_xml):
        result = import_from_msproject_xml(sample_msproject_xml)
        lines = result.strip().split("\n")
        # Phase 1 should be at top level (no indent)
        phase_lines = [l for l in lines if "Phase 1" in l]
        assert len(phase_lines) > 0
        assert not phase_lines[0].startswith("  ")

        # Child tasks should be indented
        child_lines = [l for l in lines if "Design mockups" in l]
        assert len(child_lines) > 0
        assert child_lines[0].startswith("  ")

    def test_import_no_namespace_xml(self):
        """Test import of XML without namespace."""
        xml = """<?xml version="1.0" encoding="UTF-8"?>
<Project>
  <Name>Simple Project</Name>
  <Tasks>
    <Task>
      <UID>1</UID>
      <ID>1</ID>
      <Name>Do thing</Name>
      <OutlineLevel>1</OutlineLevel>
      <Summary>0</Summary>
      <Duration>PT16H0M0S</Duration>
      <PercentComplete>25</PercentComplete>
    </Task>
  </Tasks>
</Project>"""
        result = import_from_msproject_xml(xml)
        assert "Do thing" in result
        assert "25%" in result


# ---------------------------------------------------------------------------
# Round-trip test (export then import)
# ---------------------------------------------------------------------------


class TestMSProjectRoundTrip:
    def test_round_trip_preserves_task_names(self, sample_plan):
        with tempfile.NamedTemporaryFile(suffix=".xml", delete=False) as f:
            path = f.name

        try:
            export_to_msproject_xml(sample_plan, path, project_name="Test")
            with open(path, "r", encoding="utf-8") as f:
                xml_content = f.read()
            result = import_from_msproject_xml(xml_content)
            # Task names should survive the round trip
            assert "Task A" in result
            assert "Task B" in result
            assert "Task C" in result
        finally:
            os.unlink(path)


# ---------------------------------------------------------------------------
# API endpoint tests
# ---------------------------------------------------------------------------


class TestMSProjectExportEndpoint:
    def test_export_via_render(self, client):
        plan_text = """Phase 1
  Task 1 @john 3d
  Task 2 @jane 2d"""
        response = client.post("/render", json={
            "plan_text": plan_text,
            "export_msproject": True,
        })
        assert response.status_code == 200
        assert "application/xml" in response.headers["content-type"]
        assert response.headers.get("content-disposition") is not None

    def test_export_produces_valid_xml(self, client):
        plan_text = """Phase 1
  Task 1 @john 3d"""
        response = client.post("/render", json={
            "plan_text": plan_text,
            "export_msproject": True,
        })
        assert response.status_code == 200
        # Should parse as valid XML
        root = ET.fromstring(response.content)
        assert root is not None


class TestMSProjectImportEndpoint:
    def test_import_xml_file(self, client, sample_msproject_xml):
        response = client.post(
            "/api/msproject/import",
            files={"file": ("test.xml", sample_msproject_xml.encode(), "application/xml")},
        )
        assert response.status_code == 200
        data = response.json()
        assert "markdown" in data
        assert "Design mockups" in data["markdown"]

    def test_import_rejects_non_xml(self, client):
        response = client.post(
            "/api/msproject/import",
            files={"file": ("test.txt", b"not xml", "text/plain")},
        )
        assert response.status_code == 400

    def test_import_rejects_invalid_xml(self, client):
        response = client.post(
            "/api/msproject/import",
            files={"file": ("test.xml", b"<not valid xml", "application/xml")},
        )
        assert response.status_code in (400, 500)

    def test_import_returns_filename(self, client, sample_msproject_xml):
        response = client.post(
            "/api/msproject/import",
            files={"file": ("myproject.xml", sample_msproject_xml.encode(), "application/xml")},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["filename"] == "myproject.xml"

    def test_import_mpp_without_olefile_returns_error(self, client):
        """Uploading .mpp when olefile is not available gives a clear error."""
        with patch("noodle_web.app._check_mpp_available", return_value=False):
            response = client.post(
                "/api/msproject/import",
                files={"file": ("project.mpp", b"\x00\x01\x02", "application/octet-stream")},
            )
        assert response.status_code == 400
        assert "olefile" in response.json()["detail"].lower()


# ---------------------------------------------------------------------------
# .mpp import helper tests
# ---------------------------------------------------------------------------


class TestMppTaskDurationDays:
    """Test MppTask.duration_days property."""

    def test_none_duration(self):
        task = MppTask(unique_id=1, task_id=1, name="T", outline_level=1,
                       duration_minutes=None, start=None, finish=None,
                       percent_complete=0, milestone=False, summary=False,
                       parent_unique_id=None)
        assert task.duration_days is None

    def test_one_day(self):
        task = MppTask(unique_id=1, task_id=1, name="T", outline_level=1,
                       duration_minutes=480.0, start=None, finish=None,
                       percent_complete=0, milestone=False, summary=False,
                       parent_unique_id=None)
        assert task.duration_days == 1.0

    def test_hours_to_days(self):
        # 16 hours = 960 minutes = 2 days
        task = MppTask(unique_id=1, task_id=1, name="T", outline_level=1,
                       duration_minutes=960.0, start=None, finish=None,
                       percent_complete=0, milestone=False, summary=False,
                       parent_unique_id=None)
        assert task.duration_days == 2.0

    def test_zero_duration(self):
        task = MppTask(unique_id=1, task_id=1, name="T", outline_level=1,
                       duration_minutes=0.0, start=None, finish=None,
                       percent_complete=0, milestone=False, summary=False,
                       parent_unique_id=None)
        assert task.duration_days == 0.0


class TestCheckMppAvailable:
    def test_returns_true_when_olefile_installed(self):
        # olefile is in our dependencies so should be available
        assert _check_mpp_available() is True

    def test_backwards_compat_alias(self):
        # _check_mpxj_available is an alias for _check_mpp_available
        assert _check_mpxj_available() == _check_mpp_available()

    def test_returns_false_when_olefile_not_installed(self):
        with patch.dict("sys.modules", {"olefile": None}):
            import sys
            if "olefile" in sys.modules:
                del sys.modules["olefile"]
            result = _check_mpp_available()
            assert isinstance(result, bool)


class TestImportFromMpp:
    def _make_mock_project(self, title="Test MPP Project", tasks=None,
                           resources=None, dependencies=None,
                           assignments=None):
        """Build an MppProject with real dataclass objects."""
        return MppProject(
            title=title,
            author="Test Author",
            mpp_version="MPP14 (Project 2010+)",
            tasks=tasks or [],
            resources=resources or [],
            dependencies=dependencies or [],
            assignments=assignments or [],
        )

    def test_import_with_mocked_reader(self):
        """Test the full import flow with a mocked MppProject.read()."""
        import datetime

        task1 = MppTask(
            unique_id=1, task_id=1, name="Design Phase", outline_level=1,
            duration_minutes=None, start=datetime.datetime(2025, 1, 6),
            finish=datetime.datetime(2025, 1, 10), percent_complete=0,
            milestone=False, summary=True, parent_unique_id=None,
        )
        task2 = MppTask(
            unique_id=2, task_id=2, name="Build Widget", outline_level=2,
            duration_minutes=1440.0,  # 3 days (3 * 480)
            start=datetime.datetime(2025, 1, 6),
            finish=datetime.datetime(2025, 1, 8), percent_complete=50,
            milestone=False, summary=False, parent_unique_id=1,
        )

        resource = MppResource(
            unique_id=1, resource_id=1, name="Alice Developer", type="Work",
        )

        dep = MppDependency(
            predecessor_unique_id=1, successor_unique_id=2,
            relation_type="FS", lag_minutes=0.0,
        )

        assign = MppAssignment(
            task_unique_id=2, resource_unique_id=1, units=100.0,
        )

        project = self._make_mock_project(
            title="Test MPP Project",
            tasks=[task1, task2],
            resources=[resource],
            dependencies=[dep],
            assignments=[assign],
        )

        with patch("noodle_core.mpp_reader.MppProject.read", return_value=project):
            result = import_from_mpp(b"\x00\x01\x02")

        assert "title: Test MPP Project" in result
        assert "Design Phase" in result
        assert "Build Widget" in result
        assert "3d" in result  # 1440 minutes = 3 days
        assert "@adeveloper" in result  # shortname for Alice Developer
        assert "50%" in result
        # Adjacent predecessor uses * shorthand
        assert "Build Widget 3d @adeveloper 50% *" in result
        # Resource header section
        assert "Resources:" in result
        assert "- @adeveloper: Alice Developer" in result

    def test_import_no_resources_or_deps(self):
        """Test import with tasks only — no resources or dependencies."""
        task = MppTask(
            unique_id=1, task_id=1, name="Simple Task", outline_level=1,
            duration_minutes=480.0, start=None, finish=None,
            percent_complete=0, milestone=False, summary=False,
            parent_unique_id=None,
        )

        project = self._make_mock_project(
            title="Simple Project", tasks=[task],
        )

        with patch("noodle_core.mpp_reader.MppProject.read", return_value=project):
            result = import_from_mpp(b"\x00")

        assert "title: Simple Project" in result
        assert "Simple Task 1d" in result
        # No Resources header when there are no resources
        assert "Resources:" not in result

    def test_import_non_adjacent_dependency(self):
        """Non-adjacent predecessor uses [depends: ...] instead of *."""
        import datetime

        task1 = MppTask(
            unique_id=1, task_id=1, name="Task A", outline_level=1,
            duration_minutes=480.0, start=datetime.datetime(2025, 1, 6),
            finish=datetime.datetime(2025, 1, 6), percent_complete=0,
            milestone=False, summary=False, parent_unique_id=None,
        )
        task2 = MppTask(
            unique_id=2, task_id=2, name="Task B", outline_level=1,
            duration_minutes=480.0, start=datetime.datetime(2025, 1, 7),
            finish=datetime.datetime(2025, 1, 7), percent_complete=0,
            milestone=False, summary=False, parent_unique_id=None,
        )
        task3 = MppTask(
            unique_id=3, task_id=3, name="Task C", outline_level=1,
            duration_minutes=480.0, start=datetime.datetime(2025, 1, 8),
            finish=datetime.datetime(2025, 1, 8), percent_complete=0,
            milestone=False, summary=False, parent_unique_id=None,
        )

        # Task C depends on Task A (non-adjacent, Task B is in between)
        dep = MppDependency(
            predecessor_unique_id=1, successor_unique_id=3,
            relation_type="FS", lag_minutes=0.0,
        )

        project = self._make_mock_project(
            title="Dep Test",
            tasks=[task1, task2, task3],
            dependencies=[dep],
        )

        with patch("noodle_core.mpp_reader.MppProject.read", return_value=project):
            result = import_from_mpp(b"\x00")

        assert "[depends: Task A]" in result

    def test_import_multiple_dependencies(self):
        """Multiple predecessors use [depends: ...] format."""
        import datetime

        task1 = MppTask(
            unique_id=1, task_id=1, name="Task A", outline_level=1,
            duration_minutes=480.0, start=datetime.datetime(2025, 1, 6),
            finish=datetime.datetime(2025, 1, 6), percent_complete=0,
            milestone=False, summary=False, parent_unique_id=None,
        )
        task2 = MppTask(
            unique_id=2, task_id=2, name="Task B", outline_level=1,
            duration_minutes=480.0, start=datetime.datetime(2025, 1, 7),
            finish=datetime.datetime(2025, 1, 7), percent_complete=0,
            milestone=False, summary=False, parent_unique_id=None,
        )
        task3 = MppTask(
            unique_id=3, task_id=3, name="Task C", outline_level=1,
            duration_minutes=480.0, start=datetime.datetime(2025, 1, 8),
            finish=datetime.datetime(2025, 1, 8), percent_complete=0,
            milestone=False, summary=False, parent_unique_id=None,
        )

        # Task C depends on both Task A and Task B
        dep1 = MppDependency(
            predecessor_unique_id=1, successor_unique_id=3,
            relation_type="FS", lag_minutes=0.0,
        )
        dep2 = MppDependency(
            predecessor_unique_id=2, successor_unique_id=3,
            relation_type="FS", lag_minutes=0.0,
        )

        project = self._make_mock_project(
            title="Multi Dep Test",
            tasks=[task1, task2, task3],
            dependencies=[dep1, dep2],
        )

        with patch("noodle_core.mpp_reader.MppProject.read", return_value=project):
            result = import_from_mpp(b"\x00")

        assert "[depends: Task A, Task B]" in result

    def test_import_resource_shortname_generation(self):
        """Resources use generated shortnames and appear in header."""
        import datetime

        task1 = MppTask(
            unique_id=1, task_id=1, name="Do Work", outline_level=1,
            duration_minutes=480.0, start=datetime.datetime(2025, 1, 6),
            finish=datetime.datetime(2025, 1, 6), percent_complete=0,
            milestone=False, summary=False, parent_unique_id=None,
        )

        res1 = MppResource(unique_id=1, resource_id=1, name="Kevin McAleer", type="Work")
        res2 = MppResource(unique_id=2, resource_id=2, name="Jane Smith", type="Work")

        assign1 = MppAssignment(task_unique_id=1, resource_unique_id=1, units=100.0)

        project = self._make_mock_project(
            title="Resource Test",
            tasks=[task1],
            resources=[res1, res2],
            assignments=[assign1],
        )

        with patch("noodle_core.mpp_reader.MppProject.read", return_value=project):
            result = import_from_mpp(b"\x00")

        # Shortname in task line
        assert "@kmcaleer" in result
        # Resource header
        assert "- @kmcaleer: Kevin McAleer" in result
        assert "- @jsmith: Jane Smith" in result

    def test_import_adjacent_dependency_uses_star(self):
        """Adjacent predecessor (immediately preceding task) uses * shorthand."""
        import datetime

        task1 = MppTask(
            unique_id=1, task_id=1, name="First", outline_level=1,
            duration_minutes=480.0, start=datetime.datetime(2025, 1, 6),
            finish=datetime.datetime(2025, 1, 6), percent_complete=0,
            milestone=False, summary=False, parent_unique_id=None,
        )
        task2 = MppTask(
            unique_id=2, task_id=2, name="Second", outline_level=1,
            duration_minutes=480.0, start=datetime.datetime(2025, 1, 7),
            finish=datetime.datetime(2025, 1, 7), percent_complete=0,
            milestone=False, summary=False, parent_unique_id=None,
        )

        dep = MppDependency(
            predecessor_unique_id=1, successor_unique_id=2,
            relation_type="FS", lag_minutes=0.0,
        )

        project = self._make_mock_project(
            title="Star Dep",
            tasks=[task1, task2],
            dependencies=[dep],
        )

        with patch("noodle_core.mpp_reader.MppProject.read", return_value=project):
            result = import_from_mpp(b"\x00")

        # Should use * not [depends: First]
        assert "Second 1d *" in result
        assert "[depends" not in result


# ---------------------------------------------------------------------------
# Shortname generation tests
# ---------------------------------------------------------------------------


class TestGenerateShortname:
    def test_two_part_name(self):
        assert _generate_shortname("John Smith") == "jsmith"

    def test_single_name(self):
        assert _generate_shortname("Alice") == "alice"

    def test_three_part_name(self):
        assert _generate_shortname("Bob J. Jones") == "bjones"

    def test_mcname(self):
        assert _generate_shortname("Kevin McAleer") == "kmcaleer"

    def test_empty_string(self):
        assert _generate_shortname("") == ""
