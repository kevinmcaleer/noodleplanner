/**
 * The portfolio Risks & Issues register (portfolio-risks.js) renders every
 * open item and filters the rows by RAG, so every RAG choice can show its
 * items.
 *
 * renderPortfolioRisks() only built rows for red and amber items (the
 * default "Red & Amber" filter), but filterPortfolioRisks() only shows and
 * hides rows that already exist -- so "Low (Green)" showed nothing and
 * "All Levels" left out every green item, until a column sort happened to
 * re-render the table from the full list.
 *
 * Run with: node --test tests/test_portfolio_risks_filter.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const staticDir = join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'static');

/** Top-level `function name(` ... `\n}` declarations from a classic script. */
function liftFunctions(sandbox, file, names) {
  const source = readFileSync(join(staticDir, file), 'utf8');
  for (const name of names) {
    const start = source.search(new RegExp(`\\n(?:async )?function ${name}\\(`));
    assert.notEqual(start, -1, `${name} not found in ${file}`);
    const end = source.indexOf('\n}\n', start);
    assert.notEqual(end, -1, `${name} in ${file} has no closing brace at column 0`);
    vm.runInContext(source.slice(start, end + 3), sandbox);
  }
}

/** The register, rendered into a fake DOM whose .risks-row elements are
 * read back out of the markup renderPortfolioRisks() wrote. */
async function renderRegister(raidItems) {
  const view = { innerHTML: '' };
  const filters = {
    portfolioRisksTypeFilter: { value: 'all' },
    portfolioRisksProjectFilter: { value: 'all' },
    portfolioRisksRAGFilter: { value: 'red-amber' }, // the markup's selected default
  };
  let rows = [];
  let rowsFrom = null;
  const sandbox = vm.createContext({
    console,
    window: {},
    document: {
      getElementById: (id) => (id === 'portfolioRisksView' ? view : filters[id] || null),
      querySelectorAll(selector) {
        assert.equal(selector, '.risks-row');
        if (rowsFrom !== view.innerHTML) {
          rowsFrom = view.innerHTML;
          rows = [...view.innerHTML.matchAll(/<tr class="risks-row" data-project="([^"]*)" data-rag="([^"]*)" data-type="([^"]*)"/g)]
            .map(m => ({ dataset: { project: m[1], rag: m[2], type: m[3] }, style: { display: '' } }));
        }
        return rows;
      },
    },
    parseAllProjects: async () => [{ project: { id: 'p1', name: 'Alpha' }, parsedResult: { raid_items: raidItems } }],
  });
  liftFunctions(sandbox, 'state.js', ['escapeHtml']);
  liftFunctions(sandbox, 'portfolio-risks.js', [
    'collectOpenRisksAndIssues', 'deriveRiskRAG', 'renderPortfolioRisks', 'buildRisksTableRows', 'filterPortfolioRisks',
  ]);
  await sandbox.renderPortfolioRisks();
  const visible = () => sandbox.document.querySelectorAll('.risks-row')
    .filter(row => row.style.display !== 'none')
    .map(row => row.dataset.rag)
    .sort();
  const choose = (rag) => { filters.portfolioRisksRAGFilter.value = rag; sandbox.filterPortfolioRisks(); };
  return { visible, choose };
}

const ITEMS = [
  { id: 1, type: 'risk', title: 'High', status: 'open', impact: 5, likelihood: 4, score: 20 },
  { id: 2, type: 'issue', title: 'Medium', status: 'open', impact: 3, likelihood: 3, score: 9 },
  { id: 3, type: 'risk', title: 'Low', status: 'open', impact: 1, likelihood: 2, score: 2 },
];

test('the first render shows red and amber, as the RAG filter says', async () => {
  const { visible } = await renderRegister(ITEMS);
  assert.deepEqual(visible(), ['amber', 'red']);
});

test('"Low (Green)" shows the green items', async () => {
  const { visible, choose } = await renderRegister(ITEMS);
  choose('green');
  assert.deepEqual(visible(), ['green']);
});

test('"All Levels" shows every open item', async () => {
  const { visible, choose } = await renderRegister(ITEMS);
  choose('all');
  assert.deepEqual(visible(), ['amber', 'green', 'red']);
  choose('red-amber');
  assert.deepEqual(visible(), ['amber', 'red']);
});
