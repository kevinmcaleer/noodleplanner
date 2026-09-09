/**
 * Proof for #968's host-side crash recovery (static/collab-autosave.js),
 * part of the #766 collab-sessions epic.
 *
 * The acceptance criteria are behavioural claims about the host's browser
 * storage, not about collab-session.js's DOM/WebSocket glue (which calls
 * these functions but isn't itself unit-testable without a browser) -- so
 * these tests exercise the storage functions and the pure recovery
 * decision directly, the same way test_collab_ops.mjs exercises
 * collab-ops.js rather than collab-session.js:
 *
 *  - an auto-save is written after an op is applied (writeCollabAutosave /
 *    readCollabAutosave round-trip, on both storage backends)
 *  - the recovery-detection logic tells a stale/interrupted session from a
 *    cleanly-ended one (shouldOfferCollabRecovery)
 *  - the auto-save snapshot is cleared on clean session end
 *    (clearCollabAutosave / clearCollabAutosaveIfCurrent)
 *
 * Run with: node --test tests/test_collab_autosave.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const {
    COLLAB_AUTOSAVE_DEBOUNCE_MS,
    buildCollabAutosaveRecord,
    shouldOfferCollabRecovery,
    readCollabAutosave,
    writeCollabAutosave,
    clearCollabAutosave,
    clearCollabAutosaveIfCurrent,
} = await import('../packages/noodle-web/src/noodle_web/static/collab-autosave.js');

/** A minimal localStorage stand-in -- Node has no global `localStorage`,
 * so the module's fallback path needs one to read/write against. */
function fakeLocalStorage() {
    const store = new Map();
    return {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => { store.set(k, String(v)); },
        removeItem: (k) => { store.delete(k); },
    };
}

/** A minimal NoodleStore stand-in for the IndexedDB-active path -- just
 * enough of getMeta/setMeta/deleteMeta to exercise the same code path
 * portfolio-dependencies.js's DEPS_META_KEY already uses. */
function fakeNoodleStore() {
    const meta = new Map();
    return {
        isActive: () => true,
        getMeta: (key) => meta.get(key),
        setMeta: (key, value) => meta.set(key, value),
        deleteMeta: (key) => meta.delete(key),
    };
}

function useLocalStorageBackend() {
    globalThis.projectStoreActive = () => false;
    globalThis.localStorage = fakeLocalStorage();
}

function useNoodleStoreBackend() {
    globalThis.NoodleStore = fakeNoodleStore();
    globalThis.projectStoreActive = () => true;
}

test('buildCollabAutosaveRecord carries the project, session, plan text and revision', () => {
    const record = buildCollabAutosaveRecord('proj-1', 'sess-1', 'Phase 1\n  Task 50%\n', 3, 12345);
    assert.deepEqual(record, {
        projectId: 'proj-1', sessionId: 'sess-1', planText: 'Phase 1\n  Task 50%\n', rev: 3, savedAt: 12345,
    });
});

// -- write is written after an op is applied (round-trip) ------------------

test('a snapshot written to the localStorage fallback reads back unchanged', () => {
    useLocalStorageBackend();
    clearCollabAutosave();
    assert.equal(readCollabAutosave(), null, 'nothing written yet');

    const record = buildCollabAutosaveRecord('proj-1', 'sess-1', 'Phase 1\n  Task 75%\n', 1, 1000);
    writeCollabAutosave(record);

    assert.deepEqual(readCollabAutosave(), record);
});

test('a snapshot written to NoodleStore reads back unchanged', () => {
    useNoodleStoreBackend();
    clearCollabAutosave();
    assert.equal(readCollabAutosave(), null, 'nothing written yet');

    const record = buildCollabAutosaveRecord('proj-1', 'sess-1', 'Phase 1\n  Task 75%\n', 1, 1000);
    writeCollabAutosave(record);

    assert.deepEqual(readCollabAutosave(), record);
    // The IndexedDB-active path is preferred over localStorage when both
    // are present, same as portfolio-dependencies.js's getAllProgrammeDependencies.
    assert.equal(globalThis.NoodleStore.getMeta('collabHostAutosave'), record);
});

test('a later write overwrites the earlier snapshot rather than accumulating', () => {
    useLocalStorageBackend();
    writeCollabAutosave(buildCollabAutosaveRecord('proj-1', 'sess-1', 'first', 1, 1000));
    writeCollabAutosave(buildCollabAutosaveRecord('proj-1', 'sess-1', 'second', 2, 2000));
    assert.equal(readCollabAutosave().planText, 'second');
});

// -- recovery detection: stale/interrupted vs. cleanly-ended ----------------

test('a lingering snapshot with content the project does not have is offered for recovery', () => {
    const snapshot = buildCollabAutosaveRecord('proj-1', 'sess-1', 'Phase 1\n  Task 90%\n', 4, 5000);
    const project = { id: 'proj-1', planText: 'Phase 1\n  Task 50%\n' };
    assert.equal(shouldOfferCollabRecovery(snapshot, project), true);
});

test('no snapshot (a cleanly-ended session already cleared it) is never offered', () => {
    const project = { id: 'proj-1', planText: 'Phase 1\n  Task 50%\n' };
    assert.equal(shouldOfferCollabRecovery(null, project), false);
    assert.equal(shouldOfferCollabRecovery(undefined, project), false);
});

test('a snapshot whose content the project already has is not offered', () => {
    // The general 30 s project autosave (or an explicit save) already
    // caught up before the crash -- recovering would be a no-op.
    const text = 'Phase 1\n  Task 90%\n';
    const snapshot = buildCollabAutosaveRecord('proj-1', 'sess-1', text, 4, 5000);
    const project = { id: 'proj-1', planText: text };
    assert.equal(shouldOfferCollabRecovery(snapshot, project), false);
});

test('a snapshot for a different project is never offered against this one', () => {
    const snapshot = buildCollabAutosaveRecord('proj-other', 'sess-1', 'Phase 1\n  Task 90%\n', 4, 5000);
    const project = { id: 'proj-1', planText: 'Phase 1\n  Task 50%\n' };
    assert.equal(shouldOfferCollabRecovery(snapshot, project), false);
});

test('a malformed or empty snapshot is never offered', () => {
    const project = { id: 'proj-1', planText: 'anything' };
    assert.equal(shouldOfferCollabRecovery({ projectId: 'proj-1' }, project), false, 'no planText at all');
    assert.equal(shouldOfferCollabRecovery({ projectId: 'proj-1', planText: '' }, project), false, 'empty planText');
    assert.equal(shouldOfferCollabRecovery('not an object', project), false);
    assert.equal(shouldOfferCollabRecovery(buildCollabAutosaveRecord('proj-1', 's', 'x', 1), null), false, 'no project');
});

// -- clearing on clean session end ------------------------------------------

test('clearCollabAutosave removes the snapshot outright', () => {
    useLocalStorageBackend();
    writeCollabAutosave(buildCollabAutosaveRecord('proj-1', 'sess-1', 'Phase 1', 1, 1000));
    assert.notEqual(readCollabAutosave(), null);

    clearCollabAutosave();
    assert.equal(readCollabAutosave(), null);
});

test('clearCollabAutosaveIfCurrent only clears a snapshot that belongs to that project', () => {
    useLocalStorageBackend();
    writeCollabAutosave(buildCollabAutosaveRecord('proj-1', 'sess-1', 'Phase 1', 1, 1000));

    // A save/end for an unrelated project must not disturb it.
    clearCollabAutosaveIfCurrent('proj-other');
    assert.notEqual(readCollabAutosave(), null, 'snapshot for proj-1 survives an unrelated project clearing');

    // A save/end for the project the snapshot actually belongs to clears it.
    clearCollabAutosaveIfCurrent('proj-1');
    assert.equal(readCollabAutosave(), null);
});

test('clearing on the NoodleStore backend behaves the same way', () => {
    useNoodleStoreBackend();
    writeCollabAutosave(buildCollabAutosaveRecord('proj-1', 'sess-1', 'Phase 1', 1, 1000));
    clearCollabAutosaveIfCurrent('proj-other');
    assert.notEqual(readCollabAutosave(), null);
    clearCollabAutosaveIfCurrent('proj-1');
    assert.equal(readCollabAutosave(), null);
});

// -- debounce cadence --------------------------------------------------------

test('the autosave debounce is coarser than the joiner-broadcast debounce, and well inside the general 30 s autosave', () => {
    // collab-session.js's scheduleCollabPlanBroadcast debounces at 250 ms;
    // portfolio.js's startAutoSave runs every 30000 ms. This module's
    // debounce sits strictly between the two -- see its module docstring.
    assert.ok(COLLAB_AUTOSAVE_DEBOUNCE_MS > 250);
    assert.ok(COLLAB_AUTOSAVE_DEBOUNCE_MS < 30000);
});
