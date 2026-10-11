/**
 * account-sync.js -- keep this browser's plans in step with the signed-in
 * account's plans on the server (accounts.py / accounts_routes.py).
 *
 * The browser store stays the working copy. Sync only moves plan *text and
 * name* to and from /api/v1/plans; version history, file links and the other
 * per-browser fields stay where they are. Signed out, or with sync off,
 * nothing here touches the store.
 *
 * How a run works (see runOnce): each local plan is linked to a server plan,
 * and the link remembers the revision and text last seen in agreement. From
 * that, per plan:
 *
 *   only this browser changed   -> push (PUT with the remembered revision)
 *   only the server changed     -> pull
 *   both changed                -> conflict: the server copy wins the plan,
 *                                  and this browser's text is kept as a new
 *                                  plan "<name> (conflict <date>)", so nothing
 *                                  anyone typed is lost
 *   no link yet                 -> upload as a new server plan
 *   server plan with no link    -> download as a new local plan
 *   linked plan deleted here    -> delete it on the server
 *   linked plan gone from server-> delete it here, if untouched and not open
 *
 * `sync` is created by createSync() with its collaborators passed in (fetch,
 * the store adapter, storage), which is how tests/test_account_sync.mjs runs
 * it without a browser. The page gets one built from the real globals.
 */
(function (root) {
    'use strict';

    const STATE_KEY = 'np-sync-state';
    const POLL_MS = 30000;
    const NAME_MAX = 200;
    const DEFAULT_NAME = 'Untitled Project';

    function normName(name) {
        return String(name || '').trim().slice(0, NAME_MAX) || DEFAULT_NAME;
    }

    /**
     * `text` without the front-matter `last_saved:` line. The editor's 30 s
     * autosave rewrites that timestamp (to the minute) in whichever browser has
     * the plan open, whether or not anything was typed; counting it as an edit
     * would make two open browsers push the same plan back and forth forever.
     */
    function meaningful(text) {
        const t = String(text || '');
        const fm = t.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
        if (!fm) return t;
        const body = fm[2].replace(/(?:^|\r?\n)last_saved:[^\r\n]*/, '');
        return fm[1] + body + fm[3] + t.slice(fm[0].length);
    }

    function sameText(a, b) {
        return meaningful(a) === meaningful(b);
    }

    function emptyState() {
        return { userId: '', enabled: false, links: {}, lastSync: 0 };
    }

    /**
     * @param {object} deps
     * @param {function} deps.fetch        window.fetch-compatible
     * @param {object}   deps.store        adapter: list(), create(name, text) -> id,
     *                                     update(id, {name, planText}), remove(id),
     *                                     currentId(), flush(), reloadCurrent(id), editorText() (optional)
     * @param {object}   deps.storage      localStorage-like (may throw)
     * @param {function} [deps.now]
     * @param {function} [deps.ready]     resolves when the store can be read
     * @param {function} [deps.onChanged] called after a run that changed anything
     */
    function createSync(deps) {
        const fetchFn = deps.fetch;
        const store = deps.store;
        const now = deps.now || (() => Date.now());
        const listeners = new Set();

        let state = readState();
        let status = { kind: 'idle', user: null, error: '', summary: null };
        let running = false;
        let rerun = false;
        let timer = null;

        // ---- persistence ---------------------------------------------------

        function readState() {
            try {
                const raw = deps.storage.getItem(STATE_KEY);
                const parsed = raw ? JSON.parse(raw) : null;
                if (parsed && typeof parsed === 'object') {
                    return Object.assign(emptyState(), parsed, { links: parsed.links || {} });
                }
            } catch (e) { /* storage blocked or corrupt: start clean */ }
            return emptyState();
        }

        function writeState() {
            try { deps.storage.setItem(STATE_KEY, JSON.stringify(state)); } catch (e) { /* best effort */ }
        }

        function setStatus(patch) {
            status = Object.assign({}, status, patch);
            listeners.forEach((fn) => { try { fn(getStatus()); } catch (e) { /* a listener must not break sync */ } });
        }

        function getStatus() {
            return Object.assign({}, status, {
                enabled: !!state.enabled,
                lastSync: state.lastSync || 0,
                linked: Object.keys(state.links).length,
            });
        }

        // ---- server --------------------------------------------------------

        async function api(method, path, body) {
            const init = { method, credentials: 'same-origin', headers: {} };
            if (body !== undefined) {
                init.headers['Content-Type'] = 'application/json';
                init.body = JSON.stringify(body);
            }
            const res = await fetchFn(path, init);
            let data = null;
            if (res.status !== 204) {
                try { data = await res.json(); } catch (e) { data = null; }
            }
            return { status: res.status, data };
        }

        function describe(res) {
            const detail = res.data && res.data.detail;
            return typeof detail === 'string' ? detail : 'HTTP ' + res.status;
        }

        function link(localId, plan, name) {
            state.links[localId] = {
                serverId: plan.id,
                revision: plan.revision,
                text: plan.content,
                name: normName(name !== undefined ? name : plan.name),
            };
        }

        // ---- the run -------------------------------------------------------

        async function currentUser() {
            // /session answers 200 either way, so a signed-out page load
            // leaves no 401 in the console.
            const res = await api('GET', '/api/v1/session');
            if (res.status === 200) return res.data.user;
            throw new Error(describe(res));
        }

        function conflictName(name) {
            const d = new Date(now());
            const day = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
            return normName(name).slice(0, NAME_MAX - 24) + ' (conflict ' + day + ')';
        }

        /** Pull the server's copy into local plan `localId`. */
        function adopt(localId, serverPlan, summary) {
            store.update(localId, { name: serverPlan.name, planText: serverPlan.content });
            link(localId, serverPlan);
            if (store.currentId() === localId) summary.reloadCurrent = true;
            summary.pulled++;
        }

        /** Both sides changed. Keep both: server copy in place, local text as a new plan. */
        async function resolveConflict(localId, localPlan, serverPlan, summary) {
            if (sameText(serverPlan.content, localPlan.planText) && normName(serverPlan.name) === normName(localPlan.name)) {
                link(localId, serverPlan, localPlan.name);   // same edit made twice: nothing to keep
                return;
            }
            store.create(conflictName(localPlan.name), localPlan.planText);
            adopt(localId, serverPlan, summary);
            summary.pulled--;                                // counted as a conflict, not a pull
            summary.conflicts++;
        }

        async function push(localId, localPlan, summary) {
            const lnk = state.links[localId];
            const res = await api('PUT', '/api/v1/plans/' + encodeURIComponent(lnk.serverId), {
                base_revision: lnk.revision,
                name: normName(localPlan.name),
                content: localPlan.planText,
            });
            if (res.status === 200) {
                link(localId, res.data, localPlan.name);
                summary.pushed++;
            } else if (res.status === 409 && res.data && res.data.current) {
                await resolveConflict(localId, localPlan, res.data.current, summary);
            } else if (res.status === 404) {
                delete state.links[localId];                 // vanished meanwhile: re-uploaded below
            } else {
                summary.errors.push(normName(localPlan.name) + ': ' + describe(res));
            }
        }

        async function upload(localPlan, summary) {
            const res = await api('POST', '/api/v1/plans', {
                name: normName(localPlan.name),
                content: localPlan.planText,
            });
            if (res.status === 201) {
                link(localPlan.id, res.data, localPlan.name);
                summary.created++;
            } else {
                summary.errors.push(normName(localPlan.name) + ': ' + describe(res));
            }
        }

        async function download(serverId, summary) {
            const res = await api('GET', '/api/v1/plans/' + encodeURIComponent(serverId));
            if (res.status !== 200) {
                summary.errors.push('Could not download a plan: ' + describe(res));
                return;
            }
            const id = store.create(res.data.name, res.data.content);
            link(id, res.data);
            summary.downloaded++;
        }

        /** True when the open editor holds text the store does not (yet). */
        function typedSince(localPlan) {
            const text = typeof store.editorText === 'function' ? store.editorText() : null;
            return text !== null && text !== undefined && !sameText(text, localPlan.planText);
        }

        async function runOnce() {
            const summary = {
                pushed: 0, pulled: 0, created: 0, downloaded: 0, deleted: 0,
                removedLocal: 0, conflicts: 0, errors: [], reloadCurrent: false,
            };

            // The store hydrates from IndexedDB asynchronously; until it has,
            // "no local plans" would look like "all of them were deleted".
            if (typeof deps.ready === 'function') await deps.ready();

            const user = await currentUser();
            if (!user) {
                setStatus({ kind: 'signed-out', user: null, error: '' });
                return;
            }
            if (state.userId && state.userId !== user.id) {
                // A different account on this browser: never push its plans
                // into someone else's, and never carry links across.
                state = Object.assign(emptyState(), { userId: user.id });
                writeState();
            }
            state.userId = user.id;
            if (!state.enabled) {
                writeState();
                setStatus({ kind: 'off', user, error: '' });
                return;
            }

            setStatus({ kind: 'syncing', user, error: '' });
            store.flush();

            const listing = await api('GET', '/api/v1/plans');
            if (listing.status === 401) { setStatus({ kind: 'signed-out', user: null }); return; }
            if (listing.status !== 200) throw new Error(describe(listing));
            const serverById = new Map(listing.data.plans.map((p) => [p.id, p]));

            const localById = new Map(store.list().map((p) => [p.id, p]));

            // 1. Plans already linked.
            for (const localId of Object.keys(state.links)) {
                const lnk = state.links[localId];
                const localPlan = localById.get(localId);
                const serverSummary = serverById.get(lnk.serverId);
                try {
                    if (!localPlan) {                         // deleted here
                        if (serverSummary) {
                            const del = await api('DELETE', '/api/v1/plans/' + encodeURIComponent(lnk.serverId));
                            if (del.status !== 204 && del.status !== 404) {
                                summary.errors.push('Could not delete a plan on the server: ' + describe(del));
                                continue;
                            }
                        }
                        delete state.links[localId];
                        summary.deleted++;
                        continue;
                    }
                    if (!serverSummary) {                     // gone from the server
                        const untouched = sameText(localPlan.planText, lnk.text) && normName(localPlan.name) === lnk.name;
                        // An empty listing is more likely a reset database than
                        // someone deleting every plan: never wipe local copies on it.
                        if (untouched && serverById.size > 0 && store.currentId() !== localId) {
                            store.remove(localId);
                            localById.delete(localId);
                            summary.removedLocal++;
                        }
                        delete state.links[localId];          // otherwise it re-uploads below
                        continue;
                    }
                    const localChanged = !sameText(localPlan.planText, lnk.text) || normName(localPlan.name) !== lnk.name;
                    const serverChanged = serverSummary.revision !== lnk.revision;
                    if (localChanged && !serverChanged) {
                        await push(localId, localPlan, summary);
                    } else if (serverChanged) {
                        const got = await api('GET', '/api/v1/plans/' + encodeURIComponent(lnk.serverId));
                        if (got.status !== 200) {
                            summary.errors.push(normName(localPlan.name) + ': ' + describe(got));
                        } else if (store.currentId() === localId && typedSince(localPlan)) {
                            // Typing landed while this was in flight; the next
                            // run sees both sides changed and keeps both.
                            continue;
                        } else if (localChanged) {
                            await resolveConflict(localId, localPlan, got.data, summary);
                        } else {
                            adopt(localId, got.data, summary);
                        }
                    }
                } catch (e) {
                    summary.errors.push(normName(localPlan && localPlan.name) + ': ' + e.message);
                }
            }

            // 2. Local plans with no link: upload. (Re-list: step 1 may have made conflict copies.)
            const linkedServerIds = new Set(Object.values(state.links).map((l) => l.serverId));
            for (const localPlan of store.list()) {
                if (state.links[localPlan.id]) continue;
                await upload(localPlan, summary);
                if (state.links[localPlan.id]) linkedServerIds.add(state.links[localPlan.id].serverId);
            }

            // 3. Server plans no local plan is linked to: download.
            for (const serverId of serverById.keys()) {
                if (!linkedServerIds.has(serverId)) await download(serverId, summary);
            }

            state.lastSync = now();
            writeState();
            if (summary.reloadCurrent) store.reloadCurrent(store.currentId());
            setStatus({
                kind: summary.errors.length ? 'error' : 'ok',
                user,
                error: summary.errors.join('\n'),
                summary,
            });
            if (summary.pushed + summary.pulled + summary.created + summary.downloaded +
                summary.deleted + summary.removedLocal + summary.conflicts > 0 && typeof deps.onChanged === 'function') {
                deps.onChanged(summary);
            }
        }

        /** Run a sync now. Overlapping calls collapse into one follow-up run. */
        async function sync() {
            if (running) { rerun = true; return; }
            running = true;
            try {
                do {
                    rerun = false;
                    try {
                        await runOnce();
                    } catch (e) {
                        writeState();
                        setStatus({ kind: 'error', error: e && e.message ? e.message : String(e) });
                    }
                } while (rerun);
            } finally {
                running = false;
            }
        }

        // ---- controls --------------------------------------------------------

        async function enable() {
            state.enabled = true;
            writeState();
            schedule();
            await sync();
        }

        /** Stop syncing. Plans in this browser and on the server are left as they are. */
        function disable() {
            state.enabled = false;
            state.links = {};
            writeState();
            schedule();
            setStatus({ kind: 'off', error: '', summary: null });
        }

        function schedule() {
            const g = root.setInterval ? root : null;
            if (timer && g) { root.clearInterval(timer); timer = null; }
            if (state.enabled && g) timer = root.setInterval(() => { sync(); }, POLL_MS);
        }

        function subscribe(fn) {
            listeners.add(fn);
            return () => listeners.delete(fn);
        }

        return { sync, enable, disable, schedule, subscribe, getStatus, STATE_KEY };
    }

    // ---- the page --------------------------------------------------------------

    /** The store adapter over project-storage.js's global functions. */
    function browserStore() {
        return {
            list() {
                return Object.values(root.getAllProjects()).map((p) => ({
                    id: p.id, name: p.name, planText: p.planText || '',
                }));
            },
            create(name, text) { return root.createProject(name, text).id; },
            update(id, fields) { root.saveProject(id, fields); },
            remove(id) { root.deleteProject(id); },
            currentId() { return root.getCurrentProjectId(); },
            editorText() {
                const el = root.document.getElementById('planEditor');
                return el ? el.value : null;
            },
            flush() {
                if (typeof root.saveCurrentProjectState === 'function') root.saveCurrentProjectState();
            },
            reloadCurrent(id) {
                if (id && typeof root.loadProjectIntoEditor === 'function') root.loadProjectIntoEditor(id);
            },
        };
    }

    const api = { createSync, normName, meaningful, STATE_KEY };

    if (root.document && typeof root.getAllProjects === 'function') {
        let storage = null;
        try { storage = root.localStorage; } catch (e) { /* blocked */ }
        const instance = createSync({
            fetch: root.fetch.bind(root),
            store: browserStore(),
            storage: storage || { getItem() { return null; }, setItem() {} },
            ready() {
                return (root.NoodleStore && typeof root.NoodleStore.whenReady === 'function')
                    ? root.NoodleStore.whenReady() : Promise.resolve();
            },
            onChanged() {
                root.document.dispatchEvent(new root.CustomEvent('np-projects-synced'));
            },
        });
        api.instance = instance;
        const go = () => {
            instance.schedule();
            instance.sync();                                  // also reports signed-in / signed-out
            root.addEventListener('focus', () => { instance.sync(); });
            root.addEventListener('online', () => { instance.sync(); });
        };
        if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', go);
        else go();
    }

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.NoodleSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
