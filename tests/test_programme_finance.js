/**
 * Tests for the programme dashboard's Finance section (#738):
 * computeProgrammeFinance() in programme.js rolls member-project budget
 * items up against the programme's funding envelope.
 *
 * Run with: node tests/test_programme_finance.js
 */
const path = require('path');
const { computeProgrammeFinance } = require(path.join(__dirname, '..', 'packages', 'noodle-web',
    'src', 'noodle_web', 'static', 'programme.js'));

let failures = 0;
function assertEqual(actual, expected, msg) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        failures++;
        console.error('FAIL:', msg, '\n  expected:', JSON.stringify(expected), '\n  actual:  ', JSON.stringify(actual));
    } else {
        console.log('PASS:', msg);
    }
}

const budgets = [
    { projectId: 'a', projectName: 'A', items: [{ estimate: 100, forecast: 120, total: 50 }, { estimate: 10, forecast: 0, total: 0 }] },
    { projectId: 'b', projectName: 'B', items: [{ estimate: 200, forecast: 180, total: '25' }] },
];

const f = computeProgrammeFinance(budgets, 400);
assertEqual([f.estimate, f.forecast, f.spent], [310, 300, 75], 'sums estimate, forecast and spend across projects');
assertEqual(f.projects[0], { projectId: 'a', projectName: 'A', estimate: 110, forecast: 120, spent: 50 }, 'per-project totals');
assertEqual([f.envelope, f.headroom, f.overspend], [400, 100, false], 'headroom is envelope minus forecast');

const over = computeProgrammeFinance(budgets, 250);
assertEqual([over.headroom, over.overspend], [-50, true], 'forecast above envelope is an overspend');

for (const none of [null, undefined, '', 'abc']) {
    const r = computeProgrammeFinance(budgets, none);
    assertEqual([r.envelope, r.headroom, r.overspend], [null, null, false], `no envelope (${JSON.stringify(none)}) reports no headroom`);
}
assertEqual(computeProgrammeFinance(budgets, 0).headroom, -300, 'a zero envelope is a real envelope');

const empty = computeProgrammeFinance([], 100);
assertEqual([empty.estimate, empty.projects.length, empty.headroom], [0, 0, 100], 'no projects rolls up to zero');
assertEqual(computeProgrammeFinance([{ projectId: 'x', projectName: 'X' }], null).projects[0].forecast, 0, 'missing items tolerated');

if (failures) { console.error(failures + ' failure(s)'); process.exit(1); }
console.log('All programme finance tests passed');
