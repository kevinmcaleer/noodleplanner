"""The checklist row's reserved trailing gutter (issue #1243).

Controls used to be appended to a row in the order the features arrived, every
trailing one conditional and none reserving any width. So where the trailing
cluster began was a function of which optional controls a given child happened
to have, and nothing lined up down the card. That is the reported alignment
problem, and it is structural rather than cosmetic.

The fix is three zones -- lead, name, gutter -- where the gutter is a constant
width holding three fixed-order slots, and an unoccupied slot renders as an
empty box rather than `display: none`. These tests are about that invariant and
the degradation tiers underneath it, not about any particular pixel value.

Clicks and geometry are read via dispatched events and bounding boxes for the
reason tests/ui/test_task_peek.py's docstring gives: the whiteboard is a
pan/zoom canvas and this plan's notes sit outside the visible pane.

Usage:
    uv run pytest tests/ui/test_whiteboard_row_layout.py -q
"""

import re

from .helpers import load_plan, note, open_app, switch_to_whiteboard

# `Busy` carries a deliverable, a detected date and two assignees; `Bare` has
# none of them. Before #1243 their trailing controls started at two different
# x positions, which is the whole bug.
PLAN = """---
title: Row Layout Test Plan
Resources:
  - @sam: Sam Smith, Developer
  - @jo: Jo Lee, Reviewer
---

Phase 1
  Build
    Busy $Widget @sam @jo 2d 2026-03-12
    Bare 1d
    Summary
      Leaf A 1d

---whiteboard---
| Task  | X   | Y  | Colour | Width | Height | Collapsed |
|-------|-----|----|--------|-------|--------|-----------|
| Build | 480 | 80 |        | 280   | 300    | no        |
"""


def _row(page, child_name):
    return note(page, "Build").locator(".wb-note-row").filter(
        has=page.locator(
            ".wb-note-row-name", has_text=re.compile(rf"^{re.escape(child_name)}$")
        )
    )


def _box(locator):
    return locator.bounding_box()


def settled(page, width=280):
    """Wait until the card has reached the width the plan's table asks for.

    The note is drawn at a default size first and resized from the
    `---whiteboard---` table a moment later. Measuring across that boundary
    reads two rows at two different widths -- and because the row's degradation
    tiers are container queries on the card, the two reads can even land in
    different tiers. Every geometry assertion below waits for this first.
    """
    page.wait_for_function(
        "w => { const c = document.querySelector("
        "         '.wb-note[data-wb-task=Build] .wb-note-card');"
        "       return c && Math.abs(c.getBoundingClientRect().width - w) < 2; }",
        arg=width,
    )


def row_geometry(page):
    """Every row's zone boxes, read in one pass.

    One `evaluate` rather than a `bounding_box()` per element: separate reads
    are separate round trips, and anything that reflows between them turns a
    real invariant into a flake.
    """
    return page.evaluate(
        """() => [...document.querySelectorAll(
              '.wb-note[data-wb-task=Build] .wb-note-row')].map(r => {
            const rowBox = r.getBoundingClientRect();
            const at = (sel) => {
                const n = r.querySelector(sel);
                if (!n) return null;
                const b = n.getBoundingClientRect();
                // `offset` is x relative to the row. Absolute x is what the
                // cross-row alignment assertions compare; `offset` is for
                // before/after comparisons on one row, where the board may
                // have scrolled between the two reads.
                return { x: b.x, width: b.width, offset: b.x - rowBox.x };
            };
            return {
                name: r.querySelector('.wb-note-row-name')?.textContent ?? '',
                nameBox: at('.wb-note-row-name'),
                gutter: at('.wb-note-row-gutter'),
                dep: at('.wb-note-row-slot-dep'),
            };
        })"""
    )


def by_name(geometry, name):
    return next(r for r in geometry if r["name"] == name)


class TestTheGutterHoldsItsPosition:
    def test_every_row_has_all_three_slots_even_when_empty(self, page, app_server):
        open_app(page, app_server)
        load_plan(page, PLAN)
        switch_to_whiteboard(page)

        for child in ("Busy", "Bare", "Summary"):
            gutter = _row(page, child).locator(".wb-note-row-gutter")
            assert gutter.count() == 1, f"{child} has a gutter"
            for slot in ("hint", "people", "dep"):
                assert (
                    gutter.locator(f".wb-note-row-slot-{slot}").count() == 1
                ), f"{child} reserves the {slot} slot"

    def test_the_gutter_starts_at_the_same_x_on_every_row(self, page, app_server):
        """The invariant. A busy row and a bare row align."""
        open_app(page, app_server)
        load_plan(page, PLAN)
        switch_to_whiteboard(page)

        settled(page)
        geometry = row_geometry(page)
        busy = by_name(geometry, "Busy")["gutter"]
        bare = by_name(geometry, "Bare")["gutter"]
        assert abs(busy["x"] - bare["x"]) < 1.0, (
            f"gutters start at different x: busy={busy['x']} bare={bare['x']}"
        )
        assert abs(busy["width"] - bare["width"]) < 1.0, "gutters are the same width"

    def test_names_start_at_the_same_x_whether_or_not_there_is_a_badge(
        self, page, app_server
    ):
        """The deliverable badge used to sit inline before the name."""
        open_app(page, app_server)
        load_plan(page, PLAN)
        switch_to_whiteboard(page)

        assert _row(page, "Busy").locator(".wb-note-deliverable-badge").count() == 1
        assert _row(page, "Bare").locator(".wb-note-deliverable-badge").count() == 0

        settled(page)
        geometry = row_geometry(page)
        busy = by_name(geometry, "Busy")["nameBox"]
        bare = by_name(geometry, "Bare")["nameBox"]
        assert abs(busy["x"] - bare["x"]) < 1.0, (
            f"names start at different x: busy={busy['x']} bare={bare['x']}"
        )

    def test_a_leaf_and_a_summary_put_their_last_control_in_the_same_place(
        self, page, app_server
    ):
        """The count badge and the dependency handle are mutually exclusive,
        and used to be the reason two rows ended in different places."""
        open_app(page, app_server)
        load_plan(page, PLAN)
        switch_to_whiteboard(page)

        settled(page)
        geometry = row_geometry(page)
        leaf = by_name(geometry, "Bare")["dep"]
        summary = by_name(geometry, "Summary")["dep"]
        assert abs(leaf["x"] - summary["x"]) < 1.0

        # ...and the count badge is in the name zone, not the gutter, because it
        # describes the task rather than acting on it.
        assert _row(page, "Summary").locator(
            ".wb-note-row-content .wb-note-count-badge"
        ).count() == 1
        assert _row(page, "Summary").locator(".wb-note-row-dep-handle").count() == 0
        assert _row(page, "Bare").locator(".wb-note-row-dep-handle").count() == 1


class TestNoLayoutShift:
    def test_hovering_a_row_moves_nothing(self, page, app_server):
        """The dependency handle reveals on hover. It must do that by opacity,
        not by taking width -- nothing in the row may move under the pointer."""
        open_app(page, app_server)
        load_plan(page, PLAN)
        switch_to_whiteboard(page)

        settled(page)
        row = _row(page, "Bare")
        before = by_name(row_geometry(page), "Bare")["nameBox"]
        row.hover(force=True)
        page.wait_for_timeout(100)
        after = by_name(row_geometry(page), "Bare")["nameBox"]

        # Compared against the row, not the viewport: hovering an off-screen
        # note scrolls the board to reach it, which moves every absolute x by
        # the same amount and says nothing about reflow.
        # A pixel and a half, not half a pixel: the board is a zoom-transformed
        # canvas, so these boxes land on fractional device pixels and a
        # re-measure after any repaint can differ by a few tenths without
        # anything having reflowed. The smallest control in the gutter is 14px,
        # so a real layout shift is an order of magnitude above this.
        TOLERANCE = 1.5
        assert abs(before["offset"] - after["offset"]) < TOLERANCE, (
            f"the name moved within its row on hover: "
            f"{before['offset']} -> {after['offset']}"
        )
        assert abs(before["width"] - after["width"]) < TOLERANCE, (
            f"the name changed width on hover: {before['width']} -> {after['width']}"
        )


class TestAvatarOverflow:
    def test_the_row_caps_its_avatars_and_shows_the_remainder_as_a_chip(
        self, page, app_server
    ):
        """The row used to render one avatar per assignee, uncapped, while the
        note footer capped the same list at six."""
        open_app(page, app_server)
        load_plan(
            page,
            PLAN.replace(
                "  - @jo: Jo Lee, Reviewer",
                "  - @jo: Jo Lee, Reviewer\n"
                "  - @al: Alex Ray, Designer\n"
                "  - @ki: Kim Ito, QA\n"
                "  - @ro: Ro Patel, Analyst",
            ).replace("Busy $Widget @sam @jo 2d", "Busy $Widget @sam @jo @al @ki @ro 2d"),
        )
        switch_to_whiteboard(page)

        people = _row(page, "Busy").locator(".wb-note-row-slot-people")
        assert people.locator(".wb-note-row-avatar").count() == 3, "capped at three"

        chip = people.locator(".wb-note-row-avatar-more")
        assert chip.count() == 1
        assert chip.get_attribute("data-total") == "5"
        assert chip.get_attribute("data-over3") == "2"

    def test_a_row_with_nobody_on_it_renders_no_chip(self, page, app_server):
        open_app(page, app_server)
        load_plan(page, PLAN)
        switch_to_whiteboard(page)

        people = _row(page, "Bare").locator(".wb-note-row-slot-people")
        assert people.locator(".wb-note-row-avatar").count() == 0
        assert people.locator(".wb-note-row-avatar-more").count() == 0
        # The slot is still there, holding its width.
        assert people.count() == 1


class TestDegradation:
    """Documented, in a fixed order, by card width. Each tier drops the least
    load-bearing thing left, and the name keeps a floor throughout."""

    def _resize(self, page, width):
        page.evaluate(
            """w => {
                const plan = document.getElementById('planEditor');
                plan.value = plan.value.replace(/\\| 280 /, `| ${w} `);
                plan.dispatchEvent(new Event('input', { bubbles: true }));
            }""",
            width,
        )
        # Unquoted attribute value: `Build` is a valid CSS identifier, and it
        # keeps this free of nested-quote escaping.
        page.wait_for_function(
            "w => { const n = document.querySelector("
            "         '.wb-note[data-wb-task=Build] .wb-note-card');"
            "       return n && Math.abs(n.getBoundingClientRect().width - w) < 2; }",
            arg=width,
        )

    def test_the_planning_hint_is_the_first_thing_to_go(self, page, app_server):
        open_app(page, app_server)
        load_plan(page, PLAN)
        switch_to_whiteboard(page)
        settled(page)
        self._resize(page, 220)

        # The slot stays in the DOM -- only its reserved width goes to zero.
        hint = _row(page, "Busy").locator(".wb-note-row-slot-hint")
        assert hint.count() == 1
        assert _box(hint)["width"] < 1.0

    def test_nothing_is_clipped_at_the_minimum_note_width(self, page, app_server):
        open_app(page, app_server)
        load_plan(page, PLAN)
        switch_to_whiteboard(page)
        settled(page)
        self._resize(page, 160)

        card = _box(note(page, "Build").locator(".wb-note-card"))
        for child in ("Busy", "Bare"):
            row = _row(page, child)
            for selector in (".wb-note-row-name", ".wb-note-row-slot-dep",
                             ".wb-note-row-resource"):
                box = _box(row.locator(selector))
                if box is None or box["width"] == 0:
                    continue
                right = box["x"] + box["width"]
                assert right <= card["x"] + card["width"] + 1.0, (
                    f"{child}'s {selector} overflows the card at 160px"
                )

    def test_the_name_keeps_a_floor(self, page, app_server):
        open_app(page, app_server)
        load_plan(page, PLAN)
        switch_to_whiteboard(page)
        settled(page)
        self._resize(page, 160)

        for child in ("Busy", "Bare"):
            assert _box(_row(page, child).locator(".wb-note-row-name"))["width"] > 8.0, (
                f"{child}'s name collapsed to nothing"
            )
