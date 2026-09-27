/**
 * editor-visibility.js -- where the markdown editor goes on each screen
 * (#1381, epic #1376).
 *
 * On a phone the editor stacked above every view at 40vh: 296px plus a 30px
 * splitter on a 390x844 screen, which with the ribbon left the view 43px. On a
 * portrait tablet it took 410px of 1024. And nothing remembered that someone
 * had collapsed it -- only its width was kept -- so it was back on every load.
 *
 * No view needs the editor on screen. Markdown is canonical and every view
 * writes through PlanModel into #planEditor.value, which works just as well
 * while the editor is hidden. So:
 *
 * - **Phone:** the editor never shows beside or above a view
 *   (phone-shell.css). It is its own full-screen "Markdown" view instead,
 *   registered here and reached from the drawer -- nothing is lost, and views
 *   get the whole screen.
 * - **Tablet portrait:** collapsed by default.
 * - **Tablet landscape and desktop:** the user's choice, as before.
 *
 * Collapsed or expanded is remembered per layout -- phone / tablet portrait /
 * tablet landscape / desktop -- the way the width already was, so a choice
 * made on an iPad does not change the desktop. It is a per-browser display
 * preference in localStorage (`noodleplanner:editor-collapsed`), never plan
 * text. Every way the editor collapses (the splitter arrow, the ribbon's
 * Editor button, the board's own editor handing its state back) goes through
 * the panel's `collapsed` class, so that is what is watched.
 *
 * Loaded after script.js, whose NavigationController and toggleMainEditor()
 * it uses, and after nav.js, whose initEditorSplitter() restores the width.
 */
(function () {
    'use strict';

    const PREF_KEY = 'noodleplanner:editor-collapsed';
    const DEFAULTS = { 'tablet-portrait': true };
    const portrait = window.matchMedia ? window.matchMedia('(orientation: portrait)') : null;

    let applying = false;

    function layout() {
        return document.documentElement.dataset.layout || 'desktop';
    }

    /** The key a collapse choice is remembered under. */
    function layoutKey() {
        const mode = layout();
        if (mode !== 'tablet') return mode;
        return portrait && portrait.matches ? 'tablet-portrait' : 'tablet-landscape';
    }

    function readPrefs() {
        try {
            const raw = localStorage.getItem(PREF_KEY);
            const parsed = raw ? JSON.parse(raw) : {};
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (_) {
            return {};
        }
    }

    function writePref(key, collapsed) {
        const prefs = readPrefs();
        prefs[key] = !!collapsed;
        try {
            localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
        } catch (_) { /* storage unavailable: the choice lasts for the page */ }
    }

    function panel() {
        return document.querySelector('.editor-panel');
    }

    function isCollapsed() {
        const el = panel();
        return !!(el && el.classList.contains('collapsed'));
    }

    /** Whether the editor should start collapsed on this screen. */
    function preferredCollapsed(key = layoutKey()) {
        const prefs = readPrefs();
        if (typeof prefs[key] === 'boolean') return prefs[key];
        return !!DEFAULTS[key];
    }

    /** Put the editor in the state this layout remembers. The phone is left
     * alone: CSS hides the editor there whatever its class, and leaving the
     * class untouched keeps the other layouts' state. */
    function applyForLayout() {
        const key = layoutKey();
        if (key === 'phone' || typeof toggleMainEditor !== 'function') return;
        if (preferredCollapsed(key) === isCollapsed()) return;
        applying = true;
        try {
            toggleMainEditor();
        } finally {
            applying = false;
        }
    }

    function watchPanel() {
        const el = panel();
        if (!el || typeof MutationObserver !== 'function') return;
        let was = isCollapsed();
        new MutationObserver(() => {
            const now = isCollapsed();
            if (now === was) return;
            was = now;
            if (applying || layout() === 'phone') return;
            writePref(layoutKey(), now);
        }).observe(el, { attributes: true, attributeFilter: ['class'] });
    }

    /** The phone's app bar and chips are fixed in height, but not a constant
     * this file should repeat: publish it for phone-shell.css's full-screen
     * editor. */
    function watchShellHeight() {
        const shell = document.getElementById('phoneShell');
        if (!shell || typeof ResizeObserver !== 'function') return;
        const publish = () => {
            document.body.style.setProperty('--phone-shell-height', Math.ceil(shell.getBoundingClientRect().height) + 'px');
        };
        new ResizeObserver(publish).observe(shell);
        publish();
    }

    function registerMarkdownView() {
        if (typeof NavigationController === 'undefined') return;
        NavigationController.register('markdown', {
            activate() {
                if (typeof deactivateKanban === 'function') deactivateKanban();
                if (typeof activateTabContent === 'function') activateTabContent('editor');
                document.body.classList.add('markdown-view');
                // Off a phone this view is simply "the editor, open".
                if (layout() !== 'phone' && isCollapsed() && typeof toggleMainEditor === 'function') {
                    toggleMainEditor();
                }
            },
            deactivate() {
                document.body.classList.remove('markdown-view');
            },
        });
    }

    function init() {
        registerMarkdownView();
        watchPanel();
        watchShellHeight();
        applyForLayout();
        document.addEventListener('layoutchange', applyForLayout);
        if (portrait) {
            if (typeof portrait.addEventListener === 'function') portrait.addEventListener('change', applyForLayout);
            else if (typeof portrait.addListener === 'function') portrait.addListener(applyForLayout);
        }
    }

    window.NoodleEditorVisibility = { layoutKey, preferredCollapsed, applyForLayout, PREF_KEY };

    // The view must be registered before the app's first navigation, which
    // multi-plan-loader.js makes once the store is ready; the layout is
    // applied once initEditorSplitter() (script.js, DOMContentLoaded) has
    // restored the width.
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
