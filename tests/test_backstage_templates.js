/**
 * Tests for creating a new plan from a Backstage template card (issue #903).
 *
 * Covers planTextFromTemplate() in backstage.js: a template's `.md` content
 * carries its own `title:` front-matter field (e.g. "Software Delivery
 * Project"), which must be rewritten to the name the user gave the new plan
 * so the front matter and the project name don't disagree downstream --
 * browser-excel.js and mpp-export.js both read one as a fallback for the other.
 *
 * setFrontMatterField lives in portfolio-projects-table.js and is a browser
 * global at runtime; it is installed on globalThis here so backstage.js
 * resolves the real implementation rather than a stub.
 *
 * Run with: node tests/test_backstage_templates.js
 */

const path = require('path');
const staticDir = path.join(__dirname, '..', 'packages', 'noodle-web', 'src', 'noodle_web', 'static');

const table = require(path.join(staticDir, 'portfolio-projects-table.js'));
globalThis.setFrontMatterField = table.setFrontMatterField;

const { planTextFromTemplate } = require(path.join(staticDir, 'backstage.js'));

let failures = 0;

function assertEqual(actual, expected, msg) {
    const ok = actual === expected;
    if (!ok) {
        failures++;
        console.error('FAIL:', msg);
        console.error('  expected:', JSON.stringify(expected));
        console.error('  actual:  ', JSON.stringify(actual));
    } else {
        console.log('PASS:', msg);
    }
}

// --- title rewriting -----------------------------------------------------

assertEqual(
    planTextFromTemplate(
        '---\ntitle: Software Delivery Project\nproject manager: Delivery Manager\n---\nPhase 1d\n',
        'Q4 Rollout'
    ),
    '---\ntitle: Q4 Rollout\nproject manager: Delivery Manager\n---\nPhase 1d\n',
    "the template's own title is replaced with the new plan's name"
);

assertEqual(
    planTextFromTemplate('Phase 1d\n', 'Q4 Rollout'),
    '---\ntitle: Q4 Rollout\n---\nPhase 1d\n',
    'a template with no front matter gains a block carrying the title'
);

assertEqual(
    planTextFromTemplate(
        '---\nproject manager: Delivery Manager\n---\nPhase 1d\n',
        'Q4 Rollout'
    ),
    '---\nproject manager: Delivery Manager\ntitle: Q4 Rollout\n---\nPhase 1d\n',
    'front matter without a title field gains one'
);

// --- the rest of the template survives -----------------------------------

const withSections =
    '---\ntitle: Template\nlabels: [software, delivery]\n---\n' +
    'Requirements\n  Gather @analyst 10days 0% "Gather requirements"\n' +
    '---raid log---\nR1 | Risk | High\n';
const rewritten = planTextFromTemplate(withSections, 'My Plan');

assertEqual(
    rewritten,
    withSections.replace('title: Template', 'title: My Plan'),
    'task body, section markers and other front-matter fields are untouched'
);

// --- edge cases ----------------------------------------------------------

assertEqual(
    planTextFromTemplate('---\ntitle: Template\n---\nPhase 1d\n', ''),
    '---\ntitle: Template\n---\nPhase 1d\n',
    'no name means the content is returned unchanged'
);

assertEqual(planTextFromTemplate('', 'Q4 Rollout'), '---\ntitle: Q4 Rollout\n---\n',
    'empty template content still produces a titled blank plan');

assertEqual(planTextFromTemplate(undefined, undefined), '',
    'missing content and name is an empty plan, not a crash');

// --- summary -------------------------------------------------------------

if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
}
console.log('\nAll backstage template tests passed');
