/**
 * collab-autosave.js -- host-side crash recovery for #968 (part of the #766
 * collab-sessions epic).
 *
 * #967's host-authoritative editor (collab-session.js's applyCollabPlanOp)
 * applies every joiner op straight to `#planEditor`'s in-memory value, but
 * nothing commits that value to storage until the next real save: either an
 * explicit one, or the general 30 s project autosave (startAutoSave() in
 * portfolio.js, via project-storage.js's saveCurrentProjectState()). A host
 * whose browser dies inside that window loses whatever joiners contributed
 * since the last real save, silently.
 *
 * This module writes a short-lived recovery snapshot -- separate from the
 * project's own record, so an interrupted session can be offered as
 * "recover or discard" on the next load rather than being merged into the
 * real project before the user has any say in it (see
 * shouldOfferCollabRecovery below). It is debounced after every applied op
 * by collab-session.js's scheduleCollabAutosave(), which is the only
 * caller with access to the live plan text and session id.
 *
 * Storage follows the same convention as portfolio-dependencies.js's
 * DEPS_META_KEY: NoodleStore's `meta` object store when the IndexedDB
 * project store is active (project-store.js), a dedicated localStorage key
 * otherwise. No server-side storage is involved -- see
 * collab_session.py's "the relay stores nothing" design; this is entirely
 * host-browser-local.
 *
 * Joiner-only, deliberately: the epic keeps joiner/client state ephemeral
 * (collab_join.html is untouched by this), and the host's own typing
 * already goes through the app's existing editor-autosave paths -- this
 * only needs to cover what #967 doesn't: an incoming op applied to the
 * host's buffer.
 */

const COLLAB_AUTOSAVE_META_KEY = 'collabHostAutosave';
const COLLAB_AUTOSAVE_LOCAL_KEY = 'noodleplanner_collab_autosave';

/** How long to let applied ops coalesce before writing a snapshot.
 * collab-session.js's scheduleCollabPlanBroadcast debounces the far
 * cheaper joiner broadcast at 250 ms; a storage write is heavier (and, on
 * the localStorage fallback, synchronous), so this is longer -- long
 * enough that a burst of several joiners' edits lands in one write, short
 * enough that a crash loses at most a few seconds of the very thing this
 * module exists to protect, well inside the general 30 s project
 * autosave's own window (see the module docstring). */
export const COLLAB_AUTOSAVE_DEBOUNCE_MS = 2000;

/** Build the record written for one snapshot. `rev` is collab-ops.js's
 * revision counter, carried along for diagnostics only -- recovery itself
 * only cares about `planText`. */
export function buildCollabAutosaveRecord(projectId, sessionId, planText, rev, now = Date.now()) {
    return { projectId, sessionId, rev, planText, savedAt: now };
}

/**
 * Pure recovery decision: is `snapshot` worth offering to recover, given
 * the project it would apply to?
 *
 * A snapshot only exists at all when a session ended without being
 * cleared -- clearCollabAutosave() below runs on the host's own explicit
 * "end session" and on every real save of the project (see
 * collab-session.js's clearCollabAutosaveForProject and its callers) -- so
 * presence already means "interrupted", and a clean end (or a save that
 * already caught up) removes it before this is ever asked. The planText
 * comparison additionally covers the case where the general 30 s autosave
 * happened to save this exact content before the crash: recovering would
 * be a no-op, so there is nothing worth asking the host about.
 */
export function shouldOfferCollabRecovery(snapshot, project) {
    if (!snapshot || typeof snapshot !== 'object') return false;
    if (!project || typeof project !== 'object') return false;
    if (typeof snapshot.planText !== 'string' || !snapshot.planText) return false;
    if (snapshot.projectId !== project.id) return false;
    if (snapshot.planText === project.planText) return false;
    return true;
}

function metaStoreActive() {
    return typeof globalThis.projectStoreActive === 'function' && globalThis.projectStoreActive();
}

/** Read the current snapshot, or null when there is none. */
export function readCollabAutosave() {
    if (metaStoreActive()) {
        const record = globalThis.NoodleStore.getMeta(COLLAB_AUTOSAVE_META_KEY);
        return record || null;
    }
    try {
        const raw = globalThis.localStorage.getItem(COLLAB_AUTOSAVE_LOCAL_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        return null;
    }
}

/** Write (overwrite) the current snapshot. */
export function writeCollabAutosave(record) {
    if (metaStoreActive()) {
        globalThis.NoodleStore.setMeta(COLLAB_AUTOSAVE_META_KEY, record);
        return;
    }
    try {
        globalThis.localStorage.setItem(COLLAB_AUTOSAVE_LOCAL_KEY, JSON.stringify(record));
    } catch (error) {
        console.error('Could not write collab autosave snapshot:', error);
    }
}

/** Drop the snapshot unconditionally -- a clean session end. */
export function clearCollabAutosave() {
    if (metaStoreActive()) {
        globalThis.NoodleStore.deleteMeta(COLLAB_AUTOSAVE_META_KEY);
        return;
    }
    try {
        globalThis.localStorage.removeItem(COLLAB_AUTOSAVE_LOCAL_KEY);
    } catch (error) {
        // Ignore -- nothing to clean up if the browser won't let us.
    }
}

/** Drop the snapshot only when it belongs to `projectId` -- a save or a
 * session end for some other project must not disturb a still-pending
 * recovery snapshot for this one. */
export function clearCollabAutosaveIfCurrent(projectId) {
    const snapshot = readCollabAutosave();
    if (snapshot && snapshot.projectId === projectId) clearCollabAutosave();
}
