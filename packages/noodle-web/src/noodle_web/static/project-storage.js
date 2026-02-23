/**
 * Project Storage Manager
 * Manages multiple project plans in browser local storage
 */

// Local storage keys
const PROJECTS_KEY = 'noodleplanner_projects';
const CURRENT_PROJECT_KEY = 'noodleplanner_current_project';

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
 * Save all projects to local storage
 */
function saveAllProjects(projects) {
    try {
        localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
        return true;
    } catch (error) {
        console.error('Error saving projects:', error);
        return false;
    }
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
 * Save current project state
 */
function saveCurrentProjectState() {
    const projectId = getCurrentProjectId();
    if (!projectId) return false;

    const planEditor = document.getElementById('planEditor');
    const planText = planEditor ? planEditor.value : '';

    return saveProject(projectId, {
        planText: planText
    });
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
        saveAllProjects(projects);

        return project;
    } catch (error) {
        console.error('Error importing project:', error);
        return null;
    }
}
