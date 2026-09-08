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
 *   - The "Templates" entry is a deliberately muted placeholder: #944 (the
 *     template picker), #945 (portrait cards) and #946 (seed templates)
 *     plug into #backstageTemplatesBtn later. It is not the same feature as
 *     the ribbon's own "Templates" File-menu item (nav.js's
 *     openTemplatesModal(), which inserts a starter plan into the current
 *     project) -- reusing that here would misrepresent the not-yet-built
 *     #944 gallery as already existing.
 *
 * Depends on:
 *   - NavigationController (script.js) — view registry & navigateTo()
 *   - listProjects / getCurrentProjectId / switchToProject (project-storage.js / portfolio.js)
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
                    if (typeof notAvailable === 'function') {
                        notAvailable('Templates');
                    } else if (typeof showToast === 'function') {
                        showToast('Templates isn’t available yet', 'info');
                    }
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
                    renderRecent();
                },
                deactivate() {},
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
