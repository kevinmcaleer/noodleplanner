/**
 * Portfolio Management UI
 * Interface for managing multiple projects
 */

/**
 * Initialize portfolio view
 */
function initPortfolio() {
    // Re-render whichever sub-view was last active, defaulting to projects
    const activeBtn = document.querySelector('.portfolio-subnav-btn.active');
    const lastView = activeBtn ? (activeBtn.getAttribute('onclick') || '').replace(/.*'(\w+)'.*/, '$1') : 'projects';
    switchPortfolioView(lastView || 'projects');
}

/**
 * Switch between portfolio views
 */
function switchPortfolioView(viewName) {
    // Hide all portfolio views and remove timeline flex class
    const views = ['portfolioProjectsList', 'portfolioStatusView', 'portfolioResourcesView', 'portfolioTimelineView', 'portfolioActionsView', 'portfolioRisksView', 'portfolioLookAheadView', 'portfolioDependenciesView', 'portfolioBenefitsView'];
    views.forEach(viewId => {
        const view = document.getElementById(viewId);
        if (view) {
            view.style.display = 'none';
            view.classList.remove('portfolio-timeline-active');
        }
    });

    // Show selected view
    let selectedViewId;
    if (viewName === 'projects') {
        selectedViewId = 'portfolioProjectsList';
    } else if (viewName === 'status') {
        selectedViewId = 'portfolioStatusView';
    } else if (viewName === 'resources') {
        selectedViewId = 'portfolioResourcesView';
    } else if (viewName === 'timeline') {
        selectedViewId = 'portfolioTimelineView';
    } else if (viewName === 'actions') {
        selectedViewId = 'portfolioActionsView';
    } else if (viewName === 'risks') {
        selectedViewId = 'portfolioRisksView';
    } else if (viewName === 'lookahead') {
        selectedViewId = 'portfolioLookAheadView';
    } else if (viewName === 'dependencies') {
        selectedViewId = 'portfolioDependenciesView';
    } else if (viewName === 'benefits') {
        selectedViewId = 'portfolioBenefitsView';
    }

    const selectedView = document.getElementById(selectedViewId);
    if (selectedView) {
        if (viewName === 'timeline') {
            // Timeline needs flex layout to fill available space
            selectedView.style.display = 'flex';
            selectedView.classList.add('portfolio-timeline-active');
        } else {
            selectedView.style.display = 'block';
        }
    }

    // Update sub-nav buttons
    document.querySelectorAll('.portfolio-subnav-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    const selectedBtn = document.querySelector('.portfolio-subnav-btn[onclick*="' + viewName + '"]');
    if (selectedBtn) {
        selectedBtn.classList.add('active');
    }

    // Render the specific view
    switch(viewName) {
        case 'projects':
            // Use table view by default (issue #460)
            if (typeof renderProjectsTable === 'function') {
                renderProjectsTable();
            } else {
                renderProjectsList();
            }
            break;
        case 'status':
            if (typeof renderPortfolioStatus === 'function') {
                renderPortfolioStatus();
            }
            break;
        case 'resources':
            if (typeof renderPortfolioResources === 'function') {
                renderPortfolioResources();
            }
            break;
        case 'timeline':
            if (typeof renderPortfolioTimeline === 'function') {
                renderPortfolioTimeline();
            }
            break;
        case 'actions':
            if (typeof renderPortfolioActions === 'function') {
                renderPortfolioActions();
            }
            break;
        case 'risks':
            if (typeof renderPortfolioRisks === 'function') {
                renderPortfolioRisks();
            }
            break;
        case 'lookahead':
            if (typeof renderPortfolioLookAhead === 'function') {
                renderPortfolioLookAhead();
            }
            break;
        case 'dependencies':
            if (typeof renderPortfolioDependencies === 'function') {
                renderPortfolioDependencies();
            }
            break;
        case 'benefits':
            if (typeof renderPortfolioBenefits === 'function') {
                renderPortfolioBenefits();
            }
            break;
    }
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

    // Delegate to loadProjectIntoEditor which handles generation bumping,
    // editor updates, and the full render pipeline (updateAllViews +
    // deferred renderText).
    if (typeof loadProjectIntoEditor === 'function') {
        loadProjectIntoEditor(projectId);
    }

    // Switch to Editor tab
    switchMainTab('editor');

    // Refresh project selectors and portfolio table active indicator
    if (typeof refreshProjectSelectors === 'function') {
        refreshProjectSelectors();
    }
    if (typeof renderProjectsTable === 'function') {
        renderProjectsTable();
    }

    // Show notification
    const project = loadProject(projectId);
    if (project) {
        showNotification('Switched to project: ' + project.name);
    }
}

/**
 * Open a project and navigate to its dashboard view
 */
function openProjectDashboard(projectId) {
    // Save current project before switching
    saveCurrentProjectState();

    // Delegate to loadProjectIntoEditor which handles generation bumping,
    // editor updates, and the full render pipeline (updateAllViews +
    // deferred renderText).
    if (typeof loadProjectIntoEditor === 'function') {
        loadProjectIntoEditor(projectId);
    }

    // Switch to the dashboard view FIRST so it's visible
    if (typeof switchToView === 'function') {
        switchToView('project-report');
    } else {
        switchMainTab('editor');
    }

    // Refresh project selectors and portfolio table active indicator
    if (typeof refreshProjectSelectors === 'function') {
        refreshProjectSelectors();
    }
    if (typeof renderProjectsTable === 'function') {
        renderProjectsTable();
    }
}

/**
 * Show create project dialog
 */
function showCreateProjectDialog() {
    const name = prompt('Enter project name:');
    if (!name) return;

    // Save current project state before creating/switching
    if (typeof saveCurrentProjectState === 'function') {
        saveCurrentProjectState();
    }

    const project = createProject(name);
    if (project) {
        // Load the new (empty) project into the editor so old plan text is cleared
        if (typeof loadProjectIntoEditor === 'function') {
            loadProjectIntoEditor(project.id);
        }

        renderProjectsList();
        if (typeof refreshProjectSelectors === 'function') {
            refreshProjectSelectors();
        }
        if (typeof renderProjectsTable === 'function') {
            renderProjectsTable();
        }
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
        if (typeof refreshProjectSelectors === 'function') {
            refreshProjectSelectors();
        }
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
        if (typeof refreshProjectSelectors === 'function') {
            refreshProjectSelectors();
        }
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
                if (typeof refreshProjectSelectors === 'function') {
                    refreshProjectSelectors();
                }
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
function showNotification(message, type) {
    if (typeof showToast === 'function') {
        showToast(message, type || 'info');
    } else {
        console.log('Notification:', message);
    }
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

/**
 * Toggle portfolio more menu (three-dot dropdown)
 */
function togglePortfolioMoreMenu(event) {
    event.stopPropagation();
    const menu = document.getElementById('portfolioMoreMenu');
    if (menu) menu.classList.toggle('show');
}

/**
 * Close portfolio more menu
 */
function closePortfolioMoreMenu() {
    const menu = document.getElementById('portfolioMoreMenu');
    if (menu) menu.classList.remove('show');
}

// Close portfolio more menu when clicking outside
document.addEventListener('click', function(e) {
    const wrapper = document.querySelector('.portfolio-more-menu-wrapper');
    if (wrapper && !wrapper.contains(e.target)) {
        closePortfolioMoreMenu();
    }
});

// Initialize auto-save on page load
if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', () => {
        startAutoSave();
    });
}
