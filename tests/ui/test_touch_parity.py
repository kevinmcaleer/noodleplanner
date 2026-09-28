"""Touch parity across the existing views (#1386, epic #1376).

A tablet keeps today's views, and so does a phone for the ones it keeps. On
them, nothing may need a mouse or a keyboard:

* No control waits for a hover: under `(hover: none)` each is shown, or its
  action is on the row's ⋯ menu (the Gantt's and Tasks' row "+").
* Every right-click menu also opens on a long-press (touch-parity.js), and a
  long-press never also counts as a tap.
* Every double-click edit in the tables also opens on a tap.
* Drags work by pointer: the parking lot, group boundaries, the portfolio
  lasso (and row reordering, tests/ui/test_plan_list_editing.py).
* Menus close on a press outside by `pointerdown`, not `mousedown` alone.
* The Gantt chart zooms with a pinch.
* The long-presses share one helper (touch-gestures.js).
"""

import json
import re
from pathlib import Path

import pytest

from .helpers import load_plan, open_app
from .test_whiteboard_groups import PLAN as GROUP_PLAN, board as group_board, lasso, name_new_group, note

ROOT = Path(__file__).resolve().parents[2]
STATIC = ROOT / "packages/noodle-web/src/noodle_web/static"

PLAN = """---
title: Touch parity
---

Design $Spec
  Research @alex 2d
  Wireframes @sam 3d
Build
  Code @alex 5d
Launch 0d

---raid---
| ID | Type | Title | Description | Raised By | Owner | Mitigation Actions | Impact | Likelihood | Score | Status |
|----|------|-------|-------------|-----------|-------|--------------------|--------|------------|-------|--------|
| R1 | risk | Late supplier | The supplier may slip | alex | sam | Chase weekly | 4 | 4 | 16 | open |
"""


def _view(pg, view):
    pg.evaluate(f"() => switchToView({view!r})")
    pg.wait_for_function("() => !NavigationController.isTransitioning()")


def _press(pg, selector, hold_ms=0, points=None, pointer_type="touch"):
    """A touch press on `selector`'s centre (or `points`), held `hold_ms`."""
    pg.evaluate(
        """([selector, pointerType]) => {
            const el = document.querySelector(selector);
            const r = el.getBoundingClientRect();
            window.__pressAt = [r.left + Math.min(r.width / 2, 24), r.top + r.height / 2];
            el.dispatchEvent(new PointerEvent('pointerdown', {
                bubbles: true, cancelable: true, composed: true, pointerId: 11, pointerType,
                isPrimary: true, button: 0, buttons: 1, clientX: window.__pressAt[0], clientY: window.__pressAt[1],
            }));
            window.__pressTarget = el;
        }""",
        [selector, pointer_type],
    )
    if hold_ms:
        pg.wait_for_timeout(hold_ms)
    pg.evaluate(
        """(pointerType) => {
            const el = window.__pressTarget;
            const [x, y] = window.__pressAt;
            el.dispatchEvent(new PointerEvent('pointerup', {
                bubbles: true, cancelable: true, composed: true, pointerId: 11, pointerType,
                isPrimary: true, button: 0, buttons: 0, clientX: x, clientY: y,
            }));
            el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
        }""",
        pointer_type,
    )


# ── Nothing waits for a hover ────────────────────────────────────────────


def test_the_metrics_baseline_records_no_hover_only_control():
    """The mobile-metrics ratchet (#1379) holds every view at or below its
    baseline, so a baseline of 0 everywhere is the whole guarantee."""
    baseline = json.loads((ROOT / "ci/mobile-metrics-baseline.json").read_text())["devices"]
    counts = {
        f"{device}:{view}": metrics["hover_only"]
        for device, data in baseline.items()
        for view, metrics in data["views"].items()
        if metrics and metrics.get("hover_only")
    }
    assert counts == {}


@pytest.mark.parametrize("view,body", [("tasks", "#tasksTableBody"), ("gantt", "#ganttInfoBody")])
def test_the_row_plus_is_on_the_row_menu_without_hover(tablet_landscape, app_server, view, body):
    pg = tablet_landscape
    open_app(pg, app_server)
    load_plan(pg, PLAN)
    _view(pg, view)
    pg.wait_for_selector(f"{body} tr .task-context-btn")
    assert pg.locator(f"{body} .task-row-add-btn").count() == 0
    button = pg.locator(f"{body} tr .task-context-btn").first
    assert pg.evaluate(f"() => getComputedStyle(document.querySelector('{body} tr .task-context-btn')).opacity") == "1"
    box = button.bounding_box()
    # Rounded: a Gantt row lays out at fractional pixels (43.99997 is 44).
    assert round(box["width"]) >= 44 and round(box["height"]) >= 44
    button.tap()
    pg.wait_for_selector("#activeTaskContextMenu")
    items = pg.locator("#activeTaskContextMenu .task-context-menu-item").all_inner_texts()
    assert any("Insert Task Above" in item for item in items)
    assert any("Insert Task Below" in item for item in items)


def test_a_desktop_keeps_the_row_plus(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    _view(page, "tasks")
    page.wait_for_selector("#tasksTableBody .task-row-add-btn", state="attached")


def test_the_calendar_plus_is_always_there_on_touch(tablet_landscape, app_server):
    pg = tablet_landscape
    open_app(pg, app_server)
    load_plan(pg, PLAN)
    _view(pg, "calendar")
    # Measured in the page, once it holds: the calendar redraws its grid when
    # the plan's render lands, and a button measured mid-redraw is detached.
    pg.wait_for_function(
        """() => {
            const btn = document.querySelector('#calendar-view .calendar-add-btn');
            if (!btn || !btn.isConnected) return false;
            const r = btn.getBoundingClientRect();
            return r.width >= 44 && r.height >= 44;
        }""",
        timeout=5_000,
    )


# ── Right-click menus open on a long-press ──────────────────────────────

# The RAID tables draw from the app's RAID items, as tests/ui/test_raid_table.py
# loads them.
RAID_ITEMS = [{
    "id": 1, "type": "risk", "title": "Late supplier", "description": "The supplier may slip",
    "raised_by": "alex", "owner": "sam", "mitigation_actions": "Chase weekly",
    "impact": 4, "likelihood": 4, "score": 16, "status": "open",
}]

SPY = """() => {
    window.__menus = [];
    document.addEventListener('contextmenu', (e) => window.__menus.push(e), true);
}"""

SURFACES = {
    "raid": ("raid", "#raidTableBody tr"),
    "report-raid": ("project-report", "#reportRaidTableBody tr"),
    "tasks": ("tasks", "#tasksTableBody tr td:nth-child(4)"),
    "gantt": ("gantt", "#ganttInfoBody tr td:nth-child(4)"),
    "products": ("pbs", ".pbs-node[data-deliverable='Spec']"),
    "outline": ("whiteboard", ".wb-outline-row"),
    "whiteboard": ("whiteboard", "#whiteboardContainer"),
}


def test_the_registry_is_the_list_this_test_long_presses(page, app_server):
    open_app(page, app_server)
    ids = page.evaluate("() => NoodleTouchParity.SURFACES.map(s => s.id)")
    assert sorted(ids) == sorted(SURFACES)


@pytest.mark.parametrize("surface", sorted(SURFACES))
def test_every_right_click_menu_opens_on_a_long_press(tablet_landscape, app_server, surface):
    pg = tablet_landscape
    open_app(pg, app_server)
    load_plan(pg, PLAN)
    view, selector = SURFACES[surface]
    _view(pg, view)
    # A view can still redraw once after the plan loads (PBS rebuilds its
    # SVG); a press is made on the settled page, as a person's would be.
    pg.wait_for_timeout(600)
    if surface in ("raid", "report-raid"):
        pg.evaluate(
            """items => {
                raidItems = [];
                loadRaidItemsFromData(items);
                renderRaidTable();
                if (typeof updateReportRaid === 'function') updateReportRaid();
            }""",
            RAID_ITEMS,
        )
    pg.wait_for_selector(selector, state="attached")
    if surface == "whiteboard":
        # The board's own background, clear of every note.
        pg.evaluate("() => { const c = document.getElementById('whiteboardContainer'); c.scrollIntoView(); }")
    pg.evaluate(SPY)
    # Deleting a product asks first; the answer does not matter here.
    pg.on("dialog", lambda dialog: dialog.dismiss())
    if surface == "whiteboard":
        pg.evaluate(
            """() => {
                const c = document.getElementById('whiteboardContainer');
                const r = c.getBoundingClientRect();
                // The bottom-right corner: no note is placed there, and the
                // outline panel docks on the left.
                window.__pressAt = [r.right - 40, r.bottom - 40];
                const target = document.elementFromPoint(...window.__pressAt);
                target.dispatchEvent(new PointerEvent('pointerdown', {
                    bubbles: true, cancelable: true, pointerId: 11, pointerType: 'touch', isPrimary: true,
                    button: 0, buttons: 1, clientX: window.__pressAt[0], clientY: window.__pressAt[1],
                }));
                window.__pressTarget = target;
            }"""
        )
        pg.wait_for_timeout(650)
        pg.evaluate(
            "() => window.__pressTarget.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 11,"
            " pointerType: 'touch', isPrimary: true, clientX: window.__pressAt[0], clientY: window.__pressAt[1] }))"
        )
    else:
        _press(pg, selector, hold_ms=650)
    raised = pg.evaluate(
        """(selector) => window.__menus.map(e => ({
            here: !!(e.target.closest && e.target.closest(selector)),
            handled: e.defaultPrevented,
            at: (e.target.id || '') + '.' + (e.target.className && e.target.className.baseVal !== undefined
                ? e.target.className.baseVal : e.target.className) + '@' + e.clientX + ',' + e.clientY,
        }))""",
        selector if surface != "whiteboard" else "#whiteboardContainer",
    )
    assert raised and raised[0]["here"], raised
    assert raised[0]["handled"], f"no {surface} menu handled the long-press"


def test_a_long_press_on_a_cell_opens_its_menu_and_does_not_edit(tablet_landscape, app_server):
    pg = tablet_landscape
    open_app(pg, app_server)
    load_plan(pg, PLAN)
    _view(pg, "tasks")
    cell = "#tasksTableBody tr:nth-child(2) td:nth-child(5)"  # Research's duration
    pg.wait_for_selector(cell)
    _press(pg, cell, hold_ms=650)
    pg.wait_for_selector("#activeTaskContextMenu .task-context-menu-item", state="attached")
    assert pg.locator("#tasksTableBody td.editing").count() == 0


# ── Tap to edit ──────────────────────────────────────────────────────────


# Name, Duration, Start, Finish, Resources, %, Priority, Bucket, Comment,
# Predecessors -- 1-based, after the drag handle and the completion box.
@pytest.mark.parametrize("column", [4, 5, 6, 7, 8, 9, 13, 14, 15, 16])
def test_a_tap_edits_a_tasks_cell(tablet_landscape, app_server, column):
    pg = tablet_landscape
    open_app(pg, app_server)
    load_plan(pg, PLAN)
    _view(pg, "tasks")
    cell = f"#tasksTableBody tr:nth-child(2) td:nth-child({column})"
    pg.wait_for_selector(cell)
    _press(pg, cell)
    pg.wait_for_selector(f"{cell} input, {cell} select")


def test_a_tap_opens_a_resource(tablet_landscape, app_server):
    pg = tablet_landscape
    open_app(pg, app_server)
    load_plan(pg, PLAN)
    _view(pg, "resources")
    pg.wait_for_selector(".resource-name")
    _press(pg, ".resource-name")
    pg.wait_for_selector("#resourceFormSection.active")


# ── Drags by pointer ─────────────────────────────────────────────────────

PARKED = PLAN.replace("---raid---", """---parking lot---
| ID | Text | Date Parked |
|----|------|-------------|
| 1  | First idea |  |
| 2  | Second idea |  |

---raid---""")


def _drag(pg, handle, target, dy=-8, pointer_type="touch"):
    pg.evaluate(
        """([handle, target, dy, pointerType]) => {
            const h = document.querySelector(handle);
            const hr = h.getBoundingClientRect();
            const x = hr.left + hr.width / 2, y0 = hr.top + hr.height / 2;
            const t = document.querySelector(target).getBoundingClientRect();
            const y1 = t.top + t.height / 2 + dy;
            const at = (type, y) => h.dispatchEvent(new PointerEvent(type, {
                bubbles: true, cancelable: true, pointerId: 12, pointerType, isPrimary: true,
                button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y,
            }));
            at('pointerdown', y0); at('pointermove', y0 + (y1 > y0 ? 12 : -12)); at('pointermove', y1); at('pointerup', y1);
        }""",
        [handle, target, dy, pointer_type],
    )


def test_the_parking_lot_reorders_by_touch(tablet_landscape, app_server):
    pg = tablet_landscape
    open_app(pg, app_server)
    load_plan(pg, PARKED)
    _view(pg, "whiteboard")
    pg.evaluate("() => wbOpenParkingLotPanel()")
    pg.wait_for_selector("#wbParkingLotList .wb-parking-lot-item")
    # The panel slides in from the board's edge: drag once it has landed, or
    # on a slow runner the grip is still off-screen when the drag is measured.
    pg.wait_for_function(
        "() => { const p = document.getElementById('wbParkingLotPanel');"
        " return !!p && p.getAnimations({ subtree: true }).every(a => a.playState !== 'running'); }"
    )
    handle = pg.locator("#wbParkingLotList .wb-parking-lot-item-handle").first.bounding_box()
    assert round(handle["width"]) >= 44 and round(handle["height"]) >= 44
    _drag(pg, "#wbParkingLotList .wb-parking-lot-item:nth-child(2) .wb-parking-lot-item-handle",
          "#wbParkingLotList .wb-parking-lot-item:nth-child(1)")
    pg.wait_for_function(
        "() => { const t = document.getElementById('planEditor').value;"
        " return t.indexOf('Second idea') < t.indexOf('First idea'); }"
    )


def test_a_group_boundary_drags_by_touch(page, app_server):
    group_board(page, app_server, plan=GROUP_PLAN)
    a = note(page, "Alpha").bounding_box()
    b = note(page, "Beta").bounding_box()
    lasso(page, a["x"] - 12, a["y"] - 12, b["x"] + b["width"] / 2, b["y"] + 20)
    page.keyboard.press("Control+g")
    name_new_group(page, "Discovery")
    page.wait_for_selector(".wb-group .wb-group-box", state="attached")
    before = page.evaluate("() => wbNoteCurrentRect(wbNoteNodes.get('Alpha')).x")
    page.evaluate(
        """() => {
            const box = document.querySelector('.wb-group .wb-group-box');
            const r = box.getBoundingClientRect();
            const x = r.left + 6, y = r.top + r.height / 2;
            const at = (el, type, dx) => el.dispatchEvent(new PointerEvent(type, {
                bubbles: true, cancelable: true, pointerId: 13, pointerType: 'touch', isPrimary: true,
                button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x + dx, clientY: y,
            }));
            at(box, 'pointerdown', 0);
            at(window, 'pointermove', 40);
            at(window, 'pointermove', 80);
            at(window, 'pointerup', 80);
        }"""
    )
    page.wait_for_function(
        "b => wbNoteCurrentRect(wbNoteNodes.get('Alpha')).x > b + 20", arg=before
    )


def test_the_portfolio_lasso_draws_with_a_pen(page, app_server):
    open_app(page, app_server)
    page.evaluate(
        """() => { for (const name of ['Apollo', 'Gemini', 'Mercury']) createProject(name); }"""
    )
    from .helpers import click_scope
    click_scope(page, "portfolio")
    page.wait_for_selector(".project-table-row", state="attached")
    selected = page.evaluate(
        """() => {
            const list = document.getElementById('portfolioProjectsList');
            const rows = [...document.querySelectorAll('.project-table-row')];
            const first = rows[0].getBoundingClientRect(), last = rows[rows.length - 1].getBoundingClientRect();
            const lr = list.getBoundingClientRect();
            // Start in the list's own padding, beside the rows, and sweep down across them.
            const x0 = lr.right - 4, y0 = first.top - 2;
            const target = document.elementFromPoint(x0, y0) || list;
            const at = (type, x, y) => (type === 'pointerdown' ? target : document).dispatchEvent(new PointerEvent(type, {
                bubbles: true, cancelable: true, pointerId: 14, pointerType: 'pen', isPrimary: true,
                button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y,
            }));
            at('pointerdown', x0, y0);
            at('pointermove', first.left + 10, last.bottom - 2);
            at('pointerup', first.left + 10, last.bottom - 2);
            return getSelectedProjectIds().length;
        }"""
    )
    assert selected >= 2


# ── Closing on a press outside ───────────────────────────────────────────

OUTSIDE_CLOSE = {
    "task-peek.js": "tpOutsideClick",
    "status-bar.js": "handleStatusPopupOutsideClick",
    "whiteboard-outline.js": "wbQuickEditOutsideClick",
    "whiteboard-notes.js": "wbNoteMenuOutsideClick",
}


@pytest.mark.parametrize("file,handler", sorted(OUTSIDE_CLOSE.items()))
def test_outside_close_listens_for_pointerdown(file, handler):
    source = (STATIC / file).read_text()
    assert f"'mousedown', {handler}" not in source
    assert f"addEventListener('pointerdown', {handler}" in source


@pytest.mark.parametrize("file", ["kanban.js", "mindmap.js", "editor-sync.js"])
def test_popup_outside_close_listens_for_pointerdown(file):
    source = (STATIC / file).read_text()
    assert "document.addEventListener('mousedown', closeHandler)" not in source
    assert "document.addEventListener('pointerdown', closeHandler)" in source


# ── The Gantt pinches ────────────────────────────────────────────────────


def test_the_gantt_zooms_with_a_pinch(tablet_landscape, app_server):
    pg = tablet_landscape
    open_app(pg, app_server)
    load_plan(pg, PLAN)
    _view(pg, "gantt")
    pg.wait_for_selector(".gantt-chart-side")
    before = pg.evaluate("() => ganttPixelsPerDay")
    pg.evaluate(
        """() => {
            const side = document.querySelector('.gantt-chart-side');
            const r = side.getBoundingClientRect();
            const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
            const at = (type, id, x) => side.dispatchEvent(new PointerEvent(type, {
                bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch',
                isPrimary: id === 21, clientX: x, clientY: cy,
            }));
            // Fingers together: zoom out, to a third (the default is near
            // the top of the range, 48px a day).
            at('pointerdown', 21, cx - 90); at('pointerdown', 22, cx + 90);
            at('pointermove', 21, cx - 30); at('pointermove', 22, cx + 30);
        }"""
    )
    pg.wait_for_function("b => ganttPixelsPerDay < b / 2", arg=before)
    pg.evaluate(
        """() => {
            const side = document.querySelector('.gantt-chart-side');
            for (const id of [21, 22]) side.dispatchEvent(new PointerEvent('pointerup', { pointerId: id, pointerType: 'touch' }));
        }"""
    )


# ── One long-press ───────────────────────────────────────────────────────

LONG_PRESS_FILES = ["noodlesheet.js", "editor.js", "editor-sync.js", "whiteboard-notes.js", "whiteboard-row-drag.js"]


@pytest.mark.parametrize("file", LONG_PRESS_FILES)
def test_the_long_presses_share_one_helper(file):
    source = (STATIC / file).read_text()
    assert "NoodleTouch." in source or "wbHoldToDrag(" in source, file
    # No hand-rolled hold timer left: a setTimeout armed for a long-press.
    code = re.sub(r"//[^\n]*|/\*[\s\S]*?\*/", "", source)
    assert not re.search(r"longPress\w*\s*[:=]\s*setTimeout", code), file
    assert not re.search(r"setTimeout\([^;]*?LONG_PRESS_MS", code, re.S), file


def test_a_tap_on_the_completion_box_toggles_and_a_hold_opens_its_menu(tablet_landscape, app_server):
    pg = tablet_landscape
    open_app(pg, app_server)
    load_plan(pg, PLAN)
    _view(pg, "tasks")
    pie = "#tasksTableBody tr:nth-child(2) np-checkbox.task-grid-checkbox"
    pg.wait_for_selector(pie)
    _press(pg, pie)
    pg.wait_for_function("() => /Research[^\\n]*100%/.test(document.getElementById('planEditor').value)")
    pg.wait_for_selector(pie)
    _press(pg, pie, hold_ms=650)
    pg.wait_for_selector(".piechart-popup")


def test_a_long_press_on_a_line_number_opens_the_task(tablet_landscape, app_server):
    pg = tablet_landscape
    open_app(pg, app_server)
    load_plan(pg, PLAN)
    pg.evaluate("() => { if (typeof NoodleEditorVisibility !== 'undefined') NoodleEditorVisibility.show?.(); }")
    line = pg.evaluate(
        "() => document.getElementById('planEditor').value.split('\\n').findIndex(l => l.includes('Research')) + 1"
    )
    selector = f'.line-number[data-line-number="{line}"]'
    pg.wait_for_selector(selector, state="attached")
    _press(pg, selector, hold_ms=650)
    pg.wait_for_selector("#taskFormSection.active")
