/**
 * Portfolio Status View
 * Shows project status dashboard with RAG indicators and progress tracking
 */

/**
 * Calculate project completion percentage
 */
function calculateProjectCompletion(planText) {
    if (!planText) return 0;

    const lines = planText.split('\n');
    let totalTasks = 0;
    let completedTasks = 0;

    lines.forEach(line => {
        const trimmed = line.trim();
        // Match task lines with optional percentage
        if (trimmed.match(/^\s{2,}\S/)) {
            totalTasks++;
            // Check for 100% completion
            if (trimmed.includes('%100') || trimmed.includes('% 100') ||
                trimmed.includes('%100%') || trimmed.includes('100%')) {
                completedTasks++;
            }
        }
    });

    if (totalTasks === 0) return 0;
    return Math.round((completedTasks / totalTasks) * 100);
}

/**
 * Determine RAG status based on project health
 */
function calculateRAGStatus(project, completion, raidItems) {
    // Count open risks and issues
    const openRisks = raidItems.filter(item =>
        (item.type === 'risk' || item.type === 'issue') &&
        item.status === 'open'
    ).length;

    // Determine status based on completion and risk
    if (completion >= 90 && openRisks === 0) {
        return 'green'; // On track, low risk
    } else if (completion >= 70 && openRisks <= 2) {
        return 'green'; // Good progress, manageable risks
    } else if (completion >= 50 || (completion >= 40 && openRisks <= 3)) {
        return 'amber'; // Some concerns but progressing
    } else {
        return 'red'; // Behind schedule or high risk
    }
}

/**
 * Calculate project trend
 */
function calculateProjectTrend(project) {
    // Simple trend based on how recently updated
    const daysSinceUpdate = Math.floor((Date.now() - project.updatedAt) / (1000 * 60 * 60 * 24));

    if (daysSinceUpdate <= 1) {
        return 'up'; // Recently active
    } else if (daysSinceUpdate <= 7) {
        return 'stable'; // Regular activity
    } else {
        return 'down'; // Stale
    }
}

/**
 * Get project status label
 */
function getProjectStatusLabel(completion, ragStatus) {
    if (completion === 100) return 'Complete';
    if (completion === 0) return 'Not Started';
    if (ragStatus === 'red') return 'At Risk';
    if (ragStatus === 'amber') return 'In Progress';
    return 'On Track';
}

/**
 * Render portfolio status view
 */
function renderPortfolioStatus() {
    const container = document.getElementById('portfolioStatusView');
    if (!container) return;

    const projectsData = batchLoadProjectsData();

    if (projectsData.length === 0) {
        container.innerHTML = '<div class="portfolio-empty-state">' +
            '<h3>No Projects</h3>' +
            '<p>Create projects to see their status here.</p>' +
            '</div>';
        return;
    }

    // Calculate status for each project
    const statusData = projectsData.map(proj => {
        const completion = calculateProjectCompletion(proj.planText || '');
        const ragStatus = calculateRAGStatus(proj, completion, proj.data?.raidItems || []);
        const trend = calculateProjectTrend(proj);
        const statusLabel = getProjectStatusLabel(completion, ragStatus);

        return {
            id: proj.id,
            name: proj.name,
            completion: completion,
            ragStatus: ragStatus,
            statusLabel: statusLabel,
            trend: trend,
            updatedAt: proj.updatedAt,
            riskCount: (proj.data?.raidItems || []).filter(item =>
                (item.type === 'risk' || item.type === 'issue') && item.status === 'open'
            ).length
        };
    });

    // Sort by RAG status (red first, then amber, then green)
    const ragOrder = { 'red': 0, 'amber': 1, 'green': 2 };
    statusData.sort((a, b) => ragOrder[a.ragStatus] - ragOrder[b.ragStatus]);

    let html = '<div class="portfolio-status-header">' +
        '<h2>Project Status Dashboard</h2>' +
        '<div class="portfolio-status-filters">' +
        '<label>Filter by: </label>' +
        '<select id="portfolioStatusFilter" onchange="filterPortfolioStatus()">' +
        '<option value="all">All Projects</option>' +
        '<option value="red">At Risk</option>' +
        '<option value="amber">In Progress</option>' +
        '<option value="green">On Track</option>' +
        '</select>' +
        '</div>' +
        '</div>';

    html += '<div class="portfolio-status-table-wrapper">' +
        '<table class="portfolio-status-table">' +
        '<thead>' +
        '<tr>' +
        '<th onclick="sortPortfolioStatus(\'name\')">Project <span class="sort-indicator"></span></th>' +
        '<th onclick="sortPortfolioStatus(\'status\')">Status <span class="sort-indicator"></span></th>' +
        '<th onclick="sortPortfolioStatus(\'completion\')">Progress <span class="sort-indicator"></span></th>' +
        '<th onclick="sortPortfolioStatus(\'rag\')">RAG <span class="sort-indicator"></span></th>' +
        '<th onclick="sortPortfolioStatus(\'risks\')">Open Risks <span class="sort-indicator"></span></th>' +
        '<th onclick="sortPortfolioStatus(\'updated\')">Last Updated <span class="sort-indicator"></span></th>' +
        '<th>Trend</th>' +
        '</tr>' +
        '</thead>' +
        '<tbody id="portfolioStatusTableBody">';

    statusData.forEach(proj => {
        const updatedDate = new Date(proj.updatedAt).toLocaleDateString();
        const trendIcon = proj.trend === 'up' ? '↗' : proj.trend === 'down' ? '↘' : '→';
        const trendClass = 'trend-' + proj.trend;

        html += '<tr class="status-row" onclick="switchToProject(\'' + proj.id + '\')" data-rag="' + proj.ragStatus + '">' +
            '<td class="project-name">' + escapeHtml(proj.name) + '</td>' +
            '<td><span class="status-badge status-' + proj.ragStatus + '">' + proj.statusLabel + '</span></td>' +
            '<td>' +
            '<div class="progress-bar-container">' +
            '<div class="progress-bar" style="width: ' + proj.completion + '%"></div>' +
            '<span class="progress-text">' + proj.completion + '%</span>' +
            '</div>' +
            '</td>' +
            '<td><span class="rag-badge rag-' + proj.ragStatus + '">' + proj.ragStatus.toUpperCase() + '</span></td>' +
            '<td class="risk-count">' + proj.riskCount + '</td>' +
            '<td>' + updatedDate + '</td>' +
            '<td><span class="trend-indicator ' + trendClass + '">' + trendIcon + '</span></td>' +
            '</tr>';
    });

    html += '</tbody></table></div>';

    container.innerHTML = html;

    // Store data for sorting
    window.portfolioStatusData = statusData;
}

/**
 * Filter portfolio status by RAG
 */
function filterPortfolioStatus() {
    const filter = document.getElementById('portfolioStatusFilter')?.value || 'all';
    const rows = document.querySelectorAll('.status-row');

    rows.forEach(row => {
        if (filter === 'all' || row.dataset.rag === filter) {
            row.style.display = '';
        } else {
            row.style.display = 'none';
        }
    });
}

/**
 * Sort portfolio status table
 */
let portfolioStatusSortColumn = 'rag';
let portfolioStatusSortAsc = true;

function sortPortfolioStatus(column) {
    if (portfolioStatusSortColumn === column) {
        portfolioStatusSortAsc = !portfolioStatusSortAsc;
    } else {
        portfolioStatusSortColumn = column;
        portfolioStatusSortAsc = true;
    }

    if (!window.portfolioStatusData) return;

    const data = [...window.portfolioStatusData];

    data.sort((a, b) => {
        let valA, valB;

        switch (column) {
            case 'name':
                valA = a.name.toLowerCase();
                valB = b.name.toLowerCase();
                break;
            case 'completion':
                valA = a.completion;
                valB = b.completion;
                break;
            case 'rag':
                const ragOrder = { 'red': 0, 'amber': 1, 'green': 2 };
                valA = ragOrder[a.ragStatus];
                valB = ragOrder[b.ragStatus];
                break;
            case 'risks':
                valA = a.riskCount;
                valB = b.riskCount;
                break;
            case 'updated':
                valA = a.updatedAt;
                valB = b.updatedAt;
                break;
            default:
                return 0;
        }

        if (valA < valB) return portfolioStatusSortAsc ? -1 : 1;
        if (valA > valB) return portfolioStatusSortAsc ? 1 : -1;
        return 0;
    });

    window.portfolioStatusData = data;
    renderPortfolioStatus();
}
