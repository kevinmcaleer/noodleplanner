/**
 * ui-mode.js -- which interface the app shows: the classic ribbon, or the
 * table views shell.
 *
 * The table views shell (table-shell.js) replaces the ribbon's tabs with a
 * list of tables down the left -- Plan, RAID log, Budget, Resources ... --
 * and a row of view tabs for the table that is open. It is opt-in while it is
 * built out, so this file is the switch:
 *
 *   document.documentElement.dataset.ui   'classic' (the default) or 'tables'
 *
 * Like the layout override (layout-mode.js) it is a fact about this browser,
 * not about the plan, so it is kept in localStorage under `np-ui` and never
 * written into plan text. Settings -> Layout -> Interface sets it, and so
 * does opening the app with `?ui=tables` or `?ui=classic`, which is the link
 * to hand someone who wants to try it.
 *
 * `uimodechange` is raised on `document` when it changes, with
 * `detail: { mode, previous }`, and the shell follows it without a reload.
 *
 * A classic script loaded in <head>, straight after layout-mode.js, so the
 * first paint is already the right interface. The resolving half needs no
 * DOM; tests/test_ui_mode.mjs runs it in plain node.
 */
(function (root) {
    'use strict';

    const STORAGE_KEY = 'np-ui';
    const CHANGE_EVENT = 'uimodechange';
    const MODES = ['classic', 'tables'];

    let memory = 'classic';
    let current = null;

    function normalise(value) {
        return MODES.indexOf(value) === -1 ? 'classic' : value;
    }

    // Storage can be missing or throw (a private window, blocked site data),
    // so the choice is also held in memory until the page closes.
    function stored() {
        try {
            const value = root.localStorage && root.localStorage.getItem(STORAGE_KEY);
            if (value != null) return normalise(value);
        } catch (_) { /* fall through to memory */ }
        return memory;
    }

    function remember(mode) {
        memory = mode;
        try {
            if (root.localStorage) {
                if (mode === 'classic') root.localStorage.removeItem(STORAGE_KEY);
                else root.localStorage.setItem(STORAGE_KEY, mode);
            }
        } catch (_) { /* memory still holds it */ }
    }

    /** `?ui=tables` in a query string, or null when it names no mode. */
    function fromQuery(search) {
        const match = /[?&]ui=([^&#]*)/.exec(String(search || ''));
        if (!match) return null;
        const value = decodeURIComponent(match[1]);
        return MODES.indexOf(value) === -1 ? null : value;
    }

    function get() {
        return current || stored();
    }

    function apply() {
        const next = stored();
        const previous = current;
        current = next;
        const doc = root.document;
        const el = doc && doc.documentElement;
        if (el) el.dataset.ui = next;
        if (previous !== null && previous !== next && doc && typeof doc.dispatchEvent === 'function') {
            let event = null;
            try {
                event = new root.CustomEvent(CHANGE_EVENT, { detail: { mode: next, previous: previous } });
            } catch (_) { /* no CustomEvent: nothing to tell */ }
            if (event) doc.dispatchEvent(event);
        }
        return next;
    }

    function set(mode) {
        remember(normalise(mode));
        return apply();
    }

    const api = {
        STORAGE_KEY: STORAGE_KEY,
        CHANGE_EVENT: CHANGE_EVENT,
        MODES: MODES.slice(),
        get: get,
        set: set,
        apply: apply,
        fromQuery: fromQuery,
        isTables: function () { return get() === 'tables'; },
    };

    root.NoodleUiMode = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;

    const asked = fromQuery(root.location && root.location.search);
    if (asked) remember(asked);
    apply();

    // Another tab changing the interface applies here too.
    if (typeof root.addEventListener === 'function') {
        root.addEventListener('storage', function (event) {
            if (event && event.key === STORAGE_KEY) apply();
        });
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
