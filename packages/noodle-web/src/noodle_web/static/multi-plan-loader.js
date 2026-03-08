/**
 * Multi-Plan Loader
 * Handles loading, caching, and switching between multiple project plans
 */

// In-memory cache for loaded projects
const projectCache = new Map();

// Generation counter incremented on every project switch.
// Async callbacks (updateAllViews, render) check this to discard stale responses.
let projectSwitchGeneration = 0;

/**
 * Load all projects from local storage into cache
 */
function loadAllProjectsIntoCache() {
    try {
        const projects = getAllProjects();
        projectCache.clear();

        Object.values(projects).forEach(project => {
            projectCache.set(project.id, project);
        });

        console.log('Loaded', projectCache.size, 'projects into cache');
        return Array.from(projectCache.values());
    } catch (error) {
        console.error('Error loading projects into cache:', error);
        return [];
    }
}

/**
 * Get a cached project or load it
 */
function getCachedProject(projectId) {
    if (projectCache.has(projectId)) {
        return projectCache.get(projectId);
    }

    const project = loadProject(projectId);
    if (project) {
        projectCache.set(projectId, project);
    }
    return project;
}

/**
 * Update cached project
 */
function updateCachedProject(projectId, updates) {
    const project = getCachedProject(projectId);
    if (project) {
        const updatedProject = { ...project, ...updates, updatedAt: Date.now() };
        projectCache.set(projectId, updatedProject);
        saveProject(projectId, updates);
        return updatedProject;
    }
    return null;
}

/**
 * Load project into editor
 */
function loadProjectIntoEditor(projectId) {
    if (!projectId) {
        return false;
    }

    // Load fresh from localStorage, not from potentially stale cache
    const project = loadProject(projectId);
    if (!project) {
        console.warn('Project not found:', projectId);
        return false;
    }

    // Update cache with fresh data
    projectCache.set(projectId, project);

    // Bump generation counter so any in-flight async responses from a
    // previous project are discarded when they complete
    projectSwitchGeneration++;

    // Set current project ID BEFORE touching the editor or dispatching events,
    // so any event handlers that fire (debounced renderText, auto-save, etc.)
    // reference the correct project
    setCurrentProjectId(projectId);

    // Clear RAID log entries and highlights before loading new plan
    if (typeof clearPlanTrackingData === 'function') {
        clearPlanTrackingData();
    }

    const planText = project.planText || '';

    const planEditor = document.getElementById('planEditor');
    if (planEditor) {
        planEditor.value = planText;
    }

    const kanbanEditor = document.getElementById('kanbanPlanEditor');
    if (kanbanEditor) {
        kanbanEditor.value = planText;
    }

    // Update line numbers if available
    if (typeof updateLineNumbers === 'function') {
        updateLineNumbers();
    }

    // Trigger the full render pipeline for the new project.
    // updateAllViews updates dashboard/table views immediately via /api/parse.
    // Dispatching an input event on the editor triggers the debounced
    // renderText → render → /render pipeline which updates the rendered
    // markdown output.
    if (typeof updateAllViews === 'function') {
        updateAllViews(planText, project.name);
    }
    if (planEditor) {
        planEditor.dispatchEvent(new Event('input'));
    }

    // If the Kanban tab is currently active, sync the board immediately
    // so it reflects the newly loaded project without waiting for the
    // debounced editor-input handler.
    const kanbanTab = document.getElementById('kanban-tab');
    if (kanbanTab && kanbanTab.classList.contains('active') && typeof syncKanbanFromEditor === 'function') {
        syncKanbanFromEditor();
    }

    // Emit project loaded event
    window.dispatchEvent(new CustomEvent('projectLoaded', {
        detail: { projectId, projectName: project.name }
    }));

    return true;
}

/**
 * Parse project plan text into structured data
 */
function parseProjectPlan(planText) {
    if (!planText) return null;

    const parsed = {
        tasks: [],
        raidItems: [],
        highlights: [],
        frontMatter: {},
        resources: {}
    };

    try {
        // Extract RAID log if parseRaidMarkdown exists
        if (typeof extractRaidItemsFromPlanText === 'function') {
            parsed.raidItems = extractRaidItemsFromPlanText(planText);
        }

        // Extract highlights if function exists
        if (typeof extractHighlights === 'function') {
            const highlights = extractHighlights(planText);
            if (highlights && highlights.length > 0) {
                parsed.highlights = highlights;
            }
        }

        // Additional parsing can be added here
    } catch (error) {
        console.error('Error parsing project plan:', error);
    }

    return parsed;
}

/**
 * Get all cached projects
 */
function getAllCachedProjects() {
    return Array.from(projectCache.values());
}

/**
 * Clear project cache
 */
function clearProjectCache() {
    projectCache.clear();
}

/**
 * Preload multiple projects
 */
function preloadProjects(projectIds) {
    const results = {
        loaded: [],
        failed: []
    };

    projectIds.forEach(projectId => {
        try {
            const project = getCachedProject(projectId);
            if (project) {
                results.loaded.push(projectId);
            } else {
                results.failed.push(projectId);
            }
        } catch (error) {
            console.error('Error preloading project:', projectId, error);
            results.failed.push(projectId);
        }
    });

    return results;
}

/**
 * Batch load projects for portfolio views
 */
function batchLoadProjectsData() {
    const projects = loadAllProjectsIntoCache();
    const projectsData = [];

    projects.forEach(project => {
        const parsedData = parseProjectPlan(project.planText);
        projectsData.push({
            id: project.id,
            name: project.name,
            planText: project.planText,
            createdAt: project.createdAt,
            updatedAt: project.updatedAt,
            data: parsedData,
            stats: {
                taskCount: parsedData?.tasks?.length || 0,
                raidCount: parsedData?.raidItems?.length || 0,
                highlightCount: parsedData?.highlights?.length || 0
            }
        });
    });

    return projectsData;
}

/**
 * Validate project data
 */
function validateProject(project) {
    if (!project) return false;
    if (!project.id) return false;
    if (!project.name) return false;
    if (typeof project.planText !== 'string') return false;
    if (!project.createdAt || !project.updatedAt) return false;
    return true;
}

/**
 * Clean up orphaned or corrupted projects
 */
function cleanupProjects() {
    const projects = getAllProjects();
    const validProjects = {};
    const removed = [];

    Object.entries(projects).forEach(([id, project]) => {
        if (validateProject(project)) {
            validProjects[id] = project;
        } else {
            removed.push(id);
            console.warn('Removing invalid project:', id);
        }
    });

    if (removed.length > 0) {
        saveAllProjects(validProjects);
        clearProjectCache();
        loadAllProjectsIntoCache();
    }

    return { valid: Object.keys(validProjects).length, removed: removed.length };
}

/**
 * Export all projects as JSON
 */
function exportAllProjectsAsJSON() {
    const projects = getAllProjects();
    const exportData = {
        version: '1.0',
        exportedAt: Date.now(),
        projectCount: Object.keys(projects).length,
        projects: projects
    };

    const dataStr = JSON.stringify(exportData, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);

    const exportFileDefaultName = 'noodleplanner-projects-' + new Date().toISOString().split('T')[0] + '.json';

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();

    return exportData;
}

/**
 * Import projects from JSON backup
 */
function importProjectsFromJSON(jsonData) {
    try {
        const importData = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;

        if (!importData.projects) {
            throw new Error('Invalid import format: missing projects');
        }

        const currentProjects = getAllProjects();
        let imported = 0;
        let skipped = 0;

        Object.entries(importData.projects).forEach(([id, project]) => {
            if (validateProject(project)) {
                // Generate new ID if conflict exists
                let newId = project.id;
                if (currentProjects[newId]) {
                    newId = 'project-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
                    project.id = newId;
                }

                currentProjects[newId] = project;
                imported++;
            } else {
                skipped++;
                console.warn('Skipped invalid project during import:', id);
            }
        });

        saveAllProjects(currentProjects);
        clearProjectCache();
        loadAllProjectsIntoCache();

        return { imported, skipped, total: imported + skipped };
    } catch (error) {
        console.error('Error importing projects:', error);
        return { imported: 0, skipped: 0, error: error.message };
    }
}

/**
 * Parse all projects via /api/parse in parallel
 * Returns Array<{project, parsedResult}> where parsedResult is the API response
 */
async function parseAllProjects() {
    // Save current editor state so localStorage is up to date
    if (typeof saveCurrentProjectState === 'function') {
        saveCurrentProjectState();
    }

    const projects = loadAllProjectsIntoCache();
    if (projects.length === 0) return [];

    const promises = projects.map(async (project) => {
        try {
            const response = await fetch('/api/parse', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    plan_text: project.planText || '',
                    project_name: project.name || null
                })
            });
            if (!response.ok) {
                console.warn('Failed to parse project:', project.name);
                return { project, parsedResult: null };
            }
            const parsedResult = await response.json();
            return { project, parsedResult };
        } catch (error) {
            console.error('Error parsing project:', project.name, error);
            return { project, parsedResult: null };
        }
    });

    return Promise.all(promises);
}

/**
 * Get project statistics
 */
function getProjectStatistics(projectId) {
    const project = getCachedProject(projectId);
    if (!project) return null;

    const parsed = parseProjectPlan(project.planText);
    const lines = (project.planText || '').split('\n');

    return {
        projectId: project.id,
        projectName: project.name,
        lineCount: lines.length,
        characterCount: project.planText?.length || 0,
        taskCount: parsed?.tasks?.length || 0,
        raidCount: parsed?.raidItems?.length || 0,
        highlightCount: parsed?.highlights?.length || 0,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        daysSinceUpdate: Math.floor((Date.now() - project.updatedAt) / (1000 * 60 * 60 * 24))
    };
}

/**
 * Rebuild all .project-selector-dropdown elements with current project list
 */
function refreshProjectSelectors() {
    const projects = listProjects().sort((a, b) => a.name.localeCompare(b.name));
    const currentId = getCurrentProjectId();
    const selectors = document.querySelectorAll('.project-selector-dropdown');

    selectors.forEach(select => {
        const previousValue = select.value;
        select.innerHTML = '';

        if (projects.length === 0) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = 'No projects';
            opt.disabled = true;
            select.appendChild(opt);
            return;
        }

        projects.forEach(project => {
            const opt = document.createElement('option');
            opt.value = project.id;
            opt.textContent = project.name;
            if (project.id === currentId) {
                opt.selected = true;
            }
            select.appendChild(opt);
        });
    });
}

/**
 * Handle project selector change
 */
function onProjectSelectorChange(projectId) {
    if (!projectId) return;

    const currentId = getCurrentProjectId();
    if (projectId === currentId) return;

    // Save current project state before switching
    saveCurrentProjectState();

    // Load selected project into editor
    loadProjectIntoEditor(projectId);

    // Refresh all selectors to stay in sync
    refreshProjectSelectors();

    // Re-render portfolio table so the active indicator (blue dot) updates
    if (typeof renderProjectsTable === 'function') {
        renderProjectsTable();
    }
}

// Initialize on page load
if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', () => {
        // Load all projects into cache on startup
        loadAllProjectsIntoCache();

        // Populate project selectors
        refreshProjectSelectors();

        // Load current project into editor if one is set
        const currentId = getCurrentProjectId();
        if (currentId && loadProject(currentId)) {
            loadProjectIntoEditor(currentId);
        }

        // Default to Dashboard view with the plan sub-navigation bar visible
        if (typeof switchToView === 'function') {
            switchToView('project-report');
        }

        // Set up periodic cache refresh (every 5 minutes)
        setInterval(() => {
            loadAllProjectsIntoCache();
        }, 5 * 60 * 1000);
    });
}
