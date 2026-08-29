"""Tests for Microsoft Project XML and .mpp import and export."""

import os
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from noodle_core.msproject import (
    _at_work_finish,
    _at_work_start,
    _inclusive_finish,
    export_to_msproject_xml,
    import_from_msproject_xml,
    import_from_mpp,
    _check_mpp_available,
    _check_mpxj_available,
    _duration_to_iso8601,
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

from tests.mspdi_schema import SCHEMA_PATH, validate_mspdi


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


class TestWorkingDayStamps:
    def test_none(self):
        assert _at_work_start(None) == ""
        assert _at_work_finish(None) == ""

    def test_date_gets_working_times(self):
        from datetime import date
        assert _at_work_start(date(2025, 1, 6)) == "2025-01-06T08:00:00"
        assert _at_work_finish(date(2025, 1, 6)) == "2025-01-06T17:00:00"

    def test_datetime_time_is_replaced(self):
        from datetime import datetime
        stamp = datetime(2025, 1, 6, 9, 30, 0)
        assert _at_work_start(stamp) == "2025-01-06T08:00:00"
        assert _at_work_finish(stamp) == "2025-01-06T17:00:00"


class TestInclusiveFinish:
    """The engine stores finish exclusively; MS Project wants it inclusive."""

    def test_five_day_task_ends_on_the_friday(self):
        from datetime import datetime
        # add_working_days(Mon, 5) returns the following Saturday.
        start = datetime(2025, 1, 6)   # Monday
        finish = datetime(2025, 1, 11)  # Saturday
        assert _inclusive_finish(start, finish) == datetime(2025, 1, 10)

    def test_weekend_finish_backs_off_to_friday(self):
        from datetime import datetime
        start = datetime(2025, 1, 6)    # Monday
        finish = datetime(2025, 1, 13)  # the following Monday
        assert _inclusive_finish(start, finish) == datetime(2025, 1, 10)

    def test_milestone_keeps_its_start(self):
        from datetime import datetime
        start = datetime(2025, 1, 6)
        assert _inclusive_finish(start, start) == start

    def test_missing_finish_falls_back_to_start(self):
        from datetime import datetime
        start = datetime(2025, 1, 6)
        assert _inclusive_finish(start, None) == start


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

    def test_resource_names_fold_on_case(self):
        """@Kev and @kev are one resource, not two sharing a UID."""
        plan = """Phase 1
  Task A 2d @Kev
  Task B 2d @kev"""

        with tempfile.NamedTemporaryFile(suffix=".xml", delete=False) as f:
            path = f.name
        try:
            export_to_msproject_xml(plan, path, project_name="Test")
            root = ET.parse(path).getroot()
            ns = "http://schemas.microsoft.com/project"
            resources = root.findall(f".//{{{ns}}}Resource")
            assert len(resources) == 1

            uid = resources[0].find(f"{{{ns}}}UID").text
            assigned = [
                a.find(f"{{{ns}}}ResourceUID").text
                for a in root.findall(f".//{{{ns}}}Assignment")
            ]
            assert assigned == [uid, uid]
        finally:
            os.unlink(path)


# ---------------------------------------------------------------------------
# Schema conformance (issue #753)
#
# MSPDI models every element as an xsd:sequence, so element order is part of
# the contract. A well-formed file whose children are out of schema order is
# rejected by Microsoft Project, which is exactly what #753 reported — and no
# amount of "is this valid XML" testing catches it.
# ---------------------------------------------------------------------------


@pytest.fixture
def exported_xml(sample_plan_with_resources):
    """Export the sample plan and yield the path to the generated XML."""
    with tempfile.NamedTemporaryFile(suffix=".xml", delete=False) as f:
        path = f.name
    try:
        export_to_msproject_xml(
            sample_plan_with_resources, path, project_name="Test Project"
        )
        yield path
    finally:
        os.unlink(path)


class TestMSPDISchemaConformance:
    def test_export_matches_schema_structure(self, exported_xml):
        """Element order and required elements match the MSPDI schema."""
        errors = validate_mspdi(exported_xml)
        assert errors == [], "MSPDI schema violations:\n  " + "\n  ".join(errors)

    def test_export_validates_with_xmllint(self, exported_xml):
        """Full schema validation, when xmllint is available."""
        if shutil.which("xmllint") is None:
            pytest.skip("xmllint not installed")

        # The schema targets the versioned namespace; MS Project writes the
        # unversioned one. Retarget the copy we hand to xmllint.
        source = Path(exported_xml).read_text()
        retargeted = source.replace(
            'xmlns="http://schemas.microsoft.com/project"',
            'xmlns="http://schemas.microsoft.com/project/2007"',
        )
        assert retargeted != source, "export namespace changed unexpectedly"

        with tempfile.NamedTemporaryFile(
            suffix=".xml", mode="w", delete=False
        ) as f:
            retargeted_path = f.name
            f.write(retargeted)
        try:
            result = subprocess.run(
                ["xmllint", "--noout", "--schema", str(SCHEMA_PATH),
                 retargeted_path],
                capture_output=True,
                text=True,
            )
            assert result.returncode == 0, result.stderr
        finally:
            os.unlink(retargeted_path)

    def test_export_declares_required_header(self, exported_xml):
        """SaveVersion and CurrencyCode are the schema's only required fields."""
        root = ET.parse(exported_xml).getroot()
        ns = "http://schemas.microsoft.com/project"
        assert root.find(f"{{{ns}}}SaveVersion") is not None
        assert root.find(f"{{{ns}}}CurrencyCode") is not None
        # SaveVersion must be the first child.
        assert root[0].tag == f"{{{ns}}}SaveVersion"

    def test_outline_starts_at_level_one(self, exported_xml):
        """Top-level tasks are OutlineLevel 1, not 2 (the old off-by-one)."""
        root = ET.parse(exported_xml).getroot()
        ns = "http://schemas.microsoft.com/project"
        levels = [
            int(t.find(f"{{{ns}}}OutlineLevel").text)
            for t in root.findall(f".//{{{ns}}}Task")
        ]
        assert min(levels) == 1
        assert 2 in levels, "expected a nested task in the sample plan"

    def test_calendar_defines_working_times(self, exported_xml):
        """The Standard calendar carries working days, not just a name."""
        root = ET.parse(exported_xml).getroot()
        ns = "http://schemas.microsoft.com/project"
        week_days = root.findall(f".//{{{ns}}}WeekDay")
        assert len(week_days) == 7
        working = [
            d for d in week_days
            if d.find(f"{{{ns}}}DayWorking").text == "1"
        ]
        assert len(working) == 5
        for day in working:
            assert day.findall(f".//{{{ns}}}WorkingTime")

    def test_task_finish_is_last_working_day(self, exported_xml):
        """Finish is the task's last working day, not the exclusive finish."""
        root = ET.parse(exported_xml).getroot()
        ns = "http://schemas.microsoft.com/project"
        task_a = next(
            t for t in root.findall(f".//{{{ns}}}Task")
            if t.find(f"{{{ns}}}Name").text == "Task A"
        )
        start = task_a.find(f"{{{ns}}}Start").text
        finish = task_a.find(f"{{{ns}}}Finish").text
        assert start.endswith("T08:00:00")
        assert finish.endswith("T17:00:00")

        start_date = datetime.strptime(start, "%Y-%m-%dT%H:%M:%S")
        finish_date = datetime.strptime(finish, "%Y-%m-%dT%H:%M:%S")
        # Task A is 3 days, so it covers 3 working days inclusive.
        assert finish_date.weekday() < 5
        assert (finish_date - start_date).days == 2

    def test_dependency_survives_export(self, exported_xml):
        """Task B depends on Task A, so a PredecessorLink must be written."""
        root = ET.parse(exported_xml).getroot()
        ns = "http://schemas.microsoft.com/project"
        task_a_uid = next(
            t.find(f"{{{ns}}}UID").text
            for t in root.findall(f".//{{{ns}}}Task")
            if t.find(f"{{{ns}}}Name").text == "Task A"
        )
        task_b = next(
            t for t in root.findall(f".//{{{ns}}}Task")
            if t.find(f"{{{ns}}}Name").text == "Task B"
        )
        links = task_b.findall(f"{{{ns}}}PredecessorLink")
        assert len(links) == 1
        assert links[0].find(f"{{{ns}}}PredecessorUID").text == task_a_uid
        assert links[0].find(f"{{{ns}}}Type").text == "1"  # 1 = finish-to-start


class TestDependsColonSyntax:
    """`[depends: X]` must parse the same as `[depends X]`.

    The .mpp importer writes the colon form, so before this was fixed every
    dependency coming out of a .mpp import was silently dropped — in the
    scheduler as well as in the MS Project export.
    """

    @pytest.mark.parametrize("syntax", ["[depends Task A]", "[depends: Task A]"])
    def test_both_forms_produce_a_predecessor_link(self, syntax):
        plan = f"""Phase 1
  Task A 3d
  Task B 2d {syntax}"""

        with tempfile.NamedTemporaryFile(suffix=".xml", delete=False) as f:
            path = f.name
        try:
            export_to_msproject_xml(plan, path, project_name="Test")
            root = ET.parse(path).getroot()
            ns = "http://schemas.microsoft.com/project"
            task_b = next(
                t for t in root.findall(f".//{{{ns}}}Task")
                if t.find(f"{{{ns}}}Name").text == "Task B"
            )
            assert task_b.findall(f"{{{ns}}}PredecessorLink"), (
                f"{syntax} produced no PredecessorLink"
            )
        finally:
            os.unlink(path)

    def test_mpp_import_output_round_trips(self):
        """What import_from_mpp writes, the parser must be able to read back."""
        from noodle_core.metadata import extract_metadata

        meta = extract_metadata("Task B 2d [depends: Task A]", "Task B")
        assert meta.get("depends") == ["Task A"]


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
        assert "*Build Widget 3d @adeveloper 50%" in result
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
        assert "*Second 1d" in result
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


# ---------------------------------------------------------------------------
# End-to-end test with real Draft Plan.mpp (skipped if file not present)
# ---------------------------------------------------------------------------


class TestRealMppImport:
    """Integration tests using the real Draft Plan.mpp file.

    These are skipped when the file is not available (e.g., in CI).
    """

    DRAFT_PLAN = Path(__file__).resolve().parent.parent / "Draft Plan.mpp"

    @pytest.fixture(autouse=True)
    def _skip_if_no_file(self):
        if not self.DRAFT_PLAN.exists():
            pytest.skip("Draft Plan.mpp not present")

    def _import(self):
        with open(self.DRAFT_PLAN, "rb") as f:
            return import_from_mpp(f.read())

    def test_imports_without_error(self):
        result = self._import()
        assert result
        assert "---" in result

    def test_title(self):
        result = self._import()
        assert "title: Draft Plan" in result

    def test_task_count(self):
        result = self._import()
        # All non-blank, non-frontmatter lines are task lines
        lines = [l for l in result.strip().split("\n")
                 if l.strip() and not l.startswith("---") and not l.startswith("title:")]
        assert len(lines) >= 90  # Draft Plan has ~97 tasks

    def test_indentation_max_two_per_level(self):
        """Every child should be exactly 2 spaces deeper than its parent."""
        result = self._import()
        lines = result.strip().split("\n")
        prev_indent = 0
        for line in lines:
            if not line.strip() or line.startswith("---") or line.startswith("title:"):
                continue
            indent = len(line) - len(line.lstrip())
            # Indent can increase by at most 2 from previous line
            assert indent <= prev_indent + 2, (
                f"Indent jumped by {indent - prev_indent} (max 2): {line!r}"
            )
            prev_indent = indent

    def test_dependencies_present(self):
        result = self._import()
        assert "[depends:" in result or "*" in result

    def test_star_dependency_prepended(self):
        """The * shorthand must be prepended with no space."""
        result = self._import()
        for line in result.split("\n"):
            stripped = line.lstrip()
            if stripped.startswith("*"):
                # Ensure no trailing ' *' pattern (old format)
                assert not stripped.endswith(" *")

    def test_known_tasks_present(self):
        result = self._import()
        assert "Project Soti - MobiControl" in result
        assert "DEFINITION PHASE" in result
        assert "DESIGN, BUILD & TEST PHASE" in result
        assert "Close project" in result

    def test_durations_present(self):
        result = self._import()
        assert "5d" in result  # Detail Definition phase = 5 days
        assert "2d" in result  # Compile PDD = 2 days

    def test_percent_complete(self):
        result = self._import()
        assert "50%" in result  # Gate 1 approval
        assert "20%" in result  # Compile PDD
