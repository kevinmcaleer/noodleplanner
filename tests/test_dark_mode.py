"""Tests for dark mode feature (Issue #595).

Tests cover:
- Theme CSS and JS are loaded in the HTML
- Theme toggle button is present and accessible
- Front matter theme key is parsed correctly
- Theme menu has correct options
- FOUC prevention script is present
"""

import re

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


class TestRibbonThemeControls:
    """Verify the theme controls in the ribbon (ribbon-ia.js/ribbon.js).

    The old nav bar's #themeToggleBtn / #themeMenu dropdown (Light/Dark/
    System) was removed in the #909 ribbon-parity follow-up: the ribbon
    (View > Window group) has a "Dark Mode" toggle plus a one-way "System
    Theme" button instead of a 3-way dropdown menu, and both are rendered
    client-side by ribbon.js rather than present in the server-rendered
    HTML -- so these check the served ribbon source, not `html`.
    """

    def test_ribbon_has_dark_mode_toggle(self, client):
        response = client.get("/static/ribbon-ia.js")
        assert response.status_code == 200
        assert "'Dark Mode'" in response.text

    def test_ribbon_has_system_theme_button(self, client):
        response = client.get("/static/ribbon-ia.js")
        assert response.status_code == 200
        assert "'System Theme'" in response.text

    def test_ribbon_wires_dark_mode_to_setThemeChoice(self, client):
        response = client.get("/static/ribbon.js")
        assert response.status_code == 200
        assert "'Dark Mode': () => setThemeChoice(" in response.text

    def test_ribbon_wires_system_theme_to_setThemeChoice_system(self, client):
        response = client.get("/static/ribbon.js")
        assert response.status_code == 200
        assert "setThemeChoice('system')" in response.text


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
    """Verify the theme tokens are defined, and defined in one place.

    These used to assert that `dark-mode.css` declared the light defaults for
    `--np-bg` and friends, which was true of the #1024 identity layer. #1192
    deleted that block: `visual-system.css` loads later and redefined 34 of
    those 50 names, so the declarations here had lost the cascade and had no
    effect while still reading as authoritative.

    So the assertion moved rather than being dropped. What matters is not which
    file declares a token -- it is that exactly one does, which is the property
    the epic exists to establish.
    """

    @staticmethod
    def _global_token_declarations(client, name):
        """Every linked stylesheet declaring *name* at :root or [data-theme=dark]."""
        index = client.get("/").text
        sheets = re.findall(r'href="/static/([^"?]+\.css)', index)
        declaring = []
        for sheet in sheets:
            css = re.sub(r"/\*.*?\*/", "", client.get(f"/static/{sheet}").text, flags=re.DOTALL)
            for match in re.finditer(r"([^{}]+)\{([^{}]*)\}", css):
                selector = match.group(1).strip()
                is_global = re.search(r"(^|,)\s*:root\s*(,|$)", selector) or re.search(
                    r'\[data-theme=["\']?dark["\']?\]\s*(,|$)', selector
                )
                if is_global and re.search(rf"{re.escape(name)}\s*:", match.group(2)):
                    declaring.append(sheet)
                    break
        return declaring

    @pytest.mark.parametrize("token", ["--np-bg", "--np-text", "--np-surface", "--np-border"])
    def test_theme_token_is_defined_exactly_once(self, client, token):
        declaring = self._global_token_declarations(client, token)
        assert declaring, f"{token} is not declared at global scope by any linked stylesheet"
        assert declaring == ["visual-system.css"], (
            f"{token} should be declared only by the canonical layer, but is declared by "
            f"{declaring}. Two global declarations of one token is the #1187 bug: which "
            "wins depends on stylesheet load order, and the loser looks authoritative."
        )

    def test_dark_mode_css_has_dark_overrides(self, client):
        response = client.get("/static/dark-mode.css")
        assert response.status_code == 200
        css = response.text
        assert '[data-theme="dark"]' in css

    def test_dark_mode_css_has_ribbon_titlebar_override(self, client):
        """The old nav bar's standalone .theme-toggle-btn/.theme-menu (with
        their own dark-mode overrides here, and a 44x44px touch target) were
        removed in the #909 ribbon-parity follow-up -- the theme controls
        (Dark Mode / System Theme) now live as ordinary, denser ribbon
        buttons (View > Window group), same as every other ribbon control,
        rather than as an isolated thumb-friendly toggle. What still needs a
        dark-mode override is the title bar they (and the search box) render
        inside of.
        """
        response = client.get("/static/dark-mode.css")
        assert response.status_code == 200
        css = response.text
        assert '[data-theme="dark"] .ribbon-titlebar' in css

    def test_focus_ring_is_tokenised_and_applied(self, client):
        """The focus indicator comes from a token, not a hardcoded hue.

        This used to assert `#108BB9` appeared in `dark-mode.css` -- the #1024
        blue. #1193 replaced five competing focus colours with one
        `--np-focus-ring`, applied once to every focusable element, so the
        assertion is now about the ring existing rather than about one file
        containing one hex.
        """
        canonical = client.get("/static/visual-system.css")
        assert canonical.status_code == 200
        css = canonical.text
        assert "--np-focus-ring:" in css, "the focus ring token is not defined"
        assert "--np-focus-ring-color:" in css
        assert ":focus-visible" in css, "nothing applies the ring"
        assert "box-shadow: var(--np-focus-ring)" in css, (
            "the ring should be applied as a box-shadow -- nine components set "
            "`outline: none` on their resting state and would swallow an "
            "outline-based ring"
        )

    def test_dark_mode_css_no_longer_hardcodes_the_superseded_accent(self, client):
        """#108BB9 is the #1024 identity that visual-system.css replaced."""
        css = client.get("/static/dark-mode.css").text
        assert "#108BB9" not in css.upper(), (
            "dark-mode.css hardcodes the superseded blue accent again; use "
            "var(--np-accent) or var(--np-blue)"
        )


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
