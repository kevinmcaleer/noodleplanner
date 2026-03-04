"""Tests for Stakeholder Interest/Influence Grid feature (#509).

Tests cover:
- HTML elements existence in the served page
- Stakeholder navigation and tab elements
- Stakeholder form elements in the detail pane
- JavaScript function declarations for stakeholder management
- CSS classes for stakeholder styling
- SVG grid container
"""

import pytest
from fastapi.testclient import TestClient

from noodle_web import app


@pytest.fixture
def client():
    """Create a test client for the FastAPI app."""
    return TestClient(app)


@pytest.fixture
def html_content(client):
    """Fetch the HTML content once for all tests."""
    response = client.get("/")
    assert response.status_code == 200
    return response.text


@pytest.fixture
def script_content(client):
    """Fetch the script.js content for JavaScript function tests."""
    response = client.get("/static/script.js")
    assert response.status_code == 200
    return response.text


@pytest.fixture
def css_content(client):
    """Fetch the style.css content for CSS tests."""
    response = client.get("/static/style.css")
    assert response.status_code == 200
    return response.text


class TestStakeholderNavigation:
    """Test that stakeholder navigation elements are present."""

    def test_stakeholder_in_plan_dropdown_menu(self, html_content):
        """Test that Stakeholders appears in the Plan dropdown menu."""
        assert "Stakeholders" in html_content

    def test_stakeholder_icon_svg_exists(self, html_content):
        """Test that the stakeholders SVG icon is defined."""
        assert 'id="icon-stakeholders"' in html_content

    def test_stakeholder_subnav_button(self, html_content):
        """Test that the stakeholders subnav button exists."""
        assert 'data-view="stakeholders"' in html_content


class TestStakeholderView:
    """Test that the stakeholder view container and elements are present."""

    def test_stakeholders_view_container(self, html_content):
        """Test that the stakeholders-view output tab content div exists."""
        assert 'id="stakeholders-view"' in html_content

    def test_stakeholders_table(self, html_content):
        """Test that the stakeholders table exists."""
        assert 'id="stakeholdersTable"' in html_content

    def test_stakeholders_table_body(self, html_content):
        """Test that the stakeholders table body exists."""
        assert 'id="stakeholdersTableBody"' in html_content

    def test_stakeholders_empty_state(self, html_content):
        """Test that the stakeholders empty state exists."""
        assert 'id="stakeholdersEmptyState"' in html_content

    def test_stakeholder_grid_svg(self, html_content):
        """Test that the SVG grid element exists."""
        assert 'id="stakeholderGrid"' in html_content

    def test_stakeholder_grid_wrapper(self, html_content):
        """Test that the grid wrapper with copy button exists."""
        assert 'id="stakeholderGridWrapper"' in html_content

    def test_add_stakeholder_button(self, html_content):
        """Test that the Add Stakeholder button exists."""
        assert "+ Add Stakeholder" in html_content

    def test_table_has_name_column(self, html_content):
        """Test that the stakeholders table has Name column."""
        assert "<th>Name</th>" in html_content

    def test_table_has_role_column(self, html_content):
        """Test that the stakeholders table has Role column."""
        assert "<th>Role</th>" in html_content

    def test_table_has_interest_column(self, html_content):
        """Test that the stakeholders table has Interest column."""
        assert "<th>Interest</th>" in html_content

    def test_table_has_influence_column(self, html_content):
        """Test that the stakeholders table has Influence column."""
        assert "<th>Influence</th>" in html_content


class TestStakeholderForm:
    """Test that the stakeholder detail pane form is present."""

    def test_stakeholder_form_section(self, html_content):
        """Test that the stakeholder form section exists in the detail pane."""
        assert 'id="stakeholderFormSection"' in html_content

    def test_stakeholder_form_title(self, html_content):
        """Test that the form title element exists."""
        assert 'id="stakeholderFormTitle"' in html_content

    def test_stakeholder_form_name_field(self, html_content):
        """Test that the name input field exists."""
        assert 'id="stakeholderItemName"' in html_content

    def test_stakeholder_form_role_field(self, html_content):
        """Test that the role input field exists."""
        assert 'id="stakeholderItemRole"' in html_content

    def test_stakeholder_form_interest_field(self, html_content):
        """Test that the interest select field exists."""
        assert 'id="stakeholderItemInterest"' in html_content

    def test_stakeholder_form_influence_field(self, html_content):
        """Test that the influence select field exists."""
        assert 'id="stakeholderItemInfluence"' in html_content

    def test_stakeholder_form_hidden_id_field(self, html_content):
        """Test that the hidden ID field exists for editing."""
        assert 'id="stakeholderItemId"' in html_content

    def test_interest_field_has_low_and_high_options(self, html_content):
        """Test that interest dropdown has Low and High options."""
        # The form should contain options for interest level
        assert 'value="low">Low</option>' in html_content
        assert 'value="high"' in html_content


class TestStakeholderJavaScript:
    """Test that required JavaScript functions and variables are declared in script.js."""

    def test_stakeholder_items_array(self, script_content):
        """Test that the stakeholderItems array is declared."""
        assert "let stakeholderItems = []" in script_content

    def test_render_stakeholder_table_function(self, script_content):
        """Test that renderStakeholderTable function is declared."""
        assert "function renderStakeholderTable()" in script_content

    def test_render_stakeholder_grid_function(self, script_content):
        """Test that renderStakeholderGrid function is declared."""
        assert "function renderStakeholderGrid()" in script_content

    def test_open_stakeholder_form_function(self, script_content):
        """Test that openStakeholderForm function is declared."""
        assert "function openStakeholderForm(" in script_content

    def test_close_stakeholder_form_function(self, script_content):
        """Test that closeStakeholderForm function is declared."""
        assert "function closeStakeholderForm()" in script_content

    def test_save_stakeholder_function(self, script_content):
        """Test that saveStakeholderFromForm function is declared."""
        assert "function saveStakeholderFromForm()" in script_content

    def test_delete_stakeholder_function(self, script_content):
        """Test that deleteStakeholder function is declared."""
        assert "function deleteStakeholder(" in script_content

    def test_parse_stakeholders_function(self, script_content):
        """Test that parseStakeholdersFromFrontMatter function is declared."""
        assert "function parseStakeholdersFromFrontMatter(" in script_content

    def test_parse_stakeholder_entry_function(self, script_content):
        """Test that parseStakeholderEntry function is declared."""
        assert "function parseStakeholderEntry(" in script_content

    def test_sync_stakeholders_function(self, script_content):
        """Test that syncStakeholdersToFrontMatter function is declared."""
        assert "function syncStakeholdersToFrontMatter()" in script_content

    def test_clear_stakeholders_function(self, script_content):
        """Test that clearStakeholders function is declared."""
        assert "function clearStakeholders()" in script_content

    def test_add_stakeholder_function(self, script_content):
        """Test that addStakeholder function is declared."""
        assert "function addStakeholder()" in script_content

    def test_load_stakeholders_from_plan_text(self, script_content):
        """Test that loadStakeholdersFromPlanText function is declared."""
        assert "function loadStakeholdersFromPlanText()" in script_content

    def test_update_front_matter_stakeholders(self, script_content):
        """Test that updateFrontMatterStakeholders function is declared."""
        assert "function updateFrontMatterStakeholders(" in script_content

    def test_generate_stakeholders_section(self, script_content):
        """Test that generateStakeholdersFrontMatterSection function is declared."""
        assert "function generateStakeholdersFrontMatterSection(" in script_content

    def test_stakeholders_in_plan_views(self, script_content):
        """Test that stakeholders is included in the PLAN_VIEWS array."""
        assert "'stakeholders'" in script_content

    def test_stakeholders_in_nav_mapping(self, script_content):
        """Test that stakeholders maps to planTab in the nav mapping."""
        assert "'stakeholders': 'planTab'" in script_content

    def test_clear_stakeholders_in_tracking_data(self, script_content):
        """Test that clearStakeholders is called in clearPlanTrackingData."""
        assert "clearStakeholders();" in script_content

    def test_stakeholders_loaded_on_plan_parse(self, script_content):
        """Test that stakeholders are loaded when plan is parsed."""
        assert "loadStakeholdersFromPlanText();" in script_content


class TestStakeholderCSS:
    """Test that required CSS classes are defined in style.css."""

    def test_stakeholders_container_class(self, css_content):
        """Test that the .stakeholders-container class is defined."""
        assert ".stakeholders-container" in css_content

    def test_stakeholders_layout_class(self, css_content):
        """Test that the .stakeholders-layout class is defined."""
        assert ".stakeholders-layout" in css_content

    def test_stakeholders_table_panel_class(self, css_content):
        """Test that the .stakeholders-table-panel class is defined."""
        assert ".stakeholders-table-panel" in css_content

    def test_stakeholders_grid_panel_class(self, css_content):
        """Test that the .stakeholders-grid-panel class is defined."""
        assert ".stakeholders-grid-panel" in css_content

    def test_stakeholder_grid_wrapper_class(self, css_content):
        """Test that the .stakeholder-grid-wrapper class is defined."""
        assert ".stakeholder-grid-wrapper" in css_content

    def test_stakeholders_table_class(self, css_content):
        """Test that the .stakeholders-table class is defined."""
        assert ".stakeholders-table" in css_content

    def test_stakeholder_level_badge_class(self, css_content):
        """Test that the .stakeholder-level-badge class is defined."""
        assert ".stakeholder-level-badge" in css_content

    def test_stakeholder_level_high_class(self, css_content):
        """Test that the .stakeholder-level-high class is defined."""
        assert ".stakeholder-level-high" in css_content

    def test_stakeholder_level_low_class(self, css_content):
        """Test that the .stakeholder-level-low class is defined."""
        assert ".stakeholder-level-low" in css_content

    def test_stakeholders_empty_state_class(self, css_content):
        """Test that the .stakeholders-empty-state class is defined."""
        assert ".stakeholders-empty-state" in css_content

    def test_responsive_layout(self, css_content):
        """Test that responsive styles exist for mobile layout."""
        assert ".stakeholders-layout" in css_content
        # The media query should change layout to column on small screens
        assert "flex-direction: column" in css_content


class TestStakeholderGridProperties:
    """Test the SVG grid element properties."""

    def test_grid_viewbox(self, html_content):
        """Test that the SVG grid has the correct viewBox for square aspect ratio."""
        assert 'viewBox="0 0 400 400"' in html_content

    def test_grid_preserve_aspect_ratio(self, html_content):
        """Test that the SVG preserves aspect ratio."""
        assert 'preserveAspectRatio="xMidYMid meet"' in html_content
