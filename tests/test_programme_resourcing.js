/**
 * Tests for the programme dashboard's Resourcing section (issue #739 --
 * "Programme: resourcing"): aggregateProgrammeResourceDemand() in
 * programme.js, which scopes aggregateResourceDemandVsCapacity()
 * (portfolio-resources.js) down to a programme's member projects.
 *
 * programme.js calls aggregateResourceDemandVsCapacity() as a bare global
 * (classic scripts, not modules -- see programme.js's file header), so
 * this loads both files into one vm sandbox in load order (same pattern
 * tests/test_ribbon_simple_mode.js uses for ribbon.js + ribbon-ia.js) to
 * exercise the real cross-file reuse, rather than requiring programme.js
 * alone via Node's module system (which would leave
 * aggregateResourceDemandVsCapacity undefined and only exercise the
 * empty-array fallback).
 *
 * Run with: node tests/test_programme_resourcing.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const staticDir = path.join(__dirname, '..', 'packages', 'noodle-web', 'src', 'noodle_web', 'static');
const resourcesSource = fs.readFileSync(path.join(staticDir, 'portfolio-resources.js'), 'utf8');
const programmeSource = fs.readFileSync(path.join(staticDir, 'programme.js'), 'utf8');

const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(resourcesSource, sandbox, { filename: 'portfolio-resources.js' });
vm.runInContext(programmeSource, sandbox, { filename: 'programme.js' });

const { aggregateProgrammeResourceDemand } = sandbox;

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

function assertTrue(cond, msg) {
    if (!cond) {
        failures++;
        console.error('FAIL:', msg);
    } else {
        console.log('PASS:', msg);
    }
}

function parsed(projectId, projectName, tasks) {
    return {
        project: { id: projectId, name: projectName },
        parsedResult: { success: true, tasks },
    };
}

function task(name, start, finish, durationDays, resources) {
    return { name, start, finish, duration_days: durationDays, resources: resources || '', percent: 0, is_summary: false };
}

// --- Scoping: only the programme's member projects are included ------------

(() => {
    // Three projects parsed portfolio-wide; only p1 and p2 belong to the
    // programme. p3's resource (dave) must not appear at all, and alice's
    // demand must not include p3's hours even though she's also on p3.
    const allParsed = [
        parsed('p1', 'Alpha', [task('A1', '2026-01-05', '2026-01-09', 5, 'alice')]),
        parsed('p2', 'Beta', [task('B1', '2026-01-05', '2026-01-09', 5, 'alice, bob')]),
        parsed('p3', 'Gamma', [task('C1', '2026-01-05', '2026-01-09', 5, 'alice, dave')]),
    ];
    const memberIds = new Set(['p1', 'p2']);
    const relevant = allParsed.filter(({ project }) => memberIds.has(project.id));

    const resources = aggregateProgrammeResourceDemand(relevant);
    const names = resources.map((r) => r.name).sort();

    assertEqual(names, ['alice', 'bob'], "only resources from the programme's member projects are included");
    assertTrue(!names.includes('dave'), "dave, who is only on the non-member project, is excluded entirely");

    const alice = resources.find((r) => r.name === 'alice');
    // p1's task is solo (5 days); p2's task is co-assigned with bob, so it
    // splits 2.5/2.5 -- 7.5 total, and crucially none of p3's 5 days.
    assertEqual(alice.totalDays, 7.5, "alice's demand only counts her p1+p2 assignments, not p3's");
    assertEqual(alice.projectCount, 2, 'alice is aggregated across both member projects she is on');
})();

// --- Demand/capacity totals for a small multi-project fixture --------------

(() => {
    const relevant = [
        parsed('p1', 'Alpha', [
            task('Design', '2026-01-05', '2026-01-09', 5, 'carol'),
            task('Build', '2026-01-05', '2026-01-09', 5, 'carol'),
        ]),
        parsed('p2', 'Beta', [
            task('Review', '2026-01-12', '2026-01-16', 5, 'erin'),
        ]),
    ];

    const resources = aggregateProgrammeResourceDemand(relevant);
    assertEqual(resources.length, 2, 'both resources across the two member projects are aggregated');

    const carol = resources.find((r) => r.name === 'carol');
    assertEqual(carol.totalDays, 10, "carol's demand sums both her tasks in the same week");
    assertEqual(carol.capacityDays, 5, 'capacity is the 5 working days her tasks span');
    assertEqual(carol.overCapacity, true, 'double-booked carol is over capacity');

    const erin = resources.find((r) => r.name === 'erin');
    assertEqual(erin.totalDays, 5, "erin's demand is her single task");
    assertEqual(erin.capacityDays, 5, 'capacity matches the working days her task spans');
    assertEqual(erin.overCapacity, false, 'erin is not over capacity');

    // Sorted overloaded-first (workloadLevel order), so carol (10 days,
    // 'medium'/'low' threshold aside -- see calculateWorkloadLevel) comes
    // before erin when tied on workload level, by demand days descending.
    assertEqual(resources[0].name, 'carol', 'carol (more demand) sorts ahead of erin');
})();

// --- Empty inputs -------------------------------------------------------------

assertEqual(aggregateProgrammeResourceDemand([]), [], 'no member projects means no resources');
assertEqual(aggregateProgrammeResourceDemand(undefined), [], 'undefined project list means no resources');

if (failures > 0) {
    console.error('\n' + failures + ' test(s) failed');
    process.exit(1);
} else {
    console.log('\nAll tests passed');
}
