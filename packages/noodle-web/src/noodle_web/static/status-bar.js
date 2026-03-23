/**
 * status-bar.js — Status bar functionality for NoodlePlanner.
 * Provides status messages and project RAG indicator updates.
 */

let statusMessageTimer = null;

/**
 * Display a message in the status bar. Clears automatically after the given
 * duration (defaults to 5000ms). Pass 0 for a persistent message.
 */
function setStatusMessage(message, duration) {
    if (duration === undefined) duration = 5000;
    const el = document.getElementById('statusBarMessage');
    if (!el) return;

    if (statusMessageTimer) {
        clearTimeout(statusMessageTimer);
        statusMessageTimer = null;
    }

    el.textContent = message;

    if (duration > 0) {
        statusMessageTimer = setTimeout(function () {
            el.textContent = '';
            statusMessageTimer = null;
        }, duration);
    }
}

/**
 * Check programme dependencies for the current project and show warnings
 * in the status bar when dependent activities are non-green or when a
 * dependent project is missing from local storage.
 *
 * Called from updateAllViews after the parse result is available.
 */
function updateStatusBarDependencies(dependencies) {
    const el = document.getElementById('statusBarMessage');
    if (!el) return;
    if (!dependencies || dependencies.length === 0) return;

    const projects = (typeof listProjects === 'function') ? listProjects() : [];
    const projectNames = {};
    projects.forEach(function (p) { projectNames[p.name] = p; });

    // Also build a lookup keyed by lowercase name for case-insensitive match
    const projectNamesLower = {};
    projects.forEach(function (p) { projectNamesLower[p.name.toLowerCase()] = p; });

    const warnings = [];
    const errors = [];

    dependencies.forEach(function (dep) {
        var fromName = dep['from'] || '';
        // Try to find the project (case-insensitive)
        var fromProject = projectNames[fromName] || projectNamesLower[fromName.toLowerCase()];

        if (!fromProject) {
            errors.push('Dependent project "' + fromName + '" not found in local storage');
            return;
        }

        // Check the propagation cache for RAG status
        if (typeof dependencyPropagationCache !== 'undefined') {
            var allDeps = (typeof getAllProgrammeDependencies === 'function') ? getAllProgrammeDependencies() : [];
            // Find the matching stored dependency
            for (var i = 0; i < allDeps.length; i++) {
                var d = allDeps[i];
                if (d.from_project_id === fromProject.id &&
                    d.from_task_name === dep.task &&
                    d.to_task_name === dep.to_task) {
                    var cached = dependencyPropagationCache[d.id];
                    if (cached && cached.rag && cached.rag !== 'green' && cached.rag !== 'grey') {
                        warnings.push(
                            'Dependency "' + dep.task + '" from "' + fromName +
                            '" is ' + cached.rag.toUpperCase()
                        );
                    }
                    break;
                }
            }
        }
    });

    if (errors.length > 0) {
        el.textContent = '\u26a0 ' + errors[0];
        el.style.color = '#d32f2f';
    } else if (warnings.length > 0) {
        el.textContent = '\u26a0 ' + warnings[0] +
            (warnings.length > 1 ? ' (+' + (warnings.length - 1) + ' more)' : '');
        el.style.color = '#f57c00';
    }
}

/**
 * Update the status bar RAG indicator based on the current project's tasks
 * and front matter. Called after each render / project switch.
 */
function updateStatusBarRAG(frontMatter, tasks) {
    const dot = document.getElementById('statusBarRAG');
    if (!dot) return;

    // Remove any existing rag class
    dot.className = 'status-bar-rag';

    if (!tasks || tasks.length === 0) {
        dot.title = 'No tasks';
        return;
    }

    // Use the same logic as the project report
    if (typeof extractRAGStatus === 'function' && typeof calculateProjectCompletionFromTasks === 'function') {
        const completion = calculateProjectCompletionFromTasks(tasks);
        const ragStatus = extractRAGStatus(frontMatter || {}, tasks, completion);
        if (ragStatus) {
            dot.classList.add('rag-' + ragStatus);
            const label = (typeof extractProjectStatusLabel === 'function')
                ? extractProjectStatusLabel(frontMatter || {}, completion, ragStatus)
                : ragStatus;
            dot.title = 'RAG: ' + label;
        }
    }
}
