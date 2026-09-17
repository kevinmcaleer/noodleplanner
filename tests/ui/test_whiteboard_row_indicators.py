"""One visual language for the checklist row's indicators (issue #1248).

Five things used to hang off a row -- the `$` deliverable badge, the
planning-hint coach, the detected-date chip, the child-count badge and the
dependency handle. Each arrived with its own issue and none was designed
against the others, so the row carried three declared heights and one
undeclared, three radii, four unrelated colour sources and four resting
opacities.

Two of the five have since left the row itself. The planning hint and the
dependency handle are *rails* now: drawn outside the card, level with whichever
row the pointer or the keyboard is on. They went because the row's trailing
gutter reserved four fixed slots on every row and the task name got what was
left -- under 30px on a default note, which is three characters and an
ellipsis. The two that describe the task stayed; the two that start a gesture
moved out.

So there are two rules here, not one, and the split is the point:

*   On the note, an indicator is note-coloured, 18px, visible at rest, and
    shaped by whether it carries text.
*   On a rail, a control is theme-coloured (it sits on the *board*, where the
    note's measured-against-pastel ink can be near-white and invisible),
    hidden at rest, and shown only for the active row.

Labelling is the one rule that spans both.

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

# On the note, in the row.
INDICATORS = (
    ".wb-note-deliverable-badge",
    ".wb-note-row-date",
    ".wb-note-count-badge",
)

# Outside the note, on the rails.
RAILS = (
    ".wb-note-rail-hint",
    ".wb-note-rail-dep",
)

# In the row, but a gesture rather than a fact, so it dims at rest.
QUIET = (".wb-note-row-resource",)


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
                        hidden: n.hidden,
                    };
                });
            }
            out.noteInk = getComputedStyle(
                document.querySelector('.wb-note[data-wb-task=Build] .wb-note-card')
            ).color;
            return out;
        }""",
        list(INDICATORS) + list(RAILS) + list(QUIET),
    )


def _loaded(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    switch_to_whiteboard(page)
    # `attached`, not visible: the rails are hidden until a row is active, so
    # waiting for visibility here would wait for something that is meant not to
    # happen.
    page.wait_for_selector(".wb-note[data-wb-task=Build] .wb-note-rail-dep",
                           state="attached")
    # Existence is not enough to measure against. A note is drawn at its
    # default 260x220 and resized from the `---whiteboard---` table a moment
    # later; every indicator exists in both states, so a measurement taken
    # between them can land while the card is still 260 wide -- a different
    # container-query tier from the 320 this plan declares, with a different
    # set of indicators rendered. That is what made this file fail under
    # `-n 4` and pass every time serially.
    #
    # `offsetWidth` rather than the bounding rect, because the board is
    # zoom-transformed and the rect reports scaled pixels.
    page.wait_for_function(
        "() => { const c = document.querySelector("
        "          '.wb-note[data-wb-task=Build] .wb-note-card');"
        "        return c && Math.abs(c.offsetWidth - 320) < 2; }"
    )
    return _measure(page)


def _hover(page, child):
    """Put the pointer on `child`'s row and let the rails follow it.

    `force=True` because the board is a pan/zoom canvas and most of these notes
    sit outside the visible pane -- the same reason helpers.py clicks board
    content with `dispatch_event`."""
    row = note(page, "Build").locator(".wb-note-row").filter(
        has=page.locator(".wb-note-row-name", has_text=re.compile(rf"^{re.escape(child)}$"))
    )
    row.hover(force=True)
    page.wait_for_function(
        "() => { const r = document.querySelector("
        "  '.wb-note[data-wb-task=Build] .wb-note-rail-dep'); return r && !r.hidden; }"
    )


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
        squares = {r for r in (i["radius"] for i in m[".wb-note-deliverable-badge"])}
        assert pills == {"9px"}, f"text chips are not one pill radius: {pills}"
        assert squares == {"4px"}, f"glyph controls are not one radius: {squares}"
        # The coach used to be the only circle on the row.
        assert "50%" not in squares and "9px" not in squares

    def test_colour_comes_from_the_note_not_a_fixed_palette(self, page, app_server):
        """The date chip and the coach's suspected-activity state used to carry
        fixed light-mode palettes, painted on a pastel note in both themes."""
        m = _loaded(page, app_server)
        ink = m["noteInk"]
        for sel in (".wb-note-row-date", ".wb-note-count-badge"):
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
        _hover(page, "Plain leaf")
        handle = _measure(page)[".wb-note-rail-dep"][0]
        assert handle["colour"] == "rgb(155, 89, 182)", handle["colour"]


class TestVisibleAtRest:
    """One rule: an indicator that carries information is visible at rest; a
    control that only initiates a gesture is revealed on hover or focus."""

    def test_informational_indicators_are_visible_at_rest(self, page, app_server):
        m = _loaded(page, app_server)
        for sel in (".wb-note-deliverable-badge",
                    ".wb-note-row-date", ".wb-note-count-badge"):
            for indicator in m[sel]:
                assert float(indicator["opacity"]) == 1.0, (
                    f"{sel} is dimmed at rest ({indicator['opacity']}); the row "
                    "used to carry four different resting opacities"
                )

    def test_the_rails_are_hidden_at_rest(self, page, app_server):
        """Neither rail carries information of its own -- one opens a popover,
        one starts a drag -- so a board at rest shows neither."""
        _loaded(page, app_server)
        for sel in RAILS:
            for rail in _measure(page)[sel]:
                assert rail["hidden"] is True, f"{sel} is showing on an unhovered board"

    def test_hovering_a_row_reveals_its_rails(self, page, app_server):
        _loaded(page, app_server)
        _hover(page, "Plain leaf")
        m = _measure(page)
        assert m[".wb-note-rail-dep"][0]["hidden"] is False

    def test_the_quick_assign_control_is_hidden_at_rest_too(self, page, app_server):
        """It is a gesture like the rails, but it lives in the row -- so it
        dims rather than unmounting, and the people slot keeps its width."""
        _loaded(page, app_server)
        assert float(_measure(page)[".wb-note-row-resource"][0]["opacity"]) == 0.0


class TestOneResourceControlPerRow:
    """The people slot holds the avatars or the empty circle, never both.

    It used to hold both: the chips, and a dashed "+" beside them. Two controls
    in one 20px column that open the same menu, because the chips have opened
    the assign menu themselves since #1246 -- so the "+" was a second button
    for a job the first one was already doing, and the row paid for its width
    on every row that had anyone on it.
    """

    def _slots(self, page):
        return page.evaluate(
            """() => [...document.querySelectorAll(
                  '.wb-note[data-wb-task=Build] .wb-note-row')].map(r => ({
                name: r.querySelector('.wb-note-row-name').textContent,
                stack: !!r.querySelector('.wb-note-row-avatar'),
                plus: !!r.querySelector('.wb-note-row-resource'),
            }))"""
        )

    def test_a_row_with_nobody_on_it_offers_the_empty_circle(self, page, app_server):
        _loaded(page, app_server)
        rows = self._slots(page)
        assert rows, "the plan renders rows"
        for row in rows:
            assert row["plus"] and not row["stack"], (
                f"nothing is assigned in this plan, so every row should offer "
                f"the empty circle and no stack: {row}"
            )

    def test_a_row_with_somebody_on_it_offers_only_the_avatars(
        self, page, app_server
    ):
        open_app(page, app_server)
        load_plan(page, PLAN.replace("    Plain leaf 1d", "    Plain leaf @sam 1d"))
        switch_to_whiteboard(page)
        page.wait_for_selector(".wb-note[data-wb-task=Build] .wb-note-row-avatar")

        assigned = next(r for r in self._slots(page) if r["name"] == "Plain leaf")
        assert assigned["stack"] is True
        assert assigned["plus"] is False, (
            "an assigned row is showing the empty circle as well as the people"
        )

    def test_no_row_anywhere_shows_both(self, page, app_server):
        open_app(page, app_server)
        load_plan(page, PLAN.replace("    Plain leaf 1d", "    Plain leaf @sam 1d"))
        switch_to_whiteboard(page)
        page.wait_for_selector(".wb-note[data-wb-task=Build] .wb-note-row-avatar")

        both = [r["name"] for r in self._slots(page) if r["stack"] and r["plus"]]
        assert both == [], f"these rows show two resource controls: {both}"


class TestLabelling:
    def test_tooltip_and_accessible_name_agree(self, page, app_server):
        """All three of these used to say different things: the tooltip
        described the gesture and the accessible name described the outcome."""
        _loaded(page, app_server)
        _hover(page, "Plain leaf")
        m = _measure(page)
        for sel in (".wb-note-row-date", ".wb-note-rail-dep"):
            for indicator in m[sel]:
                assert indicator["title"] == indicator["label"], (
                    f"{sel} tooltip {indicator['title']!r} != "
                    f"accessible name {indicator['label']!r}"
                )

    def test_every_popup_trigger_declares_its_popup_up_front(self, page, app_server):
        """`aria-haspopup` and an initial `aria-expanded` at render time, not
        only once the popup has been opened for the first time."""
        _loaded(page, app_server)
        _hover(page, "Plain leaf")
        m = _measure(page)
        for sel in (".wb-note-rail-hint", ".wb-note-row-date", ".wb-note-count-badge"):
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
