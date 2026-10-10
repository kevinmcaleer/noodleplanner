"""The Properties panel header and the status-bar link warning on a fresh plan.

* The header never overlaps itself when the editor pane is narrow: the
  Properties/YAML switch wraps below the title instead.
* The Properties/YAML switch stays visible when the panel is collapsed.
* A plan with no benefits map does not inherit the previous plan's
  "redundant links" warning.
"""

from .helpers import load_plan, open_app

PLAN = """---
title: Narrow
---

Design
  Research 2d
"""

# Sibling boxes: the header's children, then the controls' children.
BOXES = (
    "() => ['.fm-panel-header', '.fm-panel-controls'].map(sel => [...document.querySelector(sel).children]"
    ".map(e => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }))"
)


def _overlaps(a, b):
    return a[0] < b[2] - 1 and b[0] < a[2] - 1 and a[1] < b[3] - 1 and b[1] < a[3] - 1


def test_header_does_not_overlap_in_a_narrow_pane(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    page.wait_for_selector(".fm-panel-header")
    page.add_style_tag(content="#planEditor, .fm-panel { max-width: 240px !important; }")
    page.wait_for_timeout(100)
    groups = page.evaluate(BOXES)
    assert [len(g) for g in groups] == [2, 2]
    for boxes in groups:
        for i, a in enumerate(boxes):
            for b in boxes[i + 1:]:
                assert not _overlaps(a, b), (a, b)
    assert page.evaluate("() => !document.querySelector('.fm-summary-count')")


def test_yaml_switch_is_visible_when_collapsed(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    page.wait_for_selector(".fm-summary-toggle")
    page.click(".fm-summary-toggle")
    assert page.get_attribute(".fm-summary-toggle", "aria-expanded") == "false"
    assert page.is_visible(".fm-mode-btn")
    page.click(".fm-mode-btn")
    assert page.evaluate("() => FrontMatterPanel.instance.mode") == "raw"


def test_stale_redundant_link_warning_is_cleared(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    page.evaluate("() => pushStatusLogEntry({ key: 'benefits-redundant-links', text: 'stale', actions: [] })")
    load_plan(page, PLAN + "\n")
    page.evaluate("() => updateBenefits()")
    assert page.evaluate("() => !statusLog.some(e => e.key === 'benefits-redundant-links')")
