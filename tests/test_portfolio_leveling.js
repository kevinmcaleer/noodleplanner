/**
 * Tests for portfolio-leveling.js (issue #681).
 *
 * Run with: node tests/test_portfolio_leveling.js
 */

// Load the module via Node's CommonJS export hook at the bottom of the file.
// The file uses `if (typeof module !== 'undefined' && module.exports)` so it
// works both in-browser and under Node.
const path = require('path');
const mod = require(path.join(__dirname, '..', 'packages', 'noodle-web',
    'src', 'noodle_web', 'static', 'portfolio-leveling.js'));

const {
    computeLevellingSuggestions,
    annotateTaskWithLevellingFlag,
    stripLevellingFlags,
    computePortfolioAnchor,
    _toShortname,
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

// --- annotateTaskWithLevellingFlag -----------------------------------------

(() => {
    const plan = 'Project:\n  Phase:\n    DesignReview 3d @alice\n    Build 5d @bob\n';
    const out = annotateTaskWithLevellingFlag(plan, 'DesignReview', 'alice', '2026-05-18');
    assertTrue(
        out.includes('DesignReview 3d @alice [levelled @alice 2026-05-18]'),
        'annotate appends flag to matching task line'
    );
    assertTrue(
        out.includes('Build 5d @bob'),
        'annotate leaves other tasks untouched'
    );
})();

(() => {
    // Re-annotating replaces the existing flag for the same resource.
    const plan = '    DesignReview 3d @alice [levelled @alice 2026-05-10]\n';
    const out = annotateTaskWithLevellingFlag(plan, 'DesignReview', 'alice', '2026-05-18');
    assertTrue(
        out.includes('[levelled @alice 2026-05-18]'),
        're-annotate updates the date'
    );
    assertTrue(
        !out.includes('[levelled @alice 2026-05-10]'),
        're-annotate removes the old date'
    );
})();

// --- stripLevellingFlags ---------------------------------------------------

(() => {
    const plan = (
        '    TaskOne 3d @alice [levelled @alice 2026-05-18]\n' +
        '    TaskTwo 2d @bob [levelled bob 2026-05-22]\n'
    );
    const out = stripLevellingFlags(plan);
    assertTrue(!out.includes('[levelled'), 'strip removes every flag');
    assertTrue(out.includes('TaskOne 3d @alice'), 'strip preserves task content');
    assertTrue(out.includes('TaskTwo 2d @bob'), 'strip preserves task content');
})();

// --- _toShortname ---------------------------------------------------------

(() => {
    assertEqual(_toShortname('Alice'), 'alice', 'shortname lowercases single name');
    assertEqual(_toShortname('Kevin McAleer'), 'kevin-mcaleer', 'shortname hyphenates multi-word name');
    assertEqual(_toShortname('  Bob  '), 'bob', 'shortname trims whitespace');
})();

// --- annotate with multi-word resource name --------------------------------

(() => {
    const plan = '  DesignReview 3d @Kevin McAleer\n';
    const out = annotateTaskWithLevellingFlag(plan, 'DesignReview', 'Kevin McAleer', '2026-05-18');
    assertTrue(
        out.includes('[levelled @kevin-mcaleer 2026-05-18]'),
        'annotate uses hyphenated shortname for multi-word resource'
    );
    // Verify the flag can be stripped back off
    const stripped = stripLevellingFlags(out);
    assertTrue(
        !stripped.includes('[levelled'),
        'strip removes flag written with hyphenated shortname'
    );
})();

// --- computePortfolioAnchor -----------------------------------------------

(() => {
    const parsed = [
        { project: { id: 'p1', name: 'Early' }, parsedResult: { success: true, tasks: [
            { name: 'A', start: '2026-01-05', finish: '2026-01-06', resources: '@x', duration_days: 1 }
        ] } },
        { project: { id: 'p2', name: 'Late' }, parsedResult: { success: true, tasks: [
            { name: 'B', start: '2026-03-02', finish: '2026-03-03', resources: '@x', duration_days: 1 }
        ] } },
    ];
    const anchor = computePortfolioAnchor(parsed);
    assertEqual(
        anchor && anchor.toISOString().slice(0, 10),
        '2026-01-05',
        'anchor is earliest start across portfolio'
    );
})();

// --- computeLevellingSuggestions ------------------------------------------

(() => {
    // Two 5-day tasks assigned to @alice overlapping Jan 5–9 should force the
    // second task to shift later.
    const parsed = [
        { project: { id: 'p1', name: 'A' }, parsedResult: { success: true, tasks: [
            {
                name: 'First', start: '2026-01-05', finish: '2026-01-09',
                resources: '@alice', duration_days: 5, priority: 'High',
                percent: 0, is_summary: false
            }
        ] } },
        { project: { id: 'p2', name: 'B' }, parsedResult: { success: true, tasks: [
            {
                name: 'Second', start: '2026-01-05', finish: '2026-01-09',
                resources: '@alice', duration_days: 5, priority: 'Low',
                percent: 0, is_summary: false
            }
        ] } },
    ];
    const s = computeLevellingSuggestions(parsed);
    assertTrue(s.length >= 1, 'at least one suggestion produced');
    const sugg = s.find(x => x.taskName === 'Second' || x.taskName === 'First');
    assertTrue(!!sugg, 'suggestion targets one of the overlapping tasks');
    assertTrue(
        sugg.proposedStart > sugg.originalStart,
        'proposed start is strictly later than original'
    );
    assertTrue(sugg.shiftWorkingDays >= 1, 'shift is at least one working day');
})();

(() => {
    // Single task with a single resource should NEVER generate a suggestion —
    // no contention exists.
    const parsed = [
        { project: { id: 'p1', name: 'A' }, parsedResult: { success: true, tasks: [
            {
                name: 'Only', start: '2026-01-05', finish: '2026-01-09',
                resources: '@alice', duration_days: 5, priority: 'Low',
                percent: 0, is_summary: false
            }
        ] } },
    ];
    const s = computeLevellingSuggestions(parsed);
    assertEqual(s.length, 0, 'no suggestions when no contention');
})();

console.log(failures === 0
    ? `\nAll tests passed.`
    : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
