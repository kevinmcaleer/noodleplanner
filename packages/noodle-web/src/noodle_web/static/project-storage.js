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
    if (typeof setStatusMessage === 'function') {
        setStatusMessage(message, persistent ? 0 : 8000, persistent ? 'storage-failure' : null);
    }
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
    if (typeof clearStatusLogEntry === 'function') clearStatusLogEntry('storage-failure');
    if (typeof setStatusMessage === 'function') setStatusMessage('Saved \u2014 browser storage is working again', 5000);
}

function getLastStorageFailure() {
    return lastStorageFailure;
}

// ---------------------------------------------------------------------------
// Backing store (issue #794)
//
// When project-store.js has an IndexedDB database the functions below read
// and write its in-memory copy and the store writes through in the
// background. When IndexedDB is unavailable they fall back to the original
// localStorage blob, quota handling and all.
// ---------------------------------------------------------------------------

function projectStoreActive() {
    return typeof NoodleStore !== 'undefined' && NoodleStore && NoodleStore.isActive();
}

/**
 * Get all projects from local storage
 */
function getAllProjects() {
    if (projectStoreActive()) return NoodleStore.getAllProjects();
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
    if (projectStoreActive()) {
        // Only the records that changed are written, in the background. A
        // write that fails later is reported by the store through
        // reportStorageFailure(); the in-memory copy stays authoritative.
        NoodleStore.replaceProjects(projects);
        return true;
    }
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

    // Drop any retained on-disk file link for this project (issue #767)
    if (typeof LocalFileAccess !== 'undefined') {
        LocalFileAccess.unlink(projectId);
    }

    // Remove version history for the deleted project
    if (projectStoreActive()) {
        NoodleStore.deleteVersionHistory(projectId);
    } else {
        try {
            localStorage.removeItem('noodle_history_' + projectId);
        } catch (e) {
            // Ignore errors if key does not exist
        }
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

    // #968: the project record now holds this content, so a collab
    // crash-recovery snapshot for it (collab-autosave.js, via
    // collab-session.js's clearCollabAutosaveForProject) is redundant --
    // this fires on every save, explicit or the periodic autosave, which
    // is deliberately broader than "explicit save only": either way the
    // real record is now authoritative, so there is nothing left to
    // recover that isn't already saved.
    if (result && typeof clearCollabAutosaveForProject === 'function') {
        clearCollabAutosaveForProject(projectId).catch(() => {});
    }

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

// ---------------------------------------------------------------------------
// Whole-store backup and restore, and the Storage settings tab (issue #794)
// ---------------------------------------------------------------------------

function formatStorageBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
}

/**
 * Download everything in the store — every project, its version history
 * and the programme dependencies — as one JSON file. The same file restores
 * on another machine through restoreStoreBackup() or a drop on the window.
 */
function downloadStoreBackup() {
    let data;
    if (projectStoreActive()) {
        data = NoodleStore.exportSnapshot();
    } else {
        // Legacy store: assemble the same shape from localStorage.
        const projects = getAllProjects();
        const versions = [];
        Object.keys(projects).forEach(function (id) {
            const history = (typeof getVersionHistory === 'function') ? getVersionHistory(id) : [];
            if (history.length) versions.push({ projectId: id, entries: history });
        });
        const meta = {};
        if (typeof getAllProgrammeDependencies === 'function') {
            const deps = getAllProgrammeDependencies();
            if (deps.length) meta.programmeDependencies = deps;
        }
        data = { format: 'noodleplanner-store', formatVersion: 1, exportedAt: new Date().toISOString(),
            projects: Object.values(projects), versions: versions, meta: meta };
    }
    const json = JSON.stringify(data);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'noodleplanner-backup-' + new Date().toISOString().split('T')[0] + '.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    if (typeof setStatusMessage === 'function') {
        setStatusMessage('Backup downloaded: ' + data.projects.length + ' project' + (data.projects.length === 1 ? '' : 's') +
            ', ' + formatStorageBytes(json.length), 6000);
    }
    return data;
}

/**
 * Restore a backup made by downloadStoreBackup(). Projects already in this
 * browser are kept; the backup's other projects, their history and any
 * programme dependencies are added. Returns the import summary or null.
 */
function restoreStoreBackupFromJSON(jsonData) {
    let data;
    try {
        data = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
    } catch (e) {
        return null;
    }
    if (!data || data.format !== 'noodleplanner-store' || !Array.isArray(data.projects)) return null;
    let result;
    if (projectStoreActive()) {
        result = NoodleStore.importSnapshot(data, { mode: 'merge' });
    } else {
        const projects = getAllProjects();
        result = { mode: 'merge', projects: 0, skipped: 0, snapshots: 0, dependencies: 0 };
        data.projects.forEach(function (p) {
            if (!p || !p.id || typeof p.planText !== 'string' || projects[p.id]) { result.skipped++; return; }
            projects[p.id] = p;
            result.projects++;
        });
        if (!saveAllProjects(projects)) return null;
        (data.versions || []).forEach(function (v) {
            if (v && v.projectId && projects[v.projectId] && typeof saveVersionHistory === 'function' &&
                typeof getVersionHistory === 'function' && getVersionHistory(v.projectId).length === 0) {
                saveVersionHistory(v.projectId, v.entries || []);
                result.snapshots += (v.entries || []).length;
            }
        });
    }
    if (typeof clearProjectCache === 'function') clearProjectCache();
    if (typeof loadAllProjectsIntoCache === 'function') loadAllProjectsIntoCache();
    if (typeof refreshProjectSelectors === 'function') refreshProjectSelectors();
    if (typeof renderProjectsList === 'function') {
        try { renderProjectsList(); } catch (e) { /* portfolio not showing */ }
    }
    return result;
}

/** File picker for restoreStoreBackupFromJSON(). */
function restoreStoreBackup() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = function () {
        const file = input.files && input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function (e) {
            const result = restoreStoreBackupFromJSON(e.target.result);
            if (!result) {
                if (typeof showToast === 'function') showToast(file.name + ' is not a NoodlePlanner backup', 'error');
                return;
            }
            const msg = 'Restored ' + result.projects + ' project' + (result.projects === 1 ? '' : 's') +
                (result.snapshots ? ' and ' + result.snapshots + ' version snapshot' + (result.snapshots === 1 ? '' : 's') : '') +
                (result.skipped ? ' (' + result.skipped + ' already here, kept)' : '');
            if (typeof showToast === 'function') showToast(msg, 'success');
            if (typeof setStatusMessage === 'function') setStatusMessage(msg, 8000);
            renderStorageSettings();
        };
        reader.readAsText(file);
    };
    input.click();
}

/** Remove the pre-migration localStorage copy, after the user confirms. */
function removeLegacyStorageCopy() {
    if (!projectStoreActive()) return;
    const legacy = NoodleStore.legacyDataPresent();
    if (!legacy) return;
    const ok = confirm('Remove the old copy of ' + legacy.projects + ' project' + (legacy.projects === 1 ? '' : 's') +
        ' and ' + legacy.snapshots + ' version snapshot' + (legacy.snapshots === 1 ? '' : 's') +
        ' from localStorage?\n\nThis copy has not been updated since your projects moved to the new store, ' +
        'so nothing you have done since then is in it. Your current projects are not affected.');
    if (!ok) return;
    NoodleStore.cleanupLegacyStorage();
    if (typeof showToast === 'function') showToast('Old localStorage copy removed', 'success');
    renderStorageSettings();
}

/** Fill the Storage tab of the settings panel. Safe to call when it is absent. */
function renderStorageSettings() {
    const el = document.getElementById('storageSettingsSummary');
    if (!el) return;
    const active = projectStoreActive();
    const lines = [];
    if (active) {
        const u = NoodleStore.usage();
        lines.push('<p><strong>Store:</strong> IndexedDB (' + NoodleStore.DB_NAME + ')</p>');
        lines.push('<p>' + u.projects + ' project' + (u.projects === 1 ? '' : 's') + ' (' + formatStorageBytes(u.planBytes) + ' of plan text), ' +
            u.snapshots + ' version snapshot' + (u.snapshots === 1 ? '' : 's') + ' (' + formatStorageBytes(u.snapshotBytes) + ')</p>');
        const failure = getLastStorageFailure();
        if (failure) lines.push('<p class="storage-settings-warning">' + failure.message + '</p>');
    } else {
        const projects = getAllProjects();
        const reason = (typeof NoodleStore !== 'undefined' && NoodleStore.failure()) ? NoodleStore.failure().message : 'IndexedDB is not available';
        lines.push('<p><strong>Store:</strong> localStorage (fallback: ' + reason + ')</p>');
        lines.push('<p>' + Object.keys(projects).length + ' project' + (Object.keys(projects).length === 1 ? '' : 's') +
            '. localStorage is limited to about 5 MB; download a backup regularly.</p>');
    }
    el.innerHTML = lines.join('');

    const quotaEl = document.getElementById('storageSettingsQuota');
    if (quotaEl && typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
        navigator.storage.estimate().then(function (est) {
            if (est && est.quota) {
                quotaEl.textContent = 'This site may use up to ' + formatStorageBytes(est.quota) +
                    ' of browser storage; ' + formatStorageBytes(est.usage || 0) + ' in use.';
            }
        }).catch(function () { /* not available */ });
    }

    const legacyEl = document.getElementById('storageSettingsLegacy');
    if (legacyEl) {
        const legacy = active ? NoodleStore.legacyDataPresent() : null;
        if (legacy) {
            const m = NoodleStore.migrationSummary();
            legacyEl.style.display = '';
            legacyEl.innerHTML =
                '<h4>Old localStorage copy</h4>' +
                '<p>Your projects moved to the new store' + (m && m.at ? ' on ' + new Date(m.at).toLocaleDateString() : '') +
                '. The copy left in localStorage (' + legacy.projects + ' project' + (legacy.projects === 1 ? '' : 's') + ', ' +
                legacy.snapshots + ' snapshot' + (legacy.snapshots === 1 ? '' : 's') + ', ' + formatStorageBytes(legacy.bytes) +
                ') is no longer updated. Once you are happy everything is here, you can remove it.</p>' +
                '<button type="button" class="btn-secondary" onclick="removeLegacyStorageCopy()">Remove old copy</button>';
        } else {
            legacyEl.style.display = 'none';
            legacyEl.innerHTML = '';
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        isStorageQuotaError,
        reportStorageFailure,
        getLastStorageFailure,
        projectStoreActive,
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
        downloadStoreBackup,
        restoreStoreBackupFromJSON,
        renderStorageSettings,
    };
}
