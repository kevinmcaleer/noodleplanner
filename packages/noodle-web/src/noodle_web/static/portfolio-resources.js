/**
 * Portfolio Resources View
 * Shows resource allocation and workload across all projects
 */

/**
 * Extract resource assignments from project plan text
 */
function extractResourceAssignments(planText, projectId, projectName) {
    if (!planText) return [];

    const assignments = [];
    const lines = planText.split('\n');
    let currentPhase = null;

    lines.forEach(line => {
        const trimmed = line.trim();

        // Detect phase headers
        if (trimmed.match(/^#{1,3}\s+(.+)/)) {
            const match = trimmed.match(/^#{1,3}\s+(.+)/);
            currentPhase = match[1].trim();
        }

        // Match task lines with resource assignments
        // Looking for patterns like: "Task name [Resource] %X"
        const taskMatch = trimmed.match(/^\s{2,}(.+?)\s*\[([^\]]+)\]\s*(%?\d+)?/);
        if (taskMatch) {
            const taskName = taskMatch[1].trim();
            const resource = taskMatch[2].trim();
            const completion = taskMatch[3] ? parseInt(taskMatch[3].replace('%', '')) : 0;

            assignments.push({
                projectId: projectId,
                projectName: projectName,
                phase: currentPhase || 'Unassigned',
                task: taskName,
                resource: resource,
                completion: completion,
                status: completion === 100 ? 'completed' : completion > 0 ? 'in-progress' : 'not-started'
            });
        }
    });

    return assignments;
}

/**
 * Aggregate resource data across all projects
 */
function aggregateResourceData(projectsData) {
    const resourceMap = new Map();

    projectsData.forEach(project => {
        const assignments = extractResourceAssignments(
            project.planText,
            project.id,
            project.name
        );

        assignments.forEach(assignment => {
            const resource = assignment.resource;

            if (!resourceMap.has(resource)) {
                resourceMap.set(resource, {
                    name: resource,
                    totalTasks: 0,
                    completedTasks: 0,
                    inProgressTasks: 0,
                    notStartedTasks: 0,
                    projects: new Set(),
                    assignments: []
                });
            }

            const resourceData = resourceMap.get(resource);
            resourceData.totalTasks++;
            resourceData.projects.add(assignment.projectName);
            resourceData.assignments.push(assignment);

            if (assignment.status === 'completed') {
                resourceData.completedTasks++;
            } else if (assignment.status === 'in-progress') {
                resourceData.inProgressTasks++;
            } else {
                resourceData.notStartedTasks++;
            }
        });
    });

    // Convert projects Set to Array and calculate workload percentage
    const resources = Array.from(resourceMap.values()).map(resource => {
        resource.projects = Array.from(resource.projects);
        resource.projectCount = resource.projects.length;
        resource.completionRate = resource.totalTasks > 0
            ? Math.round((resource.completedTasks / resource.totalTasks) * 100)
            : 0;
        resource.workloadLevel = calculateWorkloadLevel(resource.totalTasks, resource.inProgressTasks);
        return resource;
    });

    return resources;
}

/**
 * Calculate workload level
 */
function calculateWorkloadLevel(totalTasks, inProgressTasks) {
    if (inProgressTasks === 0) return 'low';
    if (inProgressTasks <= 3) return 'medium';
    if (inProgressTasks <= 6) return 'high';
    return 'overloaded';
}

/**
 * Get workload badge class
 */
function getWorkloadBadgeClass(level) {
    const classes = {
        'low': 'workload-low',
        'medium': 'workload-medium',
        'high': 'workload-high',
        'overloaded': 'workload-overloaded'
    };
    return classes[level] || 'workload-low';
}

/**
 * Render portfolio resources view
 */
function renderPortfolioResources() {
    const container = document.getElementById('portfolioResourcesView');
    if (!container) return;

    const projectsData = batchLoadProjectsData();

    if (projectsData.length === 0) {
        container.innerHTML = '<div class="portfolio-empty-state">' +
            '<h3>No Projects</h3>' +
            '<p>Create projects to see resource allocation.</p>' +
            '</div>';
        return;
    }

    const resources = aggregateResourceData(projectsData);

    if (resources.length === 0) {
        container.innerHTML = '<div class="portfolio-empty-state">' +
            '<h3>No Resource Assignments</h3>' +
            '<p>Assign resources to tasks using the [Resource] syntax in your project plans.</p>' +
            '</div>';
        return;
    }

    // Sort by workload (overloaded first)
    const workloadOrder = { 'overloaded': 0, 'high': 1, 'medium': 2, 'low': 3 };
    resources.sort((a, b) => workloadOrder[a.workloadLevel] - workloadOrder[b.workloadLevel]);

    let html = '<div class="portfolio-resources-header">' +
        '<h2>Resource Allocation Dashboard</h2>' +
        '<div class="portfolio-resources-summary">' +
        '<div class="resource-summary-item">' +
        '<span class="summary-label">Total Resources:</span>' +
        '<span class="summary-value">' + resources.length + '</span>' +
        '</div>' +
        '<div class="resource-summary-item">' +
        '<span class="summary-label">Total Tasks:</span>' +
        '<span class="summary-value">' + resources.reduce((sum, r) => sum + r.totalTasks, 0) + '</span>' +
        '</div>' +
        '<div class="resource-summary-item">' +
        '<span class="summary-label">In Progress:</span>' +
        '<span class="summary-value">' + resources.reduce((sum, r) => sum + r.inProgressTasks, 0) + '</span>' +
        '</div>' +
        '</div>' +
        '</div>';

    html += '<div class="portfolio-resources-table-wrapper">' +
        '<table class="portfolio-resources-table">' +
        '<thead>' +
        '<tr>' +
        '<th onclick="sortPortfolioResources(\'name\')">Resource <span class="sort-indicator"></span></th>' +
        '<th onclick="sortPortfolioResources(\'projects\')">Projects <span class="sort-indicator"></span></th>' +
        '<th onclick="sortPortfolioResources(\'tasks\')">Total Tasks <span class="sort-indicator"></span></th>' +
        '<th onclick="sortPortfolioResources(\'inProgress\')">In Progress <span class="sort-indicator"></span></th>' +
        '<th onclick="sortPortfolioResources(\'completion\')">Completion <span class="sort-indicator"></span></th>' +
        '<th onclick="sortPortfolioResources(\'workload\')">Workload <span class="sort-indicator"></span></th>' +
        '<th>Details</th>' +
        '</tr>' +
        '</thead>' +
        '<tbody>';

    resources.forEach(resource => {
        const workloadClass = getWorkloadBadgeClass(resource.workloadLevel);
        const projectsList = resource.projects.join(', ');

        html += '<tr class="resource-row" data-resource="' + escapeHtml(resource.name) + '">' +
            '<td class="resource-name">' + escapeHtml(resource.name) + '</td>' +
            '<td><span class="project-count-badge">' + resource.projectCount + '</span> ' +
            '<span class="projects-tooltip" title="' + escapeHtml(projectsList) + '">' +
            (resource.projectCount === 1 ? resource.projects[0] : resource.projectCount + ' projects') +
            '</span></td>' +
            '<td>' + resource.totalTasks + '</td>' +
            '<td class="in-progress-count">' + resource.inProgressTasks + '</td>' +
            '<td>' +
            '<div class="progress-bar-container">' +
            '<div class="progress-bar" style="width: ' + resource.completionRate + '%"></div>' +
            '<span class="progress-text">' + resource.completionRate + '%</span>' +
            '</div>' +
            '</td>' +
            '<td><span class="workload-badge ' + workloadClass + '">' +
            resource.workloadLevel.toUpperCase() + '</span></td>' +
            '<td><button class="btn-small" onclick="showResourceDetails(\'' + escapeHtml(resource.name) + '\')">View</button></td>' +
            '</tr>';
    });

    html += '</tbody></table></div>';

    // Resource details modal placeholder
    html += '<div id="resourceDetailsModal" class="resource-details-modal" style="display: none;">' +
        '<div class="resource-details-content">' +
        '<span class="close-btn" onclick="closeResourceDetails()">&times;</span>' +
        '<div id="resourceDetailsBody"></div>' +
        '</div>' +
        '</div>';

    container.innerHTML = html;

    // Store data for sorting and details
    window.portfolioResourcesData = resources;
}

/**
 * Show resource details modal
 */
function showResourceDetails(resourceName) {
    if (!window.portfolioResourcesData) return;

    const resource = window.portfolioResourcesData.find(r => r.name === resourceName);
    if (!resource) return;

    const modal = document.getElementById('resourceDetailsModal');
    const body = document.getElementById('resourceDetailsBody');

    let html = '<h2>' + escapeHtml(resource.name) + ' - Task Details</h2>';

    html += '<div class="resource-details-summary">' +
        '<div class="detail-stat">' +
        '<span class="stat-label">Total Tasks:</span>' +
        '<span class="stat-value">' + resource.totalTasks + '</span>' +
        '</div>' +
        '<div class="detail-stat">' +
        '<span class="stat-label">Completed:</span>' +
        '<span class="stat-value">' + resource.completedTasks + '</span>' +
        '</div>' +
        '<div class="detail-stat">' +
        '<span class="stat-label">In Progress:</span>' +
        '<span class="stat-value">' + resource.inProgressTasks + '</span>' +
        '</div>' +
        '<div class="detail-stat">' +
        '<span class="stat-label">Not Started:</span>' +
        '<span class="stat-value">' + resource.notStartedTasks + '</span>' +
        '</div>' +
        '</div>';

    html += '<h3>Assignments by Project</h3>';

    // Group assignments by project
    const byProject = {};
    resource.assignments.forEach(assignment => {
        if (!byProject[assignment.projectName]) {
            byProject[assignment.projectName] = [];
        }
        byProject[assignment.projectName].push(assignment);
    });

    Object.keys(byProject).forEach(projectName => {
        html += '<div class="project-assignments">' +
            '<h4 onclick="switchToProjectByName(\'' + escapeHtml(projectName) + '\')" style="cursor: pointer; color: #667eea;">' +
            escapeHtml(projectName) + '</h4>' +
            '<table class="assignments-table">' +
            '<thead>' +
            '<tr>' +
            '<th>Task</th>' +
            '<th>Phase</th>' +
            '<th>Status</th>' +
            '<th>Completion</th>' +
            '</tr>' +
            '</thead>' +
            '<tbody>';

        byProject[projectName].forEach(assignment => {
            const statusClass = 'status-' + assignment.status;
            html += '<tr>' +
                '<td>' + escapeHtml(assignment.task) + '</td>' +
                '<td>' + escapeHtml(assignment.phase) + '</td>' +
                '<td><span class="task-status-badge ' + statusClass + '">' +
                assignment.status.replace('-', ' ') + '</span></td>' +
                '<td>' + assignment.completion + '%</td>' +
                '</tr>';
        });

        html += '</tbody></table></div>';
    });

    body.innerHTML = html;
    modal.style.display = 'block';
}

/**
 * Close resource details modal
 */
function closeResourceDetails() {
    const modal = document.getElementById('resourceDetailsModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

/**
 * Switch to project by name
 */
function switchToProjectByName(projectName) {
    const projects = getAllProjects();
    const project = Object.values(projects).find(p => p.name === projectName);

    if (project) {
        switchToProject(project.id);
        closeResourceDetails();
    }
}

/**
 * Sort portfolio resources table
 */
let portfolioResourcesSortColumn = 'workload';
let portfolioResourcesSortAsc = true;

function sortPortfolioResources(column) {
    if (portfolioResourcesSortColumn === column) {
        portfolioResourcesSortAsc = !portfolioResourcesSortAsc;
    } else {
        portfolioResourcesSortColumn = column;
        portfolioResourcesSortAsc = true;
    }

    if (!window.portfolioResourcesData) return;

    const data = [...window.portfolioResourcesData];

    data.sort((a, b) => {
        let valA, valB;

        switch (column) {
            case 'name':
                valA = a.name.toLowerCase();
                valB = b.name.toLowerCase();
                break;
            case 'projects':
                valA = a.projectCount;
                valB = b.projectCount;
                break;
            case 'tasks':
                valA = a.totalTasks;
                valB = b.totalTasks;
                break;
            case 'inProgress':
                valA = a.inProgressTasks;
                valB = b.inProgressTasks;
                break;
            case 'completion':
                valA = a.completionRate;
                valB = b.completionRate;
                break;
            case 'workload':
                const workloadOrder = { 'overloaded': 0, 'high': 1, 'medium': 2, 'low': 3 };
                valA = workloadOrder[a.workloadLevel];
                valB = workloadOrder[b.workloadLevel];
                break;
            default:
                return 0;
        }

        if (valA < valB) return portfolioResourcesSortAsc ? -1 : 1;
        if (valA > valB) return portfolioResourcesSortAsc ? 1 : -1;
        return 0;
    });

    window.portfolioResourcesData = data;
    renderPortfolioResources();
}

// Close modal when clicking outside
if (typeof window !== 'undefined') {
    window.addEventListener('click', (event) => {
        const modal = document.getElementById('resourceDetailsModal');
        if (modal && event.target === modal) {
            closeResourceDetails();
        }
    });
}
