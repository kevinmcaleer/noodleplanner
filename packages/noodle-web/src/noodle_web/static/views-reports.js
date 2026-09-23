/**
 * views-reports.js -- the Tasks by Assignment and Slippage views (#776).
 *
 * The sums are PlanReports' (plan-reports.js, pure and unit-tested); this
 * file turns them into the two views, keeps their filters, and exports them.
 * Export sends the report's rows (not the plan) to /api/reports/export,
 * which builds the Excel or PowerPoint file with noodle_core/exporters.py.
 *
 * Depends on: state.js (lastRenderedTasks, baselineItems, baselineHistory,
 * activeBaselineId, globalResourceDetails, projectIsWorkingDay),
 * plan-reports.js.
 */

const reportState = {
    assignments: { groups: [], today: null, filter: { person: '', phase: '', status: '', from: '', to: '' }, sort: 'name' },
    slippage: { report: null, baselineLabel: '' },
    projectName: '',
};

function reportTodayIso() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function reportEl(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
}

function showReportContent(viewId) {
    const view = document.getElementById(viewId);
    if (!view) return null;
    const placeholder = view.querySelector('.report-placeholder');
    const content = view.querySelector('.report-content');
    if (placeholder) placeholder.style.display = 'none';
    if (content) content.style.display = 'block';
    return view;
}

/** Resource shortname -> full name and full-name key -> role, from front matter. */
function reportResourceDetails() {
    const resourceMap = {};
    const roles = {};
    const details = (typeof globalResourceDetails !== 'undefined' && globalResourceDetails) || {};
    Object.entries(details).forEach(([short, info]) => {
        if (!info || !info.name) return;
        resourceMap[short] = info.name;
        roles[PlanReports.resourceKey(info.name)] = info.role || '';
    });
    return { resourceMap, roles };
}

function formatVariance(days) {
    if (!days) return '0';
    return (days > 0 ? '+' : '−') + Math.abs(days) + 'd';
}

function inclusiveFinish(task) {
    // The scheduler's finish is exclusive; people read the last working day
    const day = PlanReports.dayOf(task.finish);
    if (day === null) return task.finish || '';
    return PlanReports.isoOf(task.duration_days === 0 ? day : day - 1);
}

// ----- Tasks by assignment ----------------------------------------------------

function updateAssignmentsView(result, planText) {
    if (!showReportContent('assignments-view')) return;
    const tasks = (result && result.tasks) || [];
    const details = reportResourceDetails();
    const roles = details.roles;
    // The server maps shortnames to full names already; the browser engine
    // does not, so map them here (front-matter details win)
    const resourceMap = { ...((result && result.resource_map) || {}), ...details.resourceMap };
    const state = reportState.assignments;
    state.today = reportTodayIso();
    state.groups = PlanReports.tasksByAssignment(tasks, { today: state.today, resourceMap, roles });
    reportState.projectName = (result && result.project_name) || '';
    setupAssignmentFilters(tasks);
    renderAssignments();
}

function setupAssignmentFilters(tasks) {
    const state = reportState.assignments;
    const person = document.getElementById('assignmentsPerson');
    const phase = document.getElementById('assignmentsPhase');
    if (!person || !phase) return;

    const fill = (select, options, current) => {
        select.innerHTML = '';
        options.forEach(([value, label]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            select.appendChild(option);
        });
        select.value = options.some(([value]) => value === current) ? current : '';
        return select.value;
    };
    state.filter.person = fill(person, [['', 'Everyone']].concat(
        state.groups.map(g => [g.key, g.unassigned ? 'Unassigned' : g.name])), state.filter.person);
    const phases = [...new Set(tasks.filter(t => !t.is_summary && t.phase).map(t => t.phase))];
    state.filter.phase = fill(phase, [['', 'All phases']].concat(phases.map(p => [p, p])), state.filter.phase);

    if (person.dataset.initialized) return;
    const bind = (id, apply) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', () => { apply(el.value); renderAssignments(); });
    };
    bind('assignmentsPerson', v => { state.filter.person = v; });
    bind('assignmentsPhase', v => { state.filter.phase = v; });
    bind('assignmentsStatus', v => { state.filter.status = v; });
    bind('assignmentsFrom', v => { state.filter.from = v; });
    bind('assignmentsTo', v => { state.filter.to = v; });
    bind('assignmentsSort', v => { state.sort = v; });
    person.dataset.initialized = 'true';
}

/** The groups the view is currently showing (filters and sort applied). */
function visibleAssignments() {
    const state = reportState.assignments;
    return PlanReports.sortAssignments(
        PlanReports.filterAssignments(state.groups, state.filter, state.today), state.sort);
}

function renderAssignments() {
    const container = document.getElementById('assignmentsGroups');
    if (!container) return;
    container.innerHTML = '';
    const groups = visibleAssignments();
    if (!groups.length) {
        container.appendChild(reportEl('p', 'report-empty-line',
            reportState.assignments.groups.length ? 'No tasks match these filters.' : 'The plan has no tasks yet.'));
        return;
    }

    groups.forEach(group => {
        const card = reportEl('section', 'assignment-group' + (group.unassigned ? ' assignment-group--unassigned' : ''));
        card.dataset.person = group.key;
        const head = reportEl('div', 'assignment-group-head');
        const title = reportEl('h3', 'assignment-group-name', group.unassigned ? 'Unassigned' : group.name);
        head.appendChild(title);
        if (group.role) head.appendChild(reportEl('span', 'assignment-group-role', group.role));
        if (group.unassigned) {
            head.appendChild(reportEl('span', 'assignment-group-note',
                'Nobody owns these tasks. Assign each one with @name.'));
        }
        card.appendChild(head);

        const t = group.totals;
        const stats = reportEl('dl', 'assignment-stats');
        [
            ['Tasks', t.tasks],
            ['Open', t.open],
            ['Complete', t.complete],
            ['Work', `${t.workDays}d`],
            ['Next due', t.nextDue || '—'],
            ['Overdue', t.overdue],
        ].forEach(([label, value]) => {
            const item = reportEl('div', 'assignment-stat' + (label === 'Overdue' && value ? ' assignment-stat--alert' : ''));
            item.appendChild(reportEl('dt', null, label));
            item.appendChild(reportEl('dd', null, String(value)));
            stats.appendChild(item);
        });
        card.appendChild(stats);

        const table = reportEl('table', 'report-table');
        const thead = reportEl('thead');
        const headRow = reportEl('tr');
        ['Task', 'Phase', 'Start', 'Finish', 'Duration', '%', 'Status', 'Shared with'].forEach(h => headRow.appendChild(reportEl('th', null, h)));
        thead.appendChild(headRow);
        table.appendChild(thead);
        const tbody = reportEl('tbody');
        group.tasks.forEach(row => {
            const tr = reportEl('tr', `report-row report-row--${row.status}`);
            const name = reportEl('td', 'report-task-name', row.task.name);
            if (row.shared) name.appendChild(reportEl('span', 'report-tag', 'shared'));
            if (row.share !== 1) name.appendChild(reportEl('span', 'report-tag', `${Math.round(row.share * 100)}%`));
            if (row.inherited) name.appendChild(reportEl('span', 'report-tag', 'from phase'));
            tr.appendChild(name);
            tr.appendChild(reportEl('td', null, row.task.phase || ''));
            tr.appendChild(reportEl('td', null, row.task.start || ''));
            tr.appendChild(reportEl('td', null, inclusiveFinish(row.task)));
            tr.appendChild(reportEl('td', null, `${row.task.duration_days || 0}d`));
            tr.appendChild(reportEl('td', null, String(row.task.percent || 0).replace('%', '') + '%'));
            tr.appendChild(reportEl('td', `report-status report-status--${row.status}`,
                row.status === 'overdue' ? 'Overdue' : row.status === 'complete' ? 'Complete' : 'Open'));
            tr.appendChild(reportEl('td', null, row.sharedWith.join(', ')));
            tr.addEventListener('dblclick', () => {
                if (typeof openTaskInspectorByName === 'function') openTaskInspectorByName(row.task.name);
            });
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        card.appendChild(table);
        container.appendChild(card);
    });
}

// ----- Slippage ----------------------------------------------------------------

function updateSlippageView(result, planText) {
    const view = showReportContent('slippage-view');
    if (!view) return;
    const tasks = (result && result.tasks) || [];
    const empty = document.getElementById('slippageEmpty');
    const container = document.getElementById('slippageReport');
    reportState.projectName = (result && result.project_name) || reportState.projectName;
    const hasBaseline = typeof baselineItems !== 'undefined' && baselineItems.length > 0;
    if (empty) empty.hidden = hasBaseline;
    if (!container) return;
    container.innerHTML = '';
    if (!hasBaseline) {
        reportState.slippage.report = null;
        return;
    }

    const isWorkingDay = (typeof projectIsWorkingDay === 'function') ? projectIsWorkingDay : undefined;
    const report = PlanReports.slippageReport(tasks, baselineItems, { isWorkingDay });
    reportState.slippage.report = report;
    const entry = (typeof baselineHistory !== 'undefined' && typeof activeBaselineId !== 'undefined')
        ? baselineHistory.find(e => e.id === activeBaselineId) : null;
    reportState.slippage.baselineLabel = entry
        ? `${entry.name || 'Baseline'}${entry.date ? ` (${String(entry.date).slice(0, 10)})` : ''}`
        : 'Baseline';
    renderSlippage(container, report);
}

function slippageTable(rows, columns) {
    const table = reportEl('table', 'report-table');
    const thead = reportEl('thead');
    const tr = reportEl('tr');
    columns.forEach(([label]) => tr.appendChild(reportEl('th', null, label)));
    thead.appendChild(tr);
    table.appendChild(thead);
    const tbody = reportEl('tbody');
    rows.forEach(row => {
        const r = reportEl('tr', `report-row report-row--${row.status || ''}` + (row.critical ? ' report-row--critical' : ''));
        columns.forEach(([, value, className]) => r.appendChild(reportEl('td', className ? className(row) : null, value(row))));
        tbody.appendChild(r);
    });
    table.appendChild(tbody);
    return table;
}

const SLIPPAGE_STATUS = { slipped: 'Slipped', 'on-track': 'On track', 'pulled-forward': 'Pulled forward' };

function renderSlippage(container, report) {
    const p = report.project;
    const summary = reportEl('div', 'slippage-summary');
    const headline = reportEl('div', `slippage-headline slippage-headline--${p.status}`);
    headline.appendChild(reportEl('span', 'slippage-headline-value', formatVariance(p.variance)));
    headline.appendChild(reportEl('span', 'slippage-headline-label',
        p.status === 'slipped' ? 'working days late' : p.status === 'pulled-forward' ? 'working days early' : 'on the baseline'));
    summary.appendChild(headline);
    const facts = reportEl('p', 'slippage-facts');
    facts.textContent = `Compared with ${reportState.slippage.baselineLabel}: the project finishes ` +
        `${p.finish ? inclusiveFinish({ finish: p.finish }) : '—'} against a baselined ` +
        `${p.baselineFinish ? inclusiveFinish({ finish: p.baselineFinish }) : '—'}. ` +
        `${report.counts.slipped} slipped, ${report.counts.onTrack} on track, ` +
        `${report.counts.pulledForward} pulled forward, ${report.counts.added} added, ` +
        `${report.counts.removed} removed.`;
    summary.appendChild(facts);
    container.appendChild(summary);

    const section = (title, note, className) => {
        const s = reportEl('section', `slippage-section ${className || ''}`);
        s.appendChild(reportEl('h3', 'slippage-section-title', title));
        if (note) s.appendChild(reportEl('p', 'slippage-section-note', note));
        container.appendChild(s);
        return s;
    };

    const critical = section('On the critical path',
        'Slippage here moves the end date. Deal with these first.', 'slippage-section--critical');
    if (report.critical.length) {
        critical.appendChild(slippageTable(report.critical, [
            ['Task', r => r.name],
            ['Baselined finish', r => inclusiveFinish({ finish: r.baselineFinish })],
            ['Finish', r => inclusiveFinish(r.task)],
            ['Variance', r => formatVariance(r.finishVariance), () => 'report-variance report-variance--late'],
        ]));
    } else {
        critical.appendChild(reportEl('p', 'report-empty-line', 'No critical task has slipped.'));
    }

    if (report.phases.length) {
        const phases = section('By phase', null, 'slippage-section--phases');
        phases.appendChild(slippageTable(report.phases, [
            ['Phase', r => '  '.repeat(Math.max(0, r.level - 1)) + r.name],
            ['Baselined finish', r => inclusiveFinish({ finish: r.baselineFinish })],
            ['Finish', r => inclusiveFinish(r.task)],
            ['Variance', r => formatVariance(r.finishVariance), r => `report-variance report-variance--${r.status}`],
            ['Slipped tasks', r => String(r.slippedTasks)],
            ['Worst slip', r => r.worstSlip ? formatVariance(r.worstSlip) : '—'],
        ]));
    }

    const tasks = section('Every task', 'Sorted by how far each finish has moved, latest first.', 'slippage-section--tasks');
    tasks.appendChild(slippageTable(report.rows.filter(r => !r.summary), [
        ['Task', r => r.name + (r.critical ? ' ◆' : '')],
        ['Phase', r => r.phase],
        ['Baselined start', r => r.baselineStart],
        ['Baselined finish', r => inclusiveFinish({ finish: r.baselineFinish })],
        ['Start', r => r.start],
        ['Finish', r => inclusiveFinish(r.task)],
        ['Start var.', r => formatVariance(r.startVariance)],
        ['Finish var.', r => formatVariance(r.finishVariance), r => `report-variance report-variance--${r.status}`],
        ['Status', r => SLIPPAGE_STATUS[r.status]],
    ]));

    if (report.added.length || report.removed.length) {
        const scope = section('Changed since the baseline', null, 'slippage-section--scope');
        const rows = report.added.map(t => ({ name: t.name, phase: t.phase || '', change: 'Added', status: 'added' }))
            .concat(report.removed.map(b => ({ name: b.name, phase: '', change: 'Removed', status: 'removed' })));
        scope.appendChild(slippageTable(rows, [
            ['Task', r => r.name],
            ['Phase', r => r.phase],
            ['Change', r => r.change],
        ]));
    }
}

// ----- Export --------------------------------------------------------------------

/** The rows the export endpoint needs, as plain JSON. */
function planReportPayload(kind) {
    if (kind === 'assignments') {
        return {
            groups: visibleAssignments().map(g => ({
                name: g.unassigned ? 'Unassigned' : g.name,
                role: g.role,
                unassigned: g.unassigned,
                totals: g.totals,
                tasks: g.tasks.map(row => ({
                    name: row.task.name,
                    phase: row.task.phase || '',
                    start: row.task.start || '',
                    finish: inclusiveFinish(row.task),
                    duration: row.task.duration_days || 0,
                    percent: parseFloat(String(row.task.percent || 0)) || 0,
                    status: row.status,
                    shared_with: row.sharedWith,
                })),
            })),
        };
    }
    const report = reportState.slippage.report;
    if (!report) return null;
    const row = r => ({
        name: r.name,
        phase: r.phase,
        critical: r.critical,
        baseline_start: r.baselineStart,
        baseline_finish: inclusiveFinish({ finish: r.baselineFinish }),
        start: r.start,
        finish: inclusiveFinish(r.task),
        start_variance: r.startVariance,
        finish_variance: r.finishVariance,
        status: r.status,
    });
    return {
        baseline: reportState.slippage.baselineLabel,
        project: {
            baseline_finish: report.project.baselineFinish ? inclusiveFinish({ finish: report.project.baselineFinish }) : '',
            finish: report.project.finish ? inclusiveFinish({ finish: report.project.finish }) : '',
            variance: report.project.variance,
            status: report.project.status,
        },
        counts: report.counts,
        critical: report.critical.map(row),
        phases: report.phases.map(r => ({ ...row(r), level: r.level, slipped_tasks: r.slippedTasks, worst_slip: r.worstSlip })),
        tasks: report.rows.filter(r => !r.summary).map(row),
        added: report.added.map(t => ({ name: t.name, phase: t.phase || '' })),
        removed: report.removed.map(b => ({ name: b.name })),
    };
}

async function exportPlanReport(kind, format) {
    const data = planReportPayload(kind);
    if (!data) {
        if (typeof showToast === 'function') showToast('Set a baseline first: there is nothing to compare against.', 'warning');
        return;
    }
    try {
        const response = await fetch('/api/reports/export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ report: kind, format, project_name: reportState.projectName, data }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        const stem = (reportState.projectName || 'plan').replace(/[^\w.-]+/g, '_');
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${stem}_${kind === 'assignments' ? 'tasks_by_assignment' : 'slippage'}.${format}`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    } catch (error) {
        console.error('Report export failed:', error);
        if (typeof showToast === 'function') showToast('The export failed. Please try again.', 'error');
    }
}
