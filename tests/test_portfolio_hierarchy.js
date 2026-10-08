/**
 * Tests for the hierarchical Portfolio list (#1501): programmes, projects
 * and initiatives in one list, members grouped under their programme.
 *
 * Run with: node tests/test_portfolio_hierarchy.js
 */

const path = require('path');
const staticDir = path.join(__dirname, '..', 'packages', 'noodle-web', 'src', 'noodle_web', 'static');
const table = require(path.join(staticDir, 'portfolio-projects-table.js'));

let failures = 0;
function assertEqual(actual, expected, msg) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        failures++;
        console.error('FAIL:', msg, '\n  expected:', JSON.stringify(expected), '\n  actual:  ', JSON.stringify(actual));
    } else {
        console.log('PASS:', msg);
    }
}

const dt = { slug: 'dt', name: 'Digital Transformation' };
const empty = { slug: 'empty', name: 'Empty' };
const programmes = [dt, empty];
const rows = [
    { id: 'a', name: 'Alpha', planType: 'project', programme: dt },
    { id: 'b', name: 'Beta', planType: 'project', programme: null },
    { id: 'c', name: 'Gamma', planType: 'initiative', programme: dt },
];
const shape = (entries) => entries.map(e => e.programme ? [e.programme.slug, e.children.map(c => c.id)] : e.plan.id);

assertEqual(shape(table.buildPortfolioEntries(rows, programmes, '')),
    [['dt', ['a', 'c']], 'b', ['empty', []]],
    'members group under the programme where its first member sorts; empty programmes come last');

assertEqual(shape(table.buildPortfolioEntries(rows, programmes, 'initiative')),
    [['dt', ['c']]],
    'a type filter keeps only matching members and hides empty programmes');

assertEqual(shape(table.buildPortfolioEntries([], programmes, '')),
    [['dt', []], ['empty', []]],
    'programmes with no members still list');

process.exit(failures ? 1 : 0);
