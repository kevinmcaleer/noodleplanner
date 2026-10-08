"""Team Allocation table (#1496): body columns sit under their headers.

The body rows once carried the class `resource-row`, which components.css
defines as a flex list row, so the cells left the table's column layout and
bunched up to the left of the headers.
"""

from .helpers import open_app

_RENDER = """async () => {
  const t = (n, s, f, d, r) => ({name: n, start: s, finish: f, duration_days: d,
    resources: r, percent: 0, is_summary: false});
  window.parseAllProjects = async () => [
    {project: {id: 'a', name: 'Alpha'}, parsedResult: {success: true, tasks: [
      t('x', '2026-10-05', '2026-10-30', 15, 'Alice'),
      t('y', '2026-10-12', '2026-11-13', 20, 'Bob')]}},
    {project: {id: 'b', name: 'Beta'}, parsedResult: {success: true, tasks: [
      t('z', '2026-10-19', '2026-12-18', 40, 'Alice, Carol')]}}];
  document.getElementById('portfolioResourcesView')?.remove();
  const c = document.createElement('div');
  c.id = 'portfolioResourcesView';
  document.body.prepend(c);
  await renderPortfolioResources();
}"""


def test_team_allocation_cells_align_with_headers(page, app_server):
    open_app(page, app_server)
    page.evaluate(_RENDER)
    page.wait_for_selector(".portfolio-resources-table tbody tr")

    lefts = page.evaluate(
        """() => {
          const q = s => [...document.querySelectorAll(s)]
            .map(e => Math.round(e.getBoundingClientRect().left));
          return {th: q('.portfolio-resources-table th'),
                  td: q('.portfolio-resources-table tbody tr:first-child td')};
        }"""
    )
    assert len(lefts["th"]) == len(lefts["td"]) == 7
    for th, td in zip(lefts["th"], lefts["td"]):
        assert abs(th - td) <= 1, lefts
