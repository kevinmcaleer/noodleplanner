/**
 * Tests for the programme information register (#741): the CRUD helpers in
 * programme-data-store.js and isInformationReviewOverdue() in programme.js.
 * Both load into one vm sandbox in load order (classic scripts).
 *
 * Run with: node tests/test_programme_information.js
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
const { addProgrammeInformationItem, updateProgrammeInformationItem, deleteProgrammeInformationItem,
    getProgrammeData, isInformationReviewOverdue } = sandbox;

let failures = 0;
function assertEqual(actual, expected, msg) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        failures++;
        console.error('FAIL:', msg, '\n  expected:', JSON.stringify(expected), '\n  actual:  ', JSON.stringify(actual));
    } else {
        console.log('PASS:', msg);
    }
}

assertEqual(addProgrammeInformationItem('p', { title: '  ' }), null, 'an untitled item is rejected');
assertEqual(getProgrammeData('p'), null, 'a rejected add creates no record');
const a = addProgrammeInformationItem('p', { title: ' Charter ', owner: 'Ann', reviewDate: '2026-12-01' });
assertEqual([a.id, a.title, a.owner, a.reviewDate], [1, 'Charter', 'Ann', '2026-12-01'], 'add trims and keeps a valid review date');
const b = addProgrammeInformationItem('p', { title: 'Risk log', reviewDate: 'next week' });
assertEqual([b.id, b.reviewDate], [2, ''], 'ids increment and a malformed review date is dropped');

assertEqual(updateProgrammeInformationItem('p', 1, { location: 'wiki/charter' }).location, 'wiki/charter', 'update merges fields');
assertEqual(updateProgrammeInformationItem('p', 1, { title: '' }), null, 'update cannot blank the title');
assertEqual(updateProgrammeInformationItem('p', 99, { owner: 'x' }), null, 'update of unknown id returns null');

assertEqual(isInformationReviewOverdue({ reviewDate: '2026-10-01' }, '2026-10-08'), true, 'a past review date is overdue');
assertEqual(isInformationReviewOverdue({ reviewDate: '2026-10-08' }, '2026-10-08'), false, 'review due today is not yet overdue');
assertEqual(isInformationReviewOverdue({ reviewDate: '' }, '2026-10-08'), false, 'no review date is never overdue');

assertEqual(deleteProgrammeInformationItem('p', 1), true, 'delete removes an item');
assertEqual(deleteProgrammeInformationItem('p', 1), false, 'delete of a missing id returns false');
deleteProgrammeInformationItem('p', 2);
assertEqual(getProgrammeData('p').information, null, 'the slice is cleared when the last item goes');

if (failures) { console.error(failures + ' failure(s)'); process.exit(1); }
console.log('All programme information tests passed');
