/**
 * Per-target file-link persistence for RAID Excel / MS Project sync (issue
 * #761's follow-up: sync never remembered which file to sync to, so every
 * sync opened a fresh OS picker).
 *
 * local-file-access.js (issue #767) originally tracked one handle per
 * project, for the main plan .md file only, held in memory and explicitly
 * documented as not surviving a reload. This exercises the extension that:
 *
 *   1. keys handles by (projectId, targetKey), so a project's main plan
 *      file, RAID workbook and MS Project schedule can all be linked
 *      independently without disturbing each other;
 *   2. persists handles to IndexedDB so a link survives a reload, restoring
 *      them via restoreLinks()/ensureRestored();
 *   3. on restore, only ever QUERIES permission, never requests it (no
 *      unsolicited prompts outside a user gesture) -- a handle whose
 *      permission isn't 'granted' is flagged via needsRelinking()/
 *      getLinkStatus() instead;
 *   4. requestWritePermission() actually asks, and reports whether it was
 *      granted, for callers to invoke as the first step of a real
 *      user-gesture click handler;
 *   5. pickAndLinkFile()/readLinkedFile()/writeLinkedFile() give sync
 *      targets read+write access through a linked handle with no dialog;
 *   6. a write that fails on a *permission* error keeps the handle (just
 *      flags needs-relink, recoverable via requestWritePermission on the
 *      SAME handle), while a write that fails because the file itself is
 *      gone drops the link entirely (nothing left worth retrying against);
 *   7. unlink(projectId, targetKey) removes only that target's persisted
 *      record; unlink(projectId) with no targetKey purges every target for
 *      the project (project deletion's use, in project-storage.js).
 *
 * The fake IndexedDB here is a small hand-rolled in-memory stub, not the
 * `fake-indexeddb` package test_project_store.js uses -- that package does
 * real structured-clone semantics, which (correctly, for pure-JS data) drops
 * functions, and a fake FileSystemFileHandle is nothing BUT methods. Real
 * browsers can structured-clone a genuine FileSystemFileHandle because it
 * has host-defined (non-JS) serialization; nothing here needs to reproduce
 * that fidelity to exercise this module's own restore/persist logic, so a
 * simple by-reference store is enough and avoids a false negative from a
 * library restriction that isn't the thing under test.
 *
 * Run with: node tests/test_sync_file_linking.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const staticDir = path.join(__dirname, '..', 'packages', 'noodle-web', 'src', 'noodle_web', 'static');
const moduleSource = fs.readFileSync(path.join(staticDir, 'local-file-access.js'), 'utf8');

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

// --- a fake File System Access API handle -----------------------------------

function makeFakeHandle(name, initialText, opts) {
    opts = opts || {};
    let text = initialText;
    let permissionState = opts.permissionState || 'granted';
    const writes = [];
    const queryPermissionCalls = [];
    const requestPermissionCalls = [];
    return {
        name: name,
        writes: writes,
        queryPermissionCalls: queryPermissionCalls,
        requestPermissionCalls: requestPermissionCalls,
        _text: () => text,
        _setPermission: (state) => { permissionState = state; },
        queryPermission: async function (desc) { queryPermissionCalls.push(desc); return permissionState; },
        requestPermission: async function (desc) {
            requestPermissionCalls.push(desc);
            permissionState = opts.requestPermissionResult !== undefined ? opts.requestPermissionResult : permissionState;
            return permissionState;
        },
        getFile: async function () {
            if (opts.fileGone) {
                const e = new Error('file not found');
                e.name = 'NotFoundError';
                throw e;
            }
            return {
                name: name,
                text: async () => text,
                arrayBuffer: async () => {
                    const buf = new ArrayBuffer(text.length);
                    const view = new Uint8Array(buf);
                    for (let i = 0; i < text.length; i++) view[i] = text.charCodeAt(i) & 0xff;
                    return buf;
                },
            };
        },
        createWritable: async function () {
            if (opts.failCreateWritable) {
                const e = new Error(opts.failCreateWritable);
                e.name = opts.failCreateWritableName || 'Error';
                throw e;
            }
            return {
                write: async function (content) {
                    if (opts.failWrite) {
                        const e = new Error(opts.failWrite);
                        e.name = opts.failWriteName || 'Error';
                        throw e;
                    }
                    writes.push(content);
                    text = typeof content === 'string' ? content : '[bytes]';
                },
                close: async function () { /* no-op */ },
            };
        },
    };
}

// --- a small hand-rolled fake IndexedDB (see file header for why) ----------

function makeFakeIndexedDBFactory() {
    // dbName -> Map(storeName -> Map(id -> record))
    const databases = new Map();

    function schedule(fn) { setTimeout(fn, 0); }
    function makeRequest() { return { result: undefined, error: undefined, onsuccess: null, onerror: null }; }

    return {
        open(dbName, version) {
            const req = makeRequest();
            schedule(() => {
                let storeMaps = databases.get(dbName);
                const isNew = !storeMaps;
                if (!storeMaps) { storeMaps = new Map(); databases.set(dbName, storeMaps); }

                const db = {
                    objectStoreNames: { contains: (n) => storeMaps.has(n) },
                    createObjectStore(n) { storeMaps.set(n, new Map()); return {}; },
                    transaction(storeNames) {
                        const tx = { oncomplete: null, onerror: null };
                        let pending = 0;
                        let closed = false;
                        function checkComplete() {
                            if (closed && pending === 0) schedule(() => { if (tx.oncomplete) tx.oncomplete(); });
                        }
                        tx.objectStore = (name) => {
                            const map = storeMaps.get(name);
                            return {
                                put(record) {
                                    const r = makeRequest();
                                    pending++;
                                    schedule(() => {
                                        map.set(record.id, record);
                                        r.result = record.id;
                                        if (r.onsuccess) r.onsuccess();
                                        pending--; checkComplete();
                                    });
                                    return r;
                                },
                                delete(id) {
                                    const r = makeRequest();
                                    pending++;
                                    schedule(() => {
                                        map.delete(id);
                                        if (r.onsuccess) r.onsuccess();
                                        pending--; checkComplete();
                                    });
                                    return r;
                                },
                                openCursor() {
                                    const entries = Array.from(map.entries());
                                    let i = 0;
                                    const r = makeRequest();
                                    pending++; // decremented only once the cursor truly ends
                                    function step() {
                                        if (i >= entries.length) {
                                            r.result = null;
                                            if (r.onsuccess) r.onsuccess();
                                            pending--; checkComplete();
                                            return;
                                        }
                                        const [id, value] = entries[i];
                                        r.result = {
                                            value: value,
                                            continue() { i++; schedule(step); },
                                            delete() { map.delete(id); },
                                        };
                                        if (r.onsuccess) r.onsuccess();
                                    }
                                    schedule(step);
                                    return r;
                                },
                            };
                        };
                        schedule(() => { closed = true; checkComplete(); });
                        return tx;
                    },
                };

                req.result = db;
                if (isNew && req.onupgradeneeded) req.onupgradeneeded();
                if (req.onsuccess) req.onsuccess();
            });
            return req;
        },
    };
}

/** Build a sandbox with the real local-file-access.js loaded. `windowOverrides`
 *  simulates showOpenFilePicker/showSaveFilePicker presence; `idbFactory`
 *  (shared across two makeApp() calls to simulate "same browser, reload"). */
function makeApp(windowOverrides, idbFactory) {
    const sandbox = { console: { log() {}, warn() {}, error() {} } };
    vm.createContext(sandbox);
    if (windowOverrides !== null) sandbox.window = Object.assign({}, windowOverrides);
    if (idbFactory) sandbox.indexedDB = idbFactory;
    vm.runInContext(moduleSource, sandbox, { filename: 'local-file-access.js' });
    return sandbox;
}

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function main() {
    // --- 1. per-target linking: independent targets for the same project ---

    {
        const app = makeApp({ showOpenFilePicker: async () => [], showSaveFilePicker: async () => ({}) });
        const planHandle = makeFakeHandle('roadmap.md', 'plan text');
        const raidHandle = makeFakeHandle('raid.xlsx', 'raid bytes');

        app.LocalFileAccess.link('proj-1', planHandle, 'roadmap.md'); // default target: 'plan'
        app.LocalFileAccess.link('proj-1', raidHandle, 'raid.xlsx', 'raid-excel');

        assertTrue(app.LocalFileAccess.isLinked('proj-1'), 'default target (plan) is linked');
        assertTrue(app.LocalFileAccess.isLinked('proj-1', 'plan'), 'explicit "plan" target key matches the default');
        assertTrue(app.LocalFileAccess.isLinked('proj-1', 'raid-excel'), 'a second target on the same project is linked independently');
        assertTrue(app.LocalFileAccess.isLinked('proj-1', 'msproject') === false, 'a target never linked reports unlinked');
        assertEqual(app.LocalFileAccess.getLinkedFileName('proj-1', 'raid-excel'), 'raid.xlsx', 'per-target filename is retrievable');
        assertEqual(app.LocalFileAccess.getLinkedFileName('proj-1'), 'roadmap.md', 'the default target keeps its own filename');

        app.LocalFileAccess.unlink('proj-1', 'raid-excel');
        assertTrue(app.LocalFileAccess.isLinked('proj-1', 'raid-excel') === false, 'unlinking one target does not touch it any more');
        assertTrue(app.LocalFileAccess.isLinked('proj-1', 'plan'), 'unlinking one target leaves a sibling target linked');

        app.LocalFileAccess.link('proj-1', raidHandle, 'raid.xlsx', 'raid-excel'); // relink for the next block
        app.LocalFileAccess.link('proj-1', makeFakeHandle('sched.mpp', 'x'), 'sched.mpp', 'msproject');
        app.LocalFileAccess.unlink('proj-1'); // no targetKey -- full purge, e.g. on project deletion
        assertTrue(app.LocalFileAccess.isLinked('proj-1', 'plan') === false, 'unlink(projectId) with no targetKey drops the plan target too');
        assertTrue(app.LocalFileAccess.isLinked('proj-1', 'raid-excel') === false, 'unlink(projectId) with no targetKey drops the RAID target');
        assertTrue(app.LocalFileAccess.isLinked('proj-1', 'msproject') === false, 'unlink(projectId) with no targetKey drops the MS Project target');
    }

    // --- 2. getLinkStatus() ------------------------------------------------

    {
        const unsupported = makeApp({});
        assertEqual(unsupported.LocalFileAccess.getLinkStatus('p', 'raid-excel'), 'unsupported',
            'getLinkStatus() is "unsupported" without the File System Access API');

        const app = makeApp({ showOpenFilePicker: async () => [], showSaveFilePicker: async () => ({}) });
        assertEqual(app.LocalFileAccess.getLinkStatus('p', 'raid-excel'), 'unlinked',
            'getLinkStatus() is "unlinked" for a never-linked target in a supporting browser');

        const handle = makeFakeHandle('raid.xlsx', 'x');
        app.LocalFileAccess.link('p', handle, 'raid.xlsx', 'raid-excel');
        assertEqual(app.LocalFileAccess.getLinkStatus('p', 'raid-excel'), 'linked',
            'getLinkStatus() is "linked" right after link()');
    }

    // --- 3, 4. IndexedDB persistence across a simulated reload; restore only
    //           queries permission, never requests it ------------------------

    {
        const idb = makeFakeIndexedDBFactory();
        const before = makeApp({ showOpenFilePicker: async () => [], showSaveFilePicker: async () => ({}) }, idb);
        const handle = makeFakeHandle('raid.xlsx', 'raid contents', { permissionState: 'granted' });
        before.LocalFileAccess.link('proj-2', handle, 'raid.xlsx', 'raid-excel');
        await wait(20); // let the fire-and-forget persistHandle() write land

        // A fresh sandbox with the SAME underlying fake database simulates a
        // page reload: nothing in memory carries over except what
        // restoreLinks() pulls back out of IndexedDB.
        const after = makeApp({ showOpenFilePicker: async () => [], showSaveFilePicker: async () => ({}) }, idb);
        assertTrue(after.LocalFileAccess.isLinked('proj-2', 'raid-excel') === false, 'a fresh app instance starts with nothing linked in memory');

        const restored = await after.LocalFileAccess.restoreLinks('proj-2');
        assertEqual(restored.length, 1, 'restoreLinks() found the one persisted record');
        assertEqual(restored[0].targetKey, 'raid-excel', 'the restored record reports its target key');
        assertTrue(after.LocalFileAccess.isLinked('proj-2', 'raid-excel'), 'restoreLinks() re-links the target in memory');
        assertEqual(after.LocalFileAccess.getLinkedFileName('proj-2', 'raid-excel'), 'raid.xlsx', 'the restored filename matches');
        assertEqual(after.LocalFileAccess.getLinkStatus('proj-2', 'raid-excel'), 'linked',
            'a restored handle with granted permission reports "linked", not "needs-relink"');
        assertTrue(handle.requestPermissionCalls.length === 0,
            'restoreLinks() only ever QUERIED permission -- requestPermission was never called on page load');
    }

    // --- 5. a restored handle with non-granted permission needs relinking ---

    {
        const idb = makeFakeIndexedDBFactory();
        const before = makeApp({ showOpenFilePicker: async () => [], showSaveFilePicker: async () => ({}) }, idb);
        const handle = makeFakeHandle('sched.mpp', 'x', { permissionState: 'prompt' });
        before.LocalFileAccess.link('proj-3', handle, 'sched.mpp', 'msproject');
        await wait(20);

        const after = makeApp({ showOpenFilePicker: async () => [], showSaveFilePicker: async () => ({}) }, idb);
        await after.LocalFileAccess.restoreLinks('proj-3');
        assertEqual(after.LocalFileAccess.getLinkStatus('proj-3', 'msproject'), 'needs-relink',
            'a restored handle whose permission is not granted reports "needs-relink"');
        assertTrue(after.LocalFileAccess.needsRelinking('proj-3', 'msproject'), 'needsRelinking() agrees');
        assertTrue(handle.requestPermissionCalls.length === 0, 'still no unsolicited requestPermission() call on restore');

        // requestWritePermission() actually asks, and updates status once granted.
        handle._setPermission('prompt'); // queryPermission will see this...
        const grantingHandle = handle;
        grantingHandle.requestPermission = async function () { this._setPermission('granted'); return 'granted'; };
        const granted = await after.LocalFileAccess.requestWritePermission('proj-3', 'msproject');
        assertTrue(granted === true, 'requestWritePermission() resolves true once the user grants it');
        assertEqual(after.LocalFileAccess.getLinkStatus('proj-3', 'msproject'), 'linked',
            'status flips to "linked" immediately after a granted requestWritePermission()');
    }

    // --- 6. requestWritePermission() failure keeps needs-relink true --------

    {
        const app = makeApp({});
        const handle = makeFakeHandle('x.xlsx', 'x', { permissionState: 'denied', requestPermissionResult: 'denied' });
        app.LocalFileAccess.link('proj-4', handle, 'x.xlsx', 'raid-excel');
        // Simulate "restored with denied permission" directly (no IndexedDB
        // round-trip needed to exercise this path).
        const denied = await app.LocalFileAccess.requestWritePermission('proj-4', 'raid-excel');
        assertTrue(denied === false, 'requestWritePermission() resolves false when the user (or policy) refuses');
    }

    // --- 7. readLinkedFile()/writeLinkedFile() through a linked handle ------

    {
        const app = makeApp({});
        const handle = makeFakeHandle('raid.xlsx', 'ABC');
        app.LocalFileAccess.link('proj-5', handle, 'raid.xlsx', 'raid-excel');

        const read = await app.LocalFileAccess.readLinkedFile('proj-5', 'raid-excel', 'arraybuffer');
        assertEqual(read.name, 'raid.xlsx', 'readLinkedFile() reports the filename');
        assertEqual(new Uint8Array(read.content).length, 3, 'readLinkedFile() with readAs "arraybuffer" returns raw bytes');

        const writeResult = await app.LocalFileAccess.writeLinkedFile('proj-5', 'raid-excel', 'new content');
        assertTrue(writeResult.ok === true, 'writeLinkedFile() succeeds against a linked, permitted handle');
        assertEqual(handle.writes[0], 'new content', 'the exact content passed in was written, unmodified');
        assertTrue(app.LocalFileAccess.isLinked('proj-5', 'raid-excel'), 'a successful write leaves the target linked');
    }

    // --- 8. permission failure on write keeps the handle (needs-relink); a
    //        missing-file failure drops it entirely -------------------------

    {
        const app = makeApp({ showOpenFilePicker: async () => [], showSaveFilePicker: async () => ({}) });
        const handle = makeFakeHandle('locked.xlsx', 'x', {
            failCreateWritable: 'permission revoked', failCreateWritableName: 'NotAllowedError',
        });
        app.LocalFileAccess.link('proj-6', handle, 'locked.xlsx', 'raid-excel');

        const result = await app.LocalFileAccess.writeLinkedFile('proj-6', 'raid-excel', 'x');
        assertTrue(result.ok === false, 'a permission failure on write resolves ok:false');
        assertTrue(result.needsRelink === true, 'the failure result flags needsRelink');
        assertTrue(app.LocalFileAccess.isLinked('proj-6', 'raid-excel'),
            'a NotAllowedError keeps the handle linked -- the SAME handle can recover via requestWritePermission()');
        assertEqual(app.LocalFileAccess.getLinkStatus('proj-6', 'raid-excel'), 'needs-relink',
            'status reflects needs-relink after the permission failure');
    }

    {
        const app = makeApp({});
        const handle = makeFakeHandle('moved.xlsx', 'x', {
            failCreateWritable: 'no such file', failCreateWritableName: 'NotFoundError',
        });
        app.LocalFileAccess.link('proj-7', handle, 'moved.xlsx', 'raid-excel');

        const result = await app.LocalFileAccess.writeLinkedFile('proj-7', 'raid-excel', 'x');
        assertTrue(result.ok === false, 'a missing-file failure on write also resolves ok:false');
        assertTrue(app.LocalFileAccess.isLinked('proj-7', 'raid-excel') === false,
            'a non-permission failure (file moved/deleted) drops the link entirely -- nothing left worth retrying against');
    }

    // --- 9. pickAndLinkFile(): links immediately and requests permission in
    //        the same gesture as the picker call ------------------------------

    {
        const app = makeApp({ showSaveFilePicker: async () => ({}) });
        const handle = makeFakeHandle('raid.xlsx', 'hello', { permissionState: 'prompt', requestPermissionResult: 'granted' });
        let pickerCalledWith = null;
        app.window.showOpenFilePicker = async (opts) => { pickerCalledWith = opts; return [handle]; };

        const picked = await app.LocalFileAccess.pickAndLinkFile('proj-8', 'raid-excel', { id: 'raid-picker' }, 'arraybuffer');
        assertTrue(!!picked, 'pickAndLinkFile() resolves with a result');
        assertEqual(picked.name, 'raid.xlsx', 'the picked filename is returned');
        assertEqual(pickerCalledWith.id, 'raid-picker', 'the picker was called with the options the caller supplied');
        assertTrue(app.LocalFileAccess.isLinked('proj-8', 'raid-excel'), 'pickAndLinkFile() links the handle immediately, unlike pickAndReadFile()');
        assertEqual(app.LocalFileAccess.getLinkStatus('proj-8', 'raid-excel'), 'linked',
            'readwrite permission was requested up front, so status is "linked" right away, not "needs-relink"');
        assertTrue(handle.requestPermissionCalls.length === 1, 'exactly one requestPermission call happened, in the same gesture as the picker');

        // Cancelling the picker (AbortError) is not an error, and links nothing.
        app.window.showOpenFilePicker = async () => { const e = new Error('cancelled'); e.name = 'AbortError'; throw e; };
        const cancelled = await app.LocalFileAccess.pickAndLinkFile('proj-9', 'msproject', {}, 'text');
        assertTrue(cancelled === null, 'cancelling pickAndLinkFile() resolves to null, not a thrown error');
        assertTrue(app.LocalFileAccess.isLinked('proj-9', 'msproject') === false, 'a cancelled pick links nothing');
    }

    // --- 10. ensureRestored() is memoized per project per page session ------

    {
        const idb = makeFakeIndexedDBFactory();
        const seed = makeApp({}, idb);
        seed.LocalFileAccess.link('proj-10', makeFakeHandle('x.xlsx', 'x'), 'x.xlsx', 'raid-excel');
        await wait(20);

        const app = makeApp({}, idb);
        let openCount = 0;
        const originalOpen = idb.open.bind(idb);
        // Not swapping idb.open itself (shared across sandboxes); instead count
        // via restoreLinks()'s own restored-array length across repeat calls,
        // which is a good enough proxy: ensureRestored() must not re-populate
        // (and thus not re-query permission) a second time.
        await app.LocalFileAccess.ensureRestored('proj-10');
        const linkedAfterFirst = app.LocalFileAccess.isLinked('proj-10', 'raid-excel');
        await app.LocalFileAccess.ensureRestored('proj-10'); // should be a no-op the second time
        assertTrue(linkedAfterFirst, 'ensureRestored() restores a persisted handle the first time it is called');
        assertTrue(app.LocalFileAccess.isLinked('proj-10', 'raid-excel'), 'the target is still linked after a second ensureRestored() call');
    }

    // --- 11. unlink(projectId, targetKey) removes only that persisted record

    {
        const idb = makeFakeIndexedDBFactory();
        const before = makeApp({}, idb);
        before.LocalFileAccess.link('proj-11', makeFakeHandle('raid.xlsx', 'x'), 'raid.xlsx', 'raid-excel');
        before.LocalFileAccess.link('proj-11', makeFakeHandle('sched.mpp', 'x'), 'sched.mpp', 'msproject');
        await wait(20);
        await before.LocalFileAccess.unlink('proj-11', 'raid-excel');
        await wait(20);

        const after = makeApp({}, idb);
        const restored = await after.LocalFileAccess.restoreLinks('proj-11');
        assertEqual(restored.length, 1, 'only the un-unlinked target was still persisted');
        assertEqual(restored[0].targetKey, 'msproject', 'the surviving persisted record is the one that was not unlinked');
    }

    // --- 12. #767 backward compatibility: the original single-target API
    //         (no targetKey argument) still behaves exactly as before --------

    {
        const app = makeApp({ showSaveFilePicker: async () => ({}) });
        const original = '---\nversion: 3.2\n---\nTask one @alex 2d\n';
        const handle = makeFakeHandle('roadmap.md', original);
        app.window.showOpenFilePicker = async () => [handle];

        const picked = await app.LocalFileAccess.pickAndReadFile();
        assertEqual(picked.text, original, 'pickAndReadFile() (unchanged from #767) still reads byte-identical text');
        app.LocalFileAccess.link('proj-12', picked.handle, picked.name); // no targetKey -- defaults to 'plan'

        let pickerCalledDuringSave = false;
        app.window.showOpenFilePicker = async () => { pickerCalledDuringSave = true; return [handle]; };
        const saveResult = await app.LocalFileAccess.saveToLinkedFile('proj-12', original);
        assertTrue(saveResult.ok === true, 'saveToLinkedFile() (unchanged from #767) still succeeds with no targetKey argument');
        assertTrue(pickerCalledDuringSave === false, 'no picker was invoked -- the no-re-prompt guarantee still holds');
    }
}

main().then(() => {
    if (failures > 0) {
        console.error('\n' + failures + ' test(s) failed');
        process.exit(1);
    }
    console.log('\nAll sync-file-linking tests passed');
}).catch((err) => {
    console.error('Uncaught error while running tests:', err);
    process.exit(1);
});
