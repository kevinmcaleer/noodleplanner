/**
 * Tests for initiatives (epic #1476): plan type, stated RAG, template, and how
 * an initiative joins a programme and the projects table.
 *
 * Run with: node tests/test_initiative.js
 */

const path = require('path');
const staticDir = path.join(__dirname, '..', 'packages', 'noodle-web', 'src', 'noodle_web', 'static');
const init = require(path.join(staticDir, 'initiative.js'));
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

const fm = (...lines) => '---\n' + lines.join('\n') + '\n---\nTask 1d\n';

// --- plan type (#1477) ---------------------------------------------------

assertEqual(init.extractPlanType(fm('title: T', 'type: initiative')), 'initiative', 'type: initiative');
assertEqual(init.extractPlanType(fm('title: T', 'type:  Initiative ')), 'initiative', 'case and spaces ignored');
assertEqual(init.extractPlanType(fm('title: T', 'type: project')), 'project', 'type: project');
assertEqual(init.extractPlanType(fm('title: T')), 'project', 'missing type is a project');
assertEqual(init.extractPlanType(fm('title: T', 'type: epic')), 'project', 'unknown type is a project');
assertEqual(init.extractPlanType('Task 1d\n'), 'project', 'no front matter is a project');
assertEqual(init.extractPlanType(''), 'project', 'empty plan is a project');
assertEqual(init.isInitiativeFrontMatter({ type: 'initiative' }), true, 'parsed front matter: initiative');
assertEqual(init.isInitiativeFrontMatter({ type: 'project' }), false, 'parsed front matter: project');
assertEqual(init.isInitiativeFrontMatter(null), false, 'null front matter is not an initiative');

// --- stated RAG (#1481) --------------------------------------------------

assertEqual(init.normaliseInitiativeRag('Amber'), 'amber', 'Amber normalises');
assertEqual(init.normaliseInitiativeRag('yellow'), 'amber', 'yellow is amber');
assertEqual(init.normaliseInitiativeRag('R'), 'red', 'single letter R');
assertEqual(init.normaliseInitiativeRag('purple'), null, 'unknown colour is unrated');
assertEqual(init.getInitiativeRag(fm('type: initiative')), { rag: null, comment: '', updated: '' },
    'an initiative with no rag is unrated');
assertEqual(
    init.getInitiativeRag(fm('type: initiative', 'rag: amber', 'rag_comment: Waiting on supplier', 'rag_updated: 2026-10-08')),
    { rag: 'amber', comment: 'Waiting on supplier', updated: '2026-10-08' },
    'stated rag, comment and date are read'
);

const rated = init.setInitiativeRag(fm('title: T', 'type: initiative'), 'Red', 'Slipped a month', '2026-10-08');
assertEqual(init.getInitiativeRag(rated),
    { rag: 'red', comment: 'Slipped a month', updated: '2026-10-08' }, 'setInitiativeRag round-trips');
assertEqual(init.extractPlanType(rated), 'initiative', 'rating keeps the type');
const reRated = init.setInitiativeRag(rated, 'green', '', '2026-10-09');
assertEqual(init.getInitiativeRag(reRated), { rag: 'green', comment: '', updated: '2026-10-09' },
    're-rating replaces the comment and date');
assertEqual((reRated.match(/^rag:/gm) || []).length, 1, 're-rating does not duplicate the field');
const cleared = init.setInitiativeRag(reRated, null);
assertEqual(init.getInitiativeRag(cleared), { rag: null, comment: '', updated: '' }, 'null clears back to unrated');

// --- template (#1478) ----------------------------------------------------

const template = init.buildInitiativeTemplate('Tidy the wiki');
assertEqual(init.extractPlanType(template), 'initiative', 'template is an initiative');
assertEqual(/^title: Tidy the wiki$/m.test(template), true, 'template carries the name');
assertEqual(init.getInitiativeRag(template).rag, null, 'a new initiative starts unrated');
assertEqual(/milestone|gateway/i.test(template), false, 'template has no milestones or gateways');

// --- status and labels ---------------------------------------------------

assertEqual(init.initiativeRagLabel('green'), 'On Track', 'green label');
assertEqual(init.initiativeRagLabel('unrated'), 'Not Rated', 'unrated label');
assertEqual(table.extractProjectStatus(fm('type: initiative')), 'Not Rated', 'projects table: unrated initiative');
assertEqual(table.extractProjectStatus(fm('type: initiative', 'rag: amber')), 'Amber', 'projects table: stated amber');
assertEqual(table.extractProjectStatus(fm('title: T')), 'Active', 'projects table: a project is unchanged');

// --- programme membership (#1480) ---------------------------------------

const projects = [
    { id: 'p1', planText: fm('title: A', 'programme: digital') },
    { id: 'i1', planText: fm('title: B', 'type: initiative', 'programme: digital') },
    { id: 'i2', planText: fm('title: C', 'type: initiative') },
];
const programmes = table.deriveProgrammes(projects);
assertEqual(programmes.length, 1, 'one programme derived');
assertEqual(programmes[0].projects.map(p => p.id), ['p1', 'i1'], 'an initiative joins its programme');
assertEqual(programmes.some(p => p.projects.some(x => x.id === 'i2')), false, 'a standalone initiative has no programme');

// --- move under a programme (#1487) ---------------------------------------

const standalone = fm('title: C', 'type: initiative');
const moved = init.setInitiativeProgramme(standalone, { slug: 'digital', name: 'Digital' });
assertEqual(table.extractProjectProgramme(moved), { slug: 'digital', name: 'Digital' }, 'initiative moved under a programme');
assertEqual(init.isInitiativePlan(moved), true, 'moving keeps it an initiative');
const reassigned = init.setInitiativeProgramme(moved, { slug: 'ops', name: 'Ops' });
assertEqual((reassigned.match(/^programme:/gm) || []).length, 1, 'moving again does not duplicate the field');
assertEqual(table.extractProjectProgramme(reassigned).slug, 'ops', 'moved to another programme');
assertEqual(table.extractProjectProgramme(init.setInitiativeProgramme(reassigned, null)), null, 'moved out of its programme');

// --- switching plan type (#1507) --------------------------------------------

const rich = [
    '---', 'title: "Rich: plan"', '# keep this comment', 'sponsor: Ada', 'programme: digital',
    'programme_name: Digital', 'labels: [a, b]', 'resources:', '  - ab: Alice B', 'dependencies:',
    '  - from: Other', '    type: FS', 'rag: amber', '---', '', '# Phase', 'Task one 2d @ab', 'Task two 3d', '',
].join('\n');
const noFm = 'Task 1d\nTask 2d\n';
['project', 'initiative'].forEach(from => {
    const base = from === 'initiative' ? rich.replace('sponsor: Ada', 'type: initiative\nsponsor: Ada') : rich;
    ['project', 'initiative'].forEach(to => {
        const switched = init.setPlanType(base, to);
        assertEqual(init.extractPlanType(switched), to, from + ' -> ' + to + ' sets the type');
        const strip = t => t.split('\n').filter(l => l !== 'type: initiative').join('\n');
        assertEqual(strip(switched), strip(base), from + ' -> ' + to + ' changes only the type line');
        assertEqual(init.setPlanType(switched, from), from === 'initiative' && to === 'initiative' ? base : init.setPlanType(switched, from), 'switching back is stable');
    });
});
assertEqual(init.setPlanType(init.setPlanType(rich, 'initiative'), 'project'), rich, 'project -> initiative -> project is byte-identical');
assertEqual(init.setPlanType(rich, 'project'), rich, 'switching to the current type is a no-op');
assertEqual(init.setPlanType(init.setPlanType(noFm, 'initiative'), 'project').replace(/^---\n---\n/, ''), noFm, 'plan with no front matter keeps its body');
assertEqual(init.setPlanType(fm('title: P', 'type: project'), 'project'), fm('title: P', 'type: project'), 'an explicit type: project is left alone');

process.exit(failures ? 1 : 0);
