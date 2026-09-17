"""Interactive targets stay at least as reachable as they are today.

WCAG 2.2 SC 2.5.8 (Target Size (Minimum), AA) wants every pointer target to be
at least 24x24 CSS pixels, with exceptions for inline targets, targets with
enough spacing around them, and cases where the size is essential.

The epic's task 5 asked for the button styles to be consolidated. The obvious
reading -- find duplicate rules and merge them -- turns up almost nothing: of
116 button class names exactly one group shares a byte-identical base rule.
Measuring what the buttons *render as* is the more useful question, and it has
a real answer: 13 of the app's 55 distinct interactive targets are under
24x24.

Most are short on one axis only (`.ribbon-sm-btn` at 87x23 misses by a pixel),
and several are legitimately exempt -- `.splitter-arrow` is 8px wide because
it is a drag handle between two panes, and widening it would eat the panes.
So this is deliberately **not** a pass/fail against the standard. It is a
ratchet: the ones that are too small today are listed, and the test fails when
a *new* one appears or a listed one is not found at all.

That is the honest way to hold the line. The alternative -- putting
`min-height: 24px` into the interactive base layer in visual-system.css --
would fix the number and silently resize the ribbon, the whiteboard outline
and the calendar's "+2 more" affordance, which is a redesign wearing a
consolidation's clothes.

Run:
    uv run pytest tests/ui/test_target_size.py -q
"""

import pytest

from .helpers import open_app

MIN_SIDE = 24

# Measured across all 39 views. A target is listed by the class signature the
# collector builds, not by view, because the same component failing on ten
# screens is one problem.
#
# Each entry says why it is here, because "24px" is not the interesting part --
# whether it *should* be 24px is.
KNOWN_SMALL = {
    # Genuinely exempt: essential size. A pane splitter that is 24px wide is
    # not a splitter, it is a column.
    "button.splitter-arrow",
    # Short on one axis, and sitting in dense chrome where growing them pushes
    # the ribbon taller. Candidates for the spacing exception rather than the
    # size one; measuring the spacing is not something this test does yet.
    "button.ribbon-sm-btn",
    "button.ribbon-sm-btn.active",
    "button.ribbon-scope-btn",
    "button.ribbon-scope-btn.active",
    # Icon buttons inside table rows and cards. These are the ones actually
    # worth fixing -- nothing about them needs to be under 24px.
    "button.wb-outline-add",
    "button.kanban-column-colour-btn",
    "button.quad-add-btn",
    "button.mindmap-theme-toggle",
    "button.status-bar-fix-btn",
    # Text affordances that are wide but short.
    "button.calendar-more-btn",
    "button.wb-outline-label",
    "button.section-fold-header-row",
}

COLLECT = r"""
() => {
    const out = [];
    // np-checkbox joins the sweep (#1245). Checkboxes were never measured
    // here -- this selector matched none of them -- so every one of the app's
    // nine treatments sat under MIN_SIDE unnoticed at 15, 16, 18 or 20px.
    // The host is a light-DOM element, so it is reachable from here; note
    // that querySelectorAll does not pierce shadow roots, so a control that
    // renders its target *inside* one would still escape this.
    for (const el of document.querySelectorAll(
            'button, [role="button"], a.btn, np-checkbox')) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        const cls = (typeof el.className === 'string' && el.className.trim())
            ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
            : '';
        out.push({ key: el.tagName.toLowerCase() + cls,
                   w: Math.round(r.width), h: Math.round(r.height) });
    }
    return out;
}
"""


@pytest.fixture
def measured(page, app_server):
    """Every distinct interactive target, at its smallest observed size.

    Function-scoped like the rest of the suite -- `page` is, so this cannot be
    module-scoped without its own browser plumbing, and walking 39 views once
    is a couple of seconds.
    """
    import sys
    from pathlib import Path as _Path

    sys.path.insert(0, str(_Path(__file__).resolve().parents[2] / "scripts"))
    from capture_screen_audit import SAMPLE_PLAN, _load_plan, _switch, _views

    open_app(page, app_server)
    _load_plan(page, SAMPLE_PLAN)

    seen: dict[str, dict] = {}
    for group, view in _views():
        if not _switch(page, group, view):
            continue
        for hit in page.evaluate(COLLECT):
            prev = seen.get(hit["key"])
            # Keep the smallest sighting: a button that is 24px on one screen
            # and 18px on another is 18px.
            if prev is None or hit["w"] * hit["h"] < prev["w"] * prev["h"]:
                seen[hit["key"]] = hit
    return seen


def test_no_new_targets_below_the_minimum(measured):
    small = {k: v for k, v in measured.items() if v["w"] < MIN_SIDE or v["h"] < MIN_SIDE}
    new = sorted(set(small) - KNOWN_SMALL)
    assert not new, (
        "these interactive targets are under "
        f"{MIN_SIDE}x{MIN_SIDE} (WCAG 2.2 SC 2.5.8) and are not in KNOWN_SMALL:\n"
        + "\n".join(f"  {small[k]['w']}x{small[k]['h']}  {k}" for k in new)
        + "\n\nEither give the target a 24px minimum, or add it to KNOWN_SMALL "
        "in this file with a line saying why it is exempt."
    )


def test_the_known_list_has_not_gone_stale(measured):
    """A name in KNOWN_SMALL that no longer renders small is a fixed target
    nobody removed from the list, and it would hide a later regression on the
    same component."""
    still_small = {k for k, v in measured.items() if v["w"] < MIN_SIDE or v["h"] < MIN_SIDE}
    gone = sorted(k for k in KNOWN_SMALL if k in measured and k not in still_small)
    assert not gone, (
        "these are listed as too small but now meet the minimum -- remove them "
        f"from KNOWN_SMALL: {gone}"
    )
