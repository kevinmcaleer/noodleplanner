/**
 * backstage.js — full-screen, Office-Backstage-style shell behind File
 * (issue #943 landed it as a panel; #972, this revision, makes it the
 * full-screen front door the epic #903 always intended: File navigates
 * straight to it, the header/ribbon/status bar hide while it's open, and a
 * back arrow / Esc is the one way out).
 *
 * Provides:
 *   - #backstage-tab: a left rail of file actions (New plan, Open, Save,
 *     Import, Export, Print, Templates, Settings) plus a "start a new plan"
 *     template strip and a "Recent" grid of projects (listProjects()) in
 *     the main area.
 *   - File actions reuse ribbon.js's own FILE_ACTIONS map rather than
 *     re-implementing project creation/import/export -- see runFileAction()
 *     below. ribbon.js is a classic (non-module) script, so its top-level
 *     `const FILE_ACTIONS` is readable here as a shared lexical binding once
 *     it has run, the same cross-script pattern ribbon.js itself uses for
 *     NavigationController/currentThemeChoice (see ribbon.js's comments).
 *   - #backstageTemplatesBtn / "More templates" (#944, this file) swap the
 *     main area into a template-picker sub-view (#backstageTemplatesView)
 *     instead of the Recent grid. Not the same feature as the ribbon's own
 *     "Templates" File-menu item (nav.js's openTemplatesModal(), which
 *     inserts a starter plan into the *current* project) -- picking a card
 *     here still just shows a "not available yet" toast for anything but
 *     Blank; #945/#946 (portrait card rendering, seed templates) and the
 *     "creates a separate new plan" behaviour are follow-ups, deliberately
 *     left for whoever picks those up rather than guessed at here.
 *   - Real template data comes from `/api/templates`, cached in
 *     `templatesData` (state.js) -- the same global nav.js's own Templates
 *     modal (openTemplatesModal()) already populates and reads, so opening
 *     either one first warms the cache for the other.
 *   - Full-screen: activate()/deactivate() toggle `body.backstage-fullscreen`
 *     (backstage.css hides #ribbonShell and .status-bar under it, and
 *     reclaims the bottom padding status-bar.css reserves for the status
 *     bar). The back arrow and Esc both call exitBackstage(), which returns
 *     to whatever view NavigationController.getPreviousView() recorded on
 *     entry -- 'portfolio' if there wasn't one (first run, no project open).
 *
 * Depends on:
 *   - NavigationController (script.js) — view registry, navigateTo(),
 *     getCurrentView()/getPreviousView()
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

    // How many real templates the landing strip shows alongside Blank --
    // "four or five cards including Blank" per #972's own layout spec.
    const STRIP_TEMPLATE_COUNT = 3;

    /**
     * Fetches /api/templates once per session, caching into `templatesData`
     * (state.js) -- the same global nav.js's openTemplatesModal() reads and
     * populates, so whichever of the two runs first warms it for the other.
     * Returns null (rather than throwing) on failure so callers can leave
     * the Blank card visible instead of showing a broken grid/strip.
     */
    async function loadTemplates() {
        if (templatesData) return templatesData;
        try {
            const response = await fetch('/api/templates');
            if (!response.ok) throw new Error('Failed to load templates');
            templatesData = await response.json();
            return templatesData;
        } catch (error) {
            console.error('Backstage: error loading templates:', error);
            return null;
        }
    }

    function renderTemplateCard(template) {
        // #945 replaces this body with the real portrait-rendered card
        // (summary-task rows + milestone bubbles, off plan-model.js).
        return `
            <button type="button" class="backstage-template-card" data-template-id="${escapeHtml(template.id)}">
                <span class="backstage-template-card-icon">
                    <svg class="icon" width="28" height="28" aria-hidden="true"><use href="#icon-doc"/></svg>
                </span>
                <span class="backstage-template-card-name">${escapeHtml(template.title)}</span>
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

    /** The landing view's short "start a new plan" strip: Blank plus up to
     * STRIP_TEMPLATE_COUNT templates, preferring ones flagged `popular` in
     * their template.yml (the same flag nav.js's Templates modal uses for
     * its own "Start Here" section) so the strip surfaces the templates
     * most likely to be picked. */
    async function renderTemplateStrip() {
        const strip = document.getElementById('backstageTemplateStrip');
        if (!strip) return;
        strip.innerHTML = renderBlankPlanCard();
        const data = await loadTemplates();
        if (!data) return; // Blank stays visible; strip just skips real templates.
        const all = data.templates || [];
        const popular = all.filter((t) => t.popular);
        const picks = (popular.length > 0 ? popular : all).slice(0, STRIP_TEMPLATE_COUNT);
        strip.innerHTML = renderBlankPlanCard() + picks.map(renderTemplateCard).join('');
    }

    async function renderTemplatePicker() {
        const grid = document.getElementById('backstageTemplateGrid');
        if (!grid) return;
        grid.innerHTML = renderBlankPlanCard();
        const data = await loadTemplates();
        if (!data) return; // Blank stays visible; grid just skips real templates.
        grid.innerHTML = renderBlankPlanCard() + (data.templates || []).map(renderTemplateCard).join('');
    }

    /** Looks up a template by id from whichever of the strip/grid the click
     * came from -- both render off the same `templatesData` cache. */
    function findTemplate(templateId) {
        const all = (templatesData && templatesData.templates) || [];
        return all.find((t) => t.id === templateId);
    }

    function showTemplatesView() {
        const recentView = document.getElementById('backstageRecentView');
        const templatesView = document.getElementById('backstageTemplatesView');
        if (!recentView || !templatesView) return;
        renderTemplatePicker();
        recentView.style.display = 'none';
        templatesView.style.display = '';
    }

    function showRecentView() {
        const recentView = document.getElementById('backstageRecentView');
        const templatesView = document.getElementById('backstageTemplatesView');
        if (!recentView || !templatesView) return;
        templatesView.style.display = 'none';
        recentView.style.display = '';
    }

    // ── Full-screen enter/exit ──────────────────────────────────────────

    // The view to return to on exit -- captured once, right as Backstage
    // activates (see NavigationController.register('backstage') below),
    // from NavigationController.getPreviousView() (script.js). That getter
    // reflects whatever was current the instant *this* navigation began, so
    // reading it here (rather than getCurrentView()) is what makes "return
    // to whatever view was active on entry" correct even though activate()
    // itself only runs after currentView has already become 'backstage'.
    let entryView = null;

    /** ← arrow / Esc: the one way out of full-screen Backstage (#972). Falls
     * back to 'portfolio' when there's nothing sensible to return to --
     * first run with no project open, or entryView somehow being
     * 'backstage' itself (e.g. File clicked again while already here). */
    function exitBackstage() {
        const target = (entryView && entryView !== 'backstage') ? entryView : 'portfolio';
        if (typeof switchToView === 'function') switchToView(target);
    }

    // ── Wiring ───────────────────────────────────────────────────────────

    function handleTemplateCardClick(e) {
        const card = e.target.closest('.backstage-template-card[data-template-id]');
        if (!card) return;
        if (card.dataset.templateId === 'blank') {
            runFileAction('New plan');
            return;
        }
        const template = findTemplate(card.dataset.templateId);
        if (typeof notAvailable === 'function') {
            notAvailable(template ? template.title : 'This template');
        }
    }

    function init() {
        const backArrow = document.getElementById('backstageBackBtn');
        if (backArrow) {
            backArrow.addEventListener('click', exitBackstage);
        }

        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if (typeof NavigationController === 'undefined') return;
            if (NavigationController.getCurrentView() !== 'backstage') return;
            exitBackstage();
        });

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

        // "More templates →" (#972) lands in the same place as the rail's
        // own Templates button -- both just open the full browser.
        const moreBtn = document.getElementById('backstageMoreTemplatesBtn');
        if (moreBtn) {
            moreBtn.addEventListener('click', showTemplatesView);
        }

        const strip = document.getElementById('backstageTemplateStrip');
        if (strip) {
            strip.addEventListener('click', handleTemplateCardClick);
        }

        const backBtn = document.getElementById('backstageTemplatesBackBtn');
        if (backBtn) {
            backBtn.addEventListener('click', showRecentView);
        }

        const grid = document.getElementById('backstageTemplateGrid');
        if (grid) {
            grid.addEventListener('click', handleTemplateCardClick);
        }

        if (typeof NavigationController !== 'undefined') {
            NavigationController.register('backstage', {
                activate() {
                    entryView = NavigationController.getPreviousView();
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
                    // Hide the project subnav while in backstage view (it isn't project-scoped)
                    const planSubnav = document.getElementById('planSubnav');
                    if (planSubnav) planSubnav.classList.remove('visible');
                    // #972: full screen -- header/ribbon/status bar hide
                    // under this class (backstage.css); the back arrow
                    // above is what makes that not a trap.
                    document.body.classList.add('backstage-fullscreen');
                    showRecentView();
                    renderRecent();
                    renderTemplateStrip();
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
