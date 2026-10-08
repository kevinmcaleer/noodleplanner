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
 * propagateProgrammeDependencies, ragCircleHtml,
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
    rememberProgramme(slug);
    NavigationController.navigateTo('programme');
}

const LAST_PROGRAMME_KEY = 'noodleplanner_last_programme';

function rememberProgramme(slug) {
    try {
        if (slug) localStorage.setItem(LAST_PROGRAMME_KEY, slug);
        else localStorage.removeItem(LAST_PROGRAMME_KEY);
    } catch (err) { /* storage unavailable: the index is the fallback */ }
}

/**
 * The Programme scope button (#1489): reopen the programme last visited if
 * it still exists, otherwise land on the index of programmes. Never a dead
 * end -- it used to toast "Programme isn't available yet" until a programme
 * had been drilled into this session.
 */
function openProgrammeScope() {
    if (!currentProgrammeSlug) {
        try { currentProgrammeSlug = localStorage.getItem(LAST_PROGRAMME_KEY) || null; } catch (err) { currentProgrammeSlug = null; }
    }
    NavigationController.navigateTo('programme');
}

/** "All programmes": drop out of the open programme to the index. */
function showProgrammeIndex() {
    currentProgrammeSlug = null;
    rememberProgramme(null);
    renderProgrammeView();
}

/** The index shown when no programme is in context: a card per programme, or an empty state. */
function renderProgrammeIndex() {
    const indexEl = document.getElementById('programmeIndex');
    const dashEl = document.getElementById('programmeDashboard');
    if (!indexEl) return;
    if (dashEl) dashEl.hidden = true;
    indexEl.hidden = false;

    const projects = (typeof loadAllProjectsIntoCache === 'function') ? loadAllProjectsIntoCache() : [];
    const programmes = (typeof deriveProgrammes === 'function') ? deriveProgrammes(projects) : [];
    const newButton = '<button type="button" class="btn-primary" onclick="showCreateProgrammeDialog()">+ New Programme</button>';

    if (programmes.length === 0) {
        indexEl.innerHTML = '<np-empty-state variant="card" heading="No programmes yet">' +
            '<p>A programme groups related projects and initiatives that share outcomes.</p>' +
            newButton.replace('<button ', '<button slot="actions" ') +
            '</np-empty-state>';
        return;
    }

    const esc = (v) => escapeHtml(String(v));
    indexEl.innerHTML =
        '<div class="programme-landing-header"><h2>Programmes</h2>' +
        '<p class="programme-landing-meta">Open a programme, or drag projects onto one in the Portfolio view.</p></div>' +
        '<div class="programme-index-actions">' + newButton + '</div>' +
        '<div class="programme-index-grid">' +
        programmes.map((p) => {
            const n = p.projects.length;
            const names = p.projects.slice(0, 3).map((m) => esc(m.name)).join(', ');
            return `<button type="button" class="programme-index-card" data-programme-slug="${esc(p.slug)}">` +
                `<span class="programme-index-name">${esc(p.name)}</span>` +
                `<span class="programme-index-meta">${n} ${n === 1 ? 'project' : 'projects'}</span>` +
                (names ? `<span class="programme-index-members">${names}${n > 3 ? ', …' : ''}</span>` : '') +
                '</button>';
        }).join('') +
        '</div>';
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
    const endIdx = npBackMatterSectionEnd(planText, afterStart, [BENEFITS_START]);

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
    const slugAttr = escapeJsAttr(programme.slug);

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

// ── Stakeholder register and engagement map (#740) ──────────────────────

const STAKEHOLDER_QUADRANTS = [
    { key: 'manage-closely', label: 'Manage closely', hint: 'High influence, high interest' },
    { key: 'keep-satisfied', label: 'Keep satisfied', hint: 'High influence, lower interest' },
    { key: 'keep-informed', label: 'Keep informed', hint: 'Lower influence, high interest' },
    { key: 'monitor', label: 'Monitor', hint: 'Lower influence, lower interest' },
];

/** Group stakeholders by engagement quadrant, in STAKEHOLDER_QUADRANTS order. Pure/testable. */
function groupStakeholdersByQuadrant(stakeholders) {
    const groups = STAKEHOLDER_QUADRANTS.map((q) => Object.assign({}, q, { stakeholders: [] }));
    (stakeholders || []).forEach((s) => {
        const key = stakeholderQuadrant(s);
        groups.find((g) => g.key === key).stakeholders.push(s);
    });
    return groups;
}

function stakeholderLevelOptions(selected) {
    return STAKEHOLDER_LEVELS.map((l) =>
        `<option value="${l}"${l === selected ? ' selected' : ''}>${l.charAt(0).toUpperCase() + l.slice(1)}</option>`).join('');
}

/** Render the Stakeholders section (#740) into #programmeStakeholders. */
function renderProgrammeStakeholders(programme) {
    const el = document.getElementById('programmeStakeholders');
    if (!el) return;
    const data = (typeof getProgrammeData === 'function') ? (getProgrammeData(programme.slug) || {}) : {};
    const stakeholders = data.stakeholders || [];
    const slugAttr = escapeJsAttr(programme.slug);

    let html = '';
    if (stakeholders.length === 0) {
        html += '<np-empty-state>No stakeholders recorded yet. Add the people and groups this programme depends on or affects.</np-empty-state>';
    } else {
        html += '<div class="programme-resourcing-summary">' +
            groupStakeholdersByQuadrant(stakeholders).map((g) =>
                '<div class="programme-resourcing-summary-item">' +
                `<span class="programme-stat-label" title="${escapeHtml(g.hint)}">${escapeHtml(g.label)}</span>` +
                `<span class="programme-resourcing-summary-value">${g.stakeholders.length}</span></div>`).join('') +
            '</div>';
        html += '<div class="programme-resourcing-table-wrapper"><table class="programme-resourcing-table">' +
            '<thead><tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col">Organisation</th>' +
            '<th scope="col">Influence</th><th scope="col">Interest</th><th scope="col">Engagement</th><th scope="col">Notes</th><th scope="col"></th></tr></thead><tbody>' +
            stakeholders.map((s) => {
                const quadrant = STAKEHOLDER_QUADRANTS.find((q) => q.key === stakeholderQuadrant(s));
                return '<tr>' +
                    `<td class="programme-resourcing-name">${escapeHtml(s.name)}</td>` +
                    `<td>${escapeHtml(s.role)}</td><td>${escapeHtml(s.organisation)}</td>` +
                    `<td>${escapeHtml(s.influence)}</td><td>${escapeHtml(s.interest)}</td>` +
                    `<td>${escapeHtml(quadrant.label)}</td><td>${escapeHtml(s.notes)}</td>` +
                    `<td><button type="button" class="btn-danger btn-sm" onclick="deleteProgrammeStakeholderConfirm('${slugAttr}', ${s.id})" aria-label="Delete stakeholder ${escapeHtml(s.name)}">Delete</button></td>` +
                    '</tr>';
            }).join('') + '</tbody></table></div>';
    }

    html += `<form class="programme-outcome-add" onsubmit="submitAddProgrammeStakeholder(event, '${slugAttr}')">` +
        '<input type="text" id="programmeStakeholderName" class="form-control" maxlength="200" placeholder="Name" aria-label="Stakeholder name" required>' +
        '<input type="text" id="programmeStakeholderRole" class="form-control" maxlength="200" placeholder="Role" aria-label="Role">' +
        '<input type="text" id="programmeStakeholderOrg" class="form-control" maxlength="200" placeholder="Organisation" aria-label="Organisation">' +
        `<select id="programmeStakeholderInfluence" class="form-control" aria-label="Influence">${stakeholderLevelOptions('medium')}</select>` +
        `<select id="programmeStakeholderInterest" class="form-control" aria-label="Interest">${stakeholderLevelOptions('medium')}</select>` +
        '<input type="text" id="programmeStakeholderNotes" class="form-control" maxlength="500" placeholder="Notes (optional)" aria-label="Notes">' +
        '<button type="submit" class="btn-secondary btn-sm">Add Stakeholder</button>' +
        '</form>';
    el.innerHTML = html;
}

function submitAddProgrammeStakeholder(event, slug) {
    event.preventDefault();
    const val = (id) => { const e = document.getElementById(id); return e ? e.value : ''; };
    if (typeof addProgrammeStakeholder === 'function') {
        addProgrammeStakeholder(slug, {
            name: val('programmeStakeholderName'),
            role: val('programmeStakeholderRole'),
            organisation: val('programmeStakeholderOrg'),
            influence: val('programmeStakeholderInfluence'),
            interest: val('programmeStakeholderInterest'),
            notes: val('programmeStakeholderNotes'),
        });
    }
    const programme = getCurrentPortfolioProgramme();
    if (programme) renderProgrammeStakeholders(programme);
}

function deleteProgrammeStakeholderConfirm(slug, stakeholderId) {
    if (!confirm('Delete this stakeholder?')) return;
    if (typeof deleteProgrammeStakeholder === 'function') deleteProgrammeStakeholder(slug, stakeholderId);
    const programme = getCurrentPortfolioProgramme();
    if (programme) renderProgrammeStakeholders(programme);
}

// ── Information register (#741) ─────────────────────────────────────────

/**
 * Whether an information item's review is overdue: it has a review date
 * strictly before `today` (an ISO yyyy-mm-dd string, passed in so this
 * stays pure and testable). Items with no review date are never overdue.
 */
function isInformationReviewOverdue(item, today) {
    return !!(item && item.reviewDate && today && item.reviewDate < today);
}

function todayIso() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** Render the Information section (#741) into #programmeInformation. */
function renderProgrammeInformation(programme) {
    const el = document.getElementById('programmeInformation');
    if (!el) return;
    const data = (typeof getProgrammeData === 'function') ? (getProgrammeData(programme.slug) || {}) : {};
    const items = data.information || [];
    const slugAttr = escapeJsAttr(programme.slug);
    const today = todayIso();

    let html = '';
    if (items.length === 0) {
        html += '<np-empty-state>No key documents or assets recorded yet. Add the information this programme relies on.</np-empty-state>';
    } else {
        html += '<div class="programme-resourcing-table-wrapper"><table class="programme-resourcing-table">' +
            '<thead><tr><th scope="col">Title</th><th scope="col">Owner</th><th scope="col">Location</th>' +
            '<th scope="col">Review date</th><th scope="col">Notes</th><th scope="col"></th></tr></thead><tbody>' +
            items.map((i) => {
                const overdue = isInformationReviewOverdue(i, today);
                return '<tr' + (overdue ? ' class="programme-resourcing-row--over"' : '') + '>' +
                    `<td class="programme-resourcing-name">${escapeHtml(i.title)}</td>` +
                    `<td>${escapeHtml(i.owner)}</td><td>${escapeHtml(i.location)}</td>` +
                    `<td>${escapeHtml(i.reviewDate)}${overdue ? ' (overdue)' : ''}</td><td>${escapeHtml(i.notes)}</td>` +
                    `<td><button type="button" class="btn-danger btn-sm" onclick="deleteProgrammeInformationConfirm('${slugAttr}', ${i.id})" aria-label="Delete ${escapeHtml(i.title)}">Delete</button></td>` +
                    '</tr>';
            }).join('') + '</tbody></table></div>';
    }

    html += `<form class="programme-outcome-add" onsubmit="submitAddProgrammeInformation(event, '${slugAttr}')">` +
        '<input type="text" id="programmeInfoTitle" class="form-control" maxlength="200" placeholder="Document or asset" aria-label="Document or asset" required>' +
        '<input type="text" id="programmeInfoOwner" class="form-control" maxlength="200" placeholder="Owner" aria-label="Owner">' +
        '<input type="text" id="programmeInfoLocation" class="form-control" maxlength="500" placeholder="Location (path or URL)" aria-label="Location">' +
        '<input type="date" id="programmeInfoReview" class="form-control" aria-label="Review date">' +
        '<input type="text" id="programmeInfoNotes" class="form-control" maxlength="500" placeholder="Notes (optional)" aria-label="Notes">' +
        '<button type="submit" class="btn-secondary btn-sm">Add Item</button>' +
        '</form>';
    el.innerHTML = html;
}

function submitAddProgrammeInformation(event, slug) {
    event.preventDefault();
    const val = (id) => { const e = document.getElementById(id); return e ? e.value : ''; };
    if (typeof addProgrammeInformationItem === 'function') {
        addProgrammeInformationItem(slug, {
            title: val('programmeInfoTitle'),
            owner: val('programmeInfoOwner'),
            location: val('programmeInfoLocation'),
            reviewDate: val('programmeInfoReview'),
            notes: val('programmeInfoNotes'),
        });
    }
    const programme = getCurrentPortfolioProgramme();
    if (programme) renderProgrammeInformation(programme);
}

function deleteProgrammeInformationConfirm(slug, itemId) {
    if (!confirm('Delete this item?')) return;
    if (typeof deleteProgrammeInformationItem === 'function') deleteProgrammeInformationItem(slug, itemId);
    const programme = getCurrentPortfolioProgramme();
    if (programme) renderProgrammeInformation(programme);
}

// ── Markdown export (#742) ───────────────────────────────────────────────

/** A markdown table cell: pipes escaped, line breaks flattened. */
function programmeMdCell(value) {
    return String(value == null ? '' : value).replace(/\|/g, '\\|').replace(/\s*[\r\n]+\s*/g, ' ').trim();
}

function programmeMdTable(headers, rows) {
    return '| ' + headers.join(' | ') + ' |\n| ' + headers.map(() => '---').join(' | ') + ' |\n' +
        rows.map((r) => '| ' + r.map(programmeMdCell).join(' | ') + ' |').join('\n') + '\n';
}

/**
 * The programme as one markdown document (#742): front matter, then a
 * section per kind of programme-owned data (#954's record) plus the
 * inferred member list. Sections with nothing to say are omitted rather
 * than left as empty headings. Pure/testable: `exportedOn` is passed in.
 * Roll-ups computed from member projects (RAG, risks, budget totals) are
 * deliberately not included -- they live in the member projects and are
 * only ever recomputed, so a snapshot of them here would go stale.
 */
function generateProgrammeMarkdown(programme, data, exportedOn) {
    const d = data || {};
    const q = (v) => JSON.stringify(String(v == null ? '' : v));
    let md = '---\n' +
        `name: ${q(programme.name)}\n` +
        `slug: ${q(programme.slug)}\n` +
        (d.sro ? `sro: ${q(d.sro)}\n` : '') +
        (d.vision ? `vision: ${q(d.vision)}\n` : '') +
        (exportedOn ? `exported: ${q(exportedOn)}\n` : '') +
        '---\n\n' +
        `# ${programmeMdCell(programme.name)}\n`;

    const members = programme.projects || [];
    if (members.length) {
        md += '\n## Member projects\n\n' + members.map((p) => `- ${programmeMdCell(p.name)}`).join('\n') + '\n';
    }
    if ((d.outcomes || []).length) {
        const links = d.benefitLinks || [];
        md += '\n## Outcomes\n\n' + programmeMdTable(['Outcome', 'Description', 'Linked benefits'],
            d.outcomes.map((o) => [o.name, o.description, links.filter((l) => l.outcomeId === o.id).length]));
    }
    if (d.funding && (d.funding.envelope != null || d.funding.currency)) {
        md += '\n## Finance\n\n' +
            `Funding envelope: ${d.funding.envelope == null ? 'not set' : (d.funding.currency || '') + d.funding.envelope}\n`;
    }
    if ((d.stakeholders || []).length) {
        md += '\n## Stakeholders\n\n' + programmeMdTable(['Name', 'Role', 'Organisation', 'Influence', 'Interest', 'Notes'],
            d.stakeholders.map((s) => [s.name, s.role, s.organisation, s.influence, s.interest, s.notes]));
    }
    if ((d.information || []).length) {
        md += '\n## Information\n\n' + programmeMdTable(['Title', 'Owner', 'Location', 'Review date', 'Notes'],
            d.information.map((i) => [i.title, i.owner, i.location, i.reviewDate, i.notes]));
    }
    return md;
}

/** Download the current programme as `<slug>.md`. */
function downloadProgrammeMarkdown() {
    const programme = getCurrentPortfolioProgramme();
    if (!programme) return;
    const data = (typeof getProgrammeData === 'function') ? getProgrammeData(programme.slug) : null;
    const md = generateProgrammeMarkdown(programme, data, todayIso());
    const url = window.URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${programme.slug}.md`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
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

    const slugAttr = escapeJsAttr(slug);
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
                    `onclick="unlinkProgrammeBenefit('${slugAttr}', '${escapeJsAttr(c.projectId)}', ${c.benefitItemId})" ` +
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
    const slugAttr = escapeJsAttr(programme.slug);

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

/**
 * Extract one project's budget items from its plan text (#738). Reuses
 * extractBudgetItemsFromPlanText() (script.js), the same parser the
 * single-project Budget view uses, so a programme total can never
 * disagree with the project's own table.
 */
function extractProgrammeBudgetItems(planText) {
    if (!planText || typeof extractBudgetItemsFromPlanText !== 'function') return [];
    return extractBudgetItemsFromPlanText(planText) || [];
}

/**
 * Roll member-project budgets up against the programme's funding envelope
 * (#738). `budgetByProject` is [{ projectId, projectName, items }] where
 * items carry numeric `estimate`, `forecast` and `total` (spend to date).
 * `envelope` is the programme-level funding figure, or null/undefined when
 * none has been set -- then there is no headroom to report, not zero.
 * Headroom is envelope - forecast, so a negative figure means the
 * programme is forecast to overspend its funding. Budgets carry no
 * currency, so everything is summed as plain numbers.
 */
function computeProgrammeFinance(budgetByProject, envelope) {
    const projects = (budgetByProject || []).map((p) => {
        const sum = (key) => (p.items || []).reduce((s, it) => s + (Number(it && it[key]) || 0), 0);
        return {
            projectId: p.projectId,
            projectName: p.projectName,
            estimate: sum('estimate'),
            forecast: sum('forecast'),
            spent: sum('total'),
        };
    });
    const total = (key) => projects.reduce((s, p) => s + p[key], 0);
    const hasEnvelope = envelope !== null && envelope !== undefined && envelope !== '' && Number.isFinite(Number(envelope));
    const env = hasEnvelope ? Number(envelope) : null;
    const forecast = total('forecast');
    return {
        projects,
        estimate: total('estimate'),
        forecast,
        spent: total('spent'),
        envelope: env,
        headroom: hasEnvelope ? env - forecast : null,
        overspend: hasEnvelope && forecast > env,
    };
}

function formatProgrammeMoney(value, currency) {
    const n = Number(value) || 0;
    return (currency || '') + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Render the Finance dashboard section (#738) into #programmeFinance. */
function renderProgrammeFinance(finance, slug) {
    const el = document.getElementById('programmeFinance');
    if (!el) return;
    const data = (typeof getProgrammeData === 'function') ? (getProgrammeData(slug) || {}) : {};
    const funding = data.funding || {};
    const cur = funding.currency || '';
    const slugAttr = escapeJsAttr(slug);

    const headroomLabel = finance.headroom === null ? '—'
        : (finance.headroom < 0 ? '−' : '') + formatProgrammeMoney(Math.abs(finance.headroom), cur);
    let html = '<div class="programme-form-row">' +
        '<label for="programmeEnvelopeInput">Funding envelope</label>' +
        `<input type="number" id="programmeEnvelopeInput" class="form-control" min="0" step="any" ` +
        `placeholder="Total programme funding" value="${funding.envelope == null ? '' : escapeHtml(String(funding.envelope))}" ` +
        `onchange="saveProgrammeFunding('${slugAttr}')">` +
        '<label for="programmeCurrencyInput">Currency symbol</label>' +
        `<input type="text" id="programmeCurrencyInput" class="form-control" maxlength="4" placeholder="£" ` +
        `value="${escapeHtml(cur)}" onchange="saveProgrammeFunding('${slugAttr}')">` +
        '</div>';

    html += '<div class="programme-resourcing-summary">' +
        `<div class="programme-resourcing-summary-item"><span class="programme-stat-label">Estimate</span><span class="programme-resourcing-summary-value">${formatProgrammeMoney(finance.estimate, cur)}</span></div>` +
        `<div class="programme-resourcing-summary-item"><span class="programme-stat-label">Forecast</span><span class="programme-resourcing-summary-value">${formatProgrammeMoney(finance.forecast, cur)}</span></div>` +
        `<div class="programme-resourcing-summary-item"><span class="programme-stat-label">Spent</span><span class="programme-resourcing-summary-value">${formatProgrammeMoney(finance.spent, cur)}</span></div>` +
        `<div class="programme-resourcing-summary-item"><span class="programme-stat-label">Headroom</span><span class="programme-resourcing-summary-value${finance.overspend ? ' programme-resourcing-summary-value--warn' : ''}">${headroomLabel}</span></div>` +
        '</div>';

    if (finance.projects.every((p) => p.estimate === 0 && p.forecast === 0 && p.spent === 0)) {
        html += '<np-empty-state>No budget items found across this programme\'s member projects.</np-empty-state>';
    } else {
        html += '<div class="programme-resourcing-table-wrapper"><table class="programme-resourcing-table">' +
            '<thead><tr><th scope="col">Project</th><th scope="col">Estimate</th><th scope="col">Forecast</th><th scope="col">Spent</th></tr></thead><tbody>' +
            finance.projects.map((p) => '<tr>' +
                `<td class="programme-resourcing-name">${escapeHtml(p.projectName)}</td>` +
                `<td>${formatProgrammeMoney(p.estimate, cur)}</td>` +
                `<td>${formatProgrammeMoney(p.forecast, cur)}</td>` +
                `<td>${formatProgrammeMoney(p.spent, cur)}</td></tr>`).join('') +
            '</tbody></table></div>';
    }
    el.innerHTML = html;
}

/** Save the envelope + currency inputs; clearing both drops the funding slice. */
function saveProgrammeFunding(slug) {
    if (typeof setProgrammeData !== 'function') return;
    const envRaw = document.getElementById('programmeEnvelopeInput').value.trim();
    const currency = document.getElementById('programmeCurrencyInput').value.trim();
    const envelope = envRaw === '' || !Number.isFinite(Number(envRaw)) || Number(envRaw) < 0 ? null : Number(envRaw);
    setProgrammeData(slug, { funding: (envelope === null && !currency) ? null : { envelope, currency } });
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
                    <h3>${escapeHtml(project.name)}${(typeof isInitiativePlan === 'function' && isInitiativePlan(project.planText || '')) ? ' <span class="initiative-badge">Initiative</span>' : ''}</h3>
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
            '<td class="dep-reason">' + escapeHtml(reason) + '</td>' +
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

    const budgetByProject = relevant.map(({ project }) => ({
        projectId: project.id,
        projectName: project.name,
        items: extractProgrammeBudgetItems(project.planText || ''),
    }));
    const funding = programmeData.funding || {};
    renderProgrammeFinance(computeProgrammeFinance(budgetByProject, funding.envelope), programme.slug);
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
    const financeEl = document.getElementById('programmeFinance');
    if (!titleEl || !gridEl) return;

    const programme = getCurrentPortfolioProgramme();
    const indexEl = document.getElementById('programmeIndex');
    const dashEl = document.getElementById('programmeDashboard');
    if (!programme) {
        // Nothing (or nothing that still exists) in context: show the index.
        currentProgrammeSlug = null;
        renderProgrammeIndex();
        return;
    }
    if (indexEl) indexEl.hidden = true;
    if (dashEl) dashEl.hidden = false;

    titleEl.textContent = programme.name;
    const count = programme.projects.length;
    if (metaEl) metaEl.textContent = `${count} project${count === 1 ? '' : 's'} in this programme`;
    renderProgrammeSroVision(programme);
    renderProgrammeStakeholders(programme);
    renderProgrammeInformation(programme);

    if (count === 0) {
        gridEl.innerHTML = '<np-empty-state variant="card" heading="No projects yet">' +
            '<p>Group a project into this programme from the Portfolio view.</p></np-empty-state>';
        if (tilesEl) tilesEl.innerHTML = '';
        if (milestonesEl) milestonesEl.innerHTML = '';
        if (escalatedEl) escalatedEl.innerHTML = '';
        if (depsEl) depsEl.innerHTML = '';
        if (resourcingEl) resourcingEl.innerHTML = '';
        if (benefitsEl) benefitsEl.innerHTML = '';
        if (financeEl) financeEl.innerHTML = '';
        return;
    }

    if (tilesEl) tilesEl.innerHTML = '<div class="portfolio-loading"><div class="portfolio-loading-spinner"></div></div>';
    if (milestonesEl) milestonesEl.innerHTML = '<div class="portfolio-loading"><div class="portfolio-loading-spinner"></div></div>';
    if (escalatedEl) escalatedEl.innerHTML = '<div class="portfolio-loading"><div class="portfolio-loading-spinner"></div></div>';
    if (depsEl) depsEl.innerHTML = '<div class="portfolio-loading"><div class="portfolio-loading-spinner"></div></div>';
    if (resourcingEl) resourcingEl.innerHTML = '<div class="portfolio-loading"><div class="portfolio-loading-spinner"></div></div>';
    if (benefitsEl) benefitsEl.innerHTML = '<div class="portfolio-loading"><div class="portfolio-loading-spinner"></div></div>';
    if (financeEl) financeEl.innerHTML = '<div class="portfolio-loading"><div class="portfolio-loading-spinner"></div></div>';

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
        const card = e.target.closest('.programme-index-card');
        if (card) openProgramme(card.dataset.programmeSlug);

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
        openProgrammeScope,
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
        computeProgrammeFinance,
        groupStakeholdersByQuadrant,
        isInformationReviewOverdue,
        generateProgrammeMarkdown,
    };
}
