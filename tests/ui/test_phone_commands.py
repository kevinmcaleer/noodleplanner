"""The ribbon's commands on a phone, and the "+" button (#1382, epic #1376).

* ⋯ opens every command for the current view as a sheet generated from
  ribbon-ia.js -- the contextual tab first, then the scope's tabs -- with the
  ribbon's own disabled and pressed states.
* A command that opens a menu on the ribbon opens its choices as a sheet.
* Every phone-first view has a "+" that runs its create action -- the Tasks
  view's is its quick-add field (#1385).
* Undo and Redo work by touch, on a phone and on a tablet.
* Every target is 44px or more, and the sheet traps focus and closes on
  Escape, a backdrop tap and a swipe down.
"""

import pytest

from .helpers import load_plan, open_app

PLAN = """---
title: Commands on a phone
---

Design
  Research @alex 2d
  Wireframes @alex 3d
"""

SHEET_ITEMS = """() => [...document.getElementById('phoneSheet').shadowRoot.querySelectorAll('.item')]
    .map(b => ({ id: b.dataset.id, disabled: b.getAttribute('aria-disabled') === 'true',
                 pressed: b.getAttribute('aria-pressed') }))"""

EXPECTED = """async () => {
    const ia = await import('/static/ribbon-ia.js');
    const live = getLiveState();
    const ctx = ia.contextualTabFor(live.view);
    const tabs = [...(ctx ? [ctx] : []), ...ia.tabsForScope(ia.scopeForView(live.view))];
    const out = [];
    for (const tab of tabs) for (const group of tab.groups) {
        for (const [, label, flag] of [...(group.lg || []), ...(group.cols || []).flat()]) {
            const link = typeof flag === 'string' && flag.startsWith('link:');
            out.push({
                id: `cmd:${tab.id}:${label}`,
                disabled: link ? false : !resolveAction(tab.id, label),
                pressed: link ? 'false' : String(isButtonActive(tab.id, label, live)),
            });
        }
    }
    return out;
}"""


def _switch(pg, view):
    pg.evaluate(f"() => switchToView({view!r})")
    pg.wait_for_function("() => !NavigationController.isTransitioning()")


def _open_sheet(pg):
    pg.locator("#phoneMoreBtn").tap()
    pg.wait_for_function("() => document.getElementById('phoneSheet').hasAttribute('open')")
    pg.wait_for_timeout(250)


def _closed(pg):
    pg.wait_for_function("() => !document.getElementById('phoneSheet').hasAttribute('open')")


@pytest.mark.parametrize("view", ["gantt", "kanban", "raid", "tasks", "whiteboard"])
def test_the_sheet_is_the_ribbon_for_this_view(phone, app_server, view):
    open_app(phone, app_server)
    load_plan(phone, PLAN)
    _switch(phone, view)
    _open_sheet(phone)
    got = phone.evaluate(SHEET_ITEMS)
    expected = phone.evaluate(EXPECTED)
    assert [g["id"] for g in got] == [e["id"] for e in expected]
    assert got == expected


def test_pressed_states_follow_the_app(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, PLAN)
    _switch(phone, "gantt")
    _open_sheet(phone)
    critical = "() => document.getElementById('phoneSheet').shadowRoot.querySelector('[data-id=\"cmd:gantt:Critical Path\"]').getAttribute('aria-pressed')"
    assert phone.evaluate(critical) == "false"
    phone.locator("#phoneSheet .item[data-id='cmd:gantt:Critical Path']").tap()
    _closed(phone)
    phone.wait_for_function("() => document.getElementById('ganttShowCriticalPath').checked")
    _open_sheet(phone)
    assert phone.evaluate(critical) == "true"


def test_help_text_is_shown_not_hovered(phone, app_server):
    open_app(phone, app_server)
    _switch(phone, "notepad")
    _open_sheet(phone)
    help_text = phone.evaluate(
        "() => document.getElementById('phoneSheet').shadowRoot"
        ".querySelector('[data-id=\"cmd:view:Editor\"] .help').textContent"
    )
    assert help_text == "Show or hide the markdown editor panel"


def test_a_ribbon_menu_opens_as_a_second_sheet(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, PLAN)
    _switch(phone, "tasks")
    _open_sheet(phone)
    phone.locator("#phoneSheet .item[data-id='cmd:home:Export']").tap()
    phone.wait_for_function(
        "() => { const s = document.getElementById('phoneSheet');"
        " return s.hasAttribute('open') && s.dataset.purpose === 'choices'; }"
    )
    labels = phone.evaluate(
        "() => [...document.getElementById('phoneSheet').shadowRoot.querySelectorAll('.item .label')].map(e => e.textContent)"
    )
    assert "PDF" in labels and "Excel (.xlsx)" in labels


FAB_CASES = {
    "project-report": "() => document.getElementById('taskFormSection').classList.contains('active')",
    "notepad": "() => document.getElementById('taskFormSection').classList.contains('active')",
    "kanban": "() => document.getElementById('taskFormSection').classList.contains('active')",
    "calendar": "() => /New Task \\d{4}-\\d{2}-\\d{2}/.test(document.getElementById('planEditor').value)",
    "raid": "() => document.getElementById('raidFormSection').classList.contains('active')",
}


@pytest.mark.parametrize("view", sorted(FAB_CASES))
def test_every_phone_first_view_has_a_plus_that_creates(phone, app_server, view):
    open_app(phone, app_server)
    load_plan(phone, PLAN)
    _switch(phone, view)
    phone.wait_for_function("() => !document.getElementById('phoneFab').hidden")
    box = phone.locator("#phoneFab").bounding_box()
    assert box["width"] >= 44 and box["height"] >= 44
    phone.locator("#phoneFab").tap()
    phone.wait_for_function(FAB_CASES[view])


def test_the_tasks_view_adds_with_its_quick_add_not_a_plus(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, PLAN)
    _switch(phone, "tasks")
    phone.wait_for_function("() => document.getElementById('phoneFab').hidden")
    assert phone.locator("#planQuickAdd").is_visible()


def test_a_new_task_lands_in_the_plan_not_its_back_matter(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, PLAN + "\n---raid---\n| ID | Type | Title |\n|---|---|---|\n| R1 | risk | Late |\n")
    _switch(phone, "notepad")
    phone.locator("#phoneFab").tap()
    phone.wait_for_function("() => document.getElementById('planEditor').value.includes('New Task 1d')")
    text = phone.evaluate("() => document.getElementById('planEditor').value")
    assert text.index("New Task 1d") < text.index("---raid---")
    assert "  New Task 1d" in text


def test_views_without_a_create_action_have_no_plus(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, PLAN)
    _switch(phone, "gantt")
    phone.wait_for_function("() => document.getElementById('phoneFab').hidden")


def test_undo_and_redo_by_touch_on_a_phone(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, PLAN)
    _switch(phone, "notepad")
    phone.locator("#phoneFab").tap()
    phone.wait_for_function("() => document.getElementById('planEditor').value.includes('New Task 1d')")
    phone.evaluate("() => closeDetailPane()")
    _open_sheet(phone)
    phone.locator("#phoneSheet .tool[data-id='undo']").tap()
    phone.wait_for_function("() => !document.getElementById('planEditor').value.includes('New Task 1d')")
    phone.wait_for_function(
        "() => document.getElementById('phoneSheet').shadowRoot.querySelector('.tool[data-id=\"redo\"]')"
        ".getAttribute('aria-disabled') !== 'true'"
    )
    phone.locator("#phoneSheet .tool[data-id='redo']").tap()
    phone.wait_for_function("() => document.getElementById('planEditor').value.includes('New Task 1d')")


def test_redo_has_a_button_on_a_tablet(tablet_landscape, app_server):
    pg = tablet_landscape
    open_app(pg, app_server)
    load_plan(pg, PLAN)
    pg.evaluate("() => addNewTaskViaShortcut()")
    pg.wait_for_function("() => document.getElementById('planEditor').value.includes('New Task 1d')")
    pg.evaluate("() => closeDetailPane()")
    pg.wait_for_timeout(350)
    pg.locator(".ribbon-quick-btn[data-quick='Undo']").tap()
    pg.wait_for_function("() => !document.getElementById('planEditor').value.includes('New Task 1d')")
    redo = pg.locator(".ribbon-quick-btn[data-quick='Redo']")
    pg.wait_for_function("() => !document.querySelector('.ribbon-quick-btn[data-quick=\"Redo\"]').disabled")
    redo.tap()
    pg.wait_for_function("() => document.getElementById('planEditor').value.includes('New Task 1d')")


def test_every_sheet_target_is_44px(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, PLAN)
    _switch(phone, "gantt")
    _open_sheet(phone)
    small = phone.evaluate(
        """() => [...document.getElementById('phoneSheet').shadowRoot.querySelectorAll('button')]
            .map(b => ({ id: b.dataset.id || b.className, r: b.getBoundingClientRect() }))
            .filter(({ r }) => r.width && r.height && (r.width < 44 || r.height < 44))
            .map(({ id, r }) => [id, Math.round(r.width), Math.round(r.height)])"""
    )
    assert small == []


def test_the_sheet_traps_focus_and_closes_every_way(phone, app_server):
    open_app(phone, app_server)
    _switch(phone, "notepad")

    _open_sheet(phone)
    for _ in range(40):
        phone.keyboard.press("Tab")
        inside = phone.evaluate(
            "() => document.activeElement && document.activeElement.id === 'phoneSheet'"
        )
        assert inside, "focus left the sheet"
    phone.keyboard.press("Escape")
    _closed(phone)

    _open_sheet(phone)
    phone.touchscreen.tap(195, 20)  # the backdrop above the sheet
    _closed(phone)

    _open_sheet(phone)
    phone.evaluate(
        """() => {
            const grab = document.getElementById('phoneSheet').shadowRoot.querySelector('.grab');
            const at = (type, y) => grab.dispatchEvent(new PointerEvent(type, {
                bubbles: true, pointerId: 9, pointerType: 'touch', isPrimary: true, clientX: 195, clientY: y,
            }));
            const r = grab.getBoundingClientRect();
            at('pointerdown', r.top + 10);
            at('pointerup', r.top + 120);
        }"""
    )
    _closed(phone)
