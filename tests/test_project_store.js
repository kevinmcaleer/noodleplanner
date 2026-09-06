/**
 * Browser-local project store (issue #794, steps 3-6).
 *
 * Runs the real project-store.js, project-storage.js, version-history.js and
 * portfolio-dependencies.js in a sandbox whose `indexedDB` is fake-indexeddb,
 * and checks:
 *
 *   1. the synchronous facade (createProject, saveCurrentProjectState,
 *      getVersionHistory, programme dependencies) lands in IndexedDB as
 *      separate records, and a fresh sandbox on the same database reads the
 *      same data back byte for byte;
 *   2. saving one project touches one record, not the others;
 *   3. the migration copies a localStorage fixture into the store, leaves the
 *      fixture untouched, runs once, and cleanup happens only on request;
 *   4. a whole-store backup exports and re-imports;
 *   5. 50 projects with 50 snapshots each (a 21.5 KB plan) save, reopen and
 *      load, and a single project save afterwards writes one record;
 *   6. a write that fails is reported to the user and retried.
 *
 * fake-indexeddb is in-memory, so this exercises the record layout and the
 * write paths; it cannot exercise a real browser quota.
 *
 * Run with: node tests/test_project_store.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { IDBFactory, IDBKeyRange } = require('fake-indexeddb');

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

// --- helpers -----------------------------------------------------------------

function makeLocalStorage() {
    const data = new Map();
    return {
        get length() { return data.size; },
        key(i) { return Array.from(data.keys())[i] || null; },
        getItem(k) { return data.has(k) ? data.get(k) : null; },
        setItem(k, v) { data.set(k, String(v)); },
        removeItem(k) { data.delete(k); },
        clear() { data.clear(); },
        snapshot() { return Object.fromEntries(data); },
    };
}

/**
 * A sandbox with the real storage scripts loaded in page order. `factory`
 * is the IDBFactory to share between sandboxes that must see one database.
 */
function makeApp(factory, ls) {
    const editor = { value: '', readOnly: false, classList: { add() {}, remove() {} }, dispatchEvent() {} };
    const statusMessages = [];
    const toasts = [];
    const sandbox = {
        console: { log() {}, warn() {}, error(...a) { sandbox.errors.push(a.map(String).join(' ')); } },
        errors: [],
        DOMException,
        Date, Math, JSON, Promise, Error, Object, Array, String, Set, Map,
        setTimeout, clearTimeout, setInterval, clearInterval,
        indexedDB: factory,
        IDBKeyRange,
        localStorage: ls,
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
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    for (const file of ['project-store.js', 'project-storage.js', 'version-history.js', 'portfolio-dependencies.js']) {
        vm.runInContext(fs.readFileSync(path.join(staticDir, file), 'utf8'), sandbox, { filename: file });
    }
    return { sandbox, editor, statusMessages, toasts, ls, store: sandbox.NoodleStore };
}

function plan(version, kb) {
    // 23 bytes per line; the issue's measured plan is 21.5 KB for 550 tasks.
    return '---\nversion: ' + version + '\n---\n' + 'Task line of plan text\n'.repeat(Math.ceil(kb * 1024 / 23));
}

/** Read a whole object store straight from the database, bypassing the cache. */
function readStore(factory, dbName, storeName) {
    return new Promise((resolve, reject) => {
        const req = factory.open(dbName);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction(storeName, 'readonly');
            const all = tx.objectStore(storeName).getAll();
            all.onsuccess = () => { db.close(); resolve(all.result); };
            all.onerror = () => { db.close(); reject(all.error); };
        };
    });
}

function statsDelta(before, after) {
    const out = {};
    for (const name of Object.keys(after.byStore)) {
        out[name] = {
            puts: after.byStore[name].puts - before.byStore[name].puts,
            deletes: after.byStore[name].deletes - before.byStore[name].deletes,
        };
    }
    return out;
}

function cloneStats(stats) { return JSON.parse(JSON.stringify(stats)); }

async function main() {

    // --- 1. facade writes land as records and read back byte for byte ----------

    {
        const factory = new IDBFactory();
        const ls = makeLocalStorage();
        const app = makeApp(factory, ls);
        const { sandbox, editor, store } = app;
        await store.whenReady();
        assertTrue(store.isActive(), 'IndexedDB store is active in the sandbox');
        assertTrue(sandbox.projectStoreActive() === true, 'project-storage.js sees the store');

        const alpha = sandbox.createProject('Alpha');
        const beta = sandbox.createProject('Beta');
        sandbox.setCurrentProjectId(alpha.id);
        const text1 = plan('1.0', 21.5) + '\r\n\ttrailing tab and CRLF kept verbatim é中\n';
        editor.value = text1;
        assertTrue(sandbox.saveCurrentProjectState() === true, 'saveCurrentProjectState() accepts the save');
        assertEqual(sandbox.loadProject(alpha.id).planText, text1, 'plan text reads back from the cache unchanged');

        // Second save of a new version: a snapshot of the previous text is kept.
        const text2 = text1.replace('version: 1.0', 'version: 1.1') + 'more\n';
        editor.value = text2;
        sandbox.saveCurrentProjectState();

        sandbox.createProgrammeDependency(alpha.id, 'Task A', beta.id, 'Task B', 2, 'note');

        assertTrue(store.dirtyCount() > 0, 'writes are queued, not performed synchronously');
        await store.flush();
        assertEqual(store.dirtyCount(), 0, 'flush() drains the queue');

        const projects = await readStore(factory, store.DB_NAME, 'projects');
        const versions = await readStore(factory, store.DB_NAME, 'versions');
        const history = await readStore(factory, store.DB_NAME, 'history');
        const meta = await readStore(factory, store.DB_NAME, 'meta');
        assertEqual(projects.map(p => p.name).sort(), ['Alpha', 'Beta'], 'one record per project in IndexedDB');
        assertEqual(projects.find(p => p.id === alpha.id).planText, text2, 'the project record holds the latest text verbatim');
        assertEqual(versions.length, 2, 'one record per version snapshot');
        assertEqual(versions.map(v => v.version).sort(), ['1.0', '1.1'], 'snapshots carry their versions');
        assertEqual(history.length, 1, 'one order record for the project with history');
        assertTrue(meta.some(m => m.key === store.DEPS_META_KEY && m.value.length === 1), 'programme dependencies are one meta record');
        assertTrue(meta.some(m => m.key === 'migration'), 'migration marker written even with nothing to migrate');

        // A fresh page on the same database sees the same data.
        await store.close();
        const app2 = makeApp(factory, ls);
        await app2.store.whenReady();
        assertEqual(app2.sandbox.loadProject(alpha.id).planText, text2, 'reloaded plan text is byte-identical');
        assertEqual(app2.sandbox.getVersionHistory(alpha.id).map(v => v.version), ['1.1', '1.0'], 'history order survives reload (newest first)');
        assertEqual(app2.sandbox.getVersionHistory(alpha.id)[1].planText, text1, 'snapshot text survives reload byte for byte');
        assertEqual(app2.sandbox.getAllProgrammeDependencies().length, 1, 'programme dependencies survive reload');
        assertEqual(app2.sandbox.listProjects().length, 2, 'listProjects() lists both projects after reload');

        // Delete removes the project and its snapshots, nothing else.
        const before = cloneStats(app2.store.stats);
        assertTrue(app2.sandbox.deleteProject(alpha.id) === true, 'deleteProject() returns true');
        await app2.store.flush();
        const d = statsDelta(before, app2.store.stats);
        assertEqual(d.projects, { puts: 0, deletes: 1 }, 'delete touches one project record');
        assertEqual(d.versions, { puts: 0, deletes: 2 }, 'delete removes that project\'s two snapshots');
        assertEqual((await readStore(factory, app2.store.DB_NAME, 'projects')).map(p => p.name), ['Beta'], 'Beta is untouched by deleting Alpha');
        await app2.store.close();
    }

    // --- 2. saving one project touches one record ----------------------------

    {
        const factory = new IDBFactory();
        const app = makeApp(factory, makeLocalStorage());
        const { sandbox, editor, store } = app;
        await store.whenReady();
        const ids = [];
        for (let i = 0; i < 5; i++) {
            const p = sandbox.createProject('P' + i);
            sandbox.saveProject(p.id, { planText: plan('1.0', 5) });
            ids.push(p.id);
        }
        await store.flush();

        let before = cloneStats(store.stats);
        sandbox.saveProject(ids[2], { planText: plan('1.0', 6) });
        await store.flush();
        assertEqual(statsDelta(before, store.stats), {
            projects: { puts: 1, deletes: 0 }, versions: { puts: 0, deletes: 0 },
            history: { puts: 0, deletes: 0 }, meta: { puts: 0, deletes: 0 },
        }, 'saveProject() writes exactly one project record');

        before = cloneStats(store.stats);
        sandbox.saveAllProjects(sandbox.getAllProjects());
        await store.flush();
        assertEqual(store.stats.puts - before.puts, 0, 'saveAllProjects() with nothing changed writes nothing');

        // An editor save that adds a snapshot: one project, one snapshot, one order record.
        sandbox.setCurrentProjectId(ids[0]);
        editor.value = plan('2.0', 5);
        before = cloneStats(store.stats);
        sandbox.saveCurrentProjectState();
        await store.flush();
        assertEqual(statsDelta(before, store.stats), {
            projects: { puts: 1, deletes: 0 }, versions: { puts: 1, deletes: 0 },
            history: { puts: 1, deletes: 0 }, meta: { puts: 0, deletes: 0 },
        }, 'an editor save with a new snapshot writes project + snapshot + order');

        // Same version again: the snapshot is updated in place, no new record.
        editor.value = plan('2.0', 5) + 'edit\n';
        before = cloneStats(store.stats);
        sandbox.saveCurrentProjectState();
        await store.flush();
        assertEqual(statsDelta(before, store.stats).versions, { puts: 1, deletes: 0 }, 'a same-version save rewrites that one snapshot');
        assertEqual(statsDelta(before, store.stats).history, { puts: 0, deletes: 0 }, 'and does not rewrite the order record');
        await store.close();
    }

    // --- 3. migration from the localStorage blob, non-destructive --------------

    {
        const factory = new IDBFactory();
        const ls = makeLocalStorage();
        const fixtureProjects = {
            'project-100-aaa': { id: 'project-100-aaa', name: 'Legacy One', planText: plan('1.3', 21.5), createdAt: 100, updatedAt: 300 },
            'project-200-bbb': { id: 'project-200-bbb', name: 'Legacy Two', planText: '# Two\n', createdAt: 200, updatedAt: 250, importedAt: 210 },
            'project-300-ccc': { id: 'project-300-ccc', name: 'Legacy Three', planText: '', createdAt: 300, updatedAt: 280 },
        };
        // Snapshot dates must be inside the 14-day retention window, or the
        // real start-up cleanup (initVersionHistory) prunes them, as it should.
        const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
        ls.setItem('noodleplanner_projects', JSON.stringify(fixtureProjects));
        ls.setItem('noodle_history_project-100-aaa', JSON.stringify([
            { version: '1.2', date: hoursAgo(2), planText: plan('1.2', 21.5), rag: 'amber' },
            { version: '1.1', date: hoursAgo(26), planText: plan('1.1', 21.5), rag: 'green' },
            { version: 'uploaded', date: hoursAgo(72), planText: 'old\n', rag: '' },
        ]));
        ls.setItem('noodle_history_project-200-bbb', JSON.stringify([
            { version: '1.0', date: hoursAgo(1), planText: '# Two\n', rag: '' },
        ]));
        ls.setItem('noodleplanner_programme_deps', JSON.stringify([
            { id: 'dep-1', from_project_id: 'project-100-aaa', from_task_name: 'A', to_project_id: 'project-200-bbb', to_task_name: 'B', lag_days: 0, notes: '', created_at: 1 },
        ]));
        ls.setItem('noodleplanner_current_project', 'project-100-aaa');
        ls.setItem('np-theme-choice', 'dark');
        const original = ls.snapshot();

        const app = makeApp(factory, ls);
        const { sandbox, store } = app;
        await store.whenReady();
        const summary = store.migrationSummary();
        assertEqual([summary.status, summary.projects, summary.snapshots, summary.dependencies], ['done', 3, 4, 1],
            'migration copied 3 projects, 4 snapshots and 1 dependency');
        assertEqual(sandbox.listProjects().map(p => p.name), ['Legacy One', 'Legacy Three', 'Legacy Two'], 'migrated projects list newest first');
        assertEqual(sandbox.loadProject('project-100-aaa').planText, fixtureProjects['project-100-aaa'].planText, 'migrated plan text is byte-identical');
        assertEqual(sandbox.loadProject('project-200-bbb').importedAt, 210, 'extra project fields survive migration');
        assertEqual(sandbox.getVersionHistory('project-100-aaa').map(v => v.version), ['1.2', '1.1', 'uploaded'], 'history order is preserved');
        assertEqual(sandbox.getVersionHistory('project-100-aaa')[0].rag, 'amber', 'snapshot RAG survives');
        assertEqual(sandbox.getAllProgrammeDependencies()[0].id, 'dep-1', 'programme dependencies migrated');
        assertEqual(sandbox.getCurrentProjectId(), 'project-100-aaa', 'current project id still read from localStorage');
        await store.flush();
        assertEqual(ls.snapshot(), original, 'localStorage is byte-for-byte untouched after migration');

        const rows = await readStore(factory, store.DB_NAME, 'projects');
        assertEqual(rows.length, 3, 'migrated projects are in IndexedDB');
        assertEqual((await readStore(factory, store.DB_NAME, 'versions')).length, 4, 'migrated snapshots are in IndexedDB');

        // Work after migration goes to the store, not localStorage.
        sandbox.saveProject('project-200-bbb', { planText: '# Two, edited\n' });
        sandbox.deleteProject('project-300-ccc');
        await store.flush();
        assertEqual(ls.snapshot(), original, 'later saves and deletes do not touch localStorage');
        await store.close();

        // Second start-up: no second migration, the deleted project stays deleted.
        const app2 = makeApp(factory, ls);
        await app2.store.whenReady();
        assertEqual(app2.sandbox.listProjects().map(p => p.name).sort(), ['Legacy One', 'Legacy Two'], 'migration does not run again');
        assertEqual(app2.sandbox.loadProject('project-200-bbb').planText, '# Two, edited\n', 'edits made after migration persist');
        assertEqual(app2.store.migrationSummary().at, summary.at, 'the original migration marker is kept');
        const legacy = app2.store.legacyDataPresent();
        assertEqual([legacy.projects, legacy.snapshots, legacy.dependencies], [3, 4, 1], 'legacyDataPresent() reports the old copy');
        assertEqual(ls.snapshot(), original, 'nothing has been cleaned up without being asked');

        // Cleanup on request removes only the migrated keys.
        app2.store.cleanupLegacyStorage();
        assertEqual(app2.store.legacyDataPresent(), null, 'cleanup removes the old copy');
        assertEqual(Object.keys(ls.snapshot()).sort(), ['noodleplanner_current_project', 'np-theme-choice'], 'cleanup leaves UI preferences alone');
        assertTrue(!!app2.store.migrationSummary().cleanedAt, 'cleanup is recorded');
        await app2.store.close();
    }

    // --- 4. whole-store export and import --------------------------------------

    {
        const factory = new IDBFactory();
        const app = makeApp(factory, makeLocalStorage());
        const { sandbox, editor, store } = app;
        await store.whenReady();
        const a = sandbox.createProject('Export A');
        const b = sandbox.createProject('Export B');
        sandbox.setCurrentProjectId(a.id);
        editor.value = plan('1.0', 10);
        sandbox.saveCurrentProjectState();
        editor.value = plan('1.1', 10);
        sandbox.saveCurrentProjectState();
        sandbox.saveProject(b.id, { planText: '# B\n' });
        sandbox.createProgrammeDependency(a.id, 'x', b.id, 'y', 1, '');
        await store.flush();

        const snapshot = store.exportSnapshot();
        const json = JSON.stringify(snapshot);
        assertEqual(snapshot.format, 'noodleplanner-store', 'export declares its format');
        assertEqual(snapshot.projects.length, 2, 'export holds both projects');
        assertEqual(snapshot.versions.length, 1, 'export holds history for the project that has it');
        assertEqual(snapshot.versions[0].entries.length, 2, 'export holds both snapshots');
        assertTrue(!('migration' in snapshot.meta), 'export leaves the machine-specific migration marker out');

        // Restore into an empty browser through the facade.
        const app2 = makeApp(new IDBFactory(), makeLocalStorage());
        await app2.store.whenReady();
        const result = app2.sandbox.restoreStoreBackupFromJSON(json);
        assertEqual([result.projects, result.snapshots, result.dependencies], [2, 2, 1], 'restore imports projects, snapshots and dependencies');
        await app2.store.flush();
        assertEqual(app2.sandbox.loadProject(a.id).planText, plan('1.1', 10), 'restored plan text is byte-identical');
        assertEqual(app2.sandbox.getVersionHistory(a.id).map(v => v.version), ['1.1', '1.0'], 'restored history keeps its order');
        assertEqual(app2.sandbox.getAllProgrammeDependencies().length, 1, 'restored dependencies');
        assertEqual(app2.store.exportSnapshot().projects.map(p => p.id).sort(), [a.id, b.id].sort(), 'a re-export lists the same ids');

        // Restoring the same backup again keeps what is there.
        const again = app2.sandbox.restoreStoreBackupFromJSON(json);
        assertEqual([again.projects, again.skipped], [0, 2], 'a second restore skips projects that are already here');
        assertEqual(app2.sandbox.getAllProgrammeDependencies().length, 1, 'and does not duplicate dependencies');

        // Garbage is refused.
        assertEqual(app2.sandbox.restoreStoreBackupFromJSON('{"projects": {}}'), null, 'a non-backup file is refused');
        await app2.store.close();
        await store.close();
    }

    // --- 5. scale: 50 projects with full history -------------------------------

    {
        const factory = new IDBFactory();
        const app = makeApp(factory, makeLocalStorage());
        const { sandbox, editor, store } = app;
        await store.whenReady();
        const PROJECTS = 50;
        // Top-level consts in a classic script are lexical, not global properties.
        const SNAPSHOTS = vm.runInContext('MAX_VERSIONS_PER_PROJECT', sandbox); // 50
        assertEqual(SNAPSHOTS, 50, 'the count cap is fifty snapshots per project');
        const KB = 21.5;
        const t0 = Date.now();
        const ids = [];
        for (let p = 0; p < PROJECTS; p++) {
            const project = sandbox.createProject('Scale ' + p);
            ids.push(project.id);
            sandbox.setCurrentProjectId(project.id);
            // Each save with a new version keeps a snapshot of the previous text.
            for (let v = 0; v <= SNAPSHOTS; v++) {
                editor.value = plan('1.' + v, KB) + 'project ' + p + '\n';
                sandbox.saveCurrentProjectState();
            }
        }
        const tSave = Date.now();
        await store.flush();
        const tFlush = Date.now();
        const usage = store.usage();
        assertEqual(usage.projects, PROJECTS, PROJECTS + ' projects held');
        assertEqual(usage.snapshots, PROJECTS * SNAPSHOTS, PROJECTS * SNAPSHOTS + ' snapshots held (count cap applied, no byte cap)');
        assertTrue(usage.totalBytes > 50 * 1024 * 1024, 'the store holds over 50 MB of plan text (' + (usage.totalBytes / 1048576).toFixed(1) + ' MB)');
        assertEqual(store.stats.failedFlushes, 0, 'no flush failed');
        assertEqual((await readStore(factory, store.DB_NAME, 'versions')).length, PROJECTS * SNAPSHOTS, 'every snapshot is a record in IndexedDB');
        assertEqual((await readStore(factory, store.DB_NAME, 'projects')).length, PROJECTS, 'every project is a record in IndexedDB');
        console.log('INFO: 50 projects x 51 saves: ' + (tSave - t0) + ' ms in the facade, ' + (tFlush - tSave) + ' ms to flush, ' +
            store.stats.flushes + ' flushes, ' + store.stats.puts + ' puts');

        // One more save of one project: one project record, one snapshot, one order record.
        sandbox.setCurrentProjectId(ids[17]);
        editor.value = plan('2.0', KB) + 'project 17 again\n';
        const before = cloneStats(store.stats);
        const tOne = Date.now();
        sandbox.saveCurrentProjectState();
        const tOneDone = Date.now();
        await store.flush();
        const delta = statsDelta(before, store.stats);
        assertEqual(delta.projects, { puts: 1, deletes: 0 }, 'saving one of 50 projects writes one project record');
        assertEqual(delta.versions, { puts: 1, deletes: 1 }, 'and one new snapshot (the oldest one over the cap is deleted)');
        assertEqual(delta.history, { puts: 1, deletes: 0 }, 'and that project\'s order record');
        assertEqual(delta.meta, { puts: 0, deletes: 0 }, 'and nothing else');
        console.log('INFO: single save of one project took ' + (tOneDone - tOne) + ' ms synchronously in the facade');

        // Reopen and load everything.
        await store.close();
        const tOpen = Date.now();
        const app2 = makeApp(factory, makeLocalStorage());
        await app2.store.whenReady();
        const tReady = Date.now();
        assertEqual(app2.sandbox.listProjects().length, PROJECTS, 'all 50 projects load on a fresh start');
        assertEqual(app2.sandbox.getVersionHistory(ids[17]).length, SNAPSHOTS, 'a project\'s full history loads');
        assertEqual(app2.sandbox.getVersionHistory(ids[17])[0].version, '2.0', 'the newest snapshot is first');
        assertTrue(app2.sandbox.loadProject(ids[3]).planText === plan('1.' + SNAPSHOTS, KB) + 'project 3\n', 'a plan loads byte-identical after reopen');
        console.log('INFO: reopen + hydrate of ' + (app2.store.usage().totalBytes / 1048576).toFixed(1) + ' MB: ' + (tReady - tOpen) + ' ms (fake-indexeddb, in memory)');
        await app2.store.close();
    }

    // --- 6. a failed write is reported and retried -----------------------------

    {
        const factory = new IDBFactory();
        const app = makeApp(factory, makeLocalStorage());
        const { sandbox, store, statusMessages, toasts } = app;
        await store.whenReady();
        const p = sandbox.createProject('Fragile');
        await store.flush();

        // Make every put throw the browser's quota error.
        const { IDBObjectStore } = require('fake-indexeddb');
        const realPut = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function () { throw new DOMException('quota exceeded', 'QuotaExceededError'); };
        statusMessages.length = 0;
        toasts.length = 0;
        sandbox.saveProject(p.id, { planText: 'does not fit\n' });
        const ok = await store.flush();
        IDBObjectStore.prototype.put = realPut;

        assertTrue(ok === false, 'flush() reports the failure');
        assertTrue(statusMessages.some(s => s.ms === 0 && /storage is full/i.test(s.msg)), 'quota failure shows a persistent status-bar message');
        assertTrue(toasts.some(t => t.type === 'error'), 'and an error toast');
        assertTrue(sandbox.getLastStorageFailure() && sandbox.getLastStorageFailure().quota === true, 'getLastStorageFailure() records a quota failure');
        assertEqual(sandbox.loadProject(p.id).planText, 'does not fit\n', 'the in-memory copy still has the edit');
        assertTrue(store.dirtyCount() > 0, 'the failed record stays queued');

        const ok2 = await store.flush();
        assertTrue(ok2 === true, 'the retry succeeds once there is room');
        assertEqual(sandbox.getLastStorageFailure(), null, 'a later success clears the failure');
        assertTrue(statusMessages.some(s => /working again/i.test(s.msg)), 'and tells the user');
        assertEqual((await readStore(factory, store.DB_NAME, 'projects'))[0].planText, 'does not fit\n', 'the retried write landed');
        await store.close();
    }

    // --- 7. no IndexedDB: the localStorage path is used --------------------------

    {
        const ls = makeLocalStorage();
        const app = makeApp(undefined, ls);
        const { sandbox, store } = app;
        await store.whenReady();
        assertTrue(store.isActive() === false, 'without indexedDB the store is inactive');
        assertTrue(sandbox.projectStoreActive() === false, 'and project-storage.js falls back');
        const p = sandbox.createProject('Fallback');
        assertTrue(!!ls.getItem('noodleplanner_projects'), 'projects are written to localStorage');
        assertEqual(sandbox.loadProject(p.id).name, 'Fallback', 'and read back');
    }

    if (failures) {
        console.error('\n' + failures + ' project store test(s) failed');
        process.exit(1);
    }
    console.log('\nAll project store tests passed');
}

main().catch(e => { console.error(e); process.exit(1); });
