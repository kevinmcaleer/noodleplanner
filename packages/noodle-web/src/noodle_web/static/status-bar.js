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

            // Persist RAG to front matter for version history
            if (typeof persistRagToFrontMatter === 'function') {
                persistRagToFrontMatter(ragStatus);
            }

            // Show driving-task message for amber/red statuses
            updateStatusBarRAGMessage(ragStatus, tasks);
        }
    }

    // Update version badge in status bar
    if (typeof updateVersionBadge === 'function') {
        updateVersionBadge();
    }
}

/**
 * Show a statusbar message identifying the task driving an amber or red RAG.
 * The task name is clickable and opens the task inspector.
 * Clears the message when status is green or blue.
 */
function updateStatusBarRAGMessage(ragStatus, tasks) {
    const el = document.getElementById('statusBarMessage');
    if (!el) return;

    // Clear message for non-problematic statuses
    if (ragStatus !== 'red' && ragStatus !== 'amber') {
        const ragMsg = document.getElementById('statusBarRAGMsg');
        if (ragMsg) ragMsg.remove();
        return;
    }

    // Find the first non-summary task driving the status (red first, then amber)
    var drivingTask = null;
    var searchFor = ragStatus;

    if (tasks && tasks.length > 0) {
        // If overall is red, look for a red task first
        if (searchFor === 'red') {
            for (var i = 0; i < tasks.length; i++) {
                var t = tasks[i];
                if (t.is_summary) continue;
                var r = (t.rag || '').toLowerCase();
                if (r.includes('red') || r === 'r') {
                    drivingTask = t;
                    break;
                }
            }
        }
        // If overall is amber, or no red task found, look for amber
        if (!drivingTask) {
            for (var j = 0; j < tasks.length; j++) {
                var t2 = tasks[j];
                if (t2.is_summary) continue;
                var r2 = (t2.rag || '').toLowerCase();
                if (r2.includes('amber') || r2.includes('yellow') || r2 === 'a') {
                    drivingTask = t2;
                    searchFor = 'amber';
                    break;
                }
            }
        }
    }

    if (!drivingTask) {
        var ragMsg = document.getElementById('statusBarRAGMsg');
        if (ragMsg) ragMsg.remove();
        return;
    }

    // Clean task name: strip metadata tokens like @resource, $product, durations etc.
    var cleanName = drivingTask.name || '';

    // Build the message
    var statusLabel = searchFor === 'red' ? 'Red' : 'Amber';
    var reason = searchFor === 'red' ? 'is overdue' : 'is behind schedule';

    // Create or update the RAG message element
    var msgSpan = document.getElementById('statusBarRAGMsg');
    if (!msgSpan) {
        msgSpan = document.createElement('span');
        msgSpan.id = 'statusBarRAGMsg';
        msgSpan.className = 'status-bar-rag-msg';
        // Insert at the beginning of the status bar centre area
        el.prepend(msgSpan);
    }

    var color = searchFor === 'red' ? '#d32f2f' : '#f57c00';

    msgSpan.innerHTML = '';
    msgSpan.style.color = color;

    var textBefore = document.createTextNode(statusLabel + ' \u2014 ');
    msgSpan.appendChild(textBefore);

    var link = document.createElement('a');
    link.href = '#';
    link.className = 'status-bar-rag-task-link';
    link.textContent = cleanName;
    link.style.color = color;
    link.title = 'Open task inspector for ' + cleanName;
    link.addEventListener('click', function (e) {
        e.preventDefault();
        if (typeof openTaskInspectorByName === 'function') {
            openTaskInspectorByName(drivingTask.name);
        }
    });
    msgSpan.appendChild(link);

    var textAfter = document.createTextNode(' ' + reason);
    msgSpan.appendChild(textAfter);
}
