"""The plan list: the Tasks view on a phone (#1384, epic #1376).

* On a phone the Tasks view is a stack of <np-note stacked> cards -- one per
  top-level summary, then "Ungrouped" -- and a tablet or a desktop keeps the
  table.
* A collapsed card shows its summary line; an expanded one its task rows.
* Which cards are open is kept per project, across a reload, and shared with
  the Gantt's own summary collapse, both ways.
* Tapping a row opens that task's detail sheet; ticking one writes its percent
  through PlanModel, as one undo step.
* At 390px nothing scrolls sideways and every target is 44px or more.
"""

import pytest

from .helpers import load_plan, open_app

PLAN = """---
title: Plan list
---

Kick-off 1d 100%
Design
  Research @alex 2d 100%
  Wireframes
    Sketches @sam 1d
    Review @jo 1d
  Sign-off 1d
Build
  Code @alex 5d 20%
Launch 0d
"""

CARDS = "() => [...document.querySelectorAll('#planList > np-note')].map(n => n.getAttribute('task'))"


def _tasks(pg):
    pg.evaluate("() => switchToView('tasks')")
    pg.wait_for_function("() => !NavigationController.isTransitioning()")


def _card(pg, name):
    return pg.locator(f'#planList > np-note[task="{name}"]')


def _row(pg, card, name):
    return _card(pg, card).locator(f'.wb-note-row[data-wb-row-task="{name}"]')


def _open_card(pg, name):
    if _card(pg, name).get_attribute("collapsed") is not None:
        _card(pg, name).locator(".wb-note-expand").tap()
    pg.wait_for_function(
        "n => !document.querySelector(`#planList > np-note[task=\"${n}\"]`).hasAttribute('collapsed')", arg=name
    )


def test_a_phone_gets_cards(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, PLAN)
    _tasks(phone)
    phone.wait_for_selector("#planList > np-note")
    assert phone.evaluate(CARDS) == ["Design", "Build", "Ungrouped"]
    assert phone.evaluate("() => !!customElements.get('np-note')")
    assert phone.locator(".tasks-table-wrapper").is_hidden()
    assert phone.evaluate(
        "() => [...document.querySelectorAll('#planList > np-note')].every(n => n.hasAttribute('stacked'))"
    )


@pytest.mark.parametrize("device", ["tablet_portrait", "tablet_landscape"])
def test_a_tablet_keeps_the_table(device_page, app_server, device):
    pg = device_page(device)
    open_app(pg, app_server)
    load_plan(pg, PLAN)
    _tasks(pg)
    pg.wait_for_selector("#tasksTableBody tr")
    assert pg.locator(".tasks-table-wrapper").is_visible()
    assert pg.locator("#planList").is_hidden()


def test_a_desktop_keeps_the_table(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    _tasks(page)
    page.wait_for_selector("#tasksTableBody tr")
    assert page.locator("#planList").is_hidden()


def test_a_collapsed_card_shows_its_summary_line(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, PLAN)
    _tasks(phone)
    design = _card(phone, "Design")
    design.wait_for()
    # More than one card: each starts closed, the high-level view first.
    assert design.get_attribute("collapsed") is not None
    assert design.locator(".wb-note-body").is_hidden()
    meta = phone.evaluate(
        """() => {
            const m = document.querySelector('#planList > np-note[task="Design"] .wb-note-meta');
            const text = (s) => m.querySelector(s).textContent;
            return {
                percent: text('.wb-note-meta-percent'),
                dates: text('.wb-note-meta-dates'),
                rag: text('.wb-note-meta-rag'),
                count: text('.wb-note-meta-count'),
                people: m.querySelector('np-resource-stack').names,
            };
        }"""
    )
    assert meta["percent"].endswith("%")
    assert "→" in meta["dates"]
    assert meta["rag"]
    assert meta["count"] == "4 tasks · 1 done"
    assert meta["people"] == ["alex", "sam", "jo"]


def test_an_expanded_card_shows_its_rows(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, PLAN)
    _tasks(phone)
    _card(phone, "Design").wait_for()
    _open_card(phone, "Design")
    rows = phone.evaluate(
        """() => [...document.querySelectorAll('#planList > np-note[task="Design"] .wb-note-row')].map(r => [
            r.dataset.wbRowTask,
            r.querySelector('np-checkbox').hasAttribute('checked'),
            (r.querySelector('.wb-note-row-finish') || {}).textContent || '',
        ])"""
    )
    assert [r[0] for r in rows] == ["Research", "Wireframes", "Sketches", "Review", "Sign-off"]
    assert rows[0][1] is True and rows[2][1] is False
    assert all(r[2] for r in rows)


def test_a_nested_summary_opens_and_closes(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, PLAN)
    _tasks(phone)
    _card(phone, "Design").wait_for()
    _open_card(phone, "Design")
    _row(phone, "Design", "Wireframes").locator(".wb-note-count-badge").tap()
    phone.wait_for_function(
        "() => !document.querySelector('#planList .wb-note-row[data-wb-row-task=\"Sketches\"]')"
    )
    assert phone.evaluate("() => NoodleSummaryCollapse.isCollapsed('Wireframes', false)")
    _row(phone, "Design", "Wireframes").locator(".wb-note-count-badge").tap()
    phone.wait_for_selector('#planList .wb-note-row[data-wb-row-task="Sketches"]')


def test_open_cards_are_kept_across_a_reload(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, PLAN, with_project="Plan list reload")
    _tasks(phone)
    _card(phone, "Build").wait_for()
    _open_card(phone, "Build")
    phone.reload(wait_until="domcontentloaded")
    phone.wait_for_selector(".ribbon-scope-btn", state="attached")
    _tasks(phone)
    _card(phone, "Build").wait_for()
    assert _card(phone, "Build").get_attribute("collapsed") is None
    assert _card(phone, "Design").get_attribute("collapsed") is not None


def test_the_gantt_and_the_cards_share_their_collapse(page, app_server):
    """Collapsed on the Gantt -> collapsed as a card; opened as a card ->
    open on the Gantt. One page, switching the layout override between."""
    open_app(page, app_server)
    load_plan(page, PLAN)
    page.evaluate("() => switchToView('gantt')")
    page.wait_for_selector("#ganttInfoBody .gantt-disclosure-triangle")
    # Open everything on the Gantt first, so the card's own default is not
    # what the assertion below sees.
    page.evaluate("() => { NoodleSummaryCollapse.set('Design', false); NoodleSummaryCollapse.set('Build', false); }")
    page.locator("#ganttInfoBody tr", has_text="Build").locator(".gantt-disclosure-triangle").click()
    page.wait_for_function("() => NoodleSummaryCollapse.isCollapsed('Build', false)")

    page.evaluate("() => NoodleLayout.setOverride('phone')")
    _tasks(page)
    _card(page, "Build").wait_for()
    assert _card(page, "Build").get_attribute("collapsed") is not None
    assert _card(page, "Design").get_attribute("collapsed") is None

    _card(page, "Build").locator(".wb-note-expand").click()
    page.wait_for_function("() => NoodleSummaryCollapse.isCollapsed('Build', true) === false")
    page.evaluate("() => NoodleLayout.setOverride('auto')")
    page.evaluate("() => switchToView('gantt')")
    page.wait_for_function(
        """() => {
            const rows = [...document.querySelectorAll('#ganttInfoBody tr')];
            const code = rows.find(r => r.textContent.includes('Code'));
            return code && code.style.display !== 'none';
        }"""
    )


def test_the_gantt_collapse_survives_a_reload(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN, with_project="Gantt collapse")
    page.evaluate("() => switchToView('gantt')")
    page.wait_for_selector("#ganttInfoBody .gantt-disclosure-triangle")
    page.locator("#ganttInfoBody tr", has_text="Design").first.locator(".gantt-disclosure-triangle").click()
    hidden = """() => {
        const row = [...document.querySelectorAll('#ganttInfoBody tr')].find(r => r.textContent.includes('Research'));
        return row && row.style.display === 'none';
    }"""
    page.wait_for_function(hidden)
    page.reload(wait_until="domcontentloaded")
    page.wait_for_selector(".ribbon-scope-btn", state="attached")
    page.evaluate("() => switchToView('gantt')")
    page.wait_for_selector("#ganttInfoBody .gantt-disclosure-triangle")
    page.wait_for_function(hidden)


def test_tapping_a_row_opens_its_detail_sheet(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, PLAN)
    _tasks(phone)
    _card(phone, "Design").wait_for()
    _open_card(phone, "Design")
    _row(phone, "Design", "Review").locator(".wb-note-row-name").tap()
    phone.wait_for_selector("#taskFormSection.active")
    assert phone.locator("#taskFormPanelHeader").get_attribute("title") == "Review"


def test_ticking_a_row_writes_the_plan_as_one_undo_step(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, PLAN)
    _tasks(phone)
    _card(phone, "Design").wait_for()
    _open_card(phone, "Design")
    before = phone.evaluate("() => document.getElementById('planEditor').value")
    _row(phone, "Design", "Review").locator("np-checkbox").tap()
    phone.wait_for_function(
        "() => document.getElementById('planEditor').value.split('\\n').some(l => /^\\s+Review\\b.*\\b100%/.test(l))"
    )
    # The card redraws from the new schedule with the box ticked.
    phone.wait_for_function(
        "() => document.querySelector('#planList .wb-note-row[data-wb-row-task=\"Review\"] np-checkbox')"
        ".hasAttribute('checked')"
    )
    phone.evaluate("() => EditorUndoManager.undo()")
    phone.wait_for_function("b => document.getElementById('planEditor').value === b", arg=before)


def test_summaries_cannot_be_ticked(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, PLAN)
    _tasks(phone)
    _card(phone, "Design").wait_for()
    _open_card(phone, "Design")
    box = _row(phone, "Design", "Wireframes").locator("np-checkbox")
    assert box.get_attribute("disabled") is not None
    assert box.get_attribute("indeterminate") is None  # neither child is done


def test_no_sideways_scroll_and_every_target_is_44px(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, PLAN)
    _tasks(phone)
    _card(phone, "Design").wait_for()
    for name in ("Design", "Build", "Ungrouped"):
        _open_card(phone, name)
    found = phone.evaluate(
        """() => {
            const list = document.getElementById('planList');
            const small = [];
            for (const el of list.querySelectorAll('button, np-checkbox, [role="button"], input')) {
                const r = el.getBoundingClientRect();
                if (!r.width || !r.height) continue;
                if (r.height < 44 || (el.tagName !== 'SPAN' && r.width < 44)) {
                    small.push([el.className || el.tagName, Math.round(r.width), Math.round(r.height)]);
                }
            }
            const wide = [...list.querySelectorAll('*')].filter(el => el.getBoundingClientRect().right > innerWidth + 0.5)
                .map(el => el.className || el.tagName);
            return {
                scroll: document.scrollingElement.scrollWidth - innerWidth,
                listScroll: list.scrollWidth - list.clientWidth,
                small, wide,
            };
        }"""
    )
    assert found == {"scroll": 0, "listScroll": 0, "small": [], "wide": []}


WB_CARDS = "() => [...document.querySelectorAll('#whiteboardCards > np-note')].map(n => n.getAttribute('task'))"


def _whiteboard(pg):
    pg.evaluate("() => switchToView('whiteboard')")
    pg.wait_for_function("() => !NavigationController.isTransitioning()")


def test_the_whiteboard_is_cards_on_a_phone_and_can_be_the_canvas(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, PLAN)
    _whiteboard(phone)
    phone.wait_for_selector("#whiteboardCards > np-note")
    assert phone.evaluate(WB_CARDS) == ["Design", "Build", "Ungrouped"]
    assert phone.locator("#whiteboardContainer").is_hidden()
    assert phone.locator("#whiteboardModeChips").is_visible()

    phone.locator("#whiteboardModeChips button[data-id='canvas']").tap()
    phone.wait_for_selector("#whiteboardContainer", state="visible")
    assert phone.locator("#whiteboardCards").is_hidden()

    # The choice is kept.
    phone.reload(wait_until="domcontentloaded")
    phone.wait_for_selector(".ribbon-scope-btn", state="attached")
    load_plan(phone, PLAN)
    _whiteboard(phone)
    phone.wait_for_selector("#whiteboardContainer", state="visible")
    phone.locator("#whiteboardModeChips button[data-id='cards']").tap()
    phone.wait_for_selector("#whiteboardCards > np-note")


def test_a_tablet_whiteboard_is_the_canvas(tablet_portrait, app_server):
    pg = tablet_portrait
    open_app(pg, app_server)
    load_plan(pg, PLAN)
    _whiteboard(pg)
    pg.wait_for_selector("#whiteboardContainer", state="visible")
    assert pg.locator("#whiteboardModeChips").is_hidden()
    assert pg.locator("#whiteboardCards").is_hidden()
