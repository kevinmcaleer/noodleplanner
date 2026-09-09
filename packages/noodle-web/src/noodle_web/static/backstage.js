/**
 * backstage.js — full-screen, Office-Backstage-style shell behind File
 * (issue #943, full-screen shell #972, sub-issues of epic #903).
 *
 * Provides:
 *   - #backstage-tab: a left rail of file actions (New plan, Open, Save,
 *     Import, Export, Print, Templates, Settings) plus a "Start a new plan"
 *     template strip and a "Recent" grid of projects (listProjects(),
 *     project-storage.js).
 *   - File actions reuse ribbon.js's own FILE_ACTIONS map rather than
 *     re-implementing project creation/import/export -- see runFileAction()
 *     below. ribbon.js is a classic (non-module) script, so its top-level
 *     `const FILE_ACTIONS` is readable here as a shared lexical binding once
 *     it has run, the same cross-script pattern ribbon.js itself uses for
 *     NavigationController/currentThemeChoice (see ribbon.js's comments).
 *   - Full screen (#972): activating the 'backstage' view hides the ribbon
 *     and status bar (body.backstage-fullscreen, see backstage.css) --
 *     Backstage is a mode change out of the document, not a panel under a
 *     visible ribbon. enterBackstage()/exitBackstage() remember which view
 *     was active on entry so the mandatory back arrow (#backstageExitBtn)
 *     and Esc can return to it; with no prior view (first run) they fall
 *     back to the portfolio.
 *   - #backstageTemplatesBtn / #backstageMoreTemplatesBtn swap the main area
 *     into a full template-browser sub-view (#backstageTemplatesView)
 *     sourced from the real /api/templates catalogue, sharing the
 *     `templatesData` cache nav.js's own template modal already fetches
 *     into (state.js). This is a layout change, not a card change: card
 *     rendering is still a plain placeholder (renderTemplateCard() below)
 *     -- #945 gives it the real portrait renderer -- and clicking a real
 *     (non-blank) template still shows a "not available yet" toast, same
 *     as before.
 *
 * Depends on:
 *   - NavigationController (script.js) — view registry & navigateTo()
 *   - listProjects / getCurrentProjectId / switchToProject (project-storage.js / portfolio.js)
 *   - FILE_ACTIONS / notAvailable (ribbon.js)
 *   - templatesData (state.js) / fetch('/api/templates')
 */

(function () {
    'use strict';

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatUpdatedAt(ts) {
        if (!ts) return 'never';
        const d = new Date(ts);
        if (Number.isNaN(d.getTime())) return 'never';
        return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) +
            ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }

    // ── File actions ─────────────────────────────────────────────────────

    function runFileAction(label) {
        if (typeof FILE_ACTIONS === 'undefined' || typeof FILE_ACTIONS[label] !== 'function') {
            if (typeof notAvailable === 'function') notAvailable(label);
            return;
        }
        const action = FILE_ACTIONS[label];
        // ribbon.js closes any open popover on the first click that bubbles
        // to document from outside #ribbonShell (wireEvents()'s
        // composedPath().includes(shell) check) -- true of every backstage
        // rail button, since backstage-tab lives outside the ribbon shell.
        // Import/Export open exactly that kind of popover (OPENS_OWN_POPOVER,
        // also a shared cross-script const, same pattern as FILE_ACTIONS
        // above), so calling them synchronously here would have their own
        // triggering click immediately tear the popover back down. Deferring
        // past this click's bubble phase lets that close-on-outside-click
        // pass run first (with nothing open yet), then opens the popover on
        // the next tick so it actually stays open.
        if (typeof OPENS_OWN_POPOVER !== 'undefined' && OPENS_OWN_POPOVER.has(label)) {
            setTimeout(action, 0);
        } else {
            action();
        }
    }

    // ── Enter / exit (#972) ─────────────────────────────────────────────

    // The view active immediately before Backstage was entered -- what the
    // back arrow / Esc return to. Null on first run (no project open yet),
    // in which case exitBackstage() falls back to the portfolio.
    let backstageReturnView = null;

    function enterBackstage() {
        if (typeof NavigationController !== 'undefined') {
            const current = NavigationController.getCurrentView();
            if (current && current !== 'backstage') backstageReturnView = current;
        }
        switchToView('backstage');
    }

    function exitBackstage() {
        const target = (backstageReturnView && backstageReturnView !== 'backstage')
            ? backstageReturnView : 'portfolio';
        switchToView(target);
    }

    // Exposed for ribbon.js's FILE_ACTIONS.Home (File ▾ now navigates
    // straight here, see #972) and for the back arrow / Esc handling below.
    window.enterBackstage = enterBackstage;
    window.exitBackstage = exitBackstage;

    // ── Recent list ──────────────────────────────────────────────────────

    function renderRecent() {
        const list = document.getElementById('backstageRecentList');
        const empty = document.getElementById('backstageRecentEmpty');
        if (!list || !empty) return;

        const projects = (typeof listProjects === 'function') ? listProjects() : [];
        const currentProjectId = (typeof getCurrentProjectId === 'function') ? getCurrentProjectId() : null;

        if (projects.length === 0) {
            list.style.display = 'none';
            list.innerHTML = '';
            empty.style.display = '';
            return;
        }

        empty.style.display = 'none';
        list.style.display = '';
        list.innerHTML = projects.map((project) => {
            const isActive = project.id === currentProjectId;
            return `
                <button type="button" class="backstage-recent-item${isActive ? ' active' : ''}" data-project-id="${escapeHtml(project.id)}">
                    <span class="backstage-recent-item-icon">
                        <svg class="icon" width="20" height="20" aria-hidden="true"><use href="#icon-doc"/></svg>
                    </span>
                    <span class="backstage-recent-item-body">
                        <span class="backstage-recent-item-name">${escapeHtml(project.name || 'Untitled plan')}</span>
                        <span class="backstage-recent-item-meta">Updated ${escapeHtml(formatUpdatedAt(project.updatedAt))}</span>
                    </span>
                    ${isActive ? '<span class="backstage-recent-item-badge">Current</span>' : ''}
                </button>
            `;
        }).join('');
    }

    // ── Template picker ─────────────────────────────────────────────────

    // Loads the real /api/templates catalogue (event-planning,
    // marketing-campaign, ... -- see app.py's get_templates()), sharing
    // nav.js's own `templatesData` cache (state.js) rather than fetching it
    // twice. Resolves to { templates: [], categories: [] } on failure so
    // callers never need their own try/catch.
    function loadTemplatesData() {
        if (templatesData) return Promise.resolve(templatesData);
        return fetch('/api/templates')
            .then((r) => (r.ok ? r.json() : { templates: [], categories: [] }))
            .then((data) => { templatesData = data; return data; })
            .catch(() => ({ templates: [], categories: [] }));
    }

    function renderTemplateCard(template) {
        // #945 replaces this body with the real portrait-rendered card.
        return `
            <button type="button" class="backstage-template-card" data-template-id="${escapeHtml(template.id)}" title="${escapeHtml(template.description || template.title || '')}">
                <span class="backstage-template-card-icon">
                    <svg class="icon" width="28" height="28" aria-hidden="true"><use href="#icon-doc"/></svg>
                </span>
                <span class="backstage-template-card-name">${escapeHtml(template.title || template.id)}</span>
            </button>
        `;
    }

    function renderBlankPlanCard() {
        return `
            <button type="button" class="backstage-template-card backstage-template-card-blank" data-template-id="blank">
                <span class="backstage-template-card-icon">
                    <svg class="icon" width="28" height="28" aria-hidden="true"><use href="#icon-add"/></svg>
                </span>
                <span class="backstage-template-card-name">Blank plan</span>
            </button>
        `;
    }

    // The landing strip: Blank plan plus the templates flagged `popular` in
    // their template.yml (app.py's get_templates()) -- a ready-made answer
    // for which few go above the fold, capped at 4 so the strip sits above
    // Recent without pushing it off screen.
    function renderTemplateStrip(data) {
        const strip = document.getElementById('backstageTemplateStrip');
        if (!strip) return;
        const popular = (data.templates || []).filter((t) => t.popular).slice(0, 4);
        strip.innerHTML = renderBlankPlanCard() + popular.map(renderTemplateCard).join('');
    }

    // The full browser (rail's "Templates" / strip's "More templates →"):
    // every real template, not just the popular ones.
    function renderTemplateGrid(data) {
        const grid = document.getElementById('backstageTemplateGrid');
        if (!grid) return;
        grid.innerHTML = renderBlankPlanCard() + (data.templates || []).map(renderTemplateCard).join('');
    }

    function showTemplatesView() {
        const recentView = document.getElementById('backstageRecentView');
        const templatesView = document.getElementById('backstageTemplatesView');
        if (!recentView || !templatesView) return;
        recentView.style.display = 'none';
        templatesView.style.display = '';
        loadTemplatesData().then(renderTemplateGrid);
    }

    function showRecentView() {
        const recentView = document.getElementById('backstageRecentView');
        const templatesView = document.getElementById('backstageTemplatesView');
        if (!recentView || !templatesView) return;
        templatesView.style.display = 'none';
        recentView.style.display = '';
    }

    function handleTemplateCardClick(e) {
        const card = e.target.closest('.backstage-template-card[data-template-id]');
        if (!card) return;
        if (card.dataset.templateId === 'blank') {
            runFileAction('New plan');
            return;
        }
        const template = (templatesData && templatesData.templates || []).find((t) => t.id === card.dataset.templateId);
        if (typeof notAvailable === 'function') {
            notAvailable(template ? template.title : 'This template');
        }
    }

    // ── Wiring ───────────────────────────────────────────────────────────

    function init() {
        const rail = document.querySelector('.backstage-rail');
        if (rail) {
            rail.addEventListener('click', (e) => {
                const actionBtn = e.target.closest('[data-backstage-action]');
                if (actionBtn) {
                    runFileAction(actionBtn.dataset.backstageAction);
                    return;
                }
                if (e.target.closest('#backstageTemplatesBtn')) {
                    showTemplatesView();
                }
            });
        }

        const list = document.getElementById('backstageRecentList');
        if (list) {
            list.addEventListener('click', (e) => {
                const item = e.target.closest('.backstage-recent-item[data-project-id]');
                if (!item) return;
                if (typeof switchToProject === 'function') {
                    switchToProject(item.dataset.projectId);
                }
            });
        }

        const moreTemplatesBtn = document.getElementById('backstageMoreTemplatesBtn');
        if (moreTemplatesBtn) {
            moreTemplatesBtn.addEventListener('click', showTemplatesView);
        }

        const backBtn = document.getElementById('backstageTemplatesBackBtn');
        if (backBtn) {
            backBtn.addEventListener('click', showRecentView);
        }

        const strip = document.getElementById('backstageTemplateStrip');
        if (strip) strip.addEventListener('click', handleTemplateCardClick);

        const grid = document.getElementById('backstageTemplateGrid');
        if (grid) grid.addEventListener('click', handleTemplateCardClick);

        // The mandatory exit route (#972) -- once full screen, there is no
        // ribbon tab left to click away to.
        const exitBtn = document.getElementById('backstageExitBtn');
        if (exitBtn) exitBtn.addEventListener('click', exitBackstage);

        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if (typeof NavigationController === 'undefined') return;
            if (NavigationController.getCurrentView() !== 'backstage') return;
            exitBackstage();
        });

        if (typeof NavigationController !== 'undefined') {
            NavigationController.register('backstage', {
                activate() {
                    if (typeof saveCurrentProjectState === 'function') {
                        saveCurrentProjectState();
                    }
                    if (typeof activateTabContent === 'function') {
                        activateTabContent('backstage');
                    } else {
                        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                        const el = document.getElementById('backstage-tab');
                        if (el) el.classList.add('active');
                    }
                    if (typeof closeAllNavMenus === 'function') closeAllNavMenus();
                    if (typeof setActiveNavTab === 'function') setActiveNavTab(null);
                    // Full screen (#972): hide the ribbon/status bar -- see
                    // body.backstage-fullscreen in backstage.css. The
                    // project subnav is hidden below regardless, same as
                    // before #972 (it isn't project-scoped).
                    document.body.classList.add('backstage-fullscreen');
                    const planSubnav = document.getElementById('planSubnav');
                    if (planSubnav) planSubnav.classList.remove('visible');
                    showRecentView();
                    renderRecent();
                    loadTemplatesData().then(renderTemplateStrip);
                },
                deactivate() {
                    document.body.classList.remove('backstage-fullscreen');
                },
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
