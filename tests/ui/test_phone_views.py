"""Views on a phone (#1387, epic #1376).

Measured on a 390x844 touch phone:

* the wide tables -- the RAID log, Actions, Milestones -- are stacks of cards
  (<np-responsive-table>): nothing scrolls sideways, and each card's title and
  status are on screen; ▾ opens the rest, and tapping a card opens the item;
* a tablet keeps the tables;
* the calendar opens on an agenda, with the month a chip away, remembered;
* the dashboard is one column, the plan's status first and then the next
  milestones, what is up next and the open risks;
* a view that is best on a larger screen says so, points at the nearest
  phone-first view, and stays dismissed once dismissed;
* the drawer lists each group's phone-first views before the rest.
"""

import datetime

import pytest

from .helpers import load_plan, open_app

pytestmark = pytest.mark.ui

TODAY = datetime.date.today()


def _iso(days):
    return (TODAY + datetime.timedelta(days=days)).isoformat()


PLAN = f"""---
title: Phone views
start: {_iso(-3)}
---

Design
  Research @alex 5d
  Sign-off 0d
Build
  Code @sam 3d
Launch 0d
"""

RAID = [
    {
        "id": 1, "type": "risk", "title": "Supplier slips on the June delivery",
        "description": "Parts for the pilot arrive late", "raised_by": "Alex", "owner": "Sam",
        "mitigation_actions": "Second source", "impact": 4, "likelihood": 3, "score": 12,
        "status": "open", "priority": "High", "target_date": "2026-10-01",
    },
    {
        "id": 2, "type": "action", "title": "Chase the supplier for dates",
        "description": "", "raised_by": "", "owner": "Jo", "mitigation_actions": "",
        "impact": 1, "likelihood": 1, "score": 1, "status": "open", "target_date": "2026-10-03",
    },
]

SIDEWAYS = """(sel) => {
    const W = innerWidth;
    const root = document.querySelector(sel);
    const scrollers = [root, ...root.querySelectorAll('*')].filter(el => {
        const cs = getComputedStyle(el);
        return ['auto', 'scroll'].includes(cs.overflowX) && el.scrollWidth > el.clientWidth + 1;
    }).map(el => el.id || el.className);
    const page = document.scrollingElement.scrollWidth > W + 1;
    return { scrollers, page };
}"""


def _view(pg, view):
    pg.evaluate("v => switchToView(v)", view)
    pg.wait_for_function("() => !NavigationController.isTransitioning()")


def _raid(pg):
    pg.evaluate(
        """items => { raidItems = []; loadRaidItemsFromData(items); renderRaidTable(); renderActionsTable(); }""",
        RAID,
    )


def _on_screen(pg, locator):
    box = locator.bounding_box()
    assert box, "not rendered"
    width = pg.evaluate("() => innerWidth")
    return box["x"] >= 0 and box["x"] + box["width"] <= width + 1 and box["width"] > 0


# ── Tables as cards ─────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "view,pane,table,title,status",
    [
        ("raid", "#raid-tab", "#raidTable", "Supplier slips on the June delivery", "open"),
        ("actions", "#actions-tab", "#actionsTable", "Chase the supplier for dates", "open"),
    ],
)
def test_a_log_is_a_stack_of_cards(phone, app_server, view, pane, table, title, status):
    open_app(phone, app_server)
    load_plan(phone, PLAN)
    _raid(phone)
    _view(phone, view)
    host = phone.locator(f"np-responsive-table:has({table})")
    phone.wait_for_function(
        "t => document.querySelector(t).closest('np-responsive-table').hasAttribute('stacked')", arg=table
    )
    assert host.get_attribute("stacked") is not None

    assert phone.evaluate(SIDEWAYS, pane) == {"scrollers": [], "page": False}

    row = phone.locator(f"{table} tbody tr", has_text=title)
    primary = row.locator('td[data-priority="primary"]')
    assert title in primary.inner_text()
    assert _on_screen(phone, primary)
    meta = row.locator('td[data-priority="1"]')
    assert status in meta.inner_text().lower()
    assert _on_screen(phone, meta)

    # The rest is behind ▾, a 44px target.
    detail = row.locator('td[data-priority="detail"]').first
    assert detail.is_hidden()
    expand = row.locator(".np-rt-expand")
    box = expand.bounding_box()
    assert min(box["width"], box["height"]) >= 44
    expand.tap()
    assert detail.is_visible()
    assert expand.get_attribute("aria-expanded") == "true"
    expand.tap()
    assert detail.is_hidden()


def test_no_phone_view_scrolls_sideways(phone, app_server):
    """Every phone-first and phone-readable view, the portfolio's too."""
    open_app(phone, app_server)
    load_plan(phone, PLAN)
    _raid(phone)
    views = phone.evaluate(
        "() => NoodleViewCatalogue.groups().flatMap(g => g.views)"
        ".filter(v => v.tier !== 'larger-screen').map(v => v.id)"
    )
    found = {}
    for view in views:
        _view(phone, view)
        pane = phone.evaluate(
            "() => [...document.querySelectorAll('.tab-content.active, .output-tab-content.active')]"
            ".filter(p => p.getClientRects().length).map(p => '#' + p.id).pop()"
        )
        result = phone.evaluate(SIDEWAYS, pane)
        if result != {"scrollers": [], "page": False}:
            found[view] = result
    subs = phone.evaluate(
        "() => NoodleViewCatalogue.portfolioViews().filter(v => v.tier !== 'larger-screen').map(v => v.id)"
    )
    _view(phone, "portfolio")
    for sub in subs:
        phone.evaluate("s => switchPortfolioView(s)", sub)
        result = phone.evaluate(SIDEWAYS, "#portfolio-tab")
        if result != {"scrollers": [], "page": False}:
            found["portfolio:" + sub] = result
    assert found == {}


def test_tapping_a_raid_card_opens_the_item(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, PLAN)
    _raid(phone)
    _view(phone, "raid")
    row = phone.locator("#raidTable tbody tr", has_text="Supplier slips")
    row.locator('td[data-priority="primary"]').tap(position={"x": 20, "y": 10})
    phone.wait_for_selector("#raidFormSection.active")
    assert phone.evaluate("() => document.getElementById('raidItemTitle').value") == (
        "Supplier slips on the June delivery"
    )


def test_the_milestones_are_cards_whose_header_is_rebuilt(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, PLAN)
    _view(phone, "milestones")
    phone.wait_for_selector("#milestonesTableBody tr td[data-priority='primary']")
    assert phone.evaluate(SIDEWAYS, "#milestones-view") == {"scrollers": [], "page": False}
    names = phone.evaluate(
        "() => [...document.querySelectorAll('#milestonesTableBody td[data-priority=\"primary\"]')]"
        ".map(td => td.textContent.trim())"
    )
    assert names == ["Sign-off", "Launch"]
    assert phone.locator("#milestonesTableBody tr").first.locator('td[data-priority="1"]').is_visible()


def test_a_tablet_keeps_the_tables(tablet_portrait, app_server):
    open_app(tablet_portrait, app_server)
    load_plan(tablet_portrait, PLAN)
    _raid(tablet_portrait)
    _view(tablet_portrait, "raid")
    assert tablet_portrait.locator("np-responsive-table:has(#raidTable)").get_attribute("stacked") is None
    assert tablet_portrait.locator("#raidTable thead").is_visible()
    assert tablet_portrait.locator("#raidTable .np-rt-expand").first.is_hidden()


# ── The calendar's agenda ───────────────────────────────────────────────


def test_the_calendar_opens_on_an_agenda_with_the_month_a_chip_away(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, PLAN)
    _view(phone, "calendar")
    phone.wait_for_selector("#calendarAgenda .calendar-agenda-day")
    assert phone.locator("#calendarAgenda").is_visible()
    assert phone.locator("#calendar-view .calendar-grid-wrapper").is_hidden()
    assert phone.locator("#calendarAgenda .calendar-agenda-heading").first.inner_text().lower().startswith("today")
    assert phone.evaluate(SIDEWAYS, "#calendar-view") == {"scrollers": [], "page": False}

    phone.locator("#calendarModeChips button[data-id='month']").tap()
    phone.wait_for_function("() => document.getElementById('calendar-view').dataset.calendarMode === 'month'")
    assert phone.locator("#calendarAgenda").is_hidden()
    assert phone.locator("#calendar-view .calendar-grid-wrapper").is_visible()

    # Remembered: back to the calendar, it is still the month.
    _view(phone, "tasks")
    _view(phone, "calendar")
    assert phone.evaluate("() => document.getElementById('calendar-view').dataset.calendarMode") == "month"
    phone.locator("#calendarModeChips button[data-id='agenda']").tap()
    phone.wait_for_function("() => document.getElementById('calendar-view').dataset.calendarMode === 'agenda'")


def test_an_agenda_item_opens_its_task(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, PLAN)
    _view(phone, "calendar")
    item = phone.locator("#calendarAgenda .calendar-agenda-open").first
    item.wait_for()
    box = item.bounding_box()
    assert box["height"] >= 44
    name = item.locator(".calendar-agenda-name").inner_text()
    item.tap()
    phone.wait_for_selector("#taskFormSection.active")
    assert phone.locator("#taskFormPanelHeader").get_attribute("title") == name


def test_a_tablet_keeps_the_month_grid(tablet_portrait, app_server):
    open_app(tablet_portrait, app_server)
    load_plan(tablet_portrait, PLAN)
    _view(tablet_portrait, "calendar")
    assert tablet_portrait.locator("#calendar-view .calendar-grid-wrapper").is_visible()
    assert tablet_portrait.locator("#calendarAgenda").is_hidden()
    assert tablet_portrait.locator("#calendarModeChips").is_hidden()


# ── The dashboard in one column ─────────────────────────────────────────


def test_the_dashboard_is_one_column_in_phone_order(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, PLAN)
    _raid(phone)
    _view(phone, "project-report")
    phone.wait_for_selector("#project-report-view .project-report-header")
    order = phone.evaluate(
        """() => {
            const view = document.getElementById('project-report-view');
            const cell = (sel) => { const el = view.querySelector(sel); return el && (el.closest('.quad-cell') || el); };
            const parts = {
                status: view.querySelector('.project-report-header'),
                milestones: cell('#reportMilestonesTable'),
                upnext: cell('#reportUpNextTable'),
                risks: cell('#reportRaidTable'),
            };
            return Object.entries(parts).map(([k, el]) => {
                const r = el.getBoundingClientRect();
                return [k, Math.round(r.top), Math.round(r.left), Math.round(r.width)];
            });
        }"""
    )
    tops = [top for _, top, _, _ in order]
    assert tops == sorted(tops), order
    lefts = {left for _, _, left, _ in order}
    assert len(lefts) == 1, f"not one column: {order}"
    assert phone.evaluate(SIDEWAYS, "#project-report-view")["page"] is False


# ── Best on a larger screen ─────────────────────────────────────────────


def _notice(pg):
    return pg.locator("#phoneNotice")


def test_a_larger_screen_view_says_so_and_points_at_the_nearest(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, PLAN)
    _view(phone, "tasks")
    assert _notice(phone).is_hidden()

    _view(phone, "gantt")
    phone.wait_for_function("() => !document.getElementById('phoneNotice').hidden")
    assert _notice(phone).inner_text().startswith("Gantt is best on a larger screen.")
    assert _notice(phone).get_attribute("action") == "Open Tasks"
    box = _notice(phone).bounding_box()
    assert box["y"] + box["height"] <= phone.viewport_size["height"]
    assert box["x"] >= 0 and box["x"] + box["width"] <= phone.viewport_size["width"]

    phone.evaluate("() => document.getElementById('phoneNotice').shadowRoot.querySelector('.action').click()")
    phone.wait_for_function("() => !NavigationController.isTransitioning() && NavigationController.getCurrentView() === 'tasks'")
    assert _notice(phone).is_hidden()


def test_a_dismissed_notice_stays_dismissed(phone, app_server):
    open_app(phone, app_server)
    phone.evaluate("() => localStorage.removeItem('noodleplanner:larger-screen-dismissed')")
    load_plan(phone, PLAN)
    _view(phone, "timeline")
    phone.wait_for_function("() => !document.getElementById('phoneNotice').hidden")
    phone.evaluate("() => document.getElementById('phoneNotice').shadowRoot.querySelector('.close').click()")
    assert _notice(phone).is_hidden()

    _view(phone, "tasks")
    _view(phone, "timeline")
    assert _notice(phone).is_hidden()
    # Another view's notice is its own.
    _view(phone, "gantt")
    phone.wait_for_function("() => !document.getElementById('phoneNotice').hidden")


def test_the_whiteboard_canvas_offers_its_cards(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, PLAN)
    phone.evaluate("() => localStorage.setItem('noodleplanner:whiteboard-phone-mode', 'canvas')")
    _view(phone, "whiteboard")
    phone.wait_for_function("() => !document.getElementById('phoneNotice').hidden")
    assert _notice(phone).get_attribute("action") == "Show as cards"
    phone.evaluate("() => document.getElementById('phoneNotice').shadowRoot.querySelector('.action').click()")
    phone.wait_for_function("() => document.getElementById('whiteboard-view').dataset.wbMode === 'cards'")
    assert _notice(phone).is_hidden()
    assert phone.locator("#whiteboardCards").is_visible()


def test_tablets_get_no_notice(tablet_portrait, app_server):
    open_app(tablet_portrait, app_server)
    load_plan(tablet_portrait, PLAN)
    _view(tablet_portrait, "gantt")
    assert _notice(tablet_portrait).is_hidden()


# ── The drawer's order ──────────────────────────────────────────────────


def test_each_drawer_group_lists_phone_first_views_first(phone, app_server):
    open_app(phone, app_server)
    phone.evaluate("() => document.getElementById('phoneAppBar').menuButton.click()")
    phone.wait_for_function("() => document.getElementById('phoneNavDrawer').hasAttribute('open')")
    groups = phone.evaluate(
        """() => {
            const RANK = { 'phone-first': 0, 'phone-readable': 1, 'larger-screen': 2 };
            return [...document.getElementById('phoneNavDrawer').shadowRoot.querySelectorAll('section, [data-section]')]
                .map(section => [...section.querySelectorAll('button[data-id^="view:"]')]
                    .map(b => { const v = NoodleViewCatalogue.get(b.dataset.id.slice(5)); return v ? RANK[v.tier] ?? 1 : 1; }))
                .filter(ranks => ranks.length);
        }"""
    )
    assert groups, "no drawer groups found"
    for ranks in groups:
        assert ranks == sorted(ranks), groups
