/**
 * highlight-toggles.js — per-category syntax highlight toggles (#1051).
 *
 * The editor's syntax highlighting is a read-only HTML overlay
 * (editor.js's #highlightLayer / #kanbanHighlightLayer) sitting behind a
 * transparent-text textarea -- see .editor-textarea/.editor-highlight-layer
 * in style.css. This module never touches that overlay's HTML or the
 * textarea's text: it only adds/removes a body-level class that CSS keys
 * off to recolour a category's .syntax-* spans back to the plain text
 * colour. Toggling a category off therefore can never alter the
 * underlying text, its length, or caret position -- the caret-drift bug
 * class this issue calls out (#744-#750) is specifically about *rewriting*
 * the overlay HTML, which this never does.
 *
 * Preferences are a per-browser view preference, like ribbon density
 * (#955) -- persisted in localStorage, never written into plan text or
 * front matter.
 */
(function (root) {
    const STORAGE_KEY = 'noodleplanner:highlight-toggles';

    // Bumped to 2 by #1278. Before that fix the DADESRC wizard applied a
    // stage preset through applyPreset(), which *persists* -- so merely
    // opening the wizard (it always starts on Design, whose preset is
    // everything-off) permanently wrote an all-off state to this key and
    // the editor's resources/dates/dependencies stayed plain text long
    // after the wizard was closed. A stored payload without this version
    // marker is that legacy state and is discarded rather than migrated:
    // there is no way to tell a genuine user preference apart from the
    // wizard's side effect, and "highlighting on" is the default the
    // module has always documented.
    const STORAGE_VERSION = 2;

    const CATEGORIES = ['duration', 'resource', 'tag', 'comment', 'dependency'];

    // Stage presets (#783's DADESRC) a caller -- today the ribbon's own
    // Preset menu, later the D3 stage wizard shell (#1054) -- can apply by
    // name. 'plain' is the "no highlighting" mode the issue requires.
    const PRESETS = {
        all: { duration: true, resource: true, tag: true, comment: true, dependency: true },
        plain: { duration: false, resource: false, tag: false, comment: false, dependency: false },
        'add-tasks': { duration: false, resource: false, tag: false, comment: false, dependency: false },
        dependencies: { duration: false, resource: false, tag: false, comment: false, dependency: true },
        estimating: { duration: true, resource: false, tag: false, comment: false, dependency: false },
        // The remaining DADESRC stages (#1054): Design has no task-line
        // editor visible yet (Backstage), so it's the same as 'plain'.
        // Scheduling cares about both what drives dates (duration) and
        // what drives sequencing (dependency). Risks and Comms both host a
        // separate list view, not the task-line editor, so 'plain' too.
        design: { duration: false, resource: false, tag: false, comment: false, dependency: false },
        scheduling: { duration: true, resource: false, tag: false, comment: false, dependency: true },
        risks: { duration: false, resource: false, tag: false, comment: false, dependency: false },
        comms: { duration: false, resource: false, tag: false, comment: false, dependency: false },
    };

    function defaultState() {
        return { ...PRESETS.all };
    }

    function load() {
        try {
            const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem(STORAGE_KEY) : null;
            if (!raw) return defaultState();
            const parsed = JSON.parse(raw);
            if (!parsed || parsed.v !== STORAGE_VERSION) return defaultState();
            const state = defaultState();
            for (const key of CATEGORIES) if (typeof parsed[key] === 'boolean') state[key] = parsed[key];
            return state;
        } catch (error) {
            return defaultState();
        }
    }

    let state = load();

    // A transient, never-persisted preset applied *over* the user's own
    // state -- see applyOverride(). Null whenever no caller is overriding.
    let override = null;

    function effectiveState() { return override || state; }

    function save() {
        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, v: STORAGE_VERSION }));
            }
        } catch (error) {
            // Private mode / quota exceeded -- state just won't persist.
        }
    }

    function applyToDom() {
        const body = (typeof document !== 'undefined') ? document.body : null;
        if (!body) return;
        const active = effectiveState();
        for (const key of CATEGORIES) {
            body.classList.toggle('hl-off-' + key, !active[key]);
        }
    }

    function isOn(category) { return !!state[category]; }

    function setCategory(category, on) {
        if (CATEGORIES.indexOf(category) === -1) return;
        // An explicit user toggle is the user speaking: it ends any
        // transient override rather than being silently masked by it.
        override = null;
        state[category] = !!on;
        save();
        applyToDom();
    }

    function toggleCategory(category) {
        setCategory(category, !isOn(category));
    }

    function applyPreset(name) {
        const preset = PRESETS[name];
        if (!preset) return false;
        override = null;
        state = { ...preset };
        save();
        applyToDom();
        return true;
    }

    function getState() { return { ...state }; }

    /**
     * Apply a preset for as long as some mode is active, without touching
     * the user's saved preference (#1278). The DADESRC wizard uses this:
     * its stage presets are a temporary lens over the editor, so closing
     * the wizard (clearOverride()) must restore whatever highlighting the
     * user had before it opened. getState()/isOn() keep reporting the
     * user's own state so the ribbon's checkmarks stay truthful.
     */
    function applyOverride(name) {
        const preset = PRESETS[name];
        if (!preset) return false;
        override = { ...preset };
        applyToDom();
        return true;
    }

    function clearOverride() {
        if (!override) return;
        override = null;
        applyToDom();
    }

    function getEffectiveState() { return { ...effectiveState() }; }

    applyToDom();

    const api = {
        CATEGORIES, PRESETS, isOn, setCategory, toggleCategory, applyPreset, getState,
        applyOverride, clearOverride, getEffectiveState,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.HighlightToggles = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
