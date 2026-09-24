"""Every main view, at desktop and at phone width, holds the design system (#1194).

The rollout issue's acceptance criteria ask for "a full user-flow walkthrough
confirming uniform styling, spacing and component behaviour across all main
screens", verified "at mobile width as well as desktop". A walkthrough done
once by hand is true on the day it is done. This one is the same walk, made
every time the suite runs.

For each of the 39 project and portfolio views, at 1280px and at 390px (an
iPhone 12-15's CSS width):

* **It is reachable, and switching to it throws nothing.** A view whose
  switch function fails would be absent from every other check here, so an
  unreachable view is a failure, not a skip.
* **The page does not scroll sideways.** At phone width, a Gantt chart or a
  wide table has to scroll inside its own container. If it widens the page,
  the ribbon and the status bar scroll off with it.
* **All rendered text is in one of the three approved families.** Measured,
  not inferred from the CSS. The first walk found ~3,300 text elements in
  Courier New, `ui-monospace` and the macOS system stack, from 19 stylesheets
  that named a typeface directly. `lint-design-system.mjs`'s `raw-font-family`
  rule now catches that in the CSS, but not in a template's `style=""` or a
  `.style.fontFamily` set from JS. This does.

Spacing is not measured here. The lint's `off-scale-spacing` rule covers it at
the source, and the rendered values that are off the grid are the 1-2px
hairlines that rule deliberately allows.

Run:
    uv run pytest tests/ui/test_view_walkthrough.py -q
"""

import sys
from pathlib import Path

import pytest

from .helpers import open_app

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from capture_screen_audit import SAMPLE_PLAN, _load_plan, _switch, _views  # noqa: E402

WIDTHS = {"desktop": 1280, "mobile": 390}

# The first family of each --np-font-* stack in visual-system.css. The computed
# font-family is the declared stack, not whichever font the browser resolved,
# so this holds whether or not the webfont itself loaded.
APPROVED_FAMILIES = {"Instrument Sans", "Newsreader", "IBM Plex Mono"}

# Icon fonts draw glyphs, not text, and have no token to use.
ICON_FAMILIES = {"bootstrap-icons"}

# A blocked CDN request (tests/ui/conftest.py aborts them all) is reported as a
# console error. That is the fixture working, not the view failing.
BLOCKED_RESOURCE = "Failed to load resource"

WALK = r"""() => {
    const visible = (el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const cs = getComputedStyle(el);
        return cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    const fonts = {};
    for (const el of document.querySelectorAll('body *')) {
        if (!visible(el)) continue;
        const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (!ownText && !el.matches('input, textarea, select')) continue;
        const first = getComputedStyle(el).fontFamily.split(',')[0].replace(/["']/g, '').trim();
        const label = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
            [...el.classList].slice(0, 2).map((c) => '.' + c).join('');
        (fonts[first] ??= []).push(label);
    }
    const se = document.scrollingElement;
    return { overflow: se.scrollWidth - innerWidth, fonts };
}"""


@pytest.mark.parametrize("width_name", WIDTHS)
def test_every_view_holds_the_design_system(page, app_server, width_name):
    page.set_viewport_size({"width": WIDTHS[width_name], "height": 900})
    open_app(page, app_server)
    _load_plan(page, SAMPLE_PLAN)

    problems = []
    walked = 0
    for group, view in _views():
        page.console_errors.clear()
        if not _switch(page, group, view):
            problems.append(f"{view}: could not be reached")
            continue
        walked += 1
        result = page.evaluate(WALK)

        errors = [e for e in page.console_errors if not e.startswith(BLOCKED_RESOURCE)]
        if errors:
            problems.append(f"{view}: switching to it raised {errors[0]!r}")

        if result["overflow"] > 0:
            problems.append(f"{view}: the page scrolls sideways by {result['overflow']}px")

        for family, where in sorted(result["fonts"].items()):
            if family in APPROVED_FAMILIES or family in ICON_FAMILIES:
                continue
            sample = ", ".join(sorted(set(where))[:3])
            problems.append(f"{view}: {len(where)} text element(s) in {family!r}, e.g. {sample}")

    assert walked >= 39, f"only {walked} views were walked -- has ui-structure.json lost some?"
    assert not problems, f"at {WIDTHS[width_name]}px:\n  " + "\n  ".join(problems)
