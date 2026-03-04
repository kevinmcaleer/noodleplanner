/**
 * Portfolio 2-Week Look-Ahead View
 * Shows overdue and upcoming tasks across all projects in a single table
 * with project-name column and project filter.
 * Uses /api/parse data via parseAllProjects() for accurate task data.
 */

/**
 * Collect look-ahead tasks from all parsed projects.
 * Returns overdue tasks and upcoming tasks (within the next 2 weeks).
 *
 * @param {Array<{project, parsedResult}>} parsedProjects
 * @returns {{overdue: Array, upcoming: Array}} categorised task lists
 */
function collectLookAheadTasks(parsedProjects) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const twoWeeksFromNow = new Date(today);
    twoWeeksFromNow.setDate(today.getDate() + 14);

    const overdue = [];
    const upcoming = [];

    parsedProjects.forEach(({ project, parsedResult }) => {
        if (!parsedResult || !parsedResult.success) return;

        const tasks = parsedResult.tasks || [];

        tasks.forEach(task => {
            if (task.is_summary) return;

            const startDate = task.start ? new Date(task.start) : null;
            const finishDate = task.finish ? new Date(task.finish) : null;

            if (startDate) startDate.setHours(0, 0, 0, 0);
            if (finishDate) finishDate.setHours(0, 0, 0, 0);

            const percentComplete = parseInt(task.percent) || 0;

            // Overdue: has a finish date in the past and is not 100% complete
            if (finishDate && finishDate < today && percentComplete < 100) {
                overdue.push({
                    projectId: project.id,
                    projectName: project.name,
                    taskName: task.name || '-',
                    start: task.start || null,
                    finish: task.finish || null,
                    finishDate: finishDate,
                    durationDays: task.duration_days || null,
                    resources: task.resources || '-',
                    percent: percentComplete,
                    rag: task.rag || '-',
                    daysLate: Math.ceil((today - finishDate) / (1000 * 60 * 60 * 24))
                });
            }

            // Upcoming: starts or finishes within the next 2 weeks
            const startsInWindow = startDate && startDate >= today && startDate <= twoWeeksFromNow;
            const finishesInWindow = finishDate && finishDate >= today && finishDate <= twoWeeksFromNow;

            if (startsInWindow || finishesInWindow) {
                upcoming.push({
                    projectId: project.id,
                    projectName: project.name,
                    taskName: task.name || '-',
                    start: task.start || null,
                    finish: task.finish || null,
                    startDate: startDate,
                    finishDate: finishDate,
                    durationDays: task.duration_days || null,
                    resources: task.resources || '-',
                    percent: percentComplete,
                    rag: task.rag || '-'
                });
            }
        });
    });

    // Sort overdue by finish date (most overdue first)
    overdue.sort((a, b) => a.finishDate - b.finishDate);

    // Sort upcoming by start/finish date (soonest first)
    upcoming.sort((a, b) => {
        const dateA = a.startDate || a.finishDate || new Date(9999, 0);
        const dateB = b.startDate || b.finishDate || new Date(9999, 0);
        return dateA - dateB;
    });

    return { overdue, upcoming };
}

/**
 * Format a date for display in the look-ahead tables
 */
function formatLookAheadDate(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Get RAG badge HTML for a RAG value
 */
function getLookAheadRAGBadge(rag) {
    if (!rag || rag === '-') return '-';
    const colour = typeof ragStatusToColour === 'function' ? ragStatusToColour(rag) : rag.toLowerCase();
    const label = rag.toUpperCase();
    return '<span class="rag-badge rag-' + colour + '">' + escapeHtml(label) + '</span>';
}

/**
 * Build HTML rows for the overdue tasks table
 */
function buildOverdueRows(tasks) {
    let html = '';
    tasks.forEach(task => {
        html += '<tr class="portfolio-lookahead-row" ' +
            'data-project="' + escapeHtml(task.projectName) + '" ' +
            'data-project-id="' + escapeHtml(task.projectId) + '" ' +
            'data-task-name="' + escapeHtml(task.taskName) + '" ' +
            'onclick="openPortfolioLookAheadTask(\'' + escapeHtml(task.projectId) + '\', \'' + escapeHtml(task.taskName).replace(/'/g, "\\'") + '\')">' +
            '<td class="lookahead-project-name">' + escapeHtml(task.projectName) + '</td>' +
            '<td class="lookahead-task-name">' + escapeHtml(task.taskName) + '</td>' +
            '<td>' + formatLookAheadDate(task.finish) + '</td>' +
            '<td class="lookahead-days-late">' + task.daysLate + '</td>' +
            '<td>' + escapeHtml(task.resources) + '</td>' +
            '<td>' + task.percent + '%</td>' +
            '<td>' + getLookAheadRAGBadge(task.rag) + '</td>' +
            '</tr>';
    });
    return html;
}

/**
 * Build HTML rows for the upcoming tasks table
 */
function buildUpcomingRows(tasks) {
    let html = '';
    tasks.forEach(task => {
        html += '<tr class="portfolio-lookahead-row" ' +
            'data-project="' + escapeHtml(task.projectName) + '" ' +
            'data-project-id="' + escapeHtml(task.projectId) + '" ' +
            'data-task-name="' + escapeHtml(task.taskName) + '" ' +
            'onclick="openPortfolioLookAheadTask(\'' + escapeHtml(task.projectId) + '\', \'' + escapeHtml(task.taskName).replace(/'/g, "\\'") + '\')">' +
            '<td class="lookahead-project-name">' + escapeHtml(task.projectName) + '</td>' +
            '<td class="lookahead-task-name">' + escapeHtml(task.taskName) + '</td>' +
            '<td>' + formatLookAheadDate(task.start) + '</td>' +
            '<td>' + formatLookAheadDate(task.finish) + '</td>' +
            '<td>' + (task.durationDays ? task.durationDays + 'd' : '-') + '</td>' +
            '<td>' + escapeHtml(task.resources) + '</td>' +
            '<td>' + task.percent + '%</td>' +
            '<td>' + getLookAheadRAGBadge(task.rag) + '</td>' +
            '</tr>';
    });
    return html;
}

/**
 * Render portfolio look-ahead view (async -- uses /api/parse via parseAllProjects)
 */
async function renderPortfolioLookAhead() {
    const container = document.getElementById('portfolioLookAheadView');
    if (!container) return;

    // Show loading state
    container.innerHTML = '<div class="portfolio-loading">' +
        '<div class="portfolio-loading-spinner"></div>' +
        '<p>Loading tasks across all projects...</p>' +
        '</div>';

    try {
        const parsedProjects = await parseAllProjects();

        if (parsedProjects.length === 0) {
            container.innerHTML = '<div class="portfolio-empty-state">' +
                '<h3>No Projects</h3>' +
                '<p>Create projects to see look-ahead tasks here.</p>' +
                '</div>';
            return;
        }

        const { overdue, upcoming } = collectLookAheadTasks(parsedProjects);

        // Calculate date range for display
        const today = new Date();
        const twoWeeksFromNow = new Date(today);
        twoWeeksFromNow.setDate(today.getDate() + 14);
        const formatDateRange = (date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

        // Build unique project names for filter dropdown
        const allTasks = [...overdue, ...upcoming];
        const projectNames = [...new Set(allTasks.map(t => t.projectName))].sort((a, b) => a.localeCompare(b));

        // Store data for filtering
        window.portfolioLookAheadData = { overdue, upcoming };

        // Header with summary and filter
        let html = '<div class="portfolio-lookahead-header">' +
            '<h2><span class="ribbon-banner ribbon-banner--orange">Portfolio 2-Week Look-Ahead</span></h2>' +
            '<div class="portfolio-lookahead-summary">' +
            '<div class="lookahead-summary-item">' +
            '<span class="summary-label">Overdue</span>' +
            '<span class="summary-value" style="color: ' + (overdue.length > 0 ? '#dc3545' : '#28a745') + '">' + overdue.length + '</span>' +
            '</div>' +
            '<div class="lookahead-summary-item">' +
            '<span class="summary-label">Upcoming</span>' +
            '<span class="summary-value">' + upcoming.length + '</span>' +
            '</div>' +
            '<div class="lookahead-summary-item">' +
            '<span class="summary-label">Projects</span>' +
            '<span class="summary-value">' + projectNames.length + '</span>' +
            '</div>' +
            '</div>' +
            '<div class="portfolio-lookahead-filters">' +
            '<label>Filter by project: </label>' +
            '<select id="portfolioLookAheadProjectFilter" onchange="filterPortfolioLookAhead()">' +
            '<option value="all">All Projects</option>';

        projectNames.forEach(name => {
            html += '<option value="' + escapeHtml(name) + '">' + escapeHtml(name) + '</option>';
        });

        html += '</select>' +
            '</div>' +
            '<div class="portfolio-lookahead-daterange">' +
            '<span>' + formatDateRange(today) + ' &mdash; ' + formatDateRange(twoWeeksFromNow) + '</span>' +
            '</div>' +
            '</div>';

        // Overdue section
        if (overdue.length > 0) {
            html += '<div class="portfolio-lookahead-section" id="portfolioOverdueSection">' +
                '<h3 class="portfolio-lookahead-section-title overdue">Overdue Tasks</h3>' +
                '<div class="portfolio-lookahead-table-wrapper">' +
                '<table class="portfolio-lookahead-table">' +
                '<thead>' +
                '<tr>' +
                '<th onclick="sortPortfolioLookAhead(\'project\', \'overdue\')">Project <span class="sort-indicator"></span></th>' +
                '<th onclick="sortPortfolioLookAhead(\'taskName\', \'overdue\')">Task <span class="sort-indicator"></span></th>' +
                '<th onclick="sortPortfolioLookAhead(\'finish\', \'overdue\')">Due Date <span class="sort-indicator"></span></th>' +
                '<th onclick="sortPortfolioLookAhead(\'daysLate\', \'overdue\')">Days Late <span class="sort-indicator"></span></th>' +
                '<th>Resources</th>' +
                '<th onclick="sortPortfolioLookAhead(\'percent\', \'overdue\')">% <span class="sort-indicator"></span></th>' +
                '<th>RAG</th>' +
                '</tr>' +
                '</thead>' +
                '<tbody id="portfolioOverdueTableBody">';

            html += buildOverdueRows(overdue);

            html += '</tbody></table></div></div>';
        }

        // Upcoming section
        if (upcoming.length > 0) {
            html += '<div class="portfolio-lookahead-section" id="portfolioUpcomingSection">' +
                '<h3 class="portfolio-lookahead-section-title upcoming">Upcoming Tasks (Next 2 Weeks)</h3>' +
                '<div class="portfolio-lookahead-table-wrapper">' +
                '<table class="portfolio-lookahead-table">' +
                '<thead>' +
                '<tr>' +
                '<th onclick="sortPortfolioLookAhead(\'project\', \'upcoming\')">Project <span class="sort-indicator"></span></th>' +
                '<th onclick="sortPortfolioLookAhead(\'taskName\', \'upcoming\')">Task <span class="sort-indicator"></span></th>' +
                '<th onclick="sortPortfolioLookAhead(\'start\', \'upcoming\')">Start Date <span class="sort-indicator"></span></th>' +
                '<th onclick="sortPortfolioLookAhead(\'finish\', \'upcoming\')">Due Date <span class="sort-indicator"></span></th>' +
                '<th>Duration</th>' +
                '<th>Resources</th>' +
                '<th onclick="sortPortfolioLookAhead(\'percent\', \'upcoming\')">% <span class="sort-indicator"></span></th>' +
                '<th>RAG</th>' +
                '</tr>' +
                '</thead>' +
                '<tbody id="portfolioUpcomingTableBody">';

            html += buildUpcomingRows(upcoming);

            html += '</tbody></table></div></div>';
        }

        // Empty state if no tasks at all
        if (overdue.length === 0 && upcoming.length === 0) {
            html += '<div class="portfolio-empty-state">' +
                '<h3>No Tasks</h3>' +
                '<p>No overdue or upcoming tasks found in the next 2 weeks across any projects.</p>' +
                '</div>';
        }

        container.innerHTML = html;

    } catch (error) {
        console.error('Error rendering portfolio look-ahead:', error);
        container.innerHTML = '<div class="portfolio-empty-state">' +
            '<h3>Error Loading Look-Ahead</h3>' +
            '<p>Failed to load task data. Please try again.</p>' +
            '</div>';
    }
}

/**
 * Filter portfolio look-ahead tables by project name
 */
function filterPortfolioLookAhead() {
    const filter = document.getElementById('portfolioLookAheadProjectFilter')?.value || 'all';
    const rows = document.querySelectorAll('.portfolio-lookahead-row');

    rows.forEach(row => {
        if (filter === 'all' || row.dataset.project === filter) {
            row.style.display = '';
        } else {
            row.style.display = 'none';
        }
    });
}

/**
 * Sort portfolio look-ahead table
 */
let portfolioLookAheadSortColumn = 'finish';
let portfolioLookAheadSortAsc = true;
let portfolioLookAheadSortSection = 'overdue';

function sortPortfolioLookAhead(column, section) {
    if (portfolioLookAheadSortColumn === column && portfolioLookAheadSortSection === section) {
        portfolioLookAheadSortAsc = !portfolioLookAheadSortAsc;
    } else {
        portfolioLookAheadSortColumn = column;
        portfolioLookAheadSortSection = section;
        portfolioLookAheadSortAsc = true;
    }

    if (!window.portfolioLookAheadData) return;

    const data = [...window.portfolioLookAheadData[section]];

    data.sort((a, b) => {
        let valA, valB;

        switch (column) {
            case 'project':
                valA = a.projectName.toLowerCase();
                valB = b.projectName.toLowerCase();
                break;
            case 'taskName':
                valA = a.taskName.toLowerCase();
                valB = b.taskName.toLowerCase();
                break;
            case 'start':
                valA = a.startDate ? a.startDate.getTime() : Infinity;
                valB = b.startDate ? b.startDate.getTime() : Infinity;
                break;
            case 'finish':
                valA = a.finishDate ? a.finishDate.getTime() : Infinity;
                valB = b.finishDate ? b.finishDate.getTime() : Infinity;
                break;
            case 'daysLate':
                valA = a.daysLate || 0;
                valB = b.daysLate || 0;
                break;
            case 'percent':
                valA = a.percent;
                valB = b.percent;
                break;
            default:
                return 0;
        }

        if (valA < valB) return portfolioLookAheadSortAsc ? -1 : 1;
        if (valA > valB) return portfolioLookAheadSortAsc ? 1 : -1;
        return 0;
    });

    window.portfolioLookAheadData[section] = data;

    // Re-render the appropriate table body
    if (section === 'overdue') {
        const tbody = document.getElementById('portfolioOverdueTableBody');
        if (tbody) {
            tbody.innerHTML = buildOverdueRows(data);
        }
    } else {
        const tbody = document.getElementById('portfolioUpcomingTableBody');
        if (tbody) {
            tbody.innerHTML = buildUpcomingRows(data);
        }
    }

    // Re-apply filter
    const filter = document.getElementById('portfolioLookAheadProjectFilter')?.value || 'all';
    if (filter !== 'all') {
        filterPortfolioLookAhead();
    }
}

/**
 * Open a specific task from the portfolio look-ahead.
 * Saves current state, loads the target project, and opens the task details form.
 */
async function openPortfolioLookAheadTask(projectId, taskName) {
    // Save current project before switching
    saveCurrentProjectState();

    // Load target project into editor
    if (typeof loadProjectIntoEditor === 'function') {
        loadProjectIntoEditor(projectId);
    }

    // Switch to the editor tab to see the task form
    if (typeof switchToView === 'function') {
        switchToView('task-list');
    } else {
        switchMainTab('editor');
    }

    // Wait briefly for the project to load and parse
    await new Promise(resolve => setTimeout(resolve, 300));

    // Open the task details form for the specified task
    if (typeof openMilestoneTaskForm === 'function') {
        openMilestoneTaskForm(taskName);
    }

    // Refresh project selectors
    if (typeof refreshProjectSelectors === 'function') {
        refreshProjectSelectors();
    }
    if (typeof renderProjectsTable === 'function') {
        renderProjectsTable();
    }
}
