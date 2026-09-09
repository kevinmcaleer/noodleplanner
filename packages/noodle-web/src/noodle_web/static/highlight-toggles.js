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
    };

    function defaultState() {
        return { ...PRESETS.all };
    }

    function load() {
        try {
            const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem(STORAGE_KEY) : null;
            if (!raw) return defaultState();
            const parsed = JSON.parse(raw);
            const state = defaultState();
            for (const key of CATEGORIES) if (typeof parsed[key] === 'boolean') state[key] = parsed[key];
            return state;
        } catch (error) {
            return defaultState();
        }
    }

    let state = load();

    function save() {
        try {
            if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (error) {
            // Private mode / quota exceeded -- state just won't persist.
        }
    }

    function applyToDom() {
        const body = (typeof document !== 'undefined') ? document.body : null;
        if (!body) return;
        for (const key of CATEGORIES) {
            body.classList.toggle('hl-off-' + key, !state[key]);
        }
    }

    function isOn(category) { return !!state[category]; }

    function setCategory(category, on) {
        if (CATEGORIES.indexOf(category) === -1) return;
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
        state = { ...preset };
        save();
        applyToDom();
        return true;
    }

    function getState() { return { ...state }; }

    applyToDom();

    const api = { CATEGORIES, PRESETS, isOn, setCategory, toggleCategory, applyPreset, getState };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.HighlightToggles = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
