/**
 * Portfolio Actions View
 * Shows open actions from RAID logs across all projects in a single table
 * with project-name column and project filter.
 * Uses /api/parse data for accurate RAID item data.
 */

/**
 * Collect open actions from RAID logs across all parsed projects.
 * An "open action" is a RAID item with type='action' and status='open'.
 *
 * @param {Array<{project, parsedResult}>} parsedProjects
 * @returns {Array} flat list of action objects
 */
function collectOpenActions(parsedProjects) {
    const actions = [];

    parsedProjects.forEach(({ project, parsedResult }) => {
        if (!parsedResult) return;

        // RAID items are parsed independently of tasks, so use them
        // even when task parsing fails (success may be false).
        const raidItems = parsedResult.raid_items || [];

        raidItems.forEach(item => {
            if (!item.type || item.type.toLowerCase() !== 'action') return;
            if (item.status && item.status.toLowerCase() === 'closed') return;

            actions.push({
                projectId: project.id,
                projectName: project.name,
                actionId: item.id || null,
                title: item.title || item.description || '-',
                description: item.description || item.mitigation_actions || '',
                owner: item.owner || '-',
                targetDate: item.target_date || item.date || null,
                priority: item.priority || null,
                status: item.status || 'open',
                raisedBy: item.raised_by || ''
            });
        });
    });

    // Sort by target date (soonest first), items without dates at the end
    actions.sort((a, b) => {
        if (!a.targetDate && !b.targetDate) return 0;
        if (!a.targetDate) return 1;
        if (!b.targetDate) return -1;
        return new Date(a.targetDate) - new Date(b.targetDate);
    });

    return actions;
}

/**
 * Derive a status colour for display.
 * If the action has a target date in the past and is still open, flag it.
 */
function deriveActionStatus(action) {
    if (!action.targetDate) return 'blue';

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(action.targetDate);
    target.setHours(0, 0, 0, 0);

    if (target < today) return 'red';
    // Due within 7 days
    const weekFromNow = new Date(today);
    weekFromNow.setDate(weekFromNow.getDate() + 7);
    if (target <= weekFromNow) return 'amber';
    return 'green';
}

/**
 * Get priority badge class
 */
function getPriorityBadgeClass(priority) {
    if (!priority) return '';
    const p = priority.toLowerCase();
    if (p === 'high') return 'actions-priority-high';
    if (p === 'medium') return 'actions-priority-medium';
    if (p === 'low') return 'actions-priority-low';
    return '';
}

/**
 * Format a date string for display
 */
function formatActionDate(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
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
            container.innerHTML = '<np-empty-state variant="card" heading="No Projects">' +
                '<p>Create projects to see open actions here.</p>' +
                '</np-empty-state>';
            return;
        }

        const actions = collectOpenActions(parsedProjects);

        if (actions.length === 0) {
            container.innerHTML = '<np-empty-state variant="card" heading="No Open Actions">' +
                '<p>There are no open actions in any project RAID logs.</p>' +
                '</np-empty-state>';
            return;
        }

        // Build unique project names for filter dropdown
        const projectNames = [...new Set(actions.map(a => a.projectName))].sort((a, b) => a.localeCompare(b));

        // Summary counts
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const overdueCount = actions.filter(a => {
            if (!a.targetDate) return false;
            const t = new Date(a.targetDate);
            t.setHours(0, 0, 0, 0);
            return t < today;
        }).length;

        // Header with filter
        let html = '<div class="portfolio-actions-header">' +
            '<h2><span class="ribbon-banner ribbon-banner--orange">Action Chaser</span></h2>' +
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
            '<th onclick="sortPortfolioActions(\'title\')">Action <span class="sort-indicator"></span></th>' +
            '<th onclick="sortPortfolioActions(\'owner\')">Owner <span class="sort-indicator"></span></th>' +
            '<th onclick="sortPortfolioActions(\'priority\')">Priority <span class="sort-indicator"></span></th>' +
            '<th onclick="sortPortfolioActions(\'targetDate\')">Target Date <span class="sort-indicator"></span></th>' +
            '<th onclick="sortPortfolioActions(\'status\')">Status <span class="sort-indicator"></span></th>' +
            '</tr>' +
            '</thead>' +
            '<tbody id="portfolioActionsTableBody">';

        html += buildActionsTableRows(actions, today);

        html += '</tbody></table></div>';

        container.innerHTML = html;

        // Store data for sorting / filtering
        window.portfolioActionsData = actions;

    } catch (error) {
        console.error('Error rendering portfolio actions:', error);
        container.innerHTML = '<np-empty-state variant="card" heading="Error Loading Actions">' +
            '<p>Failed to load action data. Please try again.</p>' +
            '</np-empty-state>';
    }
}

/**
 * Build table row HTML for actions
 */
function buildActionsTableRows(actions, today) {
    if (!today) {
        today = new Date();
        today.setHours(0, 0, 0, 0);
    }

    let html = '';
    actions.forEach(action => {
        const statusColour = deriveActionStatus(action);
        const isOverdue = action.targetDate && (() => {
            const t = new Date(action.targetDate);
            t.setHours(0, 0, 0, 0);
            return t < today;
        })();

        const priorityClass = getPriorityBadgeClass(action.priority);
        const priorityLabel = action.priority ? action.priority.charAt(0).toUpperCase() + action.priority.slice(1) : '-';

        const statusLabel = isOverdue ? 'Overdue' : 'Open';

        html += '<tr class="actions-row" data-project="' + escapeHtml(action.projectName) + '" ' +
            'onclick="openProjectAction(\'' + action.projectId + '\', ' + (action.actionId || 'null') + ')">' +
            '<td class="actions-project-name">' + escapeHtml(action.projectName) + '</td>' +
            '<td class="actions-task-name">' + escapeHtml(action.title) + '</td>' +
            '<td>' + escapeHtml(action.owner) + '</td>' +
            '<td>' + (priorityClass ? '<span class="actions-priority-badge ' + priorityClass + '">' + priorityLabel + '</span>' : priorityLabel) + '</td>' +
            '<td class="actions-finish-date' + (isOverdue ? ' actions-overdue' : '') + '">' + formatActionDate(action.targetDate) + '</td>' +
            '<td><span class="rag-badge rag-' + statusColour + '">' + statusLabel.toUpperCase() + '</span></td>' +
            '</tr>';
    });
    return html;
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
let portfolioActionsSortColumn = 'targetDate';
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
            case 'title':
                valA = a.title.toLowerCase();
                valB = b.title.toLowerCase();
                break;
            case 'owner':
                valA = (a.owner || '').toLowerCase();
                valB = (b.owner || '').toLowerCase();
                break;
            case 'priority': {
                const priorityOrder = { 'high': 0, 'medium': 1, 'low': 2 };
                valA = priorityOrder[(a.priority || '').toLowerCase()] ?? 3;
                valB = priorityOrder[(b.priority || '').toLowerCase()] ?? 3;
                break;
            }
            case 'targetDate':
                valA = a.targetDate ? new Date(a.targetDate).getTime() : Infinity;
                valB = b.targetDate ? new Date(b.targetDate).getTime() : Infinity;
                break;
            case 'status': {
                const statusOrder = { 'red': 0, 'amber': 1, 'green': 2, 'blue': 3 };
                valA = statusOrder[deriveActionStatus(a)] ?? 4;
                valB = statusOrder[deriveActionStatus(b)] ?? 4;
                break;
            }
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

    const filter = document.getElementById('portfolioActionsProjectFilter')?.value || 'all';

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let html = buildActionsTableRows(actions, today);

    tbody.innerHTML = html;

    // Re-apply filter
    if (filter !== 'all') {
        filterPortfolioActions();
    }
}

/**
 * Open a project and then open the action edit form for a specific action.
 * Loads the project into the editor, switches to dashboard view, and waits
 * for RAID items to be populated before opening the action form.
 */
function openProjectAction(projectId, actionId) {
    if (!projectId) return;

    // Load the project (this triggers updateAllViews which is async)
    openProjectDashboard(projectId);

    if (actionId == null) return;

    // Wait for RAID items to be loaded by updateAllViews, then open the form.
    // Poll briefly since updateAllViews is async and loads RAID items at the end.
    let attempts = 0;
    const maxAttempts = 30; // 3 seconds max
    const interval = setInterval(() => {
        attempts++;
        const item = raidItems.find(i => i.id === actionId && i.type === 'action');
        if (item) {
            clearInterval(interval);
            // Switch to actions tab and open the edit form
            if (typeof switchToView === 'function') {
                switchToView('actions');
            }
            openActionForm(actionId);
        } else if (attempts >= maxAttempts) {
            clearInterval(interval);
            // Fallback: just stay on the dashboard
            console.warn('Could not find action', actionId, 'after loading project', projectId);
        }
    }, 100);
}
