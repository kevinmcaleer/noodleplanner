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


def test_new_programme_from_the_ribbon_appears_in_the_index(page, app_server):
    open_app(page, app_server)
    click_scope(page, "portfolio")
    page.click('[data-scope-id="pf-home"][data-label="New Programme"], [data-label="New Programme"]')
    page.fill("#nameDialogInput", "Digital Transformation")
    page.keyboard.press("Enter")
    page.wait_for_selector("#nameDialogOverlay", state="detached")

    page.click('.ribbon-scope-btn[data-scope="programme"]')
    page.wait_for_selector("#programme-tab.active")
    card = page.locator(".programme-index-card", has_text="Digital Transformation")
    assert card.count() == 1
    card.click()
    assert page.locator("#programmeViewTitle").inner_text() == "Digital Transformation"


def test_duplicate_programme_name_is_refused(page, app_server):
    open_app(page, app_server)
    page.evaluate("() => createProgramme('Estate Renewal')")
    page.evaluate("() => showCreateProgrammeDialog()")
    _name_dialog(page, "estate renewal")
    assert "already exists" in page.locator("#nameDialogError").inner_text()


def test_dragging_a_project_onto_a_programme_chip_sets_its_programme(page, app_server):
    open_app(page, app_server)
    _new_project(page, "Mobile App")
    page.evaluate("() => createProgramme('Digital Transformation')")
    click_scope(page, "portfolio")
    page.evaluate("() => { switchPortfolioView('projects'); renderProjectsTable(); }")

    handle = page.locator(".project-table-row", has_text="Mobile App").locator(".project-drag-handle")
    chip = page.locator(".programme-drop-chip", has_text="Digital Transformation")
    handle.drag_to(chip)

    page.wait_for_selector(".project-table-row .programme-badge")
    text = page.evaluate(
        "() => loadAllProjectsIntoCache().find(p => p.name === 'Mobile App').planText"
    )
    assert "programme: digital-transformation" in text

    # ...and onto "No programme" takes it back out.
    handle = page.locator(".project-table-row", has_text="Mobile App").locator(".project-drag-handle")
    handle.drag_to(page.locator(".programme-drop-chip", has_text="No programme"))
    page.wait_for_function("() => !document.querySelector('.project-table-row .programme-badge')")
    # The programme itself survives losing its last member.
    assert page.locator(".programme-drop-chip", has_text="Digital Transformation").count() == 1
