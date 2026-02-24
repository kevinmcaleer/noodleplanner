/**
 * Portfolio Resources View
 * Shows resource allocation and workload across all projects
 * Uses /api/parse data for accurate dates, durations, and effort
 */

/**
 * Aggregate resource data from parsed project results
 * @param {Array<{project, parsedResult}>} parsedProjects
 * @returns {Array} resources with dates, durations, effort
 */
function aggregateResourceDataFromParsed(parsedProjects) {
    const resourceMap = new Map();

    parsedProjects.forEach(({ project, parsedResult }) => {
        if (!parsedResult || !parsedResult.success || !parsedResult.tasks) return;

        parsedResult.tasks.forEach(task => {
            if (!task.resources || task.is_summary) return;

            // Split comma-separated resources
            const resourceNames = task.resources.split(',').map(r => r.trim()).filter(Boolean);

            resourceNames.forEach(resourceName => {
                if (!resourceMap.has(resourceName)) {
                    resourceMap.set(resourceName, {
                        name: resourceName,
                        totalTasks: 0,
                        completedTasks: 0,
                        inProgressTasks: 0,
                        notStartedTasks: 0,
                        totalDays: 0,
                        earliestStart: null,
                        latestFinish: null,
                        projects: new Set(),
                        assignments: []
                    });
                }

                const rd = resourceMap.get(resourceName);
                const percent = parseFloat(task.percent) || 0;
                const status = percent >= 100 ? 'completed' : percent > 0 ? 'in-progress' : 'not-started';
                const durationDays = task.duration_days || 0;

                rd.totalTasks++;
                rd.projects.add(project.name);

                if (status === 'completed') rd.completedTasks++;
                else if (status === 'in-progress') rd.inProgressTasks++;
                else rd.notStartedTasks++;

                // Split duration among co-assigned resources
                const perResourceDays = durationDays / resourceNames.length;
                rd.totalDays += perResourceDays;

                // Track date range
                if (task.start) {
                    const s = new Date(task.start);
                    if (!rd.earliestStart || s < rd.earliestStart) rd.earliestStart = s;
                }
                if (task.finish) {
                    const f = new Date(task.finish);
                    if (!rd.latestFinish || f > rd.latestFinish) rd.latestFinish = f;
                }

                rd.assignments.push({
                    projectId: project.id,
                    projectName: project.name,
                    phase: task.phase || 'Unassigned',
                    task: task.name,
                    start: task.start || null,
                    finish: task.finish || null,
                    durationDays: durationDays,
                    completion: percent,
                    status: status,
                    effortTotal: task.effort_total || null,
                    effortTotalUnit: task.effort_total_unit || null
                });
            });
        });
    });

    return Array.from(resourceMap.values()).map(r => {
        r.projects = Array.from(r.projects);
        r.projectCount = r.projects.length;
        r.completionRate = r.totalTasks > 0
            ? Math.round((r.completedTasks / r.totalTasks) * 100) : 0;
        r.totalDays = Math.round(r.totalDays * 10) / 10;
        r.dateRange = formatDateRange(r.earliestStart, r.latestFinish);
        r.workloadLevel = calculateWorkloadLevel(r.totalDays, r.inProgressTasks);
        return r;
    });
}

/**
 * Format a date range string
 */
function formatDateRange(start, end) {
    if (!start && !end) return 'No dates';
    const fmt = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
    if (start && end) return fmt(start) + ' – ' + fmt(end);
    if (start) return fmt(start) + ' –';
    return '– ' + fmt(end);
}

/**
 * Calculate workload level based on total allocated days and active tasks
 */
function calculateWorkloadLevel(totalDays, inProgressTasks) {
    if (totalDays === 0 && inProgressTasks === 0) return 'low';
    if (totalDays <= 10) return 'low';
    if (totalDays <= 30) return 'medium';
    if (totalDays <= 60) return 'high';
    return 'overloaded';
}

/**
 * Get workload badge class
 */
function getWorkloadBadgeClass(level) {
    const classes = {
        'low': 'workload-low',
        'medium': 'workload-medium',
        'high': 'workload-high',
        'overloaded': 'workload-overloaded'
    };
    return classes[level] || 'workload-low';
}

/**
 * Compute weekly heatmap data for resources
 * Distributes task durations across weeks (Mon-Fri working days)
 */
function computeWeeklyHeatmapData(resources) {
    // Find global date range across all resources
    let globalStart = null;
    let globalEnd = null;

    resources.forEach(r => {
        if (r.earliestStart && (!globalStart || r.earliestStart < globalStart)) globalStart = r.earliestStart;
        if (r.latestFinish && (!globalEnd || r.latestFinish > globalEnd)) globalEnd = r.latestFinish;
    });

    if (!globalStart || !globalEnd) return null;

    // Align to Monday
    const startMonday = new Date(globalStart);
    startMonday.setDate(startMonday.getDate() - ((startMonday.getDay() + 6) % 7));
    startMonday.setHours(0, 0, 0, 0);

    const endDate = new Date(globalEnd);
    endDate.setHours(23, 59, 59, 999);

    // Build week columns
    const weeks = [];
    const cursor = new Date(startMonday);
    while (cursor <= endDate) {
        const weekStart = new Date(cursor);
        const weekEnd = new Date(cursor);
        weekEnd.setDate(weekEnd.getDate() + 4); // Friday
        weeks.push({
            start: weekStart,
            end: weekEnd,
            label: weekStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
        });
        cursor.setDate(cursor.getDate() + 7);
    }

    // Limit to reasonable number of weeks (max 26 = ~6 months)
    const maxWeeks = 26;
    const displayWeeks = weeks.length > maxWeeks ? weeks.slice(0, maxWeeks) : weeks;

    // For each resource, distribute task days across weeks
    const heatmap = resources.map(resource => {
        const weekDays = new Array(displayWeeks.length).fill(0);

        resource.assignments.forEach(a => {
            if (!a.start || !a.finish) return;
            const taskStart = new Date(a.start);
            const taskEnd = new Date(a.finish);
            const taskDuration = a.durationDays || 0;
            if (taskDuration === 0) return;

            // Count total working days the task spans
            let totalWorkingDays = 0;
            const d = new Date(taskStart);
            while (d <= taskEnd) {
                const dow = d.getDay();
                if (dow >= 1 && dow <= 5) totalWorkingDays++;
                d.setDate(d.getDate() + 1);
            }
            if (totalWorkingDays === 0) return;

            // Days per working day
            const daysPerWorkDay = taskDuration / totalWorkingDays;

            // Distribute across weeks
            displayWeeks.forEach((week, wi) => {
                const overlapStart = new Date(Math.max(taskStart.getTime(), week.start.getTime()));
                const overlapEnd = new Date(Math.min(taskEnd.getTime(), week.end.getTime()));
                if (overlapStart > overlapEnd) return;

                let workingDaysInWeek = 0;
                const wd = new Date(overlapStart);
                while (wd <= overlapEnd) {
                    const dow = wd.getDay();
                    if (dow >= 1 && dow <= 5) workingDaysInWeek++;
                    wd.setDate(wd.getDate() + 1);
                }

                // Share among co-assigned resources (already split in totalDays, but for heatmap we use raw)
                weekDays[wi] += daysPerWorkDay * workingDaysInWeek;
            });
        });

        return {
            name: resource.name,
            weekDays: weekDays.map(d => Math.round(d * 10) / 10)
        };
    });

    return { weeks: displayWeeks, heatmap };
}

/**
 * Get heatmap cell class based on days per week
 */
function getHeatmapCellClass(days) {
    if (days === 0) return 'heatmap-none';
    if (days < 2) return 'heatmap-low';
    if (days < 4) return 'heatmap-medium';
    if (days <= 5) return 'heatmap-high';
    return 'heatmap-overloaded';
}

/**
 * Render portfolio resources view (async — uses /api/parse)
 */
async function renderPortfolioResources() {
    const container = document.getElementById('portfolioResourcesView');
    if (!container) return;

    // Show loading state
    container.innerHTML = '<div class="portfolio-loading">' +
        '<div class="portfolio-loading-spinner"></div>' +
        '<p>Loading resource data...</p>' +
        '</div>';

    try {
        const parsedProjects = await parseAllProjects();

        if (parsedProjects.length === 0) {
            container.innerHTML = '<div class="portfolio-empty-state">' +
                '<h3>No Projects</h3>' +
                '<p>Create projects to see resource allocation.</p>' +
                '</div>';
            return;
        }

        const resources = aggregateResourceDataFromParsed(parsedProjects);

        if (resources.length === 0) {
            container.innerHTML = '<div class="portfolio-empty-state">' +
                '<h3>No Resource Assignments</h3>' +
                '<p>Assign resources to tasks using the <code>[Resource]</code> syntax or <code>@resource</code> notation in your project plans.</p>' +
                '</div>';
            return;
        }

        // Sort by workload (overloaded first)
        const workloadOrder = { 'overloaded': 0, 'high': 1, 'medium': 2, 'low': 3 };
        resources.sort((a, b) => workloadOrder[a.workloadLevel] - workloadOrder[b.workloadLevel]);

        const totalAllocatedDays = resources.reduce((sum, r) => sum + r.totalDays, 0);
        const hotspots = resources.filter(r => r.workloadLevel === 'overloaded' || r.workloadLevel === 'high').length;

        // Summary header
        let html = '<div class="portfolio-resources-header">' +
            '<h2>Resource Allocation Dashboard</h2>' +
            '<div class="portfolio-resources-summary">' +
            '<div class="resource-summary-item">' +
            '<span class="summary-label">Total Resources</span>' +
            '<span class="summary-value">' + resources.length + '</span>' +
            '</div>' +
            '<div class="resource-summary-item">' +
            '<span class="summary-label">Total Allocated Days</span>' +
            '<span class="summary-value">' + Math.round(totalAllocatedDays) + '</span>' +
            '</div>' +
            '<div class="resource-summary-item">' +
            '<span class="summary-label">Hotspots</span>' +
            '<span class="summary-value" style="color: ' + (hotspots > 0 ? '#dc3545' : '#28a745') + '">' + hotspots + '</span>' +
            '</div>' +
            '</div>' +
            '</div>';

        // Main table
        html += '<div class="portfolio-resources-table-wrapper">' +
            '<table class="portfolio-resources-table">' +
            '<thead>' +
            '<tr>' +
            '<th onclick="sortPortfolioResources(\'name\')">Resource</th>' +
            '<th onclick="sortPortfolioResources(\'projects\')">Projects</th>' +
            '<th onclick="sortPortfolioResources(\'tasks\')">Tasks</th>' +
            '<th onclick="sortPortfolioResources(\'totalDays\')">Total Days</th>' +
            '<th onclick="sortPortfolioResources(\'dateRange\')">Date Range</th>' +
            '<th onclick="sortPortfolioResources(\'workload\')">Workload</th>' +
            '<th>Details</th>' +
            '</tr>' +
            '</thead>' +
            '<tbody>';

        resources.forEach(resource => {
            const workloadClass = getWorkloadBadgeClass(resource.workloadLevel);
            const projectsList = resource.projects.join(', ');

            html += '<tr class="resource-row" data-resource="' + escapeHtml(resource.name) + '">' +
                '<td class="resource-name">' + escapeHtml(resource.name) + '</td>' +
                '<td><span class="project-count-badge">' + resource.projectCount + '</span> ' +
                '<span class="projects-tooltip" title="' + escapeHtml(projectsList) + '">' +
                (resource.projectCount === 1 ? escapeHtml(resource.projects[0]) : resource.projectCount + ' projects') +
                '</span></td>' +
                '<td>' + resource.totalTasks + '</td>' +
                '<td>' + resource.totalDays + 'd</td>' +
                '<td style="font-size: 0.85em; color: #6c757d;">' + escapeHtml(resource.dateRange) + '</td>' +
                '<td><span class="workload-badge ' + workloadClass + '">' +
                resource.workloadLevel.toUpperCase() + '</span></td>' +
                '<td><button class="btn-small" onclick="showResourceDetails(\'' +
                escapeHtml(resource.name).replace(/'/g, "\\'") + '\')">View</button></td>' +
                '</tr>';
        });

        html += '</tbody></table></div>';

        // Heatmap section
        const heatmapData = computeWeeklyHeatmapData(resources);
        if (heatmapData && heatmapData.weeks.length > 0) {
            html += renderResourceHeatmap(heatmapData);
        }

        // Resource details modal placeholder
        html += '<div id="resourceDetailsModal" class="resource-details-modal" style="display: none;">' +
            '<div class="resource-details-content">' +
            '<span class="close-btn" onclick="closeResourceDetails()">&times;</span>' +
            '<div id="resourceDetailsBody"></div>' +
            '</div>' +
            '</div>';

        container.innerHTML = html;

        // Store data for sorting and details
        window.portfolioResourcesData = resources;

    } catch (error) {
        console.error('Error rendering portfolio resources:', error);
        container.innerHTML = '<div class="portfolio-empty-state">' +
            '<h3>Error Loading Resources</h3>' +
            '<p>Failed to load resource data. Please try again.</p>' +
            '</div>';
    }
}

/**
 * Render resource heatmap section
 */
function renderResourceHeatmap(heatmapData) {
    const { weeks, heatmap } = heatmapData;
    const cols = weeks.length + 1; // +1 for label column

    let html = '<div class="resource-heatmap-container">' +
        '<h3>Weekly Workload Heatmap</h3>' +
        '<div class="resource-heatmap-grid" style="grid-template-columns: 140px repeat(' + weeks.length + ', 1fr);">';

    // Header row
    html += '<div class="resource-heatmap-label" style="font-weight: 700;">Resource</div>';
    weeks.forEach(week => {
        html += '<div class="resource-heatmap-header-cell">' + week.label + '</div>';
    });

    // Data rows
    heatmap.forEach(row => {
        html += '<div class="resource-heatmap-label">' + escapeHtml(row.name) + '</div>';
        row.weekDays.forEach(days => {
            const cellClass = getHeatmapCellClass(days);
            const displayVal = days > 0 ? days + 'd' : '';
            html += '<div class="resource-heatmap-cell ' + cellClass + '" title="' + days + ' days">' + displayVal + '</div>';
        });
    });

    html += '</div>';

    // Legend
    html += '<div class="resource-heatmap-legend">' +
        '<div class="resource-heatmap-legend-item">' +
        '<div class="resource-heatmap-legend-swatch" style="background: #f0f0f0;"></div> 0d' +
        '</div>' +
        '<div class="resource-heatmap-legend-item">' +
        '<div class="resource-heatmap-legend-swatch" style="background: #c8e6c9;"></div> &lt;2d' +
        '</div>' +
        '<div class="resource-heatmap-legend-item">' +
        '<div class="resource-heatmap-legend-swatch" style="background: #fff9c4;"></div> 2-4d' +
        '</div>' +
        '<div class="resource-heatmap-legend-item">' +
        '<div class="resource-heatmap-legend-swatch" style="background: #ffe0b2;"></div> 4-5d' +
        '</div>' +
        '<div class="resource-heatmap-legend-item">' +
        '<div class="resource-heatmap-legend-swatch" style="background: #ffcdd2;"></div> &gt;5d (overloaded)' +
        '</div>' +
        '</div>';

    html += '</div>';
    return html;
}

/**
 * Show resource details modal (enhanced with dates, durations, mini timeline)
 */
function showResourceDetails(resourceName) {
    if (!window.portfolioResourcesData) return;

    const resource = window.portfolioResourcesData.find(r => r.name === resourceName);
    if (!resource) return;

    const modal = document.getElementById('resourceDetailsModal');
    const body = document.getElementById('resourceDetailsBody');

    let html = '<h2>' + escapeHtml(resource.name) + ' — Task Details</h2>';

    html += '<div class="resource-details-summary">' +
        '<div class="detail-stat">' +
        '<span class="stat-label">Total Tasks</span>' +
        '<span class="stat-value">' + resource.totalTasks + '</span>' +
        '</div>' +
        '<div class="detail-stat">' +
        '<span class="stat-label">Total Days</span>' +
        '<span class="stat-value">' + resource.totalDays + '</span>' +
        '</div>' +
        '<div class="detail-stat">' +
        '<span class="stat-label">Completed</span>' +
        '<span class="stat-value">' + resource.completedTasks + '</span>' +
        '</div>' +
        '<div class="detail-stat">' +
        '<span class="stat-label">In Progress</span>' +
        '<span class="stat-value">' + resource.inProgressTasks + '</span>' +
        '</div>' +
        '<div class="detail-stat">' +
        '<span class="stat-label">Date Range</span>' +
        '<span class="stat-value" style="font-size: 1em;">' + escapeHtml(resource.dateRange) + '</span>' +
        '</div>' +
        '</div>';

    html += '<h3>Assignments by Project</h3>';

    // Group assignments by project
    const byProject = {};
    resource.assignments.forEach(a => {
        if (!byProject[a.projectName]) byProject[a.projectName] = [];
        byProject[a.projectName].push(a);
    });

    // Compute global range for mini timelines
    let globalMinDate = resource.earliestStart;
    let globalMaxDate = resource.latestFinish;

    Object.keys(byProject).forEach(projectName => {
        const assignments = byProject[projectName];

        html += '<div class="project-assignments">' +
            '<h4 onclick="switchToProjectByName(\'' + escapeHtml(projectName).replace(/'/g, "\\'") + '\')" ' +
            'style="cursor: pointer; color: #667eea;">' +
            escapeHtml(projectName) + '</h4>';

        // Mini timeline bar for this project
        if (globalMinDate && globalMaxDate) {
            html += renderMiniTimeline(assignments, globalMinDate, globalMaxDate, projectName);
        }

        html += '<table class="assignments-table">' +
            '<thead><tr>' +
            '<th>Task</th>' +
            '<th>Phase</th>' +
            '<th>Start</th>' +
            '<th>Finish</th>' +
            '<th>Duration</th>' +
            '<th>Status</th>' +
            '<th>Completion</th>' +
            '</tr></thead><tbody>';

        assignments.forEach(a => {
            const statusClass = 'status-' + a.status;
            const startStr = a.start || '—';
            const finishStr = a.finish || '—';
            const durStr = a.durationDays ? a.durationDays + 'd' : '—';

            html += '<tr>' +
                '<td>' + escapeHtml(a.task) + '</td>' +
                '<td>' + escapeHtml(a.phase) + '</td>' +
                '<td style="font-size: 0.85em; white-space: nowrap;">' + startStr + '</td>' +
                '<td style="font-size: 0.85em; white-space: nowrap;">' + finishStr + '</td>' +
                '<td style="text-align: center;">' + durStr + '</td>' +
                '<td><span class="task-status-badge ' + statusClass + '">' +
                a.status.replace('-', ' ') + '</span></td>' +
                '<td>' + a.completion + '%</td>' +
                '</tr>';
        });

        html += '</tbody></table></div>';
    });

    body.innerHTML = html;
    modal.style.display = 'block';
}

/**
 * Render a mini timeline bar showing when tasks are scheduled
 */
function renderMiniTimeline(assignments, globalMin, globalMax, projectName) {
    const totalMs = globalMax.getTime() - globalMin.getTime();
    if (totalMs <= 0) return '';

    const colors = ['#667eea', '#17a2b8', '#28a745', '#ffc107', '#6f42c1'];
    let html = '<div class="resource-task-timeline" title="' + escapeHtml(projectName) + ' task schedule">';

    assignments.forEach((a, i) => {
        if (!a.start || !a.finish) return;
        const s = new Date(a.start);
        const f = new Date(a.finish);
        const left = ((s.getTime() - globalMin.getTime()) / totalMs) * 100;
        const width = Math.max(1, ((f.getTime() - s.getTime()) / totalMs) * 100);
        const color = colors[i % colors.length];

        html += '<div class="resource-task-bar" style="left:' + left + '%; width:' + width + '%; background:' + color + ';" ' +
            'title="' + escapeHtml(a.task) + ' (' + a.start + ' – ' + a.finish + ')"></div>';
    });

    html += '</div>';
    return html;
}

/**
 * Close resource details modal
 */
function closeResourceDetails() {
    const modal = document.getElementById('resourceDetailsModal');
    if (modal) modal.style.display = 'none';
}

/**
 * Switch to project by name
 */
function switchToProjectByName(projectName) {
    const projects = getAllProjects();
    const project = Object.values(projects).find(p => p.name === projectName);
    if (project) {
        switchToProject(project.id);
        closeResourceDetails();
    }
}

/**
 * Sort portfolio resources table
 */
let portfolioResourcesSortColumn = 'workload';
let portfolioResourcesSortAsc = true;

function sortPortfolioResources(column) {
    if (portfolioResourcesSortColumn === column) {
        portfolioResourcesSortAsc = !portfolioResourcesSortAsc;
    } else {
        portfolioResourcesSortColumn = column;
        portfolioResourcesSortAsc = true;
    }

    if (!window.portfolioResourcesData) return;

    const data = [...window.portfolioResourcesData];

    data.sort((a, b) => {
        let valA, valB;

        switch (column) {
            case 'name':
                valA = a.name.toLowerCase();
                valB = b.name.toLowerCase();
                break;
            case 'projects':
                valA = a.projectCount;
                valB = b.projectCount;
                break;
            case 'tasks':
                valA = a.totalTasks;
                valB = b.totalTasks;
                break;
            case 'totalDays':
                valA = a.totalDays;
                valB = b.totalDays;
                break;
            case 'dateRange':
                valA = a.earliestStart ? a.earliestStart.getTime() : 0;
                valB = b.earliestStart ? b.earliestStart.getTime() : 0;
                break;
            case 'workload':
                const workloadOrder = { 'overloaded': 0, 'high': 1, 'medium': 2, 'low': 3 };
                valA = workloadOrder[a.workloadLevel];
                valB = workloadOrder[b.workloadLevel];
                break;
            default:
                return 0;
        }

        if (valA < valB) return portfolioResourcesSortAsc ? -1 : 1;
        if (valA > valB) return portfolioResourcesSortAsc ? 1 : -1;
        return 0;
    });

    window.portfolioResourcesData = data;
    // Re-render using stored data (avoid re-fetching)
    rerenderResourcesTable(data);
}

/**
 * Re-render just the resources table rows from in-memory data (for sorting)
 */
function rerenderResourcesTable(resources) {
    const tbody = document.querySelector('.portfolio-resources-table tbody');
    if (!tbody) return;

    let html = '';
    resources.forEach(resource => {
        const workloadClass = getWorkloadBadgeClass(resource.workloadLevel);
        const projectsList = resource.projects.join(', ');

        html += '<tr class="resource-row" data-resource="' + escapeHtml(resource.name) + '">' +
            '<td class="resource-name">' + escapeHtml(resource.name) + '</td>' +
            '<td><span class="project-count-badge">' + resource.projectCount + '</span> ' +
            '<span class="projects-tooltip" title="' + escapeHtml(projectsList) + '">' +
            (resource.projectCount === 1 ? escapeHtml(resource.projects[0]) : resource.projectCount + ' projects') +
            '</span></td>' +
            '<td>' + resource.totalTasks + '</td>' +
            '<td>' + resource.totalDays + 'd</td>' +
            '<td style="font-size: 0.85em; color: #6c757d;">' + escapeHtml(resource.dateRange) + '</td>' +
            '<td><span class="workload-badge ' + workloadClass + '">' +
            resource.workloadLevel.toUpperCase() + '</span></td>' +
            '<td><button class="btn-small" onclick="showResourceDetails(\'' +
            escapeHtml(resource.name).replace(/'/g, "\\'") + '\')">View</button></td>' +
            '</tr>';
    });

    tbody.innerHTML = html;
}

// Close modal when clicking outside
if (typeof window !== 'undefined') {
    window.addEventListener('click', (event) => {
        const modal = document.getElementById('resourceDetailsModal');
        if (modal && event.target === modal) {
            closeResourceDetails();
        }
    });
}
