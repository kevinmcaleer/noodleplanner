/**
 * `[depends: X]` (with a colon) must be understood everywhere `[depends X]`
 * is (issue #808). MS Project imports used to write the colon form and the
 * frontend's regexes required whitespace after "depends", so those
 * dependencies were invisible to the editor helpers, the highlighter, the
 * Kanban board and the product views. The importers now write the canonical
 * form, and every frontend regex tolerates the colon.
 *
 * Run with: node tests/test_depends_colon.js
 */

const path = require('path');
const fs = require('fs');
const vm = require('vm');

const staticDir = path.join(__dirname, '..', 'packages', 'noodle-web', 'src', 'noodle_web', 'static');

let failures = 0;
function assertTrue(cond, msg) {
    if (!cond) { failures++; console.error('FAIL:', msg); } else { console.log('PASS:', msg); }
}
function assertEqual(actual, expected, msg) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) { failures++; console.error('FAIL:', msg, '\n  expected:', JSON.stringify(expected), '\n  actual:  ', JSON.stringify(actual)); }
    else console.log('PASS:', msg);
}

/** Lift top-level `function name(` … `\n}` declarations out of a classic script. */
function lift(file, names) {
    const source = fs.readFileSync(path.join(staticDir, file), 'utf8');
    const sandbox = {};
    for (const name of names) {
        const start = source.indexOf(`\nfunction ${name}(`);
        const end = source.indexOf('\n}\n', start);
        if (start === -1 || end === -1) throw new Error(`${name} not found in ${file}`);
        vm.runInNewContext(source.slice(start, end + 3), sandbox);
    }
    return sandbox;
}

const ed = lift('editor.js', ['lineHasDependency', 'addDependencyToLine']);

// --- editor helpers ---------------------------------------------------------------

assertTrue(ed.lineHasDependency('Task B 2d [depends Task A]'), 'plain form is a dependency');
assertTrue(ed.lineHasDependency('Task B 2d [depends: Task A]'), 'colon form is a dependency');
assertTrue(ed.lineHasDependency('Task B 2d [depends:Task A]'), 'colon with no space is a dependency');
assertTrue(!ed.lineHasDependency('Task B 2d "depends on nothing"'), 'a comment mentioning depends is not');

assertEqual(
    ed.addDependencyToLine('Task C 1d [depends: Task A]', 'Task B'),
    'Task C 1d [depends Task A, Task B]',
    'appending to a colon list rewrites it in the canonical form'
);

// --- every frontend regex tolerates the colon --------------------------------------

const files = ['editor-sync.js', 'editor.js', 'kanban.js', 'script.js', 'views-products.js'];
for (const file of files) {
    const source = fs.readFileSync(path.join(staticDir, file), 'utf8');
    const strict = (source.match(/\\\[depends\\s\+/g) || []).length;
    assertEqual(strict, 0, `${file} has no regex that requires whitespace after [depends`);
}

// --- the browser .mpp importer writes the canonical form ---------------------------

const mppExport = fs.readFileSync(path.join(staticDir, 'mpp-export.js'), 'utf8');
assertTrue(!/parts\.push\(`\[depends: /.test(mppExport), 'the .mpp importer no longer emits [depends: …]');
assertTrue(/parts\.push\(`\[depends \$\{/.test(mppExport), 'the .mpp importer emits [depends …]');

if (failures > 0) { console.error('\n' + failures + ' test(s) failed'); process.exit(1); }
console.log('\nAll tests passed');
