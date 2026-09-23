"""The RAID Log table's rows line up with its header.

The header in index.html carries a Priority and a Target Date column between
Status and Actions; the row template in `renderRaidTable()` once left both
out, so the action buttons sat under Priority and every column after Status
was shifted by two. Counting cells per row against the header catches that
whichever column goes missing next.

Usage:
    uv run pytest tests/ui/test_raid_table.py -q
"""

import pytest

from .helpers import open_project_view

pytestmark = pytest.mark.ui

ITEMS = [
    {
        "id": 1, "type": "risk", "title": "Supplier slips", "description": "Parts late",
        "raised_by": "Alex", "owner": "Sam", "mitigation_actions": "Second source",
        "impact": 4, "likelihood": 3, "score": 12, "status": "open",
        "priority": "High", "target_date": "2026-10-01",
        "escalated": True, "escalation_level": "programme",
    },
    {
        "id": 2, "type": "issue", "title": "No <b>priority</b>", "description": "",
        "raised_by": "", "owner": "", "mitigation_actions": "",
        "impact": 1, "likelihood": 1, "score": 1, "status": "closed",
    },
]


def _render(page, items):
    page.evaluate(
        """items => {
            raidItems = [];
            loadRaidItemsFromData(items);
            renderRaidTable();
        }""",
        items,
    )


def test_every_row_has_as_many_cells_as_the_header(page, app_server):
    open_project_view(page, app_server)
    _render(page, ITEMS)

    header = page.locator("#raidTable thead tr th")
    header_count = header.count()
    assert header_count == 14

    rows = page.locator("#raidTableBody tr")
    assert rows.count() == len(ITEMS)
    for i in range(rows.count()):
        assert rows.nth(i).locator("td").count() == header_count


def test_priority_and_target_date_sit_under_their_headers(page, app_server):
    open_project_view(page, app_server)
    _render(page, ITEMS)

    headers = [t.strip() for t in page.locator("#raidTable thead th").all_inner_texts()]
    first = page.locator("#raidTableBody tr").first.locator("td")
    assert first.nth(headers.index("Priority")).inner_text().strip() == "High"
    assert first.nth(headers.index("Target Date")).inner_text().strip() == "2026-10-01"
    assert first.nth(headers.index("Actions")).locator("np-button").count() == 3
