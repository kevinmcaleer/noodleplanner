"""Regression guard for the embedded timeline's collapsible behaviour (#1268).

This file adds no product behaviour. Its whole job is to make one line of prose
on the Gantt epic -- "the timeline view should stay as a collapsible option as
it is" -- enforceable, because `.embedded-timeline-section` is the first child
of `.gantt-content` and the very next sibling is `.gantt-toolbar`, which the
sibling issues are emptying and restyling. A requirement that lives only in an
epic's bullet list is a requirement that a reflow of that block deletes without
anyone noticing.

So everything asserted here is *current* behaviour, read off the code and
confirmed against the running app:

  * the section is present and starts expanded (no `collapsed` class in
    `templates/index.html`);
  * `toggleEmbeddedTimeline(viewId)` (`views-tables.js`) is a single
    `classList.toggle('collapsed')` on the section, and on expand re-renders
    via `updateEmbeddedTimeline(viewId)` after 50ms;
  * the body and the copy-as-image button are hidden by CSS off that class
    alone (`components.css`), not by JS touching their styles;
  * the disclosure triangle's rotation is likewise pure CSS
    (`:not(.collapsed) ... .toggle-icon { transform: rotate(90deg) }`), so it
    is asserted from computed style rather than from a class name;
  * `updateAllEmbeddedTimelines()` skips a section already carrying
    `.collapsed`.

Both views that own one of these sections are covered: the Gantt view and the
Tasks view share `toggleEmbeddedTimeline()` and `updateAllEmbeddedTimelines()`,
so the parametrised tests below run against each.

Deliberately NOT asserted, and deliberately not fixed: the toggle is an
`<a class="embedded-timeline-toggle" onclick=...>` with no `href`, no
`tabindex` and no `aria-expanded`, so it is keyboard-unreachable and its state
is not announced. That is a real accessibility gap, but the epic asked for this
control to stay as it is, and it is recorded as an open question on #1268.
Pinning the current markup as *correct* would be as wrong as quietly upgrading
it, so this file simply says nothing about it.

This is a Playwright test rather than a Selenium one because the suite in
`tests/ui/` can drive it fully -- it needs a rendered plan, two clicks, and
computed styles, all of which the existing fixtures already cover.

Usage:
    uv run pytest tests/ui/test_embedded_timeline_collapse.py -q
"""

import pytest

from .helpers import open_project_view

# Both views carrying an identical `.embedded-timeline-section`.
TIMELINE_VIEWS = ["gantt", "tasks"]

PLAN = """---
title: Embedded Timeline Collapse
start: 2026-01-05
---

Phase One
  Research @sam 3d
  Build @jo 5d
Phase Two
  Ship @sam 2d
"""


def _render_plan(page):
    page.evaluate(
        """value => {
            const ed = document.getElementById('planEditor');
            ed.value = value;
            ed.dispatchEvent(new Event('input', { bubbles: true }));
        }""",
        PLAN,
    )
    page.wait_for_function(
        "() => document.querySelectorAll("
        "  '#ganttBody tr, #tasksTableBody tr, .gantt-row').length > 0"
    )


def _open_view(page, app_server, view):
    open_project_view(page, app_server)
    _render_plan(page)
    page.evaluate("view => switchToView(view)", view)
    page.wait_for_selector(f"#{view}-view .embedded-timeline-section", state="attached")


def _section(page, view):
    return page.locator(f"#{view}-view .embedded-timeline-section")


def _is_collapsed(page, view):
    return page.evaluate(
        "id => document.querySelector('#' + id + ' .embedded-timeline-section')"
        "        .classList.contains('collapsed')",
        f"{view}-view",
    )


def _display(page, view, child_selector):
    return page.evaluate(
        "args => getComputedStyle(document.querySelector("
        "  '#' + args[0] + ' .embedded-timeline-section ' + args[1])).display",
        [f"{view}-view", child_selector],
    )


def _icon_transform(page, view):
    return page.evaluate(
        "id => getComputedStyle(document.querySelector("
        "  '#' + id + ' .embedded-timeline-toggle .toggle-icon')).transform",
        f"{view}-view",
    )


def _toggle(page, view):
    """Click the disclosure control the way a user does.

    Through a real click rather than by calling `toggleEmbeddedTimeline()`, so
    that the inline `onclick` wiring in the template is part of what is pinned.
    """
    page.click(f"#{view}-view .embedded-timeline-toggle")


@pytest.mark.parametrize("view", TIMELINE_VIEWS)
class TestEmbeddedTimelineCollapse:
    def test_section_is_present_and_starts_expanded(self, page, app_server, view):
        _open_view(page, app_server, view)
        assert _section(page, view).count() == 1
        assert not _is_collapsed(page, view)
        assert _display(page, view, ".embedded-timeline-body") != "none"
        assert _display(page, view, ".embedded-timeline-copy") != "none"

    def test_section_is_first_child_of_its_content_block(self, page, app_server, view):
        """The section leads the view's content block, immediately before the
        toolbar the sibling issues are rebuilding -- which is exactly why this
        position is worth pinning."""
        _open_view(page, app_server, view)
        first_child_class = page.evaluate(
            "id => document.querySelector('#' + id + ' .embedded-timeline-section')"
            "        .parentElement.firstElementChild.className",
            f"{view}-view",
        )
        assert "embedded-timeline-section" in first_child_class

    def test_toggle_collapses_body_and_copy_button(self, page, app_server, view):
        _open_view(page, app_server, view)
        _toggle(page, view)
        page.wait_for_selector(f"#{view}-view .embedded-timeline-section.collapsed")

        assert _is_collapsed(page, view)
        assert _display(page, view, ".embedded-timeline-body") == "none"
        # Collapsing hides the copy-as-image button too -- a CSS rule that is
        # easy to lose when the header is restyled.
        assert _display(page, view, ".embedded-timeline-copy") == "none"

    def test_toggle_again_expands_and_re_renders(self, page, app_server, view):
        _open_view(page, app_server, view)
        _toggle(page, view)
        page.wait_for_selector(f"#{view}-view .embedded-timeline-section.collapsed")

        # Spy on the re-render path. `toggleEmbeddedTimeline()` reaches
        # `updateEmbeddedTimeline()` through the global, so wrapping it here
        # observes the real call without changing what it does.
        page.evaluate(
            """() => {
                window.__timelineRenders = [];
                const original = window.updateEmbeddedTimeline;
                window.updateEmbeddedTimeline = function (viewId) {
                    window.__timelineRenders.push(viewId);
                    return original.apply(this, arguments);
                };
            }"""
        )

        _toggle(page, view)
        page.wait_for_selector(
            f"#{view}-view .embedded-timeline-section.collapsed", state="detached"
        )

        assert not _is_collapsed(page, view)
        assert _display(page, view, ".embedded-timeline-body") != "none"
        assert _display(page, view, ".embedded-timeline-copy") != "none"

        # The 50ms re-render after expanding.
        page.wait_for_function(
            "id => (window.__timelineRenders || []).includes(id)",
            arg=f"{view}-view",
        )

    def test_disclosure_triangle_rotation_is_css_driven(self, page, app_server, view):
        """Expanded rotates the icon 90deg; collapsed leaves it unrotated.

        Asserted from computed style because the rule keys off
        `.embedded-timeline-section:not(.collapsed)` -- nothing sets a class or
        an inline style on the icon itself.
        """
        _open_view(page, app_server, view)
        expanded = _icon_transform(page, view)
        assert expanded == "matrix(0, 1, -1, 0, 0, 0)", (
            f"expected a 90deg rotation while expanded, got {expanded!r}"
        )

        _toggle(page, view)
        page.wait_for_selector(f"#{view}-view .embedded-timeline-section.collapsed")
        # The icon carries `transition: transform 0.2s`, so give it a moment to
        # land rather than reading mid-animation.
        page.wait_for_function(
            "id => {"
            "  const t = getComputedStyle(document.querySelector("
            "    '#' + id + ' .embedded-timeline-toggle .toggle-icon')).transform;"
            "  return t === 'none' || t === 'matrix(1, 0, 0, 1, 0, 0)';"
            "}",
            arg=f"{view}-view",
        )

    def test_update_all_skips_a_collapsed_section(self, page, app_server, view):
        """`updateAllEmbeddedTimelines()` re-renders only expanded sections."""
        _open_view(page, app_server, view)
        _toggle(page, view)
        page.wait_for_selector(f"#{view}-view .embedded-timeline-section.collapsed")

        rendered = page.evaluate(
            """() => {
                const seen = [];
                const original = window.updateEmbeddedTimeline;
                window.updateEmbeddedTimeline = function (viewId) {
                    seen.push(viewId);
                    return original.apply(this, arguments);
                };
                try {
                    updateAllEmbeddedTimelines();
                } finally {
                    window.updateEmbeddedTimeline = original;
                }
                return seen;
            }"""
        )
        assert f"{view}-view" not in rendered, (
            "a collapsed section should be skipped by updateAllEmbeddedTimelines()"
        )
        # The other view is untouched by this test and still expanded, so it
        # must still be re-rendered -- proving the skip is the class, not a
        # blanket no-op.
        other = "tasks" if view == "gantt" else "gantt"
        assert f"{other}-view" in rendered
