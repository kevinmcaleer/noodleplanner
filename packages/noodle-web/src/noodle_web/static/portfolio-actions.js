/**
 * Portfolio Actions View
 * Shows open (incomplete) actions across all projects in a single table
 * with project-name column and project filter.
 * Uses /api/parse data for accurate task status.
 */

/**
 * Collect open actions from all parsed projects.
 * An "open action" is a non-summary task with percent < 100 and a finish date.
 *
 * @param {Array<{project, parsedResult}>} parsedProjects
 * @returns {Array} flat list of action objects
 */
function collectOpenActions(parsedProjects) {
    const actions = [];

    parsedProjects.forEach(({ project, parsedResult }) => {
        if (!parsedResult || !parsedResult.success || !parsedResult.tasks) return;

        parsedResult.tasks.forEach(task => {
            if (task.is_summary) return;
            if (!task.finish) return;

            const percent = parseFloat(task.percent) || 0;
            if (percent >= 100) return;

            actions.push({
                projectId: project.id,
                projectName: project.name,
                taskName: task.name,
                start: task.start || null,
                finish: task.finish,
                percent: percent,
                rag: task.rag || null,
                resources: task.resources || ''
            });
        });
    });

    // Sort by finish date (soonest first)
    actions.sort((a, b) => new Date(a.finish) - new Date(b.finish));

    return actions;
}

/**
 * Derive a RAG colour string for an action based on its explicit RAG value
 * or, if none, a schedule-based heuristic relative to today.
 */
function deriveActionRAG(action) {
    if (action.rag) {
        const lower = action.rag.toLowerCase();
        if (lower.includes('red') || lower === 'r') return 'red';
        if (lower.includes('amber') || lower.includes('yellow') || lower === 'a') return 'amber';
        if (lower.includes('green') || lower === 'g') return 'green';
        if (lower.includes('blue') || lower.includes('complete') || lower === 'b') return 'blue';
        // Fall back to the global helper if available
        if (typeof ragStatusToColour === 'function') {
            const mapped = ragStatusToColour(action.rag);
            if (mapped) return mapped;
        }
    }

    // Schedule-based heuristic
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const finish = new Date(action.finish);
    finish.setHours(0, 0, 0, 0);

    if (finish < today && action.percent === 0) return 'red';
    if (finish < today) return 'amber';
    return 'green';
}

/**
 * Render portfolio actions view (async -- uses /api/parse via parseAllProjects)
 */
async function renderPortfolioActions() {
    const container = document.getElementById('portfolioActionsView');
    if (!container) return;

    // Show loading state
    container.innerHTML = '<div class="portfolio-loading">' +
        '<div class="portfolio-loading-spinner"></div>' +
        '<p>Loading actions across all projects...</p>' +
        '</div>';

    try {
        const parsedProjects = await parseAllProjects();

        if (parsedProjects.length === 0) {
            container.innerHTML = '<div class="portfolio-empty-state">' +
                '<h3>No Projects</h3>' +
                '<p>Create projects to see open actions here.</p>' +
                '</div>';
            return;
        }

        const actions = collectOpenActions(parsedProjects);

        if (actions.length === 0) {
            container.innerHTML = '<div class="portfolio-empty-state">' +
                '<h3>No Open Actions</h3>' +
                '<p>All tasks across your projects are complete. Nice work!</p>' +
                '</div>';
            return;
        }

        // Build unique project names for filter dropdown
        const projectNames = [...new Set(actions.map(a => a.projectName))].sort((a, b) => a.localeCompare(b));

        // Summary counts
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const overdueCount = actions.filter(a => {
            const f = new Date(a.finish);
            f.setHours(0, 0, 0, 0);
            return f < today;
        }).length;

        // Header with filter
        let html = '<div class="portfolio-actions-header">' +
            '<h2>Action Chaser</h2>' +
            '<div class="portfolio-actions-summary">' +
            '<div class="actions-summary-item">' +
            '<span class="summary-label">Open Actions</span>' +
            '<span class="summary-value">' + actions.length + '</span>' +
            '</div>' +
            '<div class="actions-summary-item">' +
            '<span class="summary-label">Overdue</span>' +
            '<span class="summary-value" style="color: ' + (overdueCount > 0 ? '#dc3545' : '#28a745') + '">' + overdueCount + '</span>' +
            '</div>' +
            '<div class="actions-summary-item">' +
            '<span class="summary-label">Projects</span>' +
            '<span class="summary-value">' + projectNames.length + '</span>' +
            '</div>' +
            '</div>' +
            '<div class="portfolio-actions-filters">' +
            '<label>Filter by project: </label>' +
            '<select id="portfolioActionsProjectFilter" onchange="filterPortfolioActions()">' +
            '<option value="all">All Projects</option>';

        projectNames.forEach(name => {
            html += '<option value="' + escapeHtml(name) + '">' + escapeHtml(name) + '</option>';
        });

        html += '</select>' +
            '</div>' +
            '</div>';

        // Table
        html += '<div class="portfolio-actions-table-wrapper">' +
            '<table class="portfolio-actions-table">' +
            '<thead>' +
            '<tr>' +
            '<th onclick="sortPortfolioActions(\'project\')">Project <span class="sort-indicator"></span></th>' +
            '<th onclick="sortPortfolioActions(\'task\')">Task <span class="sort-indicator"></span></th>' +
            '<th onclick="sortPortfolioActions(\'finish\')">Finish Date <span class="sort-indicator"></span></th>' +
            '<th onclick="sortPortfolioActions(\'percent\')">% Complete <span class="sort-indicator"></span></th>' +
            '<th onclick="sortPortfolioActions(\'rag\')">Status <span class="sort-indicator"></span></th>' +
            '</tr>' +
            '</thead>' +
            '<tbody id="portfolioActionsTableBody">';

        actions.forEach(action => {
            const ragColour = deriveActionRAG(action);
            const finishDate = new Date(action.finish);
            const finishStr = finishDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
            const isOverdue = (() => {
                const f = new Date(action.finish);
                f.setHours(0, 0, 0, 0);
                return f < today;
            })();

            html += '<tr class="actions-row" data-project="' + escapeHtml(action.projectName) + '" ' +
                'onclick="openProjectDashboard(\'' + action.projectId + '\')">' +
                '<td class="actions-project-name">' + escapeHtml(action.projectName) + '</td>' +
                '<td class="actions-task-name">' + escapeHtml(action.taskName) + '</td>' +
                '<td class="actions-finish-date' + (isOverdue ? ' actions-overdue' : '') + '">' + finishStr + '</td>' +
                '<td class="actions-percent">' +
                '<div class="progress-bar-container">' +
                '<div class="progress-bar" style="width: ' + action.percent + '%"></div>' +
                '<span class="progress-text">' + action.percent + '%</span>' +
                '</div>' +
                '</td>' +
                '<td><span class="rag-badge rag-' + ragColour + '">' + ragColour.toUpperCase() + '</span></td>' +
                '</tr>';
        });

        html += '</tbody></table></div>';

        container.innerHTML = html;

        // Store data for sorting / filtering
        window.portfolioActionsData = actions;

    } catch (error) {
        console.error('Error rendering portfolio actions:', error);
        container.innerHTML = '<div class="portfolio-empty-state">' +
            '<h3>Error Loading Actions</h3>' +
            '<p>Failed to load action data. Please try again.</p>' +
            '</div>';
    }
}

/**
 * Filter actions table by project name
 */
function filterPortfolioActions() {
    const filter = document.getElementById('portfolioActionsProjectFilter')?.value || 'all';
    const rows = document.querySelectorAll('.actions-row');

    rows.forEach(row => {
        if (filter === 'all' || row.dataset.project === filter) {
            row.style.display = '';
        } else {
            row.style.display = 'none';
        }
    });
}

/**
 * Sort portfolio actions table
 */
let portfolioActionsSortColumn = 'finish';
let portfolioActionsSortAsc = true;

function sortPortfolioActions(column) {
    if (portfolioActionsSortColumn === column) {
        portfolioActionsSortAsc = !portfolioActionsSortAsc;
    } else {
        portfolioActionsSortColumn = column;
        portfolioActionsSortAsc = true;
    }

    if (!window.portfolioActionsData) return;

    const data = [...window.portfolioActionsData];

    data.sort((a, b) => {
        let valA, valB;

        switch (column) {
            case 'project':
                valA = a.projectName.toLowerCase();
                valB = b.projectName.toLowerCase();
                break;
            case 'task':
                valA = a.taskName.toLowerCase();
                valB = b.taskName.toLowerCase();
                break;
            case 'finish':
                valA = new Date(a.finish).getTime();
                valB = new Date(b.finish).getTime();
                break;
            case 'percent':
                valA = a.percent;
                valB = b.percent;
                break;
            case 'rag':
                const ragOrder = { 'red': 0, 'amber': 1, 'green': 2, 'blue': 3 };
                valA = ragOrder[deriveActionRAG(a)] ?? 4;
                valB = ragOrder[deriveActionRAG(b)] ?? 4;
                break;
            default:
                return 0;
        }

        if (valA < valB) return portfolioActionsSortAsc ? -1 : 1;
        if (valA > valB) return portfolioActionsSortAsc ? 1 : -1;
        return 0;
    });

    window.portfolioActionsData = data;
    rerenderActionsTable(data);
}

/**
 * Re-render just the actions table body from in-memory data (for sorting)
 */
function rerenderActionsTable(actions) {
    const tbody = document.getElementById('portfolioActionsTableBody');
    if (!tbody) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const filter = document.getElementById('portfolioActionsProjectFilter')?.value || 'all';

    let html = '';
    actions.forEach(action => {
        const ragColour = deriveActionRAG(action);
        const finishDate = new Date(action.finish);
        const finishStr = finishDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        const isOverdue = (() => {
            const f = new Date(action.finish);
            f.setHours(0, 0, 0, 0);
            return f < today;
        })();
        const hidden = (filter !== 'all' && action.projectName !== filter) ? ' style="display: none;"' : '';

        html += '<tr class="actions-row" data-project="' + escapeHtml(action.projectName) + '" ' +
            'onclick="openProjectDashboard(\'' + action.projectId + '\')"' + hidden + '>' +
            '<td class="actions-project-name">' + escapeHtml(action.projectName) + '</td>' +
            '<td class="actions-task-name">' + escapeHtml(action.taskName) + '</td>' +
            '<td class="actions-finish-date' + (isOverdue ? ' actions-overdue' : '') + '">' + finishStr + '</td>' +
            '<td class="actions-percent">' +
            '<div class="progress-bar-container">' +
            '<div class="progress-bar" style="width: ' + action.percent + '%"></div>' +
            '<span class="progress-text">' + action.percent + '%</span>' +
            '</div>' +
            '</td>' +
            '<td><span class="rag-badge rag-' + ragColour + '">' + ragColour.toUpperCase() + '</span></td>' +
            '</tr>';
    });

    tbody.innerHTML = html;
}
