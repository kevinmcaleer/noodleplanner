"""Mind map geometry: the virtual root must carry real layout numbers.

``mindmapBuildTree()`` builds a *virtual* root to hang top-level tasks from,
and that object used to be declared without the ``x``/``y``/``width``/
``height``/``subtreeHeight`` fields every real node gets a few lines below it.
``mindmapMeasure()`` sets ``width`` but never ``height``, so the virtual root
reached the renderer with ``height === undefined``:
``Math.max(node.height, totalChildrenHeight)`` returned NaN, and every
``node.y - node.height / 2`` wrote ``NaN`` -- or a literal ``"undefined"`` --
into the SVG. Chrome reported ~16 ``SEVERE`` console entries per render.

What made it survive so long is the promotion branch at the end of
``mindmapBuildTree()``: with exactly *one* top-level task that single child is
promoted to root, and it brings its own ``height``. Only a plan with two or
more top-level tasks ever reaches the virtual root -- so both shapes are
asserted here, and the one-phase case is not redundant padding, it is the
reason the two-phase case was not noticed.

This is deliberately not left to the usability suite's console-error check.
That helper skips ``source == "rendering"`` entries, which is exactly the
category these errors arrive in, so it would no longer fail if the fields were
dropped again. Asserting the geometry directly also says what is wrong rather
than printing sixteen attribute-parse errors.

Usage:
    uv run pytest tests/ui/test_mindmap.py -q
"""

import pytest

from .helpers import open_project_view, set_editor_value

ONE_TOP_LEVEL = "Phase One\n  Task A 2d\n  Task B 2d\n"
TWO_TOP_LEVEL = "Phase One\n  Task A 2d\nPhase Two\n  Task B 2d\n"


def _render_mindmap(page, app_server, plan_text):
    open_project_view(page, app_server)
    set_editor_value(page, plan_text)
    page.evaluate("switchToView('mindmap')")
    page.wait_for_selector("#mindmap-view svg", state="attached")
    # The nodes are drawn from the tree, so wait for the tree rather than for
    # a fixed delay -- and for at least one <rect>, which is what carries the
    # geometry under test.
    page.wait_for_function(
        "() => typeof mindmapTree !== 'undefined' && mindmapTree"
        "      && document.querySelectorAll('#mindmap-view svg rect').length > 0"
    )


def _non_finite_nodes(page):
    """Every node in the rendered tree whose geometry is not a real number."""
    return page.evaluate(
        """() => {
            const bad = [];
            (function walk(node) {
                if (!node) return;
                for (const field of ['x', 'y', 'width', 'height', 'subtreeHeight']) {
                    if (!Number.isFinite(node[field])) {
                        bad.push({
                            name: node.name || '(virtual root)',
                            field: field,
                            value: String(node[field]),
                        });
                    }
                }
                (node.children || []).forEach(walk);
            })(mindmapTree);
            return bad;
        }"""
    )


def _unparseable_svg_attributes(page):
    """Rendered SVG attributes holding 'NaN' or 'undefined'."""
    return page.evaluate(
        """() => Array.from(document.querySelectorAll('#mindmap-view svg *'))
            .flatMap(el => Array.from(el.attributes)
                .filter(attr => /NaN|undefined/.test(attr.value))
                .map(attr => el.tagName + '.' + attr.name + ' = ' + attr.value))"""
    )


@pytest.mark.parametrize(
    "label, plan",
    [
        # Promoted root: the single top-level task becomes the root and brings
        # its own height. This path never broke.
        ("one top-level task", ONE_TOP_LEVEL),
        # Virtual root: two top-level tasks, so the synthesised root is the one
        # that gets measured, laid out and drawn. This is the regression.
        ("two top-level tasks", TWO_TOP_LEVEL),
    ],
)
def test_every_node_has_finite_geometry(page, app_server, label, plan):
    _render_mindmap(page, app_server, plan)

    bad = _non_finite_nodes(page)
    assert bad == [], f"{label}: nodes with non-finite geometry: {bad}"


@pytest.mark.parametrize(
    "label, plan",
    [
        ("one top-level task", ONE_TOP_LEVEL),
        ("two top-level tasks", TWO_TOP_LEVEL),
    ],
)
def test_rendered_svg_has_no_unparseable_attributes(page, app_server, label, plan):
    """The browser's own view of it: no attribute the SVG parser rejects.

    The node-geometry test above is the precise one; this is the check that
    the geometry actually reaches the DOM intact, and it is what a user would
    see break -- an attribute of "NaN" means the element silently does not
    draw.
    """
    _render_mindmap(page, app_server, plan)

    bad = _unparseable_svg_attributes(page)
    assert bad == [], f"{label}: SVG attributes the parser cannot read: {bad}"
