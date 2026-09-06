"""Regression tests for the project ribbon toolbar."""

class TestRibbonToolbar:
    """Validate the Metro-style ribbon layout and icon usage."""

    def test_template_includes_global_project_ribbon(self):
        with open(
            "packages/noodle-web/src/noodle_web/templates/index.html",
            "r",
            encoding="utf-8",
        ) as f:
            html = f.read()
        assert "{% include '_editor_toolbar.html' %}" in html
        assert html.count("{% include '_editor_toolbar.html' %}") == 1

    def test_ribbon_has_view_specific_tab_groups(self):
        with open(
            "packages/noodle-web/src/noodle_web/templates/_editor_toolbar.html",
            "r",
            encoding="utf-8",
        ) as f:
            html = f.read()
        assert 'id="projectRibbon"' in html
        assert 'class="editor-toolbar ribbon-toolbar"' in html
        assert 'data-ribbon-scope="gantt"' in html
        assert 'data-ribbon-scope="board"' in html
        assert 'data-ribbon-scope="tracking"' in html
        assert "RAID Log" in html
        assert "Comms Plan" in html
        assert 'data-view="product-flow"' in html
        assert 'role="tab"' in html
        assert 'aria-selected="true"' in html

    def test_ribbon_uses_icons_not_emojis_for_toolbar_actions(self):
        with open(
            "packages/noodle-web/src/noodle_web/templates/_editor_toolbar.html",
            "r",
            encoding="utf-8",
        ) as f:
            html = f.read()
        for removed_symbol in ["⇤", "⇥", "🔗", "🔍", "📁", "💾", "🎨"]:
            assert removed_symbol not in html
        assert "bi bi-link-45deg" in html
        assert "bi bi-upload" in html
        assert "bi bi-download" in html

    def test_navigation_script_updates_ribbon_scope(self):
        with open(
            "packages/noodle-web/src/noodle_web/static/nav.js",
            "r",
            encoding="utf-8",
        ) as f:
            js = f.read()
        assert "const RIBBON_SCOPE_VIEW_MAP" in js
        assert "function updateProjectRibbon(viewName)" in js
        assert "updateProjectRibbon(viewName);" in js
