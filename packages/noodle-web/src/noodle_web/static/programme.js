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
 *   - Escalated risks & issues: real (#736) -- rolled up from each member
 *     project's RAID log (raid_items via /api/parse), filtered to items
 *     with escalation_level 'programme' or 'board' (a board-escalated item
 *     is still escalated at least as far as programme altitude, so it's
 *     included too).
 *   - Dependencies (RAG board): real (#737) -- the portfolio-wide
 *     dependency store (portfolio-dependencies.js, DEPS_META_KEY) filtered
 *     down to links touching this programme's member projects
 *     (filterDependenciesForProgramme(), tagging each 'internal' when both
 *     ends are members or 'external' when one end reaches outside the
 *     programme -- the issue's "inter/intra project" distinction), with
 *     RAG health from the existing /api/programme-dependencies/propagate
 *     endpoint reused as-is (propagateProgrammeDependencies()). See
 *     portfolio-dependencies.js's header comment for why the dependency
 *     store, not front matter, stays the single editable source.
 *   - Resourcing (demand vs capacity): real (#739) -- reuses
 *     aggregateResourceDemandVsCapacity() (portfolio-resources.js, itself
 *     built on aggregateResourceDataFromParsed(), the same demand
 *     computation the portfolio-wide Team Allocation view uses) scoped to
 *     this programme's member projects via aggregateProgrammeResourceDemand()
 *     below, rather than reimplementing resource math. Capacity uses the
 *     same day-for-day assumption portfolio-leveling.js's
 *     LEVELLING_DAILY_CAPACITY names for its own overload detection.
 *   - SRO, vision and outcomes: real (#954/#735) -- #954 decided
 *     programme-owned data (data with no project to derive it from) gets
 *     its own lazily-created record, `programme-data-store.js`'s
 *     `noodleplanner_programme_data`, keyed by programme slug. SRO and
 *     vision are free text; outcomes are a short named list. Previously
 *     stubbed here as "not yet tracked" pending that decision (#734/PR
 *     #978) -- see programme-data-store.js's header comment for the
 *     record's full shape and how #738/#740/#741/#742 will extend it.
 *   - Benefits realisation: real (#735) -- for each programme outcome,
 *     which project benefits (type 'benefit', benefits.js) are linked to
 *     it and by how much. A benefit's own linked_to/contribution_percent
 *     (benefits.js) is intra-project only (it chains to another row in
 *     that SAME project's own benefits table), so it can't itself name a
 *     programme outcome living outside that project -- the outcome link
 *     lives in programme-data-store.js's benefitLinks instead, the same
 *     "cross-project relationship gets its own store" pattern #737 uses
 *     for dependencies (see portfolio-dependencies.js's header comment).
 *     computeOutcomeContributions() below is the pure rollup, pairing each
 *     outcome with its linked benefits and summing contribution_percent.
 *
 * Depends on: portfolio-projects-table.js (deriveProgrammes,
 * loadAllProjectsIntoCache, escapeHtml), multi-plan-loader.js
 * (parseAllProjects), portfolio-status.js (extractRAGStatus,
 * calculateProjectCompletionFromTasks), state.js (BENEFITS_START and
 * sibling section markers), benefits.js (parseBenefitsMarkdown), script.js
 * (NavigationController), ribbon.js (setRibbonScope), project-storage.js
 * (listProjects), portfolio-dependencies.js (getAllProgrammeDependencies,
 * propagateProgrammeDependencies, ragCircleHtml, ragToColour,
 * showAddDependencyDialog, showEditDependencyDialog,
 * confirmDeleteProgrammeDependency), portfolio-resources.js
 * (aggregateResourceDemandVsCapacity), programme-data-store.js
 * (getProgrammeData, setProgrammeData, addProgrammeOutcome,
 * updateProgrammeOutcome, deleteProgrammeOutcome, linkBenefitToOutcome,
 * unlinkBenefitFromOutcome) -- all loaded before this file resolves any
 * of these at call time (classic scripts, same pattern as nav.js's own
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
 * Roll escalated risks and issues up across a programme's member projects
 * (#736 -- "the case that motivated the altitude model": the same
 * risk/issue register widget as the project RAID view and the portfolio
 * risks view, just scoped to this programme's projects and filtered to
 * what's been escalated to it).
 *
 * An item counts here when its type is risk or issue *and* it's escalated
 * to this altitude or higher: escalation_level 'programme' or 'board'.
 * 'project' (the default -- not escalated) is excluded. A board-escalated
 * item is still relevant at programme altitude -- it's escalated even
 * further, not somewhere else -- so 'board' is included too, even though
 * this issue doesn't build a board-level view to drill into.
 *
 * @param {Array<{projectId, projectName, items: Array}>} raidItemsByProject
 *   Each project's raw raid_items list from /api/parse, tagged with the
 *   project it came from.
 * @returns {Array} flat list of escalated risk/issue objects, sorted by
 *   score (highest first) -- same convention as collectOpenRisksAndIssues
 *   in portfolio-risks.js.
 */
function aggregateEscalatedRaidItems(raidItemsByProject) {
    const results = [];

    (raidItemsByProject || []).forEach((entry) => {
        if (!entry) return;
        const projectId = entry.projectId;
        const projectName = entry.projectName;

        (entry.items || []).forEach((item) => {
            if (!item || !item.type) return;
            const type = item.type.toLowerCase();
            if (type !== 'risk' && type !== 'issue') return;
            if (!item.escalated) return;

            const level = item.escalation_level || 'project';
            if (level !== 'programme' && level !== 'board') return;

            results.push({
                projectId,
                projectName,
                raidItemId: item.id,
                type,
                title: item.title || item.description || '-',
                description: item.description || '',
                owner: item.owner || '',
                impact: item.impact != null ? item.impact : 0,
                likelihood: item.likelihood != null ? item.likelihood : 0,
                score: item.score != null ? item.score : 0,
                status: item.status || 'open',
                escalationLevel: level,
            });
        });
    });

    results.sort((a, b) => b.score - a.score);
    return results;
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
 * Render the SRO/vision/outcomes editor (#954/#735, replacing #734's
 * "not yet tracked" stub) into #programmeSroVision. Reads/writes the
 * programme's record via programme-data-store.js, lazily created on the
 * first edit -- a programme nobody has set an SRO/vision/outcome for yet
 * has no record and this renders empty inputs, not an error.
 */
function renderProgrammeSroVision(programme) {
    const el = document.getElementById('programmeSroVision');
    if (!el) return;

    const data = (typeof getProgrammeData === 'function') ? (getProgrammeData(programme.slug) || {}) : {};
    const outcomes = data.outcomes || [];
    const slugAttr = escapeHtml(programme.slug).replace(/'/g, "\\'");

    const outcomesHtml = outcomes.length === 0
        ? '<np-empty-state>No outcomes defined yet. Outcomes are what project benefits roll up into, below.</np-empty-state>'
        : '<ul class="programme-milestone-list">' + outcomes.map((o) =>
            '<li class="programme-milestone">' +
            `<span class="programme-outcome-name">${escapeHtml(o.name)}</span>` +
            (o.description ? `<span class="programme-outcome-desc">${escapeHtml(o.description)}</span>` : '') +
            `<button type="button" class="btn-danger btn-sm" onclick="deleteProgrammeOutcomeConfirm('${slugAttr}', ${o.id})" aria-label="Delete outcome">Delete</button>` +
            '</li>'
        ).join('') + '</ul>';

    el.innerHTML =
        '<div class="programme-form-row">' +
        '<label for="programmeSroInput">SRO</label>' +
        `<input type="text" id="programmeSroInput" class="form-control" maxlength="200" ` +
        `placeholder="Senior Responsible Owner" value="${escapeHtml(data.sro || '')}" ` +
        `onchange="saveProgrammeSro('${slugAttr}', this.value)">` +
        '</div>' +
        '<div class="programme-form-row">' +
        '<label for="programmeVisionInput">Vision</label>' +
        `<textarea id="programmeVisionInput" class="form-control" rows="3" ` +
        `placeholder="What this programme exists to achieve" ` +
        `onchange="saveProgrammeVision('${slugAttr}', this.value)">${escapeHtml(data.vision || '')}</textarea>` +
        '</div>' +
        '<div class="programme-outcomes">' +
        '<h4>Outcomes</h4>' +
        outcomesHtml +
        `<form class="programme-outcome-add" onsubmit="submitAddProgrammeOutcome(event, '${slugAttr}')">` +
        '<input type="text" id="programmeOutcomeNameInput" class="form-control" maxlength="200" placeholder="New outcome name" required>' +
        '<input type="text" id="programmeOutcomeDescInput" class="form-control" maxlength="500" placeholder="Description (optional)">' +
        '<button type="submit" class="btn-secondary btn-sm">Add Outcome</button>' +
        '</form>' +
        '</div>';
}

function saveProgrammeSro(slug, value) {
    if (typeof setProgrammeData !== 'function') return;
    setProgrammeData(slug, { sro: value.trim() || null });
}

function saveProgrammeVision(slug, value) {
    if (typeof setProgrammeData !== 'function') return;
    setProgrammeData(slug, { vision: value.trim() || null });
}

/** Refresh both the SRO/vision/outcomes editor and the benefits rollup -- an outcome add/edit/delete affects what the rollup below has to show. */
function refreshProgrammeOwnedDataView() {
    const programme = getCurrentPortfolioProgramme();
    if (!programme) return;
    renderProgrammeSroVision(programme);
    loadProgrammeDashboardData(programme);
}

function submitAddProgrammeOutcome(event, slug) {
    event.preventDefault();
    const nameInput = document.getElementById('programmeOutcomeNameInput');
    const descInput = document.getElementById('programmeOutcomeDescInput');
    const name = nameInput ? nameInput.value.trim() : '';
    if (!name) return;
    if (typeof addProgrammeOutcome === 'function') {
        addProgrammeOutcome(slug, { name: name, description: descInput ? descInput.value.trim() : '' });
    }
    refreshProgrammeOwnedDataView();
}

function deleteProgrammeOutcomeConfirm(slug, outcomeId) {
    if (!confirm('Delete this outcome? Any project benefits linked to it will be unlinked.')) return;
    if (typeof deleteProgrammeOutcome === 'function') deleteProgrammeOutcome(slug, outcomeId);
    refreshProgrammeOwnedDataView();
}

// ── Benefits realisation rollup (#735) ──────────────────────────────────

/**
 * Roll project benefits up into their linked programme outcomes.
 * `benefitLinks` are the programme's own link records
 * (linkBenefitToOutcome(), programme-data-store.js), each naming a
 * (projectId, benefitItemId) pair and an outcomeId. `benefitItems` is the
 * *live* per-project benefit items for this programme (tagged with
 * projectId/projectName by loadProgrammeDashboardData()) -- used so the
 * rollup shows each benefit's current title/status rather than what was
 * cached at link time, and so a benefit that's since been deleted shows as
 * stale rather than silently vanishing from the outcome it was linked to.
 * Pure/testable, same convention as filterDependenciesForProgramme() (#737).
 */
function computeOutcomeContributions(outcomes, benefitLinks, benefitItems) {
    const liveByKey = {};
    (benefitItems || []).forEach((item) => {
        if (item) liveByKey[item.projectId + ':' + item.id] = item;
    });

    return (outcomes || []).map((outcome) => {
        const contributions = (benefitLinks || [])
            .filter((link) => link && link.outcomeId === outcome.id)
            .map((link) => {
                const live = liveByKey[link.projectId + ':' + link.benefitItemId];
                return {
                    projectId: link.projectId,
                    projectName: live ? live.projectName : '',
                    benefitItemId: link.benefitItemId,
                    title: live ? live.title : (link.benefitTitle || '(deleted benefit)'),
                    status: live ? live.status : '',
                    contributionPercent: link.contributionPercent || 0,
                    stale: !live,
                };
            });
        const totalContributionPercent = contributions.reduce((sum, c) => sum + c.contributionPercent, 0);
        return {
            outcomeId: outcome.id,
            outcomeName: outcome.name,
            contributions: contributions,
            totalContributionPercent: totalContributionPercent,
        };
    });
}

/** Cache of this programme's linkable ('benefit'-type) items, populated by loadProgrammeDashboardData(), read by the "link a benefit" dialog. */
let programmeLinkableBenefitItems = [];

/** Render the Benefits Realisation section: each outcome with its linked project benefits and their summed contribution. */
function renderProgrammeBenefitsRealisation(outcomeContributions, slug) {
    const el = document.getElementById('programmeBenefitsRealisation');
    if (!el) return;

    const addLink = programmeLinkableBenefitItems.length > 0
        ? '<a href="javascript:void(0)" class="add-item-link" onclick="showLinkBenefitToOutcomeDialog()">' +
            '<span class="add-icon">+</span> Link a Benefit to an Outcome</a>'
        : '';
    const toolbar = '<div class="programme-deps-toolbar">' + addLink + '</div>';

    if (!outcomeContributions || outcomeContributions.length === 0) {
        el.innerHTML = toolbar +
            '<np-empty-state>Define an outcome above, then link project benefits to it here.</np-empty-state>';
        return;
    }

    const slugAttr = escapeHtml(slug).replace(/'/g, "\\'");
    el.innerHTML = toolbar + outcomeContributions.map((oc) => {
        const rows = oc.contributions.length === 0
            ? '<np-empty-state>No project benefits linked to this outcome yet.</np-empty-state>'
            : '<table class="programme-resourcing-table"><thead><tr>' +
                '<th scope="col">Project</th><th scope="col">Benefit</th><th scope="col">Status</th>' +
                '<th scope="col">Contribution</th><th scope="col"></th></tr></thead><tbody>' +
                oc.contributions.map((c) => '<tr' + (c.stale ? ' class="programme-benefit-link--stale"' : '') + '>' +
                    '<td>' + escapeHtml(c.projectName || '-') + '</td>' +
                    '<td>' + escapeHtml(c.title) + (c.stale ? ' <span class="programme-stub-value">(no longer found)</span>' : '') + '</td>' +
                    '<td>' + escapeHtml(c.status || '-') + '</td>' +
                    '<td>' + c.contributionPercent + '%</td>' +
                    '<td><button class="btn-danger btn-sm" ' +
                    `onclick="unlinkProgrammeBenefit('${slugAttr}', '${escapeHtml(c.projectId).replace(/'/g, "\\'")}', ${c.benefitItemId})" ` +
                    'aria-label="Unlink">Unlink</button></td>' +
                    '</tr>').join('') +
                '</tbody></table>';
        return '<div class="programme-outcome-rollup">' +
            `<h4>${escapeHtml(oc.outcomeName)} <span class="programme-outcome-total">${oc.totalContributionPercent}% total contribution</span></h4>` +
            rows + '</div>';
    }).join('');
}

/** Open the "link a benefit to an outcome" modal, following the same task-form-modal pattern as portfolio-projects-table.js's programme dialog. */
function showLinkBenefitToOutcomeDialog() {
    const programme = getCurrentPortfolioProgramme();
    if (!programme) return;
    const data = (typeof getProgrammeData === 'function') ? (getProgrammeData(programme.slug) || {}) : {};
    const outcomes = data.outcomes || [];
    if (outcomes.length === 0) { alert('Add a programme outcome first.'); return; }
    if (programmeLinkableBenefitItems.length === 0) { alert("No benefit items found in this programme's member projects."); return; }

    const itemOptions = programmeLinkableBenefitItems.map((b, idx) =>
        `<option value="${idx}">${escapeHtml(b.projectName)} — ${escapeHtml(b.title)}</option>`).join('');
    const outcomeOptions = outcomes.map((o) => `<option value="${o.id}">${escapeHtml(o.name)}</option>`).join('');
    const slugAttr = escapeHtml(programme.slug).replace(/'/g, "\\'");

    const html = '<div id="linkBenefitModalOverlay" class="modal-overlay active" ' +
        'onclick="if(event.target===this)closeLinkBenefitDialog()" role="dialog" aria-modal="true" aria-labelledby="linkBenefitModalTitle">' +
        '<div class="task-form-modal" style="max-width:420px;width:min(420px,92vw);">' +
        '<div class="modal-header">' +
        '<h3 id="linkBenefitModalTitle" style="margin:0;">Link Benefit to Outcome</h3>' +
        '<np-close-button onclick="closeLinkBenefitDialog()"></np-close-button>' +
        '</div>' +
        '<div class="modal-body">' +
        `<form id="linkBenefitForm" onsubmit="submitLinkBenefitToOutcome(event, '${slugAttr}')">` +
        '<div class="form-group"><label for="linkBenefitItemSelect">Project benefit</label>' +
        `<select id="linkBenefitItemSelect" class="form-control">${itemOptions}</select></div>` +
        '<div class="form-group"><label for="linkBenefitOutcomeSelect">Programme outcome</label>' +
        `<select id="linkBenefitOutcomeSelect" class="form-control">${outcomeOptions}</select></div>` +
        '<div class="form-group"><label for="linkBenefitContributionInput">Contribution %</label>' +
        '<input type="number" id="linkBenefitContributionInput" class="form-control" min="0" max="100" value="100"></div>' +
        '<div style="text-align:right;margin-top:16px;">' +
        '<button type="button" class="btn-secondary" onclick="closeLinkBenefitDialog()" style="margin-right:8px;">Cancel</button>' +
        '<button type="submit" class="btn-primary">Link</button>' +
        '</div>' +
        '</form>' +
        '</div>' +
        '</div>' +
        '</div>';

    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container.firstChild);
}

function closeLinkBenefitDialog() {
    const overlay = document.getElementById('linkBenefitModalOverlay');
    if (overlay) overlay.remove();
}

function submitLinkBenefitToOutcome(event, slug) {
    event.preventDefault();
    const itemSelect = document.getElementById('linkBenefitItemSelect');
    const outcomeSelect = document.getElementById('linkBenefitOutcomeSelect');
    const contribInput = document.getElementById('linkBenefitContributionInput');
    const item = itemSelect ? programmeLinkableBenefitItems[parseInt(itemSelect.value, 10)] : null;
    closeLinkBenefitDialog();
    if (!item || !outcomeSelect) return;

    if (typeof linkBenefitToOutcome === 'function') {
        linkBenefitToOutcome(slug, {
            projectId: item.projectId,
            benefitItemId: item.id,
            benefitTitle: item.title,
            outcomeId: parseInt(outcomeSelect.value, 10),
            contributionPercent: contribInput ? parseInt(contribInput.value, 10) || 0 : 0,
        });
    }
    const programme = getCurrentPortfolioProgramme();
    if (programme) loadProgrammeDashboardData(programme);
}

function unlinkProgrammeBenefit(slug, projectId, benefitItemId) {
    if (typeof unlinkBenefitFromOutcome === 'function') unlinkBenefitFromOutcome(slug, projectId, benefitItemId);
    const programme = getCurrentPortfolioProgramme();
    if (programme) loadProgrammeDashboardData(programme);
}

/** Map an array of {id, rag} entries to {[id]: rag} for cheap lookups while rendering. */
function ragById(projectRags) {
    const map = {};
    (projectRags || []).forEach((p) => { if (p) map[p.id] = p.rag; });
    return map;
}

/**
 * Scope the portfolio-wide dependency store (getAllProgrammeDependencies(),
 * portfolio-dependencies.js) down to the links relevant to one programme
 * (#737): a dependency counts when either end -- the source task's project
 * or the dependent task's project -- is a member of the programme. Tags
 * each with 'internal' (both ends are members) or 'external' (one end
 * reaches a project outside the programme), the issue's "intra-project"
 * vs. "inter-project" distinction, so the board can show both without
 * hiding which is which.
 */
function filterDependenciesForProgramme(deps, memberProjectIds) {
    const members = new Set(memberProjectIds || []);
    return (deps || [])
        .filter((d) => d && (members.has(d.from_project_id) || members.has(d.to_project_id)))
        .map((d) => Object.assign({}, d, {
            scope: (members.has(d.from_project_id) && members.has(d.to_project_id)) ? 'internal' : 'external',
        }));
}

/**
 * Aggregate resource demand vs capacity across a programme's member
 * projects (#739 -- "Programme: resourcing"). Reuses
 * aggregateResourceDemandVsCapacity() (portfolio-resources.js) -- itself
 * built on aggregateResourceDataFromParsed(), the same per-resource demand
 * computation behind the portfolio-wide Team Allocation view -- scoped to
 * just this programme's parsed projects instead of the whole portfolio,
 * the same scoping pattern aggregateEscalatedRaidItems() (#736) and
 * filterDependenciesForProgramme() (#737) use for their own portfolio-wide
 * sources. Sorted overloaded-first (ties broken by demand days, highest
 * first) -- the same convention the portfolio-wide table sorts by.
 *
 * @param {Array<{project, parsedResult}>} parsedProjects already filtered
 *   to the programme's member projects (see loadProgrammeDashboardData's
 *   `relevant`).
 * @returns {Array} aggregateResourceDemandVsCapacity()'s per-resource
 *   shape (name, projects, projectCount, totalTasks, totalDays,
 *   workloadLevel, dateRange, capacityDays, utilisationPercent,
 *   overCapacity), sorted overloaded-first.
 */
function aggregateProgrammeResourceDemand(parsedProjects) {
    const resources = (typeof aggregateResourceDemandVsCapacity === 'function')
        ? aggregateResourceDemandVsCapacity(parsedProjects || [])
        : [];
    const workloadOrder = { overloaded: 0, high: 1, medium: 2, low: 3 };
    return resources.slice().sort((a, b) =>
        (workloadOrder[a.workloadLevel] - workloadOrder[b.workloadLevel]) || (b.totalDays - a.totalDays)
    );
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

/** Render the "key metrics" stat tiles: programme RAG roll-up, benefits on track (real or stubbed), escalated risks & issues (real, #736). */
function renderProgrammeStatTiles(ragRollup, benefitsRollup, escalatedCount) {
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
        '<div class="programme-stat-tile">' +
            '<span class="programme-stat-label">Escalated Risks &amp; Issues</span>' +
            `<span class="programme-stat-value">${escalatedCount}</span>` +
            '<span class="programme-stat-sub">Escalated to programme level or higher</span>' +
        '</div>';
}

/** Render the key-milestones list, or an empty-state hint when the programme's member projects have no zero-duration milestone tasks. */
function renderProgrammeMilestones(milestones) {
    const el = document.getElementById('programmeMilestones');
    if (!el) return;

    if (!milestones || milestones.length === 0) {
        el.innerHTML = '<np-empty-state>No milestone tasks (zero-duration tasks) found across this programme\'s member projects.</np-empty-state>';
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
 * Render the escalated risks & issues list, or an empty-state hint when
 * nothing in the programme's member projects is escalated to programme
 * level or higher (#736). Each row opens the source project's RAID form
 * for that item, the same drill-down pattern portfolio-risks.js uses
 * (openProjectRisk).
 */
function renderProgrammeEscalatedRisks(items) {
    const el = document.getElementById('programmeEscalatedRisks');
    if (!el) return;

    if (!items || items.length === 0) {
        el.innerHTML = '<np-empty-state>No risks or issues escalated to programme level across this programme\'s member projects.</np-empty-state>';
        return;
    }

    el.innerHTML = '<ul class="programme-escalated-list">' + items.map((item) => {
        const typeLabel = item.type.charAt(0).toUpperCase() + item.type.slice(1);
        const levelLabel = item.escalationLevel.charAt(0).toUpperCase() + item.escalationLevel.slice(1);
        return '<li class="programme-escalated-item" ' +
            `data-project-id="${escapeHtml(item.projectId)}" data-raid-item-id="${item.raidItemId}">` +
            `<span class="raid-type-badge raid-type-${item.type}">${escapeHtml(typeLabel)}</span>` +
            `<span class="programme-escalated-title">${escapeHtml(item.title)}</span>` +
            `<span class="programme-escalated-project">${escapeHtml(item.projectName)}</span>` +
            `<span class="raid-escalation-badge raid-escalation-${item.escalationLevel}">${escapeHtml(levelLabel)}</span>` +
            '</li>';
    }).join('') + '</ul>';
}

/**
 * Render the programme-scoped dependency RAG board (#737): every
 * inter-/intra-project dependency touching this programme's member
 * projects, filtered by filterDependenciesForProgramme() and health-checked
 * by the same /api/programme-dependencies/propagate call the portfolio-wide
 * dependencies view uses (portfolio-dependencies.js) -- reused, not
 * recomputed. Add/Edit/Delete reuse that file's dialog and CRUD functions
 * directly, so a dependency created here is the same store record the
 * Portfolio > Dependencies view manages.
 */
function renderProgrammeDependencyBoard(deps, propagationResult) {
    const el = document.getElementById('programmeDependencies');
    if (!el) return;

    const addLink = (typeof showAddDependencyDialog === 'function')
        ? '<a href="javascript:void(0)" class="add-item-link" onclick="showAddDependencyDialog()">' +
            '<span class="add-icon">+</span> Add Dependency</a>'
        : '';

    if (!deps || deps.length === 0) {
        el.innerHTML = '<div class="programme-deps-toolbar">' + addLink + '</div>' +
            '<np-empty-state>No dependencies link this programme\'s member projects to other tasks yet.</np-empty-state>';
        return;
    }

    const projects = (typeof listProjects === 'function') ? listProjects() : [];
    const projectNames = {};
    projects.forEach((p) => { projectNames[p.id] = p.name; });

    const propById = {};
    if (propagationResult && propagationResult.results) {
        propagationResult.results.forEach((r) => { propById[r.dependency_id] = r; });
    }

    let html = '<div class="programme-deps-toolbar">' + addLink + '</div>';
    html += '<table class="dep-table" role="table" aria-label="Programme dependencies">';
    html += '<thead><tr>' +
        '<th scope="col">RAG</th>' +
        '<th scope="col">Source Project</th>' +
        '<th scope="col">Source Task</th>' +
        '<th scope="col">Dependent Project</th>' +
        '<th scope="col">Dependent Task</th>' +
        '<th scope="col">Scope</th>' +
        '<th scope="col">Status</th>' +
        '<th scope="col">Actions</th>' +
        '</tr></thead><tbody>';

    deps.forEach((dep) => {
        const prop = propById[dep.id];
        const rag = prop ? prop.rag : 'grey';
        const reason = prop ? prop.reason : 'Not yet evaluated';
        const fromName = escapeHtml(projectNames[dep.from_project_id] || dep.from_project_id);
        const toName = escapeHtml(projectNames[dep.to_project_id] || dep.to_project_id);
        const scopeLabel = dep.scope === 'internal' ? 'Internal' : 'External';

        html += '<tr>' +
            '<td>' + ragCircleHtml(rag, reason) + '</td>' +
            '<td>' + fromName + '</td>' +
            '<td>' + escapeHtml(dep.from_task_name) + '</td>' +
            '<td>' + toName + '</td>' +
            '<td>' + escapeHtml(dep.to_task_name) + '</td>' +
            '<td><span class="programme-dep-scope programme-dep-scope--' + dep.scope + '">' + scopeLabel + '</span></td>' +
            '<td style="max-width:220px;font-size:0.85em;color:' + ragToColour(rag) + ';">' + escapeHtml(reason) + '</td>' +
            '<td><button class="btn-secondary btn-sm" ' +
            'onclick="showEditDependencyDialog(\'' + dep.id + '\')" aria-label="Edit dependency">Edit</button> ' +
            '<button class="btn-danger btn-sm" ' +
            'onclick="confirmDeleteProgrammeDependency(\'' + dep.id + '\')" aria-label="Delete dependency">Delete</button></td>' +
            '</tr>';
    });

    html += '</tbody></table>';
    el.innerHTML = html;
}

/**
 * Render the Resourcing section (#739): demand vs capacity for the
 * programme's aggregate resource pool, one row per resource, sorted
 * overloaded-first by aggregateProgrammeResourceDemand(). Same table
 * convention as the portfolio-wide Team Allocation view
 * (portfolio-resources.js) -- resource, projects, tasks, demand,
 * capacity, workload -- reusing its .workload-badge classes for the
 * workload chip.
 */
function renderProgrammeResourcing(resources) {
    const el = document.getElementById('programmeResourcing');
    if (!el) return;

    if (!resources || resources.length === 0) {
        el.innerHTML = '<np-empty-state>No resource assignments found across this programme\'s member projects.</np-empty-state>';
        return;
    }

    const totalDemandDays = resources.reduce((sum, r) => sum + r.totalDays, 0);
    const overCapacityCount = resources.filter((r) => r.overCapacity).length;

    let html = '<div class="programme-resourcing-summary">' +
        '<div class="programme-resourcing-summary-item">' +
        '<span class="programme-stat-label">Resources</span>' +
        `<span class="programme-resourcing-summary-value">${resources.length}</span>` +
        '</div>' +
        '<div class="programme-resourcing-summary-item">' +
        '<span class="programme-stat-label">Total Demand</span>' +
        `<span class="programme-resourcing-summary-value">${Math.round(totalDemandDays)}d</span>` +
        '</div>' +
        '<div class="programme-resourcing-summary-item">' +
        '<span class="programme-stat-label">Over Capacity</span>' +
        `<span class="programme-resourcing-summary-value${overCapacityCount > 0 ? ' programme-resourcing-summary-value--warn' : ''}">${overCapacityCount}</span>` +
        '</div>' +
        '</div>';

    html += '<div class="programme-resourcing-table-wrapper">' +
        '<table class="programme-resourcing-table">' +
        '<thead><tr>' +
        '<th scope="col">Resource</th>' +
        '<th scope="col">Projects</th>' +
        '<th scope="col">Tasks</th>' +
        '<th scope="col">Demand</th>' +
        '<th scope="col">Capacity</th>' +
        '<th scope="col">Utilisation</th>' +
        '<th scope="col">Workload</th>' +
        '</tr></thead><tbody>';

    resources.forEach((r) => {
        const workloadClass = (typeof getWorkloadBadgeClass === 'function') ? getWorkloadBadgeClass(r.workloadLevel) : '';
        const utilisation = r.utilisationPercent != null ? r.utilisationPercent + '%' : '—';
        html += '<tr' + (r.overCapacity ? ' class="programme-resourcing-row--over"' : '') + '>' +
            '<td class="programme-resourcing-name">' + escapeHtml(r.name) + '</td>' +
            '<td>' + escapeHtml(r.projects.join(', ')) + '</td>' +
            '<td>' + r.totalTasks + '</td>' +
            '<td>' + r.totalDays + 'd</td>' +
            '<td>' + (r.capacityDays > 0 ? r.capacityDays + 'd' : '—') + '</td>' +
            '<td>' + utilisation + '</td>' +
            '<td><span class="workload-badge ' + workloadClass + '">' + r.workloadLevel.toUpperCase() + '</span></td>' +
            '</tr>';
    });

    html += '</tbody></table></div>';
    el.innerHTML = html;
}

/** Open the source project's RAID form for an escalated item, drilling down from the programme dashboard. */
function openProgrammeEscalatedItem(projectId, raidItemId) {
    if (typeof setRibbonScope === 'function') setRibbonScope('project');
    if (typeof openProjectRisk === 'function') {
        openProjectRisk(projectId, raidItemId);
    } else {
        openProjectFromProgramme(projectId);
    }
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
    const raidItemsByProject = [];

    relevant.forEach(({ project, parsedResult }) => {
        const tasks = (parsedResult && parsedResult.success) ? (parsedResult.tasks || []) : [];
        const frontMatter = (parsedResult && parsedResult.success) ? (parsedResult.front_matter || {}) : {};
        const completion = (typeof calculateProjectCompletionFromTasks === 'function') ? calculateProjectCompletionFromTasks(tasks) : 0;
        const rag = (typeof extractRAGStatus === 'function') ? extractRAGStatus(frontMatter, tasks, completion) : 'green';
        const raidItems = (parsedResult && parsedResult.success) ? (parsedResult.raid_items || []) : [];

        projectRags.push({ id: project.id, name: project.name, rag });
        allMilestones.push(...extractProjectMilestones(tasks, project.id, project.name));
        extractProgrammeBenefitItems(project.planText || '').forEach((item) => {
            allBenefitItems.push(Object.assign({}, item, { projectId: project.id, projectName: project.name }));
        });
        raidItemsByProject.push({ projectId: project.id, projectName: project.name, items: raidItems });
    });

    if (currentProgrammeSlug !== slugAtStart) return;

    const escalatedItems = aggregateEscalatedRaidItems(raidItemsByProject);
    const allDeps = (typeof getAllProgrammeDependencies === 'function') ? getAllProgrammeDependencies() : [];
    const scopedDeps = filterDependenciesForProgramme(allDeps, programme.projects.map((p) => p.id));
    const dependencyPropagation = (scopedDeps.length > 0 && typeof propagateProgrammeDependencies === 'function')
        ? await propagateProgrammeDependencies(parsedProjects, scopedDeps)
        : null;

    if (currentProgrammeSlug !== slugAtStart) return;

    const resourceDemand = aggregateProgrammeResourceDemand(relevant);
    const programmeData = (typeof getProgrammeData === 'function') ? (getProgrammeData(programme.slug) || {}) : {};
    programmeLinkableBenefitItems = allBenefitItems.filter((b) => (b.type || 'benefit').toLowerCase() === 'benefit');
    const outcomeContributions = computeOutcomeContributions(programmeData.outcomes, programmeData.benefitLinks, allBenefitItems);

    renderProgrammeMemberGrid(programme, ragById(projectRags));
    renderProgrammeStatTiles(computeRagRollup(projectRags), aggregateBenefitsOnTrack(allBenefitItems), escalatedItems.length);
    renderProgrammeMilestones(pickKeyMilestones(allMilestones, 5));
    renderProgrammeEscalatedRisks(escalatedItems);
    renderProgrammeDependencyBoard(scopedDeps, dependencyPropagation);
    renderProgrammeResourcing(resourceDemand);
    renderProgrammeBenefitsRealisation(outcomeContributions, programme.slug);
}

/**
 * Render the programme overview dashboard: name, member-project count,
 * SRO/vision/outcomes editor, key metrics tiles, key milestones, and the
 * member-project grid. The synchronous parts (title, meta, SRO/vision, and
 * a grid with loading RAG badges) render immediately; loadProgrammeDashboardData()
 * fills in the parts that need /api/parse data once it resolves.
 */
function renderProgrammeView() {
    const titleEl = document.getElementById('programmeViewTitle');
    const metaEl = document.getElementById('programmeViewMeta');
    const gridEl = document.getElementById('programmeViewProjects');
    const sroVisionEl = document.getElementById('programmeSroVision');
    const tilesEl = document.getElementById('programmeStatTiles');
    const milestonesEl = document.getElementById('programmeMilestones');
    const escalatedEl = document.getElementById('programmeEscalatedRisks');
    const depsEl = document.getElementById('programmeDependencies');
    const resourcingEl = document.getElementById('programmeResourcing');
    const benefitsEl = document.getElementById('programmeBenefitsRealisation');
    if (!titleEl || !gridEl) return;

    const programme = getCurrentPortfolioProgramme();
    if (!programme) {
        titleEl.textContent = 'Programme not found';
        if (metaEl) {
            metaEl.textContent = 'It has no member projects left, or none was selected. Go back to Portfolio and pick a programme badge.';
        }
        gridEl.innerHTML = '';
        if (sroVisionEl) sroVisionEl.innerHTML = '';
        if (tilesEl) tilesEl.innerHTML = '';
        if (milestonesEl) milestonesEl.innerHTML = '';
        if (escalatedEl) escalatedEl.innerHTML = '';
        if (depsEl) depsEl.innerHTML = '';
        if (resourcingEl) resourcingEl.innerHTML = '';
        if (benefitsEl) benefitsEl.innerHTML = '';
        return;
    }

    titleEl.textContent = programme.name;
    const count = programme.projects.length;
    if (metaEl) metaEl.textContent = `${count} project${count === 1 ? '' : 's'} in this programme`;
    renderProgrammeSroVision(programme);

    if (count === 0) {
        gridEl.innerHTML = '<np-empty-state variant="card" heading="No projects yet">' +
            '<p>Group a project into this programme from the Portfolio view.</p></np-empty-state>';
        if (tilesEl) tilesEl.innerHTML = '';
        if (milestonesEl) milestonesEl.innerHTML = '';
        if (escalatedEl) escalatedEl.innerHTML = '';
        if (depsEl) depsEl.innerHTML = '';
        if (resourcingEl) resourcingEl.innerHTML = '';
        if (benefitsEl) benefitsEl.innerHTML = '';
        return;
    }

    if (tilesEl) tilesEl.innerHTML = '<div class="portfolio-loading"><div class="portfolio-loading-spinner"></div></div>';
    if (milestonesEl) milestonesEl.innerHTML = '<div class="portfolio-loading"><div class="portfolio-loading-spinner"></div></div>';
    if (escalatedEl) escalatedEl.innerHTML = '<div class="portfolio-loading"><div class="portfolio-loading-spinner"></div></div>';
    if (depsEl) depsEl.innerHTML = '<div class="portfolio-loading"><div class="portfolio-loading-spinner"></div></div>';
    if (resourcingEl) resourcingEl.innerHTML = '<div class="portfolio-loading"><div class="portfolio-loading-spinner"></div></div>';
    if (benefitsEl) benefitsEl.innerHTML = '<div class="portfolio-loading"><div class="portfolio-loading-spinner"></div></div>';

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

        const escalatedRow = e.target.closest('[data-raid-item-id]');
        if (escalatedRow) {
            openProgrammeEscalatedItem(escalatedRow.dataset.projectId, parseInt(escalatedRow.dataset.raidItemId, 10));
        }
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
        aggregateEscalatedRaidItems,
        ragById,
        filterDependenciesForProgramme,
        aggregateProgrammeResourceDemand,
        computeOutcomeContributions,
    };
}
