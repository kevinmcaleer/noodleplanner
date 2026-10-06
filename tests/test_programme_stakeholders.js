/**
 * Tests for the programme stakeholder register (#740): the CRUD and
 * engagement-quadrant helpers in programme-data-store.js, and
 * groupStakeholdersByQuadrant() in programme.js. programme.js calls the
 * store's stakeholderQuadrant() as a bare global (classic scripts), so
 * both load into one vm sandbox in load order.
 *
 * Run with: node tests/test_programme_stakeholders.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const staticDir = path.join(__dirname, '..', 'packages', 'noodle-web', 'src', 'noodle_web', 'static');
const store = {};
const sandbox = {
    console,
    localStorage: {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
    },
};
vm.createContext(sandbox);
['programme-data-store.js', 'programme.js'].forEach((f) =>
    vm.runInContext(fs.readFileSync(path.join(staticDir, f), 'utf8'), sandbox, { filename: f }));
const { stakeholderQuadrant, addProgrammeStakeholder, updateProgrammeStakeholder, deleteProgrammeStakeholder,
    getProgrammeData, getAllProgrammeData, groupStakeholdersByQuadrant } = sandbox;

let failures = 0;
function assertEqual(actual, expected, msg) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        failures++;
        console.error('FAIL:', msg, '\n  expected:', JSON.stringify(expected), '\n  actual:  ', JSON.stringify(actual));
    } else {
        console.log('PASS:', msg);
    }
}

assertEqual(stakeholderQuadrant({ influence: 'high', interest: 'high' }), 'manage-closely', 'high/high is manage closely');
assertEqual(stakeholderQuadrant({ influence: 'high', interest: 'low' }), 'keep-satisfied', 'high influence only is keep satisfied');
assertEqual(stakeholderQuadrant({ influence: 'low', interest: 'high' }), 'keep-informed', 'high interest only is keep informed');
assertEqual(stakeholderQuadrant({ influence: 'medium', interest: 'low' }), 'monitor', 'medium/low is monitor');
assertEqual(stakeholderQuadrant({}), 'monitor', 'missing ratings default to medium, so monitor');

assertEqual(addProgrammeStakeholder('p', { name: '  ' }), null, 'a nameless stakeholder is rejected');
assertEqual(getProgrammeData('p'), null, 'a rejected add creates no record');
const a = addProgrammeStakeholder('p', { name: ' Ann ', influence: 'HIGH', interest: 'bogus' });
assertEqual([a.id, a.name, a.influence, a.interest], [1, 'Ann', 'high', 'medium'], 'add trims, lowercases and defaults ratings');
const b = addProgrammeStakeholder('p', { name: 'Bo', influence: 'low', interest: 'high' });
assertEqual(b.id, 2, 'ids increment within a programme');

assertEqual(updateProgrammeStakeholder('p', 1, { role: 'SRO' }).role, 'SRO', 'update merges fields');
assertEqual(updateProgrammeStakeholder('p', 1, { name: '' }), null, 'update cannot blank the name');
assertEqual(updateProgrammeStakeholder('p', 99, { role: 'x' }), null, 'update of unknown id returns null');

assertEqual(groupStakeholdersByQuadrant(getProgrammeData('p').stakeholders).map((g) => [g.key, g.stakeholders.length]),
    [['manage-closely', 0], ['keep-satisfied', 1], ['keep-informed', 1], ['monitor', 0]], 'groups stakeholders by quadrant in fixed order');

assertEqual(deleteProgrammeStakeholder('p', 1), true, 'delete removes a stakeholder');
assertEqual(deleteProgrammeStakeholder('p', 1), false, 'delete of a missing id returns false');
deleteProgrammeStakeholder('p', 2);
assertEqual(getProgrammeData('p').stakeholders, null, 'the slice is cleared when the last stakeholder goes');

if (failures) { console.error(failures + ' failure(s)'); process.exit(1); }
console.log('All programme stakeholder tests passed');
