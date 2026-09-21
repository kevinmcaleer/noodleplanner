"""The right-click menu's "Set Completion" disclosure (issue #1272).

The five options (0/25/50/75/100%) were always built, but they lived in an
absolutely-positioned flyout at `left: 100%` inside a menu with
`overflow: hidden`, so they were clipped away, and the only thing that ever
revealed them was a CSS `:hover` rule -- no click handler at all. This file
covers the behaviour that replaces it: the options expand *inline*, indented
under the trigger, on click and on the keyboard.

Usage:
    uv run pytest tests/ui/test_completion_submenu.py -q
"""

import pytest

from .helpers import load_plan, open_project_view, plan_text

# "Discovery" is a summary (it has children); "Research" and "Interviews" are
# leaves. The menu is offered on both kinds, so both are exercised.
SAMPLE_PLAN = """---
title: Completion Submenu Test Plan
---

Phase 1
  Discovery
    Research @sam 2d 50%
    Interviews @sam 2d
"""

MENU = "#activeTaskContextMenu"
TRIGGER = f"{MENU} .task-context-submenu > .task-context-menu-item"
OPTIONS = f"{MENU} .task-context-submenu-items .completion-item"


def open_gantt(page, app_server):
    open_project_view(page, app_server)
    load_plan(page, SAMPLE_PLAN)
    page.evaluate("() => switchToView('gantt')")
    page.wait_for_selector("#gantt-view", state="visible")
    page.wait_for_function(
        "() => document.querySelectorAll('#ganttInfoBody tr').length > 1"
    )


def open_menu_for(page, task_name):
    """Right-click the Gantt info row whose first cell names `task_name`."""
    page.evaluate(
        """name => {
            const rows = Array.from(document.querySelectorAll('#ganttInfoBody tr'));
            const row = rows.find(r => (r.textContent || '').includes(name));
            if (!row) throw new Error('no row for ' + name);
            row.dispatchEvent(new MouseEvent('contextmenu', {
                bubbles: true, cancelable: true, clientX: 60, clientY: 60,
            }));
        }""",
        task_name,
    )
    page.wait_for_selector(MENU, state="visible")


@pytest.mark.parametrize("task_name", ["Research", "Discovery"])
def test_clicking_set_completion_reveals_five_options(page, app_server, task_name):
    """Leaf and summary alike: the trigger is a real button that opens."""
    open_gantt(page, app_server)
    open_menu_for(page, task_name)

    trigger = page.locator(TRIGGER)
    assert "Set Completion" in trigger.inner_text()
    assert trigger.get_attribute("aria-expanded") == "false"
    # Closed: built, but not on screen.
    assert page.locator(OPTIONS).count() == 5
    assert page.locator(OPTIONS).first.is_visible() is False

    trigger.click()

    assert trigger.get_attribute("aria-expanded") == "true"
    options = page.locator(OPTIONS)
    assert [options.nth(i).inner_text() for i in range(5)] == [
        "0%",
        "25%",
        "50%",
        "75%",
        "100%",
    ]
    for i in range(5):
        assert options.nth(i).is_visible(), f"option {i} not visible"


def test_options_are_inside_the_menu_and_unclipped(page, app_server):
    """Inline expansion: every option's box sits within the menu's own box."""
    open_gantt(page, app_server)
    open_menu_for(page, "Research")
    page.locator(TRIGGER).click()

    menu_box = page.locator(MENU).bounding_box()
    for i in range(5):
        box = page.locator(OPTIONS).nth(i).bounding_box()
        assert box["width"] > 0 and box["height"] > 0
        assert box["x"] >= menu_box["x"] - 1
        assert box["x"] + box["width"] <= menu_box["x"] + menu_box["width"] + 1
        assert box["y"] >= menu_box["y"] - 1


@pytest.mark.parametrize(
    "task_name,expected",
    [("Research", "75%"), ("Discovery", "25%")],
)
def test_selecting_a_value_writes_it_to_the_markdown(
    page, app_server, task_name, expected
):
    open_gantt(page, app_server)
    open_menu_for(page, task_name)
    page.locator(TRIGGER).click()
    page.locator(OPTIONS).filter(has_text=expected).first.click()

    page.wait_for_function(
        "args => {"
        "  const line = document.getElementById('planEditor').value"
        "    .split('\\n').find(l => l.trim().startsWith(args[0]));"
        "  return !!line && line.includes(args[1]);"
        "}",
        arg=[task_name, expected],
    )
    line = next(
        line
        for line in plan_text(page).split("\n")
        if line.strip().startswith(task_name)
    )
    assert expected in line


def test_current_value_is_pre_marked(page, app_server):
    """`Research` is at 50%, so 50% carries .completion-active / aria-current."""
    open_gantt(page, app_server)
    open_menu_for(page, "Research")
    page.locator(TRIGGER).click()

    active = page.locator(f"{OPTIONS}.completion-active")
    assert active.count() == 1
    assert active.inner_text() == "50%"
    assert active.get_attribute("aria-current") == "true"


def test_unset_percent_marks_zero(page, app_server):
    """`Interviews` has no percent at all -- the parse must fall back to 0."""
    open_gantt(page, app_server)
    open_menu_for(page, "Interviews")
    page.locator(TRIGGER).click()

    active = page.locator(f"{OPTIONS}.completion-active")
    assert active.count() == 1
    assert active.inner_text() == "0%"


def test_arrow_keys_skip_the_closed_submenu(page, app_server):
    """The old flat querySelectorAll walked focus into the invisible items."""
    open_gantt(page, app_server)
    open_menu_for(page, "Research")

    # Walk the whole menu with ArrowDown; focus must never land on an option
    # while the submenu is shut.
    for _ in range(page.locator(f'{MENU} button[role="menuitem"]').count() + 2):
        page.keyboard.press("ArrowDown")
        assert page.evaluate(
            "() => !document.activeElement.classList.contains('completion-item')"
        )


def test_keyboard_opens_and_closes_the_submenu(page, app_server):
    open_gantt(page, app_server)
    open_menu_for(page, "Research")

    page.locator(TRIGGER).focus()
    page.keyboard.press("ArrowRight")
    assert page.locator(TRIGGER).get_attribute("aria-expanded") == "true"
    assert page.locator(OPTIONS).first.is_visible()
    # Focus lands on the current value.
    assert page.evaluate("() => document.activeElement.textContent") == "50%"

    page.keyboard.press("ArrowLeft")
    assert page.locator(TRIGGER).get_attribute("aria-expanded") == "false"
    assert page.locator(OPTIONS).first.is_visible() is False
    assert page.evaluate(
        "() => document.activeElement.textContent.includes('Set Completion')"
    )

    # Enter opens too, and Escape closes back to the trigger rather than
    # tearing the whole menu down.
    page.keyboard.press("Enter")
    assert page.locator(TRIGGER).get_attribute("aria-expanded") == "true"
    page.keyboard.press("Escape")
    assert page.locator(MENU).is_visible()
    assert page.locator(TRIGGER).get_attribute("aria-expanded") == "false"


def test_options_meet_the_touch_target_size(page, app_server):
    """Neighbour to tests/ui/test_target_size.py: the inline options inherit
    the menu item's 44px minimum on a narrow viewport, which a hover-only
    flyout could never have delivered on touch at all."""
    page.set_viewport_size({"width": 500, "height": 800})
    open_gantt(page, app_server)
    open_menu_for(page, "Research")
    page.locator(TRIGGER).click()

    for i in range(5):
        box = page.locator(OPTIONS).nth(i).bounding_box()
        assert box["height"] >= 44, f"option {i} is {box['height']}px tall"
