/**
 * table-shell.js -- the table views interface.
 *
 * The classic interface offers every view of a project at once, across the
 * ribbon's tabs. This one says a project is a handful of tables -- Plan,
 * RAID log, Highlight reports, Lessons learned, Budget, Benefits, Resources,
 * Stakeholders -- and that Gantt, Board, Calendar and the rest are views of
 * one of them:
 *
 *   <np-side-nav>    Dashboard, then the tables
 *   #tableShellBar   the open table's views as tabs | Markdown, New, ...
 *   #tableShellMarkdown   the plan's Markdown, to the left of any view
 *
 * It is opt-in (ui-mode.js: Settings -> Layout -> Interface, or ?ui=tables)
 * and it is a shell, not a second app: which views exist and what they draw
 * is the router's, unchanged. This file only decides what the sidebar and
 * the bar show and what a click does, with the functions the ribbon and the
 * phone shell already call:
 *
 * - Which view belongs to which table is table-catalogue.js.
 * - Navigation is switchToView(), as everywhere.
 * - "New" is the view's create action and "..." is every ribbon command for
 *   the view, both from ribbon.js through phone-commands.js -- the ribbon's
 *   buttons are hidden here, so this is where its commands live.
 * - The Markdown panel is the classic editor panel itself, with its
 *   splitter, moved out of the editor tab into #tableShellMarkdown so it can
 *   stay beside views that are not in that tab (RAID, Budget, the board).
 *   toggleMainEditor() still opens and closes it, and editor-visibility.js
 *   still remembers that per layout.
 *
 * On a phone the phone shell stays (phone-shell.js): it asks this file for
 * the tables and shows the open table's views as its chips.
 *
 * Loaded after ribbon.js, view-catalogue.js and table-catalogue.js.
 */
(function () {
    'use strict';

    const LAST_VIEW_KEY = 'noodleplanner:table-last-view';
    const SIDE_KEY = 'noodleplanner:table-side-collapsed';
    const SIDE_DEFAULTS = { tablet: true };
    const HOME_VIEW = 'project-report';
    // Shell views that are the project itself with no table chosen: opening
    // the app, or the phone's full-screen Markdown view on a bigger screen.
    const PROJECT_SHELLS = ['editor', 'markdown'];

    const $ = (id) => document.getElementById(id);

    let side = null;
    let tabs = null;

    function enabled() {
        return document.documentElement.dataset.ui === 'tables';
    }

    function layout() {
        return document.documentElement.dataset.layout || 'desktop';
    }

    /** The shell proper: the tables interface on a tablet or a desktop. */
    function active() {
        return enabled() && layout() !== 'phone';
    }

    function catalogue() {
        return window.NoodleTableCatalogue;
    }

    function currentView() {
        return (typeof NavigationController !== 'undefined') ? NavigationController.getCurrentView() : null;
    }

    function currentTable() {
        const view = currentView();
        return (view && catalogue()) ? catalogue().tableForView(view) : null;
    }

    function readJson(key) {
        try {
            const parsed = JSON.parse(localStorage.getItem(key) || '{}');
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (_) {
            return {};
        }
    }

    function writeJson(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (_) { /* storage unavailable: lasts for the page */ }
    }

    // -----------------------------------------------------------------
    // Navigation
    // -----------------------------------------------------------------

    /** The view a table opens on: the one it was last left on, else its first. */
    function viewForTable(tableId) {
        const views = catalogue().viewsFor(tableId).map((view) => view.id);
        const last = readJson(LAST_VIEW_KEY)[tableId];
        return views.indexOf(last) !== -1 ? last : (views[0] || null);
    }

    function openTable(tableId) {
        const view = viewForTable(tableId);
        if (view) switchToView(view);
    }

    function rememberView(view) {
        const table = catalogue() && catalogue().tableForView(view);
        if (!table) return;
        const last = readJson(LAST_VIEW_KEY);
        if (last[table.id] === view) return;
        last[table.id] = view;
        writeJson(LAST_VIEW_KEY, last);
    }

    const SIDE_COMMANDS = {
        guide: () => switchToView('guide'),
        settings: () => { if (typeof openSettingsPanel === 'function') openSettingsPanel(); },
    };

    function onSideSelect(event) {
        const id = event.detail.id;
        if (id.indexOf('table:') === 0) openTable(id.slice('table:'.length));
        else if (id.indexOf('cmd:') === 0 && SIDE_COMMANDS[id.slice(4)]) SIDE_COMMANDS[id.slice(4)]();
    }

    // -----------------------------------------------------------------
    // The sidebar
    // -----------------------------------------------------------------

    /** The sidebar's sections; the phone drawer lists the same tables. */
    function sideSections() {
        const here = currentTable();
        const item = (table) => ({
            id: 'table:' + table.id,
            label: table.label,
            icon: table.icon,
            current: !!here && here.id === table.id,
        });
        const all = catalogue() ? catalogue().tables() : [];
        return [
            { id: 'home', items: all.filter((table) => table.home).map(item) },
            { id: 'tables', label: 'Tables', items: all.filter((table) => !table.home).map(item) },
            {
                id: 'more',
                end: true,
                items: [
                    { id: 'cmd:guide', label: 'Syntax guide', icon: 'doc', current: currentView() === 'guide' },
                    { id: 'cmd:settings', label: 'Settings', icon: 'settings' },
                ],
            },
        ];
    }

    function sideCollapsed() {
        const prefs = readJson(SIDE_KEY);
        const key = layout();
        return typeof prefs[key] === 'boolean' ? prefs[key] : !!SIDE_DEFAULTS[key];
    }

    function onSideToggle(event) {
        const prefs = readJson(SIDE_KEY);
        prefs[layout()] = !!event.detail.collapsed;
        writeJson(SIDE_KEY, prefs);
        refreshSide();
        relayout();
    }

    function refreshSide() {
        if (!side) return;
        side.sections = sideSections();
        side.toggleAttribute('collapsed', sideCollapsed());
        side.toggleAttribute('touch', layout() === 'tablet' || document.documentElement.dataset.pointer === 'coarse');
    }

    // -----------------------------------------------------------------
    // The bar
    // -----------------------------------------------------------------

    async function refreshNew() {
        const button = $('tableShellNewBtn');
        if (!button) return;
        const view = currentView();
        let create = null;
        if (active() && view && typeof ribbonCreateCommand === 'function') {
            create = await ribbonCreateCommand(view);
            // A view with no create action of its own (the Gantt, the
            // timeline) still adds to its table: a new task, a new RAID item.
            const table = catalogue().tableForView(view);
            if (!create && table && !table.home) create = await ribbonCreateCommand(table.views[0].id);
        }
        // The view may have changed while the ribbon's commands loaded.
        if (view !== currentView()) return;
        button.hidden = !create;
        button._create = create;
        if (create) $('tableShellNewLabel').textContent = create.label;
    }

    function refreshBar() {
        const table = currentTable();
        document.documentElement.dataset.tableScope = table ? 'project' : 'other';
        if (!table) return;
        const title = $('tableShellTitle');
        if (title) title.textContent = table.label;
        if (tabs) {
            tabs.setAttribute('label', 'Views of ' + table.label);
            const ids = table.views.map((view) => view.id).join(' ');
            if (tabs.dataset.views !== ids) {
                tabs.dataset.views = ids;
                tabs.views = table.views;
            }
            tabs.setAttribute('active', currentView());
        }
        refreshNew();
    }

    // -----------------------------------------------------------------
    // The Markdown panel
    // -----------------------------------------------------------------

    function editorPanel() {
        return document.querySelector('.editor-panel');
    }

    /** Put the editor panel and its splitter where this interface wants
     * them: beside every view here, back in the editor tab otherwise. */
    function placeEditor() {
        const panel = editorPanel();
        const splitter = $('editorSplitter');
        const slot = $('tableShellMarkdown');
        const home = document.querySelector('.editor-layout');
        if (!panel || !splitter || !slot || !home) return;
        const inSlot = panel.parentElement === slot;
        if (active() && !inSlot) {
            slot.append(panel, splitter);
            // The classic default width is a share of the editor layout,
            // which the panel has just left.
            if (/%$/.test(panel.style.width)) panel.style.width = '';
        } else if (!active() && inSlot) {
            home.prepend(panel, splitter);
        }
    }

    function refreshMarkdownButton() {
        const button = $('tableShellMarkdownBtn');
        const panel = editorPanel();
        if (!button || !panel) return;
        const open = !panel.classList.contains('collapsed');
        button.setAttribute('aria-pressed', String(open));
        if (open && /%$/.test(panel.style.width) && panel.parentElement === $('tableShellMarkdown')) {
            panel.style.width = '';
        }
    }

    function toggleMarkdown() {
        if (typeof toggleMainEditor === 'function') toggleMainEditor();
    }

    /** Views that draw to their width (Gantt, timeline) follow a change to it. */
    function relayout() {
        if (typeof refreshVisualsAfterResize === 'function') refreshVisualsAfterResize();
    }

    // -----------------------------------------------------------------
    // Keeping in step with the app
    // -----------------------------------------------------------------

    /** With no table chosen -- the app has just opened -- start on the
     * Dashboard, as the mock-up does. */
    function goHomeIfNowhere() {
        if (!active() || typeof switchToView !== 'function') return;
        if (PROJECT_SHELLS.indexOf(currentView()) === -1) return;
        const registry = (typeof NavigationController !== 'undefined') ? NavigationController.getRegistry() : {};
        if (registry[HOME_VIEW]) switchToView(HOME_VIEW);
    }

    function refresh() {
        if (!enabled()) {
            delete document.documentElement.dataset.tableScope;
            placeEditor();
            return;
        }
        const view = currentView();
        if (view) rememberView(view);
        placeEditor();
        refreshBar();
        refreshSide();
        refreshMarkdownButton();
    }

    function onModeChange() {
        refresh();
        goHomeIfNowhere();
        // The ribbon's height has just changed under every view.
        relayout();
        if (window.NoodlePhoneShell) window.NoodlePhoneShell.refresh();
        if (window.NoodlePhoneCommands) window.NoodlePhoneCommands.refreshFab();
    }

    function init() {
        side = $('tableShellSide');
        tabs = $('tableShellTabs');
        if (!side || !catalogue()) return;

        side.addEventListener('select', onSideSelect);
        side.addEventListener('toggle', onSideToggle);
        if (tabs) tabs.addEventListener('select', (event) => switchToView(event.detail.id));

        const markdown = $('tableShellMarkdownBtn');
        if (markdown) markdown.addEventListener('click', toggleMarkdown);
        const create = $('tableShellNewBtn');
        if (create) create.addEventListener('click', () => { if (create._create) create._create.run(); });
        const more = $('tableShellMoreBtn');
        if (more) {
            more.addEventListener('click', () => {
                if (window.NoodlePhoneCommands) window.NoodlePhoneCommands.openCommands(more);
            });
        }

        document.addEventListener('viewchange', refresh);
        document.addEventListener('layoutchange', onModeChange);
        document.addEventListener('uimodechange', onModeChange);
        window.addEventListener('projectLoaded', refresh);
        window.addEventListener('editorPanelVisibilityChanged', refreshMarkdownButton);
        const panel = editorPanel();
        if (panel && typeof MutationObserver === 'function') {
            new MutationObserver(refreshMarkdownButton).observe(panel, { attributes: true, attributeFilter: ['class'] });
        }

        refresh();
        goHomeIfNowhere();
    }

    window.NoodleTableShell = {
        enabled, active, openTable, viewForTable, currentTable, sideSections, refresh,
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
