"""The Actions tracker shows the action items held in the RAID log.

Actions are RAID items with type='action'. The tracker once rendered only on a
few paths, so actions added to the RAID log by an import, a sync or a Markdown
edit never appeared in it until something else re-rendered it.

Usage:
    uv run pytest tests/ui/test_actions_tracker.py -q
"""

import pytest

from .helpers import open_project_view

pytestmark = pytest.mark.ui

ITEMS = [
    {"id": 1, "type": "risk", "title": "Supplier slips", "status": "open"},
    {"id": 2, "type": "action", "title": "Book the venue", "owner": "Sam",
     "status": "open", "priority": "high", "target_date": "2026-10-20"},
    {"id": 3, "type": "action", "title": "Send invites", "owner": "Alex",
     "status": "open", "priority": "medium"},
]


def test_raid_actions_appear_in_actions_tracker(page, app_server):
    open_project_view(page, app_server)
    # Replace the log the way a Markdown edit or an import does: set the
    # array and re-render the RAID table only.
    page.evaluate("items => { raidItems = items; renderRaidTable(); }", ITEMS)
    rows = page.locator("#actionsTableBody tr")
    assert rows.count() == 2
    assert "Book the venue" in rows.nth(0).inner_text() + rows.nth(1).inner_text()


def test_actions_tracker_refreshes_when_opened(page, app_server):
    open_project_view(page, app_server)
    page.evaluate("items => { raidItems = items; }", ITEMS)
    page.evaluate("switchToView('actions')")
    assert page.locator("#actionsTableBody tr").count() == 2


def test_row_buttons_show_only_on_hover_and_delete_is_not_red(page, app_server):
    open_project_view(page, app_server)
    page.evaluate("items => { raidItems = items; renderRaidTable(); }", ITEMS)
    page.evaluate("switchToView('raid')")
    first = page.locator("#raidTableBody tr").first
    buttons = first.locator(".row-actions")
    assert buttons.evaluate("el => getComputedStyle(el).opacity") == "0"
    first.hover()
    page.wait_for_function(
        "() => getComputedStyle(document.querySelector('#raidTableBody .row-actions')).opacity === '1'"
    )
    assert first.locator("np-button[variant=danger]").count() == 0
    assert first.locator("np-button .bi-trash").count() == 1


def test_raid_ribbon_has_new_action_decision_dependency(page, app_server):
    open_project_view(page, app_server)
    page.evaluate("switchToView('raid')")
    page.wait_for_selector("#raid-tab.active")
    page.get_by_text("RAID Log", exact=True).first.click()
    assert page.locator("#raid-tab .raid-toolbar").get_by_text("+ Add Item").count() == 0
    for label in ("New Action", "New Decision", "New Dependency"):
        assert page.get_by_text(label, exact=True).first.is_visible()


def test_action_added_through_the_raid_form_appears_in_the_tracker(page, app_server):
    open_project_view(page, app_server)
    page.evaluate("openRaidFormWithType('action')")
    page.fill("#raidItemTitle", "Order the cake")
    page.evaluate("saveRaidItemFromForm()")
    page.evaluate("switchToView('actions')")
    assert "Order the cake" in page.locator("#actionsTableBody").inner_text()
