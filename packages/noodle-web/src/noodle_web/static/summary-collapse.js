/**
 * summary-collapse.js -- which summary tasks are collapsed, per project
 * (#1384, epic #1376).
 *
 * The Gantt's disclosure triangles kept their state in `collapsedSummaryTasks`,
 * a Set in state.js keyed by display id: in memory only, so every reload
 * opened every summary again, and keyed by a number that shifts whenever a
 * task is inserted above. The phone's Plan list (plan-list.js) needs the same
 * state for its cards, and a summary collapsed on one should be collapsed on
 * the other. This is the one store both read.
 *
 * It is view state, not plan data -- how *this* person is looking at the plan
 * -- so it lives in localStorage, scoped to the project the way the
 * whiteboard's outline panel scopes its own (whiteboard-outline.js), and never
 * reaches the markdown.
 *
 * ## What is stored
 *
 * A map of lower-cased task name to `true` (collapsed) or `false` (expanded
 * on purpose), under `noodleplanner:collapsed-summaries:<projectId>`. A name
 * the map does not hold falls back to the caller's default, because the two
 * surfaces default differently: the Gantt opens every summary, and the Plan
 * list opens with its cards closed -- "the high-level tasks first". Storing
 * both answers is what lets either surface's choice carry to the other.
 *
 * Names rather than ids, like the outline panel: a name survives an insert
 * above it, which a display id does not. Renaming a summary forgets its state.
 *
 * A change dispatches `summarycollapsechange` on document, detail
 * `{ name, collapsed }`.
 *
 * A classic script exposing `NoodleSummaryCollapse`, loaded after
 * project-storage.js (for getCurrentProjectId()). tests/test_plan_list.mjs
 * runs it in plain node.
 */
(function (root) {
    'use strict';

    const STORAGE_PREFIX = 'noodleplanner:collapsed-summaries:';

    let loadedFor = null;
    let states = new Map();

    function projectId() {
        const id = typeof getCurrentProjectId === 'function' ? getCurrentProjectId() : null;
        return id || 'default';
    }

    function keyOf(name) {
        return String(name == null ? '' : name).trim().toLowerCase();
    }

    function storage() {
        try {
            return root.localStorage || null;
        } catch (_) {
            return null;
        }
    }

    function load() {
        const id = projectId();
        if (loadedFor === id) return;
        loadedFor = id;
        states = new Map();
        const store = storage();
        if (!store) return;
        try {
            const parsed = JSON.parse(store.getItem(STORAGE_PREFIX + id) || '{}');
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                for (const [name, value] of Object.entries(parsed)) {
                    if (typeof value === 'boolean') states.set(keyOf(name), value);
                }
            }
        } catch (_) {
            // Unreadable state: start from the defaults.
        }
    }

    function save() {
        const store = storage();
        if (!store) return;
        try {
            store.setItem(STORAGE_PREFIX + loadedFor, JSON.stringify(Object.fromEntries(states)));
        } catch (_) {
            // Storage full or unavailable: the state lasts for the page.
        }
    }

    /** true, false, or undefined when this project has no answer for `name`. */
    function get(name) {
        load();
        return states.get(keyOf(name));
    }

    /** Whether `name` is collapsed, `fallback` when nothing is stored. */
    function isCollapsed(name, fallback) {
        const value = get(name);
        return typeof value === 'boolean' ? value : !!fallback;
    }

    function set(name, collapsed) {
        load();
        const key = keyOf(name);
        if (!key) return;
        const value = !!collapsed;
        if (states.get(key) === value) return;
        states.set(key, value);
        save();
        if (typeof document !== 'undefined' && typeof CustomEvent === 'function') {
            document.dispatchEvent(new CustomEvent('summarycollapsechange', {
                detail: { name: String(name), collapsed: value },
            }));
        }
    }

    /** Flip `name` from what it shows now (`fallback` if unset); returns the new state. */
    function toggle(name, fallback) {
        const next = !isCollapsed(name, fallback);
        set(name, next);
        return next;
    }

    root.NoodleSummaryCollapse = { STORAGE_PREFIX, get, isCollapsed, set, toggle };
})(typeof globalThis !== 'undefined' ? globalThis : this);
