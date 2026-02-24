/**
 * Portfolio Projects Table View
 * Displays projects in a sortable table with key information at a glance
 */

/**
 * Parse frontmatter from plan text
 */
function parseFrontmatter(planText) {
    if (!planText) return {};

    const frontMatter = {};
    const lines = planText.split('\n');
    let inFrontMatter = false;
    let currentKey = null;
    let currentValue = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (line.trim() === '---') {
            if (!inFrontMatter) {
                inFrontMatter = true;
                continue;
            } else {
                // End of frontmatter
                if (currentKey) {
                    frontMatter[currentKey] = currentValue.join('\n').trim();
                }
                break;
            }
        }

        if (inFrontMatter) {
            // Check for key: value format
            const keyValueMatch = line.match(/^([^:]+):\s*(.*)$/);
            if (keyValueMatch && !line.startsWith(' ') && !line.startsWith('-')) {
                // Save previous key if exists
                if (currentKey) {
                    frontMatter[currentKey] = currentValue.join('\n').trim();
                }
                currentKey = keyValueMatch[1].trim().toLowerCase();
                currentValue = [keyValueMatch[2].trim()];
            } else if (currentKey) {
                // Continuation of previous value
                currentValue.push(line);
            }
        }
    }

    return frontMatter;
}

/**
 * Extract project manager from frontmatter or resources
 */
function extractProjectManager(planText) {
    const frontMatter = parseFrontmatter(planText);

    // Check various possible keys
    const managerKeys = ['project manager', 'manager', 'owner', 'pm'];
    for (const key of managerKeys) {
        if (frontMatter[key]) {
            return frontMatter[key].split('\n')[0].trim();
        }
    }

    // Try to extract from resources if function exists
    if (typeof parseResourceDetails === 'function') {
        const resourceDetails = parseResourceDetails(planText);
        const pmResource = resourceDetails['pm'];
        if (pmResource && pmResource.name) {
            return pmResource.name;
        }
    }

    return '-';
}

/**
 * Extract project dates from plan text
 */
function extractProjectDates(planText) {
    if (!planText) return { startDate: null, finishDate: null };

    const lines = planText.split('\n');
    let minDate = null;
    let maxDate = null;

    // Skip frontmatter
    let inFrontMatter = false;
    let frontMatterEnded = false;

    for (const line of lines) {
        if (line.trim() === '---') {
            if (!inFrontMatter) {
                inFrontMatter = true;
                continue;
            } else {
                frontMatterEnded = true;
                continue;
            }
        }

        if (inFrontMatter && !frontMatterEnded) continue;

        // Look for date patterns (YYYY-MM-DD)
        const dateMatches = line.match(/\d{4}-\d{2}-\d{2}/g);
        if (dateMatches) {
            for (const dateStr of dateMatches) {
                const date = new Date(dateStr);
                if (!isNaN(date)) {
                    if (!minDate || date < minDate) {
                        minDate = date;
                    }
                    if (!maxDate || date > maxDate) {
                        maxDate = date;
                    }
                }
            }
        }
    }

    return {
        startDate: minDate,
        finishDate: maxDate
    };
}

/**
 * Extract status from frontmatter
 */
function extractProjectStatus(planText) {
    const frontMatter = parseFrontmatter(planText);

    // Check for status field
    if (frontMatter['status']) {
        return frontMatter['status'].split('\n')[0].trim();
    }

    // Check for RAG status
    if (frontMatter['rag']) {
        const rag = frontMatter['rag'].toLowerCase();
        if (rag.includes('red')) return 'Red';
        if (rag.includes('amber') || rag.includes('yellow')) return 'Amber';
        if (rag.includes('green')) return 'Green';
    }

    return 'Active';
}

/**
 * Get latest highlight from plan text
 */
function getLatestHighlight(planText) {
    if (!planText) return null;

    // Check if extractHighlightsFromText function exists
    if (typeof extractHighlightsFromText !== 'function') {
        return null;
    }

    const highlights = extractHighlightsFromText(planText);
    if (!highlights || highlights.length === 0) return null;

    // Sort by date descending and get the first one
    highlights.sort((a, b) => {
        const dateA = new Date(a.date);
        const dateB = new Date(b.date);
        return dateB - dateA;
    });

    const latest = highlights[0];

    // Extract first line or first 100 chars of content
    let preview = latest.content.trim();
    const firstLine = preview.split('\n')[0];
    preview = firstLine.length > 100 ? firstLine.substring(0, 100) + '...' : firstLine;

    return {
        date: latest.date,
        author: latest.author,
        preview: preview
    };
}

/**
 * Get status badge color
 */
function getStatusBadgeClass(status) {
    const statusLower = status.toLowerCase();

    if (statusLower === 'complete' || statusLower === 'completed' || statusLower === 'green') {
        return 'status-badge-green';
    } else if (statusLower === 'amber' || statusLower === 'yellow' || statusLower === 'at risk') {
        return 'status-badge-amber';
    } else if (statusLower === 'red' || statusLower === 'critical') {
        return 'status-badge-red';
    } else if (statusLower === 'on hold' || statusLower === 'paused') {
        return 'status-badge-gray';
    }

    return 'status-badge-blue';
}

/**
 * Format date for display
 */
function formatDateForTable(date) {
    if (!date) return '-';

    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d)) return '-';

    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
}

/**
 * Render projects table
 */
function renderProjectsTable() {
    const container = document.getElementById('portfolioProjectsList');
    if (!container) return;

    // Check if required functions exist
    if (typeof loadAllProjectsIntoCache !== 'function') {
        console.error('loadAllProjectsIntoCache function not found');
        return;
    }

    if (typeof getCurrentProjectId !== 'function') {
        console.error('getCurrentProjectId function not found');
        return;
    }

    const projects = loadAllProjectsIntoCache();
    const currentProjectId = getCurrentProjectId();

    if (projects.length === 0) {
        container.innerHTML = '<div class="portfolio-empty-state">' +
            '<h3>No Projects Yet</h3>' +
            '<p>Create your first project to get started.</p>' +
            '<button class="btn-primary" onclick="showCreateProjectDialog()">+ Create Project</button>' +
            '</div>';
        return;
    }

    // Extract all data for table
    const tableData = projects.map(project => {
        const planText = project.planText || '';
        const manager = extractProjectManager(planText);
        const status = extractProjectStatus(planText);
        const dates = extractProjectDates(planText);
        const highlight = getLatestHighlight(planText);

        return {
            id: project.id,
            name: project.name,
            manager: manager,
            status: status,
            startDate: dates.startDate,
            finishDate: dates.finishDate,
            highlight: highlight,
            isActive: project.id === currentProjectId,
            planText: planText
        };
    });

    // Sort by project name by default
    tableData.sort((a, b) => a.name.localeCompare(b.name));

    let html = '<div class="portfolio-table-container">';
    html += '<table class="portfolio-projects-table">';
    html += '<thead>';
    html += '<tr>';
    html += '<th class="sortable" onclick="sortProjectsTable(\'name\')">Project Name</th>';
    html += '<th class="sortable" onclick="sortProjectsTable(\'manager\')">Project Manager</th>';
    html += '<th class="sortable" onclick="sortProjectsTable(\'status\')">Status</th>';
    html += '<th class="sortable" onclick="sortProjectsTable(\'startDate\')">Start Date</th>';
    html += '<th class="sortable" onclick="sortProjectsTable(\'finishDate\')">Finish Date</th>';
    html += '<th>Latest Highlight</th>';
    html += '<th style="text-align: center;">Actions</th>';
    html += '</tr>';
    html += '</thead>';
    html += '<tbody>';

    tableData.forEach(project => {
        const rowClass = project.isActive ? 'active-project-row' : '';
        const statusBadge = getStatusBadgeClass(project.status);

        let highlightText = '-';
        if (project.highlight) {
            highlightText = `<div class="highlight-preview">` +
                `<span class="highlight-date">${project.highlight.date}</span> ` +
                `<span class="highlight-author">@${project.highlight.author}</span>: ` +
                `${escapeHtml(project.highlight.preview)}` +
                `</div>`;
        }

        html += `<tr class="project-table-row ${rowClass}" onclick="openProjectFromTable('${project.id}')">`;
        html += `<td class="project-name-cell" ondblclick="event.stopPropagation(); startInlineRename('${project.id}', this)">`;
        if (project.isActive) {
            html += `<span class="active-indicator">●</span> `;
        }
        html += `<span class="project-name-editable">${escapeHtml(project.name)}</span></td>`;
        html += `<td>${escapeHtml(project.manager)}</td>`;
        html += `<td><span class="status-badge ${statusBadge}">${escapeHtml(project.status)}</span></td>`;
        html += `<td>${formatDateForTable(project.startDate)}</td>`;
        html += `<td>${formatDateForTable(project.finishDate)}</td>`;
        html += `<td class="highlight-cell">${highlightText}</td>`;
        html += `<td class="project-actions-cell" style="text-align: center; white-space: nowrap;">`;
        html += `<button class="project-action-btn project-action-save" onclick="event.stopPropagation(); exportProject('${project.id}')" title="Download project">` +
            `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
            `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>` +
            `</svg></button>`;
        html += `<button class="project-action-btn project-action-delete" onclick="event.stopPropagation(); confirmDeleteProjectFromTable('${project.id}', '${escapeHtml(project.name).replace(/'/g, "\\'")}')" title="Delete project">` +
            `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
            `<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>` +
            `</svg></button>`;
        html += `</td>`;
        html += '</tr>';
    });

    html += '</tbody>';
    html += '</table>';
    html += '</div>';

    container.innerHTML = html;

    // Store table data for sorting
    window.portfolioTableData = tableData;
    window.portfolioTableSortColumn = 'name';
    window.portfolioTableSortDirection = 'asc';
}

/**
 * Sort projects table by column
 */
function sortProjectsTable(column) {
    if (!window.portfolioTableData) return;

    const tableData = window.portfolioTableData;
    const currentColumn = window.portfolioTableSortColumn || 'name';
    const currentDirection = window.portfolioTableSortDirection || 'asc';

    // Toggle direction if same column
    let direction = 'asc';
    if (column === currentColumn) {
        direction = currentDirection === 'asc' ? 'desc' : 'asc';
    }

    // Sort the data
    tableData.sort((a, b) => {
        let valA, valB;

        if (column === 'startDate' || column === 'finishDate') {
            valA = a[column] ? a[column].getTime() : 0;
            valB = b[column] ? b[column].getTime() : 0;
        } else {
            valA = a[column] || '';
            valB = b[column] || '';

            if (typeof valA === 'string') {
                valA = valA.toLowerCase();
                valB = valB.toLowerCase();
            }
        }

        if (valA < valB) return direction === 'asc' ? -1 : 1;
        if (valA > valB) return direction === 'asc' ? 1 : -1;
        return 0;
    });

    window.portfolioTableSortColumn = column;
    window.portfolioTableSortDirection = direction;

    // Re-render table with sorted data
    renderSortedTable(tableData);
}

/**
 * Re-render table with pre-sorted data
 */
function renderSortedTable(tableData) {
    const container = document.getElementById('portfolioProjectsList');
    if (!container) return;

    const currentProjectId = getCurrentProjectId();

    let html = '<div class="portfolio-table-container">';
    html += '<table class="portfolio-projects-table">';
    html += '<thead>';
    html += '<tr>';

    const columns = [
        { key: 'name', label: 'Project Name' },
        { key: 'manager', label: 'Project Manager' },
        { key: 'status', label: 'Status' },
        { key: 'startDate', label: 'Start Date' },
        { key: 'finishDate', label: 'Finish Date' },
        { key: 'highlight', label: 'Latest Highlight' }
    ];

    columns.forEach(col => {
        if (col.key === 'highlight') {
            html += `<th>${col.label}</th>`;
        } else {
            const sortIndicator = window.portfolioTableSortColumn === col.key
                ? (window.portfolioTableSortDirection === 'asc' ? ' ▲' : ' ▼')
                : '';
            html += `<th class="sortable" onclick="sortProjectsTable('${col.key}')">${col.label}${sortIndicator}</th>`;
        }
    });

    html += '<th style="text-align: center;">Actions</th>';
    html += '</tr>';
    html += '</thead>';
    html += '<tbody>';

    tableData.forEach(project => {
        const rowClass = project.isActive ? 'active-project-row' : '';
        const statusBadge = getStatusBadgeClass(project.status);

        let highlightText = '-';
        if (project.highlight) {
            highlightText = `<div class="highlight-preview">` +
                `<span class="highlight-date">${project.highlight.date}</span> ` +
                `<span class="highlight-author">@${project.highlight.author}</span>: ` +
                `${escapeHtml(project.highlight.preview)}` +
                `</div>`;
        }

        html += `<tr class="project-table-row ${rowClass}" onclick="openProjectFromTable('${project.id}')">`;
        html += `<td class="project-name-cell" ondblclick="event.stopPropagation(); startInlineRename('${project.id}', this)">`;
        if (project.isActive) {
            html += `<span class="active-indicator">●</span> `;
        }
        html += `<span class="project-name-editable">${escapeHtml(project.name)}</span></td>`;
        html += `<td>${escapeHtml(project.manager)}</td>`;
        html += `<td><span class="status-badge ${statusBadge}">${escapeHtml(project.status)}</span></td>`;
        html += `<td>${formatDateForTable(project.startDate)}</td>`;
        html += `<td>${formatDateForTable(project.finishDate)}</td>`;
        html += `<td class="highlight-cell">${highlightText}</td>`;
        html += `<td class="project-actions-cell" style="text-align: center; white-space: nowrap;">`;
        html += `<button class="project-action-btn project-action-save" onclick="event.stopPropagation(); exportProject('${project.id}')" title="Download project">` +
            `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
            `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>` +
            `</svg></button>`;
        html += `<button class="project-action-btn project-action-delete" onclick="event.stopPropagation(); confirmDeleteProjectFromTable('${project.id}', '${escapeHtml(project.name).replace(/'/g, "\\'")}')" title="Delete project">` +
            `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
            `<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>` +
            `</svg></button>`;
        html += `</td>`;
        html += '</tr>';
    });

    html += '</tbody>';
    html += '</table>';
    html += '</div>';

    container.innerHTML = html;
}

/**
 * Open project from table row and show its dashboard
 */
function openProjectFromTable(projectId) {
    if (typeof openProjectDashboard === 'function') {
        openProjectDashboard(projectId);
    } else if (typeof switchToProject === 'function') {
        switchToProject(projectId);
    }
}

/**
 * Delete a project from the table with confirmation dialog
 */
function confirmDeleteProjectFromTable(projectId, projectName) {
    if (!confirm('Are you sure you want to delete "' + projectName + '"?\n\nThis cannot be undone.')) {
        return;
    }

    if (typeof deleteProject === 'function') {
        deleteProject(projectId);
    }

    // Refresh the table
    if (typeof renderProjectsTable === 'function') {
        renderProjectsTable();
    }

    // Refresh project selectors
    if (typeof refreshProjectSelectors === 'function') {
        refreshProjectSelectors();
    }
}

/**
 * Start inline rename of a project name in the portfolio table.
 * Replaces the name text with an input field on double-click.
 */
function startInlineRename(projectId, cellElement) {
    // Prevent opening the input twice
    if (cellElement.querySelector('.project-name-input')) return;

    const nameSpan = cellElement.querySelector('.project-name-editable');
    if (!nameSpan) return;

    const currentName = nameSpan.textContent;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'project-name-input';
    input.value = currentName;

    // Replace the span with the input
    nameSpan.style.display = 'none';
    cellElement.appendChild(input);
    input.focus();
    input.select();

    let committed = false;

    function commit() {
        if (committed) return;
        committed = true;

        const newName = input.value.trim();
        if (newName && newName !== currentName) {
            if (typeof renameProject === 'function') {
                renameProject(projectId, newName);
            }
            if (typeof refreshProjectSelectors === 'function') {
                refreshProjectSelectors();
            }
            // Re-render the table to reflect the change
            renderProjectsTable();
        } else {
            // Restore original display
            nameSpan.style.display = '';
            input.remove();
        }
    }

    function cancel() {
        if (committed) return;
        committed = true;
        nameSpan.style.display = '';
        input.remove();
    }

    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            commit();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            cancel();
        }
    });

    input.addEventListener('blur', function() {
        commit();
    });

    // Prevent the row click from firing while editing
    input.addEventListener('click', function(e) {
        e.stopPropagation();
    });
}

/**
 * Escape HTML for safe rendering
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
