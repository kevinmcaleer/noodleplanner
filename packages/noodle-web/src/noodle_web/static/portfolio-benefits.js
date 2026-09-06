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
            const rawLinkedTo = item.linked_to || item.linkedTo || [];
            const linkedTo = (Array.isArray(rawLinkedTo) ? rawLinkedTo : [])
                .map(n => parseInt(n, 10)).filter(n => !isNaN(n));

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
                linkedTo: linkedTo,
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

        // Portfolio Benefits Map diagram (above consistency)
        html += buildPortfolioBenefitsMapSection();

        // Consistency section
        html += buildBenefitsConsistencySection(allItems, projectNames);

        container.innerHTML = html;

        window.portfolioBenefitsData = allItems;

        // Render the SVG diagram now that the container is in the DOM
        renderPortfolioBenefitsMap(allItems, parsedProjects);

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

// ═══════════════════════════════════════════════════════════════════════
// Portfolio Benefits Map — Combined SVG diagram
// ═══════════════════════════════════════════════════════════════════════

// Layout constants (matching project-level benefits.js)
const PBM_COL_GAP = 280;
const PBM_ROW_GAP = 24;
const PBM_NODE_WIDTH = 200;
const PBM_NODE_HEIGHT = 70;   // slightly taller to fit project label
const PBM_PADDING_X = 60;
const PBM_PADDING_Y = 60;
const PBM_ANIM_DURATION = 350;

const PBM_COLUMNS = { enabler: 0, change: 1, benefit: 2, disbenefit: 2, objective: 3 };
const PBM_COL_LABELS = ['Enablers', 'Business Changes', 'Benefits / Disbenefits', 'Objectives'];
const PBM_COLOURS = {
    benefit:    { fill: '#3B82F6', text: '#FFFFFF' },
    enabler:    { fill: '#EAB308', text: '#1A1A1A' },
    change:     { fill: '#F3F4F6', text: '#1A1A1A' },
    disbenefit: { fill: '#EF4444', text: '#FFFFFF' },
    objective:  { fill: '#22C55E', text: '#FFFFFF' }
};

// Canvas state for the portfolio map
let pbmSvg = null;
let pbmGroup = null;
let pbmZoom = 1;
let pbmPanX = 0;
let pbmPanY = 0;
let pbmIsDragging = false;
let pbmDragStartX = 0;
let pbmDragStartY = 0;
let pbmDragStartPanX = 0;
let pbmDragStartPanY = 0;

/**
 * Build the HTML skeleton for the portfolio benefits map section.
 */
function buildPortfolioBenefitsMapSection() {
    return '<div class="portfolio-benefits-map-section">' +
        '<h3>Portfolio Benefits Map</h3>' +
        '<div class="portfolio-benefits-map-container" id="portfolioBenefitsMapContainer">' +
        '<svg id="portfolioBenefitsMapSvg" class="portfolio-benefits-map-svg">' +
        '<rect class="pbm-background" width="100%" height="100%" fill="transparent"/>' +
        '<g id="portfolioBenefitsMapGroup"></g>' +
        '</svg>' +
        '</div>' +
        '</div>';
}

/**
 * Create an SVG element in the SVG namespace.
 */
function pbmSvgEl(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, val] of Object.entries(attrs || {})) {
        el.setAttribute(key, val);
    }
    return el;
}

/**
 * Merge benefit items from all projects. Items with the same title and type
 * are merged into a single node, combining project names and linkedTo arrays.
 * Returns an array of merged items each with a `projects` array.
 */
function pbmMergeItems(allItems) {
    // We need to re-assign unique IDs for the merged set.
    // First, group items by (lowercase title + type) for merging.
    const mergeMap = {};  // key -> { mergedItem }
    // Also keep a mapping from (projectId, originalId) -> mergedId
    const idRemap = {};

    let nextId = 1;

    for (const item of allItems) {
        const key = item.title.toLowerCase().trim() + '|||' + item.type;

        if (mergeMap[key]) {
            // Merge: add project name
            const existing = mergeMap[key];
            if (!existing.projects.includes(item.projectName)) {
                existing.projects.push(item.projectName);
            }
            // Map old ID to merged ID
            idRemap[item.projectId + ':' + item.id] = existing.id;
            // Collect original linkedTo for later remapping
            existing._rawLinkedTo.push(
                ...item.linkedTo.map(lid => item.projectId + ':' + lid)
            );
        } else {
            const mergedId = nextId++;
            const merged = {
                id: mergedId,
                type: item.type,
                title: item.title,
                projects: [item.projectName],
                linkedTo: [],
                _rawLinkedTo: item.linkedTo.map(lid => item.projectId + ':' + lid),
                score: 0
            };
            mergeMap[key] = merged;
            idRemap[item.projectId + ':' + item.id] = mergedId;
        }
    }

    // Resolve linkedTo references using the idRemap
    const merged = Object.values(mergeMap);
    for (const m of merged) {
        const resolvedSet = new Set();
        for (const rawRef of m._rawLinkedTo) {
            const resolvedId = idRemap[rawRef];
            if (resolvedId !== undefined && resolvedId !== m.id) {
                resolvedSet.add(resolvedId);
            }
        }
        m.linkedTo = [...resolvedSet];
        delete m._rawLinkedTo;
    }

    return merged;
}

/**
 * Compute layout for the portfolio benefits map.
 * Closely follows benComputeLayout from benefits.js but uses PBM constants.
 */
function pbmComputeLayout(items) {
    const itemById = {};
    for (const item of items) {
        itemById[item.id] = item;
    }

    // Build reverse links
    const reverseLinks = {};
    for (const item of items) {
        for (const targetId of item.linkedTo) {
            if (!reverseLinks[targetId]) reverseLinks[targetId] = [];
            reverseLinks[targetId].push(item);
        }
    }

    // Compute sub-column depth for same-type chains
    const sameTypeDepth = {};
    for (const item of items) sameTypeDepth[item.id] = 0;

    let changed = true;
    while (changed) {
        changed = false;
        for (const item of items) {
            for (const tid of item.linkedTo) {
                const target = itemById[tid];
                if (!target) continue;
                if (PBM_COLUMNS[item.type] === PBM_COLUMNS[target.type]) {
                    const needed = sameTypeDepth[tid] + 1;
                    if (sameTypeDepth[item.id] < needed) {
                        sameTypeDepth[item.id] = needed;
                        changed = true;
                    }
                }
            }
        }
    }

    // Group by base column, then sub-column depth
    const subColumns = [{}, {}, {}, {}];
    for (const item of items) {
        const col = PBM_COLUMNS[item.type] !== undefined ? PBM_COLUMNS[item.type] : 2;
        const depth = sameTypeDepth[item.id];
        if (!subColumns[col][depth]) subColumns[col][depth] = [];
        subColumns[col][depth].push(item);
    }

    // Flatten into ordered columns
    const columns = [];
    const colBaseIndex = [];
    for (let base = 0; base < 4; base++) {
        const depths = Object.keys(subColumns[base]).map(Number).sort((a, b) => a - b);
        if (depths.length === 0) {
            columns.push([]);
            colBaseIndex.push(base);
        } else {
            for (const d of depths) {
                columns.push(subColumns[base][d]);
                colBaseIndex.push(base);
            }
        }
    }

    const nodeStep = PBM_NODE_HEIGHT + PBM_ROW_GAP;
    const numCols = columns.length;
    const yPos = {};

    // Phase 1: Position rightmost column evenly
    const lastCol = columns[numCols - 1];
    lastCol.forEach((item, idx) => {
        yPos[item.id] = PBM_PADDING_Y + idx * nodeStep;
    });

    // Phase 2: Position right-to-left based on connections
    for (let col = numCols - 2; col >= 0; col--) {
        const linked = [];
        const unlinked = [];

        for (const item of columns[col]) {
            const connectedYs = [];
            for (const tid of item.linkedTo) {
                if (itemById[tid] && yPos[tid] !== undefined) connectedYs.push(yPos[tid]);
            }
            const sources = reverseLinks[item.id] || [];
            for (const src of sources) {
                if (yPos[src.id] !== undefined) connectedYs.push(yPos[src.id]);
            }
            if (connectedYs.length > 0) {
                const avgY = connectedYs.reduce((a, b) => a + b, 0) / connectedYs.length;
                linked.push({ item, desiredY: avgY });
            } else {
                unlinked.push(item);
            }
        }

        linked.sort((a, b) => a.desiredY - b.desiredY);
        for (const entry of linked) yPos[entry.item.id] = entry.desiredY;

        let maxY = -Infinity;
        for (const entry of linked) {
            if (yPos[entry.item.id] > maxY) maxY = yPos[entry.item.id];
        }
        const startY = maxY === -Infinity ? PBM_PADDING_Y : maxY + nodeStep;
        unlinked.forEach((item, idx) => { yPos[item.id] = startY + idx * nodeStep; });

        // Collision avoidance
        const allInCol = [...linked.map(e => e.item), ...unlinked];
        allInCol.sort((a, b) => yPos[a.id] - yPos[b.id]);
        for (let i = 1; i < allInCol.length; i++) {
            const minY = yPos[allInCol[i - 1].id] + nodeStep;
            if (yPos[allInCol[i].id] < minY) yPos[allInCol[i].id] = minY;
        }
    }

    // Phase 3: Pull items towards sources
    for (let col = numCols - 1; col >= 1; col--) {
        const colItems = columns[col].slice().sort((a, b) => yPos[a.id] - yPos[b.id]);
        for (const item of colItems) {
            const sources = reverseLinks[item.id];
            if (!sources || sources.length === 0) continue;
            const sourceYs = sources.filter(s => yPos[s.id] !== undefined).map(s => yPos[s.id]);
            if (sourceYs.length === 0) continue;
            const avg = sourceYs.reduce((a, b) => a + b, 0) / sourceYs.length;
            yPos[item.id] = yPos[item.id] * 0.6 + avg * 0.4;
        }
        colItems.sort((a, b) => yPos[a.id] - yPos[b.id]);
        for (let i = 1; i < colItems.length; i++) {
            const minY = yPos[colItems[i - 1].id] + nodeStep;
            if (yPos[colItems[i].id] < minY) yPos[colItems[i].id] = minY;
        }
    }

    // Phase 4: Align objectives with enablers
    for (let col = 0; col < numCols; col++) {
        if (colBaseIndex[col] !== 3) continue;
        for (const obj of columns[col]) {
            const visited = new Set();
            const queue = [obj.id];
            const enablerYs = [];
            while (queue.length > 0) {
                const curId = queue.shift();
                if (visited.has(curId)) continue;
                visited.add(curId);
                const cur = itemById[curId];
                if (!cur) continue;
                if (PBM_COLUMNS[cur.type] === 0 && yPos[cur.id] !== undefined) {
                    enablerYs.push(yPos[cur.id]);
                }
                const sources = reverseLinks[curId] || [];
                for (const src of sources) {
                    if (!visited.has(src.id)) queue.push(src.id);
                }
                for (const tid of cur.linkedTo) {
                    if (!visited.has(tid)) queue.push(tid);
                }
            }
            if (enablerYs.length > 0) {
                yPos[obj.id] = enablerYs.reduce((a, b) => a + b, 0) / enablerYs.length;
            }
        }
    }

    // Re-apply collision avoidance on objective columns
    for (let col = 0; col < numCols; col++) {
        if (colBaseIndex[col] !== 3) continue;
        const colItems = columns[col].slice().sort((a, b) => yPos[a.id] - yPos[b.id]);
        for (let i = 1; i < colItems.length; i++) {
            const minY = yPos[colItems[i - 1].id] + nodeStep;
            if (yPos[colItems[i].id] < minY) yPos[colItems[i].id] = minY;
        }
    }

    // Compute X positions
    const COL_MARGIN = 60;
    const colX = [PBM_PADDING_X];
    for (let col = 1; col < numCols; col++) {
        colX[col] = colX[col - 1] + PBM_NODE_WIDTH + COL_MARGIN;
    }

    // Store label positions
    const baseLabelX = [];
    const baseLabelWidths = [];
    for (let base = 0; base < 4; base++) {
        let minX = Infinity, maxX = -Infinity;
        for (let col = 0; col < numCols; col++) {
            if (colBaseIndex[col] === base && columns[col].length > 0) {
                if (colX[col] < minX) minX = colX[col];
                if (colX[col] + PBM_NODE_WIDTH > maxX) maxX = colX[col] + PBM_NODE_WIDTH;
            }
        }
        if (minX === Infinity) {
            const prevEnd = baseLabelX.length > 0
                ? baseLabelX[baseLabelX.length - 1] + baseLabelWidths[baseLabelWidths.length - 1] + COL_MARGIN
                : PBM_PADDING_X;
            baseLabelX.push(prevEnd);
            baseLabelWidths.push(PBM_NODE_WIDTH);
        } else {
            baseLabelX.push(minX);
            baseLabelWidths.push(maxX - minX);
        }
    }

    const layout = [];
    for (let col = 0; col < numCols; col++) {
        for (const item of columns[col]) {
            layout.push({ item, x: colX[col], y: yPos[item.id], col });
        }
    }

    return { layout, baseLabelX, baseLabelWidths };
}

/**
 * Render a single node for the portfolio map.
 * Similar to benRenderNode but read-only and includes project label.
 */
function pbmRenderNode(item, x, y) {
    const g = pbmSvgEl('g', {
        'class': 'pbm-node pbm-node--' + item.type
    });

    const colours = PBM_COLOURS[item.type] || PBM_COLOURS.benefit;

    if (item.type === 'enabler') {
        g.appendChild(pbmSvgEl('ellipse', {
            cx: x + PBM_NODE_WIDTH / 2,
            cy: y + PBM_NODE_HEIGHT / 2,
            rx: PBM_NODE_WIDTH / 2,
            ry: PBM_NODE_HEIGHT / 2,
            fill: colours.fill,
            stroke: 'none',
            'stroke-width': '2',
            'class': 'pbm-shape'
        }));
    } else {
        let rx = 0;
        if (item.type === 'benefit' || item.type === 'objective') rx = 16;

        g.appendChild(pbmSvgEl('rect', {
            x: x, y: y,
            width: PBM_NODE_WIDTH,
            height: PBM_NODE_HEIGHT,
            rx: rx, ry: rx,
            fill: colours.fill,
            stroke: 'none',
            'stroke-width': '2',
            'class': 'pbm-shape'
        }));
    }

    // Title text (word-wrapped onto up to 2 lines)
    const maxCharsPerLine = 22;
    const title = item.title || '';
    let line1 = '', line2 = '';

    if (title.length <= maxCharsPerLine) {
        line1 = title;
    } else {
        const words = title.split(' ');
        let current = '';
        for (let w = 0; w < words.length; w++) {
            const test = current ? current + ' ' + words[w] : words[w];
            if (test.length > maxCharsPerLine && current) {
                line1 = current;
                line2 = words.slice(w).join(' ');
                break;
            }
            current = test;
        }
        if (!line1) line1 = current;
        if (line2.length > maxCharsPerLine) {
            line2 = line2.substring(0, maxCharsPerLine - 1) + '\u2026';
        }
    }

    if (line2) {
        const t1 = pbmSvgEl('text', {
            x: x + PBM_NODE_WIDTH / 2, y: y + 22,
            'text-anchor': 'middle', 'font-size': '12', 'font-weight': '500',
            fill: colours.text, 'pointer-events': 'none'
        });
        t1.textContent = line1;
        g.appendChild(t1);

        const t2 = pbmSvgEl('text', {
            x: x + PBM_NODE_WIDTH / 2, y: y + 36,
            'text-anchor': 'middle', 'font-size': '12', 'font-weight': '500',
            fill: colours.text, 'pointer-events': 'none'
        });
        t2.textContent = line2;
        g.appendChild(t2);
    } else {
        const t = pbmSvgEl('text', {
            x: x + PBM_NODE_WIDTH / 2, y: y + 30,
            'text-anchor': 'middle', 'font-size': '13', 'font-weight': '500',
            fill: colours.text, 'pointer-events': 'none'
        });
        t.textContent = line1;
        g.appendChild(t);
    }

    // Project name label (small, below title)
    const projectLabel = item.projects.join(', ');
    const projText = pbmSvgEl('text', {
        x: x + PBM_NODE_WIDTH / 2,
        y: y + PBM_NODE_HEIGHT - 10,
        'text-anchor': 'middle',
        'font-size': '9',
        'font-weight': '400',
        'font-style': 'italic',
        fill: colours.text,
        opacity: '0.75',
        'pointer-events': 'none'
    });
    // Truncate if too long
    let projDisplay = projectLabel;
    if (projDisplay.length > 28) {
        projDisplay = projDisplay.substring(0, 25) + '\u2026';
    }
    projText.textContent = projDisplay;
    g.appendChild(projText);

    return g;
}

/**
 * Render an S-curve connection between two nodes.
 */
function pbmRenderConnection(fromLayout, toLayout) {
    const sx = fromLayout.x + PBM_NODE_WIDTH;
    const sy = fromLayout.y + PBM_NODE_HEIGHT / 2;
    const tx = toLayout.x;
    const ty = toLayout.y + PBM_NODE_HEIGHT / 2;

    const dx = (tx - sx) * 0.6;
    const d = 'M ' + sx + ' ' + sy + ' C ' + (sx + dx) + ' ' + sy + ', ' +
              (tx - dx) + ' ' + ty + ', ' + tx + ' ' + ty;

    const path = pbmSvgEl('path', {
        d: d,
        fill: 'none',
        stroke: '#999',
        'stroke-width': '1.5',
        'class': 'pbm-connection'
    });

    const arrowSize = 7;
    const arrow = pbmSvgEl('path', {
        d: 'M ' + tx + ' ' + ty + ' L ' + (tx - arrowSize) + ' ' + (ty - arrowSize / 2) +
           ' L ' + (tx - arrowSize) + ' ' + (ty + arrowSize / 2) + ' Z',
        fill: '#999',
        'class': 'pbm-arrow'
    });

    const g = pbmSvgEl('g', { 'class': 'pbm-connection-group' });
    g.appendChild(path);
    g.appendChild(arrow);
    return g;
}

/**
 * Render column header labels for the portfolio map.
 */
function pbmRenderColumnLabels(baseLabelX, baseLabelWidths) {
    const g = pbmSvgEl('g', { 'class': 'pbm-column-labels' });

    for (let col = 0; col < 4; col++) {
        const baseX = baseLabelX[col];
        const width = baseLabelWidths[col];
        const x = baseX + width / 2;
        const label = pbmSvgEl('text', {
            x: x,
            y: PBM_PADDING_Y - 20,
            'text-anchor': 'middle',
            'font-size': '14',
            'font-weight': '600',
            fill: '#666',
            'pointer-events': 'none'
        });
        label.textContent = PBM_COL_LABELS[col];
        g.appendChild(label);
    }

    return g;
}

/**
 * Apply pan/zoom transform to the portfolio map group.
 */
function pbmApplyTransform(animate) {
    if (!pbmGroup) return;
    const transformStr = 'translate(' + pbmPanX + ', ' + pbmPanY + ') scale(' + pbmZoom + ')';

    if (animate) {
        pbmGroup.style.transition = 'transform ' + PBM_ANIM_DURATION + 'ms cubic-bezier(0.34, 1.56, 0.64, 1)';
        pbmGroup.setAttribute('transform', transformStr);
        setTimeout(function() { pbmGroup.style.transition = ''; }, PBM_ANIM_DURATION);
    } else {
        pbmGroup.style.transition = '';
        pbmGroup.setAttribute('transform', transformStr);
    }
}

/**
 * Zoom-to-fit the portfolio benefits map.
 */
function pbmZoomToFit(layoutResult) {
    if (!pbmSvg || !layoutResult || layoutResult.layout.length === 0) return;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const node of layoutResult.layout) {
        if (node.x < minX) minX = node.x;
        if (node.x + PBM_NODE_WIDTH > maxX) maxX = node.x + PBM_NODE_WIDTH;
        if (node.y < minY) minY = node.y;
        if (node.y + PBM_NODE_HEIGHT > maxY) maxY = node.y + PBM_NODE_HEIGHT;
    }

    if (minX === Infinity) return;

    const svgRect = pbmSvg.getBoundingClientRect();
    if (svgRect.width === 0 || svgRect.height === 0) return;

    const padding = 80;
    const contentW = maxX - minX + padding * 2;
    const contentH = maxY - minY + padding * 2;
    const centreX = (minX + maxX) / 2;
    const centreY = (minY + maxY) / 2;

    const scaleX = svgRect.width / contentW;
    const scaleY = svgRect.height / contentH;
    pbmZoom = Math.min(scaleX, scaleY, 2);

    pbmPanX = svgRect.width / 2 - centreX * pbmZoom;
    pbmPanY = svgRect.height / 2 - centreY * pbmZoom;

    pbmApplyTransform(true);
}

/**
 * Set up pan and zoom event handlers on the portfolio map SVG.
 */
function pbmSetupInteraction() {
    if (!pbmSvg) return;
    let activePointerId = null;

    pbmSvg.addEventListener('wheel', function(e) {
        e.preventDefault();
        const delta = e.deltaY;
        if (e.ctrlKey || e.metaKey) {
            pbmZoom = delta < 0
                ? Math.min(3, pbmZoom * 1.08)
                : Math.max(0.1, pbmZoom / 1.08);
        } else {
            pbmPanX -= e.deltaX || 0;
            pbmPanY -= delta;
        }
        pbmApplyTransform(false);
    }, { passive: false });

    pbmSvg.addEventListener('pointerdown', function(e) {
        if (e.button !== 0) return;
        activePointerId = e.pointerId;
        pbmIsDragging = true;
        pbmDragStartX = e.clientX;
        pbmDragStartY = e.clientY;
        pbmDragStartPanX = pbmPanX;
        pbmDragStartPanY = pbmPanY;
        pbmSvg.setPointerCapture(e.pointerId);
        e.preventDefault();
    });

    pbmSvg.addEventListener('pointermove', function(e) {
        if (!pbmIsDragging || e.pointerId !== activePointerId) return;
        pbmPanX = pbmDragStartPanX + (e.clientX - pbmDragStartX);
        pbmPanY = pbmDragStartPanY + (e.clientY - pbmDragStartY);
        pbmApplyTransform(false);
    });

    const endPointer = function(e) {
        if (e.pointerId !== activePointerId) return;
        pbmIsDragging = false;
        if (pbmSvg.hasPointerCapture(activePointerId)) {
            pbmSvg.releasePointerCapture(activePointerId);
        }
        activePointerId = null;
    };
    pbmSvg.addEventListener('pointerup', endPointer);
    pbmSvg.addEventListener('pointercancel', endPointer);
}

/**
 * Render the combined portfolio benefits map into the SVG container.
 */
function renderPortfolioBenefitsMap(allItems, parsedProjects) {
    pbmSvg = document.getElementById('portfolioBenefitsMapSvg');
    pbmGroup = document.getElementById('portfolioBenefitsMapGroup');
    if (!pbmSvg || !pbmGroup) return;

    // Reset state
    pbmZoom = 1;
    pbmPanX = 0;
    pbmPanY = 0;

    // Clear existing content
    while (pbmGroup.firstChild) pbmGroup.removeChild(pbmGroup.firstChild);

    // Collect all items with linkedTo data
    const itemsWithLinks = allItems.filter(i => i.linkedTo && i.linkedTo.length > 0 || true);

    if (itemsWithLinks.length === 0) return;

    // Merge duplicate items across projects
    const mergedItems = pbmMergeItems(itemsWithLinks);

    if (mergedItems.length === 0) return;

    // Compute layout
    const layoutResult = pbmComputeLayout(mergedItems);
    const layout = layoutResult.layout;

    // Build lookup for connections
    const layoutMap = {};
    for (const entry of layout) {
        layoutMap[entry.item.id] = entry;
    }

    // Render column labels
    pbmGroup.appendChild(pbmRenderColumnLabels(layoutResult.baseLabelX, layoutResult.baseLabelWidths));

    // Render connections
    const drawnConnections = new Set();
    for (const entry of layout) {
        for (const targetId of entry.item.linkedTo) {
            if (layoutMap[targetId]) {
                const from = entry;
                const to = layoutMap[targetId];
                const left = from.col <= to.col ? from : to;
                const right = from.col <= to.col ? to : from;
                const key = left.item.id + '->' + right.item.id;
                if (!drawnConnections.has(key)) {
                    drawnConnections.add(key);
                    pbmGroup.appendChild(pbmRenderConnection(left, right));
                }
            }
        }
    }

    // Render nodes
    for (const entry of layout) {
        pbmGroup.appendChild(pbmRenderNode(entry.item, entry.x, entry.y));
    }

    // Set up interaction
    pbmSetupInteraction();

    // Zoom-to-fit after a brief delay for DOM to settle
    requestAnimationFrame(function() {
        pbmZoomToFit(layoutResult);
    });
}
