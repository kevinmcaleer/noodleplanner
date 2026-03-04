/**
 * Portfolio Risks View
 * Shows open risks from RAID logs across all projects in a single table
 * with project-name column, RAG score filter, and project filter.
 * Uses /api/parse data for accurate RAID item data.
 */

/**
 * Collect open risks from RAID logs across all parsed projects.
 * An "open risk" is a RAID item with type='risk' and status!='closed'.
 *
 * @param {Array<{project, parsedResult}>} parsedProjects
 * @returns {Array} flat list of risk objects with calculated score
 */
function collectOpenRisks(parsedProjects) {
    const risks = [];

    parsedProjects.forEach(({ project, parsedResult }) => {
        if (!parsedResult) return;

        // RAID items are parsed independently of tasks, so use them
        // even when task parsing fails (success may be false).
        const raidItems = parsedResult.raid_items || [];

        raidItems.forEach(item => {
            if (!item.type || item.type.toLowerCase() !== 'risk') return;
            if (item.status && item.status.toLowerCase() === 'closed') return;

            // Use the backend's pre-calculated values directly
            const impact = item.impact != null ? item.impact : 0;
            const likelihood = item.likelihood != null ? item.likelihood : 0;
            const score = item.score != null ? item.score : (impact * likelihood);

            risks.push({
                projectId: project.id,
                projectName: project.name,
                raidItemId: item.id,
                title: item.title || item.description || '-',
                description: item.description || '',
                owner: item.owner || '-',
                impact: impact,
                likelihood: likelihood,
                score: score,
                status: item.status || 'open',
                rag: deriveRiskRAG(score)
            });
        });
    });

    // Sort by score (highest first)
    risks.sort((a, b) => b.score - a.score);

    return risks;
}

/**
 * Derive RAG colour from risk score.
 * High (Red): score >= 16
 * Medium (Amber): score 6-15
 * Low (Green): score < 6
 */
function deriveRiskRAG(score) {
    if (score >= 16) return 'red';
    if (score >= 6) return 'amber';
    return 'green';
}

/**
 * Render portfolio risks view (async -- uses /api/parse via parseAllProjects)
 */
async function renderPortfolioRisks() {
    const container = document.getElementById('portfolioRisksView');
    if (!container) return;

    // Show loading state
    container.innerHTML = '<div class="portfolio-loading">' +
        '<div class="portfolio-loading-spinner"></div>' +
        '<p>Loading risks across all projects...</p>' +
        '</div>';

    try {
        const parsedProjects = await parseAllProjects();

        if (parsedProjects.length === 0) {
            container.innerHTML = '<div class="portfolio-empty-state">' +
                '<h3>No Projects</h3>' +
                '<p>Create projects to see open risks here.</p>' +
                '</div>';
            return;
        }

        const risks = collectOpenRisks(parsedProjects);

        if (risks.length === 0) {
            container.innerHTML = '<div class="portfolio-empty-state">' +
                '<h3>No Open Risks</h3>' +
                '<p>There are no open risks in any project RAID logs.</p>' +
                '</div>';
            return;
        }

        // Build unique project names for filter dropdown
        const projectNames = [...new Set(risks.map(r => r.projectName))].sort((a, b) => a.localeCompare(b));

        // Summary counts
        const highCount = risks.filter(r => r.rag === 'red').length;
        const mediumCount = risks.filter(r => r.rag === 'amber').length;
        const lowCount = risks.filter(r => r.rag === 'green').length;

        // Build project options for "New Risk" dropdown
        const allProjects = parsedProjects.map(pp => pp.project).sort((a, b) => a.name.localeCompare(b.name));

        // Header with filters and summary
        let html = '<div class="portfolio-risks-header">' +
            '<h2><span class="ribbon-banner ribbon-banner--red">Risk Register</span></h2>' +
            '<div class="portfolio-risks-summary">' +
            '<div class="risks-summary-item">' +
            '<span class="summary-label">Open Risks</span>' +
            '<span class="summary-value">' + risks.length + '</span>' +
            '</div>' +
            '<div class="risks-summary-item">' +
            '<span class="summary-label">High</span>' +
            '<span class="summary-value" style="color: #dc3545">' + highCount + '</span>' +
            '</div>' +
            '<div class="risks-summary-item">' +
            '<span class="summary-label">Medium</span>' +
            '<span class="summary-value" style="color: #e8a317">' + mediumCount + '</span>' +
            '</div>' +
            '<div class="risks-summary-item">' +
            '<span class="summary-label">Low</span>' +
            '<span class="summary-value" style="color: #28a745">' + lowCount + '</span>' +
            '</div>' +
            '</div>' +
            '<div class="portfolio-risks-filters">' +
            '<label>Project: </label>' +
            '<select id="portfolioRisksProjectFilter" onchange="filterPortfolioRisks()">' +
            '<option value="all">All Projects</option>';

        projectNames.forEach(name => {
            html += '<option value="' + escapeHtml(name) + '">' + escapeHtml(name) + '</option>';
        });

        html += '</select>' +
            '<label>RAG: </label>' +
            '<select id="portfolioRisksRAGFilter" onchange="filterPortfolioRisks()">' +
            '<option value="all">All Levels</option>' +
            '<option value="red">High (Red)</option>' +
            '<option value="amber">Medium (Amber)</option>' +
            '<option value="green">Low (Green)</option>' +
            '</select>' +
            '</div>' +
            '<div class="portfolio-risks-new">' +
            '<select id="newRiskProjectSelect">';

        allProjects.forEach(proj => {
            html += '<option value="' + escapeHtml(proj.id) + '">' + escapeHtml(proj.name) + '</option>';
        });

        html += '</select>' +
            '<button class="new-risk-btn" onclick="newRiskForProject()">+ New Risk</button>' +
            '</div>' +
            '</div>';

        // Table
        html += '<div class="portfolio-risks-table-wrapper">' +
            '<table class="portfolio-risks-table">' +
            '<thead>' +
            '<tr>' +
            '<th onclick="sortPortfolioRisks(\'project\')">Project <span class="sort-indicator"></span></th>' +
            '<th onclick="sortPortfolioRisks(\'title\')">Title <span class="sort-indicator"></span></th>' +
            '<th onclick="sortPortfolioRisks(\'description\')">Description <span class="sort-indicator"></span></th>' +
            '<th onclick="sortPortfolioRisks(\'owner\')">Owner <span class="sort-indicator"></span></th>' +
            '<th onclick="sortPortfolioRisks(\'impact\')">Impact <span class="sort-indicator"></span></th>' +
            '<th onclick="sortPortfolioRisks(\'likelihood\')">Likelihood <span class="sort-indicator"></span></th>' +
            '<th onclick="sortPortfolioRisks(\'score\')">Score <span class="sort-indicator"></span></th>' +
            '<th onclick="sortPortfolioRisks(\'status\')">Status <span class="sort-indicator"></span></th>' +
            '</tr>' +
            '</thead>' +
            '<tbody id="portfolioRisksTableBody">';

        html += buildRisksTableRows(risks);

        html += '</tbody></table></div>';

        container.innerHTML = html;

        // Store data for sorting / filtering
        window.portfolioRisksData = risks;

    } catch (error) {
        console.error('Error rendering portfolio risks:', error);
        container.innerHTML = '<div class="portfolio-empty-state">' +
            '<h3>Error Loading Risks</h3>' +
            '<p>Failed to load risk data. Please try again.</p>' +
            '</div>';
    }
}

/**
 * Build table row HTML for risks
 */
function buildRisksTableRows(risks) {
    let html = '';
    risks.forEach(risk => {
        const ragClass = 'rag-' + risk.rag;
        const ragLabel = risk.rag === 'red' ? 'HIGH' : (risk.rag === 'amber' ? 'MEDIUM' : 'LOW');

        const statusLabel = risk.status.charAt(0).toUpperCase() + risk.status.slice(1);

        // Truncate description for table display
        const descTruncated = risk.description.length > 80
            ? risk.description.substring(0, 80) + '...'
            : risk.description;

        html += '<tr class="risks-row" ' +
            'data-project="' + escapeHtml(risk.projectName) + '" ' +
            'data-rag="' + risk.rag + '" ' +
            'onclick="openProjectRisk(\'' + risk.projectId + '\', ' + risk.raidItemId + ')">' +
            '<td class="risks-project-name">' + escapeHtml(risk.projectName) + '</td>' +
            '<td class="risks-title">' + escapeHtml(risk.title) + '</td>' +
            '<td class="risks-description">' + escapeHtml(descTruncated) + '</td>' +
            '<td>' + escapeHtml(risk.owner) + '</td>' +
            '<td class="risks-numeric">' + risk.impact + '</td>' +
            '<td class="risks-numeric">' + risk.likelihood + '</td>' +
            '<td><span class="risk-score-badge ' + ragClass + '">' + risk.score + ' ' + ragLabel + '</span></td>' +
            '<td><span class="status-badge status-' + risk.status.toLowerCase() + '">' + escapeHtml(statusLabel) + '</span></td>' +
            '</tr>';
    });
    return html;
}

/**
 * Filter risks table by project name and/or RAG level
 */
function filterPortfolioRisks() {
    const projectFilter = document.getElementById('portfolioRisksProjectFilter')?.value || 'all';
    const ragFilter = document.getElementById('portfolioRisksRAGFilter')?.value || 'all';
    const rows = document.querySelectorAll('.risks-row');

    rows.forEach(row => {
        const matchProject = (projectFilter === 'all' || row.dataset.project === projectFilter);
        const matchRag = (ragFilter === 'all' || row.dataset.rag === ragFilter);

        if (matchProject && matchRag) {
            row.style.display = '';
        } else {
            row.style.display = 'none';
        }
    });
}

/**
 * Sort portfolio risks table
 */
let portfolioRisksSortColumn = 'score';
let portfolioRisksSortAsc = false; // Default descending for score

function sortPortfolioRisks(column) {
    if (portfolioRisksSortColumn === column) {
        portfolioRisksSortAsc = !portfolioRisksSortAsc;
    } else {
        portfolioRisksSortColumn = column;
        // Default to descending for score, ascending for others
        portfolioRisksSortAsc = (column !== 'score');
    }

    if (!window.portfolioRisksData) return;

    const data = [...window.portfolioRisksData];

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
            case 'description':
                valA = a.description.toLowerCase();
                valB = b.description.toLowerCase();
                break;
            case 'owner':
                valA = (a.owner || '').toLowerCase();
                valB = (b.owner || '').toLowerCase();
                break;
            case 'impact':
                valA = a.impact;
                valB = b.impact;
                break;
            case 'likelihood':
                valA = a.likelihood;
                valB = b.likelihood;
                break;
            case 'score':
                valA = a.score;
                valB = b.score;
                break;
            case 'status':
                valA = (a.status || '').toLowerCase();
                valB = (b.status || '').toLowerCase();
                break;
            default:
                return 0;
        }

        if (valA < valB) return portfolioRisksSortAsc ? -1 : 1;
        if (valA > valB) return portfolioRisksSortAsc ? 1 : -1;
        return 0;
    });

    window.portfolioRisksData = data;
    rerenderRisksTable(data);
}

/**
 * Re-render just the risks table body from in-memory data (for sorting)
 */
function rerenderRisksTable(risks) {
    const tbody = document.getElementById('portfolioRisksTableBody');
    if (!tbody) return;

    let html = buildRisksTableRows(risks);
    tbody.innerHTML = html;

    // Re-apply filters
    const projectFilter = document.getElementById('portfolioRisksProjectFilter')?.value || 'all';
    const ragFilter = document.getElementById('portfolioRisksRAGFilter')?.value || 'all';
    if (projectFilter !== 'all' || ragFilter !== 'all') {
        filterPortfolioRisks();
    }
}

/**
 * Open a specific risk item in the editor RAID form.
 * Saves current state, loads the target project, parses it to populate
 * the raidItems array, then opens the RAID form for the given item.
 */
async function openProjectRisk(projectId, raidItemId) {
    // Save current project before switching
    saveCurrentProjectState();

    // Load target project into editor
    if (typeof loadProjectIntoEditor === 'function') {
        loadProjectIntoEditor(projectId);
    }

    // Switch to the RAID tracking view in the editor
    if (typeof switchToView === 'function') {
        switchToView('raid');
    } else {
        switchMainTab('editor');
    }

    // The raidItems array needs to be populated from the API before we
    // can open the form.  loadProjectIntoEditor triggers updateAllViews
    // asynchronously, so raidItems may still be empty.  Parse now and
    // force-load the items so the form can find the target item.
    try {
        const project = typeof loadProject === 'function' ? loadProject(projectId) : null;
        if (project) {
            const response = await fetch('/api/parse', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    plan_text: project.planText || '',
                    project_name: project.name || null
                })
            });
            if (response.ok) {
                const result = await response.json();
                const items = result.raid_items || [];
                if (items.length > 0 && typeof loadRaidItemsFromData === 'function') {
                    // Clear existing items so loadRaidItemsFromData accepts the new data
                    if (typeof clearRaidLogEntries === 'function') {
                        clearRaidLogEntries();
                    }
                    loadRaidItemsFromData(items);
                }
            }
        }
    } catch (error) {
        console.error('Error parsing project for RAID form:', error);
    }

    // Now open the RAID form for the specific item
    if (typeof openRaidForm === 'function') {
        openRaidForm(raidItemId);
    }

    // Refresh project selectors
    if (typeof refreshProjectSelectors === 'function') {
        refreshProjectSelectors();
    }
    if (typeof renderProjectsTable === 'function') {
        renderProjectsTable();
    }
}

/**
 * Create a new risk for the selected project.
 * Reads the project from the "New Risk" dropdown, loads that project,
 * switches to the RAID view, and opens a blank RAID form set to type 'risk'.
 */
async function newRiskForProject() {
    const select = document.getElementById('newRiskProjectSelect');
    if (!select) return;

    const projectId = select.value;
    if (!projectId) return;

    // Save current project before switching
    saveCurrentProjectState();

    // Load target project into editor
    if (typeof loadProjectIntoEditor === 'function') {
        loadProjectIntoEditor(projectId);
    }

    // Switch to the RAID tracking view in the editor
    if (typeof switchToView === 'function') {
        switchToView('raid');
    } else {
        switchMainTab('editor');
    }

    // Ensure RAID items are loaded for the new project so the table
    // renders correctly behind the form
    try {
        const project = typeof loadProject === 'function' ? loadProject(projectId) : null;
        if (project) {
            const response = await fetch('/api/parse', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    plan_text: project.planText || '',
                    project_name: project.name || null
                })
            });
            if (response.ok) {
                const result = await response.json();
                const items = result.raid_items || [];
                if (items.length > 0 && typeof loadRaidItemsFromData === 'function') {
                    if (typeof clearRaidLogEntries === 'function') {
                        clearRaidLogEntries();
                    }
                    loadRaidItemsFromData(items);
                }
            }
        }
    } catch (error) {
        console.error('Error parsing project for RAID form:', error);
    }

    // Open a blank RAID form and set type to 'risk'
    if (typeof openRaidForm === 'function') {
        openRaidForm(null);
        // Ensure type is set to 'risk'
        const typeSelect = document.getElementById('raidItemType');
        if (typeSelect) {
            typeSelect.value = 'risk';
        }
    }

    // Refresh project selectors
    if (typeof refreshProjectSelectors === 'function') {
        refreshProjectSelectors();
    }
    if (typeof renderProjectsTable === 'function') {
        renderProjectsTable();
    }
}
