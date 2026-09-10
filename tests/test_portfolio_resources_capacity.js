/**
 * Tests for aggregateResourceDemandVsCapacity() in portfolio-resources.js
 * (issue #739 -- "Programme: resourcing"), the demand-vs-capacity figure
 * the programme dashboard's Resourcing section (programme.js) reuses via
 * aggregateProgrammeResourceDemand() -- see tests/test_programme_resourcing.js
 * for the programme-scoping tests, which load this file and programme.js
 * together in a vm sandbox.
 *
 * Run with: node tests/test_portfolio_resources_capacity.js
 */

const path = require('path');
const mod = require(path.join(__dirname, '..', 'packages', 'noodle-web',
    'src', 'noodle_web', 'static', 'portfolio-resources.js'));

const { aggregateResourceDemandVsCapacity } = mod;

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

function parsed(projectName, tasks) {
    return {
        project: { id: projectName.toLowerCase(), name: projectName },
        parsedResult: { success: true, tasks },
    };
}

function task(name, start, finish, durationDays, resources) {
    return { name, start, finish, duration_days: durationDays, resources: resources || '', percent: 0, is_summary: false };
}

// --- Demand within capacity --------------------------------------------------

(() => {
    // Mon 2026-01-05 .. Fri 2026-01-09 is a single working week (5 working
    // days) with 5 days of work for alice -- fully utilised, not over.
    const projects = [parsed('Alpha', [
        task('Build', '2026-01-05', '2026-01-09', 5, 'alice'),
    ])];
    const [alice] = aggregateResourceDemandVsCapacity(projects);
    assertEqual(alice.totalDays, 5, "alice's demand is the 5 days on the task");
    assertEqual(alice.capacityDays, 5, 'capacity is the 5 working days spanned by the task');
    assertEqual(alice.utilisationPercent, 100, 'fully utilised is 100%');
    assertEqual(alice.overCapacity, false, 'demand equal to capacity is not over capacity');
})();

// --- Demand exceeding capacity ------------------------------------------------

(() => {
    // Two 5-day tasks for bob, both landing in the same single working
    // week (Mon-Fri): 10 days of demand against 5 working days of capacity.
    const projects = [parsed('Alpha', [
        task('Design', '2026-01-05', '2026-01-09', 5, 'bob'),
        task('Review', '2026-01-05', '2026-01-09', 5, 'bob'),
    ])];
    const [bob] = aggregateResourceDemandVsCapacity(projects);
    assertEqual(bob.totalDays, 10, "bob's demand sums both tasks");
    assertEqual(bob.capacityDays, 5, 'capacity is still just the 5 working days in the span');
    assertEqual(bob.utilisationPercent, 200, 'double-booked in the same week is 200% utilisation');
    assertEqual(bob.overCapacity, true, 'demand exceeding capacity is flagged over capacity');
})();

// --- Multi-project demand scoping (the shape the programme dashboard reuses) -

(() => {
    const projects = [
        parsed('Alpha', [task('A task', '2026-01-05', '2026-01-16', 10, 'carol')]),
        parsed('Beta', [task('B task', '2026-01-19', '2026-01-23', 5, 'carol')]),
    ];
    const [carol] = aggregateResourceDemandVsCapacity(projects);
    assertEqual(carol.projectCount, 2, "carol's demand spans both projects passed in");
    assertEqual(carol.totalDays, 15, 'demand sums across both projects');
    // 2026-01-05 (Mon) .. 2026-01-23 (Fri) is three full working weeks = 15 working days.
    assertEqual(carol.capacityDays, 15, 'capacity spans the full earliest-start..latest-finish range across both projects');
    assertEqual(carol.utilisationPercent, 100, 'fully utilised across the combined span');
    assertEqual(carol.overCapacity, false, 'demand matching capacity across projects is not over capacity');
})();

// --- No dated span -------------------------------------------------------------

(() => {
    const projects = [parsed('Alpha', [
        { name: 'No dates', start: null, finish: null, duration_days: 3, resources: 'dana', percent: 0, is_summary: false },
    ])];
    const [dana] = aggregateResourceDemandVsCapacity(projects);
    assertEqual(dana.capacityDays, 0, 'no dated span means no measurable capacity');
    assertEqual(dana.utilisationPercent, null, 'utilisation is unknown, not zero, when capacity cannot be measured');
    assertEqual(dana.overCapacity, false, 'cannot be flagged over capacity without a measurable capacity');
})();

assertEqual(aggregateResourceDemandVsCapacity([]), [], 'no projects means no resources');

if (failures > 0) {
    console.error('\n' + failures + ' test(s) failed');
    process.exit(1);
} else {
    console.log('\nAll tests passed');
}
