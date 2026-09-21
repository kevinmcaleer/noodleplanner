/**
 * Portfolio Timeline View
 * Shows multi-project timeline with SVG swimlanes using /api/parse data
 */

let currentTimelineScale = 'months';

/**
 * Build the portfolio timeline's swimlane markup from parsed projects.
 *
 * Split out of renderPortfolioTimeline so the PowerPoint export can render
 * the same markup into an offscreen element and rasterise it there (#1276).
 * The export used to force `#portfolioTimelineView` visible and re-render it
 * in place, which rebuilt a view the user might have been reading -- or
 * flashed one up over whichever page they had navigated to while the export
 * ran in the background.
 *
 * @param {Array} parsedProjects Results in parseAllProjects() shape
 * @param {string} [scale] Date scale; defaults to the view's current one
 * @returns {{html: string, timelines: Array, globalStart: Date, globalEnd: Date}|null}
 *   null when no project carries enough date data to draw.
 */
function buildPortfolioTimelineMarkup(parsedProjects, scale) {
    const timelineScale = scale || currentTimelineScale;
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

        // Calculate overall project progress from leaf tasks
        const leafTasks = tasks.filter(t => !t.is_summary);
        let overallPercent = 0;
        if (leafTasks.length > 0) {
            const totalPct = leafTasks.reduce((sum, t) => sum + (parseFloat(t.percent) || 0), 0);
            overallPercent = Math.round(totalPct / leafTasks.length);
        }

        timelines.push({
            projectId: project.id,
            projectName: project.name,
            phases,
            milestones,
            startDate: projectStart,
            endDate: projectEnd,
            overallPercent
        });

        if (!globalStart || projectStart < globalStart) globalStart = projectStart;
        if (!globalEnd || projectEnd > globalEnd) globalEnd = projectEnd;
    });

    if (timelines.length === 0) return null;

    // No extra padding — start and end sit at the edges

    let html = '<div class="portfolio-timeline-wrapper">' +
        '<div class="portfolio-timeline-container" style="position: relative;">';

    // Date scale header
    html += renderTimelineScale(globalStart, globalEnd, timelineScale);

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

    return { html: html, timelines: timelines, globalStart: globalStart, globalEnd: globalEnd };
}

/**
 * Render portfolio timeline view (async — uses /api/parse)
 *
 * @param {Array} [preParsed] Already-parsed projects, in the shape
 *   parseAllProjects() returns. The PowerPoint export has just parsed every
 *   plan by the time it renders the timeline to capture it, so passing them
 *   in saves a second round trip per project (#778).
 */
async function renderPortfolioTimeline(preParsed) {
    const container = document.getElementById('portfolioTimelineView');
    if (!container) return;

    // Show loading state
    container.innerHTML = '<div class="portfolio-loading">' +
        '<div class="portfolio-loading-spinner"></div>' +
        '<p>Loading timeline data...</p>' +
        '</div>';

    try {
        const parsedProjects = preParsed || await parseAllProjects();

        if (parsedProjects.length === 0) {
            container.innerHTML = '<np-empty-state variant="card" heading="No Projects">' +
                '<p>Create projects to see their timeline.</p>' +
                '</np-empty-state>';
            return;
        }

        const built = buildPortfolioTimelineMarkup(parsedProjects, currentTimelineScale);

        if (!built) {
            container.innerHTML = '<np-empty-state variant="card" heading="No Timeline Data">' +
                '<p>Add tasks with dates or durations to your project plans to see the timeline.</p>' +
                '<p>The backend scheduler computes dates from <code>@resource 5d</code> notation automatically.</p>' +
                '</np-empty-state>';
            return;
        }

        const { timelines, globalStart, globalEnd } = built;

        container.innerHTML = '<div class="portfolio-timeline-header">' +
            '<h2><span class="ribbon-banner ribbon-banner--green">Portfolio Timeline</span></h2>' +
            '<div class="timeline-controls">' +
            '<label>Scale: </label>' +
            '<select id="timelineScaleSelect" onchange="changeTimelineScale(this.value)">' +
            '<option value="months"' + (currentTimelineScale === 'months' ? ' selected' : '') + '>Months</option>' +
            '<option value="quarters"' + (currentTimelineScale === 'quarters' ? ' selected' : '') + '>Quarters</option>' +
            '<option value="years"' + (currentTimelineScale === 'years' ? ' selected' : '') + '>Years</option>' +
            '</select>' +
            '</div>' +
            '</div>' + built.html;

        // Draw inter-project dependency arrows if the module is loaded
        if (typeof drawDependencyArrows === 'function' && typeof propagateProgrammeDependencies === 'function') {
            propagateProgrammeDependencies(parsedProjects).then(propResult => {
                drawDependencyArrows(timelines, globalStart, globalEnd, propResult);
            }).catch(err => {
                console.warn('Could not draw dependency arrows:', err);
            });
        }

    } catch (error) {
        console.error('Error rendering portfolio timeline:', error);
        container.innerHTML = '<np-empty-state variant="card" heading="Error Loading Timeline">' +
            '<p>Failed to load timeline data. Please try again.</p>' +
            '</np-empty-state>';
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
    const barHeight = 28;
    const rowPadding = 6;
    const milestoneRadius = 7;

    // Assign rows for phases using overlap detection
    const phaseRows = assignSwimlanePhaseRows(timeline.phases, globalStart, totalMs);
    const numRows = phaseRows.length > 0 ? Math.max(...phaseRows.map(p => p.row)) + 1 : 0;
    const phaseAreaHeight = numRows > 0 ? numRows * (barHeight + rowPadding) + 4 : 0;
    const lineY = phaseAreaHeight + 16; // horizontal backbone below phases
    const svgHeight = lineY + milestoneRadius + 4;

    // Blue shades for incomplete phases
    const blueShades = ['#1565c0', '#1976d2', '#1e88e5', '#2196f3', '#42a5f5', '#64b5f6'];
    const greenComplete = '#4caf50';
    const overallPercent = timeline.overallPercent || 0;

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
        if (wPct > 4) {
            const fontSize = Math.min(14, barHeight - 6);
            const textLabel = isComplete ? '\u2713 ' + phase.name : phase.name;
            html += '<text x="' + (xPct + 0.3) + '%" y="' + (y + barHeight / 2) + '" ' +
                'dominant-baseline="central" font-size="' + fontSize + 'px" fill="#fff" font-weight="500" ' +
                'style="pointer-events: none;">' +
                '<tspan>' + escapeHtml(textLabel) + '</tspan>' +
                '</text>';
        }
    });

    // Horizontal backbone line (full width)
    html += '<line x1="0" y1="' + lineY + '" x2="100%" y2="' + lineY + '" ' +
        'stroke="#bbb" stroke-width="2" />';

    // Progress indicator on the backbone line
    if (overallPercent > 0) {
        html += '<line x1="0" y1="' + lineY + '" x2="' + overallPercent + '%" y2="' + lineY + '" ' +
            'stroke="' + greenComplete + '" stroke-width="3" />';
        // Small circle at the progress endpoint
        html += '<circle cx="' + overallPercent + '%" cy="' + lineY + '" r="4" ' +
            'fill="' + greenComplete + '" stroke="#fff" stroke-width="1.5">' +
            '<title>Overall progress: ' + overallPercent + '%</title></circle>';
    }

    // End-cap circles on backbone line
    html += '<circle cx="0" cy="' + lineY + '" r="3" fill="#bbb" />';
    html += '<circle cx="100%" cy="' + lineY + '" r="3" fill="#bbb" />';

    // Render milestones ON the backbone line (aligned with it)
    timeline.milestones.forEach(milestone => {
        const milestoneDate = new Date(milestone.finish);
        const xPct = ((milestoneDate.getTime() - globalStart.getTime()) / totalMs) * 100;
        const percent = parseFloat(milestone.percent) || 0;
        const isComplete = percent >= 100;
        const color = isComplete ? '#28a745' : '#1976d2';

        html += '<circle cx="' + xPct + '%" cy="' + lineY + '" r="' + milestoneRadius + '" fill="' + color + '" ' +
            'stroke="#fff" stroke-width="2" class="swimlane-milestone-dot">' +
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
