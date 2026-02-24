/**
 * Portfolio Timeline View
 * Shows multi-project timeline with SVG swimlanes using /api/parse data
 */

let currentTimelineScale = 'months';

/**
 * Render portfolio timeline view (async — uses /api/parse)
 */
async function renderPortfolioTimeline() {
    const container = document.getElementById('portfolioTimelineView');
    if (!container) return;

    // Show loading state
    container.innerHTML = '<div class="portfolio-loading">' +
        '<div class="portfolio-loading-spinner"></div>' +
        '<p>Loading timeline data...</p>' +
        '</div>';

    try {
        const parsedProjects = await parseAllProjects();

        if (parsedProjects.length === 0) {
            container.innerHTML = '<div class="portfolio-empty-state">' +
                '<h3>No Projects</h3>' +
                '<p>Create projects to see their timeline.</p>' +
                '</div>';
            return;
        }

        // Build timeline data from parsed results
        const timelines = [];
        let globalStart = null;
        let globalEnd = null;

        parsedProjects.forEach(({ project, parsedResult }) => {
            if (!parsedResult || !parsedResult.success || !parsedResult.tasks) return;

            const tasks = parsedResult.tasks;
            const phases = tasks.filter(t => t.is_summary && t.start && t.finish);
            const milestones = tasks.filter(t => !t.is_summary && t.duration_days === 0 && t.finish);

            // Skip projects with no date data
            if (phases.length === 0 && milestones.length === 0) return;

            // Compute project date range
            let projectStart = null;
            let projectEnd = null;

            tasks.forEach(t => {
                if (t.start) {
                    const s = new Date(t.start);
                    if (!projectStart || s < projectStart) projectStart = s;
                }
                if (t.finish) {
                    const f = new Date(t.finish);
                    if (!projectEnd || f > projectEnd) projectEnd = f;
                }
            });

            if (!projectStart || !projectEnd) return;

            console.log('Timeline: "' + project.name + '" → ' + phases.length + ' phases, ' +
                milestones.length + ' milestones, range: ' +
                projectStart.toISOString().slice(0, 10) + ' to ' + projectEnd.toISOString().slice(0, 10));
            phases.forEach(p => console.log('  Phase: "' + p.name + '" ' + p.start + ' → ' + p.finish + ' (' + (p.percent || 0) + '%)'));

            timelines.push({
                projectId: project.id,
                projectName: project.name,
                phases,
                milestones,
                startDate: projectStart,
                endDate: projectEnd
            });

            if (!globalStart || projectStart < globalStart) globalStart = projectStart;
            if (!globalEnd || projectEnd > globalEnd) globalEnd = projectEnd;
        });

        if (timelines.length === 0) {
            container.innerHTML = '<div class="portfolio-empty-state">' +
                '<h3>No Timeline Data</h3>' +
                '<p>Add tasks with dates or durations to your project plans to see the timeline.</p>' +
                '<p>The backend scheduler computes dates from <code>@resource 5d</code> notation automatically.</p>' +
                '</div>';
            return;
        }

        // 7-day padding
        const padding = 7 * 24 * 60 * 60 * 1000;
        globalStart = new Date(globalStart.getTime() - padding);
        globalEnd = new Date(globalEnd.getTime() + padding);

        // Build HTML
        let html = '<div class="portfolio-timeline-header">' +
            '<h2>Portfolio Timeline</h2>' +
            '<div class="timeline-controls">' +
            '<label>Scale: </label>' +
            '<select id="timelineScaleSelect" onchange="changeTimelineScale(this.value)">' +
            '<option value="months"' + (currentTimelineScale === 'months' ? ' selected' : '') + '>Months</option>' +
            '<option value="quarters"' + (currentTimelineScale === 'quarters' ? ' selected' : '') + '>Quarters</option>' +
            '<option value="years"' + (currentTimelineScale === 'years' ? ' selected' : '') + '>Years</option>' +
            '</select>' +
            '</div>' +
            '</div>';

        html += '<div class="portfolio-timeline-wrapper">' +
            '<div class="portfolio-timeline-container" style="position: relative;">';

        // Date scale header
        html += renderTimelineScale(globalStart, globalEnd, currentTimelineScale);

        // Render each project as a swimlane
        timelines.forEach(timeline => {
            html += renderProjectSwimlane(timeline, globalStart, globalEnd);
        });

        // Today marker spanning all swimlanes (positioned within the track area)
        const today = new Date();
        if (today >= globalStart && today <= globalEnd) {
            const todayPct = ((today - globalStart) / (globalEnd - globalStart)) * 100;
            // The track area starts after the 200px label column.
            // Use calc to position: 200px label + todayPct% of remaining width
            html += '<div class="portfolio-today-line" style="left: calc(200px + (100% - 200px) * ' +
                (todayPct / 100) + ');"></div>';
        }

        html += '</div></div>';

        container.innerHTML = html;

    } catch (error) {
        console.error('Error rendering portfolio timeline:', error);
        container.innerHTML = '<div class="portfolio-empty-state">' +
            '<h3>Error Loading Timeline</h3>' +
            '<p>Failed to load timeline data. Please try again.</p>' +
            '</div>';
    }
}

/**
 * Render timeline scale (date headers) — shared date axis
 */
function renderTimelineScale(startDate, endDate, scale) {
    let html = '<div class="timeline-scale">' +
        '<div class="timeline-project-label">Project</div>' +
        '<div class="timeline-scale-track">';

    if (scale === 'months') {
        const current = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
        while (current <= endDate) {
            const monthStart = new Date(current.getFullYear(), current.getMonth(), 1);
            const monthEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0);

            const left = Math.max(0, ((monthStart - startDate) / (endDate - startDate)) * 100);
            const width = ((monthEnd - monthStart) / (endDate - startDate)) * 100;

            const monthName = monthStart.toLocaleString('default', { month: 'short' });
            const year = monthStart.getFullYear();

            html += '<div class="timeline-scale-item" style="left:' + left + '%; width:' + width + '%">' +
                monthName + ' ' + year + '</div>';

            current.setMonth(current.getMonth() + 1);
        }
    } else if (scale === 'quarters') {
        const startQ = Math.floor(startDate.getMonth() / 3) * 3;
        const current = new Date(startDate.getFullYear(), startQ, 1);
        while (current <= endDate) {
            const quarter = Math.floor(current.getMonth() / 3) + 1;
            const quarterStart = new Date(current.getFullYear(), (quarter - 1) * 3, 1);
            const quarterEnd = new Date(current.getFullYear(), quarter * 3, 0);

            const left = Math.max(0, ((quarterStart - startDate) / (endDate - startDate)) * 100);
            const width = ((quarterEnd - quarterStart) / (endDate - startDate)) * 100;

            html += '<div class="timeline-scale-item" style="left:' + left + '%; width:' + width + '%">' +
                'Q' + quarter + ' ' + current.getFullYear() + '</div>';

            current.setMonth(current.getMonth() + 3);
        }
    } else if (scale === 'years') {
        const current = new Date(startDate.getFullYear(), 0, 1);
        while (current <= endDate) {
            const yearStart = new Date(current.getFullYear(), 0, 1);
            const yearEnd = new Date(current.getFullYear(), 11, 31);

            const left = Math.max(0, ((yearStart - startDate) / (endDate - startDate)) * 100);
            const width = ((yearEnd - yearStart) / (endDate - startDate)) * 100;

            html += '<div class="timeline-scale-item" style="left:' + left + '%; width:' + width + '%">' +
                current.getFullYear() + '</div>';

            current.setFullYear(current.getFullYear() + 1);
        }
    }

    html += '</div></div>';
    return html;
}

/**
 * Render a project swimlane row with inline SVG
 */
function renderProjectSwimlane(timeline, globalStart, globalEnd) {
    const totalMs = globalEnd.getTime() - globalStart.getTime();
    const barHeight = 14;
    const rowPadding = 4;

    // Assign rows for phases using overlap detection
    const phaseRows = assignSwimlanePhaseRows(timeline.phases, globalStart, totalMs);
    const numRows = phaseRows.length > 0 ? Math.max(...phaseRows.map(p => p.row)) + 1 : 1;
    const svgHeight = Math.max(30, numRows * (barHeight + rowPadding) + 10);

    // Blue shades for incomplete phases
    const blueShades = ['#1565c0', '#1976d2', '#1e88e5', '#2196f3', '#42a5f5', '#64b5f6'];
    const greenComplete = '#4caf50';

    let html = '<div class="timeline-project-row" onclick="openProjectDashboard(\'' + timeline.projectId + '\')">' +
        '<div class="timeline-project-label" title="' + escapeHtml(timeline.projectName) + '">' +
        escapeHtml(timeline.projectName) + '</div>' +
        '<div class="timeline-swimlane-track">' +
        '<svg width="100%" height="' + svgHeight + '" preserveAspectRatio="none" style="display: block;">';

    // Render phase bars
    phaseRows.forEach((phaseInfo, index) => {
        const phase = phaseInfo.phase;
        const row = phaseInfo.row;
        const percent = parseFloat(phase.percent) || 0;
        const isComplete = percent >= 100;

        const phaseStart = new Date(phase.start);
        const phaseEnd = new Date(phase.finish);
        const xPct = Math.max(0, ((phaseStart.getTime() - globalStart.getTime()) / totalMs) * 100);
        const wPct = Math.max(0.3, ((phaseEnd.getTime() - phaseStart.getTime()) / totalMs) * 100);
        const y = row * (barHeight + rowPadding) + 4;

        const bgColor = isComplete ? greenComplete : blueShades[index % blueShades.length];

        // Background bar
        html += '<rect x="' + xPct + '%" y="' + y + '" width="' + wPct + '%" height="' + barHeight + '" ' +
            'rx="3" ry="3" fill="' + bgColor + '" opacity="' + (isComplete ? '0.9' : '0.7') + '" ' +
            'class="swimlane-phase-bar">' +
            '<title>' + escapeHtml(phase.name) + ' (' + percent + '% complete)</title>' +
            '</rect>';

        // Progress overlay for partial completion
        if (percent > 0 && percent < 100) {
            const progressPct = (percent / 100) * wPct;
            html += '<rect x="' + xPct + '%" y="' + y + '" width="' + progressPct + '%" height="' + barHeight + '" ' +
                'rx="3" ry="3" fill="' + greenComplete + '" opacity="0.85" class="swimlane-phase-bar">' +
                '<title>' + escapeHtml(phase.name) + ' (' + percent + '% complete)</title>' +
                '</rect>';
        }

        // Phase name text inside bar (only if wide enough)
        // We use a rough heuristic: wPct > 4 means ~40px+ at typical widths
        if (wPct > 4) {
            const fontSize = Math.min(10, barHeight - 3);
            const textLabel = isComplete ? '\u2713 ' + phase.name : phase.name;
            html += '<text x="' + (xPct + 0.3) + '%" y="' + (y + barHeight / 2) + '" ' +
                'dominant-baseline="central" font-size="' + fontSize + 'px" fill="#fff" font-weight="500" ' +
                'style="pointer-events: none;">' +
                '<tspan>' + escapeHtml(textLabel) + '</tspan>' +
                '</text>';
        }
    });

    // Render milestones as small colored circles
    timeline.milestones.forEach(milestone => {
        const milestoneDate = new Date(milestone.finish);
        const xPct = ((milestoneDate.getTime() - globalStart.getTime()) / totalMs) * 100;
        const percent = parseFloat(milestone.percent) || 0;
        const isComplete = percent >= 100;
        const color = isComplete ? '#28a745' : '#1976d2';
        const cy = svgHeight / 2;

        html += '<circle cx="' + xPct + '%" cy="' + cy + '" r="5" fill="' + color + '" ' +
            'stroke="#fff" stroke-width="1.5" class="swimlane-milestone-dot">' +
            '<title>' + escapeHtml(milestone.name) + ' (' + milestone.finish + ')</title>' +
            '</circle>';
    });

    html += '</svg></div></div>';
    return html;
}

/**
 * Assign rows for phases in a swimlane to avoid overlaps
 * Returns [{phase, row}]
 */
function assignSwimlanePhaseRows(phases, globalStart, totalMs) {
    if (phases.length === 0) return [];

    const positioned = phases.map(phase => {
        const s = new Date(phase.start).getTime();
        const e = new Date(phase.finish).getTime();
        return { phase, startMs: s, endMs: e, row: 0 };
    });

    // Sort by start time
    positioned.sort((a, b) => a.startMs - b.startMs);

    // Greedy row assignment
    const rowEnds = []; // Track the end time of the last item in each row
    positioned.forEach(item => {
        let placed = false;
        for (let r = 0; r < rowEnds.length; r++) {
            if (item.startMs >= rowEnds[r]) {
                item.row = r;
                rowEnds[r] = item.endMs;
                placed = true;
                break;
            }
        }
        if (!placed) {
            item.row = rowEnds.length;
            rowEnds.push(item.endMs);
        }
    });

    return positioned;
}

/**
 * Change timeline scale
 */
function changeTimelineScale(scale) {
    currentTimelineScale = scale;
    renderPortfolioTimeline();
}
