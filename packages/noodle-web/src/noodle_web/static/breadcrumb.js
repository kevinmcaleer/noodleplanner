/**
 * breadcrumb.js — pure breadcrumb-rung logic for the ribbon title bar
 * (issue #953: Portfolio › <Programme> › <Project>).
 *
 * Pure data/logic: no DOM, no behaviour -- the same split ribbon-ia.js
 * documents for its own tab catalogue ("Pure data: no DOM, no behaviour.
 * ribbon.js resolves..."), which is what lets computeBreadcrumbRungs() be
 * unit-tested with a plain `require()` (see tests/test_breadcrumb.js)
 * rather than needing a browser. ribbon.js's renderBreadcrumb() reads both
 * functions here as globals (classic scripts, same cross-file pattern
 * nav.js already uses for NavigationController) to build the actual
 * clickable rungs.
 */

/**
 * Compute the breadcrumb rungs for the current navigation state.
 *
 * Portfolio is always the root rung. A Programme rung is inserted only
 * when it's relevant: either the programme-altitude view itself is
 * showing (params.programme), or the active project belongs to one
 * (params.project.programme). A Project rung is the active project, when
 * there is one. Any other combination (no project, backstage, upload)
 * degrades to no rungs at all rather than a broken/empty one.
 *
 * @param {Object} params
 * @param {string} params.view - NavigationController's current view id.
 * @param {{name: string, programme: ({slug: string, name: string}|null)}|null} [params.project]
 *   - the active project, read when the view is a project-context view.
 * @param {{slug: string, name: string}|null} [params.programme]
 *   - the programme being shown, read when params.view === 'programme'.
 * @returns {Array<{kind: 'portfolio'|'programme'|'project', label: string, slug?: string, active: boolean}>}
 */
function computeBreadcrumbRungs(params) {
    const view = params && params.view;

    if (view === 'portfolio') {
        return [{ kind: 'portfolio', label: 'Portfolio', active: true }];
    }

    if (view === 'programme') {
        const rungs = [{ kind: 'portfolio', label: 'Portfolio', active: false }];
        const programme = params.programme;
        if (programme) {
            rungs.push({ kind: 'programme', label: programme.name, slug: programme.slug, active: true });
        }
        return rungs;
    }

    if (!view || view === 'backstage' || view === 'upload') return [];

    const project = params.project;
    if (!project) return [];

    const rungs = [{ kind: 'portfolio', label: 'Portfolio', active: false }];
    if (project.programme) {
        rungs.push({ kind: 'programme', label: project.programme.name, slug: project.programme.slug, active: false });
    }
    rungs.push({ kind: 'project', label: project.name, active: true });
    return rungs;
}

/**
 * Resolve the active project's name + programme membership for the
 * breadcrumb. Reads from storage (getCurrentProjectId/loadProject,
 * project-storage.js), same source portfolio-projects-table.js's table
 * reads from -- not the live editor buffer, so it's correct even mid-edit
 * before a save.
 */
function getActiveProjectForBreadcrumb() {
    if (typeof getCurrentProjectId !== 'function' || typeof loadProject !== 'function') return null;
    const id = getCurrentProjectId();
    if (!id) return null;
    const project = loadProject(id);
    if (!project) return null;
    const programme = (typeof extractProjectProgramme === 'function')
        ? extractProjectProgramme(project.planText || '')
        : null;
    return { name: project.name, programme: programme };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { computeBreadcrumbRungs, getActiveProjectForBreadcrumb };
}
