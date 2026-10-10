"""Board filter (#1542): a GitHub-Projects-style query above the board."""

from tests.ui.helpers import open_project_view, set_editor_value

PLAN = """\
---
title: Filters
start: 2026-01-05
labels: [must, should, ui]
resources:
- @kev: Kevin
- @jen: Jennifer
---

Design
  Login page #must @kev 2d 100% {Doing}
  Settings page #should #ui @jen 1d 0%
Build
  Login API #must @jen 3d 50% {Doing}
  Search box #ui @kev 2d 0% {Backlog}
"""


def load(page, app_server):
    page.set_viewport_size({"width": 1400, "height": 900})
    open_project_view(page, app_server)
    set_editor_value(page, PLAN)
    page.evaluate("() => switchPlanSubnavToBoard()")
    page.wait_for_selector(".kanban-card")
    return page


def cards(page):
    return sorted(page.evaluate(
        "() => [...document.querySelectorAll('.kanban-card')].map(c => c.dataset.taskName)"))


def type_filter(page, text):
    box = page.locator("#kanbanFilterInput")
    box.fill("")
    box.press_sequentially(text)
    return box


def test_filter_by_label_and_exclusion(page, app_server):
    load(page, app_server)
    assert len(cards(page)) == 4
    type_filter(page, "label:must")
    assert cards(page) == ["Login API", "Login page"]
    type_filter(page, "label:must -status:Complete")
    assert cards(page) == ["Login API"]
    type_filter(page, "-status:Complete")
    assert cards(page) == ["Login API", "Search box", "Settings page"]


def test_other_qualifiers_keywords_and_or(page, app_server):
    load(page, app_server)
    type_filter(page, "resource:kev")
    assert cards(page) == ["Login page", "Search box"]
    type_filter(page, "phase:Build bucket:Doing")
    assert cards(page) == ["Login API"]
    type_filter(page, "label:must,ui")
    assert len(cards(page)) == 4
    type_filter(page, "search")
    assert cards(page) == ["Search box"]
    assert page.locator("#kanbanFilterSummary").inner_text() == "1 of 4 cards"


def test_suggestions_keys_then_values(page, app_server):
    load(page, app_server)
    box = page.locator("#kanbanFilterInput")
    box.click()
    keys = page.locator(".board-filter-option-label")
    assert keys.all_inner_texts() == ["label:", "status:", "bucket:", "resource:", "phase:"]
    box.press_sequentially("st")
    assert keys.all_inner_texts() == ["status:"]
    box.press("ArrowDown")
    box.press("Enter")
    assert box.input_value() == "status:"
    assert page.locator(".board-filter-option-label").all_inner_texts() == [
        "Not started", "In progress", "Complete"]
    box.press("ArrowDown")
    box.press("ArrowDown")
    box.press("Enter")
    assert box.input_value() == 'status:"In progress" '
    assert cards(page) == ["Login API"]
    # A leading "-" still gets the key's values.
    box.press_sequentially("-label:")
    assert page.locator(".board-filter-option-label").all_inner_texts() == ["must", "should", "ui"]


def test_invalid_term_is_flagged_and_ignored(page, app_server):
    load(page, app_server)
    type_filter(page, "colour:red login")
    assert "Unknown filter" in page.locator("#kanbanFilterError").inner_text()
    assert cards(page) == ["Login API", "Login page"]


def test_no_match_message_clear_button_and_persistence(page, app_server):
    load(page, app_server)
    type_filter(page, "nothingmatchesthis")
    assert page.locator(".kanban-filter-empty").is_visible()
    page.locator("#kanbanFilterClear").click()
    assert page.locator("#kanbanFilterInput").input_value() == ""
    assert len(cards(page)) == 4
    type_filter(page, "label:ui")
    page.evaluate("() => { kanbanBoard.restorePreferences(); }")
    assert page.locator("#kanbanFilterInput").input_value() == "label:ui"
    assert cards(page) == ["Search box", "Settings page"]
