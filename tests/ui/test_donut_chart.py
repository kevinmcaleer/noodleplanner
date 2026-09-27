"""The report's task-completion donut keeps its centre count legible in both themes.

The chart script painted the count and its "tasks" label with fixed fills
(#333, #888), so in dark mode the count sat dark on the dark card. Both are
coloured by CSS now (`.donut-center-total`, `.donut-center-label`), and this
reads the fill the browser actually computes against the card behind it.

Usage:
    uv run pytest tests/ui/test_donut_chart.py -q
"""

import pytest

from .helpers import load_plan, open_project_view

pytestmark = pytest.mark.ui

PLAN = """---
title: Office move
start date: 2026-09-01
---
Design
  Wireframes 3d 100%
  Review 2d 50%
Build
  UI 4d
"""

# The fill of `selector` against the first opaque background above the donut,
# as a WCAG ratio.
CONTRAST_JS = """(selector) => {
    const toHex = rgb => '#' + rgb.match(/[\\d.]+/g).slice(0, 3)
        .map(n => Math.round(Number(n)).toString(16).padStart(2, '0')).join('');
    const alpha = rgb => {
        const parts = rgb.match(/[\\d.]+/g);
        return parts.length > 3 ? Number(parts[3]) : 1;
    };
    const text = document.querySelector(selector);
    let el = text.closest('svg').parentElement;
    while (el && alpha(getComputedStyle(el).backgroundColor) === 0) el = el.parentElement;
    const bg = el ? getComputedStyle(el).backgroundColor : 'rgb(255, 255, 255)';
    const fg = getComputedStyle(text).fill;
    return { bg, fg, ratio: wbContrastRatio(toHex(bg), toHex(fg)) };
}"""


@pytest.mark.parametrize("theme", ["light", "dark"])
@pytest.mark.parametrize("selector, minimum", [
    (".donut-chart-svg .donut-center-total", 4.5),
    (".donut-chart-svg .donut-center-label", 4.5),
])
def test_the_centre_text_is_legible(page, app_server, theme, selector, minimum):
    open_project_view(page, app_server)
    load_plan(page, PLAN, with_project="Office move")
    page.evaluate(f"() => document.documentElement.setAttribute('data-theme', '{theme}')")
    page.wait_for_selector(selector, state="attached")
    result = page.evaluate(CONTRAST_JS, selector)
    assert result["ratio"] >= minimum, result


def test_the_script_sets_no_fill_of_its_own(page, app_server):
    open_project_view(page, app_server)
    load_plan(page, PLAN, with_project="Office move")
    page.wait_for_selector(".donut-chart-svg .donut-center-total", state="attached")
    fills = page.evaluate(
        "() => [...document.querySelectorAll('.donut-chart-svg .donut-center-text')].map(t => t.getAttribute('fill'))"
    )
    assert fills and all(f is None for f in fills), fills
