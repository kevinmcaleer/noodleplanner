"""The report quads' empty states render as <np-empty-state>, not bare text.

`.quad-empty-state` lost its CSS when the empty states were consolidated onto
<np-empty-state>, but the three placeholders written straight into
index.html (Latest Highlight, Risks & Issues, Actions) were never migrated,
so "No open risks or issues." and "No open actions." sat unstyled in the top
left of their cells. This checks each one is centred and padded.

Usage:
    uv run pytest tests/ui/test_report_empty_states.py -q
"""

import pytest

from .helpers import load_plan, open_project_view

pytestmark = pytest.mark.ui

PLAN = """---
title: Office move
start date: 2026-09-01
---
Design
  Wireframes 3d
"""

STYLE_JS = """(id) => {
    const el = document.getElementById(id);
    const wrap = el.shadowRoot && el.shadowRoot.querySelector('.wrap');
    if (!wrap) return null;
    const s = getComputedStyle(wrap);
    return {
        tag: el.tagName.toLowerCase(),
        textAlign: s.textAlign,
        paddingTop: parseFloat(s.paddingTop),
        visible: el.offsetHeight > 0,
    };
}"""


@pytest.mark.parametrize("element_id", ["reportRaidEmpty", "reportActionsEmpty"])
def test_the_empty_state_is_centred_and_padded(page, app_server, element_id):
    open_project_view(page, app_server)
    load_plan(page, PLAN, with_project="Office move")
    page.wait_for_selector(f"#{element_id}", state="visible")
    result = page.evaluate(STYLE_JS, element_id)
    assert result is not None, "not rendered by <np-empty-state>"
    assert result["tag"] == "np-empty-state"
    assert result["visible"]
    assert result["textAlign"] == "center"
    assert result["paddingTop"] >= 12
