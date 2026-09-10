/**
 * Pure logic tests for date-detect.js (issue #1160, part of epic #878).
 *
 * Loads the source in a vm sandbox and exercises detectDatesInText()
 * directly -- same convention as tests/test_task_tokenizer.js and
 * tests/test_whiteboard_notes.js: no DOM, no framework, plain `node
 * tests/test_date_detect.js` (picked up automatically by package.json's
 * `test:js` `for f in tests/test_*.js` loop).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const staticDir = path.join(__dirname, '..', 'packages', 'noodle-web', 'src', 'noodle_web', 'static');
const context = vm.createContext({ console });
const source = fs.readFileSync(path.join(staticDir, 'date-detect.js'), 'utf8');
vm.runInContext(source, context);

const detectDatesInText = context.detectDatesInText;

let failures = 0;
function equal(actual, expected, message) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        failures++;
        console.error('FAIL:', message, '\n expected:', JSON.stringify(expected), '\n actual:  ', JSON.stringify(actual));
    } else {
        console.log('PASS:', message);
    }
}

function isoDates(text, reference) {
    return detectDatesInText(text, reference).map(c => c.isoDate);
}

// A fixed Wednesday so relative-phrase tests are deterministic.
const REF = new Date(2026, 8, 9); // 2026-09-09

equal(isoDates('go live 2026-03-15', REF), ['2026-03-15'], 'ISO dates are detected');
equal(isoDates('bogus 2026-13-40 date', REF), [], 'an invalid ISO-shaped date is rejected');

equal(isoDates('go live 15th March', REF), ['2027-03-15'],
    'a day-month phrase with no year rolls forward to the next occurrence');
equal(isoDates('go live 15 March 2026', REF), ['2026-03-15'],
    'an explicit year in a day-month phrase is honoured even if in the past');
equal(isoDates('due 1 Jan', REF), ['2027-01-01'], 'abbreviated month names are recognised');

equal(isoDates('ship March 15th', REF), ['2027-03-15'], 'month-day phrasing is detected');
equal(isoDates('ship March 15, 2026', REF), ['2026-03-15'], 'month-day with an explicit past year is honoured');

equal(isoDates('no date phrase here', REF), [], 'plain text with no date yields nothing');
equal(isoDates('', REF), [], 'empty text yields nothing');
equal(isoDates('   ', REF), [], 'whitespace-only text yields nothing');

equal(isoDates('due 31 February', REF), [], 'an invalid day-for-month combination is rejected');

equal(isoDates('finish today', REF), ['2026-09-09'], '"today" resolves to the reference date');
equal(isoDates('finish tomorrow', REF), ['2026-09-10'], '"tomorrow" resolves to reference date + 1');

// REF (2026-09-09) is a Wednesday; the next Friday is 2026-09-11.
equal(isoDates('due next Friday', REF), ['2026-09-11'], '"next <weekday>" resolves to the following occurrence');
// A Wednesday reference asking for "next Wednesday" should NOT be today.
equal(isoDates('due next Wednesday', REF), ['2026-09-16'], '"next <today\'s weekday>" skips today, not this instant');

equal(isoDates('due in 3 days', REF), ['2026-09-12'], '"in N days" is detected');
equal(isoDates('due in 2 weeks', REF), ['2026-09-23'], '"in N weeks" is detected');
equal(isoDates('due in 1 month', REF), ['2026-10-09'], '"in N months" is detected');

const overlap = detectDatesInText('ship 15th March 2026 for sure', REF);
equal(overlap.length, 1, 'an overlapping day+month+year phrase is reported once, not once per sub-match');
equal(overlap[0].text, '15th March 2026', 'the full phrase span is kept, not a shorter overlapping piece');

const multi = detectDatesInText('kickoff tomorrow, go live 15th March', REF);
equal(multi.map(c => c.isoDate), ['2026-09-10', '2027-03-15'], 'multiple distinct phrases are all detected, in order');

if (failures) {
    console.error(`\n${failures} failure(s).`);
    process.exit(1);
} else {
    console.log('\nAll date-detect tests passed.');
}
