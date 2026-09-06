/**
 * project-store.js — the browser-local project store (issue #794).
 *
 * Projects, version-history snapshots and portfolio metadata live in an
 * IndexedDB database, one record each, instead of one JSON blob in
 * localStorage. Saving one project touches one record; the ~5 MB
 * localStorage quota no longer applies; writes are asynchronous.
 *
 * The rest of the app still talks to storage through synchronous functions
 * (getAllProjects, saveProject, getVersionHistory, ...), so the store keeps a
 * complete in-memory copy of every record and writes through to IndexedDB in
 * the background: a change marks the record dirty and a short debounce
 * coalesces the dirty records into one transaction. Reads never wait on the
 * database; writes never block typing.
 *
 * The store holds plan text verbatim. Markdown is the canonical form of a
 * plan (docs/reference/plan-format.rst); nothing here parses or rewrites it.
 *
 * Object stores:
 *   projects  keyPath id         {id, name, planText, createdAt, updatedAt, ...}
 *   versions  keyPath key        {key, projectId, version, date, planText, rag}
 *   history   keyPath projectId  {projectId, order: [key, ...]}  newest first
 *   meta      keyPath key        {key, value}   programme deps, migration marker
 *
 * When IndexedDB is unavailable NoodleStore.isActive() is false and the
 * callers in project-storage.js / version-history.js / portfolio-dependencies.js
 * fall back to their original localStorage code.
 *
 * Loaded before project-storage.js. Exposes window.NoodleStore (the app's
 * store) and NoodleStore.createStore for tests.
 */
(function (root) {
    'use strict';

    const DB_NAME = 'noodleplanner';
    const DB_VERSION = 1;
    const FLUSH_DELAY_MS = 250;
    const RETRY_DELAY_MS = 10000;
    const STORE_NAMES = ['projects', 'versions', 'history', 'meta'];
    const KEY_PATHS = { projects: 'id', versions: 'key', history: 'projectId', meta: 'key' };

    const EXPORT_FORMAT = 'noodleplanner-store';
    const EXPORT_FORMAT_VERSION = 1;

    // Legacy localStorage keys (project-storage.js, version-history.js,
    // portfolio-dependencies.js before #794). Read by the migration, and
    // removed only by cleanupLegacyStorage() at the user's request.
    const LEGACY_PROJECTS_KEY = 'noodleplanner_projects';
    const LEGACY_HISTORY_PREFIX = 'noodle_history_';
    const LEGACY_DEPS_KEY = 'noodleplanner_programme_deps';

    const MIGRATION_META_KEY = 'migration';
    const DEPS_META_KEY = 'programmeDependencies';

    let keyCounter = 0;

    function shallowEqual(a, b) {
        if (a === b) return true;
        if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
        const ka = Object.keys(a);
        const kb = Object.keys(b);
        if (ka.length !== kb.length) return false;
        for (let i = 0; i < ka.length; i++) {
            const k = ka[i];
            if (!Object.prototype.hasOwnProperty.call(b, k) || a[k] !== b[k]) return false;
        }
        return true;
    }

    function sameSnapshot(fp, entry) {
        return !!fp && fp.version === entry.version && fp.date === entry.date &&
            fp.rag === entry.rag && fp.planText === entry.planText;
    }

    function fingerprint(entry) {
        return { version: entry.version, date: entry.date, rag: entry.rag, planText: entry.planText };
    }

    function newVersionKey(projectId) {
        keyCounter = (keyCounter + 1) % 1679616; // 36^4
        return projectId + '::' + Date.now().toString(36) + '-' + keyCounter.toString(36) +
            '-' + Math.random().toString(36).slice(2, 6);
    }

    /**
     * Create a store. `options` is for tests and for the app's own instance:
     *   indexedDB     the IDBFactory to use (default: the global one)
     *   localStorage  where the legacy blob is read from (default: global)
     *   dbName        database name (default 'noodleplanner')
     *   flushDelayMs  debounce for background writes (default 250)
     *   onFailure(what, error) / onRecovered()  reporting hooks; default to
     *                 reportStorageFailure / clearStorageFailure when defined
     *   autoOpen      open immediately (default true)
     */
    function createStore(options) {
        options = options || {};
        const factory = options.indexedDB !== undefined ? options.indexedDB
            : (typeof indexedDB !== 'undefined' ? indexedDB : null);
        const legacy = options.localStorage !== undefined ? options.localStorage
            : (typeof localStorage !== 'undefined' ? localStorage : null);
        const dbName = options.dbName || DB_NAME;
        const flushDelay = options.flushDelayMs !== undefined ? options.flushDelayMs : FLUSH_DELAY_MS;

        const state = {
            db: null,
            ready: false,
            failed: !factory,
            failure: null,          // the error that made the store unusable, if any
            lastWriteError: null,   // the most recent flush failure, cleared on success
            projects: new Map(),    // id -> project
            versions: new Map(),    // projectId -> [entry, ...] newest first (entries carry .key)
            persisted: new Map(),   // projectId -> Map(key -> fingerprint) as last written
            persistedOrder: new Map(), // projectId -> order.join('\n') as last written
            meta: new Map(),        // key -> value
        };
        const dirty = { projects: new Map(), versions: new Map(), history: new Map(), meta: new Map() };
        const stats = {
            puts: 0, deletes: 0, flushes: 0, failedFlushes: 0,
            byStore: {
                projects: { puts: 0, deletes: 0 },
                versions: { puts: 0, deletes: 0 },
                history: { puts: 0, deletes: 0 },
                meta: { puts: 0, deletes: 0 },
            },
        };
        let flushTimer = null;
        let retryTimer = null;
        let inflight = null;
        let readyResolve;
        const readyPromise = new Promise(function (resolve) { readyResolve = resolve; });

        function isActive() { return !state.failed; }

        function reportFailure(what, error) {
            state.lastWriteError = error;
            if (typeof options.onFailure === 'function') return options.onFailure(what, error);
            if (typeof reportStorageFailure === 'function') return reportStorageFailure(what, error);
            console.error('Storage failure (' + what + '):', error);
        }

        function reportRecovered() {
            if (!state.lastWriteError) return;
            state.lastWriteError = null;
            if (typeof options.onRecovered === 'function') return options.onRecovered();
            if (typeof clearStorageFailure === 'function') return clearStorageFailure();
        }

        // ------------------------------------------------------------------
        // Dirty tracking and flushing
        // ------------------------------------------------------------------

        function mark(storeName, key, record) {
            dirty[storeName].set(key, record === undefined ? null : record);
            scheduleFlush();
        }

        function dirtyCount() {
            return dirty.projects.size + dirty.versions.size + dirty.history.size + dirty.meta.size;
        }

        function scheduleFlush() {
            if (state.failed || flushTimer) return;
            flushTimer = setTimeout(function () {
                flushTimer = null;
                flush();
            }, flushDelay);
        }

        /**
         * Write every dirty record in one transaction. Resolves true when the
         * transaction committed, false when there was nothing to write or the
         * write failed (after the failure has been reported). Never rejects.
         */
        function flush() {
            if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
            if (state.failed) return Promise.resolve(false);
            if (!state.ready) return readyPromise.then(flush);
            if (inflight) return inflight.then(flush);
            if (dirtyCount() === 0) return Promise.resolve(false);

            const batch = {};
            const storeNames = [];
            STORE_NAMES.forEach(function (name) {
                if (dirty[name].size === 0) return;
                batch[name] = dirty[name];
                dirty[name] = new Map();
                storeNames.push(name);
            });

            inflight = new Promise(function (resolve) {
                let tx;
                try {
                    tx = state.db.transaction(storeNames, 'readwrite');
                } catch (e) {
                    restore(batch);
                    reportFailure('your projects', e);
                    scheduleRetry();
                    resolve(false);
                    return;
                }
                let settled = false;
                function fail(error) {
                    if (settled) return;
                    settled = true;
                    stats.failedFlushes++;
                    restore(batch);
                    reportFailure('your projects', error || new Error('IndexedDB transaction aborted'));
                    scheduleRetry();
                    resolve(false);
                }
                tx.oncomplete = function () {
                    if (settled) return;
                    settled = true;
                    stats.flushes++;
                    reportRecovered();
                    resolve(true);
                };
                tx.onerror = function (ev) { fail((ev && ev.target && ev.target.error) || tx.error); };
                tx.onabort = function () { fail(tx.error); };
                try {
                    storeNames.forEach(function (name) {
                        const os = tx.objectStore(name);
                        batch[name].forEach(function (record, key) {
                            if (record === null) {
                                os.delete(key);
                                stats.deletes++;
                                stats.byStore[name].deletes++;
                            } else {
                                os.put(record);
                                stats.puts++;
                                stats.byStore[name].puts++;
                            }
                        });
                    });
                } catch (e) {
                    try { tx.abort(); } catch (e2) { /* already aborted */ }
                    fail(e);
                }
            }).then(function (ok) { inflight = null; return ok; });
            return inflight;
        }

        /** Put a failed batch back, without clobbering anything dirtied since. */
        function restore(batch) {
            Object.keys(batch).forEach(function (name) {
                batch[name].forEach(function (record, key) {
                    if (!dirty[name].has(key)) dirty[name].set(key, record);
                });
            });
        }

        function scheduleRetry() {
            if (retryTimer || state.failed) return;
            retryTimer = setTimeout(function () {
                retryTimer = null;
                if (dirtyCount() > 0) flush();
            }, RETRY_DELAY_MS);
        }

        // ------------------------------------------------------------------
        // Projects
        // ------------------------------------------------------------------

        function getProject(id) {
            const p = state.projects.get(id);
            return p ? Object.assign({}, p) : null;
        }

        function getAllProjects() {
            const out = {};
            state.projects.forEach(function (p, id) { out[id] = Object.assign({}, p); });
            return out;
        }

        function listProjects() {
            const out = [];
            state.projects.forEach(function (p) { out.push(Object.assign({}, p)); });
            return out;
        }

        function putProject(project) {
            if (!project || !project.id) throw new Error('putProject: project needs an id');
            const current = state.projects.get(project.id);
            if (current && shallowEqual(current, project)) return false;
            const copy = Object.assign({}, project);
            state.projects.set(project.id, copy);
            mark('projects', project.id, copy);
            return true;
        }

        function deleteProject(id) {
            const existed = state.projects.delete(id);
            if (existed || dirty.projects.has(id)) mark('projects', id, null);
            return existed;
        }

        /**
         * Make the set of stored projects equal to `map` (id -> project), the
         * shape saveAllProjects() has always taken. Only records that differ
         * are written; only ids that were present and are now missing are
         * deleted. Version history is not touched (deleteProject does that).
         */
        function replaceProjects(map) {
            map = map || {};
            let changed = 0;
            state.projects.forEach(function (_p, id) {
                if (!Object.prototype.hasOwnProperty.call(map, id)) {
                    deleteProject(id);
                    changed++;
                }
            });
            Object.keys(map).forEach(function (id) {
                let project = map[id];
                if (!project) return;
                if (project.id !== id) project = Object.assign({}, project, { id: id });
                if (putProject(project)) changed++;
            });
            return changed;
        }

        // ------------------------------------------------------------------
        // Version history
        // ------------------------------------------------------------------

        function getVersionHistory(projectId) {
            const entries = state.versions.get(projectId);
            return entries ? entries.map(function (e) { return Object.assign({}, e); }) : [];
        }

        function hasVersionHistory(projectId) {
            return state.versions.has(projectId);
        }

        /**
         * Store `entries` (newest first) as the project's history. Entries the
         * caller has not stored before are given a key; entries that are
         * unchanged since they were last written are not written again.
         */
        function setVersionHistory(projectId, entries) {
            entries = Array.isArray(entries) ? entries : [];
            const kept = [];
            const seen = new Set();
            let persisted = state.persisted.get(projectId);
            if (!persisted) { persisted = new Map(); state.persisted.set(projectId, persisted); }

            entries.forEach(function (entry) {
                if (!entry || typeof entry.planText !== 'string') return;
                let key = entry.key;
                if (!key || seen.has(key) || key.indexOf(projectId + '::') !== 0) key = newVersionKey(projectId);
                seen.add(key);
                const record = {
                    key: key,
                    projectId: projectId,
                    version: entry.version === undefined ? '' : entry.version,
                    date: entry.date === undefined ? '' : entry.date,
                    planText: entry.planText,
                    rag: entry.rag === undefined ? '' : entry.rag,
                };
                kept.push(record);
                if (!sameSnapshot(persisted.get(key), record)) {
                    persisted.set(key, fingerprint(record));
                    mark('versions', key, record);
                }
            });

            Array.from(persisted.keys()).forEach(function (key) {
                if (!seen.has(key)) {
                    persisted.delete(key);
                    mark('versions', key, null);
                }
            });

            if (kept.length === 0) {
                state.versions.delete(projectId);
                state.persisted.delete(projectId);
                if (state.persistedOrder.has(projectId) || dirty.history.has(projectId)) {
                    state.persistedOrder.delete(projectId);
                    mark('history', projectId, null);
                }
                return 0;
            }

            state.versions.set(projectId, kept);
            const order = kept.map(function (r) { return r.key; });
            const orderKey = order.join('\n');
            if (state.persistedOrder.get(projectId) !== orderKey) {
                state.persistedOrder.set(projectId, orderKey);
                mark('history', projectId, { projectId: projectId, order: order });
            }
            return kept.length;
        }

        function deleteVersionHistory(projectId) {
            return setVersionHistory(projectId, []);
        }

        // ------------------------------------------------------------------
        // Metadata
        // ------------------------------------------------------------------

        function getMeta(key) {
            return state.meta.has(key) ? state.meta.get(key) : undefined;
        }

        function setMeta(key, value) {
            state.meta.set(key, value);
            mark('meta', key, { key: key, value: value });
        }

        function deleteMeta(key) {
            const existed = state.meta.delete(key);
            if (existed || dirty.meta.has(key)) mark('meta', key, null);
            return existed;
        }

        // ------------------------------------------------------------------
        // Open and hydrate
        // ------------------------------------------------------------------

        function open() {
            if (state.failed) {
                state.ready = true;
                readyResolve(api);
                return readyPromise;
            }
            let request;
            try {
                request = factory.open(dbName, DB_VERSION);
            } catch (e) {
                giveUp(e);
                return readyPromise;
            }
            request.onupgradeneeded = function (ev) {
                const db = ev.target.result;
                STORE_NAMES.forEach(function (name) {
                    if (!db.objectStoreNames.contains(name)) {
                        const os = db.createObjectStore(name, { keyPath: KEY_PATHS[name] });
                        if (name === 'versions') os.createIndex('projectId', 'projectId', { unique: false });
                    }
                });
            };
            request.onerror = function () { giveUp(request.error || new Error('IndexedDB open failed')); };
            request.onblocked = function () { giveUp(new Error('IndexedDB open blocked by another tab')); };
            request.onsuccess = function () {
                state.db = request.result;
                state.db.onversionchange = function () { try { state.db.close(); } catch (e) { /* closing */ } };
                hydrate().then(function () {
                    try {
                        migrateFromLegacyStorage();
                    } catch (e) {
                        console.error('Migration from localStorage failed:', e);
                    }
                    state.ready = true;
                    readyResolve(api);
                    if (dirtyCount() > 0) flush();
                }, function (e) {
                    giveUp(e);
                });
            };
            return readyPromise;
        }

        function giveUp(error) {
            if (state.ready) return;
            state.failed = true;
            state.failure = error;
            state.ready = true;
            console.error('NoodleStore: IndexedDB unavailable, using localStorage:', error);
            readyResolve(api);
        }

        /** Read every record into memory. Records dirtied before now win. */
        function hydrate() {
            return new Promise(function (resolve, reject) {
                let tx;
                try {
                    tx = state.db.transaction(STORE_NAMES, 'readonly');
                } catch (e) { reject(e); return; }
                const rows = {};
                tx.onerror = function () { reject(tx.error); };
                tx.onabort = function () { reject(tx.error || new Error('hydrate aborted')); };
                tx.oncomplete = function () {
                    try {
                        merge(rows);
                        resolve();
                    } catch (e) { reject(e); }
                };
                STORE_NAMES.forEach(function (name) {
                    const req = tx.objectStore(name).getAll();
                    req.onsuccess = function () { rows[name] = req.result || []; };
                });
            });
        }

        function merge(rows) {
            (rows.projects || []).forEach(function (p) {
                if (!p || !p.id) return;
                if (state.projects.has(p.id) || dirty.projects.has(p.id)) return;
                state.projects.set(p.id, p);
            });
            (rows.meta || []).forEach(function (m) {
                if (!m || !m.key) return;
                if (state.meta.has(m.key) || dirty.meta.has(m.key)) return;
                state.meta.set(m.key, m.value);
            });
            const byProject = new Map();
            (rows.versions || []).forEach(function (r) {
                if (!r || !r.key || !r.projectId) return;
                if (!byProject.has(r.projectId)) byProject.set(r.projectId, new Map());
                byProject.get(r.projectId).set(r.key, r);
            });
            const orders = new Map();
            (rows.history || []).forEach(function (h) {
                if (h && h.projectId && Array.isArray(h.order)) orders.set(h.projectId, h.order);
            });
            byProject.forEach(function (records, projectId) {
                if (state.versions.has(projectId)) return; // written before hydration
                const ordered = [];
                const used = new Set();
                (orders.get(projectId) || []).forEach(function (key) {
                    const r = records.get(key);
                    if (r && !used.has(key)) { ordered.push(r); used.add(key); }
                });
                const stray = [];
                records.forEach(function (r, key) { if (!used.has(key)) stray.push(r); });
                stray.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
                const entries = ordered.concat(stray);
                state.versions.set(projectId, entries);
                const persisted = new Map();
                entries.forEach(function (r) { persisted.set(r.key, fingerprint(r)); });
                state.persisted.set(projectId, persisted);
                state.persistedOrder.set(projectId, entries.map(function (r) { return r.key; }).join('\n'));
            });
        }

        function close() {
            if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
            if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
            const pending = dirtyCount() > 0 ? flush() : Promise.resolve(false);
            return pending.then(function () {
                if (state.db) { try { state.db.close(); } catch (e) { /* closing */ } }
                state.db = null;
            });
        }

        // ------------------------------------------------------------------
        // Migration from the localStorage blob (issue #794 step 4)
        //
        // Runs once, on the first open after the store exists. Copies every
        // project, every history array and the programme dependencies into
        // the store and records what it did under meta.migration. The
        // localStorage keys are left exactly as they were; nothing is removed
        // until the user asks for it through cleanupLegacyStorage().
        // ------------------------------------------------------------------

        function readLegacyJSON(key, fallback) {
            if (!legacy) return fallback;
            let raw;
            try { raw = legacy.getItem(key); } catch (e) { return fallback; }
            if (!raw) return fallback;
            try { return JSON.parse(raw); } catch (e) { return fallback; }
        }

        function legacyHistoryKeys() {
            const keys = [];
            if (!legacy) return keys;
            try {
                for (let i = 0; i < legacy.length; i++) {
                    const k = legacy.key(i);
                    if (k && k.indexOf(LEGACY_HISTORY_PREFIX) === 0) keys.push(k);
                }
            } catch (e) { /* no localStorage */ }
            return keys;
        }

        /** What the old store still holds, or null when it holds nothing. */
        function legacyDataPresent() {
            const projects = readLegacyJSON(LEGACY_PROJECTS_KEY, null);
            const historyKeys = legacyHistoryKeys();
            const deps = readLegacyJSON(LEGACY_DEPS_KEY, null);
            const projectCount = projects && typeof projects === 'object' ? Object.keys(projects).length : 0;
            if (projectCount === 0 && historyKeys.length === 0 && !deps) return null;
            let snapshots = 0;
            let bytes = 0;
            historyKeys.forEach(function (k) {
                const arr = readLegacyJSON(k, []);
                if (Array.isArray(arr)) snapshots += arr.length;
            });
            try {
                [LEGACY_PROJECTS_KEY, LEGACY_DEPS_KEY].concat(historyKeys).forEach(function (k) {
                    const v = legacy.getItem(k);
                    if (v) bytes += v.length;
                });
            } catch (e) { /* ignore */ }
            return { projects: projectCount, historyKeys: historyKeys.length, snapshots: snapshots,
                dependencies: Array.isArray(deps) ? deps.length : 0, bytes: bytes };
        }

        function migrateFromLegacyStorage() {
            if (state.meta.has(MIGRATION_META_KEY)) return state.meta.get(MIGRATION_META_KEY);
            const summary = { status: 'done', at: new Date().toISOString(), source: legacy ? 'localStorage' : 'none',
                projects: 0, snapshots: 0, dependencies: 0, skippedProjects: 0 };
            const projects = readLegacyJSON(LEGACY_PROJECTS_KEY, {});
            if (projects && typeof projects === 'object') {
                Object.keys(projects).forEach(function (id) {
                    const p = projects[id];
                    if (!p || typeof p !== 'object') return;
                    if (state.projects.has(id)) { summary.skippedProjects++; return; }
                    putProject(Object.assign({}, p, { id: id }));
                    summary.projects++;
                });
            }
            legacyHistoryKeys().forEach(function (k) {
                const projectId = k.slice(LEGACY_HISTORY_PREFIX.length);
                if (!projectId || state.versions.has(projectId)) return;
                const arr = readLegacyJSON(k, []);
                if (!Array.isArray(arr) || arr.length === 0) return;
                summary.snapshots += setVersionHistory(projectId, arr.map(function (e) {
                    return { version: e.version, date: e.date, planText: e.planText, rag: e.rag };
                }));
            });
            const deps = readLegacyJSON(LEGACY_DEPS_KEY, null);
            if (Array.isArray(deps) && deps.length > 0 && getMeta(DEPS_META_KEY) === undefined) {
                setMeta(DEPS_META_KEY, deps);
                summary.dependencies = deps.length;
            }
            setMeta(MIGRATION_META_KEY, summary);
            return summary;
        }

        function migrationSummary() {
            return getMeta(MIGRATION_META_KEY) || null;
        }

        /**
         * Remove the pre-#794 localStorage copy. Only ever called from the
         * storage settings after the user confirms. Returns what was removed.
         */
        function cleanupLegacyStorage() {
            const before = legacyDataPresent();
            if (!legacy || !before) return before;
            const keys = [LEGACY_PROJECTS_KEY, LEGACY_DEPS_KEY].concat(legacyHistoryKeys());
            keys.forEach(function (k) { try { legacy.removeItem(k); } catch (e) { /* ignore */ } });
            const summary = Object.assign({}, migrationSummary() || {}, { cleanedAt: new Date().toISOString() });
            setMeta(MIGRATION_META_KEY, summary);
            return before;
        }

        // ------------------------------------------------------------------
        // Whole-store export and import (issue #794 step 6)
        // ------------------------------------------------------------------

        function exportSnapshot() {
            const versions = [];
            state.versions.forEach(function (entries, projectId) {
                versions.push({ projectId: projectId, entries: entries.map(function (e) {
                    return { key: e.key, version: e.version, date: e.date, planText: e.planText, rag: e.rag };
                }) });
            });
            const meta = {};
            state.meta.forEach(function (value, key) {
                if (key !== MIGRATION_META_KEY) meta[key] = value;
            });
            return {
                format: EXPORT_FORMAT,
                formatVersion: EXPORT_FORMAT_VERSION,
                exportedAt: new Date().toISOString(),
                projects: listProjects(),
                versions: versions,
                meta: meta,
            };
        }

        function isSnapshot(data) {
            return !!data && typeof data === 'object' && data.format === EXPORT_FORMAT && Array.isArray(data.projects);
        }

        /**
         * Load a snapshot made by exportSnapshot(). mode 'merge' (default) adds
         * projects this browser does not have and leaves the rest alone;
         * 'replace' empties the store first. Returns counts.
         */
        function importSnapshot(data, opts) {
            if (typeof data === 'string') data = JSON.parse(data);
            if (!isSnapshot(data)) throw new Error('Not a NoodlePlanner store backup');
            const mode = (opts && opts.mode) || 'merge';
            const result = { mode: mode, projects: 0, skipped: 0, snapshots: 0, dependencies: 0 };

            if (mode === 'replace') {
                Array.from(state.projects.keys()).forEach(deleteProject);
                Array.from(state.versions.keys()).forEach(deleteVersionHistory);
                Array.from(state.meta.keys()).forEach(function (k) {
                    if (k !== MIGRATION_META_KEY) deleteMeta(k);
                });
            }

            const imported = new Set();
            data.projects.forEach(function (p) {
                if (!p || !p.id || typeof p.planText !== 'string') { result.skipped++; return; }
                if (state.projects.has(p.id)) { result.skipped++; return; }
                putProject(p);
                imported.add(p.id);
                result.projects++;
            });
            (data.versions || []).forEach(function (v) {
                if (!v || !v.projectId || !Array.isArray(v.entries)) return;
                if (!imported.has(v.projectId) && (state.versions.has(v.projectId) || !state.projects.has(v.projectId))) return;
                result.snapshots += setVersionHistory(v.projectId, v.entries);
            });
            const meta = data.meta || {};
            Object.keys(meta).forEach(function (key) {
                if (key === MIGRATION_META_KEY) return;
                if (key === DEPS_META_KEY && mode === 'merge') {
                    const current = Array.isArray(getMeta(key)) ? getMeta(key) : [];
                    const ids = new Set(current.map(function (d) { return d && d.id; }));
                    const added = (Array.isArray(meta[key]) ? meta[key] : []).filter(function (d) {
                        return d && d.id && !ids.has(d.id);
                    });
                    if (added.length) setMeta(key, current.concat(added));
                    result.dependencies = added.length;
                    return;
                }
                if (mode === 'replace' || getMeta(key) === undefined) {
                    setMeta(key, meta[key]);
                    if (key === DEPS_META_KEY && Array.isArray(meta[key])) result.dependencies = meta[key].length;
                }
            });
            return result;
        }

        // ------------------------------------------------------------------
        // Sizing, for the storage settings panel
        // ------------------------------------------------------------------

        function usage() {
            let planBytes = 0;
            let snapshots = 0;
            let snapshotBytes = 0;
            state.projects.forEach(function (p) { planBytes += (p.planText || '').length; });
            state.versions.forEach(function (entries) {
                snapshots += entries.length;
                entries.forEach(function (e) { snapshotBytes += (e.planText || '').length; });
            });
            return { projects: state.projects.size, planBytes: planBytes, snapshots: snapshots,
                snapshotBytes: snapshotBytes, totalBytes: planBytes + snapshotBytes };
        }

        const api = {
            DB_NAME: dbName,
            EXPORT_FORMAT: EXPORT_FORMAT,
            LEGACY_PROJECTS_KEY: LEGACY_PROJECTS_KEY,
            LEGACY_HISTORY_PREFIX: LEGACY_HISTORY_PREFIX,
            LEGACY_DEPS_KEY: LEGACY_DEPS_KEY,
            DEPS_META_KEY: DEPS_META_KEY,
            stats: stats,
            isActive: isActive,
            isReady: function () { return state.ready; },
            whenReady: function () { return readyPromise; },
            failure: function () { return state.failure; },
            lastWriteError: function () { return state.lastWriteError; },
            open: open,
            close: close,
            flush: flush,
            dirtyCount: dirtyCount,
            getProject: getProject,
            getAllProjects: getAllProjects,
            listProjects: listProjects,
            putProject: putProject,
            deleteProject: deleteProject,
            replaceProjects: replaceProjects,
            getVersionHistory: getVersionHistory,
            hasVersionHistory: hasVersionHistory,
            setVersionHistory: setVersionHistory,
            deleteVersionHistory: deleteVersionHistory,
            getMeta: getMeta,
            setMeta: setMeta,
            deleteMeta: deleteMeta,
            legacyDataPresent: legacyDataPresent,
            migrationSummary: migrationSummary,
            cleanupLegacyStorage: cleanupLegacyStorage,
            exportSnapshot: exportSnapshot,
            isSnapshot: isSnapshot,
            importSnapshot: importSnapshot,
            usage: usage,
        };

        if (options.autoOpen !== false) open();
        return api;
    }

    const store = createStore();
    store.createStore = createStore;
    root.NoodleStore = store;

    // Get pending writes onto disk before the page goes away. A transaction
    // started here is committed by the browser even though the page unloads.
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('pagehide', function () { store.flush(); });
        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
            document.addEventListener('visibilitychange', function () {
                if (document.visibilityState === 'hidden') store.flush();
            });
        }
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { createStore: createStore, NoodleStore: store };
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
