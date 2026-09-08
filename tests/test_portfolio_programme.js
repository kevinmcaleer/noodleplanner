/**
 * Tests for programme membership via project front-matter (issue #951).
 *
 * Covers the derivation helpers in portfolio-projects-table.js:
 *   - extractProjectProgramme(): reads `programme:`/`programme_name:` off
 *     a single plan's front matter, deriving a display name from the slug
 *     when `programme_name` is absent.
 *   - deriveProgrammes(): groups a loaded project list by programme slug;
 *     projects with no `programme:` field are excluded (unassigned).
 *
 * Run with: node tests/test_portfolio_programme.js
 */

const path = require('path');
const mod = require(path.join(__dirname, '..', 'packages', 'noodle-web',
    'src', 'noodle_web', 'static', 'portfolio-projects-table.js'));

const {
    programmeNameFromSlug,
    extractProjectProgramme,
    deriveProgrammes,
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

// --- programmeNameFromSlug ---------------------------------------------

assertEqual(programmeNameFromSlug('digital-transformation'), 'Digital Transformation',
    'hyphenated slug becomes title case');
assertEqual(programmeNameFromSlug('customer_platform_2026'), 'Customer Platform 2026',
    'underscored slug becomes title case');
assertEqual(programmeNameFromSlug('migration'), 'Migration', 'single word slug');

// --- extractProjectProgramme --------------------------------------------

assertEqual(
    extractProjectProgramme('---\ntitle: T\nprogramme: digital-transformation\n---\nTask 1d\n'),
    { slug: 'digital-transformation', name: 'Digital Transformation' },
    'programme slug with no programme_name derives a display name'
);

assertEqual(
    extractProjectProgramme(
        '---\ntitle: T\nprogramme: digital-transformation\n' +
        'programme_name: Digital Transformation Programme\n---\nTask 1d\n'
    ),
    { slug: 'digital-transformation', name: 'Digital Transformation Programme' },
    'explicit programme_name is used verbatim'
);

assertEqual(
    extractProjectProgramme('---\ntitle: T\n---\nTask 1d\n'),
    null,
    'no programme field means unassigned (null)'
);

assertEqual(extractProjectProgramme(''), null, 'empty plan text means unassigned (null)');

// --- deriveProgrammes -----------------------------------------------------

(() => {
    const projects = [
        { id: 'p1', name: 'Alpha', planText: '---\nprogramme: digital-transformation\n---\nTask 1d\n' },
        { id: 'p2', name: 'Beta', planText: '---\ntitle: no programme\n---\nTask 1d\n' },
        { id: 'p3', name: 'Gamma', planText: '---\nprogramme: digital-transformation\nprogramme_name: DT\n---\nTask 1d\n' },
        { id: 'p4', name: 'Delta', planText: '---\nprogramme: customer-platform\n---\nTask 1d\n' },
    ];

    const programmes = deriveProgrammes(projects);

    assertEqual(programmes.length, 2, 'two distinct programmes derived from four projects');
    assertEqual(programmes[0].slug, 'digital-transformation', 'first programme is the one seen first');
    assertEqual(programmes[0].projects.map(p => p.id), ['p1', 'p3'],
        'digital-transformation groups p1 and p3');
    // The first project encountered (p1) has no programme_name, so its
    // group keeps that project's derived name -- p3's explicit name does
    // not retroactively relabel the group.
    assertEqual(programmes[0].name, 'Digital Transformation',
        "group name comes from the first project's programme, not a later one");
    assertEqual(programmes[1].slug, 'customer-platform', 'second programme is customer-platform');
    assertEqual(programmes[1].projects.map(p => p.id), ['p4'], 'customer-platform has just p4');

    const allGrouped = programmes.flatMap(p => p.projects.map(pr => pr.id));
    assertEqual(allGrouped.includes('p2'), false, 'unassigned project p2 is excluded from every group');
})();

assertEqual(deriveProgrammes([]), [], 'empty project list derives no programmes');
assertEqual(deriveProgrammes(undefined), [], 'undefined project list derives no programmes');

console.log(failures === 0
    ? `\nAll tests passed.`
    : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
