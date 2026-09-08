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
 * Derive a human-readable programme name from its slug.
 *
 * "digital-transformation" becomes "Digital Transformation".
 */
function programmeNameFromSlug(slug) {
    return slug.replace(/[-_]+/g, ' ').trim().replace(/\w\S*/g, function (word) {
        return word.charAt(0).toUpperCase() + word.substr(1).toLowerCase();
    });
}

/**
 * Extract programme membership from frontmatter.
 *
 * A project belongs to a programme by naming it in a `programme:` slug
 * field -- there is no programme file to point at. Returns {slug, name}
 * or null when the project has no `programme:` field (it is unassigned).
 */
function extractProjectProgramme(planText) {
    const frontMatter = parseFrontmatter(planText);

    const slug = frontMatter['programme'] ? frontMatter['programme'].split('\n')[0].trim() : '';
    if (!slug) return null;

    const rawName = frontMatter['programme_name'] ? frontMatter['programme_name'].split('\n')[0].trim() : '';
    const name = rawName || programmeNameFromSlug(slug);

    return { slug: slug, name: name };
}

/**
 * Group a project list into programmes by their `programme:` slug.
 *
 * Projects with no `programme:` field are excluded -- they are
 * unassigned and have no group. Returns an array of
 * {slug, name, projects} ordered by first appearance.
 */
function deriveProgrammes(projects) {
    const bySlug = {};
    const order = [];

    (projects || []).forEach(project => {
        const programme = extractProjectProgramme(project.planText || '');
        if (!programme) return;

        if (!bySlug[programme.slug]) {
            bySlug[programme.slug] = { slug: programme.slug, name: programme.name, projects: [] };
            order.push(programme.slug);
        }
        bySlug[programme.slug].projects.push(project);
    });

    return order.map(slug => bySlug[slug]);
}

/**
 * Slug generation for programme names (issue #952).
 *
 * No slugify helper existed elsewhere in the codebase (project ids use a
 * timestamp + random suffix, not a slug of the name), so this is a small
 * standard implementation: lowercase, punctuation/spaces to hyphens.
 */
function slugify(name) {
    return (name || '')
        .toLowerCase()
        .trim()
        .replace(/['"]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * Set (replacing or appending) a scalar front-matter field, following the
 * same match-and-splice approach as setVersionInFrontMatter/setRagInFrontMatter
 * in script.js/version-history.js. Creates a front-matter block if none exists.
 */
function setFrontMatterField(text, key, value) {
    const source = text || '';
    const line = key + ': ' + value;
    const fmMatch = source.match(/^(---\n)([\s\S]*?)(\n---)/);
    if (fmMatch) {
        let body = fmMatch[2];
        const re = new RegExp('^' + key + ':.*$', 'm');
        body = re.test(body) ? body.replace(re, line) : body + '\n' + line;
        return fmMatch[1] + body + fmMatch[3] + source.slice(fmMatch[0].length);
    }
    return '---\n' + line + '\n---\n' + source;
}

/**
 * Remove a scalar front-matter field, leaving the rest of the block intact.
 * A no-op front-matter setter counterpart -- see setFrontMatterField above.
 */
function removeFrontMatterField(text, key) {
    const source = text || '';
    const fmMatch = source.match(/^(---\n)([\s\S]*?)(\n---)/);
    if (!fmMatch) return source;

    const re = new RegExp('^' + key + ':');
    const lines = fmMatch[2].split('\n');
    const filtered = lines.filter(line => !re.test(line));
    if (filtered.length === lines.length) return source;

    return fmMatch[1] + filtered.join('\n') + fmMatch[3] + source.slice(fmMatch[0].length);
}

/**
 * Set or clear programme membership on a single plan's front matter.
 * A falsy slug clears membership -- this is also how "remove from
 * programme" and "ungroup" are implemented (issue #952).
 */
function applyProgrammeFrontMatter(planText, slug, name) {
    if (!slug) {
        return removeFrontMatterField(removeFrontMatterField(planText || '', 'programme'), 'programme_name');
    }
    let text = setFrontMatterField(planText || '', 'programme', slug);
    text = setFrontMatterField(text, 'programme_name', name || programmeNameFromSlug(slug));
    return text;
}

/**
 * Pure batch version of applyProgrammeFrontMatter: given a project list and
 * a subset of selected ids, returns a new project list where only the
 * selected projects' planText has been updated. Unselected projects are
 * returned unchanged (same reference).
 */
function applyProgrammeToSelection(projects, selectedIds, slug, name) {
    const idSet = new Set(selectedIds || []);
    return (projects || []).map(project => {
        if (!idSet.has(project.id)) return project;
        return Object.assign({}, project, {
            planText: applyProgrammeFrontMatter(project.planText, slug, name),
        });
    });
}

/**
 * Contiguous-range selection for shift-click, given the currently displayed
 * row order. Falls back to just the target when the anchor isn't visible.
 */
function computeRangeSelection(orderedIds, anchorId, targetId) {
    const ids = orderedIds || [];
    const a = ids.indexOf(anchorId);
    const b = ids.indexOf(targetId);
    if (a === -1 || b === -1) return targetId ? [targetId] : [];
    const start = Math.min(a, b);
    const end = Math.max(a, b);
    return ids.slice(start, end + 1);
}

/** Axis-aligned rectangle intersection test used by the portfolio lasso. */
function rectsIntersect(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** Given row rects ({id, left, top, right, bottom}) and a lasso rect, the ids it hits. */
function projectIdsInLasso(rowRects, lassoRect) {
    return (rowRects || [])
        .filter(rect => rectsIntersect(rect, lassoRect))
        .map(rect => rect.id);
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

    // A fresh full render always starts from a clean selection -- the
    // rendered checkboxes below are unchecked, so the selection state must
    // match (issue #952).
    clearProjectSelection();

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
        const programme = extractProjectProgramme(planText);

        return {
            id: project.id,
            name: project.name,
            manager: manager,
            status: status,
            startDate: dates.startDate,
            finishDate: dates.finishDate,
            highlight: highlight,
            isActive: project.id === currentProjectId,
            planText: planText,
            programme: programme
        };
    });

    // Sort by project name by default
    tableData.sort((a, b) => a.name.localeCompare(b.name));

    let html = '<div class="portfolio-table-container">';
    html += '<table class="portfolio-projects-table">';
    html += '<thead>';
    html += '<tr>';
    html += '<th class="project-select-col"></th>';
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

        const programmeBadge = project.programme
            ? ` <span class="programme-badge" title="Programme: ${escapeHtml(project.programme.name)}">${escapeHtml(project.programme.name)}</span>`
            : '';

        html += `<tr class="project-table-row ${rowClass}" data-project-id="${project.id}" onclick="handleProjectRowClick(event, '${project.id}')">`;
        html += `<td class="project-select-cell" onclick="event.stopPropagation()">` +
            `<input type="checkbox" class="project-select-checkbox" onclick="handleProjectCheckboxClick(event, '${project.id}')"></td>`;
        html += `<td class="project-name-cell" ondblclick="event.stopPropagation(); startInlineRename('${project.id}', this)">`;
        if (project.isActive) {
            html += `<span class="active-indicator">●</span> `;
        }
        html += `<span class="project-name-editable">${escapeHtml(project.name)}</span>${programmeBadge}</td>`;
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

    // Sorting rebuilds the row markup with fresh (unchecked) checkboxes, so
    // the selection state has to be reset to match (issue #952).
    clearProjectSelection();

    let html = '<div class="portfolio-table-container">';
    html += '<table class="portfolio-projects-table">';
    html += '<thead>';
    html += '<tr>';
    html += '<th class="project-select-col"></th>';

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

        const programmeBadge = project.programme
            ? ` <span class="programme-badge" title="Programme: ${escapeHtml(project.programme.name)}">${escapeHtml(project.programme.name)}</span>`
            : '';

        html += `<tr class="project-table-row ${rowClass}" data-project-id="${project.id}" onclick="handleProjectRowClick(event, '${project.id}')">`;
        html += `<td class="project-select-cell" onclick="event.stopPropagation()">` +
            `<input type="checkbox" class="project-select-checkbox" onclick="handleProjectCheckboxClick(event, '${project.id}')"></td>`;
        html += `<td class="project-name-cell" ondblclick="event.stopPropagation(); startInlineRename('${project.id}', this)">`;
        if (project.isActive) {
            html += `<span class="active-indicator">●</span> `;
        }
        html += `<span class="project-name-editable">${escapeHtml(project.name)}</span>${programmeBadge}</td>`;
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

// ---------------------------------------------------------------------------
// Multi-select and programme grouping (issue #952)
//
// The portfolio project list has no selection or lasso gesture to borrow --
// whiteboard.js/whiteboard-notes.js were checked and neither has one. This
// builds a plain rectangle-intersection lasso local to this file rather than
// a shared/generalised module; if the whiteboard grows a similar gesture
// later it can be factored out then.
// ---------------------------------------------------------------------------

let selectedProjectIds = new Set();
let lastSelectionAnchorId = null;

function getSelectedProjectIds() {
    return Array.from(selectedProjectIds);
}

/** Sync row checkbox/highlight state and the selection toolbar to selectedProjectIds. */
function refreshProjectSelectionUI() {
    document.querySelectorAll('.project-table-row').forEach(row => {
        const id = row.getAttribute('data-project-id');
        const selected = selectedProjectIds.has(id);
        row.classList.toggle('project-row-selected', selected);
        const checkbox = row.querySelector('.project-select-checkbox');
        if (checkbox) checkbox.checked = selected;
    });
    renderSelectionToolbar();
}

function setProjectSelection(ids) {
    selectedProjectIds = new Set(ids);
    refreshProjectSelectionUI();
}

function selectOnlyProject(projectId) {
    selectedProjectIds = new Set([projectId]);
    lastSelectionAnchorId = projectId;
    refreshProjectSelectionUI();
}

function toggleProjectSelection(projectId) {
    if (selectedProjectIds.has(projectId)) {
        selectedProjectIds.delete(projectId);
    } else {
        selectedProjectIds.add(projectId);
    }
    lastSelectionAnchorId = projectId;
    refreshProjectSelectionUI();
}

function selectProjectRange(projectId) {
    const orderedIds = (window.portfolioTableData || []).map(p => p.id);
    const anchor = lastSelectionAnchorId || projectId;
    setProjectSelection(computeRangeSelection(orderedIds, anchor, projectId));
}

function clearProjectSelection() {
    selectedProjectIds = new Set();
    lastSelectionAnchorId = null;
    if (typeof document !== 'undefined') refreshProjectSelectionUI();
}

/**
 * Row click: shift/ctrl-click select (matching typical list-select UX)
 * without disturbing the existing "click a row to open its project"
 * gesture on a plain click.
 */
function handleProjectRowClick(event, projectId) {
    if (event.shiftKey) {
        event.preventDefault();
        selectProjectRange(projectId);
        return;
    }
    if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        toggleProjectSelection(projectId);
        return;
    }
    if (selectedProjectIds.size > 0) clearProjectSelection();
    openProjectFromTable(projectId);
}

/** Per-row checkbox: the discoverable "select just this one" affordance. */
function handleProjectCheckboxClick(event, projectId) {
    event.stopPropagation();
    if (event.shiftKey) {
        selectProjectRange(projectId);
    } else if (event.ctrlKey || event.metaKey) {
        toggleProjectSelection(projectId);
    } else {
        selectOnlyProject(projectId);
    }
}

/** Selection toolbar shown above the table whenever 1+ projects are selected. */
function renderSelectionToolbar() {
    const container = document.getElementById('portfolioProjectsList');
    let bar = document.getElementById('portfolioSelectionToolbar');
    const count = selectedProjectIds.size;

    if (count === 0) {
        if (bar) bar.remove();
        return;
    }

    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'portfolioSelectionToolbar';
        bar.className = 'portfolio-selection-toolbar';
        if (container) container.insertBefore(bar, container.firstChild);
    }

    bar.innerHTML =
        `<span class="portfolio-selection-count">${count} selected</span>` +
        `<button class="btn-secondary" onclick="showGroupIntoProgrammeDialog()">Group into a programme</button>` +
        `<button class="btn-secondary" onclick="showAddToProgrammeDialog()">Add to programme</button>` +
        `<button class="btn-secondary" onclick="removeSelectedFromProgramme()">Remove from programme</button>` +
        `<button class="portfolio-selection-clear" onclick="clearProjectSelection()" aria-label="Clear selection" title="Clear selection">&times;</button>`;
}

/**
 * Write programme membership (or clear it, when slug is falsy) to storage
 * for each given project, keeping the in-memory cache and, if the project
 * is open in the editor, the editor's own text in sync so the next
 * autosave doesn't overwrite the change with stale content.
 */
function persistProgrammeMembership(projectIds, slug, name) {
    const currentId = (typeof getCurrentProjectId === 'function') ? getCurrentProjectId() : null;

    (projectIds || []).forEach(id => {
        const project = (typeof getCachedProject === 'function') ? getCachedProject(id) : loadProject(id);
        if (!project) return;

        const text = applyProgrammeFrontMatter(project.planText, slug, name);

        if (typeof updateCachedProject === 'function') {
            updateCachedProject(id, { planText: text });
        } else if (typeof saveProject === 'function') {
            saveProject(id, { planText: text });
        }

        if (id !== currentId) return;
        const editor = document.getElementById('planEditor');
        if (editor) {
            if (typeof setEditorValuePreservingCursor === 'function') {
                setEditorValuePreservingCursor(editor, text);
            } else {
                editor.value = text;
            }
        }
        const kanbanEditor = document.getElementById('kanbanPlanEditor');
        if (kanbanEditor) kanbanEditor.value = text;
    });
}

function showGroupIntoProgrammeDialog() {
    if (selectedProjectIds.size === 0) return;
    _showProgrammeDialog({ mode: 'group' });
}

function showAddToProgrammeDialog() {
    if (selectedProjectIds.size === 0) return;
    _showProgrammeDialog({ mode: 'add' });
}

function removeSelectedFromProgramme() {
    if (selectedProjectIds.size === 0) return;
    const ids = getSelectedProjectIds();
    const plural = ids.length === 1 ? '' : 's';
    if (!confirm(`Remove ${ids.length} project${plural} from ${ids.length === 1 ? 'its' : 'their'} programme?`)) return;

    persistProgrammeMembership(ids, null, null);
    if (typeof refreshProjectSelectors === 'function') refreshProjectSelectors();
    renderProjectsTable();
    showNotification('Removed from programme.');
}

/**
 * Rewrite the programme slug/name across every project currently in
 * `oldSlug`'s group -- renaming a programme means relabelling its members,
 * since there is no separate programme record to rename (issue #952).
 */
function renameProgramme(oldSlug, newName) {
    const newSlug = slugify(newName);
    if (!newSlug) return;

    const projects = (typeof loadAllProjectsIntoCache === 'function') ? loadAllProjectsIntoCache() : listProjects();
    const programme = deriveProgrammes(projects).find(p => p.slug === oldSlug);
    if (!programme) return;

    const memberIds = programme.projects.map(p => p.id);
    persistProgrammeMembership(memberIds, newSlug, newName);
    if (typeof refreshProjectSelectors === 'function') refreshProjectSelectors();
    renderProjectsTable();
    showNotification('Programme renamed to: ' + newName);
}

/**
 * Build and show the "Group into a programme" / "Add to programme" /
 * "Rename programme" modal, matching the task-form-modal pattern used by
 * portfolio-dependencies.js rather than a raw prompt().
 */
function _showProgrammeDialog(opts) {
    const mode = opts.mode;
    const projects = (typeof loadAllProjectsIntoCache === 'function') ? loadAllProjectsIntoCache() : listProjects();
    const programmes = deriveProgrammes(projects);

    const titles = { group: 'Group into a Programme', add: 'Add to Programme', rename: 'Rename Programme' };
    const submitLabels = { group: 'Group', add: 'Add', rename: 'Rename' };

    let bodyHtml = '';
    if (mode === 'add' && programmes.length > 0) {
        bodyHtml +=
            '<div class="form-group">' +
            '<label for="progSelect">Existing programme</label>' +
            '<select id="progSelect" class="form-control">' +
            '<option value="">-- Choose --</option>' +
            programmes.map(p => `<option value="${escapeHtml(p.slug)}">${escapeHtml(p.name)}</option>`).join('') +
            '</select>' +
            '<button type="button" class="btn-secondary" style="margin-top:8px;" onclick="renameSelectedProgramme()">Rename this programme</button>' +
            '</div>' +
            '<div class="form-group"><label for="progName">Or create a new programme</label>';
    } else {
        bodyHtml += '<div class="form-group"><label for="progName">Programme name</label>';
    }
    bodyHtml +=
        `<input type="text" id="progName" class="form-control" maxlength="200" ` +
        `placeholder="e.g. Digital Transformation" value="${escapeHtml(opts.currentName || '')}">` +
        '</div>';

    const submitArgs = mode === 'rename' ? `'rename', '${escapeHtml(opts.targetSlug)}'` : `'${mode}'`;

    const html = '<div id="progModalOverlay" class="modal-overlay active" ' +
        'onclick="if(event.target===this)closeProgrammeDialog()" role="dialog" aria-modal="true" aria-labelledby="progModalTitle">' +
        '<div class="task-form-modal" style="max-width:420px;width:min(420px,92vw);">' +
        '<div class="modal-header">' +
        `<h3 id="progModalTitle" style="margin:0;">${titles[mode]}</h3>` +
        '<button class="close-btn" onclick="closeProgrammeDialog()" aria-label="Close">&times;</button>' +
        '</div>' +
        '<div class="modal-body">' +
        `<form id="progForm" onsubmit="submitProgrammeDialog(event, ${submitArgs})">` +
        bodyHtml +
        '<div style="text-align:right;margin-top:16px;">' +
        '<button type="button" class="btn-secondary" onclick="closeProgrammeDialog()" style="margin-right:8px;">Cancel</button>' +
        `<button type="submit" class="btn-primary">${submitLabels[mode]}</button>` +
        '</div>' +
        '</form>' +
        '</div>' +
        '</div>' +
        '</div>';

    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container.firstChild);

    const nameInput = document.getElementById('progName');
    if (nameInput) nameInput.focus();
}

function closeProgrammeDialog() {
    const overlay = document.getElementById('progModalOverlay');
    if (overlay) overlay.remove();
}

function renameSelectedProgramme() {
    const selectEl = document.getElementById('progSelect');
    if (!selectEl || !selectEl.value) {
        alert('Choose a programme to rename first.');
        return;
    }
    const oldSlug = selectEl.value;
    const projects = (typeof loadAllProjectsIntoCache === 'function') ? loadAllProjectsIntoCache() : listProjects();
    const programme = deriveProgrammes(projects).find(p => p.slug === oldSlug);

    closeProgrammeDialog();
    _showProgrammeDialog({ mode: 'rename', targetSlug: oldSlug, currentName: programme ? programme.name : '' });
}

function submitProgrammeDialog(event, mode, targetSlug) {
    event.preventDefault();

    const nameInput = document.getElementById('progName');
    const typedName = nameInput ? nameInput.value.trim() : '';

    if (mode === 'rename') {
        if (!typedName) {
            alert('Enter a programme name.');
            return;
        }
        closeProgrammeDialog();
        renameProgramme(targetSlug, typedName);
        return;
    }

    let slug, name;
    if (typedName) {
        slug = slugify(typedName);
        name = typedName;
    } else {
        const selectEl = document.getElementById('progSelect');
        if (!selectEl || !selectEl.value) {
            alert('Enter a programme name or choose an existing one.');
            return;
        }
        const projects = (typeof loadAllProjectsIntoCache === 'function') ? loadAllProjectsIntoCache() : listProjects();
        const programme = deriveProgrammes(projects).find(p => p.slug === selectEl.value);
        slug = selectEl.value;
        name = programme ? programme.name : programmeNameFromSlug(slug);
    }

    if (!slug) {
        alert('Enter a valid programme name.');
        return;
    }

    const ids = getSelectedProjectIds();
    persistProgrammeMembership(ids, slug, name);
    closeProgrammeDialog();
    if (typeof refreshProjectSelectors === 'function') refreshProjectSelectors();
    renderProjectsTable();
    showNotification((mode === 'group' ? 'Grouped into ' : 'Added to ') + name);
}

// ---------------------------------------------------------------------------
// Drag lasso: mousedown+drag over empty space (i.e. not a row, checkbox,
// button, or other control) draws a rectangle and selects any project row
// it intersects. The DOM/event wiring below is not unit tested -- it is
// covered by rectsIntersect/projectIdsInLasso/computeRangeSelection instead
// -- and is guarded so it's a no-op outside a browser (e.g. under Node).
// ---------------------------------------------------------------------------

if (typeof document !== 'undefined') {
    (function initProjectSelectionLasso() {
        let dragging = false;
        let startX = 0;
        let startY = 0;
        let additive = false;
        let baseSelection = [];
        let lassoEl = null;

        function isInteractiveTarget(target) {
            return !!target.closest(
                '.project-table-row, .project-action-btn, .project-select-checkbox, ' +
                'button, a, input, select, th.sortable, .portfolio-selection-toolbar'
            );
        }

        function positionLasso(x1, y1, x2, y2) {
            if (!lassoEl) return;
            lassoEl.style.left = Math.min(x1, x2) + 'px';
            lassoEl.style.top = Math.min(y1, y2) + 'px';
            lassoEl.style.width = Math.abs(x2 - x1) + 'px';
            lassoEl.style.height = Math.abs(y2 - y1) + 'px';
        }

        document.addEventListener('mousedown', event => {
            const container = document.getElementById('portfolioProjectsList');
            if (!container || !container.contains(event.target)) return;
            if (event.button !== 0 || isInteractiveTarget(event.target)) return;

            dragging = true;
            additive = event.shiftKey;
            baseSelection = additive ? getSelectedProjectIds() : [];
            startX = event.clientX;
            startY = event.clientY;

            lassoEl = document.createElement('div');
            lassoEl.className = 'portfolio-lasso-box';
            document.body.appendChild(lassoEl);
            positionLasso(startX, startY, startX, startY);
        });

        document.addEventListener('mousemove', event => {
            if (!dragging) return;
            positionLasso(startX, startY, event.clientX, event.clientY);

            const lassoRect = {
                left: Math.min(startX, event.clientX),
                top: Math.min(startY, event.clientY),
                right: Math.max(startX, event.clientX),
                bottom: Math.max(startY, event.clientY),
            };
            const rowRects = Array.from(document.querySelectorAll('.project-table-row')).map(row => {
                const r = row.getBoundingClientRect();
                return { id: row.getAttribute('data-project-id'), left: r.left, top: r.top, right: r.right, bottom: r.bottom };
            });
            const hit = projectIdsInLasso(rowRects, lassoRect);
            setProjectSelection(additive ? Array.from(new Set(baseSelection.concat(hit))) : hit);
        });

        document.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false;
            if (lassoEl) {
                lassoEl.remove();
                lassoEl = null;
            }
        });
    })();
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        parseFrontmatter,
        extractProjectManager,
        extractProjectStatus,
        programmeNameFromSlug,
        extractProjectProgramme,
        deriveProgrammes,
        slugify,
        setFrontMatterField,
        removeFrontMatterField,
        applyProgrammeFrontMatter,
        applyProgrammeToSelection,
        computeRangeSelection,
        rectsIntersect,
        projectIdsInLasso,
    };
}
