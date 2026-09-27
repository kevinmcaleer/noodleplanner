/**
 * layout-mode.js -- one notion of "what kind of screen is this" (#1379,
 * epic #1376).
 *
 * Before this, CSS media queries were the only switches in the app and no JS
 * asked what kind of device it was running on. The mobile work changes
 * *behaviour*, not just layout -- the ribbon becomes an app bar on a phone
 * (#1380), the markdown editor becomes its own view (#1381), forms open full
 * screen (#1383) -- and every one of those needs the same answer. This file
 * is that answer, so the breakpoints are written down once.
 *
 * ## The rule
 *
 * `document.documentElement.dataset.layout` is one of:
 *
 *   phone    width under 768px. iPad mini in portrait (744px) lands here,
 *            deliberately: a 744px column is a phone layout with room to spare,
 *            not a small desktop.
 *   tablet   768px to 1024px inclusive. iPad Air/Pro in portrait (820/834px)
 *            and a 1024px landscape tablet land here.
 *   desktop  anything wider.
 *
 * These are #572's standard breakpoints, the same ones responsive.css uses,
 * so CSS and JS agree about where the edges are. If epic decision D5 picks
 * different numbers, QUERIES below is the only thing that changes.
 *
 * CSS keeps doing pure layout with media queries. *Behaviour* keys off
 * `[data-layout]`, which is what lets the user override it.
 *
 * `dataset.pointer` is `coarse` or `fine` alongside it, from
 * `(pointer: coarse)`, for the few behaviours that care about touch rather
 * than width (a touch tablet defaults the ribbon to its compact mode, #1388).
 *
 * ## The override
 *
 * Settings -> Layout offers Auto / Phone / Tablet / Desktop, so someone on an
 * iPad with a keyboard can choose the desktop layout. It is kept per browser
 * in localStorage under `np-layout`, the way the ribbon's display mode is,
 * and never written into plan text: it is a fact about this screen, not about
 * the plan.
 *
 * ## The event
 *
 * `layoutchange` is raised on `document` whenever the effective layout
 * changes, from a resize, a rotation or the override, with
 * `detail: { layout, previous, override }`. It is not raised for a change
 * that leaves the layout where it was, so a listener can do real work.
 *
 * ## Loading
 *
 * A classic script loaded in <head>, before any stylesheet that keys off
 * `[data-layout]` is applied to a rendered body, so the first paint already
 * has the right layout rather than flashing the desktop one. It needs no
 * other file. The resolving half needs no DOM, so tests/test_layout_mode.mjs
 * runs it in plain node with a stub matchMedia.
 */
(function (root) {
    'use strict';

    const STORAGE_KEY = 'np-layout';
    const CHANGE_EVENT = 'layoutchange';

    const LAYOUTS = ['phone', 'tablet', 'desktop'];
    const OVERRIDES = ['auto'].concat(LAYOUTS);

    // Phone is "under 768", written as a max-width a hair below it so that a
    // 767.5px-wide window (a zoomed desktop browser) is still a phone and
    // 768 exactly is a tablet.
    const QUERIES = {
        phone: '(max-width: 767.98px)',
        tablet: '(min-width: 768px) and (max-width: 1024px)',
        coarse: '(pointer: coarse)',
    };

    let memoryOverride = 'auto';
    let current = null;
    let currentPointer = null;
    const queries = {};

    function mql(query) {
        if (!queries[query]) {
            try {
                queries[query] = typeof root.matchMedia === 'function' ? root.matchMedia(query) : null;
            } catch (_) {
                queries[query] = null;
            }
        }
        return queries[query];
    }

    function matches(query) {
        const list = mql(query);
        return !!(list && list.matches);
    }

    /** The layout the screen implies, ignoring the override. */
    function detect() {
        if (matches(QUERIES.phone)) return 'phone';
        if (matches(QUERIES.tablet)) return 'tablet';
        return 'desktop';
    }

    function normaliseOverride(value) {
        return OVERRIDES.indexOf(value) === -1 ? 'auto' : value;
    }

    // Storage can be missing or throw (a private window, blocked site data),
    // so the choice is also held in memory and lasts until the page closes.
    function getOverride() {
        try {
            const stored = root.localStorage && root.localStorage.getItem(STORAGE_KEY);
            if (stored != null) return normaliseOverride(stored);
        } catch (_) { /* fall through to memory */ }
        return memoryOverride;
    }

    function resolve(override) {
        const choice = normaliseOverride(override);
        return choice === 'auto' ? detect() : choice;
    }

    function get() {
        return current || resolve(getOverride());
    }

    function pointer() {
        return matches(QUERIES.coarse) ? 'coarse' : 'fine';
    }

    function apply() {
        const override = getOverride();
        const next = resolve(override);
        const nextPointer = pointer();
        const previous = current;
        current = next;
        currentPointer = nextPointer;

        const doc = root.document;
        const el = doc && doc.documentElement;
        if (el) {
            el.dataset.layout = next;
            el.dataset.pointer = nextPointer;
        }
        if (previous !== null && previous !== next && doc && typeof doc.dispatchEvent === 'function') {
            let event;
            const detail = { layout: next, previous: previous, override: override };
            try {
                event = new root.CustomEvent(CHANGE_EVENT, { detail: detail });
            } catch (_) {
                event = null;
            }
            if (event) doc.dispatchEvent(event);
        }
        return next;
    }

    function setOverride(value) {
        const choice = normaliseOverride(value);
        memoryOverride = choice;
        try {
            if (root.localStorage) {
                if (choice === 'auto') root.localStorage.removeItem(STORAGE_KEY);
                else root.localStorage.setItem(STORAGE_KEY, choice);
            }
        } catch (_) { /* memory still holds it */ }
        return apply();
    }

    /** Subscribe to layout changes; returns an unsubscribe function. */
    function onChange(handler) {
        const doc = root.document;
        if (!doc || typeof handler !== 'function') return function () {};
        const listener = function (event) { handler(event.detail); };
        doc.addEventListener(CHANGE_EVENT, listener);
        return function () { doc.removeEventListener(CHANGE_EVENT, listener); };
    }

    function watch() {
        [QUERIES.phone, QUERIES.tablet, QUERIES.coarse].forEach(function (query) {
            const list = mql(query);
            if (!list) return;
            if (typeof list.addEventListener === 'function') list.addEventListener('change', apply);
            else if (typeof list.addListener === 'function') list.addListener(apply);
        });
        // Another tab changing the override applies here too.
        if (typeof root.addEventListener === 'function') {
            root.addEventListener('storage', function (event) {
                if (event && event.key === STORAGE_KEY) apply();
            });
        }
    }

    const api = {
        STORAGE_KEY: STORAGE_KEY,
        CHANGE_EVENT: CHANGE_EVENT,
        LAYOUTS: LAYOUTS.slice(),
        OVERRIDES: OVERRIDES.slice(),
        QUERIES: Object.assign({}, QUERIES),
        detect: detect,
        get: get,
        getOverride: getOverride,
        setOverride: setOverride,
        pointer: function () { return currentPointer || pointer(); },
        isPhone: function () { return get() === 'phone'; },
        isTablet: function () { return get() === 'tablet'; },
        isDesktop: function () { return get() === 'desktop'; },
        isTouch: function () { return (currentPointer || pointer()) === 'coarse'; },
        onChange: onChange,
        apply: apply,
    };

    root.NoodleLayout = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;

    apply();
    watch();
})(typeof globalThis !== 'undefined' ? globalThis : this);
