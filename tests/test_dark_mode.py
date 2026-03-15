"""Tests for dark mode feature (Issue #595).

Tests cover:
- Theme CSS and JS are loaded in the HTML
- Theme toggle button is present and accessible
- Front matter theme key is parsed correctly
- Theme menu has correct options
- FOUC prevention script is present
"""

import pytest
from fastapi.testclient import TestClient

from noodle_web import app


@pytest.fixture
def client():
    """Create a test client for the FastAPI app."""
    return TestClient(app)


@pytest.fixture
def html(client):
    """Fetch the main page HTML once for reuse."""
    response = client.get("/")
    assert response.status_code == 200
    return response.text


class TestDarkModeAssets:
    """Verify that dark mode CSS and JS are loaded."""

    def test_dark_mode_css_loaded(self, html):
        assert "dark-mode.css" in html

    def test_theme_js_loaded(self, html):
        assert "theme.js" in html

    def test_fouc_prevention_script(self, html):
        assert "np-theme-choice" in html
        assert "data-theme" in html


class TestThemeToggleButton:
    """Verify the theme toggle button in the nav bar."""

    def test_toggle_button_present(self, html):
        assert 'id="themeToggleBtn"' in html

    def test_toggle_button_aria_label(self, html):
        assert 'aria-label="Change colour theme"' in html

    def test_toggle_button_aria_haspopup(self, html):
        assert 'aria-haspopup="true"' in html

    def test_toggle_button_aria_controls(self, html):
        assert 'aria-controls="themeMenu"' in html


class TestThemeMenu:
    """Verify the theme dropdown menu options."""

    def test_theme_menu_present(self, html):
        assert 'id="themeMenu"' in html

    def test_light_option(self, html):
        assert 'data-theme-choice="light"' in html

    def test_dark_option(self, html):
        assert 'data-theme-choice="dark"' in html

    def test_system_option(self, html):
        assert 'data-theme-choice="system"' in html

    def test_menu_role(self, html):
        assert 'role="menu"' in html
        assert 'role="menuitem"' in html

    def test_menu_keyboard_accessible(self, html):
        assert 'tabindex="-1"' in html


class TestFrontMatterThemeParsing:
    """Verify that the theme key in front matter is parsed and returned."""

    def test_theme_in_front_matter_parsed(self, client):
        plan = """---
title: Test Project
theme: dark
---
Phase 1
  Task 1 @john 3d"""
        response = client.post("/api/parse", json={
            "plan_text": plan,
            "project_name": None
        })
        assert response.status_code == 200
        data = response.json()
        assert data["front_matter"]["theme"] == "dark"

    def test_theme_light_in_front_matter(self, client):
        plan = """---
title: Test Project
theme: light
---
Phase 1
  Task 1 @john 3d"""
        response = client.post("/api/parse", json={
            "plan_text": plan,
            "project_name": None
        })
        assert response.status_code == 200
        data = response.json()
        assert data["front_matter"]["theme"] == "light"

    def test_theme_system_in_front_matter(self, client):
        plan = """---
title: Test Project
theme: system
---
Phase 1
  Task 1 @john 3d"""
        response = client.post("/api/parse", json={
            "plan_text": plan,
            "project_name": None
        })
        assert response.status_code == 200
        data = response.json()
        assert data["front_matter"]["theme"] == "system"

    def test_no_theme_in_front_matter(self, client):
        plan = """---
title: Test Project
---
Phase 1
  Task 1 @john 3d"""
        response = client.post("/api/parse", json={
            "plan_text": plan,
            "project_name": None
        })
        assert response.status_code == 200
        data = response.json()
        assert "theme" not in data["front_matter"]


class TestDarkModeCSSTokens:
    """Verify that the dark-mode.css file defines required tokens."""

    def test_dark_mode_css_has_light_tokens(self, client):
        response = client.get("/static/dark-mode.css")
        assert response.status_code == 200
        css = response.text
        assert "--np-bg:" in css
        assert "--np-text:" in css
        assert "--np-surface:" in css
        assert "--np-border:" in css

    def test_dark_mode_css_has_dark_overrides(self, client):
        response = client.get("/static/dark-mode.css")
        assert response.status_code == 200
        css = response.text
        assert '[data-theme="dark"]' in css

    def test_dark_mode_css_has_toggle_styles(self, client):
        response = client.get("/static/dark-mode.css")
        assert response.status_code == 200
        css = response.text
        assert ".theme-toggle-btn" in css
        assert ".theme-menu" in css

    def test_toggle_button_min_touch_target(self, client):
        response = client.get("/static/dark-mode.css")
        assert response.status_code == 200
        css = response.text
        assert "width: 44px" in css
        assert "height: 44px" in css

    def test_focus_visible_outline(self, client):
        response = client.get("/static/dark-mode.css")
        assert response.status_code == 200
        css = response.text
        assert "focus-visible" in css
        assert "#108BB9" in css


class TestThemeJSFile:
    """Verify the theme.js file is served and contains key functions."""

    def test_theme_js_served(self, client):
        response = client.get("/static/theme.js")
        assert response.status_code == 200
        js = response.text
        assert "function initTheme" in js
        assert "function setThemeChoice" in js
        assert "function toggleThemeMenu" in js
        assert "function applyTheme" in js
        assert "function resolveTheme" in js

    def test_theme_js_has_system_listener(self, client):
        response = client.get("/static/theme.js")
        assert response.status_code == 200
        js = response.text
        assert "prefers-color-scheme" in js

    def test_theme_js_has_front_matter_sync(self, client):
        response = client.get("/static/theme.js")
        assert response.status_code == 200
        js = response.text
        assert "function syncThemeToFrontMatter" in js
        assert "function applyThemeFromFrontMatter" in js

    def test_theme_js_has_keyboard_nav(self, client):
        response = client.get("/static/theme.js")
        assert response.status_code == 200
        js = response.text
        assert "ArrowDown" in js
        assert "ArrowUp" in js
        assert "Escape" in js
