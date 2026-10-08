"""Programme UX (#1489-#1493): the scope button, New Programme, drag-to-group,
and the Noodleplanner-style name dialog replacing window.prompt()."""

from .helpers import click_scope, open_app


def _name_dialog(page, name):
    page.fill("#nameDialogInput", name)
    page.keyboard.press("Enter")


def _new_project(page, name):
    page.evaluate("() => showCreateProjectDialog()")
    _name_dialog(page, name)
    page.wait_for_selector("#nameDialogOverlay", state="detached")


def test_new_project_uses_the_app_dialog_not_a_native_prompt(page, app_server):
    open_app(page, app_server)
    native = []
    page.on("dialog", lambda d: (native.append(d.type), d.dismiss()))
    page.evaluate("() => showCreateProjectDialog()")
    assert page.locator("#nameDialogOverlay").is_visible()
    assert page.locator("#nameDialogTitle").inner_text() == "New Project"
    page.keyboard.press("Escape")
    page.wait_for_selector("#nameDialogOverlay", state="detached")
    assert native == []


def test_name_dialog_rejects_an_empty_name_then_creates(page, app_server):
    open_app(page, app_server)
    page.evaluate("() => showCreateProjectDialog()")
    page.click("#nameDialogForm button[type=submit]")
    assert page.locator("#nameDialogError").is_visible()
    _name_dialog(page, "Website relaunch")
    page.wait_for_selector("#nameDialogOverlay", state="detached")
    names = page.evaluate("() => listProjects().map(p => p.name)")
    assert "Website relaunch" in names


def test_portfolio_nav_bar_has_no_duplicate_new_project_button(page, app_server):
    open_app(page, app_server)
    click_scope(page, "portfolio")
    assert page.locator(".portfolio-actions", has_text="+ New Project").count() == 0


def test_programme_scope_opens_an_index_not_a_toast(page, app_server):
    open_app(page, app_server)
    page.click('.ribbon-scope-btn[data-scope="programme"]')
    page.wait_for_selector("#programme-tab.active")
    assert "isn't available yet" not in page.locator("body").inner_text()
    assert page.locator("#programmeIndex").is_visible()
    assert page.locator("#programmeIndex", has_text="No programmes yet").count() == 1


def test_new_programme_from_the_ribbon_opens_in_the_programme_view(page, app_server):
    open_app(page, app_server)
    click_scope(page, "portfolio")
    page.click('[data-scope-id="pf-home"][data-label="New Programme"], [data-label="New Programme"]')
    page.fill("#nameDialogInput", "Digital Transformation")
    page.keyboard.press("Enter")
    page.wait_for_selector("#nameDialogOverlay", state="detached")

    page.click('.ribbon-scope-btn[data-scope="programme"]')
    page.wait_for_selector("#programme-tab.active")
    # The default Programme View opens the programme, not an empty index.
    page.wait_for_selector("#programmeDashboard:not([hidden])")
    assert page.locator("#programmeViewTitle").inner_text() == "Digital Transformation"
    page.click(".programme-all-link")
    assert page.locator(".programme-index-card", has_text="Digital Transformation").count() == 1


def test_duplicate_programme_name_is_refused(page, app_server):
    open_app(page, app_server)
    page.evaluate("() => createProgramme('Estate Renewal')")
    page.evaluate("() => showCreateProgrammeDialog()")
    _name_dialog(page, "estate renewal")
    assert "already exists" in page.locator("#nameDialogError").inner_text()


def _portfolio_list(page):
    click_scope(page, "portfolio")
    page.evaluate("() => { switchPortfolioView('projects'); renderProjectsTable(); }")


def test_dragging_a_project_onto_a_programme_row_sets_its_programme(page, app_server):
    open_app(page, app_server)
    _new_project(page, "Mobile App")
    _new_project(page, "Standalone")
    page.evaluate("() => createProgramme('Digital Transformation')")
    _portfolio_list(page)

    handle = page.locator(".project-table-row", has_text="Mobile App").locator(".project-drag-handle")
    handle.drag_to(page.locator(".programme-table-row", has_text="Digital Transformation"))

    child = page.locator(".programme-child-row", has_text="Mobile App")
    child.wait_for()
    text = page.evaluate("() => loadAllProjectsIntoCache().find(p => p.name === 'Mobile App').planText")
    assert "programme: digital-transformation" in text

    # Dropping it on an ungrouped plan leaves the programme again.
    child.locator(".project-drag-handle").drag_to(
        page.locator(".project-table-row:not(.programme-child-row)", has_text="Standalone"))
    page.wait_for_function("() => !document.querySelector('.programme-child-row')")
    # The programme itself survives losing its last member.
    assert page.locator(".programme-table-row", has_text="Digital Transformation").count() == 1


def test_programmes_projects_and_initiatives_share_one_list_with_disclosure(page, app_server):
    open_app(page, app_server)
    _new_project(page, "Mobile App")
    page.evaluate("() => createProgramme('Digital Transformation')")
    page.evaluate(
        "() => { const p = loadAllProjectsIntoCache().find(p => p.name === 'Mobile App');"
        " persistProgrammeMembership([p.id], 'digital-transformation', 'Digital Transformation'); }"
    )
    _portfolio_list(page)

    toggle = page.locator(".programme-table-row .programme-toggle")
    assert toggle.get_attribute("aria-expanded") == "true"
    assert page.locator(".programme-child-row", has_text="Mobile App").count() == 1

    toggle.click()
    assert page.locator(".programme-table-row .programme-toggle").get_attribute("aria-expanded") == "false"
    assert page.locator(".programme-child-row").count() == 0

    page.locator(".programme-table-row .programme-toggle").click()
    assert page.locator(".programme-child-row", has_text="Mobile App").count() == 1


def test_programme_view_leads_with_projects_and_details_live_in_a_form(page, app_server):
    open_app(page, app_server)
    page.evaluate("() => createProgramme('Estate Renewal')")
    page.click('.ribbon-scope-btn[data-scope="programme"]')
    page.wait_for_selector("#programmeDashboard:not([hidden])")

    # SRO / vision / stakeholders are no longer sections of the view...
    assert page.locator("#programme-tab #programmeSroVision").count() == 0
    assert page.locator("#programme-tab #programmeStakeholders").count() == 0
    assert page.locator("#programme-tab #programmeInformation").count() == 0
    # ...they open from the Programme details button.
    page.click(".programme-details-btn")
    page.wait_for_selector("#programmeDetailsSection.active #programmeSroInput")
    assert page.locator("#programmeDetailsSection #programmeInformation").count() == 1
    page.fill("#programmeSroInput", "Alex Doe")
    page.locator("#programmeSroInput").dispatch_event("change")
    sro = page.evaluate("() => getProgrammeData('estate-renewal').sro")
    assert sro == "Alex Doe"


def test_programme_view_ribbon_button_opens_the_programme_with_its_plans(page, app_server):
    open_app(page, app_server)
    _new_project(page, "Alpha")
    page.evaluate("() => createProgramme('Estate Renewal')")
    page.evaluate("() => applyProgrammeDrop([window.portfolioTableData[0].id], 'estate-renewal', 'Estate Renewal')")
    page.click('.ribbon-scope-btn[data-scope="programme"]')
    page.wait_for_selector("#programme-tab.active")
    # Back to the portfolio, then the Programme tab's own "Programme View" button.
    page.click('.ribbon-scope-btn[data-scope="portfolio"]')
    page.click('.ribbon-scope-btn[data-scope="programme"]')
    page.locator(".ribbon-lg-btn, .ribbon-btn", has_text="Programme View").first.click()
    page.wait_for_selector("#programmeDashboard:not([hidden])")
    assert "isn't available yet" not in page.locator("body").inner_text()
    assert page.locator("#programmeViewTitle").inner_text() == "Estate Renewal"
    assert page.locator("#programmeViewProjects", has_text="Alpha").count() == 1


def test_drag_handle_comes_before_the_checkbox_with_room_between(page, app_server):
    open_app(page, app_server)
    _new_project(page, "Alpha")
    click_scope(page, "portfolio")
    page.wait_for_selector(".project-table-row .project-drag-handle")
    box = page.evaluate(
        """() => {
            const row = document.querySelector('.project-table-row');
            const h = row.querySelector('.project-drag-handle').getBoundingClientRect();
            const c = row.querySelector('.project-select-checkbox').getBoundingClientRect();
            return {handleRight: h.right, checkLeft: c.left, handleLeft: h.left};
        }"""
    )
    assert box["handleLeft"] < box["checkLeft"]
    assert box["checkLeft"] - box["handleRight"] >= 8, box
