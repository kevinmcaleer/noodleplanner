/**
 * backstage.js — Office-Backstage-style shell behind Home (issue #943,
 * sub-issue of epic #903).
 *
 * Provides:
 *   - #backstage-tab: a left rail of file actions (New plan, Open, Import,
 *     Export, Templates, Print, Settings) plus a "Recent" grid of projects
 *     built from project-storage.js's listProjects().
 *   - File actions reuse ribbon.js's own FILE_ACTIONS map rather than
 *     re-implementing project creation/import/export -- see runFileAction()
 *     below. ribbon.js is a classic (non-module) script, so its top-level
 *     `const FILE_ACTIONS` is readable here as a shared lexical binding once
 *     it has run, the same cross-script pattern ribbon.js itself uses for
 *     NavigationController/currentThemeChoice (see ribbon.js's comments).
 *   - #backstageTemplatesBtn (#944, this file) swaps the main area into a
 *     template-picker sub-view (#backstageTemplatesView) instead of the
 *     Recent grid. It is not the same feature as the ribbon's own
 *     "Templates" File-menu item (nav.js's openTemplatesModal(), which
 *     inserts a starter plan into the *current* project, overwriting it).
 *     Picking a card here **creates a new plan** and leaves Backstage --
 *     see createPlanFromTemplate() below. Card rendering is still a plain
 *     placeholder; #945 gives it the real portrait renderer, see
 *     renderTemplateCard().
 *   - Templates come from the same `/api/templates` endpoint the ribbon's
 *     Templates modal already uses (app.py), not a hardcoded list.
 *
 * Depends on:
 *   - NavigationController (script.js) — view registry & navigateTo()
 *   - listProjects / getCurrentProjectId / createProject / saveCurrentProjectState
 *     (project-storage.js)
 *   - switchToProject / switchMainTab / showNotification / renderProjectsList (portfolio.js)
 *   - loadProjectIntoEditor / refreshProjectSelectors (multi-plan-loader.js)
 *   - setFrontMatterField / renderProjectsTable (portfolio-projects-table.js)
 *   - FILE_ACTIONS / notAvailable (ribbon.js)
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

    // ── New plan creation ────────────────────────────────────────────────

    /**
     * The plan text a new project starts from, given a template's `.md`
     * content and the name the user chose for the plan.
     *
     * Templates carry their own `title:` in front matter (e.g. "Software
     * Delivery Project"), which would otherwise disagree with the project
     * name everywhere the two are read side by side -- browser-excel.js and
     * mpp-export.js both fall back between `frontMatter.title` and the
     * project name. Rewriting it here keeps them in step from the start.
     * Pure: exported for tests, no DOM.
     */
    function planTextFromTemplate(content, name) {
        const text = content || '';
        if (!name) return text;
        if (typeof setFrontMatterField !== 'function') return text;
        return setFrontMatterField(text, 'title', name);
    }

    /**
     * Create a plan, load it, and leave Backstage for the editor.
     *
     * Follows portfolio.js's showCreateProjectDialog() -- the existing
     * creation precedent -- and adds the switch out of Backstage, since
     * unlike that dialog this is invoked from a view the new plan isn't
     * visible in. `planText` empty means a blank plan.
     */
    async function createPlan(name, planText, message) {
        if (typeof createProject !== 'function') {
            if (typeof notAvailable === 'function') notAvailable('New plan');
            return null;
        }

        // Save the outgoing project first: the editor still holds its text
        // and it is still the current project until loadProjectIntoEditor
        // below moves the pointer.
        if (typeof saveCurrentProjectState === 'function') {
            saveCurrentProjectState();
        }

        const project = createProject(name, planText);
        if (!project) return null;

        // Load first, switch second -- the same order portfolio.js's
        // switchToProject() uses, so the editor never flashes the outgoing
        // plan on the way in.
        if (typeof loadProjectIntoEditor === 'function') {
            await loadProjectIntoEditor(project.id);
        }
        if (typeof renderProjectsList === 'function') renderProjectsList();
        if (typeof refreshProjectSelectors === 'function') refreshProjectSelectors();
        if (typeof renderProjectsTable === 'function') renderProjectsTable();
        if (typeof switchMainTab === 'function') switchMainTab('editor');
        if (typeof showNotification === 'function') {
            showNotification(message || ('Project created: ' + project.name));
        }
        return project;
    }

    /** Blank-plan card, and the rail's "New plan" -- same action, one path. */
    async function createBlankPlan() {
        const name = prompt('Enter project name:');
        if (!name) return;
        await createPlan(name, '');
    }

    /**
     * Fetch a template's `.md` and start a new plan from it. This is the
     * difference from the ribbon's Templates modal (nav.js useTemplate()),
     * which loads template content over whatever plan is currently open.
     */
    async function createPlanFromTemplate(templateId, card) {
        const label = card ? card.querySelector('.backstage-template-card-name') : null;
        const originalLabel = label ? label.textContent : '';
        try {
            if (card) card.disabled = true;
            if (label) label.textContent = 'Loading…';

            const response = await fetch(`/api/templates/${encodeURIComponent(templateId)}`);
            if (!response.ok) throw new Error('Failed to load template');
            const template = await response.json();

            const name = prompt('Name for the new plan:', template.title || '');
            if (!name) return;

            await createPlan(
                name,
                planTextFromTemplate(template.content, name),
                `Created "${name}" from the ${template.title} template`
            );
        } catch (err) {
            console.error('Error creating plan from template:', err);
            if (typeof showNotification === 'function') {
                showNotification('Could not create a plan from that template: ' + err.message, 'error');
            }
        } finally {
            if (card) card.disabled = false;
            if (label) label.textContent = originalLabel;
        }
    }

    // ── Template picker ─────────────────────────────────────────────────

    // Cached `/api/templates` payload -- the same endpoint and shape the
    // ribbon's Templates modal uses (nav.js's templatesData).
    let templatePickerData = null;

    async function loadTemplates() {
        if (templatePickerData) return templatePickerData;
        const response = await fetch('/api/templates');
        if (!response.ok) throw new Error('Failed to load templates');
        const data = await response.json();
        templatePickerData = Array.isArray(data.templates) ? data.templates : [];
        return templatePickerData;
    }

    function renderTemplateCard(template) {
        // #945 replaces this body with the real portrait-rendered card.
        const description = template.description
            ? `<span class="backstage-template-card-desc">${escapeHtml(template.description)}</span>`
            : '';
        return `
            <button type="button" class="backstage-template-card" data-template-id="${escapeHtml(template.id)}">
                <span class="backstage-template-card-icon">
                    <svg class="icon" width="28" height="28" aria-hidden="true"><use href="#icon-doc"/></svg>
                </span>
                <span class="backstage-template-card-name">${escapeHtml(template.title || template.id)}</span>
                ${description}
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

    async function renderTemplatePicker() {
        const grid = document.getElementById('backstageTemplateGrid');
        if (!grid) return;

        // Blank is always available, so render it before the fetch resolves
        // rather than blanking the grid behind a spinner.
        grid.innerHTML = renderBlankPlanCard() +
            '<p class="backstage-template-status">Loading templates…</p>';

        try {
            const templates = await loadTemplates();
            grid.innerHTML = renderBlankPlanCard() + templates.map(renderTemplateCard).join('');
        } catch (err) {
            console.error('Error loading templates:', err);
            grid.innerHTML = renderBlankPlanCard() +
                '<p class="backstage-template-status backstage-template-status-error">' +
                'Templates could not be loaded. You can still start a blank plan.</p>';
        }
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

    // ── Wiring ───────────────────────────────────────────────────────────

    function init() {
        const rail = document.querySelector('.backstage-rail');
        if (rail) {
            rail.addEventListener('click', (e) => {
                const actionBtn = e.target.closest('[data-backstage-action]');
                if (actionBtn) {
                    // "New plan" is the rail's spelling of the Blank card, so
                    // it takes the same path -- FILE_ACTIONS' version creates
                    // the project but leaves you looking at Backstage, which
                    // is wrong from a view the new plan isn't listed in.
                    if (actionBtn.dataset.backstageAction === 'New plan') {
                        createBlankPlan();
                    } else {
                        runFileAction(actionBtn.dataset.backstageAction);
                    }
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

        const backBtn = document.getElementById('backstageTemplatesBackBtn');
        if (backBtn) {
            backBtn.addEventListener('click', showRecentView);
        }

        const grid = document.getElementById('backstageTemplateGrid');
        if (grid) {
            grid.addEventListener('click', (e) => {
                const card = e.target.closest('.backstage-template-card[data-template-id]');
                if (!card) return;
                if (card.dataset.templateId === 'blank') {
                    createBlankPlan();
                    return;
                }
                createPlanFromTemplate(card.dataset.templateId, card);
            });
        }

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
                    // Hide the project subnav while in backstage view (it isn't project-scoped)
                    const planSubnav = document.getElementById('planSubnav');
                    if (planSubnav) planSubnav.classList.remove('visible');
                    showRecentView();
                    renderRecent();
                },
                deactivate() {},
            });
        }
    }

    // Guarded so the file can be require()d under node for unit tests, where
    // there is no document to wire up -- see tests/test_backstage_templates.js.
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
        } else {
            init();
        }
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { planTextFromTemplate };
    }
})();
