"""The checklist row's reserved trailing gutter (issue #1243).

Controls used to be appended to a row in the order the features arrived, every
trailing one conditional and none reserving any width. So where the trailing
cluster began was a function of which optional controls a given child happened
to have, and nothing lined up down the card. That is the reported alignment
problem, and it is structural rather than cosmetic.

The fix is three zones -- lead, name, gutter -- where the gutter is a constant
width holding fixed-order slots, and an unoccupied slot renders as an empty box
rather than `display: none`. These tests are about that invariant and the
degradation tiers underneath it, not about any particular pixel value.

"Constant" is per note, not per app. Four reserved slots came to 136px of a
260px note, so the name got under 30px and every row on a default card rendered
three characters and an ellipsis. Two of the four -- the planning hint and the
dependency handle, the two that start a gesture rather than state a fact -- are
rails now, drawn outside the card for the active row (see
tests/ui/test_whiteboard_row_indicators.py). The people slot that remains is
reserved from the widest row *this* note actually has, rather than from the
widest row any note could have. Every row in a card still agrees with every
other row in that card, which is the alignment a reader can see; two different
cards reserving different widths is not something anyone can hold side by
side.

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

    `offsetWidth`, not `getBoundingClientRect().width`: the board is a
    zoom-transformed canvas, so the rect reports the *scaled* width. At a zoom
    of 1.077 a card still at its 260px default reads as 280 -- exactly the
    width this waits for -- so the wait returned immediately against the
    unresized card, in whichever container-query tier that puts it. That is
    what made this file fail under `-n 4` and pass every time serially.
    `offsetWidth` is layout pixels and the transform does not touch it.
    """
    page.wait_for_function(
        "w => { const c = document.querySelector("
        "         '.wb-note[data-wb-task=Build] .wb-note-card');"
        "       return c && Math.abs(c.offsetWidth - w) < 2; }",
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
            };
        })"""
    )


def by_name(geometry, name):
    return next(r for r in geometry if r["name"] == name)


class TestTheGutterHoldsItsPosition:
    def test_every_row_reserves_the_same_slots_even_when_empty(self, page, app_server):
        open_app(page, app_server)
        load_plan(page, PLAN)
        switch_to_whiteboard(page)

        for child in ("Busy", "Bare", "Summary"):
            gutter = _row(page, child).locator(".wb-note-row-gutter")
            assert gutter.count() == 1, f"{child} has a gutter"
            for slot in ("deliv", "people"):
                assert (
                    gutter.locator(f".wb-note-row-slot-{slot}").count() == 1
                ), f"{child} reserves the {slot} slot"
            # The two that left. A regression that puts either back in the row
            # takes the name's width with it.
            for gone in ("hint", "dep"):
                assert gutter.locator(f".wb-note-row-slot-{gone}").count() == 0, (
                    f"the {gone} slot is back in {child}'s gutter"
                )

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

    def test_the_deliverable_badge_lives_in_the_gutter(self, page, app_server):
        """Where it is, not just that it exists.

        The lead zone is the checkbox and nothing else now, so a regression
        that put the badge back before the name would still pass the alignment
        test above -- a reserved slot aligns rows whichever zone it is in.
        What it would cost is the gap this change removed, which is the thing
        worth pinning.
        """
        open_app(page, app_server)
        load_plan(page, PLAN)
        switch_to_whiteboard(page)
        settled(page)

        row = _row(page, "Busy")
        assert row.locator(".wb-note-row-slot-deliv .wb-note-deliverable-badge").count() == 1
        assert row.locator(".wb-note-row-badge").count() == 0, (
            "the lead-zone badge slot is back"
        )

        # And it sits left of the name's own trailing edge -- i.e. in the
        # gutter, not somewhere between the checkbox and the name.
        boxes = page.evaluate(
            """() => {
                const r = document.querySelector(
                    ".wb-note[data-wb-task=Build] .wb-note-row[data-wb-row-task=Busy]");
                const x = (sel) => r.querySelector(sel).getBoundingClientRect().left;
                return {
                    checkbox: x('.wb-note-checkbox'),
                    name: x('.wb-note-row-name'),
                    badge: x('.wb-note-deliverable-badge'),
                };
            }"""
        )
        assert boxes["name"] < boxes["badge"], (
            f"the badge is not past the name: {boxes}"
        )
        # The name starts one row gap after the checkbox, with nothing between.
        assert boxes["name"] - boxes["checkbox"] < 40, (
            f"something is still reserving space before the name: {boxes}"
        )

    def test_names_start_at_the_same_x_whether_or_not_there_is_a_badge(
        self, page, app_server
    ):
        """The deliverable badge used to sit inline before the name.

        It then spent a while in a reserved 15px lead-zone slot, which kept
        names aligned but put an unexplained gap between every checkbox and
        every name. It now leads the *gutter*, which was already a fixed
        width -- so names are aligned and start immediately after the
        checkbox. This asserts the alignment; the test below asserts it is in
        the gutter rather than back in the lead zone.
        """
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

    def test_a_leaf_and_a_summary_end_in_the_same_place(self, page, app_server):
        """The count badge and the dependency handle are mutually exclusive,
        and used to be the reason two rows ended in different places."""
        open_app(page, app_server)
        load_plan(page, PLAN)
        switch_to_whiteboard(page)

        settled(page)
        geometry = row_geometry(page)
        leaf = by_name(geometry, "Bare")["gutter"]
        summary = by_name(geometry, "Summary")["gutter"]
        assert abs((leaf["x"] + leaf["width"]) - (summary["x"] + summary["width"])) < 1.0

        # ...and the count badge is in the name zone, not the gutter, because it
        # describes the task rather than acting on it.
        assert _row(page, "Summary").locator(
            ".wb-note-row-content .wb-note-count-badge"
        ).count() == 1

    def test_only_a_leaf_offers_the_dependency_rail(self, page, app_server):
        """A summary row is never a dependency endpoint, so hovering one shows
        no handle -- the rule that used to be "a summary row has no handle in
        its gutter", now that there is no handle in any gutter."""
        open_app(page, app_server)
        load_plan(page, PLAN)
        switch_to_whiteboard(page)
        settled(page)

        rail = note(page, "Build").locator(".wb-note-rail-dep")

        _row(page, "Summary").hover(force=True)
        page.wait_for_timeout(150)
        assert rail.evaluate("n => n.hidden") is True, (
            "a summary row is offering a dependency handle"
        )

        _row(page, "Bare").hover(force=True)
        page.wait_for_function(
            "() => !document.querySelector("
            "  '.wb-note[data-wb-task=Build] .wb-note-rail-dep').hidden"
        )


class TestNoLayoutShift:
    def test_hovering_a_row_moves_nothing(self, page, app_server):
        """The quick-assign control reveals on hover. It must do that by
        opacity, not by taking width -- nothing in the row may move under the
        pointer. (The rails cannot break this: they are outside the card and
        take no part in its layout, which is half of why they are out there.)"""
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

        # The chips live in <np-resource-stack>'s shadow root since #1246, so
        # they are counted through it rather than in the light DOM.
        stack = _row(page, "Busy").locator(".wb-note-row-slot-people .wb-note-row-avatar")
        assert stack.count() == 1, "one stack, not a run of chips"
        counts = stack.evaluate(
            "n => ({ chips: n.shadowRoot.querySelectorAll('.chip:not(.more)').length,"
            "        more: n.shadowRoot.querySelector('.chip.more')?.textContent ?? null })"
        )
        assert counts["chips"] == 3, f"capped at three: {counts}"
        assert counts["more"] == "+2", f"the remainder is shown, not dropped: {counts}"

    def test_a_row_with_nobody_on_it_renders_no_chip(self, page, app_server):
        open_app(page, app_server)
        load_plan(page, PLAN)
        switch_to_whiteboard(page)

        people = _row(page, "Bare").locator(".wb-note-row-slot-people")
        assert people.locator(".wb-note-row-avatar").count() == 0, (
            "a row with nobody on it renders no stack at all"
        )
        # The slot is still there, holding its width.
        assert people.count() == 1


class TestDegradation:
    """Documented, in a fixed order, by card width. Each tier drops the least
    load-bearing thing left, and the name keeps a floor throughout."""

    def _resize(self, page, width):
        """Rewrite the note's Width cell in the `---whiteboard---` table.

        Matched by position -- the cell before the Height of 300 -- rather than
        by its current value, so a test can step down the tiers with more than
        one call. Anchoring on the literal `| 280 ` only worked once: a second
        call found nothing to replace and waited out its timeout against a note
        that had not moved.
        """
        page.evaluate(
            """w => {
                const plan = document.getElementById('planEditor');
                plan.value = plan.value.replace(
                    /\\| *\\d+( *)\\| *300 /, `| ${w}$1| 300 `);
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

    def test_the_ladder_has_one_step_and_the_deliverable_is_on_it(
        self, page, app_server
    ):
        """There used to be two tiers: 240px dropped the planning hint, 200px
        dropped the deliverable and tightened everything else. The hint is a
        rail now, which a narrow note does not pay for, so the 240px tier had
        nothing left to give up and is gone. A 220px note keeps everything."""
        open_app(page, app_server)
        load_plan(page, PLAN)
        switch_to_whiteboard(page)
        settled(page)

        deliv = _row(page, "Busy").locator(".wb-note-row-slot-deliv")
        assert deliv.count() == 1, "the slot is in the DOM at every tier"

        self._resize(page, 220)
        assert _box(deliv)["width"] > 1.0, (
            "220px is above the one tier, so the deliverable still reserves"
        )

        self._resize(page, 180)
        assert _box(deliv)["width"] < 1.0, (
            "below 200px only its reserved width goes to zero -- the slot stays"
        )
        assert deliv.count() == 1

    def test_nothing_is_clipped_at_the_minimum_note_width(self, page, app_server):
        open_app(page, app_server)
        load_plan(page, PLAN)
        switch_to_whiteboard(page)
        settled(page)
        self._resize(page, 160)

        card = _box(note(page, "Build").locator(".wb-note-card"))
        for child in ("Busy", "Bare"):
            row = _row(page, child)
            for selector in (".wb-note-row-name", ".wb-note-row-slot-people",
                             ".wb-note-row-gutter"):
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


class TestTheRailsAreOutsideTheNote:
    """Where the two relocated controls actually are.

    "Outside the card" is the whole mechanism: the width they used to reserve
    is what the name got, so a regression that put them back inside -- even
    correctly aligned, even still hover-revealed -- undoes the change while
    every other test here still passes.

    They are a sibling of `.wb-note-card` rather than a child of it because the
    card is `overflow: hidden` and the body is `overflow-x: hidden`, so a rail
    drawn within either would be clipped at the card's edge by one rule or the
    other.
    """

    def _rails(self, page, child):
        _row(page, child).hover(force=True)
        page.wait_for_function(
            "() => { const r = document.querySelector("
            "  '.wb-note[data-wb-task=Build] .wb-note-rail-dep'); return r && !r.hidden; }"
        )
        return page.evaluate(
            """() => {
                const fo = document.querySelector(".wb-note[data-wb-task='Build']");
                const card = fo.querySelector('.wb-note-card');
                const box = (el) => {
                    const r = el.getBoundingClientRect();
                    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
                };
                const dep = fo.querySelector('.wb-note-rail-dep');
                return {
                    card: box(card),
                    dep: box(dep),
                    depInsideCard: card.contains(dep),
                    row: box(fo.querySelector('.wb-note-row[data-wb-row-task="Bare"]')),
                };
            }"""
        )

    def test_the_dependency_rail_is_drawn_past_the_card_s_edge(
        self, page, app_server
    ):
        open_app(page, app_server)
        load_plan(page, PLAN)
        switch_to_whiteboard(page)
        settled(page)

        m = self._rails(page, "Bare")
        assert m["depInsideCard"] is False, (
            "the dependency rail is a descendant of the card again, where the "
            "card's own overflow will clip it"
        )
        assert m["dep"]["left"] >= m["card"]["right"] - 1.0, (
            f"the dependency rail overlaps the card: {m['dep']} vs {m['card']}"
        )

    def test_it_sits_level_with_the_row_it_serves(self, page, app_server):
        open_app(page, app_server)
        load_plan(page, PLAN)
        switch_to_whiteboard(page)
        settled(page)

        m = self._rails(page, "Bare")
        rail_mid = (m["dep"]["top"] + m["dep"]["bottom"]) / 2
        row_mid = (m["row"]["top"] + m["row"]["bottom"]) / 2
        assert abs(rail_mid - row_mid) < 2.0, (
            f"the rail is not level with its row: rail={rail_mid} row={row_mid}"
        )


class TestTheNameGetsTheRoom:
    def test_a_default_note_shows_a_name_it_used_to_truncate(self, page, app_server):
        """The reported symptom, asserted rather than described.

        With four reserved gutter slots a 260px note gave the name under 30px,
        so `Sign off requirements` rendered as `Sign of...` -- and so did every
        other name, because the truncation had nothing to do with the name's
        length. Two slots left for the rails and the third is reserved per note
        rather than for the worst case in the app.
        """
        open_app(page, app_server)
        load_plan(
            page,
            PLAN.replace("    Bare 1d", "    Sign off requirements @sam 1d"),
        )
        switch_to_whiteboard(page)
        settled(page)

        name = _row(page, "Sign off requirements").locator(".wb-note-row-name")
        assert name.evaluate("n => n.scrollWidth <= n.clientWidth + 1") is True, (
            "the task name is truncated on a default-width note: "
            + str(name.evaluate("n => [n.scrollWidth, n.clientWidth]"))
        )
