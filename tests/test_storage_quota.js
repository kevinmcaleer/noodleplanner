/**
 * Silent save failure (issue #794, part 1).
 *
 * Before this fix saveAllProjects() caught the quota error, logged it and
 * returned false, and no caller looked. Version history (50 full snapshots
 * per project) filled the ~5 MB localStorage quota at about five projects,
 * after which every plan save was lost without a word.
 *
 * These tests run the real project-storage.js and version-history.js in a
 * sandbox with a localStorage that has a byte budget and throws the browser's
 * QuotaExceededError when it is exceeded, and assert that:
 *
 *   - a failed save is reported in the status bar and as a toast,
 *   - nothing is lost silently: the last good copy is still readable,
 *   - plan text wins over history: older snapshots are evicted so the plan
 *     can still be saved, and the user is told,
 *   - history is capped by bytes so it cannot eat the whole quota.
 *
 * Run with: node tests/test_storage_quota.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const staticDir = path.join(__dirname, '..', 'packages', 'noodle-web', 'src', 'noodle_web', 'static');

let failures = 0;
function assertTrue(cond, msg) {
    if (!cond) { failures++; console.error('FAIL:', msg); } else { console.log('PASS:', msg); }
}
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

// --- a localStorage with a quota ----------------------------------------------

function makeLocalStorage(budget) {
    const data = new Map();
    const used = () => { let n = 0; data.forEach((v, k) => { n += k.length + v.length; }); return n; };
    return {
        budget,
        get length() { return data.size; },
        key(i) { return Array.from(data.keys())[i] || null; },
        getItem(k) { return data.has(k) ? data.get(k) : null; },
        setItem(k, v) {
            v = String(v);
            const next = used() - (data.has(k) ? k.length + data.get(k).length : 0) + k.length + v.length;
            if (next > this.budget) throw new DOMException('quota exceeded', 'QuotaExceededError');
            data.set(k, v);
        },
        removeItem(k) { data.delete(k); },
        clear() { data.clear(); },
        used,
    };
}

// --- sandbox with the real storage scripts ------------------------------------

function makeApp(budget) {
    const editor = { value: '', readOnly: false, classList: { add() {}, remove() {} }, dispatchEvent() {} };
    const statusMessages = [];
    const toasts = [];
    const sandbox = {
        console: { log() {}, warn() {}, error() {} },
        DOMException,
        Date,
        Math,
        JSON,
        localStorage: makeLocalStorage(budget),
        document: {
            readyState: 'complete',
            addEventListener() {},
            getElementById(id) { return id === 'planEditor' ? editor : null; },
        },
        setStatusMessage(msg, ms) { statusMessages.push({ msg, ms }); },
        showToast(msg, type) { toasts.push({ msg, type }); },
        getVersionFromFrontMatter(text) {
            const m = text.match(/^---\n[\s\S]*?^version:\s*(.+)$[\s\S]*?\n---/m);
            return m ? m[1].trim() : null;
        },
    };
    vm.createContext(sandbox);
    for (const file of ['project-storage.js', 'version-history.js']) {
        vm.runInContext(fs.readFileSync(path.join(staticDir, file), 'utf8'), sandbox, { filename: file });
    }
    // Top-level `const`s in a classic script are lexical, not properties of the
    // global, so they are read back by evaluating their names in the context.
    const constant = (name) => vm.runInContext(name, sandbox);
    return { sandbox, editor, statusMessages, toasts, ls: sandbox.localStorage, constant };
}

function plan(version, kb) {
    return '---\nversion: ' + version + '\n---\n' + 'Task line of plan text\n'.repeat(Math.ceil(kb * 1024 / 23));
}

// --- 1. a save that cannot fit is reported, and the last good copy survives --

{
    const app = makeApp(60 * 1024);
    const { sandbox, editor } = app;
    const project = sandbox.createProject('Alpha');
    sandbox.setCurrentProjectId(project.id);
    editor.value = plan('1.0', 10);
    assertTrue(sandbox.saveCurrentProjectState() === true, 'a plan that fits is saved');
    assertEqual(sandbox.loadProject(project.id).planText, editor.value, 'saved text reads back');
    const goodText = editor.value;

    app.statusMessages.length = 0;
    app.toasts.length = 0;
    editor.value = plan('2.0', 100); // far beyond the 60 KB budget
    const result = sandbox.saveCurrentProjectState();
    assertTrue(result === false, 'saveCurrentProjectState returns false when the quota is exceeded');
    assertTrue(app.statusMessages.some(m => /storage is full/i.test(m.msg) && m.ms === 0),
        'the status bar shows a persistent "storage is full" message');
    assertTrue(app.toasts.some(t => t.type === 'error' && /storage is full/i.test(t.msg)),
        'an error toast tells the user what happened');
    assertTrue(app.toasts.some(t => /Download your plan/i.test(t.msg)),
        'the message tells the user what to do');
    const failure = sandbox.getLastStorageFailure();
    assertTrue(failure && failure.quota === true, 'the failure is recorded as a quota failure');
    assertEqual(sandbox.loadProject(project.id).planText, goodText,
        'the last successfully saved copy is untouched (nothing lost silently)');

    // Recovery: a smaller plan saves again and the standing notice is cleared.
    app.statusMessages.length = 0;
    editor.value = plan('3.0', 5);
    assertTrue(sandbox.saveCurrentProjectState() === true, 'saving works again once the plan fits');
    assertTrue(sandbox.getLastStorageFailure() === null, 'the recorded failure is cleared by a successful save');
    assertTrue(app.statusMessages.some(m => /working again/i.test(m.msg)), 'the user is told storage is working again');
}

// --- 2. plan text wins over version history ------------------------------------

{
    const app = makeApp(200 * 1024);
    const { sandbox, editor, ls } = app;
    const project = sandbox.createProject('Beta');
    sandbox.setCurrentProjectId(project.id);

    // Fill the store with snapshots: 12 versions of a 12 KB plan, ~150 KB.
    for (let v = 1; v <= 12; v++) {
        editor.value = plan(v + '.0', 12);
        sandbox.saveCurrentProjectState();
    }
    const before = sandbox.getVersionHistory(project.id).length;
    assertTrue(before >= 10, 'history has accumulated (' + before + ' snapshots)');
    assertTrue(ls.used() > 150 * 1024, 'the store is nearly full (' + Math.round(ls.used() / 1024) + ' KB of 200 KB)');

    // Now the plan grows so that it no longer fits alongside the history.
    app.statusMessages.length = 0;
    app.toasts.length = 0;
    editor.value = plan('13.0', 40);
    const ok = sandbox.saveCurrentProjectState();
    assertTrue(ok === true, 'the plan is saved even though history had filled the store');
    assertEqual(sandbox.loadProject(project.id).planText, editor.value, 'the new plan text is what was stored');
    const after = sandbox.getVersionHistory(project.id).length;
    assertTrue(after < before, 'older snapshots were evicted to make room (' + before + ' -> ' + after + ')');
    assertTrue(app.statusMessages.some(m => /older plan version/i.test(m.msg)) || app.toasts.some(t => /older plan version/i.test(t.msg)),
        'the user is told that history was trimmed');
    assertTrue(sandbox.getLastStorageFailure() === null, 'a save that succeeded after eviction is not a failure');
}

// --- 3. history is capped by bytes, not just by count -------------------------

{
    const app = makeApp(50 * 1024 * 1024);
    const { sandbox, editor, constant } = app;
    const maxBytes = constant('MAX_HISTORY_BYTES_PER_PROJECT');
    const project = sandbox.createProject('Gamma');
    sandbox.setCurrentProjectId(project.id);
    for (let v = 1; v <= 50; v++) {
        editor.value = plan(v + '.0', 21.5); // the plan size measured in the issue
        sandbox.saveCurrentProjectState();
    }
    const history = sandbox.getVersionHistory(project.id);
    const bytes = history.reduce((n, e) => n + e.planText.length, 0);
    assertTrue(history.length < 50, 'fifty 21.5 KB snapshots do not all survive (' + history.length + ' kept)');
    assertTrue(bytes <= maxBytes,
        'history stays within its byte budget (' + Math.round(bytes / 1024) + ' KB <= ' + Math.round(maxBytes / 1024) + ' KB)');
    assertEqual(history[0].version, '50.0', 'the newest snapshots are the ones kept');
}

// --- 4. a history write that cannot fit never blocks and is reported ----------

{
    const app = makeApp(30 * 1024);
    const { sandbox } = app;
    const big = [];
    for (let v = 1; v <= 6; v++) big.push({ version: v + '.0', date: new Date().toISOString(), planText: plan(v + '.0', 8), rag: '' });
    app.statusMessages.length = 0;
    const ok = sandbox.saveVersionHistory('project-x', big);
    assertTrue(ok === true, 'saveVersionHistory keeps what fits instead of failing outright');
    const kept = sandbox.getVersionHistory('project-x');
    assertTrue(kept.length > 0 && kept.length < 6, 'the older half was dropped until the rest fit (' + kept.length + ' kept)');
    assertEqual(kept[0].version, '1.0', 'newest-first order is preserved when trimming');
    assertTrue(app.statusMessages.some(m => /older plan version/i.test(m.msg)), 'the user is told history was trimmed');

    const ls = sandbox.localStorage;
    ls.budget = ls.used() + 10; // nothing more fits
    app.statusMessages.length = 0;
    const failed = sandbox.saveVersionHistory('project-y', [big[0]]);
    assertTrue(failed === false, 'a history write that cannot fit at all returns false');
    assertTrue(app.statusMessages.some(m => /storage is full/i.test(m.msg)), 'and the failure is shown to the user');
    assertEqual(sandbox.getVersionHistory('project-x').length, kept.length,
        'history already stored for other projects is left in place');
}

// --- 5. non-quota errors are reported too --------------------------------------

{
    const app = makeApp(1024 * 1024);
    const { sandbox } = app;
    sandbox.localStorage.setItem = function () { throw new Error('SecurityError: access denied'); };
    app.toasts.length = 0;
    assertTrue(sandbox.saveAllProjects({}) === false, 'a non-quota write error returns false');
    assertTrue(app.toasts.some(t => /Could not save/i.test(t.msg) && /access denied/.test(t.msg)),
        'a non-quota write error is shown with its reason');
    assertTrue(sandbox.getLastStorageFailure().quota === false, 'and is not recorded as a quota failure');
}

if (failures > 0) {
    console.error('\n' + failures + ' test(s) failed');
    process.exit(1);
}
console.log('\nAll storage quota tests passed');
