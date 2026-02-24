/**
 * Portfolio Status View
 * Shows project status dashboard with RAG indicators and progress tracking
 * Uses /api/parse data for accurate completion and status
 */

/**
 * Calculate project completion from parsed tasks
 */
function calculateProjectCompletionFromTasks(tasks) {
    if (!tasks || tasks.length === 0) return 0;

    // Use leaf tasks (non-summary) that have a percent value
    const leafTasks = tasks.filter(t => !t.is_summary);
    if (leafTasks.length === 0) return 0;

    let totalPercent = 0;
    leafTasks.forEach(t => {
        totalPercent += parseFloat(t.percent) || 0;
    });

    return Math.round(totalPercent / leafTasks.length);
}

/**
 * Extract RAG status from front matter or compute from tasks
 */
function extractRAGStatus(frontMatter, tasks, completion) {
    // Check front matter for explicit RAG
    if (frontMatter) {
        const ragKeys = ['rag', 'rag status', 'rag_status'];
        for (const key of ragKeys) {
            if (frontMatter[key]) {
                const val = String(frontMatter[key]).toLowerCase().trim();
                if (val.includes('green') || val === 'g') return 'green';
                if (val.includes('amber') || val.includes('yellow') || val === 'a') return 'amber';
                if (val.includes('red') || val === 'r') return 'red';
            }
        }
    }

    // Check individual task RAG statuses
    if (tasks && tasks.length > 0) {
        const ragCounts = { red: 0, amber: 0, green: 0 };
        tasks.forEach(t => {
            if (t.rag) {
                const r = t.rag.toLowerCase();
                if (r.includes('red') || r === 'r') ragCounts.red++;
                else if (r.includes('amber') || r.includes('yellow') || r === 'a') ragCounts.amber++;
                else if (r.includes('green') || r === 'g') ragCounts.green++;
            }
        });

        // If any tasks have explicit RAG, use worst-case
        if (ragCounts.red + ragCounts.amber + ragCounts.green > 0) {
            if (ragCounts.red > 0) return 'red';
            if (ragCounts.amber > 0) return 'amber';
            return 'green';
        }
    }

    // Fall back to completion-based heuristic
    if (completion >= 80) return 'green';
    if (completion >= 40) return 'amber';
    return 'red';
}

/**
 * Extract project status label from front matter or compute it
 */
function extractProjectStatusLabel(frontMatter, completion, ragStatus) {
    // Check front matter for explicit status
    if (frontMatter) {
        const statusKeys = ['status', 'project status', 'project_status'];
        for (const key of statusKeys) {
            if (frontMatter[key]) {
                return String(frontMatter[key]).split('\n')[0].trim();
            }
        }
    }

    // Derive from completion and RAG
    if (completion === 100) return 'Complete';
    if (completion === 0) return 'Not Started';
    if (ragStatus === 'red') return 'At Risk';
    if (ragStatus === 'amber') return 'In Progress';
    return 'On Track';
}

/**
 * Calculate project trend
 */
function calculateProjectTrend(project) {
    const daysSinceUpdate = Math.floor((Date.now() - project.updatedAt) / (1000 * 60 * 60 * 24));

    if (daysSinceUpdate <= 1) return 'up';
    if (daysSinceUpdate <= 7) return 'stable';
    return 'down';
}

/**
 * Render portfolio status view (async — uses /api/parse)
 */
async function renderPortfolioStatus() {
    const container = document.getElementById('portfolioStatusView');
    if (!container) return;

    // Show loading state
    container.innerHTML = '<div class="portfolio-loading">' +
        '<div class="portfolio-loading-spinner"></div>' +
        '<p>Loading project status...</p>' +
        '</div>';

    try {
        const parsedProjects = await parseAllProjects();

        if (parsedProjects.length === 0) {
            container.innerHTML = '<div class="portfolio-empty-state">' +
                '<h3>No Projects</h3>' +
                '<p>Create projects to see their status here.</p>' +
                '</div>';
            return;
        }

        // Calculate status for each project using parsed data
        const statusData = parsedProjects.map(({ project, parsedResult }) => {
            const tasks = (parsedResult && parsedResult.success) ? (parsedResult.tasks || []) : [];
            const frontMatter = (parsedResult && parsedResult.success) ? (parsedResult.front_matter || {}) : {};
            const raidItems = (parsedResult && parsedResult.success) ? (parsedResult.raid_items || []) : [];

            const completion = calculateProjectCompletionFromTasks(tasks);
            const ragStatus = extractRAGStatus(frontMatter, tasks, completion);
            const statusLabel = extractProjectStatusLabel(frontMatter, completion, ragStatus);
            const trend = calculateProjectTrend(project);

            const openRisks = raidItems.filter(item =>
                (item.type === 'risk' || item.type === 'issue') &&
                item.status === 'open'
            ).length;

            return {
                id: project.id,
                name: project.name,
                completion: completion,
                ragStatus: ragStatus,
                statusLabel: statusLabel,
                trend: trend,
                updatedAt: project.updatedAt,
                riskCount: openRisks
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
                '<td><span class="status-badge status-' + proj.ragStatus + '">' + escapeHtml(proj.statusLabel) + '</span></td>' +
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

    } catch (error) {
        console.error('Error rendering portfolio status:', error);
        container.innerHTML = '<div class="portfolio-empty-state">' +
            '<h3>Error Loading Status</h3>' +
            '<p>Failed to load project status. Please try again.</p>' +
            '</div>';
    }
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
