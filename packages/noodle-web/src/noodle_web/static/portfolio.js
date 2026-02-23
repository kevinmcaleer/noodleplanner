/**
 * Portfolio Management UI
 * Interface for managing multiple projects
 */

/**
 * Initialize portfolio view
 */
function initPortfolio() {
    // Use table view as default
    renderProjectsTable();
}

/**
 * Render the projects list (grid view - legacy)
 */
function renderProjectsList() {
    const container = document.getElementById('portfolioProjectsList');
    if (!container) return;

    const projects = listProjects();
    const currentProjectId = getCurrentProjectId();

    if (projects.length === 0) {
        container.innerHTML = '<div class="portfolio-empty-state">' +
            '<h3>No Projects Yet</h3>' +
            '<p>Create your first project to get started.</p>' +
            '<button class="btn-primary" onclick="showCreateProjectDialog()">+ Create Project</button>' +
            '</div>';
        return;
    }

    let html = '<div class="portfolio-projects-grid">';

    projects.forEach(project => {
        const isActive = project.id === currentProjectId;
        const activeClass = isActive ? 'active' : '';

        const createdDate = new Date(project.createdAt).toLocaleDateString();
        const updatedDate = new Date(project.updatedAt).toLocaleDateString();

        html += '<div class="portfolio-project-card ' + activeClass + '">' +
            '<div class="portfolio-project-header">' +
            '<h3>' + escapeHtml(project.name) + '</h3>' +
            (isActive ? '<span class="portfolio-active-badge">Active</span>' : '') +
            '</div>' +
            '<div class="portfolio-project-meta">' +
            '<div class="portfolio-meta-item"><strong>Created:</strong> ' + createdDate + '</div>' +
            '<div class="portfolio-meta-item"><strong>Updated:</strong> ' + updatedDate + '</div>' +
            '</div>' +
            '<div class="portfolio-project-actions">' +
            '<button class="btn-primary" onclick="switchToProject(\'' + project.id + '\')">Open</button>' +
            '<button class="btn-secondary" onclick="showRenameProjectDialog(\'' + project.id + '\')">Rename</button>' +
            '<button class="btn-secondary" onclick="exportProject(\'' + project.id + '\')">Export</button>' +
            '<button class="btn-danger" onclick="confirmDeleteProject(\'' + project.id + '\')">Delete</button>' +
            '</div>' +
            '</div>';
    });

    html += '</div>';

    container.innerHTML = html;
}

/**
 * Switch to a different project
 */
function switchToProject(projectId) {
    // Save current project before switching
    saveCurrentProjectState();

    // Set new current project
    setCurrentProjectId(projectId);

    // Load the project
    const project = loadProject(projectId);
    if (!project) {
        alert('Error loading project');
        return;
    }

    // Load project into editor
    const planEditor = document.getElementById('planEditor');
    if (planEditor) {
        planEditor.value = project.planText || '';
        updateLineNumbers();
    }

    // Update kanban editor too
    const kanbanEditor = document.getElementById('kanbanPlanEditor');
    if (kanbanEditor) {
        kanbanEditor.value = project.planText || '';
    }

    // Switch to Editor tab
    switchMainTab('editor');

    // Show notification
    showNotification('Switched to project: ' + project.name);
}

/**
 * Show create project dialog
 */
function showCreateProjectDialog() {
    const name = prompt('Enter project name:');
    if (!name) return;

    const project = createProject(name);
    if (project) {
        renderProjectsList();
        showNotification('Project created: ' + project.name);
    }
}

/**
 * Show rename project dialog
 */
function showRenameProjectDialog(projectId) {
    const project = loadProject(projectId);
    if (!project) return;

    const newName = prompt('Enter new project name:', project.name);
    if (!newName || newName === project.name) return;

    if (renameProject(projectId, newName)) {
        renderProjectsList();
        showNotification('Project renamed to: ' + newName);
    }
}

/**
 * Confirm delete project
 */
function confirmDeleteProject(projectId) {
    const project = loadProject(projectId);
    if (!project) return;

    if (!confirm('Are you sure you want to delete "' + project.name + '"? This cannot be undone.')) {
        return;
    }

    if (deleteProject(projectId)) {
        renderProjectsList();
        showNotification('Project deleted: ' + project.name);
    }
}

/**
 * Show import project dialog
 */
function showImportProjectDialog() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = function(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function(e) {
            const project = importProject(e.target.result);
            if (project) {
                renderProjectsList();
                showNotification('Project imported: ' + project.name);
            } else {
                alert('Error importing project');
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

/**
 * Show notification
 */
function showNotification(message) {
    // Simple notification - can be enhanced with a toast system
    console.log('Notification:', message);
    // You could add a toast notification here if the UI supports it
}

/**
 * Switch main tab
 */
function switchMainTab(tabName) {
    // Hide all tabs
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });

    // Show selected tab
    const selectedTab = document.getElementById(tabName + '-tab');
    if (selectedTab) {
        selectedTab.classList.add('active');
    }

    // Update tab buttons
    document.querySelectorAll('.tab').forEach(btn => {
        btn.classList.remove('active');
    });

    const selectedBtn = document.getElementById(tabName + 'Tab');
    if (selectedBtn) {
        selectedBtn.classList.add('active');
    }
}

/**
 * Auto-save current project periodically
 */
function startAutoSave() {
    setInterval(() => {
        if (getCurrentProjectId()) {
            saveCurrentProjectState();
        }
    }, 30000); // Auto-save every 30 seconds
}

// Initialize auto-save on page load
if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', () => {
        startAutoSave();
    });
}
