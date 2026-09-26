/**
 * collab-undo.js -- undo and redo for a planning-session joiner.
 *
 * The app's own undo (editor-undo.js) keeps whole-plan snapshots and puts
 * the previous one back. That is wrong for a collaborator: between their
 * edit and their Ctrl+Z, the host and other joiners may have changed the
 * board too, and restoring a snapshot would silently throw their work away.
 *
 * So this history is *selective*: it records each of the joiner's own edits
 * as a `{before, after}` pair and undoes one by rebasing its inverse onto
 * whatever the plan is now, with collab-merge.js's three-way merge --
 * `merge3(after, before, current)`. Other people's changes, made before or
 * after, stay put. Redo is the same merge the other way round. When
 * someone has since changed the same lines, the merge reports a conflict,
 * the step is dropped (it can never apply cleanly again), and the caller
 * says why nothing happened.
 *
 * A classic script exposing `NoodleCollabUndo`, and a CommonJS module for
 * tests/test_collab_undo.mjs.
 */
(function (global) {
    'use strict';

    const DEFAULT_LIMIT = 100;

    function resolveMerge3(merge3) {
        if (typeof merge3 === 'function') return merge3;
        if (global.NoodleCollabMerge && typeof global.NoodleCollabMerge.merge3 === 'function') {
            return global.NoodleCollabMerge.merge3;
        }
        if (typeof require === 'function') return require('./collab-merge.js').merge3;
        throw new Error('collab-undo: collab-merge.js must be loaded first');
    }

    /**
     * A joiner's undo/redo history.
     *
     * `undo(current)` and `redo(current)` return:
     *   null                    nothing to undo / redo;
     *   { text }                the plan with the step reversed / reapplied
     *                           (may equal `current` when someone else already
     *                           made the same change);
     *   { conflict: true }      someone changed the same lines since; the
     *                           step has been dropped.
     */
    function createHistory(options) {
        const opts = options || {};
        const limit = opts.limit > 0 ? opts.limit : DEFAULT_LIMIT;
        const merge3 = resolveMerge3(opts.merge3);
        let undoStack = [];
        let redoStack = [];

        /** Record one of the joiner's own edits. A new edit ends the redo
         * trail, as in every editor. */
        function record(before, after) {
            if (before === after) return;
            undoStack.push({ before, after });
            if (undoStack.length > limit) undoStack.shift();
            redoStack = [];
        }

        /** Move the top step of `from` onto `to`, applying it to `current`
         * as the change `entry[base]` -> `entry[target]`. */
        function step(from, to, current, base, target) {
            const entry = from.pop();
            if (!entry) return null;
            const merged = merge3(entry[base], entry[target], current);
            if (merged === null) return { conflict: true };
            to.push(entry);
            return { text: merged };
        }

        return {
            record,
            undo: (current) => step(undoStack, redoStack, current, 'after', 'before'),
            redo: (current) => step(redoStack, undoStack, current, 'before', 'after'),
            canUndo: () => undoStack.length > 0,
            canRedo: () => redoStack.length > 0,
            clear() { undoStack = []; redoStack = []; },
        };
    }

    const api = { createHistory };
    global.NoodleCollabUndo = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
