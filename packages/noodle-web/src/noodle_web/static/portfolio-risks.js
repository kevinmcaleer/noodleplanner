/**
 * Portfolio Risks & Issues View
 * Shows open risks and issues from RAID logs across all projects in a single
 * table with project-name column, RAG score filter, type filter, and project filter.
 * Uses /api/parse data for accurate RAID item data.
 */

/**
 * Collect open risks and issues from RAID logs across all parsed projects.
 * An "open" item is a RAID item with type='risk' or type='issue' and status!='closed'.
 *
 * @param {Array<{project, parsedResult}>} parsedProjects
 * @param {string} typeFilter - 'all', 'risk', or 'issue'
 * @returns {Array} flat list of risk/issue objects with calculated score
 */
function collectOpenRisksAndIssues(parsedProjects, typeFilter) {
    const items = [];
    const seen = new Set();

    parsedProjects.forEach(({ project, parsedResult }) => {
        if (!parsedResult) return;

        const raidItems = parsedResult.raid_items || [];

        raidItems.forEach(item => {
            if (!item.type) return;
            const itemType = item.type.toLowerCase();

            // Only collect risks and issues
            if (itemType !== 'risk' && itemType !== 'issue') return;

            // Apply type filter
            if (typeFilter && typeFilter !== 'all' && itemType !== typeFilter) return;

            // Skip closed items
            if (item.status && item.status.toLowerCase() === 'closed') return;

            // Deduplicate by project, type, and title to prevent the
            // same risk from appearing multiple times.
            const title = item.title || item.description || '-';
            const dedupKey = project.id + '|' + itemType + '|' + title;
            if (seen.has(dedupKey)) return;
            seen.add(dedupKey);

            // Use the backend's pre-calculated values directly
            const impact = item.impact != null ? item.impact : 0;
            const likelihood = item.likelihood != null ? item.likelihood : 0;
            const score = item.score != null ? item.score : (impact * likelihood);

            items.push({
                projectId: project.id,
                projectName: project.name,
                raidItemId: item.id,
                type: itemType,
                title: title,
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
    items.sort((a, b) => b.score - a.score);

    return items;
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
 * Render portfolio risks & issues view (async -- uses /api/parse via parseAllProjects)
 */
async function renderPortfolioRisks() {
    const container = document.getElementById('portfolioRisksView');
    if (!container) return;

    // Show loading state
    container.innerHTML = '<div class="portfolio-loading">' +
        '<div class="portfolio-loading-spinner"></div>' +
        '<p>Loading risks and issues across all projects...</p>' +
        '</div>';

    try {
        const parsedProjects = await parseAllProjects();

        if (parsedProjects.length === 0) {
            container.innerHTML = '<np-empty-state variant="card" heading="No Projects">' +
                '<p>Create projects to see open risks and issues here.</p>' +
                '</np-empty-state>';
            return;
        }

        // Store parsed projects for re-filtering
        window.portfolioRisksParsedProjects = parsedProjects;

        // Default: show red and amber only
        window.portfolioRisksRAGDefault = 'red-amber';

        // Collect all items (no type filter initially)
        const allItems = collectOpenRisksAndIssues(parsedProjects, 'all');

        if (allItems.length === 0) {
            container.innerHTML = '<np-empty-state variant="card" heading="No Open Risks or Issues">' +
                '<p>There are no open risks or issues in any project RAID logs.</p>' +
                '</np-empty-state>';
            return;
        }

        // Red and amber: what the default RAG filter shows
        const items = allItems.filter(item => item.rag === 'red' || item.rag === 'amber');

        // Build unique project names for filter dropdown (from all items)
        const projectNames = [...new Set(allItems.map(r => r.projectName))].sort((a, b) => a.localeCompare(b));

        // Summary counts (from all items, unfiltered)
        const highCount = allItems.filter(r => r.rag === 'red').length;
        const mediumCount = allItems.filter(r => r.rag === 'amber').length;
        const lowCount = allItems.filter(r => r.rag === 'green').length;
        const riskCount = allItems.filter(r => r.type === 'risk').length;
        const issueCount = allItems.filter(r => r.type === 'issue').length;

        // Build project options for "New Risk" dropdown
        const allProjects = parsedProjects.map(pp => pp.project).sort((a, b) => a.name.localeCompare(b.name));

        // Header with filters and summary
        let html = '<div class="portfolio-risks-header">' +
            '<h2><span class="ribbon-banner ribbon-banner--red">Risk and Issues Register</span></h2>' +
            '<div class="portfolio-risks-summary">' +
            '<div class="risks-summary-item">' +
            '<span class="summary-label">Open Items</span>' +
            '<span class="summary-value">' + allItems.length + '</span>' +
            '</div>' +
            '<div class="risks-summary-item">' +
            '<span class="summary-label">Risks</span>' +
            '<span class="summary-value">' + riskCount + '</span>' +
            '</div>' +
            '<div class="risks-summary-item">' +
            '<span class="summary-label">Issues</span>' +
            '<span class="summary-value">' + issueCount + '</span>' +
            '</div>' +
            '<div class="risks-summary-item">' +
            '<span class="summary-label">High</span>' +
            '<span class="summary-value" style="color: var(--np-danger-ink)">' + highCount + '</span>' +
            '</div>' +
            '<div class="risks-summary-item">' +
            '<span class="summary-label">Medium</span>' +
            '<span class="summary-value" style="color: var(--np-accent-ink)">' + mediumCount + '</span>' +
            '</div>' +
            '<div class="risks-summary-item">' +
            '<span class="summary-label">Low</span>' +
            '<span class="summary-value" style="color: var(--np-sage-ink)">' + lowCount + '</span>' +
            '</div>' +
            '</div>' +
            '<div class="portfolio-risks-filters">' +
            '<label for="portfolioRisksTypeFilter">Type: </label>' +
            '<select id="portfolioRisksTypeFilter" onchange="filterPortfolioRisks()">' +
            '<option value="all">Risks &amp; Issues</option>' +
            '<option value="risk">Risks Only</option>' +
            '<option value="issue">Issues Only</option>' +
            '</select>' +
            '<label for="portfolioRisksProjectFilter">Project: </label>' +
            '<select id="portfolioRisksProjectFilter" onchange="filterPortfolioRisks()">' +
            '<option value="all">All Projects</option>';

        projectNames.forEach(name => {
            html += '<option value="' + escapeHtml(name) + '">' + escapeHtml(name) + '</option>';
        });

        html += '</select>' +
            '<label for="portfolioRisksRAGFilter">RAG: </label>' +
            '<select id="portfolioRisksRAGFilter" onchange="filterPortfolioRisks()">' +
            '<option value="red-amber" selected>Red &amp; Amber</option>' +
            '<option value="all">All Levels</option>' +
            '<option value="red">High (Red)</option>' +
            '<option value="amber">Medium (Amber)</option>' +
            '<option value="green">Low (Green)</option>' +
            '</select>' +
            '</div>' +
            '<div class="portfolio-risks-new">' +
            '<select id="newRiskProjectSelect" aria-label="Select project for new risk">';

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
            '<th onclick="sortPortfolioRisks(\'type\')">Type <span class="sort-indicator"></span></th>' +
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

        // Every item gets a row and the RAG filter (Red & Amber by default)
        // hides the rest: filterPortfolioRisks() only shows and hides rows,
        // so a green item with no row could never be shown
        html += buildRisksTableRows(allItems);

        html += '</tbody></table></div>';

        container.innerHTML = html;
        filterPortfolioRisks();

        // Store data for sorting / filtering
        window.portfolioRisksData = allItems;
        window.portfolioRisksFilteredData = items;

    } catch (error) {
        console.error('Error rendering portfolio risks:', error);
        container.innerHTML = '<np-empty-state variant="card" heading="Error Loading Risks &amp; Issues">' +
            '<p>Failed to load risk and issue data. Please try again.</p>' +
            '</np-empty-state>';
    }
}

/**
 * Build table row HTML for risks and issues
 */
function buildRisksTableRows(items) {
    let html = '';
    items.forEach(item => {
        const ragClass = 'rag-' + item.rag;
        const ragLabel = item.rag === 'red' ? 'HIGH' : (item.rag === 'amber' ? 'MEDIUM' : 'LOW');

        const statusLabel = item.status.charAt(0).toUpperCase() + item.status.slice(1);
        const typeLabel = item.type.charAt(0).toUpperCase() + item.type.slice(1);
        const typeClass = 'raid-type-' + item.type;

        // Truncate description for table display
        const descTruncated = item.description.length > 80
            ? item.description.substring(0, 80) + '...'
            : item.description;

        html += '<tr class="risks-row" ' +
            'data-project="' + escapeHtml(item.projectName) + '" ' +
            'data-rag="' + item.rag + '" ' +
            'data-type="' + item.type + '" ' +
            'onclick="openProjectRisk(\'' + item.projectId + '\', ' + item.raidItemId + ')">' +
            '<td class="risks-project-name">' + escapeHtml(item.projectName) + '</td>' +
            '<td><span class="raid-type-badge ' + typeClass + '">' + escapeHtml(typeLabel) + '</span></td>' +
            '<td class="risks-title">' + escapeHtml(item.title) + '</td>' +
            '<td class="risks-description">' + escapeHtml(descTruncated) + '</td>' +
            '<td>' + escapeHtml(item.owner) + '</td>' +
            '<td class="risks-numeric">' + item.impact + '</td>' +
            '<td class="risks-numeric">' + item.likelihood + '</td>' +
            '<td><span class="risk-score-badge ' + ragClass + '">' + item.score + ' ' + ragLabel + '</span></td>' +
            '<td><span class="status-badge status-' + item.status.toLowerCase() + '">' + escapeHtml(statusLabel) + '</span></td>' +
            '</tr>';
    });
    return html;
}

/**
 * Filter risks/issues table by type, project name, and/or RAG level
 */
function filterPortfolioRisks() {
    const typeFilter = document.getElementById('portfolioRisksTypeFilter')?.value || 'all';
    const projectFilter = document.getElementById('portfolioRisksProjectFilter')?.value || 'all';
    const ragFilter = document.getElementById('portfolioRisksRAGFilter')?.value || 'red-amber';
    const rows = document.querySelectorAll('.risks-row');

    rows.forEach(row => {
        const matchType = (typeFilter === 'all' || row.dataset.type === typeFilter);
        const matchProject = (projectFilter === 'all' || row.dataset.project === projectFilter);
        let matchRag;
        if (ragFilter === 'all') {
            matchRag = true;
        } else if (ragFilter === 'red-amber') {
            matchRag = (row.dataset.rag === 'red' || row.dataset.rag === 'amber');
        } else {
            matchRag = (row.dataset.rag === ragFilter);
        }

        if (matchType && matchProject && matchRag) {
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
            case 'type':
                valA = a.type.toLowerCase();
                valB = b.type.toLowerCase();
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
function rerenderRisksTable(items) {
    const tbody = document.getElementById('portfolioRisksTableBody');
    if (!tbody) return;

    let html = buildRisksTableRows(items);
    tbody.innerHTML = html;

    // Re-apply filters
    filterPortfolioRisks();
}

/**
 * Open a specific risk/issue item in the editor RAID form.
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
