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
