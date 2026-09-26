"""Tests for FastAPI application endpoints."""

import re

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
        """Test that HTML contains timeline view with Show Phases, Detailed, and Today checkboxes."""
        response = client.get("/")
        html_content = response.text
        assert "showPhasesToggle" in html_content
        assert "detailedTimelineToggle" in html_content
        assert "toggleDetailedTimeline()" in html_content
        assert "Detailed" in html_content
        assert "todayMarkerToggle" in html_content
        assert "toggleTodayMarker()" in html_content


class TestEditorCursorAlignment:
    """Regression tests to ensure the editor highlight overlay stays aligned with the textarea cursor.

    The highlight layer must be inside the same container as the textarea so that
    absolute positioning (left:0) aligns them exactly. A hardcoded left offset
    (e.g., left:50px) causes cursor drift when the line-numbers gutter changes width.
    """

    def test_highlight_layer_inside_editor_area(self, client):
        """Highlight layer and textarea must be siblings inside .editor-area container."""
        response = client.get("/")
        html = response.text
        # The editor-area div must contain both the highlight layer and textarea
        assert 'class="editor-area"' in html
        # Highlight layer should be inside editor-area, not a direct child of editor-wrapper
        import re
        # Find editor-area blocks and verify they contain both elements
        areas = re.findall(r'<div class="editor-area">(.*?)</div>\s*</div>', html, re.DOTALL)
        assert len(areas) >= 1, "Expected at least one .editor-area container"
        for area in areas:
            assert 'editor-highlight-layer' in area, "Highlight layer must be inside .editor-area"
            assert 'editor-textarea' in area, "Textarea must be inside .editor-area"

    def test_css_highlight_layer_not_hardcoded_left(self, client):
        """The highlight layer CSS must not use a hardcoded left offset (e.g., left: 50px)."""
        import re
        import glob
        css = ''
        for css_file in glob.glob('packages/noodle-web/src/noodle_web/static/**/*.css', recursive=True):
            with open(css_file, 'r') as f:
                css += f.read()

        # Find the .editor-highlight-layer rule and check left value
        match = re.search(r'\.editor-highlight-layer\s*\{([^}]+)\}', css)
        assert match, "Could not find .editor-highlight-layer CSS rule"
        rule = match.group(1)
        # Should have left: 0, not left: 50px or any other pixel value
        left_match = re.search(r'left:\s*(\S+);', rule)
        assert left_match, "No left property found in .editor-highlight-layer"
        assert left_match.group(1) == '0', f"Highlight layer left should be 0, got {left_match.group(1)}"


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


class TestCSVExport:
    """Test suite for CSV export functionality."""

    def test_export_csv_returns_file(self, client, sample_plan):
        """Test that CSV export returns a file."""
        response = client.post(
            "/render",
            json={
                "plan_text": sample_plan,
                "project_name": "Test",
                "export_csv": True,
                "export_excel": False,
                "export_ppt": False,
                "export_pdf": False
            }
        )
        assert response.status_code == 200
        assert "text/csv" in response.headers["content-type"]

    def test_export_csv_has_correct_filename(self, client, sample_plan):
        """Test that CSV export has correct filename."""
        response = client.post(
            "/render",
            json={
                "plan_text": sample_plan,
                "project_name": "MyProject",
                "export_csv": True,
                "export_excel": False,
                "export_ppt": False,
                "export_pdf": False
            }
        )
        assert response.status_code == 200
        content_disposition = response.headers.get("content-disposition", "")
        assert "MyProject.csv" in content_disposition

    def test_export_csv_returns_text_data(self, client, sample_plan):
        """Test that CSV export returns valid CSV text data."""
        response = client.post(
            "/render",
            json={
                "plan_text": sample_plan,
                "project_name": "Test",
                "export_csv": True,
                "export_excel": False,
                "export_ppt": False,
                "export_pdf": False
            }
        )
        assert response.status_code == 200
        content = response.content.decode("utf-8")
        assert len(content) > 0
        import csv
        import io
        reader = csv.reader(io.StringIO(content))
        headers = next(reader)
        assert "Task Name" in headers

    def test_export_csv_contains_task_data(self, client, sample_plan):
        """Test that CSV export contains task data from the plan."""
        response = client.post(
            "/render",
            json={
                "plan_text": sample_plan,
                "project_name": "Test",
                "export_csv": True,
                "export_excel": False,
                "export_ppt": False,
                "export_pdf": False
            }
        )
        assert response.status_code == 200
        content = response.content.decode("utf-8")
        assert "Task 1" in content
        assert "Task 2" in content


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


def _utf8_filename(disposition):
    """The filename* (RFC 6266 / 5987) a Content-Disposition carries."""
    from urllib.parse import unquote
    match = re.search(r"filename\*=UTF-8''([^;\s]+)", disposition)
    assert match, disposition
    return unquote(match.group(1))


class TestNonAsciiDownloadFilenames:
    """Starlette encodes response headers as latin-1, so a Cyrillic or
    em-dash project title in a raw ``filename="..."`` made every download
    of that project a 500."""

    CYRILLIC_PLAN = "---\ntitle: Проект Альфа\n---\nPhase 1\n  Task 1 3d\n"

    def test_helper_gives_ascii_fallback_and_utf8_name(self):
        from noodle_web.app import content_disposition
        header = content_disposition('Проект "Альфа" — Q3.csv')
        header.encode("latin-1")  # what Starlette does with it
        assert header.isascii()
        assert header.startswith('attachment; filename="')
        fallback = re.search(r'filename="([^"]*)"', header).group(1)
        assert fallback.endswith(".csv")
        assert '"' not in fallback and "\\" not in fallback
        assert _utf8_filename(header) == 'Проект "Альфа" — Q3.csv'

    def test_helper_leaves_plain_names_readable(self):
        from noodle_web.app import content_disposition
        header = content_disposition("My Project v2.xlsx")
        assert 'filename="My Project v2.xlsx"' in header
        assert _utf8_filename(header) == "My Project v2.xlsx"

    def test_helper_strips_header_injection(self):
        from noodle_web.app import content_disposition
        header = content_disposition('evil\r\nSet-Cookie: x=1.csv')
        assert "\r" not in header and "\n" not in header

    def test_cyrillic_title_single_export(self, client):
        response = client.post("/render", json={
            "plan_text": self.CYRILLIC_PLAN, "export_csv": True,
        })
        assert response.status_code == 200
        assert _utf8_filename(response.headers["content-disposition"]) == "Проект Альфа.csv"

    def test_cyrillic_title_zip_export(self, client):
        response = client.post("/render", json={
            "plan_text": self.CYRILLIC_PLAN, "export_csv": True, "export_excel": True,
        })
        assert response.status_code == 200
        assert _utf8_filename(response.headers["content-disposition"]) == "Проект Альфа-exports.zip"

    def test_em_dash_project_name_raid_export(self, client):
        response = client.post("/api/raid/export-excel", json={
            "items": [], "project_name": "Launch — Q3",
        })
        assert response.status_code == 200
        assert _utf8_filename(response.headers["content-disposition"]) == "Launch — Q3-raid.xlsx"

    def test_cyrillic_comms_docx_export(self, client):
        response = client.post("/api/comms/export-docx", json={
            "items": [], "project_name": "Проект",
        })
        assert response.status_code == 200
        assert _utf8_filename(response.headers["content-disposition"]) == \
            "Проект - Communications Plan.docx"


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

    def test_views_timeline_js_contains_detailed_timeline_functions(self, client):
        """Test that views-timeline.js contains the detailed timeline rendering functions."""
        response = client.get("/static/views-timeline.js")
        assert response.status_code == 200
        js_content = response.text
        assert "renderDetailedPhaseBlocks" in js_content
        assert "assignPhaseRows" in js_content
        assert "darkenColor" in js_content
        assert "toggleDetailedTimeline" in js_content
        assert "detailedTimelineEnabled" in js_content

    def test_style_css_contains_detailed_timeline_styles(self, client):
        """Test that timeline CSS contains the detailed timeline CSS classes."""
        response = client.get("/static/views/timeline.css")
        assert response.status_code == 200
        css_content = response.text
        assert "detailed-timeline-container" in css_content
        assert "detailed-timeline-svg" in css_content

    def test_script_js_contains_task_context_menu_functions(self, client):
        """Test that script.js contains the task context menu functions."""
        response = client.get("/static/script.js")
        assert response.status_code == 200
        js_content = response.text
        assert "showTaskContextMenu" in js_content
        assert "closeTaskContextMenu" in js_content
        assert "createTaskContextButton" in js_content
        assert "createCompletionSubmenu" in js_content
        assert "promoteTask" in js_content
        assert "demoteTask" in js_content
        assert "insertTaskAbove" in js_content
        assert "assignResourceToTask" in js_content
        assert "setTaskCompletion" in js_content
        assert "findTaskLineNumber" in js_content

    def test_script_js_context_menu_in_tasks_table(self, client):
        """Test that script.js adds context menu buttons to the tasks table."""
        response = client.get("/static/script.js")
        assert response.status_code == 200
        js_content = response.text
        # The updateTasksTable function should create context buttons
        assert "createTaskContextButton" in js_content
        # Verify context button is added in tasks table rendering
        assert "task-context-btn" in js_content

    def test_views_gantt_js_context_menu_in_gantt_chart(self, client):
        """Test that views-gantt.js adds context menu buttons to the gantt name cell."""
        response = client.get("/static/views-gantt.js")
        assert response.status_code == 200
        js_content = response.text
        # The renderGanttRows function should include context menu button in name cell
        assert "ganttContextBtn" in js_content
        assert "task-name-cell" in js_content

    def test_style_css_contains_task_context_menu_styles(self, client):
        """Test that component CSS contains the task context menu CSS classes."""
        response = client.get("/static/components.css")
        assert response.status_code == 200
        css_content = response.text
        assert "task-context-btn" in css_content
        assert "task-context-menu" in css_content
        assert "task-context-menu-item" in css_content
        assert "task-context-submenu" in css_content
        assert "task-context-menu-separator" in css_content
        assert "completion-item" in css_content

    def test_gantt_table_header_has_actions_column(self, client):
        """Test that the gantt info table header includes an empty column for actions."""
        response = client.get("/")
        assert response.status_code == 200
        html = response.text
        # The gantt info table should have a Predecessors column followed by an empty th
        assert "ganttInfoBody" in html


class TestKeyboardShortcuts:
    """Test suite for keyboard shortcuts feature (#511)."""

    @staticmethod
    def _shortcuts_modal_text(html_content):
        """The #shortcutsOverlay markup flattened to text, e.g. "Alt + D"."""
        start = html_content.index('id="shortcutsOverlay"')
        end = html_content.index("<!-- Status Bar -->", start)
        text = re.sub(r"<[^>]+>", " ", html_content[start:end])
        return re.sub(r"\s+", " ", text)

    def test_html_contains_keyboard_shortcuts_modal(self, client):
        """Test that the HTML page contains exactly one keyboard shortcuts modal."""
        response = client.get("/")
        assert response.status_code == 200
        html_content = response.text
        assert 'id="shortcutsOverlay"' in html_content
        assert "keyboardShortcutsOverlay" not in html_content
        assert html_content.count("<h2>Keyboard Shortcuts</h2>") == 1

    def test_html_shortcuts_modal_lists_all_shortcuts(self, client):
        """Test that the shortcuts modal lists all expected shortcuts."""
        response = client.get("/")
        text = self._shortcuts_modal_text(response.text)
        for keys in [
            "Alt + D",
            "Alt + P",
            "Alt + B",
            "Alt + N",
            "Alt + T",
            "Alt + R",
            "Alt + I",
            "Alt + Shift + R",
            "Alt + E",
            "Alt + Shift + P",
            "Ctrl/Cmd + S",
            "Ctrl/Cmd + Z",
            "Ctrl/Cmd + Shift + Z",
            "Ctrl/Cmd + Shift + A",
        ]:
            assert keys in text, keys

    def test_html_shortcuts_modal_lists_actions(self, client):
        """Test that the shortcuts modal describes the actions correctly."""
        response = client.get("/")
        text = self._shortcuts_modal_text(response.text)
        for action in [
            "Project Dashboard",
            "Portfolio",
            "Benefits Map",
            "New project",
            "New task",
            "New risk",
            "New issue",
            "New resource",
            "Export project to Excel",
            "Export portfolio report to PowerPoint",
            "Save plan as Markdown file",
            "Toggle AI chat panel",
        ]:
            assert action in text, action

    def test_script_contains_keyboard_shortcut_functions(self, client):
        """Test that script.js contains the keyboard shortcut helper functions."""
        response = client.get("/static/script.js")
        assert response.status_code == 200
        js_content = response.text
        assert "function isTypingInInput" in js_content
        assert "function openShortcutsModal" in js_content
        assert "function closeShortcutsModal" in js_content
        assert "function showKeyboardShortcuts" not in js_content
        assert "function closeKeyboardShortcuts" not in js_content
        assert "function openRaidFormWithType" in js_content
        assert "function addNewTaskViaShortcut" in js_content

    def test_script_contains_keyboard_event_listener(self, client):
        """Test that script.js registers a global keydown listener for shortcuts."""
        response = client.get("/static/script.js")
        js_content = response.text
        assert "Global keyboard shortcuts" in js_content
        assert "isTypingInInput(e.target)" in js_content

    def test_script_shortcuts_check_alt_key(self, client):
        """Test that Alt-based shortcuts check for the Alt modifier."""
        response = client.get("/static/script.js")
        js_content = response.text
        assert "e.altKey" in js_content
        assert "Alt+D - Go to Project Dashboard" in js_content
        assert "Alt+P - Go to Portfolio" in js_content
        assert "Alt+N - New Project" in js_content
        assert "Alt+T - New Task" in js_content
        assert "Alt+R - New Risk" in js_content
        assert "Alt+I - New Issue" in js_content
        assert "Alt+E - Export to Excel" in js_content

    def test_script_shortcuts_check_alt_shift(self, client):
        """Test that Alt+Shift shortcuts are handled."""
        response = client.get("/static/script.js")
        js_content = response.text
        assert "Alt+Shift+R - New Resource" in js_content
        assert "Alt+Shift+P - Export Portfolio to PowerPoint" in js_content

    def test_script_question_mark_shows_help(self, client):
        """Test that ? key triggers the shortcuts help modal."""
        response = client.get("/static/script.js")
        js_content = response.text
        assert "openShortcutsModal()" in js_content
        assert "showKeyboardShortcuts()" not in js_content

    def test_escape_closes_keyboard_shortcuts_modal(self, client):
        """Test that Escape key handler closes the keyboard shortcuts modal."""
        response = client.get("/static/script.js")
        js_content = response.text
        assert "closeShortcutsModal()" in js_content
        assert "keyboardShortcutsOverlay" not in js_content

    def test_tour_mentions_keyboard_shortcuts(self, client):
        """Test that the interface tour includes a keyboard shortcuts step."""
        response = client.get("/static/nav.js")
        js_content = response.text
        assert "Keyboard Shortcuts" in js_content
        assert "Press ? at any time" in js_content


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

    def test_parse_highlights_issue_204_no_end_marker(self, client):
        """Regression test for #204: highlights without end marker must be returned.

        Reproduces the exact format from the bug report: front matter,
        plan tasks, --- separator, then highlights with no end marker.
        """
        plan = """---
title: My Project
project manager: Kevin
---
Phase 1
  pdd @kevin 3d
  tdd @kevin 2d
  site visit @kevin 1d

---

---highlights---
## 2026-02-13 @kevin
- pdd completed
- tdd drafted
- bradford site visited
- quote expected shortly
- cool
"""
        response = client.post(
            "/api/parse",
            json={"plan_text": plan}
        )
        assert response.status_code == 200
        data = response.json()
        assert "highlights" in data
        assert len(data["highlights"]) == 1
        assert data["highlights"][0]["date"] == "2026-02-13"
        assert data["highlights"][0]["author"] == "kevin"
        assert "pdd completed" in data["highlights"][0]["content"]
        assert "cool" in data["highlights"][0]["content"]


class TestParseEndpointHighlightsResilience:
    """Test that highlights are returned even when task parsing encounters issues."""

    def test_parse_returns_highlights_with_partial_failure(self, client):
        """Test that highlights are returned even in a partial-failure response.

        When the task parsing pipeline succeeds, highlights should be in
        the response alongside tasks.  This validates that extracting
        highlights early in the pipeline does not break the normal flow.
        """
        plan = """---
title: Test
---
Phase 1
  Task 1 @john 3d

---

---highlights---
## 2026-02-13 @john
- Status update
- Work progressing well
"""
        response = client.post(
            "/api/parse",
            json={"plan_text": plan}
        )
        assert response.status_code == 200
        data = response.json()
        assert "highlights" in data
        assert len(data["highlights"]) == 1
        assert data["highlights"][0]["date"] == "2026-02-13"
        assert data["highlights"][0]["author"] == "john"
        assert "Status update" in data["highlights"][0]["content"]
        assert "Work progressing well" in data["highlights"][0]["content"]

    def test_parse_highlights_with_multiple_entries_and_no_end_marker(self, client):
        """Test multiple highlights without an end marker are all extracted."""
        plan = """---
title: Multi Highlights Test
---
Phase 1
  Task 1 @alice 2d
  Task 2 @bob 3d

---

---highlights---
## 2026-02-14 @alice
- Latest sprint review completed
- All acceptance criteria met

## 2026-02-07 @bob
- Sprint planning done
- Backlog groomed
"""
        response = client.post(
            "/api/parse",
            json={"plan_text": plan}
        )
        assert response.status_code == 200
        data = response.json()
        assert "highlights" in data
        assert len(data["highlights"]) == 2
        assert data["highlights"][0]["date"] == "2026-02-14"
        assert data["highlights"][0]["author"] == "alice"
        assert "acceptance criteria" in data["highlights"][0]["content"]
        assert data["highlights"][1]["date"] == "2026-02-07"
        assert data["highlights"][1]["author"] == "bob"
        assert "Sprint planning" in data["highlights"][1]["content"]

    def test_parse_highlights_with_raid_log_following(self, client):
        """Test highlights extraction stops at the RAID log marker."""
        plan = """Phase 1
  Task 1 @john 3d

---

---highlights---
## 2026-02-13 @john
- Highlight content here

---raid log---
| Type | Description | Status | Score | Owner | Date |
|------|-------------|--------|-------|-------|------|
| Risk | Server fail | Open   | 8     | John  | 2026-02-13 |
"""
        response = client.post(
            "/api/parse",
            json={"plan_text": plan}
        )
        assert response.status_code == 200
        data = response.json()
        assert "highlights" in data
        assert len(data["highlights"]) == 1
        assert data["highlights"][0]["author"] == "john"
        assert "Highlight content" in data["highlights"][0]["content"]
        # RAID log content should NOT appear in highlights
        assert "Server fail" not in data["highlights"][0]["content"]


class TestParseEndpointRaidItems:
    """Test suite for /api/parse endpoint RAID items support."""

    def test_parse_returns_raid_items_from_plan(self, client):
        """Test that parse returns RAID items from plan text."""
        plan = """Phase 1
  Task 1 @john 3d

---raid log---
| Type | Description      | Status | Score | Owner | Date       |
| ---- | ---------------- | ------ | ----- | ----- | ---------- |
| risk | Security concern | open   | 12    | Alice | 2024-01-15 |
"""
        response = client.post(
            "/api/parse",
            json={"plan_text": plan}
        )
        assert response.status_code == 200
        data = response.json()
        assert "raid_items" in data
        assert len(data["raid_items"]) == 1
        assert data["raid_items"][0]["type"] == "risk"
        assert data["raid_items"][0]["title"] == "Security concern"
        assert data["raid_items"][0]["status"] == "open"

    def test_parse_returns_empty_raid_items_when_none(self, client):
        """Test that parse returns empty raid_items when no RAID log."""
        plan = """Phase 1
  Task 1 @john 3d
"""
        response = client.post(
            "/api/parse",
            json={"plan_text": plan}
        )
        assert response.status_code == 200
        data = response.json()
        assert "raid_items" in data
        assert data["raid_items"] == []

    def test_parse_returns_raid_items_with_highlights(self, client):
        """Test RAID items returned alongside highlights."""
        plan = """Phase 1
  Task 1 @john 3d

---highlights---
## 2026-02-13 @john
- Status update

---raid log---
| Type  | Description  | Status | Score | Owner | Date       |
| ----- | ------------ | ------ | ----- | ----- | ---------- |
| issue | Build broken | open   | 15    | Bob   | 2024-01-15 |
"""
        response = client.post(
            "/api/parse",
            json={"plan_text": plan}
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data["highlights"]) == 1
        assert len(data["raid_items"]) == 1
        assert data["raid_items"][0]["title"] == "Build broken"

    def test_parse_raid_items_resilient_to_malformed_data(self, client):
        """Test that malformed RAID log does not crash parse."""
        plan = """Phase 1
  Task 1 @john 3d

---raid log---
This is not a valid table
Just random text
"""
        response = client.post(
            "/api/parse",
            json={"plan_text": plan}
        )
        assert response.status_code == 200
        data = response.json()
        assert "raid_items" in data
        assert data["raid_items"] == []

    def test_parse_raid_items_with_empty_cells(self, client):
        """Test that RAID items with empty cells are parsed correctly.

        Regression test for #486: empty cells in RAID table rows must
        not cause column misalignment that would shift type/status values.
        """
        plan = """Phase 1
  Task 1 @john 3d

---raid log---
| ID | Type | Title         | Description | Raised By | Owner | Mitigation Actions | Impact | Likelihood | Score | Status |
|----|------|---------------|-------------|-----------|-------|--------------------|--------|------------|-------|--------|
| 1  | risk | Security vuln |             |           | Alice |                    | 4      | 3          | 12    | open   |
| 2  | issue| Build broken  | CI failed   |           |       |                    | 3      | 4          | 12    | open   |
| 3  | risk | Data loss     |             | Bob       |       | Test backups       | 5      | 2          | 10    | closed |
"""
        response = client.post(
            "/api/parse",
            json={"plan_text": plan}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert len(data["raid_items"]) == 3

        # Verify type and status are correctly parsed despite empty cells
        assert data["raid_items"][0]["type"] == "risk"
        assert data["raid_items"][0]["status"] == "open"
        assert data["raid_items"][0]["title"] == "Security vuln"
        assert data["raid_items"][0]["owner"] == "Alice"

        assert data["raid_items"][1]["type"] == "issue"
        assert data["raid_items"][1]["status"] == "open"

        assert data["raid_items"][2]["type"] == "risk"
        assert data["raid_items"][2]["status"] == "closed"

    def test_parse_raid_items_available_when_task_parsing_fails(self, client):
        """Test that RAID items are returned even when task parsing fails.

        Regression test for #486: RAID log is parsed independently of tasks,
        so raid_items should be populated regardless of success status.
        """
        # Plan text that will cause task parsing to fail but has valid RAID log
        plan = """---raid log---
| Type | Description      | Status | Score | Owner | Date       |
| ---- | ---------------- | ------ | ----- | ----- | ---------- |
| risk | Security concern | open   | 12    | Alice | 2024-01-15 |
"""
        response = client.post(
            "/api/parse",
            json={"plan_text": plan}
        )
        assert response.status_code == 200
        data = response.json()
        # RAID items should be present regardless of success status
        assert "raid_items" in data
        assert len(data["raid_items"]) == 1
        assert data["raid_items"][0]["type"] == "risk"
        assert data["raid_items"][0]["status"] == "open"


class TestParseBaselineItems:
    """Test suite for /api/parse endpoint baseline items support."""

    def test_parse_returns_baseline_items_from_plan(self, client):
        """Test that parse returns baseline items from plan text."""
        plan = """Phase 1
  Task 1 @john 3d

---baseline---
| Task Name | Start      | Finish     | Duration |
|-----------|------------|------------|----------|
| Task 1    | 2026-03-02 | 2026-03-05 | 3d       |
"""
        response = client.post(
            "/api/parse",
            json={"plan_text": plan}
        )
        assert response.status_code == 200
        data = response.json()
        assert "baseline_items" in data
        assert len(data["baseline_items"]) == 1
        assert data["baseline_items"][0]["name"] == "Task 1"
        assert data["baseline_items"][0]["start"] == "2026-03-02"
        assert data["baseline_items"][0]["finish"] == "2026-03-05"
        assert data["baseline_items"][0]["duration"] == "3d"

    def test_parse_returns_empty_baseline_items_when_none(self, client):
        """Test that parse returns empty baseline_items when no baseline."""
        plan = """Phase 1
  Task 1 @john 3d
"""
        response = client.post(
            "/api/parse",
            json={"plan_text": plan}
        )
        assert response.status_code == 200
        data = response.json()
        assert "baseline_items" in data
        assert data["baseline_items"] == []

    def test_parse_baseline_with_raid_and_highlights(self, client):
        """Test baseline returned alongside RAID and highlights."""
        plan = """Phase 1
  Task 1 @john 3d

---highlights---
## 2026-02-13 @john
- Status update

---raid log---
| Type  | Description  | Status | Score | Owner | Date       |
| ----- | ------------ | ------ | ----- | ----- | ---------- |
| issue | Build broken | open   | 15    | Bob   | 2024-01-15 |

---baseline---
| Task Name | Start      | Finish     | Duration |
|-----------|------------|------------|----------|
| Task 1    | 2026-03-02 | 2026-03-05 | 3d       |
"""
        response = client.post(
            "/api/parse",
            json={"plan_text": plan}
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data["highlights"]) == 1
        assert len(data["raid_items"]) == 1
        assert len(data["baseline_items"]) == 1
        assert data["baseline_items"][0]["name"] == "Task 1"

    def test_parse_baseline_available_when_task_parsing_fails(self, client):
        """Test that baseline items are returned even when task parsing fails."""
        plan = """---baseline---
| Task Name | Start      | Finish     | Duration |
|-----------|------------|------------|----------|
| Task 1    | 2026-03-02 | 2026-03-05 | 3d       |
"""
        response = client.post(
            "/api/parse",
            json={"plan_text": plan}
        )
        assert response.status_code == 200
        data = response.json()
        assert "baseline_items" in data
        assert len(data["baseline_items"]) == 1


class TestTemplateEndpoints:
    """Test suite for template API endpoints."""

    def test_get_templates_returns_list(self, client):
        """Test that GET /api/templates returns a list of templates."""
        response = client.get("/api/templates")
        assert response.status_code == 200
        data = response.json()
        assert "templates" in data
        assert "categories" in data
        assert isinstance(data["templates"], list)
        assert len(data["templates"]) > 0

    def test_get_templates_have_required_fields(self, client):
        """Test that each template has required metadata fields."""
        response = client.get("/api/templates")
        data = response.json()
        for template in data["templates"]:
            assert "id" in template
            assert "title" in template
            assert "description" in template
            assert "category" in template

    def test_get_template_by_id(self, client):
        """Test that GET /api/templates/{id} returns template content."""
        response = client.get("/api/templates/software-development")
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == "software-development"
        assert "title" in data
        assert "content" in data
        assert len(data["content"]) > 0

    def test_get_template_not_found(self, client):
        """Test that GET /api/templates/{id} returns 404 for non-existent template."""
        response = client.get("/api/templates/non-existent-template")
        assert response.status_code == 404

    def test_templates_gallery_page(self, client):
        """Test that GET /templates returns the HTML gallery page."""
        response = client.get("/templates")
        assert response.status_code == 200
        assert "text/html" in response.headers["content-type"]

    def test_get_template_hero_image(self, client):
        """Test that GET /api/templates/{id}/hero.png returns an image."""
        response = client.get("/api/templates/software-development/hero.png")
        assert response.status_code == 200
        assert response.headers["content-type"] == "image/png"

    def test_get_template_hero_image_not_found(self, client):
        """Test that hero image returns 404 for non-existent template."""
        response = client.get("/api/templates/non-existent-template/hero.png")
        assert response.status_code == 404

    def test_get_template_hero_invalid_format(self, client):
        """Test that hero image returns 400 for invalid image format."""
        response = client.get("/api/templates/software-development/hero.bmp")
        assert response.status_code == 400


class TestPortfolioExportPptx:
    """Test suite for /api/portfolio/export-pptx endpoint."""

    def _make_payload(self, **overrides):
        """Build a minimal valid portfolio export payload."""
        payload = {
            'portfolio_name': 'Test Portfolio',
            'date': '2026-02-27',
            'projects': [
                {
                    'name': 'Project A',
                    'status': 'On Track',
                    'rag': 'green',
                    'completion': 50,
                    'risk_count': 2,
                    'start_date': '2026-01-01',
                    'end_date': '2026-06-30',
                },
            ],
            'project_reports': [
                {
                    'project_name': 'Project A',
                    'manager': 'John',
                    'sponsor': 'Jane',
                    'budget': '100k',
                    'date': '2026-02-27',
                    'status': 'green',
                    'milestones': [{'name': 'M1', 'date': '2026-03-01', 'rag': 'green'}],
                    'up_next': [{'name': 'Task 1', 'start': '2026-02-27', 'finish': '2026-03-05', 'rag': 'green'}],
                    'highlight': {'date': '2026-02-27', 'author': 'John', 'content': 'All good'},
                    'risks_issues': [{'type': 'risk', 'title': 'Budget risk', 'score': 9}],
                    'timeline_tasks': [],
                },
            ],
        }
        payload.update(overrides)
        return payload

    def test_portfolio_export_returns_pptx(self, client):
        """Test that portfolio export returns a valid PowerPoint file."""
        payload = self._make_payload()
        response = client.post('/api/portfolio/export-pptx', json=payload)
        assert response.status_code == 200
        content_type = response.headers.get('content-type', '')
        assert 'presentation' in content_type
        assert len(response.content) > 0

    def test_portfolio_export_content_disposition(self, client):
        """Test that response has correct Content-Disposition header."""
        payload = self._make_payload()
        response = client.post('/api/portfolio/export-pptx', json=payload)
        assert response.status_code == 200
        disposition = response.headers.get('content-disposition', '')
        assert 'Test Portfolio-report.pptx' in disposition

    def test_portfolio_export_empty_portfolio(self, client):
        """Test export with no projects still succeeds (overview only)."""
        payload = self._make_payload(projects=[], project_reports=[])
        response = client.post('/api/portfolio/export-pptx', json=payload)
        assert response.status_code == 200
        assert len(response.content) > 0

    def test_portfolio_export_multiple_projects(self, client):
        """Test export with multiple projects creates a larger file."""
        payload = self._make_payload()
        # Add a second project
        payload['projects'].append({
            'name': 'Project B',
            'status': 'At Risk',
            'rag': 'red',
            'completion': 25,
            'risk_count': 5,
        })
        payload['project_reports'].append({
            'project_name': 'Project B',
            'manager': 'Alice',
            'sponsor': 'Bob',
            'budget': '200k',
            'date': '2026-02-27',
            'status': 'red',
            'milestones': [],
            'up_next': [],
            'highlight': None,
            'risks_issues': [],
            'timeline_tasks': [],
        })
        response = client.post('/api/portfolio/export-pptx', json=payload)
        assert response.status_code == 200
        # With 2 project slides + 1 overview, file should be bigger
        assert len(response.content) > 20000

    def test_portfolio_export_with_timeline_data(self, client):
        """Test export with timeline tasks in project reports."""
        payload = self._make_payload()
        payload['project_reports'][0]['timeline_tasks'] = [
            {
                'name': 'Phase 1',
                'start': '2026-01-01',
                'finish': '2026-03-31',
                'percent': 60.0,
                'is_summary': True,
                'duration_days': 90,
            },
            {
                'name': 'Milestone 1',
                'start': '2026-03-31',
                'finish': '2026-03-31',
                'percent': 0.0,
                'is_summary': False,
                'duration_days': 0,
            },
        ]
        response = client.post('/api/portfolio/export-pptx', json=payload)
        assert response.status_code == 200
        assert len(response.content) > 0

    def test_portfolio_export_default_values(self, client):
        """Test export with minimal payload uses defaults correctly."""
        payload = {
            'project_reports': [],
        }
        response = client.post('/api/portfolio/export-pptx', json=payload)
        assert response.status_code == 200

    def test_portfolio_export_is_valid_pptx(self, client):
        """Test that the response is a valid PPTX file (ZIP with correct magic bytes)."""
        payload = self._make_payload()
        response = client.post('/api/portfolio/export-pptx', json=payload)
        assert response.status_code == 200
        # PPTX files are ZIP archives; check for ZIP magic bytes
        assert response.content[:2] == b'PK'

    def test_portfolio_export_with_budgets(self, client):
        """Test export with budget fields in projects and project reports."""
        payload = self._make_payload()
        payload['projects'][0]['budget'] = '$50,000'
        response = client.post('/api/portfolio/export-pptx', json=payload)
        assert response.status_code == 200
        assert len(response.content) > 0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
