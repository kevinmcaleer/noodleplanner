/**
 * Portfolio Management UI
 * Interface for managing multiple projects
 */

/**
 * Initialize portfolio view
 */
function initPortfolio() {
    // Re-render whichever sub-view was last active, defaulting to projects
    switchPortfolioView(currentPortfolioSubview || 'projects');
}

/** The portfolio sub-view last shown (#1380), read by phone-shell.js. */
let currentPortfolioSubview = 'projects';

/**
 * Switch between portfolio views
 */
function switchPortfolioView(viewName) {
    // Hide all portfolio views and remove timeline flex class
    const views = ['portfolioProjectsList', 'portfolioStatusView', 'portfolioResourcesView', 'portfolioTimelineView', 'portfolioActionsView', 'portfolioRisksView', 'portfolioLookAheadView', 'portfolioDependenciesView', 'portfolioBenefitsView', 'portfolioLessonsView'];
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
    } else if (viewName === 'lessons') {
        selectedViewId = 'portfolioLessonsView';
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

    // The phone's drawer marks the current portfolio view (#1380). These are
    // sub-views inside one router view, so the router's viewchange does not
    // cover them.
    currentPortfolioSubview = viewName;
    document.dispatchEvent(new CustomEvent('portfolioviewchange', { detail: { view: viewName } }));

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
        case 'lessons':
            if (typeof renderPortfolioLessons === 'function') {
                renderPortfolioLessons();
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
        container.innerHTML = '<np-empty-state variant="card" heading="No Projects Yet">' +
            '<p>Create your first project to get started.</p>' +
            '<button class="btn-primary" slot="actions" onclick="showCreateProjectDialog()">+ Create Project</button>' +
            '</np-empty-state>';
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

    // Switch to Editor tab via NavigationController so the currently active
    // view (e.g. Backstage) properly deactivates -- switchMainTab() only
    // toggles .tab-content classes directly and skips that lifecycle, which
    // left body.backstage-fullscreen (and the ribbon it hides) stuck on
    // after opening a project from Backstage's Recents list (#1044).
    if (typeof switchToView === 'function') {
        switchToView('editor');
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
 * A small "name it" modal in the app's own dialog shell (task-form-modal,
 * the same one the programme dialogs use), replacing the browser's native
 * prompt() for creating a project, initiative or programme (#1493).
 *
 * opts: { title, label, placeholder, submitLabel, hint, validate(name) -> error|'' ,
 *         onSubmit(name) }. Esc, a click on the backdrop and Cancel close it;
 * Enter submits; focus lands in the field and returns to the opener on close.
 */
function showNameDialog(opts) {
    closeNameDialog();
    const opener = document.activeElement;
    const overlay = document.createElement('div');
    overlay.id = 'nameDialogOverlay';
    overlay.className = 'modal-overlay active';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'nameDialogTitle');
    overlay.innerHTML =
        '<div class="task-form-modal name-dialog">' +
        '<div class="modal-header">' +
        `<h3 id="nameDialogTitle" style="margin:0;">${escapeHtml(opts.title)}</h3>` +
        '<np-close-button data-name-dialog-cancel></np-close-button>' +
        '</div>' +
        '<div class="modal-body">' +
        '<form id="nameDialogForm" novalidate>' +
        '<div class="form-group">' +
        `<label for="nameDialogInput">${escapeHtml(opts.label || 'Name')}</label>` +
        `<input type="text" id="nameDialogInput" class="form-control" maxlength="200" autocomplete="off" ` +
        `placeholder="${escapeHtml(opts.placeholder || '')}" aria-describedby="nameDialogError">` +
        (opts.hint ? `<small class="name-dialog-hint">${escapeHtml(opts.hint)}</small>` : '') +
        '<div id="nameDialogError" class="name-dialog-error" role="alert" hidden></div>' +
        '</div>' +
        '<div class="name-dialog-actions">' +
        '<button type="button" class="btn-secondary" data-name-dialog-cancel>Cancel</button>' +
        `<button type="submit" class="btn-primary">${escapeHtml(opts.submitLabel || 'Create')}</button>` +
        '</div>' +
        '</form>' +
        '</div>' +
        '</div>';
    document.body.appendChild(overlay);

    const input = overlay.querySelector('#nameDialogInput');
    const errorEl = overlay.querySelector('#nameDialogError');
    const close = () => {
        overlay.remove();
        document.removeEventListener('keydown', onKey, true);
        if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus();
    };
    const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    };
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay || e.target.closest('[data-name-dialog-cancel]')) close();
    });
    overlay.querySelector('#nameDialogForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const name = input.value.trim();
        const error = !name ? 'Enter a name.' : (opts.validate ? opts.validate(name) : '');
        if (error) {
            errorEl.textContent = error;
            errorEl.hidden = false;
            input.setAttribute('aria-invalid', 'true');
            input.focus();
            return;
        }
        close();
        opts.onSubmit(name);
    });
    input.addEventListener('input', () => {
        errorEl.hidden = true;
        input.removeAttribute('aria-invalid');
    });
    input.focus();
}

function closeNameDialog() {
    const overlay = document.getElementById('nameDialogOverlay');
    if (overlay) overlay.remove();
}

/** Create a project/initiative from `name` and switch to it (shared tail of both dialogs). */
function _createAndOpenProject(name, planText, noun) {
    // Save current project state before creating/switching
    if (typeof saveCurrentProjectState === 'function') {
        saveCurrentProjectState();
    }

    const project = createProject(name, planText);
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
        showNotification(noun + ' created: ' + project.name);
    }
}

/**
 * Show create project dialog
 */
function showCreateProjectDialog() {
    showNameDialog({
        title: 'New Project',
        label: 'Project name',
        placeholder: 'e.g. Website relaunch',
        submitLabel: 'Create project',
        onSubmit: (name) => _createAndOpenProject(name, undefined, 'Project'),
    });
}

/**
 * Show create initiative dialog (#1478). Same flow as a project, seeded
 * with the minimal initiative template (`type: initiative`, a task list).
 */
function showCreateInitiativeDialog() {
    showNameDialog({
        title: 'New Initiative',
        label: 'Initiative name',
        placeholder: 'e.g. Reduce onboarding time',
        submitLabel: 'Create initiative',
        onSubmit: (name) => _createAndOpenProject(name, buildInitiativeTemplate(name), 'Initiative'),
    });
}

/**
 * Show create programme dialog (#1491). A programme created here starts
 * empty (see createProgramme in portfolio-projects-table.js); projects and
 * initiatives join it by drag handle or the Group into programme action.
 */
function showCreateProgrammeDialog() {
    showNameDialog({
        title: 'New Programme',
        label: 'Programme name',
        placeholder: 'e.g. Digital Transformation',
        submitLabel: 'Create programme',
        hint: 'Add projects and initiatives to it afterwards from the Projects view.',
        validate: (name) => {
            const slug = slugify(name);
            if (!slug) return 'Use letters or numbers in the name.';
            const projects = (typeof loadAllProjectsIntoCache === 'function') ? loadAllProjectsIntoCache() : listProjects();
            return deriveProgrammes(projects).some((p) => p.slug === slug)
                ? 'A programme with that name already exists.' : '';
        },
        onSubmit: (name) => {
            const result = createProgramme(name);
            if (!result.ok) { showNotification(result.error); return; }
            if (typeof refreshProjectSelectors === 'function') refreshProjectSelectors();
            if (typeof switchToView === 'function') switchToView('portfolio');
            if (typeof switchPortfolioView === 'function') switchPortfolioView('projects');
            if (typeof renderProjectsTable === 'function') renderProjectsTable();
            showNotification('Programme created: ' + result.name);
        },
    });
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
