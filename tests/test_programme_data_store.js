/**
 * Tests for the programme-owned data store (#954's decision, built by
 * #735): `noodleplanner_programme_data`, a lazily-created record per
 * programme slug holding data that has no project to derive it from (SRO,
 * vision, outcomes, and #735's own benefit-to-outcome links; #738/#740/
 * #741/#742 add their own slices later).
 *
 * Covers programme-data-store.js:
 *   - getAllProgrammeData()/saveAllProgrammeData(): the localStorage
 *     round trip (NoodleStore is not active in this plain-node run, so
 *     these fall back to the raw localStorage path -- same as
 *     portfolio-dependencies.js's own tests would, if it had any).
 *   - getProgrammeData(): returns null for a slug with no record --
 *     reading never creates one.
 *   - setProgrammeData(): creates a record lazily on first write, merges
 *     partial updates into an existing one.
 *   - deleteProgrammeData(): removes a whole record.
 *   - pruneOrphanedProgrammeData(): drops any record not in the given
 *     slug list.
 *   - addProgrammeOutcome()/updateProgrammeOutcome()/deleteProgrammeOutcome():
 *     outcome CRUD, and that deleting an outcome also drops any benefit
 *     links that pointed to it.
 *   - linkBenefitToOutcome()/unlinkBenefitFromOutcome(): a benefit links
 *     to at most one outcome at a time -- re-linking replaces, not adds.
 *
 * Run with: node tests/test_programme_data_store.js
 */

const path = require('path');
const mod = require(path.join(__dirname, '..', 'packages', 'noodle-web',
    'src', 'noodle_web', 'static', 'programme-data-store.js'));

const {
    PROGRAMME_DATA_KEY,
    getAllProgrammeData,
    getProgrammeData,
    setProgrammeData,
    deleteProgrammeData,
    pruneOrphanedProgrammeData,
    addProgrammeOutcome,
    updateProgrammeOutcome,
    deleteProgrammeOutcome,
    linkBenefitToOutcome,
    unlinkBenefitFromOutcome,
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

// --- a minimal in-memory localStorage, reset before each block ------------

function resetLocalStorage() {
    const data = new Map();
    global.localStorage = {
        getItem(k) { return data.has(k) ? data.get(k) : null; },
        setItem(k, v) { data.set(k, String(v)); },
        removeItem(k) { data.delete(k); },
    };
}

// --- getProgrammeData / setProgrammeData / deleteProgrammeData ------------

(() => {
    resetLocalStorage();

    assertEqual(getProgrammeData('digital-transformation'), null,
        'a programme with no record yet returns null -- reading does not create one');
    assertEqual(getAllProgrammeData(), {}, 'nothing written yet means an empty store');

    const created = setProgrammeData('digital-transformation', { sro: 'Alice' });
    assertEqual(created, { sro: 'Alice' }, 'first write creates the record with just what was given');
    assertEqual(getProgrammeData('digital-transformation'), { sro: 'Alice' },
        'the record is now readable back');

    const merged = setProgrammeData('digital-transformation', { vision: 'Faster releases' });
    assertEqual(merged, { sro: 'Alice', vision: 'Faster releases' },
        'a second write merges into the existing record rather than replacing it');

    assertEqual(getProgrammeData('other-programme'), null,
        'a different slug still has no record of its own');

    assertEqual(deleteProgrammeData('digital-transformation'), true, 'deleting an existing record succeeds');
    assertEqual(getProgrammeData('digital-transformation'), null, 'the record is gone after deletion');
    assertEqual(deleteProgrammeData('digital-transformation'), false, 'deleting an already-gone record reports false');

    // The localStorage fallback path is exercised (no NoodleStore global in
    // this plain-node run), so the raw key should hold valid JSON too.
    setProgrammeData('customer-platform', { sro: 'Bob' });
    assertEqual(JSON.parse(global.localStorage.getItem(PROGRAMME_DATA_KEY)),
        { 'customer-platform': { sro: 'Bob' } },
        'the localStorage fallback writes one JSON blob keyed by slug');
})();

// --- pruneOrphanedProgrammeData ---------------------------------------------

(() => {
    resetLocalStorage();
    setProgrammeData('alpha', { sro: 'Alice' });
    setProgrammeData('beta', { sro: 'Bob' });
    setProgrammeData('gamma', { sro: 'Carol' });

    const removed = pruneOrphanedProgrammeData(['alpha', 'gamma']);
    assertEqual(removed.sort(), ['beta'], 'a slug missing from the active list is pruned');
    assertEqual(getProgrammeData('beta'), null, 'the pruned record is actually gone');
    assertEqual(getProgrammeData('alpha'), { sro: 'Alice' }, 'an active slug is left alone');
    assertEqual(getProgrammeData('gamma'), { sro: 'Carol' }, 'another active slug is also left alone');

    assertEqual(pruneOrphanedProgrammeData(['alpha', 'gamma']), [], 'nothing left to prune the second time');
})();

// --- outcomes CRUD -----------------------------------------------------------

(() => {
    resetLocalStorage();

    const o1 = addProgrammeOutcome('alpha', { name: 'Faster onboarding' });
    assertEqual(o1, { id: 1, name: 'Faster onboarding', description: '' },
        'the first outcome gets id 1 and an empty description default');

    const o2 = addProgrammeOutcome('alpha', { name: 'Lower support cost', description: 'Fewer tickets' });
    assertEqual(o2.id, 2, 'the second outcome gets the next id');

    assertEqual(getProgrammeData('alpha').outcomes.map((o) => o.name),
        ['Faster onboarding', 'Lower support cost'],
        'both outcomes are on the record in the order they were added');

    const updated = updateProgrammeOutcome('alpha', 1, { name: 'Faster customer onboarding' });
    assertEqual(updated.name, 'Faster customer onboarding', 'updating an outcome changes just the given fields');
    assertEqual(updateProgrammeOutcome('alpha', 999, { name: 'Nope' }), null,
        'updating a non-existent outcome id returns null');

    assertEqual(addProgrammeOutcome('alpha', { name: '' }), null, 'an outcome needs a name');
    assertEqual(addProgrammeOutcome(null, { name: 'X' }), null, 'no slug means no outcome');
})();

// --- benefit-to-outcome links, and outcome deletion cascading -------------

(() => {
    resetLocalStorage();
    const outcome = addProgrammeOutcome('alpha', { name: 'Faster onboarding' });

    const link = linkBenefitToOutcome('alpha', {
        projectId: 'p1', benefitItemId: 3, benefitTitle: 'Reduced ramp-up time',
        outcomeId: outcome.id, contributionPercent: 60,
    });
    assertEqual(link, {
        projectId: 'p1', benefitItemId: 3, benefitTitle: 'Reduced ramp-up time',
        outcomeId: outcome.id, contributionPercent: 60,
    }, 'a link is stored with all its given fields');

    assertEqual(getProgrammeData('alpha').benefitLinks.length, 1, 'the link is on the record');

    // Re-linking the same (project, benefit) pair replaces, not adds.
    linkBenefitToOutcome('alpha', {
        projectId: 'p1', benefitItemId: 3, benefitTitle: 'Reduced ramp-up time',
        outcomeId: outcome.id, contributionPercent: 90,
    });
    assertEqual(getProgrammeData('alpha').benefitLinks.length, 1,
        'linking the same benefit again replaces its previous link rather than adding a second one');
    assertEqual(getProgrammeData('alpha').benefitLinks[0].contributionPercent, 90,
        'the replacement link carries the new contribution percent');

    assertEqual(linkBenefitToOutcome('alpha', { projectId: 'p1', benefitItemId: 3, outcomeId: outcome.id, contributionPercent: 150 })
        .contributionPercent, 100, 'contribution percent is clamped to 100 at the top');
    assertEqual(linkBenefitToOutcome('alpha', { projectId: 'p1', benefitItemId: 3, outcomeId: outcome.id, contributionPercent: -20 })
        .contributionPercent, 0, 'contribution percent is clamped to 0 at the bottom');

    assertEqual(unlinkBenefitFromOutcome('alpha', 'p1', 3), true, 'unlinking an existing link succeeds');
    assertEqual(getProgrammeData('alpha').benefitLinks.length, 0, 'the link is gone after unlinking');
    assertEqual(unlinkBenefitFromOutcome('alpha', 'p1', 3), false, 'unlinking an already-gone link reports false');

    // Deleting an outcome drops links that pointed to it.
    linkBenefitToOutcome('alpha', { projectId: 'p2', benefitItemId: 1, outcomeId: outcome.id, contributionPercent: 40 });
    assertEqual(deleteProgrammeOutcome('alpha', outcome.id), true, 'deleting an existing outcome succeeds');
    assertEqual(getProgrammeData('alpha').outcomes, [], 'the outcome is gone');
    assertEqual(getProgrammeData('alpha').benefitLinks, [],
        'a benefit link pointing at the deleted outcome is cleaned up with it, not left dangling');

    assertEqual(deleteProgrammeOutcome('alpha', 999), false, 'deleting a non-existent outcome id reports false');
})();

console.log(failures === 0
    ? `\nAll tests passed.`
    : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
