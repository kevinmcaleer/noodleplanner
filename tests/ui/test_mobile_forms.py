"""Forms are usable on a phone and a portrait tablet (#1378, epic #1376).

Measured with touch emulation on, at 390x844 and 768x1024:

* every form's action buttons can be tapped -- `elementFromPoint` at their
  centre lands on them, rather than on the status bar that used to sit on top;
* no text field is under 16px, which iOS Safari zooms the page into on focus;
* the panel header gives the title a row of its own on a phone, and its close
  button is a 44px target;
* nothing is done that would stop a user pinch-zooming;
* a closed off-canvas panel casts no shadow into the window.
"""

import pytest

from .helpers import load_plan, open_app

PLAN = """---
title: Mobile forms
---

Design
  Research @alex 2d
  Wireframes @alex 3d
"""

FORMS = {
    "task": (
        """() => {
            const model = NoodlePlanModel.modelForEditor(document.getElementById('planEditor'));
            openTaskForm(model.lineNumber(model.tasks.find(t => t.name === 'Research')));
        }""",
        "#taskFormSection",
    ),
    "raid": ("() => openRaidForm()", "#raidFormSection"),
    "resource": ("() => openResourceForm()", "#resourceFormSection"),
}

REACH = """(section) => {
    const out = [];
    for (const btn of document.querySelectorAll(section + ' .form-actions button')) {
        const cs = getComputedStyle(btn);
        if (cs.display === 'none' || cs.visibility === 'hidden' || !btn.getClientRects().length) continue;
        btn.scrollIntoView({ block: 'center' });
        const r = btn.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        out.push({
            label: btn.textContent.trim(),
            hit: !!hit && (hit === btn || btn.contains(hit)),
            inWindow: r.bottom <= innerHeight && r.top >= 0,
            onTop: hit ? (hit.className || hit.tagName) : null,
        });
    }
    return out;
}"""

FIELD_SIZES = """(section) => [...document.querySelectorAll(section +
    ' input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]), ' +
    section + ' select, ' + section + ' textarea')]
    .filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')
    .map(el => { el.focus(); return { id: el.id || el.className, size: parseFloat(getComputedStyle(el).fontSize) }; })"""


def _open(pg, app_server, name):
    open_app(pg, app_server)
    load_plan(pg, PLAN)
    opener, section = FORMS[name]
    pg.evaluate(opener)
    pg.wait_for_selector(f"{section}.active")
    # Slid fully in: from the right on a tablet, up from the bottom on a phone.
    pg.wait_for_function("() => { const r = document.getElementById('detailPane').getBoundingClientRect();"
                         " return Math.abs(r.right - innerWidth) < 1 && Math.abs(r.top) < 1; }")
    return section


@pytest.mark.parametrize("device", ["phone", "tablet_portrait"])
@pytest.mark.parametrize("form", sorted(FORMS))
def test_every_form_action_can_be_tapped(device_page, app_server, device, form):
    pg = device_page(device)
    section = _open(pg, app_server, form)
    buttons = pg.evaluate(REACH, section)
    assert buttons, f"the {form} form has no visible actions"
    blocked = [b for b in buttons if not (b["hit"] and b["inWindow"])]
    assert not blocked, f"{form} form actions covered on {device}: {blocked}"


@pytest.mark.parametrize("form", sorted(FORMS))
def test_no_focused_field_is_under_16px_on_a_phone(phone, app_server, form):
    section = _open(phone, app_server, form)
    fields = phone.evaluate(FIELD_SIZES, section)
    assert fields
    small = [f for f in fields if f["size"] < 16]
    assert not small, f"iOS would zoom into these {form} form fields: {small}"


def test_the_ribbon_search_is_16px_on_touch(phone, app_server):
    open_app(phone, app_server)
    size = phone.evaluate(
        "() => parseFloat(getComputedStyle(document.querySelector('.ribbon-search-input')).fontSize)"
    )
    assert size >= 16


def test_the_task_form_title_has_its_own_row_on_a_phone(phone, app_server):
    _open(phone, app_server, "task")
    header = phone.evaluate(
        """() => {
            const host = document.getElementById('taskFormPanelHeader');
            const root = host.shadowRoot;
            const title = root.querySelector('.title');
            const close = root.querySelector('.close-btn').getBoundingClientRect();
            const more = root.querySelector('.more');
            const t = title.getBoundingClientRect();
            const line = parseFloat(getComputedStyle(title).lineHeight) ||
                         parseFloat(getComputedStyle(title).fontSize) * 1.3;
            return { titleWidth: t.width, titleHeight: t.height, line,
                     actionsShown: getComputedStyle(root.querySelector('.actions')).display !== 'none',
                     moreShown: !more.hidden,
                     closeW: close.width, closeH: close.height, hostWidth: host.getBoundingClientRect().width };
        }"""
    )
    # The title takes the row, beside only the trashcan and the close button:
    # Inspect and Make Deliverable moved to the peek bar (#1462)...
    assert header["titleWidth"] > header["hostWidth"] * 0.6
    assert not header["actionsShown"] and not header["moreShown"]
    # ..."Research" is on one line, not broken mid-word...
    assert header["titleHeight"] < header["line"] * 1.9
    # ...and the close button is a touch target.
    assert header["closeW"] >= 44 and header["closeH"] >= 44


def test_pinch_zoom_is_not_disabled_and_the_viewport_covers_the_notch(page, app_server):
    open_app(page, app_server)
    content = page.evaluate("() => document.querySelector('meta[name=viewport]').content")
    assert "viewport-fit=cover" in content
    assert "maximum-scale" not in content
    assert "user-scalable" not in content


def test_closed_panels_cast_no_shadow(page, app_server):
    open_app(page, app_server)
    shadows = page.evaluate(
        """() => ['detailPane', 'aiChatPanel'].map(id =>
            getComputedStyle(document.getElementById(id)).boxShadow)"""
    )
    assert shadows == ["none", "none"]


def test_an_open_pane_is_above_the_status_bar_and_its_dialogs_above_it(page, app_server):
    open_app(page, app_server)
    page.evaluate("() => openRaidForm()")
    page.wait_for_selector("#raidFormSection.active")
    z = page.evaluate(
        """() => ({
            pane: +getComputedStyle(document.getElementById('detailPane')).zIndex,
            bar: +getComputedStyle(document.querySelector('.status-bar')).zIndex,
            dialog: +getComputedStyle(document.getElementById('raidDeleteConfirmOverlay')).zIndex,
        })"""
    )
    assert z["pane"] > z["bar"]
    assert z["dialog"] > z["pane"]


def test_the_page_reserves_the_status_bar_s_real_height(tablet_portrait, app_server):
    open_app(tablet_portrait, app_server)
    tablet_portrait.wait_for_function(
        "() => getComputedStyle(document.body).getPropertyValue('--status-bar-height') !== ''"
    )
    heights = tablet_portrait.evaluate(
        """() => ({
            bar: document.querySelector('.status-bar').getBoundingClientRect().height,
            reserved: parseFloat(getComputedStyle(document.body).paddingBottom),
        })"""
    )
    assert heights["reserved"] >= heights["bar"] - 1
