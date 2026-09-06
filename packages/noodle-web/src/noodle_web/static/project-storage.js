/**
 * Project Storage Manager
 * Manages multiple project plans in browser local storage
 */

// Local storage keys
const PROJECTS_KEY = 'noodleplanner_projects';
const CURRENT_PROJECT_KEY = 'noodleplanner_current_project';

// ---------------------------------------------------------------------------
// Failure reporting (issue #794)
//
// Every write path funnels through saveAllProjects() or saveVersionHistory(),
// and until #794 both swallowed the error: a console line and `false` that no
// caller checked. A user with a handful of versioned projects hit the ~5 MB
// localStorage quota and silently lost every edit from then on. The storage
// layer now reports failures itself, so a caller that ignores the return
// value can no longer hide one from the user.
// ---------------------------------------------------------------------------

/** True when a storage exception means the browser's quota is exhausted. */
function isStorageQuotaError(error) {
    if (!error) return false;
    if (error.name === 'QuotaExceededError') return true;                // WebKit / Blink / spec
    if (error.name === 'NS_ERROR_DOM_QUOTA_REACHED') return true;         // Firefox
    return error.code === 22 || error.code === 1014;                     // legacy numeric codes
}

// The most recent unresolved failure, or null. Tests and the storage settings
// panel read this; a successful save clears it.
let lastStorageFailure = null;
const storageNoticeTimes = {};

/**
 * Show a storage notice once per `what` per minute. The 30 s autosave would
 * otherwise re-raise the same toast for as long as the store stays full; the
 * persistent status-bar line is what keeps the user informed in between.
 */
function showStorageNotice(what, message, type, persistent) {
    if (typeof setStatusMessage === 'function') setStatusMessage(message, persistent ? 0 : 8000);
    const now = Date.now();
    if (typeof showToast === 'function' && !(storageNoticeTimes[what] > now - 60000)) {
        storageNoticeTimes[what] = now;
        showToast(message, type);
    }
}

/**
 * Tell the user a write failed and remember it. Returns the message shown.
 */
function reportStorageFailure(what, error) {
    const quota = isStorageQuotaError(error);
    const message = quota
        ? 'Browser storage is full \u2014 ' + what + ' could not be saved. ' +
          'Download your plan now (Export \u2192 Markdown), then delete old projects or version history to free space.'
        : 'Could not save ' + what + ' to browser storage' +
          (error && error.message ? ' (' + error.message + ')' : '') +
          '. Download your plan to keep a copy.';
    lastStorageFailure = { what: what, quota: quota, message: message, error: error, at: Date.now() };
    console.error('Storage failure (' + what + '):', error);
    showStorageNotice(what, message, 'error', true);
    return message;
}

/** Called after a successful write: clears a standing failure notice. */
function clearStorageFailure() {
    if (!lastStorageFailure) return;
    lastStorageFailure = null;
    if (typeof setStatusMessage === 'function') setStatusMessage('Saved \u2014 browser storage is working again', 5000);
}

function getLastStorageFailure() {
    return lastStorageFailure;
}

/**
 * Get all projects from local storage
 */
function getAllProjects() {
    try {
        const projectsJson = localStorage.getItem(PROJECTS_KEY);
        return projectsJson ? JSON.parse(projectsJson) : {};
    } catch (error) {
        console.error('Error loading projects:', error);
        return {};
    }
}

/**
 * Save all projects to local storage.
 *
 * Returns true when the write landed. On a quota error the plan text wins
 * over version history: older snapshots are evicted (freeVersionHistorySpace
 * in version-history.js) and the write retried, and the user is told either
 * way. Returns false only after the user has been shown the failure.
 */
function saveAllProjects(projects) {
    const json = JSON.stringify(projects);
    let error = null;
    let evicted = 0;
    for (let attempt = 0; attempt < 8; attempt++) {
        try {
            localStorage.setItem(PROJECTS_KEY, json);
            if (evicted > 0) {
                showStorageNotice('history-evicted',
                    'Browser storage was full: ' + evicted + ' older plan version' + (evicted === 1 ? '' : 's') +
                    ' were removed so your plan could be saved. Consider downloading a backup.',
                    'warning', false);
            }
            clearStorageFailure();
            return true;
        } catch (e) {
            error = e;
            if (!isStorageQuotaError(e)) break;
            const freed = (typeof freeVersionHistorySpace === 'function') ? freeVersionHistorySpace() : 0;
            if (!freed) break;
            evicted += freed;
        }
    }
    reportStorageFailure('your projects', error);
    return false;
}

/**
 * Create a new project
 */
function createProject(name) {
    const projects = getAllProjects();
    const projectId = 'project-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);

    const newProject = {
        id: projectId,
        name: name || 'Untitled Project',
        planText: '',
        createdAt: Date.now(),
        updatedAt: Date.now()
    };

    projects[projectId] = newProject;
    // A failed write has already been reported to the user; the project is
    // still returned so the editor keeps working and the text can be downloaded.
    saveAllProjects(projects);

    return newProject;
}

/**
 * Save a project
 */
function saveProject(projectId, projectData) {
    const projects = getAllProjects();

    if (!projects[projectId]) {
        console.error('Project not found:', projectId);
        return false;
    }

    projects[projectId] = {
        ...projects[projectId],
        ...projectData,
        updatedAt: Date.now()
    };

    return saveAllProjects(projects);
}

/**
 * Load a project
 */
function loadProject(projectId) {
    const projects = getAllProjects();
    return projects[projectId] || null;
}

/**
 * Delete a project
 */
function deleteProject(projectId) {
    const projects = getAllProjects();

    if (!projects[projectId]) {
        console.error('Project not found:', projectId);
        return false;
    }

    delete projects[projectId];

    // If deleting current project, clear current project ID
    if (getCurrentProjectId() === projectId) {
        localStorage.removeItem(CURRENT_PROJECT_KEY);
    }

    // Remove version history for the deleted project
    try {
        localStorage.removeItem('noodle_history_' + projectId);
    } catch (e) {
        // Ignore errors if key does not exist
    }

    return saveAllProjects(projects);
}

/**
 * List all projects
 */
function listProjects() {
    const projects = getAllProjects();
    return Object.values(projects).sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Get current project ID
 */
function getCurrentProjectId() {
    return localStorage.getItem(CURRENT_PROJECT_KEY);
}

/**
 * Set current project ID
 */
function setCurrentProjectId(projectId) {
    if (projectId) {
        localStorage.setItem(CURRENT_PROJECT_KEY, projectId);
    } else {
        localStorage.removeItem(CURRENT_PROJECT_KEY);
    }
}

/**
 * Get current project
 */
function getCurrentProject() {
    const projectId = getCurrentProjectId();
    return projectId ? loadProject(projectId) : null;
}

/**
 * Save current project state.
 *
 * Returns true when the plan text was written to storage, false otherwise.
 * A false result has already been shown to the user by the storage layer;
 * callers may use it to decide whether to proceed (e.g. before switching
 * project) but need not report it again.
 */
function saveCurrentProjectState() {
    const projectId = getCurrentProjectId();
    if (!projectId) return false;

    const planEditor = document.getElementById('planEditor');
    if (!planEditor) return false;

    // Skip saving if we are in read-only version preview mode
    if (typeof versionHistoryReadOnly !== 'undefined' && versionHistoryReadOnly) {
        return false;
    }

    // Save a version history snapshot before overwriting
    if (typeof saveVersionSnapshot === 'function') {
        saveVersionSnapshot(projectId);
    }

    // Update last_saved timestamp in front matter before saving
    if (typeof setLastSavedInFrontMatter === 'function') {
        const updated = setLastSavedInFrontMatter(planEditor.value);
        if (updated !== planEditor.value) {
            if (typeof setEditorValuePreservingCursor === 'function') {
                setEditorValuePreservingCursor(planEditor, updated);
            } else {
                planEditor.value = updated;
            }
            // Also update kanban editor if it exists
            const kanbanEditor = document.getElementById('kanbanPlanEditor');
            if (kanbanEditor) kanbanEditor.value = updated;
        }
    }

    const planText = planEditor.value;

    const result = saveProject(projectId, {
        planText: planText
    });

    // Update version badge in status bar
    if (typeof updateVersionBadge === 'function') {
        updateVersionBadge();
    }

    return result;
}

/**
 * Rename a project
 */
function renameProject(projectId, newName) {
    return saveProject(projectId, { name: newName });
}

/**
 * Export project as JSON
 */
function exportProject(projectId) {
    const project = loadProject(projectId);
    if (!project) return null;

    const dataStr = JSON.stringify(project, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);

    const exportFileDefaultName = project.name.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '.json';

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
}

/**
 * Import project from JSON
 */
function importProject(jsonData) {
    try {
        const project = JSON.parse(jsonData);

        // Generate new ID to avoid conflicts
        const newProjectId = 'project-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        project.id = newProjectId;
        project.importedAt = Date.now();
        project.updatedAt = Date.now();

        const projects = getAllProjects();
        projects[newProjectId] = project;
        if (!saveAllProjects(projects)) {
            return null;
        }

        return project;
    } catch (error) {
        console.error('Error importing project:', error);
        return null;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        isStorageQuotaError,
        reportStorageFailure,
        getLastStorageFailure,
        getAllProjects,
        saveAllProjects,
        createProject,
        saveProject,
        loadProject,
        deleteProject,
        listProjects,
        getCurrentProjectId,
        setCurrentProjectId,
        saveCurrentProjectState,
        importProject,
    };
}
