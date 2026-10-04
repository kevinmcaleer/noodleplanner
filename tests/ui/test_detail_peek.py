"""Side peek, centre peek and full page for the detail forms (#1409).

* Every form has a short bar with a peek switch at its top left.
* A side peek is still the default: the 600px pane on the right.
* The switch opens forms as a centre peek (a dialog in the middle of the
  window) or a full page, and every form follows it.
* The project's default is `settings: detail_peek` in the front matter, set
  from Settings -> Layout.
* A phone always opens a form as a full page, with no switch.
* A closed centre peek does not sit invisibly over the app.
"""

from .helpers import load_plan, open_app

PLAN = """---
title: Peek modes
---

Design
  Research @alex 2d
"""

CENTER_PLAN = """---
title: Peek modes
settings:
  detail_peek: center
---

Design
  Research @alex 2d
"""

OPEN_TASK = ("() => { const m = NoodlePlanModel.modelForEditor(document.getElementById('planEditor'));"
             " openTaskForm(m.lineNumber(m.tasks.find(t => t.name === 'Research'))); }")

PANE_BOX = ("() => { const r = document.getElementById('detailPane').getBoundingClientRect();"
            " return { left: r.left, top: r.top, width: r.width, height: r.height }; }")


def _open(pg, opener=OPEN_TASK, section="taskFormSection"):
    pg.evaluate("() => { if (isDetailPaneOpen()) closeDetailPane(); }")
    pg.evaluate(opener)
    pg.wait_for_selector(f"#{section}.active")
    pg.wait_for_function("() => document.getElementById('detailPane').classList.contains('open')")
    pg.wait_for_timeout(350)  # the slide-in


def _mode(pg):
    return pg.evaluate("() => document.getElementById('detailPane').dataset.peekMode")


def _switch(pg, section="taskFormSection"):
    return pg.evaluate_handle(
        f"() => document.getElementById('{section}').shadowRoot.querySelector('np-peek-switch')"
    )


def _pick(pg, mode, section="taskFormSection"):
    pg.evaluate(
        f"() => document.getElementById('{section}').shadowRoot.querySelector('np-peek-switch')"
        f".shadowRoot.querySelector('button[data-peek=\"{mode}\"]').click()"
    )
    pg.wait_for_timeout(350)


def _pressed(pg, section="taskFormSection"):
    return pg.evaluate(
        f"() => document.getElementById('{section}').shadowRoot.querySelector('np-peek-switch')"
        ".shadowRoot.querySelector('button[aria-pressed=\"true\"]').dataset.peek"
    )


def test_the_switch_sits_at_the_top_left_of_the_form(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    _open(page)
    pane = page.evaluate(PANE_BOX)
    switch = page.evaluate(
        "() => { const r = document.getElementById('taskFormSection').shadowRoot"
        ".querySelector('np-peek-switch').getBoundingClientRect(); return { left: r.left, top: r.top }; }"
    )
    assert switch["left"] - pane["left"] < 24
    assert switch["top"] - pane["top"] < 12
    header_top = page.evaluate("() => document.getElementById('taskFormPanelHeader').getBoundingClientRect().top")
    assert header_top > switch["top"]


def test_side_peek_is_the_default(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    _open(page)
    assert _mode(page) == "side"
    assert _pressed(page) == "side"
    box = page.evaluate(PANE_BOX)
    assert box["width"] == 600 and box["left"] == 1280 - 600


def test_center_peek_is_a_dialog_in_the_middle(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    _open(page)
    _pick(page, "center")
    assert _mode(page) == "center"
    box = page.evaluate(PANE_BOX)
    assert abs(box["left"] + box["width"] / 2 - 640) <= 1
    assert abs(box["top"] + box["height"] / 2 - 450) <= 1
    assert box["width"] == 900 and box["height"] < 900
    assert page.locator("#taskFormPanelHeader").get_attribute("back") is None


def test_full_page_covers_the_window(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    _open(page)
    _pick(page, "full")
    assert _mode(page) == "full"
    box = page.evaluate(PANE_BOX)
    assert box == {"left": 0, "top": 0, "width": 1280, "height": 900}
    assert _pressed(page) == "full"


def test_every_form_follows_the_switch(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    _open(page)
    _pick(page, "center")
    page.evaluate("() => closeTaskForm()")
    _open(page, "() => openRaidForm()", "raidFormSection")
    assert _mode(page) == "center"
    assert _pressed(page, "raidFormSection") == "center"


def test_a_closed_center_peek_does_not_block_the_app(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    _open(page)
    _pick(page, "center")
    page.keyboard.press("Escape")
    page.wait_for_function("() => !document.getElementById('detailPane').classList.contains('open')")
    page.wait_for_timeout(350)
    assert page.evaluate("() => getComputedStyle(document.getElementById('detailPane')).visibility") == "hidden"
    hit = page.evaluate("() => document.elementFromPoint(640, 450).closest('#detailPane')")
    assert hit is None


def test_the_project_default_comes_from_the_front_matter(page, app_server):
    open_app(page, app_server)
    load_plan(page, CENTER_PLAN)
    _open(page)
    assert _mode(page) == "center"
    assert _pressed(page) == "center"


def test_the_settings_panel_saves_the_default(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    page.evaluate("() => openSettingsPanel('layout')")
    page.wait_for_selector("#settingsSection.active")
    assert page.is_checked('input[name="settingsDetailPeek"][value="side"]')
    page.check('input[name="settingsDetailPeek"][value="full"]')
    assert _mode(page) == "full"
    page.wait_for_function(
        "() => /\\n  detail_peek: full\\n/.test(document.getElementById('planEditor').value)"
    )
    page.evaluate("() => closeSettingsPanel()")
    _open(page)
    assert _mode(page) == "full"


def test_a_new_default_replaces_the_switch(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    _open(page)
    _pick(page, "full")
    page.evaluate("() => closeTaskForm()")
    load_plan(page, CENTER_PLAN)
    _open(page)
    assert _mode(page) == "center"


def test_a_phone_is_always_a_full_page(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, CENTER_PLAN)
    _open(phone)
    assert _mode(phone) == "full"
    box = phone.evaluate(PANE_BOX)
    assert box["left"] == 0 and box["top"] == 0 and box["width"] == 390
    # no switch on a phone (the bar stays for the task form's Inspect/Product, #1462)
    switch = phone.evaluate(
        "() => getComputedStyle(document.getElementById('taskFormSection').shadowRoot"
        ".querySelector('np-peek-switch')).display"
    )
    assert switch == "none"
    assert phone.locator("#taskFormPanelHeader").get_attribute("back") is not None


def test_an_upright_tablet_can_open_a_center_peek(device_page, app_server):
    pg = device_page("tablet_portrait")
    open_app(pg, app_server)
    load_plan(pg, PLAN)
    _open(pg)
    assert pg.locator("#taskFormPanelHeader").get_attribute("back") is not None
    _pick(pg, "center")
    box = pg.evaluate(PANE_BOX)
    assert box["width"] < 768 and box["left"] > 0
    assert pg.locator("#taskFormPanelHeader").get_attribute("back") is None
