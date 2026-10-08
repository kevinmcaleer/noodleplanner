/**
 * phone-shell.js -- the phone's app bar, view chips and navigation drawer,
 * wired to the app (#1380, epic #1376).
 *
 * With `<html data-layout="phone">` (layout-mode.js), phone-shell.css hides
 * the ribbon and the status bar and shows #phoneShell instead:
 *
 *   <np-app-bar>     ☰ | plan title ▾ + RAG dot | search, messages, ⋯
 *   <np-view-chips>  Dashboard · Tasks · Outline · Board · Calendar · RAID
 *   <np-nav-drawer>  scope switch, every view, File / Settings / History
 *
 * The components only draw and raise events; this file decides what they
 * show and what a tap does, using the same functions the ribbon and status
 * bar call, so nothing is implemented twice:
 *
 * - The view list comes from view-catalogue.js, i.e. from the router's own
 *   constants. tests/ui/test_phone_shell.py checks the drawer lists exactly
 *   the router's views.
 * - Navigation is switchToView() / switchPortfolioView(), as the ribbon's.
 * - The status bar's contents move rather than disappear: its RAG dot and
 *   message bell are mirrored into the app bar (observed, so status-bar.js
 *   stays the one place that computes them), and History, Settings and
 *   Details are drawer entries. Its project select becomes the title's
 *   switcher.
 *
 * The ⋯ button opens the ribbon's commands (phone-commands.js, #1382).
 */
(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);

    let appBar = null;
    let chips = null;
    let drawer = null;
    let sheet = null;

    function isPhone() {
        return document.documentElement.dataset.layout === 'phone';
    }

    function currentView() {
        return (typeof NavigationController !== 'undefined') ? NavigationController.getCurrentView() : null;
    }

    function currentPortfolioView() {
        return (typeof currentPortfolioSubview !== 'undefined') ? currentPortfolioSubview : 'projects';
    }

    /** The drawer/chip id of what is on screen: a router view, or
     * `portfolio:<sub-view>` inside the portfolio. */
    function currentKey() {
        const view = currentView();
        if (view === 'portfolio') return 'portfolio:' + currentPortfolioView();
        return view;
    }

    function planName() {
        const project = (typeof getActiveProjectForBreadcrumb === 'function') ? getActiveProjectForBreadcrumb() : null;
        return (project && project.name) || 'Untitled plan';
    }

    function scopeOf(view) {
        if (view === 'portfolio' || view === 'backstage') return 'portfolio';
        if (view === 'programme') return 'programme';
        return 'project';
    }

    function viewLabel(key) {
        if (!key) return '';
        const catalogue = window.NoodleViewCatalogue;
        const label = catalogue && catalogue.label(key);
        if (label) return label;
        const SHELL_LABELS = {
            markdown: 'Markdown', search: 'Search', backstage: 'File', programme: 'Programme',
            editor: '', upload: 'Upload',
        };
        return SHELL_LABELS[key] != null ? SHELL_LABELS[key] : key;
    }

    // -----------------------------------------------------------------
    // Navigation
    // -----------------------------------------------------------------

    /** Go to a drawer or chip id. Exposed as NoodlePhoneShell.navigate. */
    function navigate(key) {
        if (!key) return;
        if (key.indexOf('portfolio:') === 0) {
            const sub = key.slice('portfolio:'.length);
            switchToView('portfolio');
            if (typeof switchPortfolioView === 'function') switchPortfolioView(sub);
            return;
        }
        switchToView(key);
    }

    function switchScope(scope) {
        if (scope === 'portfolio') switchToView('portfolio');
        else if (scope === 'project') switchToView('editor');
        else openProgrammeScope();
    }

    // -----------------------------------------------------------------
    // The drawer's contents, rebuilt each time it opens
    // -----------------------------------------------------------------

    function drawerSections() {
        const catalogue = window.NoodleViewCatalogue;
        const here = currentKey();
        const scope = scopeOf(currentView());
        const sections = [{
            id: 'scope',
            label: 'Scope',
            kind: 'segmented',
            items: [
                { id: 'scope:project', label: 'Project', current: scope === 'project' },
                { id: 'scope:programme', label: 'Programme', current: scope === 'programme' },
                { id: 'scope:portfolio', label: 'Portfolio', current: scope === 'portfolio' },
            ],
        }];

        const larger = (view) => (view.tier === 'larger-screen' ? 'Best on a larger screen' : '');
        // The phone tiers (#1387) order each group: what reads on a phone
        // first, what is best on a larger screen last.
        const RANK = { 'phone-first': 0, 'phone-readable': 1, 'larger-screen': 2 };
        const byTier = (views) => views
            .map((view, i) => ({ view, i }))
            .sort((a, b) => (RANK[a.view.tier] ?? 1) - (RANK[b.view.tier] ?? 1) || a.i - b.i)
            .map(({ view }) => view);
        if (catalogue) {
            for (const group of catalogue.groups()) {
                sections.push({
                    id: group.id,
                    label: group.label,
                    items: byTier(group.views).map((view) => ({
                        id: 'view:' + view.id,
                        label: view.label,
                        icon: view.icon,
                        note: larger(view),
                        current: here === view.id,
                    })),
                });
            }
            sections.push({
                id: 'portfolio',
                label: 'Portfolio',
                items: byTier(catalogue.portfolioViews()).map((view) => ({
                    id: 'view:' + view.key,
                    label: view.label,
                    icon: view.icon,
                    note: larger(view),
                    current: here === view.key,
                })),
            });
        }

        const messages = messageCount();
        const registry = (typeof NavigationController !== 'undefined') ? NavigationController.getRegistry() : {};
        const markdown = registry.markdown
            ? [{ id: 'cmd:markdown', label: 'Markdown', icon: 'doc', note: 'Edit the plan text', current: here === 'markdown' }]
            : [];
        // #1395: the phone's way to get a plan back off it -- the share
        // sheet, or a download where the browser has none for files.
        const share = sharePlanCopyLabels();
        sections.push({
            id: 'more',
            label: 'Plan',
            items: markdown.concat([
                { id: 'cmd:details', label: 'Project details', icon: 'project-report' },
                { id: 'cmd:history', label: 'Version history', icon: 'clock' },
                { id: 'cmd:share', label: share.label, icon: share.icon, note: share.note },
                {
                    id: 'cmd:messages', label: 'Messages', icon: 'warn',
                    badge: messages.actionable ? '!' : '',
                    badgeLabel: messages.actionable ? 'Action needed' : '',
                },
                { id: 'cmd:file', label: 'File', icon: 'home', note: 'New, open, save, templates', current: here === 'backstage' },
                { id: 'cmd:settings', label: 'Settings', icon: 'settings' },
            ]),
        });
        sections.push({
            id: 'help',
            label: 'Help',
            items: [
                { id: 'cmd:tour', label: 'Take the tour', icon: 'bulb' },
                { id: 'cmd:docs', label: 'Documentation', icon: 'external', note: 'Opens in a new tab' },
            ],
        });
        return sections;
    }

    const COMMANDS = {
        markdown: () => switchToView('markdown'),
        details: () => { if (typeof toggleProjectDetails === 'function') toggleProjectDetails(); },
        history: () => { if (typeof toggleVersionHistoryPanel === 'function') toggleVersionHistoryPanel(); },
        share: () => sharePlanCopy(),
        messages: () => { if (typeof openStatusLogFullscreen === 'function') openStatusLogFullscreen(); },
        file: () => switchToView('backstage'),
        settings: () => { if (typeof openSettingsPanel === 'function') openSettingsPanel(); },
        tour: () => { if (typeof startTour === 'function') startTour({ force: true }); },
        docs: () => window.open('https://docs.noodleplanner.com', '_blank', 'noopener'),
    };

    function onDrawerSelect(event) {
        const id = event.detail.id;
        if (id.indexOf('view:') === 0) navigate(id.slice(5));
        else if (id.indexOf('scope:') === 0) switchScope(id.slice(6));
        else if (id.indexOf('cmd:') === 0 && COMMANDS[id.slice(4)]) COMMANDS[id.slice(4)]();
    }

    function openDrawer() {
        drawer.heading = 'Noodle Planner';
        const version = $('statusBarAppVersion');
        drawer.footer = version ? version.textContent.trim() : '';
        drawer.sections = drawerSections();
        drawer.open(appBar.menuButton);
    }

    // -----------------------------------------------------------------
    // The title's project switcher
    // -----------------------------------------------------------------

    function openProjectSwitcher() {
        const projects = (typeof listProjects === 'function') ? listProjects() : [];
        const currentId = (typeof getCurrentProjectId === 'function') ? getCurrentProjectId() : null;
        sheet.heading = 'Plans';
        sheet.toolbar = [];
        sheet.sections = [
            {
                id: 'projects',
                items: projects
                    .slice()
                    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
                    .map((project) => ({
                        id: 'project:' + project.id,
                        label: project.name || 'Untitled plan',
                        icon: 'project-report',
                        active: project.id === currentId,
                    })),
            },
            {
                id: 'plan-actions',
                items: [
                    { id: 'new-project', label: 'New plan', icon: 'add' },
                    { id: 'open-file', label: 'Open a plan file…', icon: 'upload' },
                ],
            },
        ];
        sheet.dataset.purpose = 'projects';
        sheet.open(appBar.titleButton);
    }

    function onSheetSelect(event) {
        if (sheet.dataset.purpose !== 'projects') return;
        const id = event.detail.id;
        if (id.indexOf('project:') === 0) {
            if (typeof onProjectSelectorChange === 'function') onProjectSelectorChange(id.slice('project:'.length));
        } else if (id === 'new-project' && typeof showCreateProjectDialog === 'function') {
            showCreateProjectDialog();
        } else if (id === 'open-file' && typeof openLocalPlanFile === 'function') {
            openLocalPlanFile();
        }
    }

    // -----------------------------------------------------------------
    // The status bar's contents, mirrored
    // -----------------------------------------------------------------

    function messageCount() {
        const bell = $('statusBarHistoryBtn');
        return {
            any: !!(bell && bell.classList.contains('has-entries')),
            actionable: !!(bell && bell.classList.contains('has-actionable')),
        };
    }

    function syncRag() {
        const source = $('statusBarRAG');
        const dot = $('phoneRagDot');
        if (!source || !dot) return;
        const rag = ['red', 'amber', 'green', 'blue'].find((c) => source.classList.contains('rag-' + c));
        dot.className = 'status-bar-rag phone-rag-dot' + (rag ? ' rag-' + rag : '');
        dot.hidden = !rag;
        dot.setAttribute('aria-label', rag ? (source.title || 'RAG: ' + rag) : '');
    }

    function syncBell() {
        const bell = $('phoneBellBtn');
        if (!bell) return;
        const messages = messageCount();
        bell.classList.toggle('has-entries', messages.any);
        bell.classList.toggle('has-actionable', messages.actionable);
        bell.setAttribute('label', messages.actionable ? 'Messages, action needed' : 'Messages');
    }

    function observe(id, callback) {
        const el = $(id);
        if (!el) return;
        new MutationObserver(callback).observe(el, { attributes: true, attributeFilter: ['class', 'title'] });
        callback();
    }

    // -----------------------------------------------------------------
    // Keeping the bar and chips in step with the app
    // -----------------------------------------------------------------

    function refresh() {
        if (!appBar) return;
        syncNotice();
        const key = currentKey();
        appBar.setAttribute('heading', planName());
        appBar.setAttribute('subheading', viewLabel(key));
        if (chips) {
            if (key) chips.setAttribute('active', key);
            else chips.removeAttribute('active');
        }
    }

    // -----------------------------------------------------------------
    // "Best on a larger screen" (#1387)
    // -----------------------------------------------------------------

    // A view the catalogue marks larger-screen still opens on a phone, with
    // a notice pointing at its nearest phone-first view. Dismissed, it stays
    // dismissed for that view (per browser).
    const DISMISSED_KEY = 'noodleplanner:larger-screen-dismissed';

    function dismissed() {
        try {
            const list = JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]');
            return Array.isArray(list) ? list : [];
        } catch (_) {
            return [];
        }
    }

    function rememberDismissed(key) {
        try {
            localStorage.setItem(DISMISSED_KEY, JSON.stringify([...new Set(dismissed().concat(key))]));
        } catch (_) { /* storage unavailable: dismissed for the page */ }
    }

    function syncNotice() {
        const notice = $('phoneNotice');
        if (!notice) return;
        const key = currentKey();
        const entry = key && window.NoodleViewCatalogue ? window.NoodleViewCatalogue.get(key) : null;
        let show = isPhone() && !!entry && entry.tier === 'larger-screen' && dismissed().indexOf(key) === -1;
        // The whiteboard on a phone opens as cards (#1384); only its canvas
        // is best on a larger screen.
        const list = window.NoodlePlanList;
        if (show && key === 'whiteboard' && list && list.whiteboardMode() === 'cards') show = false;
        notice.hidden = !show;
        if (!show) return;
        notice.dataset.view = key;
        notice.dataset.nearest = entry.nearest || '';
        notice.setAttribute('action', entry.nearest === 'whiteboard-cards'
            ? 'Show as cards'
            : entry.nearest ? `Open ${viewLabel(entry.nearest)}` : '');
        notice.textContent = `${viewLabel(key)} is best on a larger screen.`;
    }

    function wireNotice() {
        const notice = $('phoneNotice');
        if (!notice) return;
        notice.addEventListener('action', () => {
            const nearest = notice.dataset.nearest;
            if (nearest === 'whiteboard-cards') {
                if (window.NoodlePlanList) window.NoodlePlanList.setWhiteboardMode('cards');
            } else if (nearest) {
                navigate(nearest);
            }
        });
        notice.addEventListener('dismiss', () => rememberDismissed(notice.dataset.view));
    }

    function search() {
        switchToView('search');
        requestAnimationFrame(() => {
            const input = $('searchViewInput');
            if (input) input.focus();
        });
    }

    function init() {
        appBar = $('phoneAppBar');
        chips = $('phoneViewChips');
        drawer = $('phoneNavDrawer');
        sheet = $('phoneSheet');
        if (!appBar || !drawer) return;

        if (chips && window.NoodleViewCatalogue) {
            chips.views = window.NoodleViewCatalogue.phoneFirst().map((v) => ({ id: v.id, label: v.label }));
            chips.addEventListener('select', (event) => navigate(event.detail.id));
        }

        appBar.addEventListener('menu', openDrawer);
        appBar.addEventListener('title', openProjectSwitcher);
        drawer.addEventListener('select', onDrawerSelect);
        drawer.addEventListener('open', () => appBar.setAttribute('menu-expanded', 'true'));
        drawer.addEventListener('close', () => appBar.setAttribute('menu-expanded', 'false'));
        if (sheet) sheet.addEventListener('select', onSheetSelect);

        const searchBtn = $('phoneSearchBtn');
        if (searchBtn) searchBtn.addEventListener('click', search);
        const bell = $('phoneBellBtn');
        if (bell) bell.addEventListener('click', () => { if (typeof openStatusLogFullscreen === 'function') openStatusLogFullscreen(); });

        wireNotice();
        document.addEventListener('viewchange', refresh);
        document.addEventListener('portfolioviewchange', refresh);
        document.addEventListener('whiteboardmodechange', syncNotice);
        window.addEventListener('projectLoaded', refresh);
        document.addEventListener('layoutchange', () => {
            if (!isPhone()) {
                drawer.close({ restoreFocus: false });
                if (sheet) sheet.close();
            }
            refresh();
        });
        observe('statusBarRAG', syncRag);
        observe('statusBarHistoryBtn', syncBell);
        // The project name can change without a view change (a front-matter
        // title edit renames it); the hidden breadcrumb is where nav.js
        // writes it, so watch that too.
        const crumb = $('projectBreadcrumbName');
        if (crumb) new MutationObserver(refresh).observe(crumb, { childList: true, characterData: true, subtree: true });

        refresh();
    }

    window.NoodlePhoneShell = { navigate, refresh, openDrawer, openProjectSwitcher, drawerSections };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
