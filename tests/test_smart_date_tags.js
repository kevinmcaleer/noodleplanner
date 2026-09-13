/**
 * Pure logic tests for smart-date-tags.js (issue #1161, part of epic
 * #878). Loads date-detect.js then smart-date-tags.js into one vm
 * sandbox (matching the real page's script order -- see
 * templates/index.html) with a minimal `document` stub, and exercises
 * the DOM-free parts directly: dismissal-key scoping and the
 * detect-then-filter-dismissed pipeline. The DOM-manipulating parts
 * (stRenderSuggestions, stInit, click wiring) need a real browser and are
 * exercised instead by a Selenium test alongside the other task-details
 * form coverage, following this codebase's usual pure-logic-here/
 * DOM-in-Selenium split (see e.g. tests/test_whiteboard_notes.js's own
 * header comment).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const staticDir = path.join(__dirname, '..', 'packages', 'noodle-web', 'src', 'noodle_web', 'static');
const context = vm.createContext({
    console,
    document: { getElementById: () => null }, // no addEventListener -> stInit() is a safe no-op
});

const dateDetectSource = fs.readFileSync(path.join(staticDir, 'date-detect.js'), 'utf8');
vm.runInContext(dateDetectSource, context);
const smartTagsSource = fs.readFileSync(path.join(staticDir, 'smart-date-tags.js'), 'utf8');
vm.runInContext(smartTagsSource, context);

const stVisibleSuggestions = context.stVisibleSuggestions;
const stDismissKey = context.stDismissKey;

let failures = 0;
function equal(actual, expected, message) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        failures++;
        console.error('FAIL:', message, '\n expected:', JSON.stringify(expected), '\n actual:  ', JSON.stringify(actual));
    } else {
        console.log('PASS:', message);
    }
}

const REF = new Date(2026, 8, 9); // fixed Wednesday, 2026-09-09

equal(
    stVisibleSuggestions('go live 15th March', 'Launch', REF).map(c => c.isoDate),
    ['2027-03-15'],
    'a fresh phrase is surfaced as a suggestion'
);

equal(
    stVisibleSuggestions('no dates in here', 'Launch', REF),
    [],
    'text with no date phrase yields no suggestions'
);

// Simulate dismissing the candidate exactly the way a click handler would:
// add its key to the shared dismissed set, scoped by task name.
const candidate = stVisibleSuggestions('go live 15th March', 'Launch', REF)[0];
context.stDismissed.add(stDismissKey('Launch', candidate));

equal(
    stVisibleSuggestions('go live 15th March', 'Launch', REF),
    [],
    'a dismissed phrase is not resurfaced for the same task'
);

equal(
    stVisibleSuggestions('go live 15th March', 'Other Task', REF).map(c => c.isoDate),
    ['2027-03-15'],
    'a dismissal on one task never suppresses the same phrase on a different task'
);

// Reset dismissals for the next assertion (module-level state persists
// across calls within this one vm context, same as it would across
// keystrokes on a real page).
context.stDismissed.clear();

equal(
    stVisibleSuggestions('kickoff tomorrow, go live 15th March', 'Launch', REF).length,
    2,
    'multiple distinct phrases in one comment each get their own suggestion'
);

if (failures) {
    console.error(`\n${failures} failure(s).`);
    process.exit(1);
} else {
    console.log('\nAll smart-date-tags tests passed.');
}
