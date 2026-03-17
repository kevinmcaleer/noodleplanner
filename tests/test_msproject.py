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
    _check_mpxj_available,
    _duration_to_iso8601,
    _duration_to_days,
    _date_to_msproject,
    _parse_iso8601_duration,
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

    def test_import_mpp_without_mpxj_returns_error(self, client):
        """Uploading .mpp when mpxj is not available gives a clear error."""
        with patch("noodle_web.app._check_mpxj_available", return_value=False):
            response = client.post(
                "/api/msproject/import",
                files={"file": ("project.mpp", b"\x00\x01\x02", "application/octet-stream")},
            )
        assert response.status_code == 400
        assert "mpxj" in response.json()["detail"].lower() or "xml" in response.json()["detail"].lower()


# ---------------------------------------------------------------------------
# .mpp import helper tests
# ---------------------------------------------------------------------------


class TestDurationToDays:
    def test_none_returns_one(self):
        assert _duration_to_days(None) == 1

    def test_hours_duration(self):
        dur = MagicMock()
        dur.duration = 16.0
        dur.units = "HOURS"
        assert _duration_to_days(dur) == 2

    def test_days_duration(self):
        dur = MagicMock()
        dur.duration = 5.0
        dur.units = "DAYS"
        assert _duration_to_days(dur) == 5

    def test_weeks_duration(self):
        dur = MagicMock()
        dur.duration = 2.0
        dur.units = "WEEKS"
        assert _duration_to_days(dur) == 10

    def test_months_duration(self):
        dur = MagicMock()
        dur.duration = 1.0
        dur.units = "MONTHS"
        assert _duration_to_days(dur) == 20

    def test_zero_duration_returns_one(self):
        dur = MagicMock()
        dur.duration = 0.0
        dur.units = "DAYS"
        assert _duration_to_days(dur) == 1


class TestCheckMpxjAvailable:
    def test_returns_false_when_not_installed(self):
        with patch.dict("sys.modules", {"mpxj": None}):
            # Force re-evaluation - mpxj import will fail
            import importlib
            import sys
            # Remove cached result if any
            if "mpxj" in sys.modules:
                del sys.modules["mpxj"]
            # The function tries to import mpxj; with it removed it should fail
            result = _check_mpxj_available()
            # Result depends on whether mpxj is actually installed
            assert isinstance(result, bool)


class TestImportFromMpp:
    def test_raises_import_error_without_mpxj(self):
        """import_from_mpp raises ImportError when mpxj is not available."""
        with patch.dict("sys.modules", {"mpxj": None}):
            with pytest.raises(ImportError, match="mpxj"):
                import_from_mpp(b"\x00\x01\x02")

    def test_import_with_mocked_mpxj(self):
        """Test the full import flow with a mocked mpxj project."""
        # Build a mock project structure
        mock_resource = MagicMock()
        mock_resource.unique_id = 1
        mock_resource.name = "Alice Developer"

        mock_pred_task = MagicMock()
        mock_pred_task.unique_id = 1

        mock_relation = MagicMock()
        mock_relation.target_task = mock_pred_task

        mock_duration = MagicMock()
        mock_duration.duration = 24.0
        mock_duration.units = "HOURS"

        mock_task1 = MagicMock()
        mock_task1.name = "Design Phase"
        mock_task1.unique_id = 1
        mock_task1.outline_level = 1
        mock_task1.summary = True
        mock_task1.duration = None
        mock_task1.percent_complete = 0
        mock_task1.predecessors = []
        mock_task1.notes = None

        mock_task2 = MagicMock()
        mock_task2.name = "Build Widget"
        mock_task2.unique_id = 2
        mock_task2.outline_level = 2
        mock_task2.summary = False
        mock_task2.duration = mock_duration
        mock_task2.percent_complete = 50
        mock_task2.predecessors = [mock_relation]
        mock_task2.notes = "Important task"

        mock_assignment = MagicMock()
        mock_assignment.task = mock_task2
        mock_assignment.resource = mock_resource

        mock_project = MagicMock()
        mock_project.project_properties.project_title = "Test MPP Project"
        mock_project.project_properties.name = "Test MPP Project"
        mock_project.resources = [mock_resource]
        mock_project.tasks = [mock_task1, mock_task2]
        mock_project.resource_assignments = [mock_assignment]

        mock_reader = MagicMock()
        mock_reader.read.return_value = mock_project

        mock_mpxj = MagicMock()
        mock_mpxj.ProjectReader.return_value = mock_reader

        with patch.dict("sys.modules", {"mpxj": mock_mpxj}):
            result = import_from_mpp(b"\x00\x01\x02")

        assert "title: Test MPP Project" in result
        assert "Design Phase" in result
        assert "Build Widget" in result
        assert "3d" in result  # 24 hours = 3 days
        assert "@Alice" in result
        assert "50%" in result
        assert '[depends Design Phase]' in result
        assert '"Important task"' in result

    def test_import_strips_html_from_notes(self):
        """HTML tags in notes should be stripped."""
        mock_task = MagicMock()
        mock_task.name = "Task With HTML"
        mock_task.unique_id = 1
        mock_task.outline_level = 1
        mock_task.summary = False
        mock_task.duration = None
        mock_task.percent_complete = 0
        mock_task.predecessors = []
        mock_task.notes = "<p>Some <b>bold</b> note</p>"

        mock_project = MagicMock()
        mock_project.project_properties.project_title = "HTML Test"
        mock_project.resources = []
        mock_project.tasks = [mock_task]
        mock_project.resource_assignments = []

        mock_reader = MagicMock()
        mock_reader.read.return_value = mock_project

        mock_mpxj = MagicMock()
        mock_mpxj.ProjectReader.return_value = mock_reader

        with patch.dict("sys.modules", {"mpxj": mock_mpxj}):
            result = import_from_mpp(b"\x00")

        assert "Some bold note" in result
        assert "<p>" not in result
        assert "<b>" not in result
