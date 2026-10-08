"""Initiatives (epic #1476): create, list, ribbon, and a stated RAG.

An initiative is a plan with `type: initiative`: a task list with no
milestones or gateways, a stated (not computed) RAG, and the same store as
every project.
"""

from .helpers import click_scope, open_app


def _create_initiative(pg, name="Tidy the wiki"):
    pg.evaluate("() => showCreateInitiativeDialog()")
    pg.fill("#nameDialogInput", name)
    pg.keyboard.press("Enter")
    pg.wait_for_function("() => document.documentElement.dataset.planType === 'initiative'")


def test_new_initiative_opens_with_the_initiative_template_and_ribbon(page, app_server):
    open_app(page, app_server)
    _create_initiative(page)

    text = page.evaluate("() => document.getElementById('planEditor').value")
    assert "type: initiative" in text
    assert "title: Tidy the wiki" in text

    labels = page.evaluate("() => [...document.querySelectorAll('[data-label]')].map(e => e.dataset.label)")
    assert "Rate" in labels
    assert "Milestone" not in labels


def test_projects_table_badges_and_filters_initiatives(page, app_server):
    open_app(page, app_server)
    _create_initiative(page)
    click_scope(page, "portfolio")
    page.evaluate("() => { switchPortfolioView('projects'); renderProjectsTable(); }")

    row = page.locator('tr[data-plan-type="initiative"]')
    assert row.count() == 1
    assert row.locator(".initiative-badge").inner_text() == "Initiative"
    assert row.locator(".status-badge").inner_text() == "Not Rated"

    page.select_option(".portfolio-type-filter select", "project")
    assert not row.is_visible()
    page.select_option(".portfolio-type-filter select", "initiative")
    assert row.is_visible()


def test_stating_a_rag_writes_it_to_the_front_matter(page, app_server):
    open_app(page, app_server)
    _create_initiative(page)

    page.evaluate("() => openInitiativeRagDialog()")
    page.check('input[name="rag"][value="amber"]')
    page.fill('input[name="comment"]', "Waiting on access")
    page.evaluate("() => document.querySelector('.initiative-rag-form').requestSubmit()")

    text = page.evaluate("() => document.getElementById('planEditor').value")
    assert "rag: amber" in text
    assert "rag_comment: Waiting on access" in text


def test_initiative_can_be_moved_under_an_existing_programme(page, app_server):
    open_app(page, app_server)
    page.evaluate(
        "() => createProject('P', '---\\ntitle: P\\nprogramme: digital\\nprogramme_name: Digital\\n---\\nTask 1d\\n')"
    )
    _create_initiative(page)

    page.evaluate("() => openInitiativeProgrammeDialog()")
    page.select_option('select[name="programme"]', "digital")
    page.evaluate("() => document.querySelector('.initiative-programme-form').requestSubmit()")

    text = page.evaluate("() => document.getElementById('planEditor').value")
    assert "programme: digital" in text
    assert "type: initiative" in text
