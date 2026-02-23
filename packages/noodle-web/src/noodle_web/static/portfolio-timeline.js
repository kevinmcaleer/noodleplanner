/**
 * Portfolio Timeline View
 * Shows multi-project timeline with milestones and date ranges
 */

/**
 * Extract timeline data from project plan
 */
function extractProjectTimeline(planText, projectId, projectName) {
    if (!planText) return null;

    const lines = planText.split('\n');
    const timeline = {
        projectId: projectId,
        projectName: projectName,
        tasks: [],
        milestones: [],
        startDate: null,
        endDate: null
    };

    let currentPhase = null;

    lines.forEach(line => {
        const trimmed = line.trim();

        // Detect phase headers
        if (trimmed.match(/^#{1,3}\s+(.+)/)) {
            const match = trimmed.match(/^#{1,3}\s+(.+)/);
            currentPhase = match[1].trim();
        }

        // Match task lines with dates
        // Looking for patterns like: "Task name [dates] %X"
        const taskMatch = trimmed.match(/^\s{2,}(.+?)\s*\[([^\]]+)\]\s*(%?\d+)?/);
        if (taskMatch) {
            const taskName = taskMatch[1].trim();
            const dateStr = taskMatch[2].trim();
            const completion = taskMatch[3] ? parseInt(taskMatch[3].replace('%', '')) : 0;

            // Try to parse dates
            const dates = parseDateRange(dateStr);
            if (dates) {
                const taskData = {
                    name: taskName,
                    phase: currentPhase || 'Unassigned',
                    startDate: dates.start,
                    endDate: dates.end,
                    completion: completion,
                    isMilestone: dates.start === dates.end
                };

                if (taskData.isMilestone) {
                    timeline.milestones.push(taskData);
                } else {
                    timeline.tasks.push(taskData);
                }

                // Update project start/end dates
                if (!timeline.startDate || dates.start < timeline.startDate) {
                    timeline.startDate = dates.start;
                }
                if (!timeline.endDate || dates.end > timeline.endDate) {
                    timeline.endDate = dates.end;
                }
            }
        }
    });

    return timeline;
}

/**
 * Parse date range from string
 */
function parseDateRange(dateStr) {
    // Try different date formats
    const formats = [
        // Range: "2024-01-15 to 2024-02-20"
        /(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})/,
        // Range: "Jan 15 to Feb 20"
        /([A-Za-z]{3}\s+\d{1,2})\s+to\s+([A-Za-z]{3}\s+\d{1,2})/,
        // Single date: "2024-01-15"
        /^(\d{4}-\d{2}-\d{2})$/,
        // Single date: "Jan 15"
        /^([A-Za-z]{3}\s+\d{1,2})$/
    ];

    for (const format of formats) {
        const match = dateStr.match(format);
        if (match) {
            const start = parseDate(match[1]);
            const end = match[2] ? parseDate(match[2]) : start;

            if (start && end) {
                return { start, end };
            }
        }
    }

    return null;
}

/**
 * Parse individual date string
 */
function parseDate(dateStr) {
    // Try ISO format first
    const isoMatch = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
        return new Date(parseInt(isoMatch[1]), parseInt(isoMatch[2]) - 1, parseInt(isoMatch[3]));
    }

    // Try month-day format
    const monthMatch = dateStr.match(/([A-Za-z]{3})\s+(\d{1,2})/);
    if (monthMatch) {
        const months = {
            'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
            'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
        };
        const month = months[monthMatch[1]];
        const day = parseInt(monthMatch[2]);
        const year = new Date().getFullYear(); // Assume current year
        return new Date(year, month, day);
    }

    return null;
}

/**
 * Render portfolio timeline view
 */
let currentTimelineScale = 'months';

function renderPortfolioTimeline() {
    const container = document.getElementById('portfolioTimelineView');
    if (!container) return;

    const projectsData = batchLoadProjectsData();

    if (projectsData.length === 0) {
        container.innerHTML = '<div class="portfolio-empty-state">' +
            '<h3>No Projects</h3>' +
            '<p>Create projects to see their timeline.</p>' +
            '</div>';
        return;
    }

    // Extract timeline data for all projects
    const timelines = [];
    let globalStart = null;
    let globalEnd = null;

    projectsData.forEach(project => {
        const timeline = extractProjectTimeline(project.planText, project.id, project.name);
        if (timeline && timeline.startDate && timeline.endDate) {
            timelines.push(timeline);

            if (!globalStart || timeline.startDate < globalStart) {
                globalStart = timeline.startDate;
            }
            if (!globalEnd || timeline.endDate > globalEnd) {
                globalEnd = timeline.endDate;
            }
        }
    });

    if (timelines.length === 0) {
        container.innerHTML = '<div class="portfolio-empty-state">' +
            '<h3>No Timeline Data</h3>' +
            '<p>Add tasks with dates to your projects to see the timeline.</p>' +
            '<p>Use format: <code>Task name [2024-01-15 to 2024-02-20]</code></p>' +
            '</div>';
        return;
    }

    // Add some padding to the timeline
    const padding = 7 * 24 * 60 * 60 * 1000; // 7 days
    globalStart = new Date(globalStart.getTime() - padding);
    globalEnd = new Date(globalEnd.getTime() + padding);

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
        '<div class="portfolio-timeline-container">';

    // Render date scale
    html += renderTimelineScale(globalStart, globalEnd, currentTimelineScale);

    // Render each project timeline
    timelines.forEach(timeline => {
        html += renderProjectTimeline(timeline, globalStart, globalEnd);
    });

    html += '</div></div>';

    container.innerHTML = html;
}

/**
 * Render timeline scale (date headers)
 */
function renderTimelineScale(startDate, endDate, scale) {
    const totalDays = Math.ceil((endDate - startDate) / (24 * 60 * 60 * 1000));

    let html = '<div class="timeline-scale">' +
        '<div class="timeline-project-label">Timeline</div>' +
        '<div class="timeline-scale-track">';

    if (scale === 'months') {
        const current = new Date(startDate);
        while (current <= endDate) {
            const monthStart = new Date(current.getFullYear(), current.getMonth(), 1);
            const monthEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0);

            const left = ((monthStart - startDate) / (endDate - startDate)) * 100;
            const width = ((monthEnd - monthStart) / (endDate - startDate)) * 100;

            const monthName = monthStart.toLocaleString('default', { month: 'short' });
            const year = monthStart.getFullYear();

            html += '<div class="timeline-scale-item" style="left: ' + left + '%; width: ' + width + '%">' +
                monthName + ' ' + year + '</div>';

            current.setMonth(current.getMonth() + 1);
        }
    } else if (scale === 'quarters') {
        const current = new Date(startDate.getFullYear(), Math.floor(startDate.getMonth() / 3) * 3, 1);
        while (current <= endDate) {
            const quarter = Math.floor(current.getMonth() / 3) + 1;
            const quarterStart = new Date(current.getFullYear(), (quarter - 1) * 3, 1);
            const quarterEnd = new Date(current.getFullYear(), quarter * 3, 0);

            const left = ((quarterStart - startDate) / (endDate - startDate)) * 100;
            const width = ((quarterEnd - quarterStart) / (endDate - startDate)) * 100;

            html += '<div class="timeline-scale-item" style="left: ' + left + '%; width: ' + width + '%">' +
                'Q' + quarter + ' ' + current.getFullYear() + '</div>';

            current.setMonth(current.getMonth() + 3);
        }
    } else if (scale === 'years') {
        const current = new Date(startDate.getFullYear(), 0, 1);
        while (current <= endDate) {
            const yearStart = new Date(current.getFullYear(), 0, 1);
            const yearEnd = new Date(current.getFullYear(), 11, 31);

            const left = ((yearStart - startDate) / (endDate - startDate)) * 100;
            const width = ((yearEnd - yearStart) / (endDate - startDate)) * 100;

            html += '<div class="timeline-scale-item" style="left: ' + left + '%; width: ' + width + '%">' +
                current.getFullYear() + '</div>';

            current.setFullYear(current.getFullYear() + 1);
        }
    }

    // Add current date marker
    const today = new Date();
    if (today >= startDate && today <= endDate) {
        const todayLeft = ((today - startDate) / (endDate - startDate)) * 100;
        html += '<div class="timeline-today-marker" style="left: ' + todayLeft + '%"></div>';
    }

    html += '</div></div>';

    return html;
}

/**
 * Render individual project timeline
 */
function renderProjectTimeline(timeline, globalStart, globalEnd) {
    let html = '<div class="timeline-project-row" onclick="switchToProject(\'' + timeline.projectId + '\')">' +
        '<div class="timeline-project-label" title="' + escapeHtml(timeline.projectName) + '">' +
        escapeHtml(timeline.projectName) +
        '</div>' +
        '<div class="timeline-project-track">';

    // Render task bars
    timeline.tasks.forEach((task, index) => {
        const left = ((task.startDate - globalStart) / (globalEnd - globalStart)) * 100;
        const width = ((task.endDate - task.startDate) / (globalEnd - globalStart)) * 100;

        const completionClass = task.completion === 100 ? 'completed' : task.completion > 0 ? 'in-progress' : 'not-started';
        const colorIndex = index % 5; // Cycle through 5 colors

        html += '<div class="timeline-task-bar timeline-color-' + colorIndex + ' ' + completionClass + '" ' +
            'style="left: ' + left + '%; width: ' + Math.max(width, 0.5) + '%" ' +
            'title="' + escapeHtml(task.name) + ' (' + task.startDate.toLocaleDateString() + ' - ' + task.endDate.toLocaleDateString() + ')">' +
            '<div class="timeline-task-completion" style="width: ' + task.completion + '%"></div>' +
            '</div>';
    });

    // Render milestones
    timeline.milestones.forEach(milestone => {
        const left = ((milestone.startDate - globalStart) / (globalEnd - globalStart)) * 100;

        html += '<div class="timeline-milestone" style="left: ' + left + '%" ' +
            'title="' + escapeHtml(milestone.name) + ' (' + milestone.startDate.toLocaleDateString() + ')"></div>';
    });

    html += '</div></div>';

    return html;
}

/**
 * Change timeline scale
 */
function changeTimelineScale(scale) {
    currentTimelineScale = scale;
    renderPortfolioTimeline();
}
