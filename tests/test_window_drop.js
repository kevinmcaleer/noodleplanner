/**
 * Tests for window-drop.js (issue #811): any file dropped on the window is an
 * import request, routed by extension.
 *
 * Run with: node tests/test_window_drop.js
 */

const path = require('path');
const fs = require('fs');
const mod = require(path.join(__dirname, '..', 'packages', 'noodle-web',
    'src', 'noodle_web', 'static', 'window-drop.js'));

const { classifyDroppedFile, WINDOW_DROP_OWN_HANDLERS, WINDOW_DROP_MAX_BYTES, WINDOW_DROP_MAX_MPP_BYTES } = mod;

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

function assertTrue(cond, msg) {
    if (!cond) {
        failures++;
        console.error('FAIL:', msg);
    } else {
        console.log('PASS:', msg);
    }
}

// --- routing by extension ------------------------------------------------------

assertEqual(classifyDroppedFile('plan.md'), 'plan', 'markdown is a plan');
assertEqual(classifyDroppedFile('plan.markdown'), 'plan', '.markdown is a plan');
assertEqual(classifyDroppedFile('notes.TXT'), 'plan', 'extension match is case-insensitive');
assertEqual(classifyDroppedFile('tasks.xlsx'), 'excel', 'xlsx goes to the Excel wizard');
assertEqual(classifyDroppedFile('old.xls'), 'excel', 'xls goes to the Excel wizard');
assertEqual(classifyDroppedFile('silverfort.mpp'), 'msproject', 'mpp is an MS Project import');
assertEqual(classifyDroppedFile('silverfort.xml'), 'msproject', 'MSPDI xml is an MS Project import');
assertEqual(classifyDroppedFile('export.json'), 'json', 'json is a project export');
assertEqual(classifyDroppedFile('photo.png'), null, 'images are not importable');
assertEqual(classifyDroppedFile('archive.tar.gz'), null, 'only the last extension counts');
assertEqual(classifyDroppedFile('README'), null, 'no extension is not importable');
assertEqual(classifyDroppedFile(''), null, 'empty name is not importable');
assertEqual(classifyDroppedFile('my.plan.v2.md'), 'plan', 'dots in the name do not confuse the extension');

// --- limits ---------------------------------------------------------------------

assertEqual(WINDOW_DROP_MAX_BYTES, 1048576, 'server-bound files keep the API upload limit');
assertTrue(WINDOW_DROP_MAX_MPP_BYTES > WINDOW_DROP_MAX_BYTES, 'browser-read .mpp files may be larger');

// --- elements with their own drop handlers are left alone -----------------------

const editorJs = fs.readFileSync(path.join(__dirname, '..', 'packages', 'noodle-web',
    'src', 'noodle_web', 'static', 'editor.js'), 'utf8');
for (const selector of WINDOW_DROP_OWN_HANDLERS.split(',').map((s) => s.trim())) {
    const key = selector.replace(/^[.#]/, '');
    assertTrue(editorJs.includes(key), `${selector} really has its own drop handling in editor.js`);
}

// --- the page loads the module after the handlers it delegates to ---------------

const html = fs.readFileSync(path.join(__dirname, '..', 'packages', 'noodle-web',
    'src', 'noodle_web', 'templates', 'index.html'), 'utf8');
const editorTag = html.indexOf('/static/editor.js');
const dropTag = html.indexOf('/static/window-drop.js');
assertTrue(editorTag !== -1 && dropTag > editorTag, 'window-drop.js is loaded after editor.js');

const scriptJs = fs.readFileSync(path.join(__dirname, '..', 'packages', 'noodle-web',
    'src', 'noodle_web', 'static', 'script.js'), 'utf8');
assertTrue(scriptJs.includes('initializeWindowDropImport()'), 'the app initialises the window drop target');

if (failures > 0) {
    console.error('\n' + failures + ' test(s) failed');
    process.exit(1);
} else {
    console.log('\nAll tests passed');
}
