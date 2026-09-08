/**
 * programme.js — Programme altitude (issue #953's landing view, extended by
 * #734 into the real programme overview dashboard: SRO, vision/outcomes
 * summary, member projects with rolled-up RAG status, key milestones,
 * escalated-risk count, benefits-on-track count).
 *
 * What's real vs stubbed here (see the #734 PR description for the full
 * rationale):
 *   - Member projects + individual/rolled-up RAG: real, computed the same
 *     way the rest of the app computes RAG (extractRAGStatus() in
 *     portfolio-status.js, fed by /api/parse via parseAllProjects()).
 *   - Key milestones: real, the same zero-duration-task convention the
 *     portfolio timeline view uses (portfolio-timeline.js).
 *   - Benefits on track: real when member projects have benefit items with
 *     a status recorded (BEN_STATUS_OPTIONS, benefits.js); an honest stub
 *     ("Not yet tracked") when none do.
 *   - Escalated risks: stubbed -- depends on risk/issue escalation (#736),
 *     which doesn't exist yet.
 *   - SRO and vision/outcomes summary: stubbed -- #910's architecture has
 *     no programme-level file/storage (a programme is just a shared
 *     `programme:` slug on its member projects), and no per-project field
 *     naturally maps onto a programme-wide owner or vision statement.
 *     Where programme-level data should actually live is #954's job, not
 *     this issue's -- inventing a new persisted field here would fight
 *     that decision instead of waiting for it.
 *
 * Depends on: portfolio-projects-table.js (deriveProgrammes,
 * loadAllProjectsIntoCache, escapeHtml), multi-plan-loader.js
 * (parseAllProjects), portfolio-status.js (extractRAGStatus,
 * calculateProjectCompletionFromTasks), state.js (BENEFITS_START and
 * sibling section markers), benefits.js (parseBenefitsMarkdown), script.js
 * (NavigationController), ribbon.js (setRibbonScope) -- all loaded before
 * this file resolves any of these at call time (classic scripts, same
 * pattern as nav.js's own dependency on state.js).
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
 * Roll a list of {id, name, rag} project RAG entries up into per-colour
 * counts and a worst-case summary -- a programme is only as healthy as its
 * worst member project (red beats amber beats green). Pure/testable: takes
 * already-computed per-project RAG values rather than computing them
 * itself (that's extractRAGStatus()'s job, reused as-is).
 */
function computeRagRollup(projectRags) {
    const counts = { red: 0, amber: 0, green: 0 };
    (projectRags || []).forEach((p) => {
        if (p && Object.prototype.hasOwnProperty.call(counts, p.rag)) counts[p.rag]++;
    });
    const worst = counts.red > 0 ? 'red' : (counts.amber > 0 ? 'amber' : (counts.green > 0 ? 'green' : null));
    return { counts, worst };
}

/**
 * Pull milestone tasks out of one project's parsed task list, tagging each
 * with its project for the programme-wide list. Milestones are zero-
 * duration tasks with a finish date -- the same convention the portfolio
 * timeline view uses (see `milestones` in portfolio-timeline.js).
 */
function extractProjectMilestones(tasks, projectId, projectName) {
    return (tasks || [])
        .filter((t) => t && !t.is_summary && t.duration_days === 0 && t.finish)
        .map((t) => ({
            projectId,
            projectName,
            name: t.name,
            finish: t.finish,
            percent: parseFloat(t.percent) || 0,
        }));
}

/**
 * Pick the programme's "key" milestones out of the full cross-project
 * list: the nearest not-yet-complete milestones, soonest deadline (or most
 * overdue) first. Falls back to the nearest milestones overall when every
 * milestone in the programme is already complete, so the section doesn't
 * just go empty as a programme winds down.
 */
function pickKeyMilestones(milestones, limit) {
    limit = limit || 5;
    const withDates = (milestones || []).filter((m) => m && m.finish);
    const incomplete = withDates.filter((m) => (parseFloat(m.percent) || 0) < 100);
    const source = incomplete.length > 0 ? incomplete : withDates;
    return source
        .slice()
        .sort((a, b) => new Date(a.finish) - new Date(b.finish))
        .slice(0, limit);
}

/**
 * Roll benefit items up into an on-track count. "On track" means the
 * benefit's own status is 'In Progress' or 'Achieved' (BEN_STATUS_OPTIONS,
 * benefits.js) -- 'Not Started' is too early to call on-track, and
 * 'Partially Achieved'/'Not Achieved' aren't on track. Benefits with no
 * status recorded yet aren't counted as tracked either way. Only items of
 * type 'benefit' count -- dis-benefits/enablers/changes/objectives aren't
 * "benefits" for this purpose.
 *
 * Returns hasData: false when nothing in the programme has a status
 * recorded, so the caller can show an honest "Not yet tracked" stub
 * instead of a misleading "0 of 0".
 */
function aggregateBenefitsOnTrack(benefitItems) {
    const benefits = (benefitItems || []).filter((b) => b && (b.type || 'benefit').toLowerCase() === 'benefit');
    const tracked = benefits.filter((b) => b.status);
    if (tracked.length === 0) return { hasData: false, total: 0, onTrack: 0 };
    const onTrack = tracked.filter((b) => b.status === 'In Progress' || b.status === 'Achieved').length;
    return { hasData: true, total: tracked.length, onTrack };
}

/**
 * Extract this project's benefit items (with status) straight from its
 * plan text, bypassing /api/parse's benefits_items -- the backend's
 * parse_benefits_markdown() (format_converter.py) doesn't carry the
 * Status column through, so the only place a benefit's tracked status
 * actually survives is the raw markdown table in the plan text itself.
 * Reuses parseBenefitsMarkdown() (benefits.js), the same parser the
 * single-project Benefits view uses to read that column.
 */
function extractProgrammeBenefitItems(planText) {
    if (!planText || typeof BENEFITS_START === 'undefined' || typeof parseBenefitsMarkdown !== 'function') {
        return [];
    }
    const idx = planText.indexOf(BENEFITS_START);
    if (idx === -1) return [];

    const afterStart = idx + BENEFITS_START.length;
    let endIdx = planText.length;
    [BUDGET_START, RAID_LOG_START, COMMS_START, LESSONS_START, BASELINE_START, WHITEBOARD_START].forEach((marker) => {
        const markerIdx = planText.indexOf(marker, afterStart);
        if (markerIdx !== -1 && markerIdx < endIdx) endIdx = markerIdx;
    });

    const parsed = parseBenefitsMarkdown(planText.substring(afterStart, endIdx));
    return (parsed && parsed.items) ? parsed.items : [];
}

/**
 * Honest stub banner for the fields this issue deliberately doesn't build
 * real data for -- SRO and the vision/outcomes summary. See the file
 * header comment for why: no programme-level storage exists yet (#954).
 */
function renderProgrammeOverviewNote() {
    return '' +
        '<div class="programme-stub-banner">' +
        '<p><strong>SRO:</strong> <span class="programme-stub-value">Not yet tracked</span> — programmes have no storage of their own yet ' +
        '(<a href="https://github.com/kevinmcaleer/noodleplanner/issues/954" target="_blank" rel="noopener">#954</a>), and no existing per-project field maps onto a programme-level owner.</p>' +
        '<p><strong>Vision / outcomes:</strong> <span class="programme-stub-value">Not yet tracked</span> — same reason: there is nowhere at programme level to persist a summary until #954 settles where programme data lives.</p>' +
        '</div>';
}

/** Map an array of {id, rag} entries to {[id]: rag} for cheap lookups while rendering. */
function ragById(projectRags) {
    const map = {};
    (projectRags || []).forEach((p) => { if (p) map[p.id] = p.rag; });
    return map;
}

/**
 * Render the member-project grid, reusing the portfolio grid card markup
 * (.portfolio-project-card) so it looks and dark-mode-behaves consistently
 * without new component CSS. `ragMap` is {[projectId]: 'red'|'amber'|
 * 'green'}; projects not yet in it (dashboard data still loading) get a
 * loading placeholder badge instead of a wrong/blank one.
 */
function renderProgrammeMemberGrid(programme, ragMap) {
    const gridEl = document.getElementById('programmeViewProjects');
    if (!gridEl) return;
    ragMap = ragMap || {};

    const currentProjectId = (typeof getCurrentProjectId === 'function') ? getCurrentProjectId() : null;
    gridEl.innerHTML = '<div class="portfolio-projects-grid">' + programme.projects.map((project) => {
        const isActive = project.id === currentProjectId;
        const rag = ragMap[project.id];
        const ragBadge = rag
            ? `<span class="rag-badge rag-${rag}">${rag.toUpperCase()}</span>`
            : '<span class="rag-badge programme-rag-loading">…</span>';
        return `
            <div class="portfolio-project-card${isActive ? ' active' : ''}">
                <div class="portfolio-project-header">
                    <h3>${escapeHtml(project.name)}</h3>
                    ${ragBadge}
                    ${isActive ? '<span class="portfolio-active-badge">Active</span>' : ''}
                </div>
                <div class="portfolio-project-actions">
                    <button type="button" class="btn-primary" data-open-programme-project="${escapeHtml(project.id)}">Open</button>
                </div>
            </div>
        `;
    }).join('') + '</div>';
}

/** Render the "key metrics" stat tiles: programme RAG roll-up, benefits on track (real or stubbed), escalated risks (always stubbed, #736). */
function renderProgrammeStatTiles(ragRollup, benefitsRollup) {
    const tilesEl = document.getElementById('programmeStatTiles');
    if (!tilesEl) return;

    const ragLabel = ragRollup.worst ? ragRollup.worst.toUpperCase() : '—';
    const ragClass = ragRollup.worst ? ('rag-' + ragRollup.worst) : '';
    const benefitsValue = benefitsRollup.hasData ? `${benefitsRollup.onTrack} / ${benefitsRollup.total}` : 'Not yet tracked';

    tilesEl.innerHTML =
        '<div class="programme-stat-tile">' +
            '<span class="programme-stat-label">Programme RAG</span>' +
            `<span class="programme-stat-value"><span class="rag-badge ${ragClass}">${ragLabel}</span></span>` +
            `<span class="programme-stat-sub">${ragRollup.counts.red} red · ${ragRollup.counts.amber} amber · ${ragRollup.counts.green} green</span>` +
        '</div>' +
        '<div class="programme-stat-tile' + (benefitsRollup.hasData ? '' : ' programme-stat-tile--stub') + '">' +
            '<span class="programme-stat-label">Benefits on Track</span>' +
            `<span class="programme-stat-value">${escapeHtml(benefitsValue)}</span>` +
            (benefitsRollup.hasData ? '' : '<span class="programme-stat-sub">No benefit status recorded yet across member projects</span>') +
        '</div>' +
        '<div class="programme-stat-tile programme-stat-tile--stub">' +
            '<span class="programme-stat-label">Escalated Risks</span>' +
            '<span class="programme-stat-value">—</span>' +
            '<span class="programme-stat-sub">Not yet tracked — depends on risk escalation (#736)</span>' +
        '</div>';
}

/** Render the key-milestones list, or an empty-state hint when the programme's member projects have no zero-duration milestone tasks. */
function renderProgrammeMilestones(milestones) {
    const el = document.getElementById('programmeMilestones');
    if (!el) return;

    if (!milestones || milestones.length === 0) {
        el.innerHTML = '<p class="programme-empty-hint">No milestone tasks (zero-duration tasks) found across this programme\'s member projects.</p>';
        return;
    }

    const today = new Date(new Date().toDateString());
    el.innerHTML = '<ul class="programme-milestone-list">' + milestones.map((m) => {
        const overdue = m.percent < 100 && new Date(m.finish) < today;
        return '<li class="programme-milestone' + (overdue ? ' programme-milestone--overdue' : '') + '">' +
            `<span class="programme-milestone-date">${escapeHtml(m.finish)}</span>` +
            `<span class="programme-milestone-name">${escapeHtml(m.name)}</span>` +
            `<span class="programme-milestone-project">${escapeHtml(m.projectName)}</span>` +
            (m.percent >= 100 ? '<span class="programme-milestone-done">Done</span>' : (overdue ? '<span class="programme-milestone-overdue-flag">Overdue</span>' : '')) +
            '</li>';
    }).join('') + '</ul>';
}

/**
 * Fetch parsed task/benefits data for the programme's member projects
 * (via parseAllProjects(), the same /api/parse batch call the other
 * portfolio-altitude views use) and fill in the dashboard's real-data
 * sections: per-project + rolled-up RAG, key milestones, benefits on
 * track. Guards against the user navigating away/to a different programme
 * while the fetch is in flight.
 */
async function loadProgrammeDashboardData(programme) {
    const slugAtStart = programme.slug;
    if (typeof parseAllProjects !== 'function') return;

    let parsedProjects;
    try {
        parsedProjects = await parseAllProjects();
    } catch (e) {
        parsedProjects = [];
    }

    if (currentProgrammeSlug !== slugAtStart) return;

    const memberIds = new Set(programme.projects.map((p) => p.id));
    const relevant = parsedProjects.filter(({ project }) => memberIds.has(project.id));

    const projectRags = [];
    const allMilestones = [];
    const allBenefitItems = [];

    relevant.forEach(({ project, parsedResult }) => {
        const tasks = (parsedResult && parsedResult.success) ? (parsedResult.tasks || []) : [];
        const frontMatter = (parsedResult && parsedResult.success) ? (parsedResult.front_matter || {}) : {};
        const completion = (typeof calculateProjectCompletionFromTasks === 'function') ? calculateProjectCompletionFromTasks(tasks) : 0;
        const rag = (typeof extractRAGStatus === 'function') ? extractRAGStatus(frontMatter, tasks, completion) : 'green';

        projectRags.push({ id: project.id, name: project.name, rag });
        allMilestones.push(...extractProjectMilestones(tasks, project.id, project.name));
        allBenefitItems.push(...extractProgrammeBenefitItems(project.planText || ''));
    });

    if (currentProgrammeSlug !== slugAtStart) return;

    renderProgrammeMemberGrid(programme, ragById(projectRags));
    renderProgrammeStatTiles(computeRagRollup(projectRags), aggregateBenefitsOnTrack(allBenefitItems));
    renderProgrammeMilestones(pickKeyMilestones(allMilestones, 5));
}

/**
 * Render the programme overview dashboard: name, member-project count,
 * SRO/vision stub banner, key metrics tiles, key milestones, and the
 * member-project grid. The synchronous parts (title, meta, note, and a
 * grid with loading RAG badges) render immediately; loadProgrammeDashboardData()
 * fills in the parts that need /api/parse data once it resolves.
 */
function renderProgrammeView() {
    const titleEl = document.getElementById('programmeViewTitle');
    const metaEl = document.getElementById('programmeViewMeta');
    const gridEl = document.getElementById('programmeViewProjects');
    const noteEl = document.getElementById('programmeDashboardNote');
    const tilesEl = document.getElementById('programmeStatTiles');
    const milestonesEl = document.getElementById('programmeMilestones');
    if (!titleEl || !gridEl) return;

    const programme = getCurrentPortfolioProgramme();
    if (!programme) {
        titleEl.textContent = 'Programme not found';
        if (metaEl) {
            metaEl.textContent = 'It has no member projects left, or none was selected. Go back to Portfolio and pick a programme badge.';
        }
        gridEl.innerHTML = '';
        if (noteEl) noteEl.innerHTML = '';
        if (tilesEl) tilesEl.innerHTML = '';
        if (milestonesEl) milestonesEl.innerHTML = '';
        return;
    }

    titleEl.textContent = programme.name;
    const count = programme.projects.length;
    if (metaEl) metaEl.textContent = `${count} project${count === 1 ? '' : 's'} in this programme`;
    if (noteEl) noteEl.innerHTML = renderProgrammeOverviewNote();

    if (count === 0) {
        gridEl.innerHTML = '<div class="portfolio-empty-state"><h3>No projects yet</h3>' +
            '<p>Group a project into this programme from the Portfolio view.</p></div>';
        if (tilesEl) tilesEl.innerHTML = '';
        if (milestonesEl) milestonesEl.innerHTML = '';
        return;
    }

    if (tilesEl) tilesEl.innerHTML = '<div class="portfolio-loading"><div class="portfolio-loading-spinner"></div></div>';
    if (milestonesEl) milestonesEl.innerHTML = '<div class="portfolio-loading"><div class="portfolio-loading-spinner"></div></div>';

    renderProgrammeMemberGrid(programme, {});
    loadProgrammeDashboardData(programme);
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

if (typeof document !== 'undefined') {
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-open-programme-project]');
        if (btn) openProjectFromProgramme(btn.dataset.openProgrammeProject);
    });
}

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

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initProgrammeNav);
    } else {
        initProgrammeNav();
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        openProgramme,
        getCurrentPortfolioProgramme,
        computeRagRollup,
        extractProjectMilestones,
        pickKeyMilestones,
        aggregateBenefitsOnTrack,
        ragById,
    };
}
