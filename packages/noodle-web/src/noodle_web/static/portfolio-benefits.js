/**
 * Portfolio Benefits View
 * Shows benefits realisation items across all projects in a single
 * table with type filter, project filter, and cross-project consistency analysis.
 * Uses /api/parse data (benefits_items) via parseAllProjects.
 */

/**
 * Collect benefits items from all parsed projects.
 *
 * @param {Array<{project, parsedResult}>} parsedProjects
 * @returns {Array} flat list of benefit objects with projectName/projectId
 */
function collectPortfolioBenefits(parsedProjects) {
    const items = [];

    parsedProjects.forEach(({ project, parsedResult }) => {
        if (!parsedResult) return;

        const benefitsItems = parsedResult.benefits_items || [];

        benefitsItems.forEach(item => {
            items.push({
                projectId: project.id,
                projectName: project.name,
                id: item.id,
                type: (item.type || 'benefit').toLowerCase(),
                title: item.title || '-',
                description: item.description || '',
                objectiveType: item.objective_type || item.objectiveType || '',
                targetValue: item.target_value || item.targetValue || '',
                currentValue: item.current_value || item.currentValue || '',
                targetDate: item.target_date || item.targetDate || '',
                measurementMethod: item.measurement_method || item.measurementMethod || '',
                contributionPercent: item.contribution_percent || item.contributionPercent || 0,
                status: item.status || '',
                score: item.score || 0
            });
        });
    });

    return items;
}

/**
 * Render portfolio benefits view (async -- uses /api/parse via parseAllProjects)
 */
async function renderPortfolioBenefits() {
    const container = document.getElementById('portfolioBenefitsView');
    if (!container) return;

    container.innerHTML = '<div class="portfolio-loading">' +
        '<div class="portfolio-loading-spinner"></div>' +
        '<p>Loading benefits across all projects...</p>' +
        '</div>';

    try {
        const parsedProjects = await parseAllProjects();

        if (parsedProjects.length === 0) {
            container.innerHTML = '<div class="portfolio-empty-state">' +
                '<h3>No Projects</h3>' +
                '<p>Create projects to see benefits realisation data here.</p>' +
                '</div>';
            return;
        }

        window.portfolioBenefitsParsedProjects = parsedProjects;

        const allItems = collectPortfolioBenefits(parsedProjects);

        if (allItems.length === 0) {
            container.innerHTML = '<div class="portfolio-empty-state">' +
                '<h3>No Benefits Items</h3>' +
                '<p>No benefits realisation items found in any project.</p>' +
                '</div>';
            return;
        }

        // Summary counts by type
        const typeCounts = {};
        const typeOrder = ['enabler', 'change', 'benefit', 'disbenefit', 'objective'];
        typeOrder.forEach(t => { typeCounts[t] = 0; });
        allItems.forEach(item => {
            const t = item.type;
            typeCounts[t] = (typeCounts[t] || 0) + 1;
        });

        // Unique project names for filter
        const projectNames = [...new Set(allItems.map(i => i.projectName))].sort((a, b) => a.localeCompare(b));

        // Type colours for badges
        const typeColours = {
            enabler: '#EAB308',
            change: '#6B7280',
            benefit: '#3B82F6',
            disbenefit: '#EF4444',
            objective: '#22C55E'
        };

        // Header with summary and filters
        let html = '<div class="portfolio-benefits-header">' +
            '<h2><span class="ribbon-banner ribbon-banner--blue">Benefits Register</span></h2>' +
            '<div class="portfolio-benefits-summary">';

        html += '<div class="benefits-summary-item">' +
            '<span class="summary-label">Total Items</span>' +
            '<span class="summary-value">' + allItems.length + '</span>' +
            '</div>';

        typeOrder.forEach(t => {
            if (typeCounts[t] > 0) {
                const label = t.charAt(0).toUpperCase() + t.slice(1) + 's';
                html += '<div class="benefits-summary-item">' +
                    '<span class="summary-label">' + escapeHtml(label) + '</span>' +
                    '<span class="summary-value" style="color: ' + typeColours[t] + '">' + typeCounts[t] + '</span>' +
                    '</div>';
            }
        });

        html += '</div>' +
            '<div class="portfolio-benefits-filters">' +
            '<label for="portfolioBenefitsTypeFilter">Type: </label>' +
            '<select id="portfolioBenefitsTypeFilter" onchange="filterPortfolioBenefits()">' +
            '<option value="all">All Types</option>';

        typeOrder.forEach(t => {
            if (typeCounts[t] > 0) {
                const label = t.charAt(0).toUpperCase() + t.slice(1) + 's';
                html += '<option value="' + t + '">' + escapeHtml(label) + '</option>';
            }
        });

        html += '</select>' +
            '<label for="portfolioBenefitsProjectFilter">Project: </label>' +
            '<select id="portfolioBenefitsProjectFilter" onchange="filterPortfolioBenefits()">' +
            '<option value="all">All Projects</option>';

        projectNames.forEach(name => {
            html += '<option value="' + escapeHtml(name) + '">' + escapeHtml(name) + '</option>';
        });

        html += '</select>' +
            '</div>' +
            '</div>';

        // Table
        html += '<div class="portfolio-benefits-table-wrapper">' +
            '<table class="portfolio-benefits-table">' +
            '<thead>' +
            '<tr>' +
            '<th onclick="sortPortfolioBenefits(\'project\')">Project <span class="sort-indicator"></span></th>' +
            '<th onclick="sortPortfolioBenefits(\'type\')">Type <span class="sort-indicator"></span></th>' +
            '<th onclick="sortPortfolioBenefits(\'title\')">Title <span class="sort-indicator"></span></th>' +
            '<th onclick="sortPortfolioBenefits(\'score\')">Score <span class="sort-indicator"></span></th>' +
            '<th onclick="sortPortfolioBenefits(\'targetValue\')">Target Value <span class="sort-indicator"></span></th>' +
            '<th onclick="sortPortfolioBenefits(\'currentValue\')">Current Value <span class="sort-indicator"></span></th>' +
            '<th onclick="sortPortfolioBenefits(\'status\')">Status <span class="sort-indicator"></span></th>' +
            '</tr>' +
            '</thead>' +
            '<tbody id="portfolioBenefitsTableBody">';

        html += buildBenefitsTableRows(allItems);

        html += '</tbody></table></div>';

        // Consistency section
        html += buildBenefitsConsistencySection(allItems, projectNames);

        container.innerHTML = html;

        window.portfolioBenefitsData = allItems;

    } catch (error) {
        console.error('Error rendering portfolio benefits:', error);
        container.innerHTML = '<div class="portfolio-empty-state">' +
            '<h3>Error Loading Benefits</h3>' +
            '<p>Failed to load benefits data. Please try again.</p>' +
            '</div>';
    }
}

/**
 * Build table row HTML for benefits items
 */
function buildBenefitsTableRows(items) {
    const typeColours = {
        enabler: '#EAB308',
        change: '#6B7280',
        benefit: '#3B82F6',
        disbenefit: '#EF4444',
        objective: '#22C55E'
    };

    let html = '';
    items.forEach(item => {
        const typeLabel = item.type.charAt(0).toUpperCase() + item.type.slice(1);
        const colour = typeColours[item.type] || '#6B7280';
        const statusLabel = item.status ? (item.status.charAt(0).toUpperCase() + item.status.slice(1)) : '-';
        const scoreDisplay = item.score > 0 ? benFormatScorePortfolio(item.score) : '-';

        html += '<tr class="benefits-row" ' +
            'data-project="' + escapeHtml(item.projectName) + '" ' +
            'data-type="' + item.type + '">' +
            '<td class="benefits-project-name">' + escapeHtml(item.projectName) + '</td>' +
            '<td><span class="benefit-type-badge" style="background: ' + colour + '; color: ' +
            (item.type === 'enabler' || item.type === 'change' ? '#1A1A1A' : '#FFFFFF') +
            '">' + escapeHtml(typeLabel) + '</span></td>' +
            '<td class="benefits-title">' + escapeHtml(item.title) + '</td>' +
            '<td class="benefits-numeric">' + scoreDisplay + '</td>' +
            '<td>' + escapeHtml(item.targetValue || '-') + '</td>' +
            '<td>' + escapeHtml(item.currentValue || '-') + '</td>' +
            '<td><span class="status-badge status-' + (item.status || 'none').toLowerCase() + '">' + escapeHtml(statusLabel) + '</span></td>' +
            '</tr>';
    });
    return html;
}

/**
 * Format a numeric score with abbreviations for portfolio view.
 */
function benFormatScorePortfolio(score) {
    if (score >= 1000000) return (score / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (score >= 1000) return (score / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(score);
}

/**
 * Build the consistency analysis section.
 * Highlights benefit titles that appear in some but not all projects.
 */
function buildBenefitsConsistencySection(allItems, projectNames) {
    if (projectNames.length < 2) return '';

    // Only look at benefits and objectives for consistency
    const relevantItems = allItems.filter(i => i.type === 'benefit' || i.type === 'objective');
    if (relevantItems.length === 0) return '';

    // Map title -> set of project names
    const titleProjects = {};
    relevantItems.forEach(item => {
        const key = item.title.toLowerCase().trim();
        if (!key || key === '-') return;
        if (!titleProjects[key]) {
            titleProjects[key] = { title: item.title, projects: new Set(), type: item.type };
        }
        titleProjects[key].projects.add(item.projectName);
    });

    // Find titles present in some but not all projects
    const inconsistencies = [];
    Object.values(titleProjects).forEach(entry => {
        if (entry.projects.size > 0 && entry.projects.size < projectNames.length) {
            const missing = projectNames.filter(p => !entry.projects.has(p));
            if (missing.length > 0) {
                inconsistencies.push({
                    title: entry.title,
                    type: entry.type,
                    presentIn: [...entry.projects].sort(),
                    missingFrom: missing.sort()
                });
            }
        }
    });

    if (inconsistencies.length === 0) {
        return '<div class="portfolio-benefits-consistency">' +
            '<h3>Cross-Project Consistency</h3>' +
            '<p class="consistency-ok">All benefit and objective titles are consistent across projects.</p>' +
            '</div>';
    }

    let html = '<div class="portfolio-benefits-consistency">' +
        '<h3>Cross-Project Consistency</h3>' +
        '<p>The following benefits/objectives appear in some projects but not others:</p>' +
        '<table class="portfolio-benefits-table">' +
        '<thead><tr>' +
        '<th>Title</th>' +
        '<th>Type</th>' +
        '<th>Present In</th>' +
        '<th>Missing From</th>' +
        '</tr></thead><tbody>';

    inconsistencies.forEach(item => {
        const typeLabel = item.type.charAt(0).toUpperCase() + item.type.slice(1);
        html += '<tr>' +
            '<td>' + escapeHtml(item.title) + '</td>' +
            '<td>' + escapeHtml(typeLabel) + '</td>' +
            '<td>' + item.presentIn.map(escapeHtml).join(', ') + '</td>' +
            '<td class="consistency-missing">' + item.missingFrom.map(escapeHtml).join(', ') + '</td>' +
            '</tr>';
    });

    html += '</tbody></table></div>';
    return html;
}

/**
 * Filter benefits table by type and project name
 */
function filterPortfolioBenefits() {
    const typeFilter = document.getElementById('portfolioBenefitsTypeFilter')?.value || 'all';
    const projectFilter = document.getElementById('portfolioBenefitsProjectFilter')?.value || 'all';
    const rows = document.querySelectorAll('.benefits-row');

    rows.forEach(row => {
        const matchType = (typeFilter === 'all' || row.dataset.type === typeFilter);
        const matchProject = (projectFilter === 'all' || row.dataset.project === projectFilter);

        row.style.display = (matchType && matchProject) ? '' : 'none';
    });
}

/**
 * Sort portfolio benefits table
 */
let portfolioBenefitsSortColumn = 'project';
let portfolioBenefitsSortAsc = true;

function sortPortfolioBenefits(column) {
    if (portfolioBenefitsSortColumn === column) {
        portfolioBenefitsSortAsc = !portfolioBenefitsSortAsc;
    } else {
        portfolioBenefitsSortColumn = column;
        portfolioBenefitsSortAsc = (column !== 'score');
    }

    if (!window.portfolioBenefitsData) return;

    const data = [...window.portfolioBenefitsData];

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
            case 'score':
                valA = a.score;
                valB = b.score;
                break;
            case 'targetValue':
                valA = a.targetValue.toLowerCase();
                valB = b.targetValue.toLowerCase();
                break;
            case 'currentValue':
                valA = a.currentValue.toLowerCase();
                valB = b.currentValue.toLowerCase();
                break;
            case 'status':
                valA = (a.status || '').toLowerCase();
                valB = (b.status || '').toLowerCase();
                break;
            default:
                return 0;
        }

        if (valA < valB) return portfolioBenefitsSortAsc ? -1 : 1;
        if (valA > valB) return portfolioBenefitsSortAsc ? 1 : -1;
        return 0;
    });

    window.portfolioBenefitsData = data;

    const tbody = document.getElementById('portfolioBenefitsTableBody');
    if (!tbody) return;

    tbody.innerHTML = buildBenefitsTableRows(data);
    filterPortfolioBenefits();
}
