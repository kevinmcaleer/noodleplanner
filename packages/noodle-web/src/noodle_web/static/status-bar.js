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
    var msgSpan = document.getElementById('statusBarRAGMsg');
    if (!msgSpan) return;

    // Clear message for non-problematic statuses
    if (ragStatus !== 'red' && ragStatus !== 'amber') {
        msgSpan.innerHTML = '';
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
                if (r.includes('red') || r.includes('overdue') || r === 'r') {
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
                if (r2.includes('amber') || r2.includes('yellow') || r2.includes('behind') || r2 === 'a') {
                    drivingTask = t2;
                    searchFor = 'amber';
                    break;
                }
            }
        }
    }

    if (!drivingTask) {
        msgSpan.innerHTML = '';
        return;
    }

    // Clean task name: strip metadata tokens
    var cleanName = drivingTask.name || '';

    var statusLabel = searchFor === 'red' ? 'Red' : 'Amber';
    var reason = searchFor === 'red' ? 'is overdue' : 'is behind schedule';
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

/**
 * Circular dependency warnings.
 *
 * The scheduler attaches `circular_dependencies` to any task that depends on
 * its own phase, on one of its own subtasks, on itself, or that takes part in
 * a dependency loop.  This marks the offending tokens red in the editor and
 * shows the first problem in the status bar with a Fix button when the fix
 * is unambiguous (removing the entry from the task's [depends ...] list).
 *
 * Called from updateAllViews after the parse result is available.
 */
function updateCircularDependencyWarnings(result) {
    var tasks = (result && result.tasks) || [];
    var editor = document.getElementById('planEditor');
    var el = document.getElementById('statusBarMessage');

    var lineMap = {};
    var problems = [];

    tasks.forEach(function (task) {
        var conflicts = task.circular_dependencies || [];
        if (conflicts.length === 0) return;

        var lineNumber = (typeof findTaskLineNumber === 'function') ? findTaskLineNumber(task) : -1;
        if (lineNumber < 0 && editor) {
            // Fall back to a case-insensitive text search for the task name.
            var lines = editor.value.split('\n');
            var needle = String(task.name || '').toLowerCase();
            for (var i = 0; i < lines.length && needle; i++) {
                if (lines[i].toLowerCase().indexOf(needle) !== -1) { lineNumber = i + 1; break; }
            }
        }

        conflicts.forEach(function (conflict) {
            var tokens = circularDependencyTokens(conflict);
            if (lineNumber > 0) {
                if (!lineMap[lineNumber]) lineMap[lineNumber] = new Set();
                tokens.forEach(function (t) { lineMap[lineNumber].add(t); });
            }
            problems.push({
                task: task.name,
                message: conflict.message || ('Circular dependency on "' + task.name + '"'),
                fixable: !!conflict.fixable && lineNumber > 0,
                line: lineNumber,
                tokens: tokens
            });
        });
    });

    window._circularDependencyLines = lineMap;
    window._circularDependencyFixes = problems;

    // Re-run the editor's syntax highlighting so the tokens turn red.
    if (editor && editor._updateLineNumbers) editor._updateLineNumbers();

    if (!el) return;

    if (problems.length === 0) {
        // Only clear a message this function put there.
        if (el.dataset.circularWarning === '1') {
            el.textContent = '';
            el.style.color = '';
            delete el.dataset.circularWarning;
        }
        return;
    }

    var first = problems[0];
    el.innerHTML = '';
    el.dataset.circularWarning = '1';
    el.style.color = '#d32f2f';

    el.appendChild(document.createTextNode('⚠ Circular dependency: ' + first.message));

    if (first.line > 0) {
        var link = document.createElement('a');
        link.href = '#';
        link.className = 'status-bar-task-link';
        link.textContent = ' (line ' + first.line + ')';
        link.title = 'Go to line ' + first.line;
        link.addEventListener('click', function (e) {
            e.preventDefault();
            goToEditorLine(first.line);
        });
        el.appendChild(link);
    }

    if (first.fixable) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'status-bar-fix-btn';
        btn.textContent = 'Fix';
        btn.title = 'Remove this dependency from the [depends ...] list';
        btn.addEventListener('click', function () { fixCircularDependency(0); });
        el.appendChild(btn);
    }

    if (problems.length > 1) {
        el.appendChild(document.createTextNode(' (+' + (problems.length - 1) + ' more)'));
    }
}

/**
 * The forms a dependency entry can take in a [depends ...] list for the
 * predecessor named by a conflict: its name (space or underscore form) and
 * its $deliverable token with any product-type prefix.
 */
function circularDependencyTokens(conflict) {
    var tokens = new Set();
    var name = String(conflict.name || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (name) {
        tokens.add(name);
        tokens.add(name.replace(/_/g, ' '));
        tokens.add(name.replace(/ /g, '_'));
    }
    var deliverable = String(conflict.deliverable || '').toLowerCase().trim();
    if (deliverable) {
        tokens.add('$' + deliverable);
        tokens.add('/$' + deliverable);
        tokens.add('^$' + deliverable);
    }
    return tokens;
}

/**
 * Apply the fix for a flagged problem: remove the offending entries from
 * the [depends ...] list on that editor line, dropping the block entirely
 * if nothing is left, then re-render.
 */
function fixCircularDependency(index) {
    var problems = window._circularDependencyFixes || [];
    var problem = problems[index];
    var editor = document.getElementById('planEditor');
    if (!problem || !editor || problem.line < 1) return;

    var lines = editor.value.split('\n');
    var line = lines[problem.line - 1];
    if (line === undefined) return;

    var fixed = removeDependenciesFromLine(line, problem.tokens);
    if (fixed === line) return;

    lines[problem.line - 1] = fixed;
    if (typeof setEditorValuePreservingCursor === 'function') {
        setEditorValuePreservingCursor(editor, lines.join('\n'));
    } else {
        editor.value = lines.join('\n');
    }

    // Clear the marks now; the re-render below will re-evaluate the plan.
    window._circularDependencyLines = {};
    if (editor._updateLineNumbers) editor._updateLineNumbers();
    editor.dispatchEvent(new Event('input'));

    var el = document.getElementById('statusBarMessage');
    if (el) {
        el.textContent = '';
        el.style.color = '';
        delete el.dataset.circularWarning;
    }
    setStatusMessage('Removed circular dependency from "' + problem.task + '"', 4000);

    if (typeof renderText === 'function') setTimeout(function () { renderText(); }, 10);
}

/**
 * Remove every entry of a [depends ...] list whose task reference (after
 * stripping any lag/lead and :FS/:SS/:FF/:SF suffix) is in `tokens`.
 */
function removeDependenciesFromLine(line, tokens) {
    var pattern = /\s*\[depends\s*:?\s*([^\]]*)\]/i;
    var match = line.match(pattern);
    if (!match) return line;

    var kept = match[1].split(',').map(function (d) { return d.trim(); }).filter(function (d) {
        if (!d) return false;
        var core = d.replace(/\s+[+\-]\d+[dwmy]$/, '');
        core = core.replace(/:(FS|SS|FF|SF)$/i, '');
        core = core.replace(/^Milestone:\s*/i, '');
        core = core.toLowerCase().replace(/\s+/g, ' ').trim();
        return !tokens.has(core);
    });

    if (kept.length === 0) {
        return line.replace(pattern, '').replace(/\s+$/, '');
    }
    return line.replace(pattern, ' [depends ' + kept.join(', ') + ']');
}

/**
 * Move the editor cursor to the start of a line and scroll it into view.
 */
function goToEditorLine(lineNumber) {
    var editor = document.getElementById('planEditor');
    if (!editor) return;
    var lines = editor.value.split('\n');
    var pos = 0;
    for (var i = 0; i < lineNumber - 1 && i < lines.length; i++) pos += lines[i].length + 1;
    editor.focus();
    editor.setSelectionRange(pos, pos);
    var style = getComputedStyle(editor);
    var lineHeight = parseFloat(style.lineHeight) || (parseFloat(style.fontSize) * 1.5);
    editor.scrollTop = Math.max(0, (lineNumber - 3) * lineHeight);
    editor.dispatchEvent(new Event('scroll'));
}
