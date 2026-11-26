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
 *   <np-toolbar>     the open view's commands | Reports, Export, Import
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
 * - The toolbar under the tabs is the ribbon at one row: the open view's
 *   contextual tab (Gantt Tools, Board Tools, RAID Log ...) as buttons, in
 *   the ribbon's groups, and the Report tab as three menus. Its commands are
 *   ribbon.js's ribbonCommandTabs(), run by runRibbonCommand(), so nothing
 *   is implemented twice and a command added to the ribbon appears here.
 *   Commands that only switch view are left out (the tabs do that), and so
 *   are the ones the ribbon itself marks "not available yet".
 * - The portfolio keeps the bar and the toolbar: its sub-views are the tabs.
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
    let tools = null;
    // The toolbar's buttons and menu items, by id, and the choices of the
    // menu a command last opened (Export -> PDF, Excel ...).
    let commands = new Map();
    let choices = new Map();
    let choiceAnchor = null;

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

    function onPortfolio() {
        return currentView() === 'portfolio';
    }

    function portfolioSubview() {
        return (typeof currentPortfolioSubview !== 'undefined') ? currentPortfolioSubview : 'projects';
    }

    function setTabs(label, views, activeId) {
        if (!tabs) return;
        tabs.setAttribute('label', 'Views of ' + label);
        const ids = views.map((view) => view.id).join(' ');
        if (tabs.dataset.views !== ids) {
            tabs.dataset.views = ids;
            tabs.views = views;
        }
        tabs.setAttribute('active', activeId);
    }

    function onTabSelect(event) {
        const id = event.detail.id;
        if (onPortfolio()) {
            if (typeof switchPortfolioView === 'function') switchPortfolioView(id);
            return;
        }
        switchToView(id);
    }

    function refreshBar() {
        const table = currentTable();
        const portfolio = !table && onPortfolio();
        document.documentElement.dataset.tableScope = table ? 'project' : (portfolio ? 'portfolio' : 'other');
        const title = $('tableShellTitle');
        if (portfolio) {
            if (title) title.textContent = 'Portfolio';
            const views = window.NoodleViewCatalogue ? window.NoodleViewCatalogue.portfolioViews() : [];
            setTabs('Portfolio', views.map((view) => ({ id: view.id, label: view.label })), portfolioSubview());
            refreshNew();
            refreshTools();
            return;
        }
        if (!table) return;
        if (title) title.textContent = table.label;
        setTabs(table.label, table.views, currentView());
        refreshNew();
        refreshTools();
    }

    // -----------------------------------------------------------------
    // The toolbar
    // -----------------------------------------------------------------

    const MENU_ICONS = { Reports: 'project-report', Export: 'download', Import: 'upload' };

    /** The toolbar's groups for the ribbon's tabs (ribbonCommandTabs()):
     * the view's own commands inline, then the Reports, Export and Import
     * menus. Fills `commands` with what each id runs. Exposed for tests. */
    function toolbarGroups(ribbonTabs, table) {
        commands = new Map();
        const usable = (cmd) => !cmd.disabled && !cmd.href;
        const button = (cmd) => {
            const id = cmd.scopeId + ':' + cmd.label;
            commands.set(id, cmd);
            return {
                id, label: cmd.label, icon: cmd.icon, help: cmd.help, caret: !!cmd.caret,
                // Only a toggle that is on is "pressed"; most commands are not toggles.
                active: cmd.active ? true : undefined,
            };
        };
        const groups = [];
        const seen = new Set();
        // A contextual tab's own shortcuts to a sibling view (Resource
        // Tools' Timesheet and Workload) repeat the tabs above.
        const tabLabels = new Set();
        const viewCatalogue = window.NoodleViewCatalogue;
        if (table) {
            table.views.forEach((view) => {
                tabLabels.add(view.label);
                const label = viewCatalogue && viewCatalogue.label(view.id);
                if (label) tabLabels.add(label);
            });
        } else if (viewCatalogue) {
            viewCatalogue.portfolioViews().forEach((view) => tabLabels.add(view.label));
        }
        const inline = (tab, group) => {
            const items = group.items.filter((cmd) => usable(cmd) && !cmd.nav && !seen.has(cmd.label) && !tabLabels.has(cmd.label));
            items.forEach((cmd) => seen.add(cmd.label));
            if (items.length) groups.push({ id: tab.id + '/' + group.name, label: group.name, items: items.map(button) });
        };

        const context = ribbonTabs.find((tab) => tab.context);
        const rest = ribbonTabs.filter((tab) => !tab.context);
        if (context) context.groups.forEach((group) => inline(context, group));

        const portfolio = rest.some((tab) => tab.id.indexOf('pf-') === 0);
        if (portfolio) {
            // Everything the portfolio's ribbon does besides switching view.
            rest.forEach((tab) => tab.groups.forEach((group) => inline(tab, group)));
            return groups;
        }

        // A Plan view with no tools of its own still edits tasks.
        const home = rest.find((tab) => tab.id === 'home');
        if (!context && table && table.id === 'plan' && home) {
            home.groups.filter((group) => group.name === 'Plan').forEach((group) => inline(home, group));
        }

        const report = rest.find((tab) => tab.id === 'report');
        const reports = report && report.groups.find((group) => group.name === 'Reports');
        if (reports) {
            const items = reports.items.filter(usable).map(button);
            if (items.length) groups.push({ id: 'menu:reports', label: 'Reports', icon: MENU_ICONS.Reports, menu: true, items });
        }
        // Export and Import open the ribbon's own format choices when
        // pressed. Where the view has an Export of its own (the RAID log's),
        // these say they are the plan's.
        for (const label of ['Export', 'Import']) {
            const cmd = rest.flatMap((tab) => tab.groups.flatMap((group) => group.items))
                .find((candidate) => candidate.label === label && usable(candidate));
            if (!cmd) continue;
            const id = 'menu:' + label.toLowerCase();
            commands.set(id, cmd);
            groups.push({
                id, label: seen.has(label) ? label + ' plan' : label, icon: MENU_ICONS[label], menu: true, help: cmd.help,
            });
        }
        return groups;
    }

    async function refreshTools() {
        if (!tools || !active() || typeof ribbonCommandTabs !== 'function') return;
        const view = currentView();
        const ribbonTabs = await ribbonCommandTabs();
        // The view may have changed while the ribbon's commands loaded.
        if (view !== currentView()) return;
        const groups = toolbarGroups(ribbonTabs, currentTable());
        tools.groups = groups;
        tools.hidden = groups.length === 0;
        tools.toggleAttribute('touch', layout() === 'tablet' || document.documentElement.dataset.pointer === 'coarse');
    }

    function onToolSelect(event) {
        const id = event.detail.id;
        if (choices.has(id)) {
            const choice = choices.get(id);
            choices = new Map();
            choice.run();
            refreshTools();
            return;
        }
        const cmd = commands.get(id);
        if (!cmd || typeof runRibbonCommand !== 'function') return;
        choiceAnchor = id;
        runRibbonCommand(cmd.scopeId, cmd.label, tools);
        // A command that opened its own choices has a menu up that a
        // re-render would close; anything else may have changed what is
        // pressed.
        if (!tools.menuOpen) refreshTools();
    }

    /** ribbon.js's openFormatMenu() hands a toolbar command's choices here,
     * to open as a menu under the button that asked. */
    function ownsAnchor(el) {
        return active() && !!tools && el === tools;
    }

    function openChoices(_anchor, formats) {
        if (!tools || !choiceAnchor) return;
        choices = new Map((formats || []).map((format, index) => ['choice:' + index, format]));
        tools.openMenu(choiceAnchor, [...choices].map(([id, format]) => ({ id, label: format.label })));
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
        tools = $('tableShellTools');
        if (tabs) tabs.addEventListener('select', onTabSelect);
        if (tools) tools.addEventListener('select', onToolSelect);

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
        document.addEventListener('portfolioviewchange', refresh);
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
        toolbarGroups, ownsAnchor, openChoices,
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
