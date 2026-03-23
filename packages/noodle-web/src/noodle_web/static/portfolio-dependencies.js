/**
 * Portfolio Programme Dependencies
 * Manage and display inter-project dependencies in the portfolio view.
 *
 * Dependencies are stored in localStorage and link a task in one project
 * to a task in another.  The /api/programme-dependencies/propagate endpoint
 * evaluates each link and returns RAG status with a propagated start date.
 */

const PROGRAMME_DEPS_KEY = 'noodleplanner_programme_deps';

// In-memory cache of the last propagation result keyed by dependency id
let dependencyPropagationCache = {};

// -------------------------------------------------------------------
// Storage helpers
// -------------------------------------------------------------------

/**
 * Load all programme dependencies from localStorage.
 * @returns {Array} Array of dependency objects
 */
function getAllProgrammeDependencies() {
    try {
        const raw = localStorage.getItem(PROGRAMME_DEPS_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (err) {
        console.error('Error loading programme dependencies:', err);
        return [];
    }
}

/**
 * Save all programme dependencies to localStorage.
 * @param {Array} deps
 * @returns {boolean}
 */
function saveAllProgrammeDependencies(deps) {
    try {
        localStorage.setItem(PROGRAMME_DEPS_KEY, JSON.stringify(deps));
        return true;
    } catch (err) {
        console.error('Error saving programme dependencies:', err);
        return false;
    }
}

/**
 * Create a new programme dependency.
 * @param {string} fromProjectId
 * @param {string} fromTaskName
 * @param {string} toProjectId
 * @param {string} toTaskName
 * @param {number} lagDays
 * @param {string} notes
 * @returns {Object} The new dependency
 */
function createProgrammeDependency(fromProjectId, fromTaskName, toProjectId, toTaskName, lagDays, notes) {
    const deps = getAllProgrammeDependencies();
    const dep = {
        id: 'dep-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
        from_project_id: fromProjectId,
        from_task_name: fromTaskName,
        to_project_id: toProjectId,
        to_task_name: toTaskName,
        lag_days: lagDays || 0,
        notes: notes || '',
        created_at: Date.now(),
    };
    deps.push(dep);
    saveAllProgrammeDependencies(deps);
    return dep;
}

/**
 * Update an existing programme dependency.
 * @param {string} id
 * @param {Object} updates
 * @returns {Object|null}
 */
function updateProgrammeDependency(id, updates) {
    const deps = getAllProgrammeDependencies();
    const idx = deps.findIndex(d => d.id === id);
    if (idx === -1) return null;
    deps[idx] = { ...deps[idx], ...updates, updated_at: Date.now() };
    saveAllProgrammeDependencies(deps);
    return deps[idx];
}

/**
 * Delete a programme dependency by id.
 * @param {string} id
 * @returns {boolean}
 */
function deleteProgrammeDependency(id) {
    const deps = getAllProgrammeDependencies();
    const filtered = deps.filter(d => d.id !== id);
    if (filtered.length === deps.length) return false;
    saveAllProgrammeDependencies(filtered);
    delete dependencyPropagationCache[id];
    return true;
}

// -------------------------------------------------------------------
// API: propagate
// -------------------------------------------------------------------

/**
 * Call the propagate endpoint with current projects and dependencies.
 * Returns the response JSON or null on error.
 * @param {Array} parsedProjects  Array of {project, parsedResult} from parseAllProjects()
 * @param {Array} deps            Programme dependency objects (default: all stored)
 * @returns {Promise<Object|null>}
 */
async function propagateProgrammeDependencies(parsedProjects, deps) {
    if (!deps) {
        deps = getAllProgrammeDependencies();
    }
    if (deps.length === 0) {
        return { results: [], overall_rag: 'grey', dependency_count: 0 };
    }

    const projects = parsedProjects
        .filter(({ parsedResult }) => parsedResult && parsedResult.success && parsedResult.tasks)
        .map(({ project, parsedResult }) => ({
            project_id: project.id,
            project_name: project.name,
            tasks: (parsedResult.tasks || []).map(t => ({
                name: t.name || '',
                start: t.start || null,
                finish: t.finish || null,
                duration_days: t.duration_days || 0,
                percent: parseFloat(t.percent) || 0,
                is_summary: !!t.is_summary,
            })),
        }));

    try {
        const response = await fetch('/api/programme-dependencies/propagate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dependencies: deps, projects }),
        });
        if (!response.ok) {
            console.error('Propagation API error:', response.status);
            return null;
        }
        const data = await response.json();
        // Update cache
        (data.results || []).forEach(r => {
            dependencyPropagationCache[r.dependency_id] = r;
        });
        return data;
    } catch (err) {
        console.error('Error calling propagate endpoint:', err);
        return null;
    }
}

// -------------------------------------------------------------------
// RAG helpers
// -------------------------------------------------------------------

/**
 * Map a RAG string to a CSS colour value.
 * @param {string} rag  'red', 'amber', 'green', 'grey'
 * @returns {string}
 */
function ragToColour(rag) {
    const map = {
        red: '#dc3545',
        amber: '#ffc107',
        green: '#28a745',
        grey: '#6c757d',
        blue: '#1976d2',
    };
    return map[rag] || map.grey;
}

/**
 * Build a small RAG circle SVG/HTML element.
 * @param {string} rag
 * @param {string} title  Tooltip text
 * @returns {string} HTML string
 */
function ragCircleHtml(rag, title) {
    const colour = ragToColour(rag);
    return (
        '<span class="dep-rag-circle" style="display:inline-block;width:14px;height:14px;' +
        'border-radius:50%;background:' + colour + ';vertical-align:middle;' +
        'margin-right:4px;flex-shrink:0;" title="' + escapeHtml(title || rag) + '"></span>'
    );
}

// -------------------------------------------------------------------
// View: render dependencies management UI
// -------------------------------------------------------------------

/**
 * Render the programme dependencies management view into the given container.
 * @param {string} containerId
 * @param {Array}  parsedProjects  Result from parseAllProjects()
 * @param {Object} propagationResult  Result from propagateProgrammeDependencies()
 */
function renderProgrammeDependenciesView(containerId, parsedProjects, propagationResult) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const deps = getAllProgrammeDependencies();
    const projects = listProjects();

    // Build project name lookup
    const projectNames = {};
    projects.forEach(p => { projectNames[p.id] = p.name; });

    // Build propagation result lookup by dep id
    const propById = {};
    if (propagationResult && propagationResult.results) {
        propagationResult.results.forEach(r => { propById[r.dependency_id] = r; });
    }

    const overallRag = propagationResult ? propagationResult.overall_rag : 'grey';

    let html = '<div class="programme-deps-view">';

    // Header
    html += '<div class="programme-deps-header">';
    html += '<h3 style="margin:0;">Programme Dependencies ';
    html += ragCircleHtml(overallRag, 'Overall dependency health: ' + overallRag);
    html += '</h3>';
    html += '<a href="javascript:void(0)" class="add-item-link" onclick="showAddDependencyDialog()" style="margin-left:auto;">' +
        '<span class="add-icon">+</span> Add Dependency</a>';
    html += '</div>';

    if (deps.length === 0) {
        html += '<div class="portfolio-empty-state">' +
            '<h3>No Dependencies</h3>' +
            '<p>Add dependencies to track how tasks in one project affect another.</p>' +
            '<a href="javascript:void(0)" class="add-item-link" onclick="showAddDependencyDialog()" style="margin-top:8px;display:inline-flex;">' +
            '<span class="add-icon">+</span> Add Dependency</a>' +
            '</div>';
    } else {
        html += '<table class="dep-table" role="table" aria-label="Programme dependencies">';
        html += '<thead><tr>' +
            '<th scope="col">RAG</th>' +
            '<th scope="col">Source Project</th>' +
            '<th scope="col">Source Task</th>' +
            '<th scope="col">Dependent Project</th>' +
            '<th scope="col">Dependent Task</th>' +
            '<th scope="col">Lag (days)</th>' +
            '<th scope="col">Status</th>' +
            '<th scope="col">Actions</th>' +
            '</tr></thead>';
        html += '<tbody>';

        deps.forEach(dep => {
            const prop = propById[dep.id];
            const rag = prop ? prop.rag : 'grey';
            const reason = prop ? prop.reason : 'Not yet evaluated';
            const fromName = escapeHtml(projectNames[dep.from_project_id] || dep.from_project_id);
            const toName = escapeHtml(projectNames[dep.to_project_id] || dep.to_project_id);

            html += '<tr>';
            html += '<td>' + ragCircleHtml(rag, reason) + '</td>';
            html += '<td>' + fromName + '</td>';
            html += '<td>' + escapeHtml(dep.from_task_name) + '</td>';
            html += '<td>' + toName + '</td>';
            html += '<td>' + escapeHtml(dep.to_task_name) + '</td>';
            html += '<td>' + (dep.lag_days || 0) + '</td>';
            html += '<td style="max-width:220px;font-size:0.85em;color:' +
                ragToColour(rag) + ';">' + escapeHtml(reason) + '</td>';
            html += '<td><button class="btn-secondary btn-sm" ' +
                'onclick="showEditDependencyDialog(\'' + dep.id + '\')" aria-label="Edit dependency">Edit</button> ' +
                '<button class="btn-danger btn-sm" ' +
                'onclick="confirmDeleteProgrammeDependency(\'' + dep.id + '\')" aria-label="Delete dependency">Delete</button></td>';
            html += '</tr>';
        });

        html += '</tbody></table>';
    }

    html += '</div>';

    container.innerHTML = html;
}

// -------------------------------------------------------------------
// Dialogs: add / edit dependency
// -------------------------------------------------------------------

/**
 * Show dialog to add a new programme dependency.
 */
function showAddDependencyDialog() {
    const projects = listProjects();
    if (projects.length < 2) {
        showNotification('You need at least two projects to create a dependency.', 'warning');
        return;
    }
    _showDependencyDialog(null);
}

/**
 * Show dialog to edit an existing dependency.
 * @param {string} depId
 */
function showEditDependencyDialog(depId) {
    const deps = getAllProgrammeDependencies();
    const dep = deps.find(d => d.id === depId);
    if (!dep) return;
    _showDependencyDialog(dep);
}

/**
 * Internal: build and show the dependency form modal.
 * @param {Object|null} dep  null for create, existing dep for edit
 */
function _showDependencyDialog(dep) {
    const isEdit = !!dep;
    const projects = listProjects().sort((a, b) => a.name.localeCompare(b.name));

    // Build project <option> HTML
    function projectOptions(selectedId) {
        return projects.map(p =>
            '<option value="' + escapeHtml(p.id) + '"' +
            (p.id === selectedId ? ' selected' : '') +
            '>' + escapeHtml(p.name) + '</option>'
        ).join('');
    }

    const title = isEdit ? 'Edit Dependency' : 'Add Programme Dependency';

    const html = '<div id="depModalOverlay" class="modal-overlay active" ' +
        'onclick="if(event.target===this)closeDependencyDialog()" ' +
        'role="dialog" aria-modal="true" aria-labelledby="depModalTitle">' +
        '<div class="task-form-modal" style="max-width:540px;width:min(540px,92vw);">' +
        '<div class="modal-header">' +
        '<h3 id="depModalTitle" style="margin:0;">' + title + '</h3>' +
        '<button class="close-btn" onclick="closeDependencyDialog()" aria-label="Close">&times;</button>' +
        '</div>' +
        '<div class="modal-body">' +
        '<form id="depForm" onsubmit="saveDependencyForm(event)">' +
        (isEdit ? '<input type="hidden" id="depId" value="' + escapeHtml(dep.id) + '">' : '') +
        '<div class="form-grid-2col">' +
        '<div class="form-group">' +
        '<label for="depFromProject">Source Project</label>' +
        '<select id="depFromProject" class="form-control" required onchange="refreshTaskOptions(\'depFromProject\',\'depFromTask\')">' +
        '<option value="">-- Select project --</option>' +
        projectOptions(dep ? dep.from_project_id : '') +
        '</select>' +
        '</div>' +
        '<div class="form-group">' +
        '<label for="depFromTask">Source Task / Milestone</label>' +
        '<input type="text" id="depFromTask" class="form-control" required maxlength="500" ' +
        'value="' + escapeHtml(dep ? dep.from_task_name : '') + '" ' +
        'placeholder="Enter task name" list="depFromTaskList">' +
        '<datalist id="depFromTaskList"></datalist>' +
        '</div>' +
        '</div>' +
        '<div class="form-grid-2col">' +
        '<div class="form-group">' +
        '<label for="depToProject">Dependent Project</label>' +
        '<select id="depToProject" class="form-control" required onchange="refreshTaskOptions(\'depToProject\',\'depToTask\')">' +
        '<option value="">-- Select project --</option>' +
        projectOptions(dep ? dep.to_project_id : '') +
        '</select>' +
        '</div>' +
        '<div class="form-group">' +
        '<label for="depToTask">Dependent Task / Milestone</label>' +
        '<input type="text" id="depToTask" class="form-control" required maxlength="500" ' +
        'value="' + escapeHtml(dep ? dep.to_task_name : '') + '" ' +
        'placeholder="Enter task name" list="depToTaskList">' +
        '<datalist id="depToTaskList"></datalist>' +
        '</div>' +
        '</div>' +
        '<div class="form-grid-2col">' +
        '<div class="form-group">' +
        '<label for="depLag">Lag (days)</label>' +
        '<input type="number" id="depLag" class="form-control" value="' +
        (dep ? dep.lag_days || 0 : 0) + '" min="-999" max="999">' +
        '<small>Positive = wait N days after source finishes</small>' +
        '</div>' +
        '<div class="form-group">' +
        '<label for="depNotes">Notes</label>' +
        '<input type="text" id="depNotes" class="form-control" maxlength="1000" ' +
        'value="' + escapeHtml(dep ? dep.notes || '' : '') + '" placeholder="Optional notes">' +
        '</div>' +
        '</div>' +
        '<div style="text-align:right;margin-top:16px;">' +
        '<button type="button" class="btn-secondary" onclick="closeDependencyDialog()" style="margin-right:8px;">Cancel</button>' +
        '<button type="submit" class="btn-primary">' + (isEdit ? 'Save Changes' : 'Add Dependency') + '</button>' +
        '</div>' +
        '</form>' +
        '</div>' +
        '</div>' +
        '</div>';

    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container.firstChild);

    // Pre-populate task datalists if projects are selected
    if (dep && dep.from_project_id) {
        refreshTaskOptions('depFromProject', 'depFromTask');
    }
    if (dep && dep.to_project_id) {
        refreshTaskOptions('depToProject', 'depToTask');
    }
}

/**
 * Refresh the task name datalist for a project selector + input combo.
 * @param {string} selectId  ID of the project <select>
 * @param {string} inputId   ID of the task name <input>
 */
function refreshTaskOptions(selectId, inputId) {
    const select = document.getElementById(selectId);
    const input = document.getElementById(inputId);
    if (!select || !input) return;

    const projectId = select.value;
    if (!projectId) return;

    const datalistId = inputId + 'List';
    const datalist = document.getElementById(datalistId);
    if (!datalist) return;

    const project = loadProject(projectId);
    if (!project || !project.planText) {
        datalist.innerHTML = '';
        return;
    }

    // Extract task names from plan text lines (simple heuristic: non-empty lines
    // that look like task names — skip YAML front matter and blank lines)
    const lines = project.planText.split('\n');
    const taskNames = [];
    let inFrontMatter = false;
    let frontMatterDone = false;

    lines.forEach((line, idx) => {
        if (idx === 0 && line.trim() === '---') { inFrontMatter = true; return; }
        if (inFrontMatter && line.trim() === '---') { inFrontMatter = false; frontMatterDone = true; return; }
        if (inFrontMatter) return;

        const trimmed = line.replace(/^\s+/, '');
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) return;

        // Extract the task name: first word-group before @resource or Xd notation
        const nameMatch = trimmed.match(/^([^@\d][^@]*?)(?:\s+@|\s+\d+[dwmy]|\s*$)/);
        if (nameMatch) {
            const name = nameMatch[1].replace(/\s*\*/, '').trim();
            if (name.length > 1) taskNames.push(name);
        }
    });

    datalist.innerHTML = taskNames
        .slice(0, 50)
        .map(n => '<option value="' + escapeHtml(n) + '">')
        .join('');
}

/**
 * Close the dependency dialog.
 */
function closeDependencyDialog() {
    const overlay = document.getElementById('depModalOverlay');
    if (overlay) overlay.remove();
}

/**
 * Handle dependency form submission.
 * @param {Event} event
 */
function saveDependencyForm(event) {
    event.preventDefault();

    const fromProjectId = document.getElementById('depFromProject').value;
    const fromTaskName = document.getElementById('depFromTask').value.trim();
    const toProjectId = document.getElementById('depToProject').value;
    const toTaskName = document.getElementById('depToTask').value.trim();
    const lagDays = parseInt(document.getElementById('depLag').value) || 0;
    const notes = document.getElementById('depNotes').value.trim();
    const depIdEl = document.getElementById('depId');

    if (!fromProjectId || !fromTaskName || !toProjectId || !toTaskName) {
        showNotification('Please fill in all required fields.', 'error');
        return;
    }

    if (fromProjectId === toProjectId && fromTaskName === toTaskName) {
        showNotification('A task cannot depend on itself.', 'error');
        return;
    }

    if (depIdEl) {
        // Edit
        updateProgrammeDependency(depIdEl.value, {
            from_project_id: fromProjectId,
            from_task_name: fromTaskName,
            to_project_id: toProjectId,
            to_task_name: toTaskName,
            lag_days: lagDays,
            notes,
        });
        showNotification('Dependency updated.');
    } else {
        // Create
        createProgrammeDependency(fromProjectId, fromTaskName, toProjectId, toTaskName, lagDays, notes);
        showNotification('Dependency added.');
    }

    closeDependencyDialog();
    renderPortfolioDependencies();
}

/**
 * Confirm and delete a programme dependency.
 * @param {string} depId
 */
function confirmDeleteProgrammeDependency(depId) {
    const deps = getAllProgrammeDependencies();
    const dep = deps.find(d => d.id === depId);
    if (!dep) return;

    const label = dep.from_task_name + ' \u2192 ' + dep.to_task_name;
    if (!confirm('Delete dependency "' + label + '"?')) return;

    deleteProgrammeDependency(depId);
    showNotification('Dependency deleted.');
    renderPortfolioDependencies();
}

// -------------------------------------------------------------------
// Main entry point: render the dependencies portfolio view
// -------------------------------------------------------------------

/**
 * Render the portfolio dependencies view (async — fetches parsed projects).
 */
async function renderPortfolioDependencies() {
    const container = document.getElementById('portfolioDependenciesView');
    if (!container) return;

    container.innerHTML = '<div class="portfolio-loading">' +
        '<div class="portfolio-loading-spinner"></div>' +
        '<p>Loading dependency data...</p>' +
        '</div>';

    try {
        const parsedProjects = await parseAllProjects();
        const deps = getAllProgrammeDependencies();
        const propagationResult = await propagateProgrammeDependencies(parsedProjects, deps);
        renderProgrammeDependenciesView('portfolioDependenciesView', parsedProjects, propagationResult);
    } catch (err) {
        console.error('Error rendering portfolio dependencies:', err);
        container.innerHTML = '<div class="portfolio-empty-state">' +
            '<h3>Error Loading Dependencies</h3>' +
            '<p>Failed to load dependency data. Please try again.</p>' +
            '</div>';
    }
}

// -------------------------------------------------------------------
// Timeline overlay: draw dependency arrows between swimlanes
// -------------------------------------------------------------------

/**
 * Draw inter-project dependency arrows onto the portfolio timeline SVG.
 * Called after renderPortfolioTimeline() has built the DOM.
 *
 * @param {Array}  timelines         Array of {projectId, ...} from renderPortfolioTimeline
 * @param {Date}   globalStart
 * @param {Date}   globalEnd
 * @param {Object} propagationResult Result from propagateProgrammeDependencies()
 */
function drawDependencyArrows(timelines, globalStart, globalEnd, propagationResult) {
    const container = document.querySelector('.portfolio-timeline-container');
    if (!container) return;

    const deps = getAllProgrammeDependencies();
    if (deps.length === 0) return;

    const propById = {};
    if (propagationResult && propagationResult.results) {
        propagationResult.results.forEach(r => { propById[r.dependency_id] = r; });
    }

    // Build projectId -> row index map for vertical positioning
    const rowIndex = {};
    timelines.forEach((t, i) => { rowIndex[t.projectId] = i; });

    // Measure the swimlane rows to get their vertical centres
    const rows = container.querySelectorAll('.timeline-project-row');
    const rowMidpoints = [];
    rows.forEach(row => {
        const rect = row.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        rowMidpoints.push(rect.top - containerRect.top + rect.height / 2);
    });

    const totalMs = globalEnd.getTime() - globalStart.getTime();

    // Create an SVG overlay that covers the timeline container
    let overlaySvg = container.querySelector('.dep-arrows-svg');
    if (!overlaySvg) {
        overlaySvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        overlaySvg.setAttribute('class', 'dep-arrows-svg');
        overlaySvg.style.cssText =
            'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:visible;';
        container.style.position = 'relative';
        container.appendChild(overlaySvg);
    }
    overlaySvg.innerHTML = '';  // clear previous arrows

    deps.forEach(dep => {
        const fromRow = rowIndex[dep.from_project_id];
        const toRow = rowIndex[dep.to_project_id];
        if (fromRow === undefined || toRow === undefined) return;

        const prop = propById[dep.id];
        const rag = prop ? prop.rag : 'grey';
        const colour = ragToColour(rag);

        // Find source task finish date for x-position
        const fromTask = prop && prop.from_task ? prop.from_task : null;
        const toTask = prop && prop.to_task ? prop.to_task : null;

        if (!fromTask || !fromTask.finish) return;

        let fromFinishMs;
        try {
            fromFinishMs = new Date(fromTask.finish).getTime();
        } catch (e) { return; }

        // x% position within the track area (after 200px label column)
        const xPct = ((fromFinishMs - globalStart.getTime()) / totalMs) * 100;
        if (xPct < 0 || xPct > 100) return;

        const fromY = rowMidpoints[fromRow] || 0;
        const toY = rowMidpoints[toRow] || 0;

        // Use percentage-based x with a CSS calc offset for the 200px label column
        // We draw a simple elbow connector
        const x1 = 'calc(200px + (100% - 200px) * ' + (xPct / 100) + ')';
        // Arrow path: vertical line from fromY to midpoint, then to toY
        const midY = (fromY + toY) / 2;

        // Build SVG path using foreignObject-friendly approach
        // Since we can't use calc() in SVG attribute values directly we fall back to
        // a data attribute and reposition after layout via JS—but for simplicity
        // we store the percentage and render a dashed line using polyline with a
        // relative x offset applied after.

        // Simple approach: draw a straight diagonal line from (xPct%, fromY) to (xPct%, toY)
        // SVG doesn't support calc() in attributes so we use a 0-1000 viewBox coordinate space
        // and map dates into it.
        const svgWidth = overlaySvg.clientWidth || container.clientWidth || 800;
        // xPixel: approximate pixel offset including the 200px label column
        const trackWidth = svgWidth - 200;
        const xPixel = 200 + (xPct / 100) * trackWidth;

        // Arrow from source finish down/up to dependent task start y
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const d = `M${xPixel},${fromY} L${xPixel},${toY}`;
        path.setAttribute('d', d);
        path.setAttribute('stroke', colour);
        path.setAttribute('stroke-width', rag === 'red' ? '2.5' : '1.5');
        path.setAttribute('stroke-dasharray', rag === 'green' ? '' : '5,3');
        path.setAttribute('fill', 'none');
        path.setAttribute('opacity', '0.85');
        if (prop && prop.reason) {
            const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            title.textContent = prop.reason;
            path.appendChild(title);
        }
        overlaySvg.appendChild(path);

        // Arrowhead at destination
        const arrowSize = 7;
        const arrowDir = toY > fromY ? 1 : -1;
        const arrowhead = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        arrowhead.setAttribute('points',
            `${xPixel},${toY} ` +
            `${xPixel - arrowSize / 2},${toY - arrowDir * arrowSize} ` +
            `${xPixel + arrowSize / 2},${toY - arrowDir * arrowSize}`
        );
        arrowhead.setAttribute('fill', colour);
        arrowhead.setAttribute('opacity', '0.85');
        overlaySvg.appendChild(arrowhead);

        // RAG dot at source finish point
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', xPixel);
        circle.setAttribute('cy', fromY);
        circle.setAttribute('r', '5');
        circle.setAttribute('fill', colour);
        circle.setAttribute('stroke', '#fff');
        circle.setAttribute('stroke-width', '1.5');
        if (prop && prop.reason) {
            const ctitle = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            ctitle.textContent = prop.reason;
            circle.appendChild(ctitle);
        }
        overlaySvg.appendChild(circle);
    });
}
