"""The resource smarttag (#1524-#1527)."""

from .helpers import load_plan, open_app

PLAN = """---
title: Smarttag
Resources:
- @alex: Alex Archer, Designer
---

Design
  T1 @alex 1d 100%
  T2 @alex 1d
  T3 @alex 1d
  T4 @alex 1d
  T5 @alex 1d
  T6 @alex 1d
  T7 @alex 1d
  Orphan @zed 1d
"""

OPEN = ("() => { const m = NoodlePlanModel.modelForEditor(document.getElementById('planEditor'));"
        " openTaskForm(m.lineNumber(m.tasks.find(t => t.name === '%s'))); }")


def _open(pg, name):
    pg.evaluate("() => { if (isDetailPaneOpen()) closeDetailPane(); }")
    pg.evaluate(OPEN % name)
    pg.wait_for_selector("#taskFormSection.active")
    pg.evaluate("() => document.querySelectorAll('#taskFormSection details').forEach(d => d.open = true)")


def test_task_form_row_leads_with_the_initials_chip(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    _open(page, "T2")
    chip = page.locator("#taskResourcesList .resource-row np-resource-stack .chip").first
    assert chip.inner_text() == "AA"


def test_clicking_a_chip_opens_the_form_prefilled_for_an_unlisted_shortname(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    _open(page, "Orphan")
    page.locator("#taskResourcesList np-resource-stack .chip").first.click()
    page.wait_for_selector("#resourceFormSection.active")
    assert page.input_value("#resourceShortname") == "zed"
    assert page.input_value("#resourceFullName") == ""


def test_hover_card_lists_at_most_five_up_next_tasks(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    _open(page, "T2")
    page.locator("#taskResourcesList np-resource-stack .chip").first.hover()
    items = page.evaluate(
        """() => { const s = document.querySelector('#taskResourcesList np-resource-stack');
                   const c = s.shadowRoot.querySelector('.card');
                   return { hidden: c.hidden, heading: c.querySelector('.tasks-heading')?.textContent,
                            tasks: [...c.querySelectorAll('ul.tasks li')].map(li => li.textContent) }; }"""
    )
    assert not items["hidden"]
    assert items["heading"] == "Up next"
    assert items["tasks"] == ["T2", "T3", "T4", "T5", "T6"]


def test_resource_form_edits_interest_and_influence(page, app_server):
    open_app(page, app_server)
    load_plan(page, PLAN)
    page.evaluate("() => openResourceForm('alex')")
    page.wait_for_selector("#resourceFormSection.active")
    assert page.input_value("#resourceInterest") == ""
    assert page.locator("#resourceStakeholderDot").is_hidden()
    page.select_option("#resourceInterest", "high")
    page.select_option("#resourceInfluence", "low")
    page.evaluate("() => saveResource()")
    plan = page.evaluate("() => document.getElementById('planEditor').value")
    assert "- @alex: Alex Archer, Designer, interest:high, influence:low" in plan
    page.evaluate("() => openResourceForm('alex')")
    assert page.input_value("#resourceInterest") == "high"
    assert page.get_attribute("#resourceStakeholderDot", "cx") == "15"
    assert page.get_attribute("#resourceStakeholderDot", "cy") == "15"
    page.select_option("#resourceInterest", "")
    page.select_option("#resourceInfluence", "")
    page.evaluate("() => saveResource()")
    assert "interest:" not in page.evaluate("() => document.getElementById('planEditor').value")
