/**
 * Tests for the weekly workload heatmap in portfolio-resources.js (issue #757).
 *
 * The heatmap used to stop after 26 weeks and only covered weeks in which
 * somebody was assigned a task. It must cover every week of every project.
 *
 * Run with: node tests/test_portfolio_resources_heatmap.js
 */

const path = require('path');
const mod = require(path.join(__dirname, '..', 'packages', 'noodle-web',
    'src', 'noodle_web', 'static', 'portfolio-resources.js'));

const {
    aggregateResourceDataFromParsed,
    computePortfolioDateRange,
    computeWeeklyHeatmapData,
} = mod;

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

function parsed(projectName, tasks) {
    return {
        project: { id: projectName.toLowerCase(), name: projectName },
        parsedResult: { success: true, tasks },
    };
}

function task(name, start, finish, durationDays, resources) {
    return { name, start, finish, duration_days: durationDays, resources: resources || '', percent: 0, is_summary: false };
}

// Local-date formatter: the heatmap aligns weeks with setDate/setHours in
// local time, so toISOString (UTC) would be a day out under BST.
const pad = n => String(n).padStart(2, '0');
const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());

// --- No 26-week cap ---------------------------------------------------------

(() => {
    // One resource busy for a full year: Monday 5 Jan to Friday 25 Dec 2026
    // is 51 weekly columns, well past the old cap of 26.
    const projects = [parsed('Long', [
        task('Year-long', '2026-01-05', '2026-12-25', 255, 'alice'),
    ])];
    const resources = aggregateResourceDataFromParsed(projects);
    const data = computeWeeklyHeatmapData(resources, computePortfolioDateRange(projects));

    assertEqual(data.weeks.length, 51, 'a year-long project gets 51 week columns');
    assertEqual(iso(data.weeks[0].start), '2026-01-05', 'first column is the Monday of the first week');
    assertEqual(iso(data.weeks[50].start), '2026-12-21', 'last column is the week containing the finish');
    assertTrue(data.heatmap[0].weekDays[50] > 0, 'work in the final week is counted, not cut off');
})();

// --- Every week of every project, not just the assigned weeks --------------

(() => {
    // Alice is only assigned in March, but the portfolio runs January to
    // June across two projects (one task has no resource at all).
    const projects = [
        parsed('Alpha', [
            task('Unassigned kickoff', '2026-01-05', '2026-01-09', 5),
            task('Build', '2026-03-02', '2026-03-13', 10, 'alice'),
        ]),
        parsed('Beta', [
            task('Unassigned closure', '2026-06-22', '2026-06-26', 5),
        ]),
    ];
    const resources = aggregateResourceDataFromParsed(projects);

    const narrow = computeWeeklyHeatmapData(resources);
    assertEqual(narrow.weeks.length, 2, 'without a range the heatmap covers only the assigned weeks');

    const range = computePortfolioDateRange(projects);
    assertEqual(iso(range.start), '2026-01-05', 'portfolio range starts at the earliest task of any project');
    assertEqual(iso(range.end), '2026-06-26', 'portfolio range ends at the latest task of any project');

    const full = computeWeeklyHeatmapData(resources, range);
    assertEqual(full.weeks.length, 25, 'with the portfolio range the heatmap covers January to June');
    assertEqual(iso(full.weeks[0].start), '2026-01-05', 'first column is the first project week');
    assertEqual(iso(full.weeks[24].start), '2026-06-22', 'last column is the last project week');

    const busy = full.heatmap[0].weekDays.map((d, i) => d > 0 ? i : -1).filter(i => i >= 0);
    assertEqual(busy, [8, 9], "alice's work still lands in the two March weeks");
    assertEqual(full.heatmap[0].weekDays[8] + full.heatmap[0].weekDays[9], 10, 'all 10 days of work are distributed');
})();

// --- Labels carry the year when the span crosses a year boundary -----------

(() => {
    const single = [parsed('One', [task('T', '2026-02-02', '2026-02-27', 20, 'bob')])];
    const singleData = computeWeeklyHeatmapData(
        aggregateResourceDataFromParsed(single), computePortfolioDateRange(single));
    assertTrue(!/\d{2}$/.test(singleData.weeks[0].label) || singleData.weeks[0].label.length <= 6,
        'single-year span keeps short labels');

    const multi = [parsed('Two', [task('T', '2026-11-02', '2027-02-26', 80, 'bob')])];
    const multiData = computeWeeklyHeatmapData(
        aggregateResourceDataFromParsed(multi), computePortfolioDateRange(multi));
    assertTrue(/26$/.test(multiData.weeks[0].label), 'multi-year span puts the year on the first label');
    assertTrue(/27$/.test(multiData.weeks[multiData.weeks.length - 1].label), 'multi-year span puts the year on the last label');
    assertTrue(multiData.weeks[0].title.includes('2026'), 'header tooltip spells out the full date');
})();

// --- Empty inputs -----------------------------------------------------------

(() => {
    assertEqual(computePortfolioDateRange([]), null, 'no projects gives no range');
    assertEqual(computePortfolioDateRange([parsed('X', [task('No dates', null, null, 3, 'a')])]), null,
        'projects without dated tasks give no range');
    assertEqual(computeWeeklyHeatmapData([]), null, 'no resources and no range gives no heatmap');
})();

if (failures > 0) {
    console.error('\n' + failures + ' test(s) failed');
    process.exit(1);
} else {
    console.log('\nAll tests passed');
}
