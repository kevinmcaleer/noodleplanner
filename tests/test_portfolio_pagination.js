/**
 * Tests for Portfolio table pagination (#1494).
 *
 * Run with: node tests/test_portfolio_pagination.js
 */

const path = require('path');
const staticDir = path.join(__dirname, '..', 'packages', 'noodle-web', 'src', 'noodle_web', 'static');
const table = require(path.join(staticDir, 'portfolio-projects-table.js'));

let failures = 0;

function assertEqual(actual, expected, msg) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) {
        failures++;
        console.error('FAIL:', msg);
        console.error('  expected:', JSON.stringify(expected));
        console.error('  actual:  ', JSON.stringify(actual));
    } else {
        console.log('PASS:', msg);
    }
}

const rows = Array.from({ length: 60 }, (_, i) => i + 1);

let p = table.paginateProjects(rows, 1, 25);
assertEqual([p.rows.length, p.rows[0], p.pages, p.from, p.to, p.total], [25, 1, 3, 1, 25, 60], 'first page');
p = table.paginateProjects(rows, 3, 25);
assertEqual([p.rows.length, p.rows[0], p.from, p.to], [10, 51, 51, 60], 'last page is short');
p = table.paginateProjects(rows, 99, 25);
assertEqual(p.page, 3, 'page past the end clamps to the last');
p = table.paginateProjects(rows, 0, 25);
assertEqual(p.page, 1, 'page below 1 clamps to the first');
p = table.paginateProjects(rows, undefined, 25);
assertEqual(p.page, 1, 'missing page is the first');
p = table.paginateProjects([], 1, 25);
assertEqual([p.rows.length, p.pages, p.from, p.to], [0, 1, 0, 0], 'no rows is one empty page');

assertEqual(table.portfolioPagerHtml(table.paginateProjects(rows.slice(0, 10), 1, 25), 25), '',
    'no pager when everything fits the smallest page size');
const html = table.portfolioPagerHtml(table.paginateProjects(rows, 1, 25), 25);
assertEqual(html.includes('Showing 1–25 of 60'), true, 'pager shows the range');
assertEqual(/portfolio-pager-prev"[^>]*disabled/.test(html), true, 'Previous disabled on page 1');
assertEqual(/portfolio-pager-next"[^>]*disabled/.test(html), false, 'Next enabled on page 1');
const last = table.portfolioPagerHtml(table.paginateProjects(rows, 3, 25), 25);
assertEqual(/portfolio-pager-next"[^>]*disabled/.test(last), true, 'Next disabled on the last page');
assertEqual(html.includes('<option value="25" selected>'), true, 'current page size is selected');

if (failures) {
    console.error(failures + ' test(s) failed');
    process.exit(1);
}
