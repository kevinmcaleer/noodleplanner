/**
 * programme.js — Programme altitude (issue #953, the navigation half of
 * #733/#910's Programme epic). Registers the 'programme' NavigationController
 * view: a minimal landing page showing a programme's name and its member
 * projects, reusing deriveProgrammes() from portfolio-projects-table.js
 * (#951/#952). The real programme dashboard/risk/dependencies/resourcing
 * views (#734/#736/#737/#739) replace this later -- this file's job is only
 * the altitude transition itself: drilling in from the portfolio's
 * programme badge sets the breadcrumb rung (nav.js/ribbon.js) and switches
 * the ribbon to PROGRAMME_TABS (ribbon-ia.js), landing here.
 *
 * Depends on: portfolio-projects-table.js (deriveProgrammes,
 * loadAllProjectsIntoCache, escapeHtml), script.js (NavigationController),
 * ribbon.js (setRibbonScope) -- all loaded before this file resolves any of
 * these at call time (classic scripts, same pattern as nav.js's own
 * dependency on state.js).
 */

let currentProgrammeSlug = null;

/**
 * Drill into a programme from anywhere in the app: the portfolio table's
 * programme badge, a breadcrumb rung click (ribbon.js), or the ribbon's
 * Programme scope pill when a programme is already in context.
 */
function openProgramme(slug) {
    if (!slug) return;
    currentProgrammeSlug = slug;
    NavigationController.navigateTo('programme');
}

/**
 * The programme currently shown at programme altitude, or null when
 * nothing's been drilled into yet, or the last one drilled into no longer
 * has any member projects (e.g. its projects were all ungrouped while
 * viewing it -- #952's "Remove from programme").
 */
function getCurrentPortfolioProgramme() {
    if (!currentProgrammeSlug || typeof loadAllProjectsIntoCache !== 'function' || typeof deriveProgrammes !== 'function') {
        return null;
    }
    const projects = loadAllProjectsIntoCache();
    return deriveProgrammes(projects).find((p) => p.slug === currentProgrammeSlug) || null;
}

/**
 * Render the minimal programme landing view: name, project count, and a
 * grid of member projects reusing the portfolio grid card markup/CSS
 * (renderProjectsList()'s .portfolio-project-card) so it looks and
 * dark-mode-behaves consistently without new component CSS.
 */
function renderProgrammeView() {
    const titleEl = document.getElementById('programmeViewTitle');
    const metaEl = document.getElementById('programmeViewMeta');
    const gridEl = document.getElementById('programmeViewProjects');
    if (!titleEl || !gridEl) return;

    const programme = getCurrentPortfolioProgramme();
    if (!programme) {
        titleEl.textContent = 'Programme not found';
        if (metaEl) {
            metaEl.textContent = 'It has no member projects left, or none was selected. Go back to Portfolio and pick a programme badge.';
        }
        gridEl.innerHTML = '';
        return;
    }

    titleEl.textContent = programme.name;
    const count = programme.projects.length;
    if (metaEl) metaEl.textContent = `${count} project${count === 1 ? '' : 's'} in this programme`;

    if (count === 0) {
        gridEl.innerHTML = '<div class="portfolio-empty-state"><h3>No projects yet</h3>' +
            '<p>Group a project into this programme from the Portfolio view.</p></div>';
        return;
    }

    const currentProjectId = (typeof getCurrentProjectId === 'function') ? getCurrentProjectId() : null;
    gridEl.innerHTML = '<div class="portfolio-projects-grid">' + programme.projects.map((project) => {
        const isActive = project.id === currentProjectId;
        return `
            <div class="portfolio-project-card${isActive ? ' active' : ''}">
                <div class="portfolio-project-header">
                    <h3>${escapeHtml(project.name)}</h3>
                    ${isActive ? '<span class="portfolio-active-badge">Active</span>' : ''}
                </div>
                <div class="portfolio-project-actions">
                    <button type="button" class="btn-primary" data-open-programme-project="${escapeHtml(project.id)}">Open</button>
                </div>
            </div>
        `;
    }).join('') + '</div>';
}

/** Drill further from the programme landing view into one of its member
 * projects (issue #953) -- the breadcrumb then reads Portfolio › Programme
 * › Project, derived from that project's own `programme:` front matter
 * (see nav.js's computeBreadcrumbRungs()), not from currentProgrammeSlug. */
function openProjectFromProgramme(projectId) {
    if (typeof setRibbonScope === 'function') setRibbonScope('project');
    if (typeof openProjectDashboard === 'function') {
        openProjectDashboard(projectId);
    } else if (typeof switchToProject === 'function') {
        switchToProject(projectId);
    }
}

document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-open-programme-project]');
    if (btn) openProjectFromProgramme(btn.dataset.openProgrammeProject);
});

function initProgrammeNav() {
    if (typeof NavigationController === 'undefined') return;

    NavigationController.register('programme', {
        activate() {
            if (typeof deactivateKanban === 'function') deactivateKanban();
            if (typeof saveCurrentProjectState === 'function') saveCurrentProjectState();
            if (typeof activateTabContent === 'function') activateTabContent('programme');
            if (typeof updateRaidExportVisibility === 'function') updateRaidExportVisibility('programme');
            if (typeof closeAllNavMenus === 'function') closeAllNavMenus();
            if (typeof setActiveNavTab === 'function') setActiveNavTab(null);
            const planSubnav = document.getElementById('planSubnav');
            if (planSubnav) planSubnav.classList.remove('visible');
            if (typeof setRibbonScope === 'function') setRibbonScope('programme');
            renderProgrammeView();
        },
        deactivate() {},
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initProgrammeNav);
} else {
    initProgrammeNav();
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { openProgramme, getCurrentPortfolioProgramme };
}
