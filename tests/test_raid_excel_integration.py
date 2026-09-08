"""Tests for RAID Log integration with Excel export/import."""

import io
import os
import tempfile
import pytest
from openpyxl import load_workbook

from noodle_core import (
    export_to_excel,
    parse_raid_markdown,
    generate_raid_log_text,
    convert_plan_format_to_standard
)
from noodle_core.format_converter import extract_raid_log
from noodle_core.excel_importer import convert_excel_to_markdown


class TestRaidLogExcelExport:
    """Test suite for RAID Log inclusion in main plan Excel export."""

    def test_export_includes_raid_log_sheet(self):
        """Test that Excel export includes a RAID Log sheet when RAID items are present."""
        plan_text = """---
title: Test Project
---

Phase 1
  Task 1 5d

---raid log---
| Type   | Description       | Status | Score | Owner | Date       |
| ------ | ----------------- | ------ | ----- | ----- | ---------- |
| risk   | Security concern  | open   | 12    | Alice | 2024-01-15 |
| issue  | Performance issue | open   | 9     | Bob   | 2024-01-16 |
"""

        # Convert plan to standard format (strips RAID log for task parsing)
        converted_text = convert_plan_format_to_standard(plan_text)

        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False) as tmp:
                tmp_path = tmp.name

            export_to_excel(
                converted_text,
                tmp_path,
                is_yaml=False,
                project_name="Test Project",
                original_text=plan_text
            )

            # Load the workbook and verify RAID Log sheet exists
            wb = load_workbook(tmp_path)
            assert "RAID Log" in wb.sheetnames

            ws_raid = wb["RAID Log"]

            # Check headers
            headers = [cell.value for cell in ws_raid[1]]
            assert "ID" in headers
            assert "Type" in headers
            assert "Title" in headers
            assert "Status" in headers
            assert "Score" in headers
            assert "Owner" in headers

            # Check data rows
            assert ws_raid.max_row >= 3  # Header + 2 data rows

            # Verify first RAID item
            row_2 = [cell.value for cell in ws_raid[2]]
            type_idx = headers.index("Type")
            title_idx = headers.index("Title")
            status_idx = headers.index("Status")
            owner_idx = headers.index("Owner")

            assert row_2[type_idx] == "Risk"
            assert row_2[title_idx] == "Security concern"
            assert row_2[status_idx] == "Open"
            assert row_2[owner_idx] == "Alice"

            wb.close()

        finally:
            if tmp_path and os.path.exists(tmp_path):
                os.unlink(tmp_path)

    def test_export_without_raid_log(self):
        """Test that Excel export works normally without RAID items."""
        plan_text = """---
title: Test Project
---

Phase 1
  Task 1 5d
"""

        converted_text = convert_plan_format_to_standard(plan_text)

        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False) as tmp:
                tmp_path = tmp.name

            export_to_excel(
                converted_text,
                tmp_path,
                is_yaml=False,
                project_name="Test Project",
                original_text=plan_text
            )

            # Load the workbook and verify RAID Log sheet does NOT exist
            wb = load_workbook(tmp_path)
            assert "RAID Log" not in wb.sheetnames
            assert "Tasks" in wb.sheetnames

            wb.close()

        finally:
            if tmp_path and os.path.exists(tmp_path):
                os.unlink(tmp_path)

    def test_export_raid_log_color_coding(self):
        """Test that RAID Log scores are color-coded in Excel export."""
        plan_text = """Phase 1
  Task 1 5d

---raid log---
| Type | Description | Status | Score | Owner | Date       |
| ---- | ----------- | ------ | ----- | ----- | ---------- |
| risk | High risk   | open   | 20    | Alice | 2024-01-15 |
| risk | Medium risk | open   | 9     | Bob   | 2024-01-16 |
| risk | Low risk    | open   | 2     | Carol | 2024-01-17 |
"""

        converted_text = convert_plan_format_to_standard(plan_text)

        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False) as tmp:
                tmp_path = tmp.name

            export_to_excel(
                converted_text,
                tmp_path,
                is_yaml=False,
                project_name="Test Project",
                original_text=plan_text
            )

            wb = load_workbook(tmp_path)
            ws_raid = wb["RAID Log"]

            headers = [cell.value for cell in ws_raid[1]]
            score_col = headers.index("Score") + 1

            # Check color coding (openpyxl uses ARGB format, not RGB)
            # High risk (score >= 16): Red background (FFE0E0)
            high_score_cell = ws_raid.cell(row=2, column=score_col)
            assert high_score_cell.value == 20
            # Accept both ARGB (00FFE0E0) and RGB (FFFFE0E0) formats
            assert high_score_cell.fill.start_color.rgb in ("FFFFE0E0", "00FFE0E0")

            # Medium risk (score >= 6): Yellow background (FFF3BF)
            med_score_cell = ws_raid.cell(row=3, column=score_col)
            assert med_score_cell.value == 9
            assert med_score_cell.fill.start_color.rgb in ("FFFFF3BF", "00FFF3BF")

            # Low risk (score < 6): Green background (D3F9D8)
            low_score_cell = ws_raid.cell(row=4, column=score_col)
            assert low_score_cell.value == 2
            assert low_score_cell.fill.start_color.rgb in ("FFD3F9D8", "00D3F9D8")

            wb.close()

        finally:
            if tmp_path and os.path.exists(tmp_path):
                os.unlink(tmp_path)


class TestRaidLogExcelImport:
    """Test suite for RAID Log inclusion in Excel import."""

    def _make_xlsx_with_raid(self):
        """Helper: create an Excel file with Tasks and RAID Log sheets."""
        from openpyxl import Workbook

        wb = Workbook()

        # Tasks sheet
        ws_tasks = wb.active
        ws_tasks.title = "Tasks"
        ws_tasks.append(["Task Name", "Start", "Finish", "Duration (days)", "Resources"])
        ws_tasks.append(["Phase 1", "2024-01-01", "2024-01-10", 10, ""])
        ws_tasks.append(["  Task 1", "2024-01-01", "2024-01-05", 5, "Alice"])

        # RAID Log sheet
        ws_raid = wb.create_sheet("RAID Log")
        ws_raid.append(["ID", "Type", "Title", "Description", "Raised By", "Owner",
                       "Mitigation Actions", "Impact", "Likelihood", "Score", "Status"])
        ws_raid.append([1, "Risk", "Security concern", "Need to review auth", "Bob", "Alice",
                       "Schedule review", 4, 3, 12, "Open"])
        ws_raid.append([2, "Issue", "Performance issue", "Slow queries", "Carol", "Bob",
                       "Optimize DB", 3, 3, 9, "Open"])

        buf = io.BytesIO()
        wb.save(buf)
        return buf.getvalue()

    def test_import_includes_raid_log(self):
        """Test that Excel import includes RAID Log section in markdown output."""
        file_bytes = self._make_xlsx_with_raid()

        result = convert_excel_to_markdown(
            file_bytes,
            "test.xlsx",
            "Tasks",
            {"task_name": "Task Name", "start_date": "Start", "end_date": "Finish"}
        )

        markdown = result["markdown"]

        # Verify RAID Log section is included
        assert "---raid log---" in markdown
        assert "Security concern" in markdown
        assert "Performance issue" in markdown

        # Verify it's a properly formatted table
        assert "| Type" in markdown
        assert "| Description" in markdown
        assert "| Status" in markdown
        assert "| Score" in markdown
        assert "| Owner" in markdown

    def test_import_without_raid_log(self):
        """Test that Excel import works normally without RAID Log sheet."""
        from openpyxl import Workbook

        wb = Workbook()
        ws = wb.active
        ws.title = "Tasks"
        ws.append(["Task Name", "Duration (days)"])
        ws.append(["Task 1", 5])

        buf = io.BytesIO()
        wb.save(buf)
        file_bytes = buf.getvalue()

        result = convert_excel_to_markdown(
            file_bytes,
            "test.xlsx",
            "Tasks",
            {"task_name": "Task Name", "duration": "Duration (days)"}
        )

        markdown = result["markdown"]

        # Verify RAID Log section is NOT included
        assert "---raid log---" not in markdown
        assert "Task 1" in markdown

    def test_import_raid_log_partial_columns(self):
        """Test that RAID Log import handles missing columns gracefully."""
        from openpyxl import Workbook

        wb = Workbook()

        # Tasks sheet
        ws_tasks = wb.active
        ws_tasks.title = "Tasks"
        ws_tasks.append(["Task Name"])
        ws_tasks.append(["Task 1"])

        # RAID Log sheet with minimal columns
        ws_raid = wb.create_sheet("RAID Log")
        ws_raid.append(["Type", "Title", "Status"])
        ws_raid.append(["Risk", "Test risk", "Open"])

        buf = io.BytesIO()
        wb.save(buf)
        file_bytes = buf.getvalue()

        result = convert_excel_to_markdown(
            file_bytes,
            "test.xlsx",
            "Tasks",
            {"task_name": "Task Name"}
        )

        markdown = result["markdown"]

        # Verify RAID Log section is included with defaults
        assert "---raid log---" in markdown
        assert "Test risk" in markdown


class TestRaidMarkdownParser:
    """Test suite for parse_raid_markdown function."""

    def test_parse_simple_raid_table(self):
        """Test parsing a simple RAID markdown table."""
        markdown = """
| Type | Description       | Status | Score | Owner | Date       |
| ---- | ----------------- | ------ | ----- | ----- | ---------- |
| risk | Security concern  | open   | 12    | Alice | 2024-01-15 |
| issue| Performance issue | open   | 9     | Bob   | 2024-01-16 |
"""
        items = parse_raid_markdown(markdown)

        assert len(items) == 2
        assert items[0]['type'] == 'risk'
        assert items[0]['title'] == 'Security concern'
        assert items[0]['status'] == 'open'
        assert items[0]['owner'] == 'Alice'

        assert items[1]['type'] == 'issue'
        assert items[1]['title'] == 'Performance issue'

    def test_parse_raid_table_with_full_fields(self):
        """Test parsing RAID table with all fields."""
        markdown = """
| ID | Type | Title | Description | Raised By | Owner | Mitigation Actions | Impact | Likelihood | Score | Status |
| -- | ---- | ----- | ----------- | --------- | ----- | ------------------ | ------ | ---------- | ----- | ------ |
| 1  | risk | Test  | Details     | Bob       | Alice | Review             | 4      | 3          | 12    | open   |
"""
        items = parse_raid_markdown(markdown)

        assert len(items) == 1
        assert items[0]['id'] == 1
        assert items[0]['type'] == 'risk'
        assert items[0]['title'] == 'Test'
        assert items[0]['description'] == 'Details'
        assert items[0]['raised_by'] == 'Bob'
        assert items[0]['owner'] == 'Alice'
        assert items[0]['mitigation_actions'] == 'Review'
        assert items[0]['impact'] == 4
        assert items[0]['likelihood'] == 3
        assert items[0]['score'] == 12
        assert items[0]['status'] == 'open'

    def test_parse_empty_table(self):
        """Test parsing an empty RAID table."""
        markdown = """
| Type | Title | Status |
| ---- | ----- | ------ |
"""
        items = parse_raid_markdown(markdown)
        assert len(items) == 0

    def test_parse_invalid_types_defaults_to_risk(self):
        """Test that invalid types default to 'risk'."""
        markdown = """
| Type    | Title      | Status |
| ------- | ---------- | ------ |
| invalid | Test item  | open   |
"""
        items = parse_raid_markdown(markdown)
        assert len(items) == 1
        assert items[0]['type'] == 'risk'

    def test_parse_escaped_pipes(self):
        """Test parsing RAID items with escaped pipes in content."""
        markdown = """
| Type | Title                | Status |
| ---- | -------------------- | ------ |
| risk | Test \\| with pipes  | open   |
"""
        items = parse_raid_markdown(markdown)
        assert len(items) == 1
        assert items[0]['title'] == 'Test | with pipes'

    def test_parse_raid_table_with_empty_cells(self):
        """Test that empty cells do not cause column misalignment.

        Regression test for #486: when RAID table rows have blank
        cells (e.g., no description or owner), the parser must
        preserve empty cells so type and status map correctly.
        """
        markdown = """
| ID | Type  | Title         | Description | Raised By | Owner | Mitigation Actions | Impact | Likelihood | Score | Status |
|----|-------|---------------|-------------|-----------|-------|--------------------|--------|------------|-------|--------|
| 1  | risk  | Security vuln |             |           | Alice |                    | 4      | 3          | 12    | open   |
| 2  | issue | Build broken  | CI failed   |           |       |                    | 3      | 4          | 12    | open   |
| 3  | risk  | Data loss     |             | Bob       |       | Test backups       | 5      | 2          | 10    | closed |
"""
        items = parse_raid_markdown(markdown)

        assert len(items) == 3

        # First item: empty description, raised_by, and mitigation
        assert items[0]['type'] == 'risk'
        assert items[0]['title'] == 'Security vuln'
        assert items[0]['description'] == ''
        assert items[0]['raised_by'] == ''
        assert items[0]['owner'] == 'Alice'
        assert items[0]['status'] == 'open'
        assert items[0]['impact'] == 4
        assert items[0]['likelihood'] == 3
        assert items[0]['score'] == 12

        # Second item: empty raised_by, owner, and mitigation
        assert items[1]['type'] == 'issue'
        assert items[1]['title'] == 'Build broken'
        assert items[1]['description'] == 'CI failed'
        assert items[1]['status'] == 'open'

        # Third item: empty description and owner
        assert items[2]['type'] == 'risk'
        assert items[2]['status'] == 'closed'
        assert items[2]['raised_by'] == 'Bob'
        assert items[2]['mitigation_actions'] == 'Test backups'


class TestRaidLogRoundTrip:
    """Test suite for RAID Log export/import round-trip consistency."""

    def test_export_import_roundtrip(self):
        """Test that exporting and importing preserves RAID Log data."""
        original_plan = """Phase 1
  Task 1 5d

---raid log---
| Type     | Description      | Status | Score | Owner | Date       |
| -------- | ---------------- | ------ | ----- | ----- | ---------- |
| risk     | Security concern | open   | 12    | Alice | 2024-01-15 |
| decision | Use PostgreSQL   | closed | 6     | Bob   | 2024-01-16 |
"""

        converted_text = convert_plan_format_to_standard(original_plan)

        # Export to Excel
        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False) as tmp:
                tmp_path = tmp.name

            export_to_excel(
                converted_text,
                tmp_path,
                is_yaml=False,
                project_name="Test",
                original_text=original_plan
            )

            # Import back from Excel
            with open(tmp_path, 'rb') as f:
                file_bytes = f.read()

            result = convert_excel_to_markdown(
                file_bytes,
                "test.xlsx",
                "Tasks",
                {"task_name": "Task Name", "duration": "Duration (days)"}
            )

            markdown = result["markdown"]

            # Verify RAID items are preserved
            assert "---raid log---" in markdown
            assert "Security concern" in markdown
            assert "Use PostgreSQL" in markdown
            assert "risk" in markdown.lower()
            assert "decision" in markdown.lower()

        finally:
            if tmp_path and os.path.exists(tmp_path):
                os.unlink(tmp_path)


class TestRaidMarkdownParserExtended:
    """Extended test suite for parse_raid_markdown function covering edge cases."""

    def test_parse_missing_impact_likelihood(self):
        """Test parsing RAID table with missing impact/likelihood columns."""
        markdown = """
| Type | Title      | Status | Score |
| ---- | ---------- | ------ | ----- |
| risk | Test risk  | open   | 12    |
"""
        items = parse_raid_markdown(markdown)
        assert len(items) == 1
        # Should have default impact and likelihood
        assert items[0]['impact'] == 3
        assert items[0]['likelihood'] == 3

    def test_parse_non_sequential_ids(self):
        """Test parsing RAID table with non-sequential IDs."""
        markdown = """
| ID | Type | Title  | Status |
| -- | ---- | ------ | ------ |
| 5  | risk | Risk 1 | open   |
| 10 | risk | Risk 2 | open   |
"""
        items = parse_raid_markdown(markdown)
        assert len(items) == 2
        assert items[0]['id'] == 5
        assert items[1]['id'] == 10

    def test_parse_missing_ids_generates_sequential(self):
        """Test that missing IDs are generated sequentially based on max_id_seen."""
        markdown = """
| ID | Type | Title  | Status |
| -- | ---- | ------ | ------ |
| 5  | risk | Risk 1 | open   |
|    | risk | Risk 2 | open   |
| 10 | risk | Risk 3 | open   |
|    | risk | Risk 4 | open   |
"""
        items = parse_raid_markdown(markdown)
        assert len(items) == 4
        assert items[0]['id'] == 5
        assert items[1]['id'] == 6  # max_id_seen (5) + 1
        assert items[2]['id'] == 10
        assert items[3]['id'] == 11  # max_id_seen (10) + 1

    def test_parse_full_format_with_title_and_description(self):
        """Test parsing full format table with both title and description columns."""
        markdown = """
| Type | Title       | Description  | Status |
| ---- | ----------- | ------------ | ------ |
| risk | Short title | Long details | open   |
"""
        items = parse_raid_markdown(markdown)
        assert len(items) == 1
        assert items[0]['title'] == 'Short title'
        assert items[0]['description'] == 'Long details'

    def test_parse_unicode_characters(self):
        """Test parsing RAID items with unicode characters."""
        markdown = """
| Type | Title           | Status |
| ---- | --------------- | ------ |
| risk | Café risqué 🎯 | open   |
"""
        items = parse_raid_markdown(markdown)
        assert len(items) == 1
        assert items[0]['title'] == 'Café risqué 🎯'


class TestRaidLogPerformance:
    """Test suite for RAID Log performance with large datasets."""

    def test_parse_large_raid_table(self):
        """Test parsing a large RAID table (1000 items) completes quickly."""
        import time

        # Generate large markdown table
        lines = ['| Type | Title | Status | Score | Owner | Date |']
        lines.append('| ---- | ----- | ------ | ----- | ----- | ---- |')
        for i in range(1000):
            lines.append(f'| risk | Risk item {i} | open | 9 | Alice | 2024-01-01 |')

        markdown = '\n'.join(lines)

        start_time = time.time()
        items = parse_raid_markdown(markdown)
        elapsed = time.time() - start_time

        assert len(items) == 1000
        assert elapsed < 1.0  # Should complete in less than 1 second

    def test_generate_large_raid_table(self):
        """Test generating markdown from 1000 RAID items completes quickly."""
        import time

        raid_items = []
        for i in range(1000):
            raid_items.append({
                'type': 'risk',
                'title': f'Risk item {i}',
                'status': 'open',
                'score': 9,
                'owner': 'Alice',
                'date': '2024-01-01',
            })

        start_time = time.time()
        markdown = generate_raid_log_text(raid_items)
        elapsed = time.time() - start_time

        assert len(markdown) > 0
        assert markdown.count('\n') >= 1001  # Header + separator + 1000 rows
        assert elapsed < 1.0  # Should complete in less than 1 second

    def test_excel_export_large_raid_log(self):
        """Test Excel export with large RAID log (500 items) completes successfully."""
        import time

        # Generate RAID items
        raid_items = []
        for i in range(500):
            raid_items.append({
                'type': 'risk',
                'title': f'Risk item {i}',
                'status': 'open',
                'score': 9,
                'owner': 'Alice',
                'date': '2024-01-01',
            })

        raid_table = generate_raid_log_text(raid_items)
        plan_text = f"""Phase 1
  Task 1 5d

---raid log---
{raid_table}
"""

        converted_text = convert_plan_format_to_standard(plan_text)

        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False) as tmp:
                tmp_path = tmp.name

            start_time = time.time()
            export_to_excel(
                converted_text,
                tmp_path,
                is_yaml=False,
                project_name="Test",
                original_text=plan_text
            )
            elapsed = time.time() - start_time

            # Verify export succeeded
            wb = load_workbook(tmp_path)
            assert "RAID Log" in wb.sheetnames
            ws_raid = wb["RAID Log"]
            assert ws_raid.max_row >= 501  # Header + 500 data rows
            wb.close()

            assert elapsed < 5.0  # Should complete in less than 5 seconds

        finally:
            if tmp_path and os.path.exists(tmp_path):
                os.unlink(tmp_path)


class TestRaidLogErrorHandling:
    """Test suite for RAID Log error handling."""

    def test_import_corrupted_raid_sheet(self):
        """Test that import handles corrupted RAID Log sheet gracefully."""
        from openpyxl import Workbook

        wb = Workbook()

        # Tasks sheet
        ws_tasks = wb.active
        ws_tasks.title = "Tasks"
        ws_tasks.append(["Task Name"])
        ws_tasks.append(["Task 1"])

        # Corrupted RAID Log sheet (no proper headers, just data)
        ws_raid = wb.create_sheet("RAID Log")
        ws_raid.append(["risk", "Test", "open"])  # No recognizable headers!

        buf = io.BytesIO()
        wb.save(buf)
        file_bytes = buf.getvalue()

        # Should not crash, may skip RAID log or include with warnings
        result = convert_excel_to_markdown(
            file_bytes,
            "test.xlsx",
            "Tasks",
            {"task_name": "Task Name"}
        )

        # Should have warnings about RAID log parsing
        assert len(result["warnings"]) > 0 or "---raid log---" not in result["markdown"]

    def test_import_raid_with_invalid_data_types(self):
        """Test that import handles invalid data types in RAID columns."""
        from openpyxl import Workbook

        wb = Workbook()

        ws_tasks = wb.active
        ws_tasks.title = "Tasks"
        ws_tasks.append(["Task Name"])
        ws_tasks.append(["Task 1"])

        ws_raid = wb.create_sheet("RAID Log")
        ws_raid.append(["Type", "Title", "Impact", "Likelihood", "Status"])
        # Invalid impact and likelihood (non-numeric)
        ws_raid.append(["risk", "Test", "high", "low", "open"])

        buf = io.BytesIO()
        wb.save(buf)
        file_bytes = buf.getvalue()

        # Should handle gracefully with defaults
        result = convert_excel_to_markdown(
            file_bytes,
            "test.xlsx",
            "Tasks",
            {"task_name": "Task Name"}
        )

        # Should have RAID section with default values
        markdown = result["markdown"]
        if "---raid log---" in markdown:
            # Score should be default (3*3=9)
            assert "9" in markdown or "3" in markdown

    def test_export_raid_with_missing_fields(self):
        """Test that export handles RAID items with missing required fields."""
        plan_text = """Phase 1
  Task 1 5d

---raid log---
| Type | Title | Status |
| ---- | ----- | ------ |
| risk |       | open   |
"""

        converted_text = convert_plan_format_to_standard(plan_text)

        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False) as tmp:
                tmp_path = tmp.name

            # Should not crash even with empty title
            export_to_excel(
                converted_text,
                tmp_path,
                is_yaml=False,
                project_name="Test",
                original_text=plan_text
            )

            wb = load_workbook(tmp_path)
            assert "RAID Log" in wb.sheetnames
            wb.close()

        finally:
            if tmp_path and os.path.exists(tmp_path):
                os.unlink(tmp_path)

    def test_export_with_malformed_raid_markdown(self):
        """Test that export handles malformed RAID markdown gracefully."""
        plan_text = """Phase 1
  Task 1 5d

---raid log---
This is not a table, just random text
"""

        converted_text = convert_plan_format_to_standard(plan_text)

        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False) as tmp:
                tmp_path = tmp.name

            # Should not crash even with malformed RAID section
            export_to_excel(
                converted_text,
                tmp_path,
                is_yaml=False,
                project_name="Test",
                original_text=plan_text
            )

            wb = load_workbook(tmp_path)
            # RAID Log sheet should not be created for invalid data
            assert "RAID Log" not in wb.sheetnames or wb["RAID Log"].max_row == 1
            wb.close()

        finally:
            if tmp_path and os.path.exists(tmp_path):
                os.unlink(tmp_path)


class TestParseRaidMarkdownPlanSync:
    """Test suite for parse_raid_markdown handling the plan sync format.

    The plan sync format uses columns:
    Type | Description | Status | Score | Owner | Date

    This is different from the full RAID format which uses:
    ID | Type | Title | Description | Raised By | Owner | Mitigation Actions | Impact | Likelihood | Score | Status

    The parser must handle both formats robustly.
    """

    def test_parse_plan_sync_format(self):
        """Test parsing the simple plan sync RAID table format."""
        markdown = """
| Type | Description      | Status | Score | Owner | Date       |
| ---- | ---------------- | ------ | ----- | ----- | ---------- |
| risk | Security concern | open   | 12    | Alice | 2024-01-15 |
"""
        items = parse_raid_markdown(markdown)
        assert len(items) == 1
        assert items[0]['type'] == 'risk'
        assert items[0]['title'] == 'Security concern'
        assert items[0]['status'] == 'open'
        assert items[0]['score'] == 12
        assert items[0]['owner'] == 'Alice'

    def test_parse_plan_sync_format_no_id_column(self):
        """Test that items get auto-assigned IDs when no ID column exists."""
        markdown = """
| Type  | Description       | Status | Score | Owner | Date       |
| ----- | ----------------- | ------ | ----- | ----- | ---------- |
| risk  | Risk one          | open   | 9     | Alice | 2024-01-15 |
| issue | Issue two         | open   | 12    | Bob   | 2024-01-16 |
"""
        items = parse_raid_markdown(markdown)
        assert len(items) == 2
        assert items[0]['id'] == 1
        assert items[1]['id'] == 2

    def test_parse_plan_sync_description_maps_to_title(self):
        """Test that Description column maps to title field in simple format."""
        markdown = """
| Type | Description           | Status |
| ---- | --------------------- | ------ |
| risk | Important risk detail | open   |
"""
        items = parse_raid_markdown(markdown)
        assert len(items) == 1
        assert items[0]['title'] == 'Important risk detail'

    def test_parse_full_format_keeps_title_and_description_separate(self):
        """Test that full format keeps title and description as separate fields."""
        markdown = """
| ID | Type | Title       | Description        | Raised By | Owner | Mitigation Actions | Impact | Likelihood | Score | Status |
| -- | ---- | ----------- | ------------------ | --------- | ----- | ------------------ | ------ | ---------- | ----- | ------ |
| 1  | risk | Risk Title  | Risk details here  | Bob       | Alice | Review             | 4      | 3          | 12    | open   |
"""
        items = parse_raid_markdown(markdown)
        assert len(items) == 1
        assert items[0]['title'] == 'Risk Title'
        assert items[0]['description'] == 'Risk details here'

    def test_extract_raid_log_from_plan_text(self):
        """Test extracting RAID log section from plan text."""
        plan_text = """Phase 1
  Task 1 5d

---raid log---
| Type | Description      | Status | Score | Owner | Date       |
| ---- | ---------------- | ------ | ----- | ----- | ---------- |
| risk | Security concern | open   | 12    | Alice | 2024-01-15 |
"""
        raid_text = extract_raid_log(plan_text)
        assert '| Type |' in raid_text
        assert 'Security concern' in raid_text

        items = parse_raid_markdown(raid_text)
        assert len(items) == 1
        assert items[0]['title'] == 'Security concern'

    def test_extract_raid_log_not_present(self):
        """Test that empty string returned when no RAID log section."""
        plan_text = """Phase 1
  Task 1 5d
"""
        raid_text = extract_raid_log(plan_text)
        assert raid_text == ''

    def test_parse_malformed_rows_are_skipped(self):
        """Test that malformed rows are skipped gracefully."""
        markdown = """
| Type | Description      | Status |
| ---- | ---------------- | ------ |
| risk | Valid item       | open   |
This is not a table row
| issue | Another valid   | closed |
"""
        items = parse_raid_markdown(markdown)
        assert len(items) == 2
        assert items[0]['title'] == 'Valid item'
        assert items[1]['title'] == 'Another valid'

    def test_parse_empty_text(self):
        """Test parsing empty text returns empty list."""
        assert parse_raid_markdown('') == []
        assert parse_raid_markdown('   ') == []

    def test_parse_no_table_found(self):
        """Test parsing text with no table returns empty list."""
        assert parse_raid_markdown('Just some random text') == []
        assert parse_raid_markdown('No pipes or tables here\nJust lines') == []

    def test_parse_only_type_column(self):
        """Test parsing table with minimal columns."""
        markdown = """
| Type   | Description |
| ------ | ----------- |
| risk   | A risk      |
"""
        items = parse_raid_markdown(markdown)
        assert len(items) == 1
        assert items[0]['type'] == 'risk'
        assert items[0]['title'] == 'A risk'
        assert items[0]['status'] == 'open'  # default


class TestParseRaidMarkdownPriorityTargetDate:
    """Test suite for priority and target_date fields in parse_raid_markdown."""

    def test_parse_priority_and_target_date(self):
        """Test parsing table with Priority and Target Date columns."""
        markdown = """
| ID | Type   | Title       | Description | Raised By | Owner | Mitigation Actions | Impact | Likelihood | Score | Status | Priority | Target Date |
| -- | ------ | ----------- | ----------- | --------- | ----- | ------------------ | ------ | ---------- | ----- | ------ | -------- | ----------- |
| 1  | action | Fix bug     | Details     | Bob       | Alice | Review code        | 3      | 2          | 6     | open   | high     | 2026-03-15  |
"""
        items = parse_raid_markdown(markdown)
        assert len(items) == 1
        assert items[0]['priority'] == 'high'
        assert items[0]['target_date'] == '2026-03-15'

    def test_parse_missing_priority_defaults_empty(self):
        """Test that missing priority defaults to empty string."""
        markdown = """
| Type   | Title       | Status |
| ------ | ----------- | ------ |
| action | Do thing    | open   |
"""
        items = parse_raid_markdown(markdown)
        assert len(items) == 1
        assert items[0]['priority'] == ''
        assert items[0]['target_date'] == ''

    def test_parse_date_column_maps_to_target_date(self):
        """Test that a 'Date' column maps to target_date."""
        markdown = """
| Type   | Description    | Status | Score | Owner | Date       |
| ------ | -------------- | ------ | ----- | ----- | ---------- |
| action | Review design  | open   | 6     | Alice | 2026-04-01 |
"""
        items = parse_raid_markdown(markdown)
        assert len(items) == 1
        assert items[0]['target_date'] == '2026-04-01'


class TestGenerateRaidLogPriorityTargetDate:
    """Test suite for priority and target_date in generate_raid_log_text."""

    def test_generate_includes_priority_and_target_date(self):
        """Test that generated table includes Priority and Target Date."""
        items = [
            {'type': 'action', 'title': 'Fix bug', 'status': 'open',
             'priority': 'high', 'target_date': '2026-03-15',
             'owner': 'Alice', 'score': 6},
        ]
        result = generate_raid_log_text(items)
        assert '| Priority' in result
        assert '| Target Date' in result
        assert 'high' in result
        assert '2026-03-15' in result

    def test_generate_empty_priority_and_target_date(self):
        """Test generation when priority/target_date are missing."""
        items = [
            {'type': 'risk', 'title': 'A risk', 'status': 'open', 'score': 9},
        ]
        result = generate_raid_log_text(items)
        assert '| Priority' in result
        assert '| Target Date' in result

    def test_roundtrip_preserves_priority_and_target_date(self):
        """Test that priority and target_date survive a generate/parse cycle."""
        original = [
            {'id': 1, 'type': 'action', 'title': 'Deploy fix',
             'description': 'Deploy the hotfix', 'raised_by': 'Bob',
             'owner': 'Alice', 'mitigation_actions': '', 'impact': 3,
             'likelihood': 2, 'score': 6, 'status': 'open',
             'priority': 'medium', 'target_date': '2026-04-10'},
        ]
        markdown = generate_raid_log_text(original)
        parsed = parse_raid_markdown(markdown)

        assert len(parsed) == 1
        assert parsed[0]['priority'] == 'medium'
        assert parsed[0]['target_date'] == '2026-04-10'
        assert parsed[0]['type'] == 'action'
        assert parsed[0]['title'] == 'Deploy fix'
        assert parsed[0]['owner'] == 'Alice'

    def test_roundtrip_date_field_fallback(self):
        """Test that 'date' key falls back correctly in generate."""
        items = [
            {'type': 'action', 'title': 'Task', 'status': 'open',
             'date': '2026-05-01', 'score': 1},
        ]
        result = generate_raid_log_text(items)
        assert '2026-05-01' in result


class TestParseRaidMarkdownEscalation:
    """Test suite for escalated/escalation_level fields in parse_raid_markdown (#736)."""

    def test_parse_escalated_and_escalation_level(self):
        """Test parsing a table with Escalated and Escalation Level columns."""
        markdown = """
| ID | Type | Title  | Description | Raised By | Owner | Mitigation Actions | Impact | Likelihood | Score | Status | Priority | Target Date | Escalated | Escalation Level |
| -- | ---- | ------ | ----------- | --------- | ----- | ------------------ | ------ | ---------- | ----- | ------ | -------- | ----------- | --------- | ----------------- |
| 1  | risk | Outage | Details     | Bob       | Alice | Add redundancy     | 4      | 3          | 12    | open   | high     | 2026-03-15  | yes       | programme         |
"""
        items = parse_raid_markdown(markdown)
        assert len(items) == 1
        assert items[0]['escalated'] is True
        assert items[0]['escalation_level'] == 'programme'

    def test_parse_missing_escalation_defaults(self):
        """Backward compat: a plan with no Escalated/Escalation Level columns
        (i.e. every plan saved before this feature existed) still parses,
        defaulting to not escalated."""
        markdown = """
| Type | Title    | Status |
| ---- | -------- | ------ |
| risk | Old risk | open   |
"""
        items = parse_raid_markdown(markdown)
        assert len(items) == 1
        assert items[0]['escalated'] is False
        assert items[0]['escalation_level'] == 'project'

    def test_parse_escalated_no_without_level_defaults_project(self):
        """Test that Escalated=no with no Escalation Level column defaults to project."""
        markdown = """
| Type  | Title | Status | Escalated |
| ----- | ----- | ------ | --------- |
| issue | Bug   | open   | no        |
"""
        items = parse_raid_markdown(markdown)
        assert len(items) == 1
        assert items[0]['escalated'] is False
        assert items[0]['escalation_level'] == 'project'

    def test_parse_invalid_escalation_level_defaults_project(self):
        """Test that an unrecognised Escalation Level value defaults to project."""
        markdown = """
| Type | Title | Status | Escalated | Escalation Level |
| ---- | ----- | ------ | --------- | ----------------- |
| risk | Bad   | open   | yes       | nonsense          |
"""
        items = parse_raid_markdown(markdown)
        assert len(items) == 1
        assert items[0]['escalation_level'] == 'project'

    def test_parse_escalated_to_board(self):
        """Test parsing an item escalated all the way to board level."""
        markdown = """
| Type  | Title | Status | Escalated | Escalation Level |
| ----- | ----- | ------ | --------- | ----------------- |
| issue | Sev1  | open   | true      | board             |
"""
        items = parse_raid_markdown(markdown)
        assert len(items) == 1
        assert items[0]['escalated'] is True
        assert items[0]['escalation_level'] == 'board'


class TestGenerateRaidLogEscalation:
    """Test suite for escalated/escalation_level in generate_raid_log_text (#736)."""

    def test_generate_omits_escalation_columns_when_nothing_escalated(self):
        """A plan with no escalated items shouldn't gain new columns."""
        items = [
            {'type': 'risk', 'title': 'A risk', 'status': 'open', 'score': 9},
        ]
        result = generate_raid_log_text(items)
        assert 'Escalated' not in result
        assert 'Escalation Level' not in result

    def test_generate_omits_escalation_columns_when_explicitly_not_escalated(self):
        """Explicit escalated=False/escalation_level='project' is still the
        default state, so it shouldn't add columns either."""
        items = [
            {'type': 'risk', 'title': 'A risk', 'status': 'open', 'score': 9,
             'escalated': False, 'escalation_level': 'project'},
        ]
        result = generate_raid_log_text(items)
        assert 'Escalated' not in result

    def test_generate_includes_escalation_columns_when_escalated(self):
        """Test that generated table includes Escalated and Escalation Level
        columns once something is actually escalated."""
        items = [
            {'type': 'issue', 'title': 'Sev1', 'status': 'open', 'score': 16,
             'escalated': True, 'escalation_level': 'board'},
        ]
        result = generate_raid_log_text(items)
        assert '| Escalated' in result
        assert '| Escalation Level' in result
        assert 'yes' in result
        assert 'board' in result

    def test_generate_includes_escalation_columns_for_all_rows_when_any_escalated(self):
        """When one item is escalated, the table stays rectangular -- every
        row gets the escalation columns, even rows that aren't escalated."""
        items = [
            {'type': 'risk', 'title': 'Escalated risk', 'status': 'open', 'score': 12,
             'escalated': True, 'escalation_level': 'programme'},
            {'type': 'issue', 'title': 'Not escalated', 'status': 'open', 'score': 4},
        ]
        result = generate_raid_log_text(items)
        lines = result.split('\n')
        assert len(set(len(line) for line in lines)) == 1
        assert 'no' in result
        assert 'project' in result

    def test_roundtrip_preserves_escalation(self):
        """Test that escalated and escalation_level survive a generate/parse cycle."""
        original = [
            {'id': 1, 'type': 'risk', 'title': 'Server may fail',
             'description': 'Hardware risk', 'raised_by': 'Bob', 'owner': 'Alice',
             'mitigation_actions': '', 'impact': 4, 'likelihood': 3, 'score': 12,
             'status': 'open', 'priority': '', 'target_date': '',
             'escalated': True, 'escalation_level': 'programme'},
            {'id': 2, 'type': 'issue', 'title': 'Not escalated',
             'description': '', 'raised_by': '', 'owner': '', 'mitigation_actions': '',
             'impact': 2, 'likelihood': 2, 'score': 4, 'status': 'open',
             'priority': '', 'target_date': '', 'escalated': False,
             'escalation_level': 'project'},
        ]
        markdown = generate_raid_log_text(original)
        parsed = parse_raid_markdown(markdown)

        assert len(parsed) == 2
        assert parsed[0]['escalated'] is True
        assert parsed[0]['escalation_level'] == 'programme'
        assert parsed[1]['escalated'] is False
        assert parsed[1]['escalation_level'] == 'project'

    def test_roundtrip_byte_identical_when_nothing_escalated(self):
        """The round-trip guarantee: a plan with no escalated items
        serialises byte-identical whether or not escalated/escalation_level
        keys are present (at their default values) on the item dicts."""
        items = [
            {'id': 1, 'type': 'risk', 'title': 'Server may fail',
             'description': '', 'raised_by': '', 'owner': 'Alice',
             'mitigation_actions': '', 'impact': 4, 'likelihood': 3, 'score': 12,
             'status': 'open', 'priority': '', 'target_date': ''},
        ]
        without_escalation_keys = generate_raid_log_text(items)

        items_with_defaults = [dict(items[0], escalated=False, escalation_level='project')]
        with_default_escalation_keys = generate_raid_log_text(items_with_defaults)

        assert without_escalation_keys == with_default_escalation_keys


class TestRaidExcelExportPriorityTargetDate:
    """Test suite for Priority and Target Date columns in RAID Log Excel export."""

    def test_export_includes_priority_and_target_date_columns(self):
        """Test that Excel export RAID Log sheet includes Priority and Target Date headers."""
        plan_text = """Phase 1
  Task 1 5d

---raid log---
| ID | Type   | Title       | Description | Raised By | Owner | Mitigation Actions | Impact | Likelihood | Score | Status | Priority | Target Date |
|----|--------|-------------|-------------|-----------|-------|--------------------|--------|------------|-------|--------|----------|-------------|
| 1  | action | Fix deploy  | Fix CI/CD   | Bob       | Alice | Review pipeline    | 3      | 2          | 6     | open   | high     | 2026-04-01  |
"""

        converted_text = convert_plan_format_to_standard(plan_text)

        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False) as tmp:
                tmp_path = tmp.name

            export_to_excel(
                converted_text,
                tmp_path,
                is_yaml=False,
                project_name="Test",
                original_text=plan_text
            )

            wb = load_workbook(tmp_path)
            assert "RAID Log" in wb.sheetnames

            ws_raid = wb["RAID Log"]
            headers = [cell.value for cell in ws_raid[1]]

            # Verify Priority and Target Date columns exist
            assert "Priority" in headers
            assert "Target Date" in headers

            # Verify data in those columns
            priority_idx = headers.index("Priority") + 1
            target_date_idx = headers.index("Target Date") + 1

            assert ws_raid.cell(row=2, column=priority_idx).value == "high"
            assert ws_raid.cell(row=2, column=target_date_idx).value == "2026-04-01"

            wb.close()

        finally:
            if tmp_path and os.path.exists(tmp_path):
                os.unlink(tmp_path)

    def test_export_empty_priority_and_target_date(self):
        """Test export handles items with no priority or target date."""
        plan_text = """Phase 1
  Task 1 5d

---raid log---
| Type | Description      | Status | Score | Owner | Date       |
| ---- | ---------------- | ------ | ----- | ----- | ---------- |
| risk | Security concern | open   | 12    | Alice | 2024-01-15 |
"""

        converted_text = convert_plan_format_to_standard(plan_text)

        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False) as tmp:
                tmp_path = tmp.name

            export_to_excel(
                converted_text,
                tmp_path,
                is_yaml=False,
                project_name="Test",
                original_text=plan_text
            )

            wb = load_workbook(tmp_path)
            ws_raid = wb["RAID Log"]
            headers = [cell.value for cell in ws_raid[1]]

            # Headers should always be present
            assert "Priority" in headers
            assert "Target Date" in headers

            # Values should be empty strings for items without priority/target_date
            priority_idx = headers.index("Priority") + 1
            target_date_idx = headers.index("Target Date") + 1

            priority_val = ws_raid.cell(row=2, column=priority_idx).value
            assert priority_val == "" or priority_val is None

            wb.close()

        finally:
            if tmp_path and os.path.exists(tmp_path):
                os.unlink(tmp_path)


class TestRaidExcelImportAllFields:
    """Test suite for importing all RAID fields from Excel."""

    def _make_xlsx_with_full_raid(self):
        """Helper: create Excel with full RAID Log columns including Priority and Target Date."""
        from openpyxl import Workbook

        wb = Workbook()

        ws_tasks = wb.active
        ws_tasks.title = "Tasks"
        ws_tasks.append(["Task Name", "Duration (days)"])
        ws_tasks.append(["Phase 1", 0])
        ws_tasks.append(["  Task 1", 5])

        ws_raid = wb.create_sheet("RAID Log")
        ws_raid.append([
            "ID", "Type", "Title", "Description", "Raised By", "Owner",
            "Mitigation Actions", "Impact", "Likelihood", "Score", "Status",
            "Priority", "Target Date"
        ])
        ws_raid.append([
            1, "Action", "Fix deploy", "Fix CI/CD pipeline", "Bob", "Alice",
            "Review pipeline", 3, 2, 6, "Open", "high", "2026-04-01"
        ])
        ws_raid.append([
            2, "Risk", "Data loss", "Backup failures", "Carol", "Dave",
            "Test backups weekly", 5, 3, 15, "Open", "critical", "2026-03-15"
        ])

        buf = io.BytesIO()
        wb.save(buf)
        return buf.getvalue()

    def test_import_preserves_all_raid_fields(self):
        """Test that import preserves all RAID fields including description, raised_by, etc."""
        file_bytes = self._make_xlsx_with_full_raid()

        result = convert_excel_to_markdown(
            file_bytes,
            "test.xlsx",
            "Tasks",
            {"task_name": "Task Name", "duration": "Duration (days)"}
        )

        markdown = result["markdown"]

        # Verify RAID log section exists
        assert "---raid log---" in markdown

        # Parse the RAID items from the generated markdown
        raid_items = parse_raid_markdown(markdown.split("---raid log---")[1])

        assert len(raid_items) == 2

        # First item
        assert raid_items[0]['type'] == 'action'
        assert raid_items[0]['title'] == 'Fix deploy'
        assert raid_items[0]['description'] == 'Fix CI/CD pipeline'
        assert raid_items[0]['raised_by'] == 'Bob'
        assert raid_items[0]['owner'] == 'Alice'
        assert raid_items[0]['mitigation_actions'] == 'Review pipeline'
        assert raid_items[0]['impact'] == 3
        assert raid_items[0]['likelihood'] == 2
        assert raid_items[0]['score'] == 6
        assert raid_items[0]['status'] == 'open'
        assert raid_items[0]['priority'] == 'high'
        assert raid_items[0]['target_date'] == '2026-04-01'

        # Second item
        assert raid_items[1]['type'] == 'risk'
        assert raid_items[1]['title'] == 'Data loss'
        assert raid_items[1]['owner'] == 'Dave'
        assert raid_items[1]['score'] == 15
        assert raid_items[1]['priority'] == 'critical'
        assert raid_items[1]['target_date'] == '2026-03-15'

    def test_import_priority_and_target_date(self):
        """Test that import reads Priority and Target Date columns from RAID Log sheet."""
        file_bytes = self._make_xlsx_with_full_raid()

        result = convert_excel_to_markdown(
            file_bytes,
            "test.xlsx",
            "Tasks",
            {"task_name": "Task Name", "duration": "Duration (days)"}
        )

        markdown = result["markdown"]

        # Verify priority and target date appear in the output
        assert "high" in markdown
        assert "critical" in markdown
        assert "2026-04-01" in markdown
        assert "2026-03-15" in markdown

    def test_full_roundtrip_preserves_priority_and_target_date(self):
        """Test full export/import roundtrip preserves Priority and Target Date."""
        original_plan = """Phase 1
  Task 1 5d

---raid log---
| ID | Type   | Title       | Description | Raised By | Owner | Mitigation Actions | Impact | Likelihood | Score | Status | Priority | Target Date |
|----|--------|-------------|-------------|-----------|-------|--------------------|--------|------------|-------|--------|----------|-------------|
| 1  | action | Fix deploy  | Fix CI/CD   | Bob       | Alice | Review pipeline    | 3      | 2          | 6     | open   | high     | 2026-04-01  |
| 2  | risk   | Data loss   | Backups     | Carol     | Dave  | Test backups       | 5      | 3          | 15    | open   | critical | 2026-03-15  |
"""

        converted_text = convert_plan_format_to_standard(original_plan)

        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False) as tmp:
                tmp_path = tmp.name

            # Export to Excel
            export_to_excel(
                converted_text,
                tmp_path,
                is_yaml=False,
                project_name="Test",
                original_text=original_plan
            )

            # Import back from Excel
            with open(tmp_path, 'rb') as f:
                file_bytes = f.read()

            result = convert_excel_to_markdown(
                file_bytes,
                "test.xlsx",
                "Tasks",
                {"task_name": "Task Name", "duration": "Duration (days)"}
            )

            markdown = result["markdown"]

            # Verify RAID items preserved
            assert "---raid log---" in markdown

            # Parse the imported RAID items
            raid_items = parse_raid_markdown(markdown.split("---raid log---")[1])

            assert len(raid_items) == 2

            # Verify priority and target_date survived the roundtrip
            assert raid_items[0]['priority'] == 'high'
            assert raid_items[0]['target_date'] == '2026-04-01'
            assert raid_items[0]['type'] == 'action'
            assert raid_items[0]['title'] == 'Fix deploy'
            assert raid_items[0]['description'] == 'Fix CI/CD'
            assert raid_items[0]['raised_by'] == 'Bob'
            assert raid_items[0]['owner'] == 'Alice'
            assert raid_items[0]['mitigation_actions'] == 'Review pipeline'

            assert raid_items[1]['priority'] == 'critical'
            assert raid_items[1]['target_date'] == '2026-03-15'
            assert raid_items[1]['type'] == 'risk'
            assert raid_items[1]['title'] == 'Data loss'

        finally:
            if tmp_path and os.path.exists(tmp_path):
                os.unlink(tmp_path)

    def test_import_description_fallback_to_title(self):
        """Test that Description column maps to title when Title column is absent."""
        from openpyxl import Workbook

        wb = Workbook()

        ws_tasks = wb.active
        ws_tasks.title = "Tasks"
        ws_tasks.append(["Task Name"])
        ws_tasks.append(["Task 1"])

        # RAID Log with Description but no Title column (simple format)
        ws_raid = wb.create_sheet("RAID Log")
        ws_raid.append(["Type", "Description", "Status", "Score", "Owner"])
        ws_raid.append(["Risk", "Important risk detail", "Open", 12, "Alice"])

        buf = io.BytesIO()
        wb.save(buf)
        file_bytes = buf.getvalue()

        result = convert_excel_to_markdown(
            file_bytes,
            "test.xlsx",
            "Tasks",
            {"task_name": "Task Name"}
        )

        markdown = result["markdown"]
        assert "---raid log---" in markdown
        assert "Important risk detail" in markdown

        # Parse and verify the title field was populated from description
        raid_items = parse_raid_markdown(markdown.split("---raid log---")[1])
        assert len(raid_items) == 1
        assert raid_items[0]['title'] == 'Important risk detail'
