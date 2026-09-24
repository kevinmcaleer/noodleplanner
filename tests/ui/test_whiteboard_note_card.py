"""The post-it card itself: its ink, its inset and its title (issue #1250).

Eight sibling sub-issues under epic #1241 cover the checklist row, the menu,
the checkbox and the avatar stack. The *card* -- header, title, colour and the
rhythm running down it -- had never had a consolidation pass, and the evidence
was measurable rather than aesthetic:

*   Five hand-picked `opacity` values de-emphasised text on the note, three of
    them below their WCAG threshold once composited over the fill: the empty
    state at 4.29:1, the add-row placeholder at 3.31:1 and the add "+" at
    2.58:1. They are one two-step ink ladder now, both steps measured against
    the whole palette in scripts/check-contrast.mjs.
*   The dividers, the row hover, the resize grip and the avatar ring all took
    *theme* tokens -- values chosen against --np-surface -- and painted them on
    a *pastel*. `--np-text-muted` on #F7A8B8 in dark mode is 1.07:1.
*   Three horizontal insets (10, 12, 8) meant nothing on the card lined up
    with anything else, including the title with the rows beneath it.
*   Below 40% zoom the card degrades to title-only, which hid the body and the
    footer and left six icon buttons rendering at ~9px around the one thing
    that tier exists to show.

These tests are about those invariants, not about particular pixel values: a
ratio clears its threshold, two edges agree, a box does not move. Geometry is
read through bounding boxes for the reason tests/ui/test_task_peek.py's
docstring gives -- the whiteboard is a pan/zoom canvas and these notes sit
outside the visible pane.

Usage:
    uv run pytest tests/ui/test_whiteboard_note_card.py -q
"""

import pytest

from .helpers import load_plan, note, open_app, switch_to_whiteboard

PLAN = """---
title: Note Card Test Plan
Resources:
  - @sam: Sam Smith, Developer
  - @jo: Jo Lee, Reviewer
---

Phase 1
  Build
    Draft the brief @sam 2d
    Review it @jo 1d
  Loose Idea

---whiteboard---
| Task       | X   | Y   | Colour  | Width | Height | Collapsed |
|------------|-----|-----|---------|-------|--------|-----------|
| Build      | 480 | 80  | #F7A8B8 | 280   | 300    | no        |
| Loose Idea | 480 | 420 | #FFF3B0 | 280   | 200    | no        |
"""

# The worst swatch in the palette for a near-black ink, and therefore the one
# every threshold below is measured on. scripts/check-contrast.mjs scores all
# ten; this file only needs the one that fails first.
WORST_SWATCH = "#F7A8B8"


def settled(page, task="Build", width=280):
    """Wait until the card has reached the width the plan's table asks for.

    A note is drawn at its default size (WB_NOTE_DEFAULT_WIDTH = 260) and
    resized from the `---whiteboard---` table a moment later, so a measurement
    taken across that boundary can even straddle two container-query tiers.

    `offsetWidth`, not `getBoundingClientRect().width`: the board is a
    zoom-transformed canvas, so the rect is the *scaled* width and the default
    260 reads as 280 at a zoom of 1.077 -- which is exactly the width this
    would then wait for, returning while the card is still at its default size
    and in whichever tier that puts it. `offsetWidth` is layout pixels and
    unaffected by the transform. Under `-n 4` that difference is the gap
    between a test that passes and one that reads the wrong card.
    """
    page.wait_for_function(
        "([t, w]) => { const c = document.querySelector("
        "  `.wb-note[data-wb-task='${t}'] .wb-note-card`);"
        "  return c && Math.abs(c.offsetWidth - w) < 2; }",
        arg=[task, width],
    )


def board(page, plan=PLAN, expected_notes=2, task="Build", width=280):
    load_plan(page, plan)
    switch_to_whiteboard(page, expected_notes=expected_notes)
    settled(page, task=task, width=width)


def contrast(page, task, selector, *, prop="color"):
    """The rendered contrast of one element on a note against the card's fill.

    Composited, not nominal: the ink ladder is `color-mix(... transparent)`,
    so `getComputedStyle` hands back a colour with an alpha channel and the
    browser paints it over the card. Scoring the raw value would report a
    70% ink as if it were opaque -- which is exactly the mistake the five
    `opacity` declarations this replaces made invisible.
    """
    return page.evaluate(
        """([task, selector, prop]) => {
            const card = document.querySelector(
                `.wb-note[data-wb-task='${task}'] .wb-note-card`);
            const el = card.querySelector(selector);
            if (!el) return null;
            const parse = (s) => {
                const n = s.match(/[\\d.]+/g).map(Number);
                return { r: n[0], g: n[1], b: n[2], a: n.length > 3 ? n[3] : 1 };
            };
            const chan = (c) => {
                const s = c / 255;
                return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
            };
            const lum = (c) =>
                0.2126 * chan(c.r) + 0.7152 * chan(c.g) + 0.0722 * chan(c.b);
            const bg = parse(getComputedStyle(card).backgroundColor);
            const raw = parse(getComputedStyle(el).getPropertyValue(prop));
            const fg = {
                r: raw.r * raw.a + bg.r * (1 - raw.a),
                g: raw.g * raw.a + bg.g * (1 - raw.a),
                b: raw.b * raw.a + bg.b * (1 - raw.a),
            };
            const [hi, lo] = lum(fg) > lum(bg) ? [lum(fg), lum(bg)] : [lum(bg), lum(fg)];
            return (hi + 0.05) / (lo + 0.05);
        }""",
        [task, selector, prop],
    )


class TestInkLadder:
    """Everything quieter than the note's text is legible on the worst swatch.

    `Build` is filled with #F7A8B8 by the plan above precisely because it is
    the swatch that fails first: if these pass here they pass on the other
    nine. The thresholds are WCAG 2.2's -- 4.5:1 for text, 3:1 for a non-text
    glyph under SC 1.4.11.
    """

    @pytest.mark.parametrize(
        "selector,minimum,what",
        [
            (".wb-note-title", 4.5, "the title"),
            (".wb-note-row-name", 4.5, "a task name"),
            (".wb-note-progress", 4.5, "the footer's progress count"),
            (".wb-note-add-input", 4.5, "the add row's input"),
        ],
    )
    def test_note_text_clears_its_threshold_on_the_worst_swatch(
        self, page, app_server, selector, minimum, what
    ):
        open_app(page, app_server)
        board(page)

        ratio = contrast(page, "Build", selector)
        assert ratio is not None, f"{what} ({selector}) does not render on this note"
        assert ratio >= minimum, (
            f"{what} reaches only {ratio:.2f}:1 on {WORST_SWATCH}, below {minimum}:1"
        )

    def test_the_empty_state_clears_aa(self, page, app_server):
        # A checklist note with no children renders `.wb-note-empty` where its
        # rows would be. `Loose Idea` has none, but it is free-form, so give
        # the plan a childless *summary* instead.
        open_app(page, app_server)
        board(
            page,
            PLAN.replace("    Draft the brief @sam 2d\n", "")
                .replace("    Review it @jo 1d\n", ""),
        )
        ratio = contrast(page, "Build", ".wb-note-empty, .wb-note-freetext")
        if ratio is not None:
            assert ratio >= 4.5, f"the empty state reaches only {ratio:.2f}:1"

    def test_the_resize_grip_is_visible_on_the_worst_swatch(self, page, app_server):
        # Drawn from --np-border gradients before #1250: a theme hairline on a
        # pastel fill, 1.1-1.9:1, on the one drag target with no long-press
        # fallback. It is the note's own faint ink now.
        open_app(page, app_server)
        board(page)
        grip = page.evaluate(
            """() => {
                const card = document.querySelector(
                    ".wb-note[data-wb-task='Build'] .wb-note-card");
                const el = card.querySelector('.wb-note-resize-handle');
                return el ? getComputedStyle(el).backgroundImage : null;
            }"""
        )
        assert grip, "the resize grip has no gradient"
        # The card's ink is near-black on every shipped swatch, so the grip's
        # stops must not be the warm theme hairline any more.
        assert "227, 221, 211" not in grip, (
            "the resize grip is still drawn in --np-border (#E3DDD3)"
        )


class TestOneHorizontalInset:
    """The title, the rows and the footer start at the same x.

    Before this the header's text sat at 10px from the card edge, the rows at
    12 and the empty state at 8 -- three insets down one 220px card.
    """

    def test_title_rows_and_footer_share_a_left_edge(self, page, app_server):
        open_app(page, app_server)
        board(page)

        # Content edges, not box edges: each band reaches the inset by its own
        # route -- the header by 10 of its own padding plus 2 on the title,
        # the body by 8 plus the row's 4 -- so what has to agree is where the
        # first glyph lands, which is box left plus that element's padding.
        edges = page.evaluate(
            """() => {
                const card = document.querySelector(
                    ".wb-note[data-wb-task='Build'] .wb-note-card");
                const left = card.getBoundingClientRect().left;
                const at = (sel) => {
                    const el = card.querySelector(sel);
                    if (!el) return null;
                    const pad = parseFloat(getComputedStyle(el).paddingLeft) || 0;
                    return el.getBoundingClientRect().left + pad - left;
                };
                return {
                    title: at('.wb-note-title'),
                    row: at('.wb-note-row'),
                    add: at('.wb-note-add-row'),
                    footer: at('.wb-note-progress'),
                };
            }"""
        )
        assert all(v is not None for v in edges.values()), edges
        spread = max(edges.values()) - min(edges.values())
        assert spread <= 1.5, (
            f"the card's bands start at different x positions: {edges}"
        )


class TestAddRowAlignment:
    """The add row's lead zone is the checklist row's lead zone.

    `.wb-note-add-row` must stay a separate rule from `.wb-note-row` -- the
    reason is in wbBuildAddChildRow()'s comment -- which is exactly why the
    two can drift, and why this measures rather than trusts.
    """

    def test_the_plus_and_the_input_line_up_with_the_rows_above(
        self, page, app_server
    ):
        open_app(page, app_server)
        board(page)

        geometry = page.evaluate(
            """() => {
                const card = document.querySelector(
                    ".wb-note[data-wb-task='Build'] .wb-note-card");
                const box = (el) => {
                    const r = el.getBoundingClientRect();
                    return { left: r.left, right: r.right, width: r.width };
                };
                const row = card.querySelector('.wb-note-row');
                const add = card.querySelector('.wb-note-add-row');
                return {
                    checkbox: box(row.querySelector('.wb-note-checkbox')),
                    name: box(row.querySelector('.wb-note-row-name')),
                    input: box(add.querySelector('.wb-note-add-input')),
                    glyph: add.querySelector('.wb-note-add-icon'),
                };
            }"""
        )

        # The leading "+" is gone: it repeated the placeholder beside it, in a
        # column that means "tick this", on a row that cannot be ticked.
        assert geometry["glyph"] is None, "the add row still renders a + glyph"

        # Sub-pixel, because the board is a zoom-transformed canvas: the same
        # tolerance tests/ui/test_whiteboard_row_layout.py uses.
        assert abs(geometry["input"]["left"] - geometry["name"]["left"]) < 1.5, (
            f"'Add task…' does not start at the task-name column: {geometry}"
        )

    def test_it_hovers_like_a_real_task_row(self, page, app_server):
        """The add row is one more line of the list, so it lights up like one.

        Asserted by comparing the two computed backgrounds rather than by
        naming a colour, because the point is that they *agree* -- both come
        from `--wb-note-hover`, mixed from the note's own ink, so a literal
        here would just be a second place to update.

        This exists because the rule went missing and nothing noticed for
        three merges. The commit that was meant to drop only the
        `:focus-within` half of the add row's hover removed the whole rule,
        as collateral from a scripted deletion of the neighbouring
        `.wb-note-add-icon` block. A removed rule adds no design-lint
        violation and no test named this behaviour, so the add row simply
        stopped responding to the pointer while every row above it still did.
        """
        open_app(page, app_server)
        board(page)

        def background(selector):
            return page.evaluate(
                """(sel) => {
                    const card = document.querySelector(
                        ".wb-note[data-wb-task='Build'] .wb-note-card");
                    return getComputedStyle(card.querySelector(sel)).backgroundColor;
                }""",
                selector,
            )

        row_rest = background(".wb-note-row")
        add_rest = background(".wb-note-add-row")
        assert row_rest == add_rest, (
            f"they already differ at rest: row={row_rest} add={add_rest}"
        )

        # Hover each in turn and read the background back. `hover()` scrolls
        # the note into view, so both reads are taken after their own hover
        # rather than compared across one.
        note(page, "Build").locator(".wb-note-row").first.hover()
        row_hot = background(".wb-note-row")
        note(page, "Build").locator(".wb-note-add-row").hover()
        add_hot = background(".wb-note-add-row")

        assert row_hot != row_rest, (
            f"the checklist row itself stopped responding to hover: {row_hot}"
        )
        assert add_hot == row_hot, (
            "the add row does not hover like a task row: "
            f"add={add_hot} row={row_hot}"
        )

    def test_they_still_line_up_at_the_narrow_tier(self, page, app_server):
        # Below 200px the container query collapses the badge slot to 0 and
        # halves the row gap. The add row reserves both from the same custom
        # properties, so it has to follow -- it did not until it was named
        # alongside `.wb-note-row` in those queries.
        open_app(page, app_server)
        board(page, PLAN.replace("| 280   | 300", "| 180   | 300"), width=180)

        offsets = page.evaluate(
            """() => {
                const card = document.querySelector(
                    ".wb-note[data-wb-task='Build'] .wb-note-card");
                const left = card.getBoundingClientRect().left;
                const at = (sel) =>
                    card.querySelector(sel).getBoundingClientRect().left - left;
                return {
                    name: at('.wb-note-row .wb-note-row-name'),
                    input: at('.wb-note-add-input'),
                };
            }"""
        )
        assert abs(offsets["input"] - offsets["name"]) < 1.5, (
            f"the add row drifts from the checklist rows at the narrow tier: {offsets}"
        )


class TestTheAddRowIsBareLikeATaskRow:
    """The add row has been asked to look like the rows above it more than
    once, and it has been fixed in this file more than once. It kept coming
    back as a form field because every fix wrote the right declarations into a
    selector that loses the cascade.

    `.wb-note-add-input` is (0,1,0). Two global element rules outrank it and
    both reach inside a whiteboard note:

        views/gantt.css      input[type="text"]                          (0,1,1)
        visual-system.css    :root body :is(..., input[type="text"], ...) (0,2,2)

    Between them they drew a --np-paper fill, a 1px --np-border-strong edge, a
    --np-radius-control corner, 12px of padding and 14px type. No gate saw it:
    check-contrast scores token pairings rather than rendered elements, and
    lint:design reads declarations rather than the cascade, so a rule that is
    written correctly and then overruled looks clean to both.

    These read the *computed* style, which is the only thing that could have
    caught it, and compare against a real task row rather than naming values --
    "the same as the others" is the actual requirement.
    """

    @staticmethod
    def _pair(page):
        return page.evaluate(
            """() => {
                const card = document.querySelector(
                    ".wb-note[data-wb-task='Build'] .wb-note-card");
                const pick = (el) => {
                    const s = getComputedStyle(el);
                    return {
                        background: s.backgroundColor,
                        borderWidth: s.borderTopWidth,
                        borderStyle: s.borderTopStyle,
                        radius: s.borderTopLeftRadius,
                        padding: s.paddingTop + ' ' + s.paddingLeft,
                        fontSize: s.fontSize,
                        fontFamily: s.fontFamily,
                        colour: s.color,
                    };
                };
                return {
                    input: pick(card.querySelector('.wb-note-add-input')),
                    name: pick(card.querySelector('.wb-note-row .wb-note-row-name')),
                };
            }"""
        )

    def test_it_has_no_fill_no_edge_and_no_padding_of_its_own(
        self, page, app_server
    ):
        open_app(page, app_server)
        board(page)
        got = self._pair(page)["input"]

        assert got["background"] == "rgba(0, 0, 0, 0)", (
            f"the add row is filled again: {got['background']}"
        )
        assert got["borderWidth"] == "0px" or got["borderStyle"] == "none", (
            f"the add row has an edge again: {got}"
        )
        assert got["radius"] == "0px", f"the add row has a corner again: {got['radius']}"
        assert got["padding"] == "0px 0px", (
            f"the add row is padded like a form field again: {got['padding']}"
        )

    def test_it_is_set_in_the_same_type_as_a_task_name(self, page, app_server):
        open_app(page, app_server)
        board(page)
        pair = self._pair(page)

        assert pair["input"]["fontSize"] == pair["name"]["fontSize"], (
            f"the add row is not the row's type size: {pair}"
        )
        assert pair["input"]["fontFamily"] == pair["name"]["fontFamily"], (
            f"the add row is not the row's typeface: {pair}"
        )
        assert pair["input"]["colour"] == pair["name"]["colour"], (
            f"the add row is not the note's ink: {pair}"
        )


class TestTypingIsThePromotion:
    """A note becomes a summary task by gaining a task, not by being told to.

    The header used to carry a quick-promote button (#1107) beside the `...`
    menu, shown on free-form notes only. It existed because the "Add task…"
    row was withheld from exactly those notes -- so the one kind of note with
    no structure was the one kind that could not be given any without first
    pressing something. The row is on every note now, and typing into it *is*
    the promotion: the task typed becomes the note's first child, and having a
    child is what wbIsFreeformNote() means.

    So the button is gone, and these are the two halves of what replaced it.
    """

    def test_the_header_offers_no_promote_button(self, page, app_server):
        open_app(page, app_server)
        board(page)

        for task in ("Build", "Loose Idea"):
            header = note(page, task).locator(".wb-note-header")
            assert header.locator(".wb-note-promote-btn").count() == 0, (
                f"{task}'s header is offering a promote button again"
            )

    def test_a_free_form_note_offers_the_add_row(self, page, app_server):
        """"Loose Idea" has no children, so it renders free-form: no checklist,
        no footer, no "No subtasks yet". It still gets the row, because that is
        its way out."""
        open_app(page, app_server)
        board(page, task="Loose Idea", width=280)

        card = note(page, "Loose Idea").locator(".wb-note-card")
        assert card.evaluate("c => c.classList.contains('wb-note-freeform')"), (
            "Loose Idea has children now -- the plan changed and this test with it"
        )
        assert card.locator(".wb-note-add-input").count() == 1

    def test_typing_one_task_turns_the_note_into_a_summary_task(
        self, page, app_server
    ):
        open_app(page, app_server)
        board(page, task="Loose Idea", width=280)

        card = note(page, "Loose Idea").locator(".wb-note-card")
        card.locator(".wb-note-add-input").click()
        page.keyboard.type("Sketch the flow")
        page.keyboard.press("Enter")

        # The note stops being free-form and starts being a checklist with the
        # typed task on it. Waited for rather than asserted outright: the
        # commit goes through renderText(), which rebuilds the card.
        page.wait_for_function(
            """() => {
                const c = document.querySelector(
                    ".wb-note[data-wb-task='Loose Idea'] .wb-note-card");
                return c && !c.classList.contains('wb-note-freeform');
            }"""
        )
        names = card.locator(".wb-note-row-name").all_text_contents()
        assert [n.strip() for n in names] == ["Sketch the flow"], names

        # And the row is still there, ready for the next one -- the gesture is
        # repeatable, which is the thing a one-shot promote button never was.
        assert card.locator(".wb-note-add-input").count() == 1


class TestTheResourceChip:
    """The avatar chip is the hardest text on the board to read -- two capitals
    inside a 20px circle -- so it takes the strongest pairing the app has and
    is given room to sit in.

    It was a 14px circle carrying 6.3px initials in near-black on a mid blue.
    The ratio passed 4.5:1, which is why nothing flagged it; the type was
    smaller than anything else the app renders, which is why everyone could
    see it was wrong.
    """

    @staticmethod
    def _chip(page):
        return page.evaluate(
            r"""() => {
                const card = document.querySelector(
                    ".wb-note[data-wb-task='Build'] .wb-note-card");
                const stack = card.querySelector('.wb-note-row-avatar');
                const chip = stack.shadowRoot.querySelector('.chip');
                const cs = getComputedStyle(chip);
                // Layout pixels: the board is zoom-transformed, so every rect
                // here is divided back out by the card's own scale.
                const scale = card.getBoundingClientRect().height / card.offsetHeight;
                const box = chip.getBoundingClientRect();
                const range = document.createRange();
                range.selectNodeContents(chip);
                const text = range.getBoundingClientRect();
                const parse = (c) => c.match(/[\d.]+/g).map(Number);
                const chan = (v) => {
                    const x = v / 255;
                    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
                };
                const lum = (c) => 0.2126 * chan(c[0]) + 0.7152 * chan(c[1]) + 0.0722 * chan(c[2]);
                const a = lum(parse(cs.color));
                const b = lum(parse(cs.backgroundColor));
                const diameter = box.width / scale;
                const border = parseFloat(cs.borderTopWidth) || 0;
                return {
                    diameter,
                    contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
                    padding: parseFloat(cs.paddingTop) || 0,
                    // Gap from the glyphs to the inside of the ring, per side.
                    clearance: ((diameter - 2 * border) - text.width / scale) / 2,
                };
            }"""
        )

    def test_the_initials_are_high_contrast_on_the_chip(self, page, app_server):
        open_app(page, app_server)
        board(page)
        chip = self._chip(page)
        assert chip["contrast"] >= 4.5, (
            f"the initials are {chip['contrast']:.2f}:1 on their chip"
        )

    def test_the_chip_is_big_enough_to_read(self, page, app_server):
        """Rounded, not compared raw: `diameter` is a zoom-scaled rect divided
        back out by the card's own scale, so a 20px chip lands on 19.9999 as
        often as on 20. Asserting the exact bound made this fail on CI at
        1e-4 of a pixel, which is not the thing the test is about."""
        open_app(page, app_server)
        board(page)
        diameter = self._chip(page)["diameter"]
        assert round(diameter) >= 20, (
            f"the chip is back under 20px ({diameter:.2f}), which puts the "
            "initials below the smallest type the app renders anywhere else"
        )

    def test_the_initials_do_not_touch_the_edge(self, page, app_server):
        """Two bold capitals set to half the diameter run right into the curve,
        which is where a circle reads as cramped rather than merely small."""
        open_app(page, app_server)
        board(page)
        chip = self._chip(page)
        assert chip["padding"] >= 2, f"the chip lost its padding: {chip}"
        assert chip["clearance"] >= 2, (
            f"the initials sit {chip['clearance']:.2f}px from the ring; "
            "they should clear it by at least the chip's own padding"
        )


class TestNoLinkedNoteFootnote:
    """A note whose child has been noodled onto the board used to grow a
    "+ 1 linked note" caption, between its last real task and the row you type
    the next one into -- so the one place on the card that should read as "the
    list continues here" read as "the list ended, and here is a footnote".

    The board says it better: the child has a post-it of its own with a noodle
    drawn to it, in view, at the moment you are looking at either.
    """

    PLAN = """---
title: Linked Note Test Plan
---

Phase 1
  Build
    Drafted here 1d
    Also here 1d
    Left home 1d

---whiteboard---
| Task       | X   | Y   | Colour | Width | Height | Collapsed |
|------------|-----|-----|--------|-------|--------|-----------|
| Build      | 480 | 80  |        | 280   | 300    | no        |
| Left home  | 480 | 420 |        | 280   | 200    | no        |
"""

    def test_a_note_with_a_child_on_the_board_grows_no_caption(
        self, page, app_server
    ):
        open_app(page, app_server)
        board(page, self.PLAN, expected_notes=2)

        card = note(page, "Build").locator(".wb-note-card")
        # The premise: `Left home` really is on the board, so `Build` really
        # does have a linked child and really would have grown the caption.
        assert note(page, "Left home").count() == 1
        rows = card.locator(".wb-note-row-name").all_text_contents()
        assert "Left home" not in [r.strip() for r in rows], (
            "the child is still listed as a row, so this note has no linked "
            "child and the test is not exercising anything"
        )

        assert card.locator(".wb-note-linked-summary").count() == 0, (
            "the linked-note footnote is back"
        )

    def test_the_add_row_follows_the_last_task_directly(self, page, app_server):
        open_app(page, app_server)
        board(page, self.PLAN, expected_notes=2)

        order = page.evaluate(
            """() => [...document.querySelector(
                  ".wb-note[data-wb-task='Build'] .wb-note-body").children]
                .map(n => n.className)"""
        )
        assert order[-1] == "wb-note-add-row", order
        assert order[-2] == "wb-note-row", (
            f"something sits between the last task and the add row: {order}"
        )


class TestTitleOnlyTier:
    """Below 40% zoom the card is a title, not a title and six buttons."""

    # `Collapsed | yes` rather than a hand-added class: wbNoteZoomTier()
    # returns title-only for a collapsed row at any zoom, and wbUpdateNoteNode()
    # re-derives the class on every render pass -- so a class poked on from a
    # test is removed again by the next one, which under `-n 4` is likely
    # enough to fail about half the time.
    COLLAPSED_PLAN = PLAN.replace(
        "| Build      | 480 | 80  | #F7A8B8 | 280   | 300    | no        |",
        "| Build      | 480 | 80  | #F7A8B8 | 280   | 300    | yes       |",
    )

    def test_the_contextual_buttons_go_with_the_body(self, page, app_server):
        open_app(page, app_server)
        board(page, self.COLLAPSED_PLAN)
        page.wait_for_selector(
            ".wb-note[data-wb-task='Build'] .wb-note-card.wb-note-title-only"
        )

        shown = page.evaluate(
            """() => {
                const card = document.querySelector(
                    ".wb-note[data-wb-task='Build'] .wb-note-card");
                const visible = (sel) => {
                    const el = card.querySelector(sel);
                    return !!el && getComputedStyle(el).display !== 'none';
                };
                return {
                    coach: visible('.wb-note-coach-btn'),
                    link: visible('.wb-note-link-handle'),
                    body: visible('.wb-note-body'),
                };
            }"""
        )
        assert shown["coach"] is False, "the coach button survives the title-only tier"
        assert shown["body"] is False, "the body should already be hidden at this tier"
        # The one worth hitting at 40%: noodling two distant notes together is
        # what you zoom out to do. (The menu is on the object toolbar now,
        # which floats outside the card at a fixed size.)
        assert shown["link"] is True, "the link handle must survive the title-only tier"


class TestHeaderGrabPoint:
    """What sits under the centre of a note's header.

    The header is a right-aligned button cluster with a `flex: 1` title
    taking the slack, so the cluster spans past the header's own midpoint
    whenever it is wider than half the header. On the declared sizes that is
    now a question of one tier: three 22px buttons and two 6px gaps is a
    78px cluster, which clears a 260px header's midpoint but not a 160px
    one's (a 160px card needs the cluster under ~70px). So the midpoint
    lands on a control at the narrowest tier only, and what that costs
    depends entirely on *which* control.

    For every button but one it costs a dead spot: wbNoteHeaderMouseDown()
    returns early on it, no drag starts, and the note does not move. The link
    handle is the exception -- it carries its own mousedown listener that
    begins a *link* drag, and wbFinishDrag()'s park branch requires
    `drag.type === 'move'`, so a note dragged from that point to the parking
    lot is silently not parked. That regression has shipped once before; see
    tests/ui/test_whiteboard_parking_lot.py's comment.

    The two tests below are that split.
    """

    @pytest.mark.parametrize("width", [160, 260])
    @pytest.mark.parametrize("task", ["Build", "Loose Idea"])
    def test_the_midpoint_never_lands_on_the_link_handle(
        self, page, app_server, task, width
    ):
        """The one case that starts the wrong gesture, closed by construction.

        Since #1250 the link handle is the header's last child. As the final
        item of a right-aligned cluster it occupies [W - 10 - w, W - 10], and
        the midpoint W/2 can only fall inside that when W <= 2 * (10 + w) --
        64px for the 22px fine-pointer handle, 80px for the 30px coarse one.
        WB_NOTE_MIN_WIDTH is 160, so no note can be resized to where it holds.
        This is the arithmetic, run.
        """
        open_app(page, app_server)
        board(
            page,
            PLAN.replace("| 280   |", f"| {width}   |"),
            task=task,
            width=width,
        )

        assert self._control_at_midpoint(page, task) != ".wb-note-link-handle", (
            f"at {width}px the centre of {task!r}'s header is on the link handle "
            "-- grabbing it starts a link drag instead of a move, and a drag to "
            "the parking lot silently does not park"
        )

    # 160px used to be an xfail: its midpoint landed on the coach button
    # while the header still carried a `...` menu button as well. The menu
    # moved to the object toolbar (whiteboard-object-toolbar.js), and the
    # cluster that is left clears the midpoint at every tier.
    @pytest.mark.parametrize(
        "width",
        [
            160,
            260,
        ],
    )
    @pytest.mark.parametrize("task", ["Build", "Loose Idea"])
    def test_the_midpoint_is_dead_space(self, page, app_server, task, width):
        open_app(page, app_server)
        board(
            page,
            PLAN.replace("| 280   |", f"| {width}   |"),
            task=task,
            width=width,
        )

        hit = self._control_at_midpoint(page, task)
        assert hit is None, (
            f"at {width}px the centre of {task!r}'s header lands on {hit}, so a "
            "press there is swallowed and the note does not move"
        )

    @staticmethod
    def _control_at_midpoint(page, task):
        return page.evaluate(
            """(task) => {
                const card = document.querySelector(
                    `.wb-note[data-wb-task='${task}'] .wb-note-card`);
                const header = card.querySelector('.wb-note-header');
                const r = header.getBoundingClientRect();
                const cx = r.left + r.width / 2;
                const cy = r.top + r.height / 2;
                const controls = [
                    '.wb-note-link-handle',
                    '.wb-note-coach-btn', '.wb-note-smart-btn',
                ];
                for (const sel of controls) {
                    for (const el of header.querySelectorAll(sel)) {
                        if (getComputedStyle(el).display === 'none') continue;
                        const b = el.getBoundingClientRect();
                        if (cx >= b.left && cx <= b.right
                            && cy >= b.top && cy <= b.bottom) return sel;
                    }
                }
                return null;
            }""",
            task,
        )
