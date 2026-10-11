"""After a sync pulls plans in, the project pickers and the portfolio table
show them straight away, without a reload.

Usage:
    uv run pytest tests/ui/test_synced_projects_refresh.py -q
"""

from .helpers import open_portfolio_view

# What account-sync.js does when a plan arrives: it writes the store, then
# announces it.
PULL_A_PLAN = """() => {
    createProject('Pulled from another device', '# Pulled\\n');
    document.dispatchEvent(new CustomEvent('np-projects-synced'));
}"""


def test_portfolio_table_lists_a_plan_pulled_by_sync(page, app_server):
    open_portfolio_view(page, app_server)
    page.wait_for_selector("#portfolioProjectsList", state="visible")
    assert page.locator("#portfolioProjectsList", has_text="Pulled from another device").count() == 0

    page.evaluate(PULL_A_PLAN)

    page.locator("#portfolioProjectsList", has_text="Pulled from another device").wait_for()


def test_project_pickers_list_a_plan_pulled_by_sync(page, app_server):
    open_portfolio_view(page, app_server)
    page.evaluate(PULL_A_PLAN)
    page.wait_for_function(
        """() => [...document.querySelectorAll('.project-selector-dropdown')]
            .some(s => [...s.options].some(o => o.textContent.includes('Pulled from another device')))"""
    )
