/**
 * Regression tests for #765: the task details form's Sub tasks list
 * silently dropped children whose indentation wasn't exactly 2 or 4
 * columns deeper than their parent (tabs, 3-space, 8-space, mixed-indent
 * post-import plans).
 *
 * Exercises findDirectChildLineNumbers() (script.js), the pure DOM-free
 * helper populateSubtasks() now delegates to for finding direct children.
 *
 * Run with: node tests/test_subtask_indentation.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const staticDir = path.join(__dirname, '..', 'packages', 'noodle-web', 'src', 'noodle_web', 'static');
const context = vm.createContext({ console });

const scriptSource = fs.readFileSync(path.join(staticDir, 'script.js'), 'utf8');
const start = scriptSource.indexOf('function getIndentWidth(');
const end = scriptSource.indexOf('\nfunction populateSubtasks(', start);
vm.runInContext(
    scriptSource.slice(start, end) +
    '\nglobalThis.findDirectChildLineNumbers = findDirectChildLineNumbers;',
    context
);

const { findDirectChildLineNumbers } = context;

let failures = 0;
function equal(actual, expected, message) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        failures++;
        console.error('FAIL:', message, '\n expected:', expected, '\n actual:  ', actual);
    } else {
        console.log('PASS:', message);
    }
}

function children(planText, parentLineNumber) {
    return findDirectChildLineNumbers(parentLineNumber, planText.split('\n'));
}

// ── 2-space indent (the original supported case) ───────────────────
equal(children('Summary task\n  Child 1\n  Child 2', 1), [2, 3],
    '2-space indented children are found');

// ── 4-space indent (the original supported case) ────────────────────
equal(children('Summary task\n    Child 1\n    Child 2', 1), [2, 3],
    '4-space indented children are found');

// ── Tab-indented children (previously dropped entirely) ─────────────
equal(children('Summary task\n\tChild 1\n\tChild 2', 1), [2, 3],
    'tab-indented children are found');

// ── 3-space indent (previously dropped entirely) ─────────────────────
equal(children('Summary task\n   Child 1\n   Child 2', 1), [2, 3],
    '3-space indented children are found');

// ── 8-space indent (previously dropped entirely) ─────────────────────
equal(children('Summary task\n        Child 1\n        Child 2', 1), [2, 3],
    '8-space indented children are found');

// ── Mixed indentation within one plan (post-import) ──────────────────
equal(children('Phase\n  Summary A\n    Child A1\n  Summary B\n      Child B1', 4), [5],
    'mixed-indent siblings elsewhere in the plan do not confuse a later parent');

// ── Grandchildren are excluded, only direct children returned ────────
equal(children('Summary task\n  Child 1\n    Grandchild 1\n  Child 2', 1), [2, 4],
    'grandchildren are excluded -- only direct children are listed');

// ── Scan stops at back-matter, does not leak into RAID/comms/baseline ─
equal(children('Summary task\n  Child 1\n---raid log---\n  Not a child', 1), [2],
    'the scan stops at a back-matter marker instead of reading past it');

// ── Same/lower indentation than the parent ends the subtree ──────────
equal(children('Summary task\n  Child 1\nSibling task\n  Its own child', 1), [2],
    'a line back at or above the parent indent ends the parent\'s subtree');

if (failures) {
    console.error(`\n${failures} test(s) failed.`);
    process.exit(1);
}
console.log('\nAll tests passed.');
