"""The object toolbar: quick actions floating above one selected note or group.

Obsidian's canvas puts a small toolbar over whatever you select -- colour,
zoom to, edit, delete -- and this board now does the same. It replaced the
`...` button every note used to carry in its header; the note's More button
on the toolbar opens that same menu, so nothing it offered went away.

Usage:
    uv run pytest tests/ui/test_whiteboard_object_toolbar.py -q
"""

from .helpers import load_plan, note, open_app, plan_text, switch_to_whiteboard

PLAN = """---
title: Toolbar Test Plan
---

Alpha
  Alpha one
Beta
  Beta one
Gamma
  Gamma one

---whiteboard---
| Task  | X   | Y   | Colour | Width | Height | Collapsed |
|-------|-----|-----|--------|-------|--------|-----------|
| Alpha | 60  | 120 |        | 240   | 180    | no        |
| Beta  | 360 | 120 |        | 240   | 180    | no        |
| Gamma | 660 | 120 |        | 240   | 180    | no        |
"""

BAR = ".wb-object-toolbar"


def board(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    switch_to_whiteboard(page, expected_notes=3)
    page.evaluate("() => whiteboardZoomFit()")
    page.wait_for_timeout(350)
    page.evaluate(
        "() => wbToggleOutlinePanel(false)"
    )
    page.wait_for_timeout(150)


def actions(page):
    return page.evaluate(
        f"""() => [...document.querySelectorAll('{BAR} .wb-object-toolbar-btn')]
                .map(b => b.dataset.wbAction)"""
    )


def click_header(page, task):
    box = note(page, task).locator(".wb-note-title").bounding_box()
    page.mouse.click(box["x"] + 4, box["y"] + box["height"] / 2)


def make_group(page, name="Discovery"):
    page.evaluate("() => wbSetSelectedNotes(['Alpha', 'Beta'])")
    page.click(".wb-selection-group")
    field = page.locator(".wb-group-title-input")
    field.wait_for(state="visible")
    field.fill(name)
    field.press("Enter")
    page.wait_for_selector(f'.wb-group[data-wb-group="{name}"] .wb-group-box')


class TestNotes:
    def test_hidden_until_a_note_is_selected(self, page, app_server):
        board(page, app_server)
        assert page.locator(BAR).is_hidden()

    def test_selecting_a_note_shows_it_above_the_note(self, page, app_server):
        board(page, app_server)
        click_header(page, "Beta")
        page.wait_for_selector(BAR, state="visible")
        assert actions(page) == ["colour", "zoom", "edit", "remove", "more"]

        bar = page.locator(BAR).bounding_box()
        card = note(page, "Beta").locator(".wb-note-card").bounding_box()
        assert bar["y"] + bar["height"] <= card["y"], "the toolbar sits above the note"
        middle = bar["x"] + bar["width"] / 2
        assert card["x"] <= middle <= card["x"] + card["width"], "centred over the note"

    def test_the_header_has_no_menu_button_any_more(self, page, app_server):
        board(page, app_server)
        assert page.locator(".wb-note-menu-btn").count() == 0

    def test_it_goes_when_the_selection_does(self, page, app_server):
        board(page, app_server)
        page.evaluate("() => wbSetSelectedNote('Beta')")
        page.wait_for_selector(BAR, state="visible")
        page.focus("#whiteboardContainer")
        page.keyboard.press("Escape")
        page.evaluate("() => wbClearNoteSelection()")
        page.wait_for_selector(BAR, state="hidden")

    def test_two_notes_selected_show_the_selection_toolbar_instead(self, page, app_server):
        board(page, app_server)
        page.evaluate("() => wbSetSelectedNotes(['Alpha', 'Beta'])")
        page.wait_for_selector(".wb-selection-toolbar", state="visible")
        assert page.locator(BAR).is_hidden()

    def test_it_follows_the_board_when_it_pans(self, page, app_server):
        board(page, app_server)
        page.evaluate("() => wbSetSelectedNote('Beta')")
        page.wait_for_selector(BAR, state="visible")
        before = page.locator(BAR).bounding_box()
        page.evaluate("() => { wbPanX += 40; wbApplyTransform(false); }")
        page.wait_for_timeout(100)
        after = page.locator(BAR).bounding_box()
        assert abs(after["x"] - before["x"] - 40) <= 1

    def test_colour_opens_the_swatches_and_recolours_the_note(self, page, app_server):
        board(page, app_server)
        page.evaluate("() => wbSetSelectedNote('Beta')")
        page.click(f"{BAR} .wb-object-toolbar-colour")
        page.wait_for_selector("#wbNoteMenu .wb-note-menu-swatch", state="visible")
        page.locator('#wbNoteMenu .wb-note-menu-swatch[title="#FFAFA3"]').click()
        # The note repaints at once; the plan write is debounced behind it.
        page.wait_for_function(
            """() => getComputedStyle(document.querySelector(
                   ".wb-note[data-wb-task='Beta'] .wb-note-card"))
                   .getPropertyValue('--wb-note-accent').trim().toUpperCase() === '#FFAFA3'"""
        )

    def test_edit_starts_renaming_the_title(self, page, app_server):
        board(page, app_server)
        page.evaluate("() => wbSetSelectedNote('Beta')")
        page.click(f"{BAR} .wb-object-toolbar-edit")
        page.wait_for_selector(".wb-note[data-wb-task='Beta'] .wb-note-title.editing")

    def test_remove_takes_the_note_off_the_board_but_keeps_the_task(self, page, app_server):
        board(page, app_server)
        page.evaluate("() => wbSetSelectedNote('Beta')")
        page.click(f"{BAR} .wb-object-toolbar-remove")
        page.wait_for_function("() => !wbNoteNodes.has('Beta')")
        text = plan_text(page)
        board_rows = text.split("---whiteboard---")[1]
        assert "Beta" not in board_rows
        assert "Beta one" in text.split("---whiteboard---")[0], "the task stays in the plan"
        page.wait_for_selector(BAR, state="hidden")

    def test_zoom_to_frames_the_note(self, page, app_server):
        board(page, app_server)
        page.evaluate("() => wbSetSelectedNote('Beta')")
        before = page.evaluate("() => wbZoom")
        page.click(f"{BAR} .wb-object-toolbar-zoom")
        page.wait_for_timeout(400)
        assert page.evaluate("() => wbZoom") > before
        card = note(page, "Beta").locator(".wb-note-card").bounding_box()
        svg = page.locator("#whiteboardContainer svg.wb-svg").bounding_box()
        centre = card["x"] + card["width"] / 2
        assert abs(centre - (svg["x"] + svg["width"] / 2)) < 60

    def test_more_opens_the_full_note_menu(self, page, app_server):
        board(page, app_server)
        page.evaluate("() => wbSetSelectedNote('Beta')")
        more = page.locator(f"{BAR} .wb-object-toolbar-more")
        more.click()
        page.wait_for_selector("#wbNoteMenu .wb-note-menu-open-task", state="visible")
        assert more.get_attribute("aria-expanded") == "true"
        more.click()
        page.wait_for_selector("#wbNoteMenu", state="detached")


class TestGroups:
    def test_clicking_a_boundary_selects_the_group(self, page, app_server):
        board(page, app_server)
        make_group(page)
        page.evaluate("() => wbClearNoteSelection()")
        box = page.locator(".wb-group-box").bounding_box()
        page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] - 6)
        page.wait_for_selector(BAR, state="visible")
        assert actions(page) == ["colour", "zoom", "edit", "remove"]
        assert page.locator(".wb-group.wb-group-selected").count() == 1

        bar = page.locator(BAR).bounding_box()
        assert bar["y"] + bar["height"] <= box["y"], "the toolbar sits above the group"

    def test_selecting_a_note_deselects_the_group(self, page, app_server):
        board(page, app_server)
        make_group(page)
        page.evaluate("() => wbSelectGroup('Discovery')")
        page.evaluate("() => wbSetSelectedNote('Gamma')")
        assert page.locator(".wb-group.wb-group-selected").count() == 0
        assert actions(page)[-1] == "more", "the toolbar is the note's now"

    def test_edit_opens_the_title_in_place(self, page, app_server):
        board(page, app_server)
        make_group(page)
        page.evaluate("() => wbSelectGroup('Discovery')")
        page.click(f"{BAR} .wb-object-toolbar-edit")
        field = page.locator(".wb-group-title-input")
        field.wait_for(state="visible")
        field.fill("Research")
        field.press("Enter")
        page.wait_for_selector('.wb-group[data-wb-group="Research"]')
        # Still selected under its new name.
        page.wait_for_selector(".wb-group.wb-group-selected[data-wb-group='Research']")
        page.wait_for_selector(BAR, state="visible")

    def test_colour_tints_the_boundary_and_is_saved(self, page, app_server):
        board(page, app_server)
        make_group(page)
        page.evaluate("() => wbSelectGroup('Discovery')")
        page.click(f"{BAR} .wb-object-toolbar-colour")
        page.locator('#wbNoteMenu .wb-note-menu-swatch[title="#FFAFA3"]').click()
        page.wait_for_selector(".wb-group.wb-group-coloured")
        rows = [
            line for line in plan_text(page).split("---whiteboard---")[1].split("\n")
            if "Discovery" in line
        ]
        assert rows and "#FFAFA3" in rows[0].upper()

    def test_remove_ungroups_and_keeps_the_notes(self, page, app_server):
        board(page, app_server)
        make_group(page)
        page.evaluate("() => wbSelectGroup('Discovery')")
        page.click(f"{BAR} .wb-object-toolbar-remove")
        page.wait_for_function("() => document.querySelectorAll('.wb-group-box').length === 0")
        assert page.locator(".wb-note").count() == 3
        assert "Discovery" not in plan_text(page)
        page.wait_for_selector(BAR, state="hidden")

    def test_pressing_empty_canvas_deselects_the_group(self, page, app_server):
        board(page, app_server)
        make_group(page)
        page.evaluate("() => wbSelectGroup('Discovery')")
        page.wait_for_selector(BAR, state="visible")
        svg = page.locator("#whiteboardContainer svg.wb-svg").bounding_box()
        page.mouse.click(svg["x"] + svg["width"] - 20, svg["y"] + svg["height"] - 20)
        page.wait_for_selector(BAR, state="hidden")
