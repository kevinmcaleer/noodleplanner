/**
 * Tests for grouping projects into a programme from the portfolio view
 * (issue #952).
 *
 * Covers the pure/testable helpers in portfolio-projects-table.js:
 *   - slugify(): free-text programme name -> URL-safe slug.
 *   - setFrontMatterField() / removeFrontMatterField(): the generic
 *     front-matter field setter reused for programme/programme_name,
 *     following the same match-and-splice approach as
 *     setVersionInFrontMatter()/setRagInFrontMatter() elsewhere.
 *   - applyProgrammeFrontMatter(): set-or-clear programme membership on a
 *     single plan.
 *   - applyProgrammeToSelection(): batch version used by "group selected
 *     into a programme" / "add to programme" / "remove from programme" --
 *     only the selected projects' planText changes.
 *   - computeRangeSelection(): shift-click contiguous range selection.
 *   - rectsIntersect() / projectIdsInLasso(): the lasso hit-testing math.
 *     The mousedown/mousemove DOM wiring around these is not unit tested
 *     here (it is not reasonably testable without a browser) -- see the
 *     manual verification notes in the PR description instead.
 *
 * Run with: node tests/test_portfolio_grouping.js
 */

const path = require('path');
const mod = require(path.join(__dirname, '..', 'packages', 'noodle-web',
    'src', 'noodle_web', 'static', 'portfolio-projects-table.js'));

const {
    slugify,
    setFrontMatterField,
    removeFrontMatterField,
    applyProgrammeFrontMatter,
    applyProgrammeToSelection,
    computeRangeSelection,
    rectsIntersect,
    projectIdsInLasso,
    extractProjectProgramme,
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

// --- slugify ---------------------------------------------------------------

assertEqual(slugify('Digital Transformation'), 'digital-transformation',
    'spaces become hyphens, lowercased');
assertEqual(slugify('  Customer Platform 2026!  '), 'customer-platform-2026',
    'punctuation stripped, surrounding whitespace trimmed');
assertEqual(slugify("Kev's \"Big\" Programme"), 'kevs-big-programme',
    'quotes/apostrophes are dropped (not hyphenated) before other punctuation is collapsed');
assertEqual(slugify('---'), '', 'an all-punctuation name slugifies to empty');
assertEqual(slugify(''), '', 'empty name slugifies to empty');
assertEqual(slugify(null), '', 'null name slugifies to empty');

// --- setFrontMatterField / removeFrontMatterField ---------------------------

assertEqual(
    setFrontMatterField('---\ntitle: T\n---\nTask 1d\n', 'programme', 'migration'),
    '---\ntitle: T\nprogramme: migration\n---\nTask 1d\n',
    'setFrontMatterField appends a new field to existing front matter'
);

assertEqual(
    setFrontMatterField('---\ntitle: T\nprogramme: old-slug\n---\nTask 1d\n', 'programme', 'new-slug'),
    '---\ntitle: T\nprogramme: new-slug\n---\nTask 1d\n',
    'setFrontMatterField replaces an existing field in place'
);

assertEqual(
    setFrontMatterField('Task 1d\n', 'programme', 'migration'),
    '---\nprogramme: migration\n---\nTask 1d\n',
    'setFrontMatterField creates a front-matter block when none exists'
);

assertEqual(
    removeFrontMatterField('---\ntitle: T\nprogramme: migration\n---\nTask 1d\n', 'programme'),
    '---\ntitle: T\n---\nTask 1d\n',
    'removeFrontMatterField drops the field line and keeps the rest'
);

assertEqual(
    removeFrontMatterField('---\ntitle: T\n---\nTask 1d\n', 'programme'),
    '---\ntitle: T\n---\nTask 1d\n',
    'removeFrontMatterField is a no-op when the field is absent'
);

assertEqual(
    removeFrontMatterField('Task 1d\n', 'programme'),
    'Task 1d\n',
    'removeFrontMatterField is a no-op when there is no front matter at all'
);

// --- applyProgrammeFrontMatter ----------------------------------------------

(() => {
    const result = applyProgrammeFrontMatter('---\ntitle: Alpha\n---\nTask 1d\n',
        'digital-transformation', 'Digital Transformation');
    const programme = extractProjectProgramme(result);
    assertEqual(programme, { slug: 'digital-transformation', name: 'Digital Transformation' },
        'applyProgrammeFrontMatter sets both programme and programme_name, readable back via extractProjectProgramme');
})();

(() => {
    const grouped = applyProgrammeFrontMatter('---\ntitle: Alpha\n---\nTask 1d\n', 'migration', 'Migration');
    const cleared = applyProgrammeFrontMatter(grouped, null, null);
    assertEqual(extractProjectProgramme(cleared), null,
        'applyProgrammeFrontMatter with a falsy slug clears programme membership entirely');
    assertEqual(cleared.includes('title: Alpha'), true,
        'clearing programme membership leaves unrelated front matter untouched');
})();

// --- applyProgrammeToSelection (group / add / remove) -----------------------

(() => {
    const projects = [
        { id: 'p1', name: 'Alpha', planText: '---\ntitle: Alpha\n---\nTask 1d\n' },
        { id: 'p2', name: 'Beta', planText: '---\ntitle: Beta\n---\nTask 1d\n' },
        { id: 'p3', name: 'Gamma', planText: '---\ntitle: Gamma\n---\nTask 1d\n' },
    ];

    const grouped = applyProgrammeToSelection(projects, ['p1', 'p3'], 'digital-transformation', 'Digital Transformation');

    assertEqual(extractProjectProgramme(grouped.find(p => p.id === 'p1').planText),
        { slug: 'digital-transformation', name: 'Digital Transformation' },
        'group selected into new programme: selected project p1 gains the slug');
    assertEqual(extractProjectProgramme(grouped.find(p => p.id === 'p3').planText),
        { slug: 'digital-transformation', name: 'Digital Transformation' },
        'group selected into new programme: selected project p3 gains the slug');
    assertEqual(extractProjectProgramme(grouped.find(p => p.id === 'p2').planText), null,
        'group selected into new programme: unselected project p2 is untouched');
    assertEqual(grouped.find(p => p.id === 'p2'), projects[1],
        'unselected projects keep the same object reference (no unnecessary copy)');

    const removed = applyProgrammeToSelection(grouped, ['p1'], null, null);
    assertEqual(extractProjectProgramme(removed.find(p => p.id === 'p1').planText), null,
        'remove from programme: p1 loses its programme fields');
    assertEqual(extractProjectProgramme(removed.find(p => p.id === 'p3').planText),
        { slug: 'digital-transformation', name: 'Digital Transformation' },
        'remove from programme only affects the selected subset -- p3 keeps its membership');
})();

(() => {
    // "Add to programme" overwrites any existing membership rather than
    // creating a list -- one project belongs to at most one programme.
    const projects = [
        { id: 'p1', planText: '---\nprogramme: old-programme\n---\nTask 1d\n' },
    ];
    const moved = applyProgrammeToSelection(projects, ['p1'], 'new-programme', 'New Programme');
    assertEqual(extractProjectProgramme(moved[0].planText),
        { slug: 'new-programme', name: 'New Programme' },
        'adding to a different programme overwrites the previous membership rather than appending');
})();

// --- computeRangeSelection (shift-click) ------------------------------------

const order = ['p1', 'p2', 'p3', 'p4', 'p5'];

assertEqual(computeRangeSelection(order, 'p2', 'p4'), ['p2', 'p3', 'p4'],
    'shift-click range selects forward-inclusive from anchor to target');
assertEqual(computeRangeSelection(order, 'p4', 'p2'), ['p2', 'p3', 'p4'],
    'shift-click range works when the target is before the anchor');
assertEqual(computeRangeSelection(order, 'p3', 'p3'), ['p3'],
    'shift-click on the anchor itself selects just that one');
assertEqual(computeRangeSelection(order, 'missing', 'p2'), ['p2'],
    'an anchor no longer in the visible list falls back to just the target');
assertEqual(computeRangeSelection(order, 'p2', 'missing'), ['missing'],
    'a target not in the visible list falls back to just the (invalid) target -- not expected in practice, ' +
    'since targetId always comes from a currently rendered row\'s click event');

// --- rectsIntersect / projectIdsInLasso -------------------------------------

const rectA = { left: 0, top: 0, right: 10, bottom: 10 };
assertEqual(rectsIntersect(rectA, { left: 5, top: 5, right: 15, bottom: 15 }), true,
    'overlapping rectangles intersect');
assertEqual(rectsIntersect(rectA, { left: 20, top: 20, right: 30, bottom: 30 }), false,
    'disjoint rectangles do not intersect');
assertEqual(rectsIntersect(rectA, { left: 10, top: 10, right: 20, bottom: 20 }), false,
    'rectangles that only touch at an edge do not count as intersecting');

(() => {
    const rowRects = [
        { id: 'p1', left: 0, top: 0, right: 100, bottom: 20 },
        { id: 'p2', left: 0, top: 20, right: 100, bottom: 40 },
        { id: 'p3', left: 0, top: 40, right: 100, bottom: 60 },
    ];
    const lasso = { left: 0, top: 10, right: 50, bottom: 45 };
    assertEqual(projectIdsInLasso(rowRects, lasso), ['p1', 'p2', 'p3'],
        'a lasso rectangle spanning three rows selects all three, including a partial overlap at each end');

    const tightLasso = { left: 0, top: 21, right: 50, bottom: 39 };
    assertEqual(projectIdsInLasso(rowRects, tightLasso), ['p2'],
        'a lasso rectangle wholly inside one row selects only that row');

    assertEqual(projectIdsInLasso(rowRects, { left: 200, top: 200, right: 300, bottom: 300 }), [],
        'a lasso rectangle over empty space selects nothing');
})();

console.log(failures === 0
    ? `\nAll tests passed.`
    : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
