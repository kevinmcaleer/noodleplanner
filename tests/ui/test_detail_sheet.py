"""Every detail-pane form in one <np-detail-sheet> (#1383, epic #1376).

* All twelve entity forms (task, product, RAID, benefits, comms, lessons,
  budget, stakeholder, action, highlight and resource -- milestones use the
  task form) are <np-detail-sheet>s, and so are the pane's other sections.
* The old close switch in script.js is gone: each form's own close handler
  runs on Escape, a backdrop tap and the header's back/close.
* The pane is full screen on a phone and a portrait tablet (with ← Back), a
  600px sheet in landscape, and the side pane on a desktop.
* With the on-screen keyboard up (a visualViewport resize), the header, the
  field being typed in and the footer all stay reachable.
* On a phone no field is under 16px and no target under 44px.
* The task form's sections collapse, and remember it.
"""

from pathlib import Path

import pytest

from .helpers import load_plan, open_app

PLAN = """---
title: Detail sheets
---

Design
  Research @alex 2d
  Wireframes @alex 3d [depends Research]
    Sketches 1d
"""

FORMS = {
    "task": ("() => { const m = NoodlePlanModel.modelForEditor(document.getElementById('planEditor'));"
             " openTaskForm(m.lineNumber(m.tasks.find(t => t.name === 'Research'))); }",
             "taskFormSection", "closeTaskForm"),
    "product": ("() => { const m = NoodlePlanModel.modelForEditor(document.getElementById('planEditor'));"
                " openTaskForm(m.lineNumber(m.tasks.find(t => t.name === 'Research'))); toggleTaskDeliverable(); }",
                "productFormSection", "closeProductForm"),
    "raid": ("() => openRaidForm()", "raidFormSection", "closeRaidForm"),
    "benefits": ("() => addBenefitItem()", "benefitsFormSection", "closeBenefitForm"),
    "comms": ("() => addCommsItem()", "commsFormSection", "closeCommsForm"),
    "lessons": ("() => addLessonsItem()", "lessonsFormSection", "closeLessonsForm"),
    "budget": ("() => openBudgetForm()", "budgetFormSection", "closeBudgetForm"),
    "stakeholder": ("() => addStakeholder()", "stakeholderFormSection", "closeStakeholderForm"),
    "action": ("() => addAction()", "actionFormSection", "closeActionForm"),
    "highlight": ("() => addHighlight()", "highlightFormSection", "closeHighlightForm"),
    "resource": ("() => openResourceForm()", "resourceFormSection", "dismissResourceForm"),
}

SPY = """(name) => {
    window.__closed = [];
    const original = window[name];
    window[name] = function (...args) { window.__closed.push(name); return original.apply(this, args); };
}"""


def _open(pg, form):
    opener, section, _ = FORMS[form]
    pg.evaluate("() => { if (isDetailPaneOpen()) closeDetailPane(); }")
    pg.evaluate(opener)
    pg.wait_for_selector(f"#{section}.active")
    pg.wait_for_function("() => document.getElementById('detailPane').classList.contains('open')")
    pg.wait_for_timeout(350)  # the slide-in
    return section


def test_every_section_of_the_pane_is_a_detail_sheet(page, app_server):
    open_app(page, app_server)
    tags = page.evaluate(
        "() => [...document.querySelectorAll('#detailPane > .detail-pane-section')].map(s => [s.id, s.tagName])"
    )
    assert len(tags) == 16
    assert all(tag == "NP-DETAIL-SHEET" for _, tag in tags), tags
    ids = {sid for sid, _ in tags}
    assert {f[1] for f in FORMS.values()} <= ids


def test_the_close_switch_is_gone():
    script = (Path(__file__).resolve().parents[2]
              / "packages/noodle-web/src/noodle_web/static/script.js").read_text()
    assert "switch (activeSection.id)" not in script


@pytest.mark.parametrize("how", ["escape", "backdrop", "header"])
@pytest.mark.parametrize("form", sorted(FORMS))
def test_each_form_s_own_close_handler_runs(page, app_server, form, how):
    open_app(page, app_server)
    load_plan(page, PLAN)
    section = _open(page, form)
    handler = FORMS[form][2]
    page.evaluate(SPY, handler)
    if how == "escape":
        page.keyboard.press("Escape")
    elif how == "backdrop":
        page.mouse.click(20, 450)
    else:
        page.evaluate(
            f"() => document.querySelector('#{section} > [slot=header]').shadowRoot"
            ".querySelector('.close-btn').click()"
        )
    page.wait_for_function("() => window.__closed.length > 0")
    assert page.evaluate("() => window.__closed") == [handler]
    page.wait_for_function("() => !document.getElementById('detailPane').classList.contains('open')")


def test_a_phone_gets_a_full_screen_sheet_with_back(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, PLAN)
    _open(phone, "raid")
    box = phone.evaluate("() => { const r = document.getElementById('detailPane').getBoundingClientRect();"
                         " return [r.left, r.top, r.width, r.height]; }")
    assert box[0] == 0 and box[1] == 0 and box[2] == 390 and box[3] >= 843
    header = phone.locator("#raidFormSection > np-panel-header")
    assert header.get_attribute("back") is not None
    assert phone.evaluate(
        "() => document.querySelector('#raidFormSection > np-panel-header').shadowRoot"
        ".querySelector('.close-btn').getAttribute('aria-label')"
    ) == "Back"


@pytest.mark.parametrize("device,width,back", [
    ("tablet_portrait", 768, True),
    ("tablet_ipad_air", 820, True),
    ("tablet_landscape", 600, False),
])
def test_tablets_get_full_screen_upright_and_a_sheet_in_landscape(device_page, app_server, device, width, back):
    pg = device_page(device)
    open_app(pg, app_server)
    load_plan(pg, PLAN)
    _open(pg, "task")
    assert round(pg.evaluate("() => document.getElementById('detailPane').getBoundingClientRect().width")) == width
    assert (pg.locator("#taskFormPanelHeader").get_attribute("back") is not None) == back


def test_a_desktop_keeps_the_side_pane(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    _open(page, "task")
    assert page.evaluate("() => document.getElementById('detailPane').getBoundingClientRect().width") == 600
    assert page.locator("#taskFormPanelHeader").get_attribute("back") is None


def test_inspect_and_product_sit_on_the_peek_bar_and_delete_is_a_trashcan(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, PLAN)
    _open(phone, "task")
    # no ⋯ menu any more (#1468); the trashcan is always in the header
    shadow = "document.getElementById('taskFormPanelHeader').shadowRoot"
    assert phone.evaluate(f"() => {shadow}.querySelector('.more').hidden")
    trash = phone.locator("#taskFormPanelHeader > [slot=trailing]")
    assert trash.get_attribute("aria-label") == "Delete task"
    assert trash.is_visible()
    # Inspect and Product are on the peek bar, right-aligned (#1462), and
    # still there on a phone, where the peek switch itself is not.
    inspect = phone.locator("#taskFormSection > [slot=peekbar-actions]", has_text="Inspect")
    product = phone.locator("#taskDeliverableBtn")
    assert inspect.is_visible() and product.is_visible()
    assert phone.evaluate(
        "() => { const bar = document.getElementById('taskFormSection').shadowRoot.querySelector('.peekbar');"
        " const b = document.querySelector('#taskDeliverableBtn').getBoundingClientRect();"
        " return bar.getBoundingClientRect().right - b.right < 24; }"
    )


def test_the_keyboard_never_covers_the_sheet(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, PLAN)
    section = _open(phone, "task")
    phone.evaluate(
        f"() => {{ const s = document.getElementById('{section}');"
        " s.querySelectorAll('details').forEach(d => d.open = true); }"
    )
    phone.locator("#taskComment").focus()
    # A 336px keyboard: the visual viewport shrinks to 508px.
    phone.evaluate(
        """() => {
            Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => 508 });
            window.visualViewport.dispatchEvent(new Event('resize'));
        }"""
    )
    phone.wait_for_function(
        "() => getComputedStyle(document.documentElement).getPropertyValue('--keyboard-inset').trim() === '336px'"
    )
    phone.wait_for_timeout(300)
    parts = phone.evaluate(
        f"""() => {{
            const s = document.getElementById('{section}');
            const box = (el) => {{ const r = el.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom)]; }};
            return {{
                pane: box(document.getElementById('detailPane')),
                header: box(s.querySelector('[slot=header]')),
                footer: box(s.querySelector('[slot=footer]')),
                field: box(document.getElementById('taskComment')),
            }};
        }}"""
    )
    assert parts["pane"][1] <= 508
    for name in ("header", "footer", "field"):
        top, bottom = parts[name]
        assert top >= 0 and bottom <= 508, (name, parts)


@pytest.mark.parametrize("form", sorted(FORMS))
def test_no_small_field_or_target_on_a_phone(phone, app_server, form):
    open_app(phone, app_server)
    load_plan(phone, PLAN)
    section = _open(phone, form)
    phone.evaluate(f"() => document.querySelectorAll('#{section} details').forEach(d => d.open = true)")
    found = phone.evaluate(
        f"""() => {{
            const s = document.getElementById('{section}');
            const small = [], tiny = [];
            const all = [...s.querySelectorAll('button, a, input:not([type=hidden]), select, textarea, summary, np-button, np-close-button, np-checkbox')];
            const header = s.querySelector('[slot=header]');
            if (header && header.shadowRoot) all.push(...header.shadowRoot.querySelectorAll('button'));
            for (const el of all) {{
                const cs = getComputedStyle(el), r = el.getBoundingClientRect();
                if (!r.width || !r.height || cs.display === 'none' || cs.visibility === 'hidden') continue;
                if (r.width < 44 || r.height < 44) small.push(el.id || el.className || el.tagName);
                if (el.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]), select, textarea')
                    && parseFloat(cs.fontSize) < 16) tiny.push(el.id || el.className);
            }}
            return {{ small, tiny }};
        }}"""
    )
    assert found == {"small": [], "tiny": []}


def test_task_sections_collapse_and_are_remembered(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, PLAN)
    _open(phone, "task")
    state = "() => [...document.querySelectorAll('#taskFormSection details')].map(d => [d.dataset.section, d.open])"
    # A phone opens only Schedule until the user chooses otherwise.
    assert phone.evaluate(state) == [
        ["task-schedule", True], ["task-people", False], ["task-dependencies", False],
        ["task-subtasks", False], ["task-notes", False],
    ]
    phone.locator("#taskFormSection details[data-section='task-notes'] > summary").tap()
    phone.wait_for_function(
        "() => JSON.parse(localStorage.getItem('noodleplanner:sheet-sections') || '{}')['task-notes'] === true"
    )
    phone.evaluate("() => closeDetailPane()")
    phone.wait_for_timeout(350)
    _open(phone, "task")
    assert dict(phone.evaluate(state))["task-notes"] is True
