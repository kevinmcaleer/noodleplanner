"""Editing the plan from a phone (#1385, epic #1376).

* Quick-add: a field at the foot of the plan list takes a task line in the
  plan's own grammar, previews what it recognised, and adds the task to the
  open card (or Ungrouped) through PlanModel. It stays above the keyboard.
* A row's menu -- Indent, Outdent, Move up, Move down, Duplicate, Delete --
  opens from its ⋯ button, a swipe left and a long-press; a swipe right
  completes it. Every action is one undo step.
* Reordering by touch: a row's handle in the plan list, and on a tablet the
  Tasks and Gantt tables' handles, drag with pointer events.
* The Outline view indents and outdents without a keyboard.
"""

import pytest

from .helpers import load_plan, open_app

PLAN = """---
title: Editing on a phone
---

Design
  Research @alex 2d
  Wireframes @sam 3d
  Sign-off 1d
Build
  Code @alex 5d
Launch 0d
"""

EDITOR = "() => document.getElementById('planEditor').value"
SHEET_OPEN = "() => { const s = document.getElementById('planListSheet'); return !!s && s.hasAttribute('open'); }"
SHEET_ITEMS = """() => [...document.getElementById('planListSheet').shadowRoot.querySelectorAll('.item')]
    .map(b => [b.dataset.id, b.getAttribute('aria-disabled') === 'true'])"""


def _tasks(pg):
    pg.evaluate("() => switchToView('tasks')")
    pg.wait_for_function("() => !NavigationController.isTransitioning()")
    pg.wait_for_selector("#planList > np-note")


def _open_card(pg, name):
    note = pg.locator(f'#planList > np-note[task="{name}"]')
    if note.get_attribute("collapsed") is not None:
        note.locator(".wb-note-expand").tap()
    pg.wait_for_function(
        "n => !document.querySelector(`#planList > np-note[task=\"${n}\"]`).hasAttribute('collapsed')", arg=name
    )


def _row(pg, name):
    return pg.locator(f'#planList .wb-note-row[data-wb-row-task="{name}"]')


def _lines(pg):
    return [line for line in pg.evaluate(EDITOR).split("\n") if line.strip()]


def _undo_restores(pg, before):
    pg.evaluate("() => EditorUndoManager.undo()")
    pg.wait_for_function("b => document.getElementById('planEditor').value === b", arg=before)


def _pointer(pg, selector, events):
    """Dispatch touch pointer events at `selector`'s centre, offset per step
    (or at the height of the element `at` names)."""
    pg.evaluate(
        """([selector, events]) => {
            const el = document.querySelector(selector);
            const r = el.getBoundingClientRect();
            const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
            for (const [type, dx, dy, at] of events) {
                const target = at ? document.querySelector(at) : el;
                let x = x0 + dx, y = y0 + dy;
                // Over another element: its height, at the finger's own x --
                // a drag moves up and down from the handle.
                if (at) { const t = target.getBoundingClientRect(); y = t.top + t.height / 2 + dy; }
                el.dispatchEvent(new PointerEvent(type, {
                    bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: 'touch',
                    isPrimary: true, clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1,
                }));
            }
        }""",
        [selector, events],
    )


# ── Quick-add ────────────────────────────────────────────────────────────


def test_quick_add_previews_and_adds_to_the_open_card(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, PLAN)
    _tasks(phone)
    _open_card(phone, "Design")
    field = phone.locator("#planQuickAdd")
    assert "Design" in phone.evaluate("() => document.getElementById('planQuickAdd').getAttribute('placeholder')")
    field.locator("input").fill("Design review @alex 2d 2026-10-02 !!")
    chips = phone.evaluate(
        "() => [...document.getElementById('planQuickAdd').shadowRoot.querySelectorAll('.chip')]"
        ".map(c => [c.dataset.kind, c.textContent])"
    )
    kinds = [kind for kind, _ in chips]
    assert kinds == ["name", "resource", "duration", "date", "priority"]
    assert chips[0][1].endswith("Design review")
    before = phone.evaluate(EDITOR)
    field.locator("input").press("Enter")
    phone.wait_for_function("() => document.getElementById('planEditor').value.includes('Design review')")
    lines = _lines(phone)
    assert lines.index("  Design review @alex 2d 2026-10-02 !!") == lines.index("  Sign-off 1d") + 1
    phone.wait_for_selector('#planList .wb-note-row[data-wb-row-task="Design review"]')
    # Ready for the next one.
    assert field.locator("input").input_value() == ""
    _undo_restores(phone, before)


def test_quick_add_matches_the_tokenizer(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, PLAN)
    _tasks(phone)
    for text in ["Design review @alex 2d 2026-10-02", "Ship it 50% !!! @sam @jo 3w", "Buy milk", "Pay 2026-01-02 2026-01-09"]:
        ours, theirs = phone.evaluate(
            "t => [NoodlePlanList.parseQuickAdd(t), (({name, resources, duration, startDate, finishDate, percent, priority}) =>"
            " ({name, resources, duration, startDate, finishDate, percent, priority}))(TaskLineTokenizer.metadata(t).values)]",
            text,
        )
        assert ours == theirs, text


def test_quick_add_with_no_open_card_goes_to_ungrouped(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, PLAN + "\n---raid---\n| ID | Type | Title |\n|---|---|---|\n| R1 | risk | Late |\n")
    _tasks(phone)
    field = phone.locator("#planQuickAdd input")
    field.fill("Retro @jo 1d")
    field.press("Enter")
    phone.wait_for_function("() => document.getElementById('planEditor').value.includes('Retro @jo 1d')")
    text = phone.evaluate(EDITOR)
    assert "\nRetro @jo 1d" in text
    assert text.index("Retro @jo 1d") < text.index("---raid---")
    phone.wait_for_function(
        "() => [...document.querySelectorAll('#planList > np-note[task=\"Ungrouped\"] .wb-note-row')]"
        ".some(r => r.dataset.wbRowTask === 'Retro')"
    )


def test_quick_add_stays_above_the_keyboard(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, PLAN)
    _tasks(phone)
    phone.locator("#planQuickAdd input").focus()
    phone.evaluate(
        """() => {
            Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => 508 });
            window.visualViewport.dispatchEvent(new Event('resize'));
        }"""
    )
    phone.wait_for_function(
        "() => getComputedStyle(document.documentElement).getPropertyValue('--keyboard-inset').trim() === '336px'"
    )
    phone.wait_for_timeout(200)
    box = phone.locator("#planQuickAdd").bounding_box()
    assert box["y"] >= 0 and box["y"] + box["height"] <= 508 + 0.5


# ── The row menu ─────────────────────────────────────────────────────────


@pytest.mark.parametrize("how", ["button", "swipe", "long-press"])
def test_every_way_opens_the_row_menu(phone, app_server, how):
    open_app(phone, app_server)
    load_plan(phone, PLAN)
    _tasks(phone)
    _open_card(phone, "Design")
    row = '#planList .wb-note-row[data-wb-row-task="Wireframes"]'
    if how == "button":
        _row(phone, "Wireframes").locator(".wb-note-row-menu").tap()
    elif how == "swipe":
        _pointer(phone, row + " .wb-note-row-name", [["pointerdown", 0, 0, None], ["pointermove", -30, 0, None],
                                                     ["pointermove", -90, 2, None], ["pointerup", -90, 2, None]])
    else:
        _pointer(phone, row + " .wb-note-row-name", [["pointerdown", 0, 0, None]])
        phone.wait_for_timeout(650)
        _pointer(phone, row + " .wb-note-row-name", [["pointerup", 0, 0, None]])
    phone.wait_for_function(SHEET_OPEN)
    items = phone.evaluate(SHEET_ITEMS)
    assert [i[0] for i in items] == ["indent", "outdent", "move-up", "move-down", "duplicate", "delete"]
    # Wireframes is the middle child: everything is possible.
    assert not any(disabled for _, disabled in items)
    # The tap that lifts the long-press does not also open the task.
    assert not phone.evaluate("() => document.getElementById('taskFormSection').classList.contains('active')")


def test_a_swipe_right_completes_the_task(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, PLAN)
    _tasks(phone)
    _open_card(phone, "Design")
    before = phone.evaluate(EDITOR)
    _pointer(phone, '#planList .wb-note-row[data-wb-row-task="Research"] .wb-note-row-name',
             [["pointerdown", 0, 0, None], ["pointermove", 30, 0, None], ["pointermove", 100, 3, None],
              ["pointerup", 100, 3, None]])
    phone.wait_for_function("() => /^  Research\\b.*100%/m.test(document.getElementById('planEditor').value)")
    assert not phone.evaluate(SHEET_OPEN)
    _undo_restores(phone, before)


ACTIONS = {
    "indent": ["Design", "  Research @alex 2d", "    Wireframes @sam 3d", "  Sign-off 1d"],
    "outdent": ["Design", "  Research @alex 2d", "  Sign-off 1d", "Wireframes @sam 3d"],
    "move-up": ["Design", "  Wireframes @sam 3d", "  Research @alex 2d", "  Sign-off 1d"],
    "move-down": ["Design", "  Research @alex 2d", "  Sign-off 1d", "  Wireframes @sam 3d"],
    "duplicate": ["Design", "  Research @alex 2d", "  Wireframes @sam 3d", "  Wireframes (copy) @sam 3d", "  Sign-off 1d"],
    "delete": ["Design", "  Research @alex 2d", "  Sign-off 1d"],
}


@pytest.mark.parametrize("action", sorted(ACTIONS))
def test_each_row_action_writes_the_plan_as_one_undo_step(phone, app_server, action):
    open_app(phone, app_server)
    load_plan(phone, PLAN)
    _tasks(phone)
    _open_card(phone, "Design")
    before = phone.evaluate(EDITOR)
    _row(phone, "Wireframes").locator(".wb-note-row-menu").tap()
    phone.wait_for_function(SHEET_OPEN)
    phone.locator(f"#planListSheet .item[data-id='{action}']").tap()
    phone.wait_for_function("b => document.getElementById('planEditor').value !== b", arg=before)
    lines = _lines(phone)
    start = lines.index("Design")
    assert lines[start:start + len(ACTIONS[action])] == ACTIONS[action]
    _undo_restores(phone, before)


def test_a_summary_cannot_be_deleted_from_its_row(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, PLAN.replace("  Sign-off 1d", "  Sign-off 1d\n    Approve 1d"))
    _tasks(phone)
    _open_card(phone, "Design")
    _row(phone, "Sign-off").locator(".wb-note-row-menu").tap()
    phone.wait_for_function(SHEET_OPEN)
    assert dict(phone.evaluate(SHEET_ITEMS))["delete"] is True


# ── Reordering by touch ──────────────────────────────────────────────────


def test_a_row_is_dragged_by_touch_in_the_plan_list(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, PLAN)
    _tasks(phone)
    _open_card(phone, "Design")
    handle = '#planList .wb-note-row[data-wb-row-task="Sign-off"] .wb-note-row-menu'
    target = '#planList .wb-note-row[data-wb-row-task="Research"]'
    before = phone.evaluate(EDITOR)
    _pointer(phone, handle, [["pointerdown", 0, 0, None], ["pointermove", 0, -20, None],
                             ["pointermove", 0, -8, target], ["pointerup", 0, -8, target]])
    phone.wait_for_function("b => document.getElementById('planEditor').value !== b", arg=before)
    lines = _lines(phone)
    start = lines.index("Design")
    assert lines[start:start + 4] == ["Design", "  Sign-off 1d", "  Research @alex 2d", "  Wireframes @sam 3d"]
    _undo_restores(phone, before)


@pytest.mark.parametrize("view,body", [("tasks", "#tasksTableBody"), ("gantt", "#ganttInfoBody")])
def test_a_tablet_table_row_is_dragged_by_touch(tablet_landscape, app_server, view, body):
    pg = tablet_landscape
    open_app(pg, app_server)
    load_plan(pg, PLAN)
    pg.evaluate(f"() => switchToView('{view}')")
    pg.wait_for_function("() => !NavigationController.isTransitioning()")
    pg.wait_for_selector(f"{body} tr .task-drag-handle")
    handle_visible = pg.evaluate(
        f"() => getComputedStyle(document.querySelector('{body} tr .task-drag-handle')).visibility"
    )
    assert handle_visible == "visible"
    rows = pg.evaluate(f"() => [...document.querySelectorAll('{body} tr')].map(r => r.textContent)")
    launch = next(i for i, text in enumerate(rows) if "Launch" in text)
    build = next(i for i, text in enumerate(rows) if "Build" in text)
    before = pg.evaluate(EDITOR)
    # The same drop the mouse's HTML5 drag makes: onto Build's lower half,
    # Launch becomes Build's last task.
    _pointer(pg, f"{body} tr:nth-child({launch + 1}) .task-drag-handle",
             [["pointerdown", 0, 0, None], ["pointermove", 0, -20, None],
              ["pointermove", 0, 6, f"{body} tr:nth-child({build + 1})"],
              ["pointerup", 0, 6, f"{body} tr:nth-child({build + 1})"]])
    pg.wait_for_function("b => document.getElementById('planEditor').value !== b", arg=before)
    lines = _lines(pg)
    assert lines[lines.index("Build"):] == ["Build", "  Code @alex 5d", "  Launch 0d"]


# ── Outline ──────────────────────────────────────────────────────────────


def test_the_outline_indents_without_a_keyboard(phone, app_server):
    open_app(phone, app_server)
    load_plan(phone, PLAN)
    phone.evaluate("() => switchToView('notepad')")
    phone.wait_for_function("() => !NavigationController.isTransitioning()")
    phone.wait_for_selector("#notepadContainer .notepad-row[data-task-id] .notepad-input")
    # The keyboard hint is for a keyboard.
    assert phone.locator("#notepadContainer .notepad-hint-keys").is_hidden()
    row = phone.locator("#notepadContainer .notepad-input").nth(2)  # Wireframes
    assert row.input_value() == "Wireframes"
    row.tap()
    phone.locator("#notepadContainer .notepad-indent-btn").tap()
    phone.wait_for_function("() => document.getElementById('planEditor').value.includes('    Wireframes @sam 3d')")
    phone.locator("#notepadContainer .notepad-row[data-task-id] .notepad-input").nth(2).tap()
    phone.locator("#notepadContainer .notepad-outdent-btn").tap()
    phone.wait_for_function("() => /\\n  Wireframes @sam 3d/.test(document.getElementById('planEditor').value)")
    for button in (".notepad-indent-btn", ".notepad-outdent-btn"):
        box = phone.locator(f"#notepadContainer {button}").bounding_box()
        assert box["width"] >= 44 and box["height"] >= 44
