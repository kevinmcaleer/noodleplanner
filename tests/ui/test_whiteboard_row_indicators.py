"""One visual language for the checklist row's indicators (issue #1248).

Five things hang off a row -- the `$` deliverable badge, the planning-hint
coach, the detected-date chip, the child-count badge and the dependency handle.
Each arrived with its own issue and none was designed against the others, so
the row carried three declared heights and one undeclared, three radii, four
unrelated colour sources and four resting opacities.

Three of these classes -- `.wb-note-row-coach`, `.wb-note-row-date` and
`.wb-note-row-dep-handle` -- had no automated assertion anywhere in the tree
before this file, and tests/test_whiteboard_dep_noodles.mjs records that the
row dependency gesture is "covered by manual/browser verification only". A rule
about size, shape, colour and labelling that nothing asserts will drift back.

Usage:
    uv run pytest tests/ui/test_whiteboard_row_indicators.py -q
"""

import re

from .helpers import load_plan, note, open_app, switch_to_whiteboard

PLAN = """---
title: Row Indicator Test Plan
Resources:
  - @sam: Sam Smith, Developer
---

Phase 1
  Build
    Deliver something $Widget 2d
    Write the report 2026-03-12
    Summary
      Leaf A 1d
    Plain leaf 1d

---whiteboard---
| Task  | X   | Y  | Colour  | Width | Height | Collapsed |
|-------|-----|----|---------|-------|--------|-----------|
| Build | 480 | 80 | #FCE38A | 320   | 320    | no        |
"""

INDICATORS = (
    ".wb-note-deliverable-badge",
    ".wb-note-row-coach",
    ".wb-note-row-date",
    ".wb-note-count-badge",
    ".wb-note-row-dep-handle",
)


def _measure(page):
    """Every indicator on the note, with the computed values under test."""
    return page.evaluate(
        """(selectors) => {
            const out = {};
            for (const sel of selectors) {
                const nodes = [...document.querySelectorAll(
                    '.wb-note[data-wb-task=Build] ' + sel)];
                out[sel] = nodes.map(n => {
                    const cs = getComputedStyle(n);
                    return {
                        height: Math.round(n.getBoundingClientRect().height),
                        radius: cs.borderTopLeftRadius,
                        colour: cs.color,
                        background: cs.backgroundColor,
                        opacity: cs.opacity,
                        title: n.getAttribute('title'),
                        label: n.getAttribute('aria-label'),
                        haspopup: n.getAttribute('aria-haspopup'),
                        expanded: n.getAttribute('aria-expanded'),
                        role: n.getAttribute('role'),
                        tag: n.tagName.toLowerCase(),
                    };
                });
            }
            out.noteInk = getComputedStyle(
                document.querySelector('.wb-note[data-wb-task=Build] .wb-note-card')
            ).color;
            return out;
        }""",
        list(INDICATORS),
    )


def _loaded(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    switch_to_whiteboard(page)
    page.wait_for_selector(".wb-note[data-wb-task=Build] .wb-note-row-dep-handle")
    return _measure(page)


class TestOneVisualLanguage:
    def test_every_indicator_is_the_same_height(self, page, app_server):
        m = _loaded(page, app_server)
        heights = {
            sel: {i["height"] for i in m[sel]} for sel in INDICATORS if m[sel]
        }
        assert heights, "the plan renders at least some indicators"
        every = {h for hs in heights.values() for h in hs}
        assert every == {18}, f"indicators render at more than one height: {heights}"

    def test_shape_follows_one_rule(self, page, app_server):
        """Text-bearing chips are pills; single-glyph controls are squares."""
        m = _loaded(page, app_server)
        pills = {r for sel in (".wb-note-row-date", ".wb-note-count-badge")
                 for r in (i["radius"] for i in m[sel])}
        squares = {r for sel in (".wb-note-deliverable-badge", ".wb-note-row-coach",
                                 ".wb-note-row-dep-handle")
                   for r in (i["radius"] for i in m[sel])}
        assert pills == {"9px"}, f"text chips are not one pill radius: {pills}"
        assert squares == {"4px"}, f"glyph controls are not one radius: {squares}"
        # The coach used to be the only circle on the row.
        assert "50%" not in squares and "9px" not in squares

    def test_colour_comes_from_the_note_not_a_fixed_palette(self, page, app_server):
        """The date chip and the coach's suspected-activity state used to carry
        fixed light-mode palettes, painted on a pastel note in both themes."""
        m = _loaded(page, app_server)
        ink = m["noteInk"]
        for sel in (".wb-note-row-date", ".wb-note-count-badge", ".wb-note-row-coach"):
            for indicator in m[sel]:
                assert indicator["colour"] == ink, (
                    f"{sel} paints {indicator['colour']} where the note's ink is {ink}"
                )

    def test_the_two_hue_coded_indicators_keep_their_hue(self, page, app_server):
        """Orange means deliverable, purple means dependency. Those are kinds of
        thing rather than states, and are the documented exception."""
        m = _loaded(page, app_server)
        badge = m[".wb-note-deliverable-badge"][0]
        assert badge["background"] == "rgb(255, 123, 1)", badge["background"]
        assert badge["colour"] == "rgb(22, 22, 22)", (
            "the badge's ink should be --np-orange-ink, the value its comment "
            f"always claimed, not {badge['colour']}"
        )
        handle = m[".wb-note-row-dep-handle"][0]
        assert handle["colour"] == "rgb(155, 89, 182)", handle["colour"]


class TestVisibleAtRest:
    """One rule: an indicator that carries information is visible at rest; a
    control that only initiates a gesture is revealed on hover or focus."""

    def test_informational_indicators_are_visible_at_rest(self, page, app_server):
        m = _loaded(page, app_server)
        for sel in (".wb-note-deliverable-badge", ".wb-note-row-coach",
                    ".wb-note-row-date", ".wb-note-count-badge"):
            for indicator in m[sel]:
                assert float(indicator["opacity"]) == 1.0, (
                    f"{sel} is dimmed at rest ({indicator['opacity']}); the row "
                    "used to carry four different resting opacities"
                )

    def test_the_dependency_handle_is_the_only_one_revealed_on_hover(
        self, page, app_server
    ):
        m = _loaded(page, app_server)
        for handle in m[".wb-note-row-dep-handle"]:
            assert float(handle["opacity"]) == 0.0, (
                "the dependency handle carries no information of its own, so it "
                "is the one control revealed on hover"
            )


class TestLabelling:
    def test_tooltip_and_accessible_name_agree(self, page, app_server):
        """All three of these used to say different things: the tooltip
        described the gesture and the accessible name described the outcome."""
        m = _loaded(page, app_server)
        for sel in (".wb-note-row-coach", ".wb-note-row-date",
                    ".wb-note-row-dep-handle"):
            for indicator in m[sel]:
                assert indicator["title"] == indicator["label"], (
                    f"{sel} tooltip {indicator['title']!r} != "
                    f"accessible name {indicator['label']!r}"
                )

    def test_every_popup_trigger_declares_its_popup_up_front(self, page, app_server):
        """`aria-haspopup` and an initial `aria-expanded` at render time, not
        only once the popup has been opened for the first time."""
        m = _loaded(page, app_server)
        for sel in (".wb-note-row-coach", ".wb-note-row-date", ".wb-note-count-badge"):
            for indicator in m[sel]:
                assert indicator["haspopup"], f"{sel} does not declare aria-haspopup"
                assert indicator["expanded"] == "false", (
                    f"{sel} does not declare an initial aria-expanded"
                )

    def test_the_deliverable_badge_is_readable_rather_than_a_dollar_sign(
        self, page, app_server
    ):
        """It was a bare span carrying only a title, so its meaning reached a
        screen reader as the literal character."""
        m = _loaded(page, app_server)
        badge = m[".wb-note-deliverable-badge"][0]
        assert badge["role"] == "img"
        assert badge["label"] == "Deliverable: Widget"
