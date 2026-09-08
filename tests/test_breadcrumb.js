/**
 * Tests for the multi-rung breadcrumb (issue #953: Portfolio › <Programme>
 * › <Project>).
 *
 * Covers computeBreadcrumbRungs() in breadcrumb.js -- pure rung-computation
 * logic, no DOM, so it's testable the same way test_portfolio_programme.js
 * tests deriveProgrammes()/extractProjectProgramme().
 *
 * Run with: node tests/test_breadcrumb.js
 */

const path = require('path');
const mod = require(path.join(__dirname, '..', 'packages', 'noodle-web',
    'src', 'noodle_web', 'static', 'breadcrumb.js'));

const { computeBreadcrumbRungs } = mod;

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

// --- Portfolio altitude ----------------------------------------------------

assertEqual(
    computeBreadcrumbRungs({ view: 'portfolio' }),
    [{ kind: 'portfolio', label: 'Portfolio', active: true }],
    'portfolio view is a single active Portfolio rung'
);

// --- Programme altitude -----------------------------------------------------

assertEqual(
    computeBreadcrumbRungs({
        view: 'programme',
        programme: { slug: 'digital-transformation', name: 'Digital Transformation' },
    }),
    [
        { kind: 'portfolio', label: 'Portfolio', active: false },
        { kind: 'programme', label: 'Digital Transformation', slug: 'digital-transformation', active: true },
    ],
    'programme view with a resolved programme shows Portfolio (inactive) + Programme (active)'
);

assertEqual(
    computeBreadcrumbRungs({ view: 'programme', programme: null }),
    [{ kind: 'portfolio', label: 'Portfolio', active: false }],
    'programme view with no resolved programme (e.g. it was ungrouped) degrades to just Portfolio, not a broken rung'
);

// --- Project altitude, no programme -----------------------------------------

assertEqual(
    computeBreadcrumbRungs({ view: 'editor', project: { name: 'Website Revamp', programme: null } }),
    [
        { kind: 'portfolio', label: 'Portfolio', active: false },
        { kind: 'project', label: 'Website Revamp', active: true },
    ],
    'a project with no programme shows Portfolio + Project, no empty middle rung'
);

// --- Project altitude, in a programme ---------------------------------------

assertEqual(
    computeBreadcrumbRungs({
        view: 'raid',
        project: {
            name: 'Website Revamp',
            programme: { slug: 'digital-transformation', name: 'Digital Transformation' },
        },
    }),
    [
        { kind: 'portfolio', label: 'Portfolio', active: false },
        { kind: 'programme', label: 'Digital Transformation', slug: 'digital-transformation', active: false },
        { kind: 'project', label: 'Website Revamp', active: true },
    ],
    'a project view (any project-context view, not just editor) in a programme shows all three rungs'
);

// --- Views with no breadcrumb ------------------------------------------------

assertEqual(computeBreadcrumbRungs({ view: 'backstage' }), [], 'backstage view has no breadcrumb');
assertEqual(computeBreadcrumbRungs({ view: 'upload' }), [], 'upload view has no breadcrumb');
assertEqual(computeBreadcrumbRungs({ view: null }), [], 'no current view has no breadcrumb');
assertEqual(
    computeBreadcrumbRungs({ view: 'editor', project: null }),
    [],
    'a project-context view with no active project degrades to no rungs, not a broken one'
);

console.log(failures === 0
    ? `\nAll tests passed.`
    : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
