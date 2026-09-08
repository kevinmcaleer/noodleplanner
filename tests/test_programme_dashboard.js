/**
 * Tests for the programme overview dashboard (issue #734, extended by #736).
 *
 * Covers the pure/testable roll-up helpers in programme.js:
 *   - computeRagRollup(): rolls a list of per-project RAG values up into
 *     counts and a worst-case summary (red beats amber beats green).
 *   - extractProjectMilestones(): pulls zero-duration milestone tasks out
 *     of one project's parsed task list.
 *   - pickKeyMilestones(): picks the programme's "key" milestones out of
 *     the full cross-project milestone list.
 *   - aggregateBenefitsOnTrack(): rolls benefit items up into an on-track
 *     count, honestly reporting when there's nothing tracked to roll up.
 *   - aggregateEscalatedRaidItems(): rolls escalated risks & issues up
 *     across a programme's member projects (#736).
 *   - ragById(): maps a RAG list to a lookup table by project id.
 *   - filterDependenciesForProgramme(): scopes the portfolio-wide
 *     dependency store down to the links relevant to one programme,
 *     tagging each 'internal' or 'external' (#737).
 *
 * Run with: node tests/test_programme_dashboard.js
 */

const path = require('path');
const mod = require(path.join(__dirname, '..', 'packages', 'noodle-web',
    'src', 'noodle_web', 'static', 'programme.js'));

const {
    computeRagRollup,
    extractProjectMilestones,
    pickKeyMilestones,
    aggregateBenefitsOnTrack,
    aggregateEscalatedRaidItems,
    ragById,
    filterDependenciesForProgramme,
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

// --- computeRagRollup ------------------------------------------------------

assertEqual(
    computeRagRollup([
        { id: 'p1', name: 'Alpha', rag: 'red' },
        { id: 'p2', name: 'Beta', rag: 'green' },
        { id: 'p3', name: 'Gamma', rag: 'amber' },
    ]),
    { counts: { red: 1, amber: 1, green: 1 }, worst: 'red' },
    'red beats amber and green as the worst-case programme RAG'
);

assertEqual(
    computeRagRollup([
        { id: 'p1', name: 'Alpha', rag: 'amber' },
        { id: 'p2', name: 'Beta', rag: 'green' },
    ]),
    { counts: { red: 0, amber: 1, green: 1 }, worst: 'amber' },
    'amber beats green when there is no red'
);

assertEqual(
    computeRagRollup([
        { id: 'p1', name: 'Alpha', rag: 'green' },
        { id: 'p2', name: 'Beta', rag: 'green' },
    ]),
    { counts: { red: 0, amber: 0, green: 2 }, worst: 'green' },
    'all-green programme rolls up to green'
);

assertEqual(
    computeRagRollup([]),
    { counts: { red: 0, amber: 0, green: 0 }, worst: null },
    'empty project list has no worst-case RAG'
);

assertEqual(
    computeRagRollup(undefined),
    { counts: { red: 0, amber: 0, green: 0 }, worst: null },
    'undefined project list has no worst-case RAG'
);

// --- extractProjectMilestones ----------------------------------------------

assertEqual(
    extractProjectMilestones([
        { name: 'Phase 1', is_summary: true, duration_days: 10, finish: '2026-01-10' },
        { name: 'Go live', is_summary: false, duration_days: 0, finish: '2026-02-01', percent: '0' },
        { name: 'Regular task', is_summary: false, duration_days: 5, finish: '2026-01-20', percent: '50' },
        { name: 'No date milestone', is_summary: false, duration_days: 0, finish: '', percent: '0' },
    ], 'p1', 'Alpha'),
    [{ projectId: 'p1', projectName: 'Alpha', name: 'Go live', finish: '2026-02-01', percent: 0 }],
    'only zero-duration, non-summary tasks with a finish date count as milestones'
);

assertEqual(extractProjectMilestones([], 'p1', 'Alpha'), [], 'no tasks means no milestones');
assertEqual(extractProjectMilestones(undefined, 'p1', 'Alpha'), [], 'undefined tasks means no milestones');

// --- pickKeyMilestones ------------------------------------------------------

(() => {
    const milestones = [
        { projectId: 'p1', projectName: 'Alpha', name: 'M3', finish: '2026-03-01', percent: 0 },
        { projectId: 'p1', projectName: 'Alpha', name: 'M1', finish: '2026-01-01', percent: 0 },
        { projectId: 'p2', projectName: 'Beta', name: 'M2', finish: '2026-02-01', percent: 0 },
    ];
    assertEqual(
        pickKeyMilestones(milestones, 5).map((m) => m.name),
        ['M1', 'M2', 'M3'],
        'incomplete milestones sort soonest-first'
    );
    assertEqual(
        pickKeyMilestones(milestones, 2).map((m) => m.name),
        ['M1', 'M2'],
        'limit caps the returned milestones'
    );
})();

(() => {
    const allDone = [
        { projectId: 'p1', projectName: 'Alpha', name: 'Done later', finish: '2026-05-01', percent: 100 },
        { projectId: 'p1', projectName: 'Alpha', name: 'Done earlier', finish: '2026-01-01', percent: 100 },
    ];
    assertEqual(
        pickKeyMilestones(allDone, 5).map((m) => m.name),
        ['Done earlier', 'Done later'],
        'falls back to nearest-by-date when every milestone is already complete'
    );
})();

(() => {
    const mixed = [
        { projectId: 'p1', projectName: 'Alpha', name: 'Done', finish: '2026-01-01', percent: 100 },
        { projectId: 'p1', projectName: 'Alpha', name: 'Not done', finish: '2026-06-01', percent: 40 },
    ];
    assertEqual(
        pickKeyMilestones(mixed, 5).map((m) => m.name),
        ['Not done'],
        'when some milestones are incomplete, completed ones are excluded'
    );
})();

assertEqual(pickKeyMilestones([{ projectId: 'p1', projectName: 'Alpha', name: 'No date', finish: '', percent: 0 }], 5),
    [], 'milestones without a finish date are dropped');
assertEqual(pickKeyMilestones([], 5), [], 'no milestones means no key milestones');
assertEqual(pickKeyMilestones(undefined, 5), [], 'undefined milestones means no key milestones');

// --- aggregateBenefitsOnTrack -----------------------------------------------

assertEqual(
    aggregateBenefitsOnTrack([
        { type: 'benefit', status: 'In Progress' },
        { type: 'benefit', status: 'Achieved' },
        { type: 'benefit', status: 'Not Achieved' },
        { type: 'benefit', status: 'Not Started' },
        { type: 'disbenefit', status: 'Achieved' },
    ]),
    { hasData: true, total: 4, onTrack: 2 },
    'on-track counts In Progress and Achieved benefits; excludes disbenefits from the total'
);

assertEqual(
    aggregateBenefitsOnTrack([
        { type: 'benefit', status: '' },
        { type: 'benefit', status: '' },
    ]),
    { hasData: false, total: 0, onTrack: 0 },
    'benefits with no status recorded are an honest stub, not 0 of 0'
);

assertEqual(aggregateBenefitsOnTrack([]), { hasData: false, total: 0, onTrack: 0 }, 'no benefit items is an honest stub');
assertEqual(aggregateBenefitsOnTrack(undefined), { hasData: false, total: 0, onTrack: 0 }, 'undefined benefit items is an honest stub');

assertEqual(
    aggregateBenefitsOnTrack([{ status: 'In Progress' }]),
    { hasData: true, total: 1, onTrack: 1 },
    'items with no type default to benefit'
);

// --- aggregateEscalatedRaidItems ---------------------------------------------

(() => {
    const byProject = [
        {
            projectId: 'p1', projectName: 'Alpha',
            items: [
                { id: 1, type: 'risk', title: 'Server may fail', owner: 'Bob',
                  impact: 4, likelihood: 3, score: 12, status: 'open',
                  escalated: true, escalation_level: 'programme' },
                { id: 2, type: 'issue', title: 'Not escalated', status: 'open',
                  escalated: false, escalation_level: 'project' },
            ],
        },
        {
            projectId: 'p2', projectName: 'Beta',
            items: [
                { id: 3, type: 'issue', title: 'Vendor outage', owner: 'Alice',
                  impact: 5, likelihood: 4, score: 20, status: 'open',
                  escalated: true, escalation_level: 'board' },
                { id: 4, type: 'risk', title: 'Escalated but not to programme',
                  status: 'open', escalated: true, escalation_level: 'project' },
            ],
        },
    ];

    assertEqual(
        aggregateEscalatedRaidItems(byProject).map((i) => i.title),
        ['Vendor outage', 'Server may fail'],
        'escalated items from multiple member projects are collected, sorted by score (highest first)'
    );

    assertEqual(
        aggregateEscalatedRaidItems(byProject).map((i) => i.type),
        ['issue', 'risk'],
        'both risks and issues are included'
    );

    assertEqual(
        aggregateEscalatedRaidItems(byProject).some((i) => i.title === 'Not escalated'),
        false,
        'items that are not escalated at all are excluded'
    );

    assertEqual(
        aggregateEscalatedRaidItems(byProject).some((i) => i.title === 'Escalated but not to programme'),
        false,
        "items with escalation_level 'project' are excluded even when escalated is true"
    );

    assertEqual(
        aggregateEscalatedRaidItems(byProject).find((i) => i.title === 'Vendor outage').escalationLevel,
        'board',
        'board-escalated items are included at programme altitude -- a superset of programme escalation'
    );
})();

assertEqual(
    aggregateEscalatedRaidItems([
        { projectId: 'p1', projectName: 'Alpha', items: [
            { id: 1, type: 'action', title: 'Not a risk or issue', status: 'open',
              escalated: true, escalation_level: 'programme' },
            { id: 2, type: 'decision', title: 'Also not a risk or issue', status: 'open',
              escalated: true, escalation_level: 'board' },
        ] },
    ]),
    [],
    'only risk and issue types are aggregated, even when escalated'
);

assertEqual(aggregateEscalatedRaidItems([]), [], 'no member projects means no escalated items');
assertEqual(aggregateEscalatedRaidItems(undefined), [], 'undefined project list means no escalated items');
assertEqual(
    aggregateEscalatedRaidItems([{ projectId: 'p1', projectName: 'Alpha', items: [] }]),
    [],
    'a project with no raid items contributes nothing'
);

// --- ragById -----------------------------------------------------------------

assertEqual(
    ragById([{ id: 'p1', rag: 'red' }, { id: 'p2', rag: 'green' }]),
    { p1: 'red', p2: 'green' },
    'ragById maps project id to rag for lookup while rendering'
);
assertEqual(ragById([]), {}, 'empty list maps to an empty lookup');
assertEqual(ragById(undefined), {}, 'undefined list maps to an empty lookup');

// --- filterDependenciesForProgramme -------------------------------------------

(() => {
    const deps = [
        { id: 'd1', from_project_id: 'p1', to_project_id: 'p2' },
        { id: 'd2', from_project_id: 'p1', to_project_id: 'p9' },
        { id: 'd3', from_project_id: 'p9', to_project_id: 'p2' },
        { id: 'd4', from_project_id: 'p8', to_project_id: 'p9' },
    ];
    const scoped = filterDependenciesForProgramme(deps, ['p1', 'p2']);

    assertEqual(
        scoped.map((d) => d.id),
        ['d1', 'd2', 'd3'],
        'a dependency with neither end in the programme is excluded'
    );
    assertEqual(
        scoped.find((d) => d.id === 'd1').scope,
        'internal',
        'both ends in the programme is internal (intra-project within the programme)'
    );
    assertEqual(
        scoped.find((d) => d.id === 'd2').scope,
        'external',
        'the dependent project outside the programme makes it external (inter-project)'
    );
    assertEqual(
        scoped.find((d) => d.id === 'd3').scope,
        'external',
        'the source project outside the programme also makes it external'
    );
    assertEqual(
        deps[0].scope,
        undefined,
        'the original dependency objects are not mutated'
    );
})();

assertEqual(filterDependenciesForProgramme([], ['p1']), [], 'no dependencies means nothing scoped in');
assertEqual(filterDependenciesForProgramme(undefined, ['p1']), [], 'undefined dependency list means nothing scoped in');
assertEqual(
    filterDependenciesForProgramme([{ id: 'd1', from_project_id: 'p1', to_project_id: 'p2' }], undefined),
    [],
    'undefined member list scopes nothing in'
);
assertEqual(
    filterDependenciesForProgramme([{ id: 'd1', from_project_id: 'p1', to_project_id: 'p2' }], []),
    [],
    'empty member list scopes nothing in'
);

console.log(failures === 0
    ? `\nAll tests passed.`
    : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
