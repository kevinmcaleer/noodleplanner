/**
 * local-file-access.js — open/save/sync files on the user's real filesystem
 * (issue #767, extended for #761's follow-up sync-file-linking work).
 *
 * NoodlePlanner's persistence is otherwise entirely browser-storage-based
 * (project-storage.js / project-store.js — localStorage or IndexedDB). This
 * module adds a second, optional save target: real files on disk, opened
 * and written to entirely client-side. Bytes never pass through the FastAPI
 * server — there is no `/api/...` call anywhere in this module.
 *
 * Two paths, chosen purely by feature detection (never user-agent sniffing):
 *
 *  - File System Access API (Chromium/Edge): showOpenFilePicker() returns a
 *    FileSystemFileHandle, which link() retains here. Reading/writing a
 *    linked target goes straight through the handle via getFile()/
 *    createWritable() — no dialog, no re-prompt.
 *
 *  - Everywhere else (Firefox, Safari): no native picker/handle is
 *    available. isSupported() reports that, so callers (script.js,
 *    settings.js) can fall back to the existing upload-then-download flow
 *    and say so plainly in the UI, rather than silently behaving
 *    differently.
 *
 * A project can now have more than one independently-linked file at once —
 * the original #767 work only ever linked the main plan .md file
 * (targetKey 'plan', still the default when a caller omits it). #761's
 * follow-up adds separate sync targets for the RAID Excel workbook
 * ('raid-excel') and the MS Project schedule ('msproject'), each tracked
 * under its own key so linking one never disturbs another:
 *
 *   linkedFiles: Map<projectId, Map<targetKey, { handle, name }>>
 *
 * Handles are also persisted to IndexedDB (they are structured-cloneable —
 * a well-supported File System Access API pattern in Chromium/Edge), so a
 * link survives a page reload. On restore, this module only ever *queries*
 * permission, never requests it — an unsolicited permission prompt outside
 * a user gesture is bad UX and some browsers block it outright. A restored
 * handle whose permission isn't 'granted' is flagged via needsRelinking()
 * so the UI can say "needs re-linking" instead of silently falling back to
 * a fresh picker with no explanation. requestWritePermission() actually
 * asks for permission, and MUST be called synchronously (as the first
 * awaited call) from inside a real user-gesture handler — e.g. the Sync
 * button's click listener — never from a callback that fires later, since
 * requestPermission() needs transient user activation to succeed.
 *
 * This module only manages *handles* and raw content; it never edits plan
 * or workbook content itself (script.js/raid-sync.js/msproject-sync.js own
 * that) and never touches localStorage/IndexedDB project data — its own
 * IndexedDB database (noodleplanner-file-links) holds nothing but handles.
 *
 * IMPORTANT — what this module can NOT do: the File System Access API
 * deliberately never exposes a resolvable path or URL to JavaScript, by
 * design (a browser security boundary, not a gap here). A FileSystemFileHandle
 * is only ever usable within the browser profile that picked it. There is
 * no "file URL" to store in front matter — front matter keeps a
 * human-readable filename label (portable, useful even on another machine)
 * but the actual one-click link is inherently per-browser; opening the same
 * plan elsewhere always needs one manual re-link. See the PR description
 * for the full reasoning.
 */
(function (root) {
    'use strict';

    /** Feature-detect the File System Access API. Never user-agent sniffing. */
    function isSupported() {
        return typeof window !== 'undefined' &&
            typeof window.showOpenFilePicker === 'function' &&
            typeof window.showSaveFilePicker === 'function';
    }

    const DEFAULT_TARGET = 'plan';

    // projectId -> Map<targetKey, { handle: FileSystemFileHandle, name: string }>
    const linkedFiles = new Map();

    // projectId -> Map<targetKey, true> — targets whose handle was restored
    // (from IndexedDB, or failed a write) but whose permission is not
    // currently 'granted'. Cleared as soon as permission is (re-)granted.
    const needsRelinkMap = new Map();

    // projectIds already restored from IndexedDB this page session, so
    // repeated calls (e.g. opening the Settings panel more than once) don't
    // keep re-reading the database. restoreLinks() itself stays safe to call
    // more than once directly if a caller wants a fresh permission check.
    const restoredProjects = new Set();

    function targetsFor(projectId, create) {
        let m = linkedFiles.get(projectId);
        if (!m && create) {
            m = new Map();
            linkedFiles.set(projectId, m);
        }
        return m;
    }

    function isLinked(projectId, targetKey) {
        targetKey = targetKey || DEFAULT_TARGET;
        const m = linkedFiles.get(projectId);
        return !!(projectId && m && m.has(targetKey));
    }

    function getLinkedFileName(projectId, targetKey) {
        targetKey = targetKey || DEFAULT_TARGET;
        const m = linkedFiles.get(projectId);
        const entry = m && m.get(targetKey);
        return entry ? entry.name : null;
    }

    function markNeedsRelink(projectId, targetKey) {
        let m = needsRelinkMap.get(projectId);
        if (!m) { m = new Map(); needsRelinkMap.set(projectId, m); }
        m.set(targetKey, true);
    }

    function clearNeedsRelink(projectId, targetKey) {
        const m = needsRelinkMap.get(projectId);
        if (m) m.delete(targetKey);
    }

    function needsRelinking(projectId, targetKey) {
        targetKey = targetKey || DEFAULT_TARGET;
        const m = needsRelinkMap.get(projectId);
        return !!(m && m.get(targetKey));
    }

    /**
     * One of 'unsupported' (no File System Access API — Firefox/Safari),
     * 'unlinked' (no handle at all — first sync needs a picker),
     * 'needs-relink' (a handle exists but permission isn't granted — a
     * restart, a different session, or a failed write) or 'linked' (ready
     * for a one-click sync). Settings UI and Sync buttons key their
     * rendering off this rather than re-deriving it from isLinked/
     * needsRelinking separately.
     */
    function getLinkStatus(projectId, targetKey) {
        targetKey = targetKey || DEFAULT_TARGET;
        if (!isSupported()) return 'unsupported';
        if (!isLinked(projectId, targetKey)) return 'unlinked';
        if (needsRelinking(projectId, targetKey)) return 'needs-relink';
        return 'linked';
    }

    /** Record a handle for a project/target after it (or its content) has loaded. */
    function link(projectId, handle, name, targetKey) {
        targetKey = targetKey || DEFAULT_TARGET;
        targetsFor(projectId, true).set(targetKey, { handle: handle, name: name });
        clearNeedsRelink(projectId, targetKey);
        persistHandle(projectId, targetKey, handle, name).catch(function (error) {
            console.warn('Failed to persist linked file handle:', error);
        });
    }

    /**
     * Drop a link. With `targetKey`, forgets only that one target. Without
     * it, forgets every target for the project (e.g. on project deletion —
     * see project-storage.js) — this matches the original #767 single-target
     * semantics for callers that never think in terms of targets.
     */
    function unlink(projectId, targetKey) {
        if (targetKey) {
            const m = linkedFiles.get(projectId);
            if (m) m.delete(targetKey);
            clearNeedsRelink(projectId, targetKey);
        } else {
            linkedFiles.delete(projectId);
            needsRelinkMap.delete(projectId);
        }
        return deletePersistedHandle(projectId, targetKey).catch(function (error) {
            console.warn('Failed to remove persisted file handle:', error);
        });
    }

    /**
     * Open a .md file from disk via the native picker. Resolves to
     * { handle, name, text } on success, or null if the user cancelled the
     * picker (AbortError). Throws on any other failure. Returns null
     * immediately, without prompting, when the API is unsupported.
     *
     * Does not touch project storage or link() itself — the caller decides
     * what project (if any) this becomes. Kept exactly as #767 shipped it —
     * see pickAndLinkFile() below for the more general form #761's sync
     * targets use, which links immediately since their project already
     * exists at pick time.
     */
    async function pickAndReadFile() {
        if (!isSupported()) return null;
        let handles;
        try {
            handles = await window.showOpenFilePicker({
                id: 'noodleplanner-plan',
                types: [{
                    description: 'NoodlePlanner plan (Markdown)',
                    accept: { 'text/markdown': ['.md'] },
                }],
                excludeAcceptAllOption: false,
                multiple: false,
            });
        } catch (error) {
            if (error && error.name === 'AbortError') return null; // user cancelled
            throw error;
        }
        const handle = handles[0];
        const file = await handle.getFile();
        const text = await file.text();
        return { handle: handle, name: file.name, text: text };
    }

    /**
     * General-purpose picker for a sync target (RAID Excel, MS Project)
     * whose project already exists: opens the native picker with the given
     * `pickerOptions` (types/accept, as passed to showOpenFilePicker), reads
     * the file as text or an ArrayBuffer (`readAs: 'arraybuffer'`, needed
     * for binary .xlsx/.mpp), links the handle under `targetKey`, and
     * requests readwrite permission up front (in the same user gesture as
     * the picker call) since a sync target is read now and, typically,
     * written back to shortly after — asking once here avoids a second
     * permission prompt firing later from outside a gesture, which would
     * either silently fail or (worse) not even show.
     *
     * Resolves to { handle, name, content } on success, or null if the user
     * cancelled the picker. Returns null immediately, without prompting,
     * when the API is unsupported.
     */
    async function pickAndLinkFile(projectId, targetKey, pickerOptions, readAs) {
        if (!isSupported()) return null;
        let handles;
        try {
            handles = await window.showOpenFilePicker(pickerOptions || {});
        } catch (error) {
            if (error && error.name === 'AbortError') return null;
            throw error;
        }
        const handle = handles[0];
        const file = await handle.getFile();
        const name = file.name;
        const content = readAs === 'arraybuffer' ? await file.arrayBuffer() : await file.text();

        link(projectId, handle, name, targetKey);

        // Ask for readwrite permission now, in the same gesture that
        // triggered the picker, rather than waiting for the write step
        // (which may happen after further awaits — e.g. a review dialog the
        // user has to interact with first — by which point transient
        // activation would be gone).
        try {
            await ensurePermission(handle, 'readwrite');
            clearNeedsRelink(projectId, targetKey);
        } catch (error) {
            // Not fatal: read access from showOpenFilePicker is already
            // granted, so the sync can still proceed read-only. Flag it so
            // the write-back step (or the UI) knows to ask again.
            markNeedsRelink(projectId, targetKey);
        }

        return { handle: handle, name: name, content: content };
    }

    /**
     * Query (never silently escalate to a prompt) the current permission
     * for a handle, upgrading it via requestPermission() only if the caller
     * is inside a user gesture — callers decide that by whether they call
     * this at all versus just checking needsRelinking(). Throws if
     * permission isn't (or can't be) granted.
     */
    async function ensurePermission(handle, mode) {
        if (typeof handle.queryPermission !== 'function') return true; // older/partial implementations
        let permission = await handle.queryPermission({ mode: mode });
        if (permission !== 'granted' && typeof handle.requestPermission === 'function') {
            permission = await handle.requestPermission({ mode: mode });
        }
        if (permission !== 'granted') {
            throw new Error('Permission (' + mode + ') was not granted');
        }
        return true;
    }

    /**
     * Ask for readwrite permission on an already-linked target. MUST be
     * called as the first awaited step of a real user-gesture handler (e.g.
     * a Sync button's click listener) — requestPermission() needs transient
     * user activation, which does not survive prior unrelated awaits.
     * Resolves true/false; never throws. Updates needsRelinking() either way.
     */
    async function requestWritePermission(projectId, targetKey) {
        targetKey = targetKey || DEFAULT_TARGET;
        const m = linkedFiles.get(projectId);
        const entry = m && m.get(targetKey);
        if (!entry || !entry.handle) return false;
        try {
            await ensurePermission(entry.handle, 'readwrite');
            clearNeedsRelink(projectId, targetKey);
            return true;
        } catch (error) {
            markNeedsRelink(projectId, targetKey);
            return false;
        }
    }

    /**
     * Re-read the current bytes/text of an already-linked target straight
     * from disk (no picker). `readAs: 'arraybuffer'` for binary files.
     * Resolves to { name, content }, or null when nothing is linked for
     * this project/target. A read failure (file moved/deleted) drops the
     * link entirely — unlike a permission failure, there's no handle left
     * worth keeping around, so the next sync needs a full re-pick.
     */
    async function readLinkedFile(projectId, targetKey, readAs) {
        targetKey = targetKey || DEFAULT_TARGET;
        const m = linkedFiles.get(projectId);
        const entry = m && m.get(targetKey);
        if (!entry) return null;
        try {
            const file = await entry.handle.getFile();
            const content = readAs === 'arraybuffer' ? await file.arrayBuffer() : await file.text();
            return { name: file.name, content: content };
        } catch (error) {
            if (error && error.name === 'NotAllowedError') {
                // Permission problem, not a missing/moved file — keep the
                // handle, just flag it.
                markNeedsRelink(projectId, targetKey);
            } else {
                unlink(projectId, targetKey);
            }
            throw error;
        }
    }

    /**
     * Write `content` (string or BufferSource) back to the target linked to
     * `projectId`/`targetKey` — no dialog, no mutation of the content.
     * Resolves to { ok: true, filename } on success. On failure, resolves
     * to { ok: false, error, filename, needsRelink } rather than throwing:
     * a revoked-permission failure keeps the handle and sets needsRelink so
     * a later click can recover with requestWritePermission() without the
     * user re-picking the file; any other failure (file moved/deleted) drops
     * the link, since there is nothing left worth retrying against.
     * Resolves to null when nothing is linked, so the caller knows to fall
     * back to a download/export instead of treating this as an error.
     */
    async function writeLinkedFile(projectId, targetKey, content) {
        targetKey = targetKey || DEFAULT_TARGET;
        const m = linkedFiles.get(projectId);
        const entry = m && m.get(targetKey);
        if (!entry) return null;
        try {
            await ensurePermission(entry.handle, 'readwrite');
            const writable = await entry.handle.createWritable();
            await writable.write(content);
            await writable.close();
            clearNeedsRelink(projectId, targetKey);
            return { ok: true, filename: entry.name };
        } catch (error) {
            if (error && error.name === 'NotAllowedError') {
                markNeedsRelink(projectId, targetKey);
            } else {
                unlink(projectId, targetKey);
            }
            return { ok: false, error: error, filename: entry.name, needsRelink: needsRelinking(projectId, targetKey) };
        }
    }

    /**
     * Write `content` back to the file linked to `projectId` under the
     * default ('plan') target — verbatim, no dialog. Kept exactly as #767
     * shipped it (drops the link on ANY failure, not just non-permission
     * ones) since the main plan file's Save button already has a
     * download-fallback path that doesn't distinguish failure kinds; #761's
     * sync targets use the more nuanced writeLinkedFile() above instead.
     */
    async function saveToLinkedFile(projectId, content) {
        const m = linkedFiles.get(projectId);
        const entry = m && m.get(DEFAULT_TARGET);
        if (!entry) return null;
        try {
            await ensurePermission(entry.handle, 'readwrite');
            const writable = await entry.handle.createWritable();
            await writable.write(content);
            await writable.close();
            return { ok: true, filename: entry.name };
        } catch (error) {
            unlink(projectId, DEFAULT_TARGET);
            return { ok: false, error: error, filename: entry.name };
        }
    }

    // -------------------------------------------------------------------
    // IndexedDB persistence — handles are structured-cloneable in
    // Chromium/Edge, so a link survives a reload. Firefox/Safari never get
    // here (isSupported() is false, callers never call link()).
    // -------------------------------------------------------------------

    const DB_NAME = 'noodleplanner-file-links';
    const DB_VERSION = 1;
    const STORE_NAME = 'handles';

    let dbPromise = null;

    function idbFactory() {
        return typeof indexedDB !== 'undefined' ? indexedDB : null;
    }

    function recordId(projectId, targetKey) {
        return projectId + '::' + targetKey;
    }

    function openDb() {
        const factory = idbFactory();
        if (!factory) return Promise.resolve(null);
        if (dbPromise) return dbPromise;
        dbPromise = new Promise(function (resolve) {
            let request;
            try {
                request = factory.open(DB_NAME, DB_VERSION);
            } catch (error) {
                console.warn('Failed to open file-link IndexedDB:', error);
                resolve(null);
                return;
            }
            request.onupgradeneeded = function () {
                const db = request.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                }
            };
            request.onsuccess = function () { resolve(request.result); };
            request.onerror = function () {
                console.warn('Failed to open file-link IndexedDB:', request.error);
                resolve(null);
            };
        });
        return dbPromise;
    }

    async function persistHandle(projectId, targetKey, handle, name) {
        const db = await openDb();
        if (!db) return;
        return new Promise(function (resolve) {
            let tx;
            try {
                tx = db.transaction(STORE_NAME, 'readwrite');
            } catch (error) {
                resolve();
                return;
            }
            tx.objectStore(STORE_NAME).put({
                id: recordId(projectId, targetKey),
                projectId: projectId,
                targetKey: targetKey,
                handle: handle,
                name: name,
            });
            tx.oncomplete = function () { resolve(); };
            tx.onerror = function () {
                console.warn('Failed to persist linked file handle:', tx.error);
                resolve();
            };
        });
    }

    async function deletePersistedHandle(projectId, targetKey) {
        const db = await openDb();
        if (!db) return;
        return new Promise(function (resolve) {
            let tx;
            try {
                tx = db.transaction(STORE_NAME, 'readwrite');
            } catch (error) {
                resolve();
                return;
            }
            const store = tx.objectStore(STORE_NAME);
            if (targetKey) {
                store.delete(recordId(projectId, targetKey));
            } else {
                // Purge every target for this project. There's no index on
                // projectId (the store is expected to hold a handful of
                // records per project at most), so a cursor scan is fine.
                const cursorReq = store.openCursor();
                cursorReq.onsuccess = function () {
                    const cursor = cursorReq.result;
                    if (!cursor) return;
                    if (cursor.value.projectId === projectId) cursor.delete();
                    cursor.continue();
                };
            }
            tx.oncomplete = function () { resolve(); };
            tx.onerror = function () { resolve(); };
        });
    }

    /**
     * Restore every persisted handle for `projectId` into the in-memory
     * map, and check (never request) each one's current readwrite
     * permission. Safe to call more than once. Resolves to an array of
     * { targetKey, name, granted } for callers that want to react
     * immediately (e.g. a status message); most callers just re-render from
     * getLinkStatus() afterward instead.
     */
    async function restoreLinks(projectId) {
        const db = await openDb();
        if (!db || !projectId) return [];

        const records = await new Promise(function (resolve) {
            let tx;
            try {
                tx = db.transaction(STORE_NAME, 'readonly');
            } catch (error) {
                resolve([]);
                return;
            }
            const req = tx.objectStore(STORE_NAME).openCursor();
            const out = [];
            req.onsuccess = function () {
                const cursor = req.result;
                if (!cursor) { resolve(out); return; }
                if (cursor.value.projectId === projectId) out.push(cursor.value);
                cursor.continue();
            };
            req.onerror = function () { resolve(out); };
        });

        const restored = [];
        for (const record of records) {
            targetsFor(projectId, true).set(record.targetKey, { handle: record.handle, name: record.name });
            let granted = false;
            try {
                if (record.handle && typeof record.handle.queryPermission === 'function') {
                    granted = (await record.handle.queryPermission({ mode: 'readwrite' })) === 'granted';
                }
            } catch (error) {
                granted = false;
            }
            if (granted) clearNeedsRelink(projectId, record.targetKey);
            else markNeedsRelink(projectId, record.targetKey);
            restored.push({ targetKey: record.targetKey, name: record.name, granted: granted });
        }
        return restored;
    }

    /** restoreLinks(), but memoized per projectId for the page session. */
    async function ensureRestored(projectId) {
        if (!projectId || restoredProjects.has(projectId)) return;
        restoredProjects.add(projectId);
        await restoreLinks(projectId);
    }

    const api = {
        isSupported: isSupported,
        isLinked: isLinked,
        getLinkedFileName: getLinkedFileName,
        needsRelinking: needsRelinking,
        getLinkStatus: getLinkStatus,
        link: link,
        unlink: unlink,
        pickAndReadFile: pickAndReadFile,
        pickAndLinkFile: pickAndLinkFile,
        requestWritePermission: requestWritePermission,
        readLinkedFile: readLinkedFile,
        writeLinkedFile: writeLinkedFile,
        saveToLinkedFile: saveToLinkedFile,
        restoreLinks: restoreLinks,
        ensureRestored: ensureRestored,
    };

    root.LocalFileAccess = api;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
