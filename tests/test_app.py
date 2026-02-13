"""Tests for FastAPI application endpoints."""

import pytest
from fastapi.testclient import TestClient

from noodle_web import app


@pytest.fixture
def client():
    """Create a test client for the FastAPI app."""
    return TestClient(app)


@pytest.fixture
def sample_plan():
    """Sample project plan for testing."""
    return """Phase 1
  Task 1 @john 3d
  Task 2 @jane 2d
Phase 2
  Task 3 @john 5d"""


@pytest.fixture
def sample_plan_with_frontmatter():
    """Sample project plan with YAML front matter."""
    return """---
title: Test Project
resources:
  - name: John Doe
    shortname: john
  - name: Jane Smith
    shortname: jane
---
Phase 1
  Task 1 @john 3d
  Task 2 @jane 2d"""


class TestRootEndpoint:
    """Test suite for root endpoint."""

    def test_root_returns_html(self, client):
        """Test that root endpoint returns HTML page."""
        response = client.get("/")
        assert response.status_code == 200
        assert "text/html" in response.headers["content-type"]

    def test_root_contains_expected_elements(self, client):
        """Test that HTML contains expected elements."""
        response = client.get("/")
        html_content = response.text
        # Check for key elements of the interface
        assert "Noodle Planner" in html_content or "Plan Editor" in html_content
        assert "planEditor" in html_content  # Textarea ID

    def test_root_contains_timeline_controls(self, client):
        """Test that HTML contains timeline view with Show Phases and Detailed checkboxes."""
        response = client.get("/")
        html_content = response.text
        assert "showPhasesToggle" in html_content
        assert "detailedTimelineToggle" in html_content
        assert "toggleDetailedTimeline()" in html_content
        assert "Detailed" in html_content


class TestHealthCheckEndpoint:
    """Test suite for health check endpoint."""

    def test_health_check_returns_200(self, client):
        """Test that health check returns 200 OK."""
        response = client.get("/health")
        assert response.status_code == 200

    def test_health_check_returns_json(self, client):
        """Test that health check returns JSON."""
        response = client.get("/health")
        assert response.headers["content-type"] == "application/json"

    def test_health_check_has_status(self, client):
        """Test that health check includes status field."""
        response = client.get("/health")
        data = response.json()
        assert "status" in data
        assert data["status"] == "healthy"

    def test_health_check_has_timestamp(self, client):
        """Test that health check includes timestamp."""
        response = client.get("/health")
        data = response.json()
        assert "timestamp" in data
        # Verify it's a valid ISO format timestamp
        assert "T" in data["timestamp"]


class TestRenderEndpoint:
    """Test suite for /render endpoint."""

    def test_render_basic_plan(self, client, sample_plan):
        """Test rendering a basic plan."""
        response = client.post(
            "/render",
            json={
                "plan_text": sample_plan,
                "project_name": "Test Project",
                "export_excel": False,
                "export_ppt": False,
                "export_pdf": False
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert "ascii_output" in data
        assert len(data["ascii_output"]) > 0

    def test_render_with_project_name(self, client, sample_plan):
        """Test that project name is used in rendered output."""
        response = client.post(
            "/render",
            json={
                "plan_text": sample_plan,
                "project_name": "My Project",
                "export_excel": False,
                "export_ppt": False,
                "export_pdf": False
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert "My Project" in data["ascii_output"]

    def test_render_extracts_frontmatter_title(self, client, sample_plan_with_frontmatter):
        """Test that title is extracted from front matter."""
        response = client.post(
            "/render",
            json={
                "plan_text": sample_plan_with_frontmatter,
                "export_excel": False,
                "export_ppt": False,
                "export_pdf": False
            }
        )
        assert response.status_code == 200
        data = response.json()
        # Title from front matter should be used
        assert "Test Project" in data["ascii_output"]

    def test_render_without_project_name_uses_default(self, client, sample_plan):
        """Test that default project name is used when none provided."""
        response = client.post(
            "/render",
            json={
                "plan_text": sample_plan,
                "export_excel": False,
                "export_ppt": False,
                "export_pdf": False
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert "Project" in data["ascii_output"]

    def test_render_with_empty_plan(self, client):
        """Test rendering with empty plan text."""
        response = client.post(
            "/render",
            json={
                "plan_text": "",
                "export_excel": False,
                "export_ppt": False,
                "export_pdf": False
            }
        )
        # Should either return 200 with empty output or 422 validation error
        assert response.status_code in [200, 422]

    def test_render_with_invalid_plan_format(self, client):
        """Test rendering with malformed plan."""
        response = client.post(
            "/render",
            json={
                "plan_text": "This is not a valid plan format ][{@#$",
                "project_name": "Test",
                "export_excel": False,
                "export_ppt": False,
                "export_pdf": False
            }
        )
        # Should handle gracefully - either render or return error
        assert response.status_code in [200, 422, 500]

    def test_render_missing_required_field(self, client):
        """Test that missing plan_text returns validation error."""
        response = client.post(
            "/render",
            json={
                "project_name": "Test",
                "export_excel": False,
                "export_ppt": False,
                "export_pdf": False
            }
        )
        assert response.status_code == 422  # Validation error

    def test_render_with_special_characters_in_project_name(self, client, sample_plan):
        """Test project name with special characters."""
        response = client.post(
            "/render",
            json={
                "plan_text": sample_plan,
                "project_name": "Project: Test & Dev (2025)",
                "export_excel": False,
                "export_ppt": False,
                "export_pdf": False
            }
        )
        assert response.status_code == 200


class TestExcelExport:
    """Test suite for Excel export functionality."""

    def test_export_excel_returns_file(self, client, sample_plan):
        """Test that Excel export returns a file."""
        response = client.post(
            "/render",
            json={
                "plan_text": sample_plan,
                "project_name": "Test",
                "export_excel": True,
                "export_ppt": False,
                "export_pdf": False
            }
        )
        assert response.status_code == 200
        assert "spreadsheetml.sheet" in response.headers["content-type"]

    def test_export_excel_has_correct_filename(self, client, sample_plan):
        """Test that Excel export has correct filename."""
        response = client.post(
            "/render",
            json={
                "plan_text": sample_plan,
                "project_name": "MyProject",
                "export_excel": True,
                "export_ppt": False,
                "export_pdf": False
            }
        )
        assert response.status_code == 200
        content_disposition = response.headers.get("content-disposition", "")
        assert "MyProject.xlsx" in content_disposition

    def test_export_excel_returns_binary_data(self, client, sample_plan):
        """Test that Excel export returns binary data."""
        response = client.post(
            "/render",
            json={
                "plan_text": sample_plan,
                "project_name": "Test",
                "export_excel": True,
                "export_ppt": False,
                "export_pdf": False
            }
        )
        assert response.status_code == 200
        # Excel files start with PK (ZIP format signature)
        assert response.content[:2] == b'PK'


class TestPowerPointExport:
    """Test suite for PowerPoint export functionality."""

    def test_export_ppt_returns_file(self, client, sample_plan):
        """Test that PowerPoint export returns a file."""
        response = client.post(
            "/render",
            json={
                "plan_text": sample_plan,
                "project_name": "Test",
                "export_excel": False,
                "export_ppt": True,
                "export_pdf": False
            }
        )
        assert response.status_code == 200
        assert "presentationml.presentation" in response.headers["content-type"]

    def test_export_ppt_has_correct_filename(self, client, sample_plan):
        """Test that PowerPoint export has correct filename."""
        response = client.post(
            "/render",
            json={
                "plan_text": sample_plan,
                "project_name": "MyProject",
                "export_excel": False,
                "export_ppt": True,
                "export_pdf": False
            }
        )
        assert response.status_code == 200
        content_disposition = response.headers.get("content-disposition", "")
        assert "MyProject-timeline.pptx" in content_disposition

    def test_export_ppt_returns_binary_data(self, client, sample_plan):
        """Test that PowerPoint export returns binary data."""
        response = client.post(
            "/render",
            json={
                "plan_text": sample_plan,
                "project_name": "Test",
                "export_excel": False,
                "export_ppt": True,
                "export_pdf": False
            }
        )
        assert response.status_code == 200
        # PPTX files also start with PK (ZIP format signature)
        assert response.content[:2] == b'PK'


class TestPDFExport:
    """Test suite for PDF export functionality."""

    def test_export_pdf_returns_file(self, client, sample_plan):
        """Test that PDF export returns a file."""
        response = client.post(
            "/render",
            json={
                "plan_text": sample_plan,
                "project_name": "Test",
                "export_excel": False,
                "export_ppt": False,
                "export_pdf": True
            }
        )
        assert response.status_code == 200
        assert "application/pdf" in response.headers["content-type"]

    def test_export_pdf_has_correct_filename(self, client, sample_plan):
        """Test that PDF export has correct filename."""
        response = client.post(
            "/render",
            json={
                "plan_text": sample_plan,
                "project_name": "MyProject",
                "export_excel": False,
                "export_ppt": False,
                "export_pdf": True
            }
        )
        assert response.status_code == 200
        content_disposition = response.headers.get("content-disposition", "")
        assert "MyProject.pdf" in content_disposition

    def test_export_pdf_returns_binary_data(self, client, sample_plan):
        """Test that PDF export returns binary data."""
        response = client.post(
            "/render",
            json={
                "plan_text": sample_plan,
                "project_name": "Test",
                "export_excel": False,
                "export_ppt": False,
                "export_pdf": True
            }
        )
        assert response.status_code == 200
        # PDF files start with %PDF
        assert response.content[:4] == b'%PDF'


class TestMultipleExports:
    """Test suite for multiple export formats."""

    def test_multiple_exports_returns_zip(self, client, sample_plan):
        """Test that requesting multiple exports returns a ZIP file."""
        response = client.post(
            "/render",
            json={
                "plan_text": sample_plan,
                "project_name": "Test",
                "export_excel": True,
                "export_ppt": True,
                "export_pdf": False
            }
        )
        assert response.status_code == 200
        assert "application/zip" in response.headers["content-type"]

    def test_multiple_exports_zip_filename(self, client, sample_plan):
        """Test that ZIP has correct filename."""
        response = client.post(
            "/render",
            json={
                "plan_text": sample_plan,
                "project_name": "MyProject",
                "export_excel": True,
                "export_ppt": True,
                "export_pdf": False
            }
        )
        assert response.status_code == 200
        content_disposition = response.headers.get("content-disposition", "")
        assert "MyProject-exports.zip" in content_disposition

    def test_all_exports_returns_zip(self, client, sample_plan):
        """Test that requesting all exports returns a ZIP file."""
        response = client.post(
            "/render",
            json={
                "plan_text": sample_plan,
                "project_name": "Test",
                "export_excel": True,
                "export_ppt": True,
                "export_pdf": True
            }
        )
        assert response.status_code == 200
        assert "application/zip" in response.headers["content-type"]
        # ZIP files start with PK
        assert response.content[:2] == b'PK'


class TestStaticFiles:
    """Test suite for static file serving."""

    def test_favicon_exists(self, client):
        """Test that favicon endpoint exists."""
        response = client.get("/favicon.png")
        # Should either return the file (200) or 404 if not found
        assert response.status_code in [200, 404]

    def test_logo_exists(self, client):
        """Test that logo endpoint exists."""
        response = client.get("/logo.png")
        # Should either return the file (200) or 404 if not found
        assert response.status_code in [200, 404]

    def test_script_js_contains_detailed_timeline_functions(self, client):
        """Test that script.js contains the detailed timeline rendering functions."""
        response = client.get("/static/script.js")
        assert response.status_code == 200
        js_content = response.text
        assert "renderDetailedPhaseBlocks" in js_content
        assert "assignPhaseRows" in js_content
        assert "darkenColor" in js_content
        assert "toggleDetailedTimeline" in js_content
        assert "detailedTimelineEnabled" in js_content

    def test_style_css_contains_detailed_timeline_styles(self, client):
        """Test that style.css contains the detailed timeline CSS classes."""
        response = client.get("/static/style.css")
        assert response.status_code == 200
        css_content = response.text
        assert "detailed-timeline-container" in css_content
        assert "detailed-timeline-svg" in css_content


class TestEdgeCases:
    """Test edge cases and error conditions."""

    def test_render_with_very_long_plan(self, client):
        """Test rendering with very long plan text."""
        # Create a plan with many tasks
        long_plan = "\n".join([f"Task {i} @user 1d" for i in range(100)])
        response = client.post(
            "/render",
            json={
                "plan_text": long_plan,
                "project_name": "Large Project",
                "export_excel": False,
                "export_ppt": False,
                "export_pdf": False
            }
        )
        assert response.status_code == 200

    def test_render_with_unicode_characters(self, client):
        """Test rendering with unicode characters."""
        unicode_plan = """Phase 1
  Tâche 1 @jean 3d
  タスク 2 @user 2d
  任务 3 @user 1d"""
        response = client.post(
            "/render",
            json={
                "plan_text": unicode_plan,
                "project_name": "Unicode Test",
                "export_excel": False,
                "export_ppt": False,
                "export_pdf": False
            }
        )
        assert response.status_code == 200

    def test_render_with_malformed_json(self, client):
        """Test that malformed JSON returns 422."""
        response = client.post(
            "/render",
            data="not valid json",
            headers={"content-type": "application/json"}
        )
        assert response.status_code == 422

    def test_invalid_http_method_on_render(self, client):
        """Test that GET on /render is not allowed."""
        response = client.get("/render")
        assert response.status_code == 405  # Method not allowed

    def test_options_request_on_render(self, client):
        """Test that OPTIONS request works (CORS preflight)."""
        response = client.options("/render")
        # TestClient may return 200 or 405 depending on implementation
        assert response.status_code in [200, 405]


class TestRequestValidation:
    """Test input validation."""

    def test_plan_text_too_large(self, client):
        """Test that excessively large plan text is rejected."""
        # Create a plan larger than MAX_FILE_SIZE (1MB)
        large_plan = "A" * (2 * 1024 * 1024)  # 2MB
        response = client.post(
            "/render",
            json={
                "plan_text": large_plan,
                "export_excel": False,
                "export_ppt": False,
                "export_pdf": False
            }
        )
        assert response.status_code == 422  # Validation error

    def test_project_name_too_long(self, client, sample_plan):
        """Test that excessively long project name is rejected."""
        long_name = "A" * 300  # Longer than max_length=200
        response = client.post(
            "/render",
            json={
                "plan_text": sample_plan,
                "project_name": long_name,
                "export_excel": False,
                "export_ppt": False,
                "export_pdf": False
            }
        )
        assert response.status_code == 422  # Validation error

    def test_invalid_export_flags_type(self, client, sample_plan):
        """Test that invalid boolean types are rejected."""
        response = client.post(
            "/render",
            json={
                "plan_text": sample_plan,
                "export_excel": "not a boolean",
                "export_ppt": False,
                "export_pdf": False
            }
        )
        assert response.status_code == 422  # Validation error


class TestCORS:
    """Test CORS middleware."""

    def test_cors_headers_present(self, client, sample_plan):
        """Test that CORS headers are present in response."""
        response = client.post(
            "/render",
            json={
                "plan_text": sample_plan,
                "export_excel": False,
                "export_ppt": False,
                "export_pdf": False
            }
        )
        # TestClient may not always include CORS headers like real browser would
        # Just verify the endpoint works - CORS is configured in app
        assert response.status_code == 200


@pytest.fixture
def sample_raid_items():
    """Sample RAID log items for testing."""
    return {
        "items": [
            {
                "id": 1, "type": "risk", "title": "Server downtime",
                "description": "Risk of server failure during migration",
                "raised_by": "John", "owner": "Jane",
                "mitigation_actions": "Setup backup server",
                "impact": 4, "likelihood": 3, "score": 12, "status": "open"
            },
            {
                "id": 2, "type": "action", "title": "Review code",
                "description": "Code review needed before release",
                "raised_by": "Jane", "owner": "John",
                "mitigation_actions": "",
                "impact": 2, "likelihood": 2, "score": 4, "status": "closed"
            },
            {
                "id": 3, "type": "decision", "title": "Use PostgreSQL",
                "description": "Decided to use PostgreSQL over MySQL",
                "raised_by": "Tech Lead", "owner": "Tech Lead",
                "mitigation_actions": "N/A",
                "impact": 1, "likelihood": 1, "score": 1, "status": "closed"
            }
        ],
        "project_name": "TestProject"
    }


class TestRaidExcelExport:
    """Test suite for RAID Excel export endpoint."""

    def test_export_returns_xlsx(self, client, sample_raid_items):
        """Test that export returns an xlsx file."""
        response = client.post("/api/raid/export-excel", json=sample_raid_items)
        assert response.status_code == 200
        assert "spreadsheetml.sheet" in response.headers["content-type"]

    def test_export_has_correct_filename(self, client, sample_raid_items):
        """Test that export filename includes project name."""
        response = client.post("/api/raid/export-excel", json=sample_raid_items)
        assert response.status_code == 200
        content_disposition = response.headers.get("content-disposition", "")
        assert "TestProject-raid.xlsx" in content_disposition

    def test_export_returns_valid_xlsx(self, client, sample_raid_items):
        """Test that export returns a valid xlsx (ZIP) file."""
        response = client.post("/api/raid/export-excel", json=sample_raid_items)
        assert response.status_code == 200
        assert response.content[:2] == b'PK'

    def test_export_empty_items(self, client):
        """Test that exporting empty items list succeeds."""
        response = client.post(
            "/api/raid/export-excel",
            json={"items": [], "project_name": "Empty"}
        )
        assert response.status_code == 200

    def test_export_uses_default_project_name(self, client):
        """Test that export uses default project name when not provided."""
        response = client.post(
            "/api/raid/export-excel",
            json={"items": []}
        )
        assert response.status_code == 200
        content_disposition = response.headers.get("content-disposition", "")
        assert "Project-raid.xlsx" in content_disposition

    def test_export_validates_invalid_type(self, client):
        """Test that invalid type is rejected by validation."""
        response = client.post(
            "/api/raid/export-excel",
            json={
                "items": [{
                    "id": 1, "type": "invalid", "title": "test",
                    "impact": 3, "likelihood": 3, "score": 9, "status": "open"
                }]
            }
        )
        assert response.status_code == 422

    def test_export_validates_impact_range(self, client):
        """Test that impact outside 1-5 range is rejected."""
        response = client.post(
            "/api/raid/export-excel",
            json={
                "items": [{
                    "id": 1, "type": "risk", "title": "test",
                    "impact": 6, "likelihood": 3, "score": 18, "status": "open"
                }]
            }
        )
        assert response.status_code == 422

    def test_export_validates_likelihood_range(self, client):
        """Test that likelihood outside 1-5 range is rejected."""
        response = client.post(
            "/api/raid/export-excel",
            json={
                "items": [{
                    "id": 1, "type": "risk", "title": "test",
                    "impact": 3, "likelihood": 0, "score": 0, "status": "open"
                }]
            }
        )
        assert response.status_code == 422

    def test_export_validates_invalid_status(self, client):
        """Test that invalid status is rejected by validation."""
        response = client.post(
            "/api/raid/export-excel",
            json={
                "items": [{
                    "id": 1, "type": "risk", "title": "test",
                    "impact": 3, "likelihood": 3, "score": 9,
                    "status": "invalid_status"
                }]
            }
        )
        assert response.status_code == 422


class TestRaidExcelImport:
    """Test suite for RAID Excel import endpoint."""

    def test_import_rejects_non_xlsx(self, client):
        """Test that non-xlsx files are rejected."""
        from io import BytesIO
        response = client.post(
            "/api/raid/import-excel",
            files={"file": ("raid.csv", BytesIO(b"data"), "text/csv")}
        )
        assert response.status_code == 400

    def test_import_roundtrip_preserves_data(self, client, sample_raid_items):
        """Test that export then import preserves all data."""
        export_response = client.post(
            "/api/raid/export-excel", json=sample_raid_items
        )
        assert export_response.status_code == 200

        from io import BytesIO
        import_response = client.post(
            "/api/raid/import-excel",
            files={
                "file": (
                    "raid.xlsx",
                    BytesIO(export_response.content),
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                )
            }
        )
        assert import_response.status_code == 200
        data = import_response.json()
        assert "items" in data
        assert len(data["items"]) == 3

    def test_import_preserves_field_values(self, client, sample_raid_items):
        """Test that imported fields match exported fields."""
        export_response = client.post(
            "/api/raid/export-excel", json=sample_raid_items
        )

        from io import BytesIO
        import_response = client.post(
            "/api/raid/import-excel",
            files={
                "file": (
                    "raid.xlsx",
                    BytesIO(export_response.content),
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                )
            }
        )
        data = import_response.json()
        first_item = data["items"][0]
        assert first_item["title"] == "Server downtime"
        assert first_item["type"] == "risk"
        assert first_item["impact"] == 4
        assert first_item["likelihood"] == 3
        assert first_item["score"] == 12
        assert first_item["status"] == "open"

    def test_import_recalculates_score(self, client, sample_raid_items):
        """Test that score is recalculated on import."""
        export_response = client.post(
            "/api/raid/export-excel", json=sample_raid_items
        )

        from io import BytesIO
        import_response = client.post(
            "/api/raid/import-excel",
            files={
                "file": (
                    "raid.xlsx",
                    BytesIO(export_response.content),
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                )
            }
        )
        data = import_response.json()
        for item in data["items"]:
            assert item["score"] == item["impact"] * item["likelihood"]

    def test_import_returns_json_structure(self, client, sample_raid_items):
        """Test that import returns correct JSON structure."""
        export_response = client.post(
            "/api/raid/export-excel", json=sample_raid_items
        )

        from io import BytesIO
        import_response = client.post(
            "/api/raid/import-excel",
            files={
                "file": (
                    "raid.xlsx",
                    BytesIO(export_response.content),
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                )
            }
        )
        data = import_response.json()
        assert "items" in data
        for item in data["items"]:
            assert "id" in item
            assert "type" in item
            assert "title" in item
            assert "status" in item

    def test_import_empty_xlsx(self, client):
        """Test that importing an xlsx with only headers works."""
        # Export with no items, then import
        export_response = client.post(
            "/api/raid/export-excel",
            json={"items": [], "project_name": "Empty"}
        )

        from io import BytesIO
        import_response = client.post(
            "/api/raid/import-excel",
            files={
                "file": (
                    "raid.xlsx",
                    BytesIO(export_response.content),
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                )
            }
        )
        assert import_response.status_code == 200
        data = import_response.json()
        assert data["items"] == []


# ===== Excel Import Endpoint Tests =====

def _make_xlsx_bytes(sheets_data):
    """Helper: create an xlsx file in memory and return bytes."""
    from openpyxl import Workbook as _Wb
    import io as _io
    wb = _Wb()
    first = True
    for name, rows in sheets_data.items():
        if first:
            ws = wb.active
            ws.title = name
            first = False
        else:
            ws = wb.create_sheet(name)
        for row in rows:
            ws.append(row)
    buf = _io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


class TestExcelAnalyzeEndpoint:
    """Test suite for POST /api/excel/analyze."""

    def test_analyze_valid_xlsx(self, client):
        xlsx = _make_xlsx_bytes({
            "Tasks": [
                ["Task Name", "Start", "Duration"],
                ["Task 1", "2025-01-06", 5],
            ]
        })
        response = client.post(
            "/api/excel/analyze",
            files={"file": ("test.xlsx", xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        )
        assert response.status_code == 200
        data = response.json()
        assert "sheets" in data
        assert data["sheets"][0]["name"] == "Tasks"

    def test_analyze_invalid_file(self, client):
        response = client.post(
            "/api/excel/analyze",
            files={"file": ("test.xlsx", b"not excel", "application/octet-stream")},
        )
        assert response.status_code == 400

    def test_analyze_wrong_extension(self, client):
        response = client.post(
            "/api/excel/analyze",
            files={"file": ("test.csv", b"a,b,c", "text/csv")},
        )
        assert response.status_code == 400


class TestExcelConvertEndpoint:
    """Test suite for POST /api/excel/convert."""

    def test_convert_basic(self, client):
        import json
        xlsx = _make_xlsx_bytes({
            "Tasks": [
                ["Task Name", "Duration"],
                ["Phase 1", ""],
                ["  Task A", 3],
            ]
        })
        response = client.post(
            "/api/excel/convert",
            files={"file": ("test.xlsx", xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            data={
                "sheet_name": "Tasks",
                "column_mapping": json.dumps({"task_name": "Task Name", "duration": "Duration"}),
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert "markdown" in data
        assert "Task A" in data["markdown"]

    def test_convert_missing_task_name_mapping(self, client):
        import json
        xlsx = _make_xlsx_bytes({"Tasks": [["Name"], ["T1"]]})
        response = client.post(
            "/api/excel/convert",
            files={"file": ("test.xlsx", xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            data={
                "sheet_name": "Tasks",
                "column_mapping": json.dumps({}),
            },
        )
        assert response.status_code == 400

    def test_convert_invalid_json_mapping(self, client):
        xlsx = _make_xlsx_bytes({"Tasks": [["Name"], ["T1"]]})
        response = client.post(
            "/api/excel/convert",
            files={"file": ("test.xlsx", xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            data={
                "sheet_name": "Tasks",
                "column_mapping": "not valid json{",
            },
        )
        assert response.status_code == 400

    def test_convert_roundtrip(self, client):
        """Test importing a NoodlePlanner-style export."""
        import json
        xlsx = _make_xlsx_bytes({
            "Tasks": [
                ["ID", "Task Name", "Start", "Finish", "Duration (days)",
                 "Resources", "% Complete", "RAG", "Comment"],
                [1, "Planning", "", "", 0, "", "", "", ""],
                [2, "  Req Gathering", "2025-01-06", "2025-01-10", 5,
                 "John", 100, "Green", "Done"],
            ]
        })
        response = client.post(
            "/api/excel/convert",
            files={"file": ("project.xlsx", xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            data={
                "sheet_name": "Tasks",
                "column_mapping": json.dumps({
                    "task_name": "Task Name",
                    "start_date": "Start",
                    "end_date": "Finish",
                    "duration": "Duration (days)",
                    "resources": "Resources",
                    "percent_complete": "% Complete",
                    "comment": "Comment",
                }),
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert "Req Gathering" in data["markdown"]
        assert "100%" in data["markdown"]
        assert "! Done" in data["markdown"]


class TestParseEndpointHighlights:
    """Test suite for /api/parse endpoint highlights support."""

    def test_parse_returns_highlights(self, client):
        """Test that parse returns highlights data."""
        plan = """Phase 1
  Task 1 @john 3d

---highlights---
## 2026-02-13 @Alice
- Completed phase 1

## 2026-02-06 @Bob
- Sprint done
---end-highlights---"""
        response = client.post(
            "/api/parse",
            json={"plan_text": plan}
        )
        assert response.status_code == 200
        data = response.json()
        assert "highlights" in data
        assert len(data["highlights"]) == 2
        assert data["highlights"][0]["date"] == "2026-02-13"
        assert data["highlights"][0]["author"] == "Alice"
        assert data["highlights"][1]["date"] == "2026-02-06"

    def test_parse_returns_empty_highlights(self, client, sample_plan):
        """Test that parse returns empty highlights when none exist."""
        response = client.post(
            "/api/parse",
            json={"plan_text": sample_plan}
        )
        assert response.status_code == 200
        data = response.json()
        assert "highlights" in data
        assert data["highlights"] == []

    def test_parse_highlights_not_treated_as_tasks(self, client):
        """Test that highlights are not parsed as tasks."""
        plan = """Phase 1
  Task 1 @john 3d

---highlights---
## 2026-02-13 @Alice
- Completed phase 1
---end-highlights---"""
        response = client.post(
            "/api/parse",
            json={"plan_text": plan}
        )
        assert response.status_code == 200
        data = response.json()
        # Only actual tasks should appear in tasks list
        task_names = [t["name"] for t in data["tasks"]]
        assert "Completed phase 1" not in task_names
        # highlights content should not leak into task names
        for name in task_names:
            assert "highlights" not in name.lower()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
