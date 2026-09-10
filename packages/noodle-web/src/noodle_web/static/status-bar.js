/**
 * status-bar.js — Status bar functionality for NoodlePlanner.
 * Provides status messages and project RAG indicator updates.
 */

// ---------------------------------------------------------------------------
// Status message log
//
// Several independent checks (circular dependencies, MS Project assignment
// risk, cross-project dependency RAG, duplicate deliverables, plain toasts
// like "Saved") all want to show something in the status bar's single-line
// centre slot. Historically each one just overwrote `#statusBarMessage`
// directly, so whichever ran last -- or whichever transient toast fired
// next -- silently erased anyone else's warning, Fix button included. That
// is why a real warning (e.g. the MS Project assignment-risk "Fix It") could
// go invisible: something else painted over it a moment later.
//
// Every message now goes through `pushStatusLogEntry`, which keeps a
// session-long log instead of a single DOM slot. A message with a `key` is
// "sticky": pushing the same key again updates that one entry in place
// (and does nothing at all if the text hasn't changed, so a warning that is
// still true after every keystroke doesn't spam the log); a message with no
// key is a one-off event and always gets its own new entry. The compact bar
// always shows whichever *unexpired* entry is newest, so a transient toast
// fading out reveals a still-active sticky warning underneath it instead of
// leaving the bar blank. The full history -- including live Fix buttons --
// is available from the clock icon next to the bar, and from there as a
// scrollable fullscreen log that can be saved to a text file.
// ---------------------------------------------------------------------------

const STATUS_LOG_MAX = 200;
const STATUS_POPUP_VISIBLE = 10;

let statusLog = [];
let statusLogNextId = 1;
let statusPopupOpen = false;

/**
 * Add or update an entry in the status log.
 *
 * @param {object} entry
 * @param {string} entry.text
 * @param {string} [entry.key] - sticky identity; re-pushing the same key
 *   updates that entry in place instead of appending a new one.
 * @param {string} [entry.suffix] - plain text appended after any actions
 *   (e.g. "(+2 more)").
 * @param {string} [entry.color] - CSS color for the message text.
 * @param {Array}  [entry.actions] - [{label, title, onClick, kind}], kind is
 *   'button' (default, a Fix-style action) or 'link' (an inline text link).
 * @param {number} [entry.duration] - ms after which this entry stops being
 *   shown in the compact bar (it stays in the log/popup/fullscreen history).
 *   Omit, or pass 0, for a sticky/persistent entry.
 */
function pushStatusLogEntry(entry) {
    const now = Date.now();
    const text = entry.text || '';
    const color = entry.color || null;
    const actions = entry.actions || [];
    const suffix = entry.suffix || '';
    const expiresAt = entry.duration ? now + entry.duration : null;

    if (entry.key) {
        const existing = statusLog.find(function (e) { return e.key === entry.key; });
        if (existing) {
            const unchanged = existing.text === text && existing.color === color && existing.suffix === suffix;
            existing.actions = actions;
            existing.expiresAt = expiresAt;
            if (!unchanged) {
                existing.text = text;
                existing.color = color;
                existing.suffix = suffix;
                existing.timestamp = now;
            }
            renderStatusBarUI();
            return existing;
        }
    }

    const item = {
        id: statusLogNextId++,
        key: entry.key || null,
        text: text,
        suffix: suffix,
        color: color,
        actions: actions,
        timestamp: now,
        expiresAt: expiresAt
    };
    statusLog.push(item);
    if (statusLog.length > STATUS_LOG_MAX) {
        statusLog.splice(0, statusLog.length - STATUS_LOG_MAX);
    }
    renderStatusBarUI();
    return item;
}

/** Remove a sticky entry by key (e.g. once the condition it warned about is fixed). */
function clearStatusLogEntry(key) {
    if (!key) return;
    const idx = statusLog.findIndex(function (e) { return e.key === key; });
    if (idx === -1) return;
    statusLog.splice(idx, 1);
    renderStatusBarUI();
}

function statusLogByRecency() {
    // id (a monotonic push counter) breaks ties between entries pushed in
    // the same millisecond, so "newest first" stays correct even then.
    return statusLog.slice().sort(function (a, b) { return (b.timestamp - a.timestamp) || (b.id - a.id); });
}

/**
 * Which entry the compact bar shows. A brief transient toast (has an
 * expiresAt in the future -- "Saved", "Comms plan exported", ...) always
 * gets its moment, since that's the whole point of it. Once no transient
 * toast is active, a sticky warning that carries a Fix action always wins
 * the slot over one that doesn't, regardless of which was pushed more
 * recently -- an actionable warning must not be silently outranked by a
 * passive one (this is what "the Fix It button needs to be visible" means).
 * Ties within a tier go to the most recently updated entry.
 */
function currentCompactStatusEntry() {
    const now = Date.now();
    const visible = statusLog.filter(function (e) { return !e.expiresAt || e.expiresAt > now; });
    if (!visible.length) return null;

    // id is a monotonic push counter, used to break same-millisecond ties.
    const newest = function (list) {
        return list.reduce(function (a, b) {
            return (b.timestamp > a.timestamp || (b.timestamp === a.timestamp && b.id > a.id)) ? b : a;
        });
    };

    const transientActive = visible.filter(function (e) { return e.expiresAt; });
    if (transientActive.length) return newest(transientActive);

    const actionable = visible.filter(function (e) { return e.actions && e.actions.length > 0; });
    return newest(actionable.length ? actionable : visible);
}

function renderStatusBarUI() {
    renderStatusBarCompact();
    updateStatusBarHistoryToggle();
    if (statusPopupOpen) renderStatusHistoryPopup();
    const overlay = document.getElementById('statusLogOverlay');
    if (overlay && overlay.classList.contains('active')) renderStatusLogFullscreen();
}

function renderStatusBarCompact() {
    const el = document.getElementById('statusBarMessage');
    if (!el) return;
    const entry = currentCompactStatusEntry();
    el.innerHTML = '';
    el.style.color = '';
    if (!entry) return;
    el.appendChild(buildStatusEntryNode(entry));

    // A transient entry's expiry doesn't delete data, it just needs the
    // compact bar to re-render once the clock runs out so a still-active
    // sticky warning underneath it can take its place.
    if (entry.expiresAt) {
        const remaining = entry.expiresAt - Date.now();
        if (remaining > 0) setTimeout(renderStatusBarUI, remaining + 20);
    }
}

/** Build the DOM for one entry: message text, then its actions, then any suffix. */
function buildStatusEntryNode(entry) {
    const frag = document.createDocumentFragment();
    const textSpan = document.createElement('span');
    if (entry.color) textSpan.style.color = entry.color;
    textSpan.appendChild(document.createTextNode(entry.text));
    frag.appendChild(textSpan);

    (entry.actions || []).forEach(function (action) {
        var node;
        if (action.kind === 'link') {
            node = document.createElement('a');
            node.href = '#';
            node.className = 'status-bar-task-link';
        } else {
            node = document.createElement('button');
            node.type = 'button';
            node.className = 'status-bar-fix-btn';
        }
        node.textContent = action.label;
        if (action.title) node.title = action.title;
        if (entry.color && action.kind === 'link') node.style.color = entry.color;
        node.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            action.onClick();
        });
        frag.appendChild(node);
    });

    if (entry.suffix) {
        frag.appendChild(document.createTextNode(entry.suffix));
    }
    return frag;
}

/**
 * Display a message in the status bar. Clears automatically after the given
 * duration (defaults to 5000ms). Pass 0 for a persistent message.
 *
 * @param {string} message
 * @param {number} [duration]
 * @param {string} [key] - pass a stable key to update/replace the same
 *   entry on repeat calls (e.g. a rate-limited recurring notice) instead of
 *   adding a new log line every time. Passing an empty message with a key
 *   clears that entry.
 */
function setStatusMessage(message, duration, key) {
    if (duration === undefined) duration = 5000;
    if (!message) {
        if (key) clearStatusLogEntry(key);
        return;
    }
    pushStatusLogEntry({ text: message, duration: duration, key: key || null });
}

/**
 * Check programme dependencies for the current project and show warnings
 * in the status bar when dependent activities are non-green or when a
 * dependent project is missing from local storage.
 *
 * Called from updateAllViews after the parse result is available.
 */
function updateStatusBarDependencies(dependencies) {
    if (!dependencies || dependencies.length === 0) {
        clearStatusLogEntry('programme-dependencies');
        return;
    }

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
        pushStatusLogEntry({ key: 'programme-dependencies', text: '⚠ ' + errors[0], color: '#d32f2f' });
    } else if (warnings.length > 0) {
        pushStatusLogEntry({
            key: 'programme-dependencies',
            text: '⚠ ' + warnings[0],
            suffix: warnings.length > 1 ? ' (+' + (warnings.length - 1) + ' more)' : '',
            color: '#f57c00'
        });
    } else {
        clearStatusLogEntry('programme-dependencies');
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
 *
 * This targets its own element (#statusBarRAGMsg), not the shared message
 * log, so it does not compete with the warnings/toasts above.
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

    var textBefore = document.createTextNode(statusLabel + ' — ');
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

    if (problems.length === 0) {
        clearStatusLogEntry('circular-dependency');
        return;
    }

    var first = problems[0];
    var actions = [];

    if (first.line > 0) {
        actions.push({
            kind: 'link',
            label: ' (line ' + first.line + ')',
            title: 'Go to line ' + first.line,
            onClick: function () { goToEditorLine(first.line); }
        });
    }

    if (first.fixable) {
        actions.push({
            label: 'Fix',
            title: 'Remove this dependency from the [depends ...] list',
            onClick: function () { fixCircularDependency(0); }
        });
    }

    pushStatusLogEntry({
        key: 'circular-dependency',
        text: '⚠ Circular dependency: ' + first.message,
        color: '#d32f2f',
        actions: actions,
        suffix: problems.length > 1 ? ' (+' + (problems.length - 1) + ' more)' : ''
    });
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

    clearStatusLogEntry('circular-dependency');
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
 * Microsoft Project ".mpp resource assigned outside dates" risk (Snakie#975).
 *
 * mpp-export.js's findAssignmentDateRiskTasks() flags a non-summary,
 * non-milestone task with an assigned resource and a percent complete
 * strictly between 0 and 100 -- pymppwriter/mppwriter only write that
 * assignment's Work as an aggregate value, not a true timephased contour, and
 * Microsoft Project can decide on open that the resource's work no longer
 * fits the task's declared dates, offering to change the duration to
 * accommodate it. Loaded lazily via dynamic import (the module is only
 * needed once a plan has parsed) and cached on first resolution.
 *
 * Called from updateAllViews after the parse result is available.
 */
let _mppExportModule = null;
if (typeof window !== 'undefined') {
    import('/static/mpp-export.js').then(function (mod) { _mppExportModule = mod; }).catch(function () {});
}

function updateMppAssignmentWarnings(result) {
    if (!_mppExportModule) return;

    var risky = _mppExportModule.findAssignmentDateRiskTasks(result);
    window._mppAssignmentRiskTasks = risky;

    if (risky.length === 0) {
        clearStatusLogEntry('mpp-assignment-risk');
        return;
    }

    var first = risky[0];
    pushStatusLogEntry({
        key: 'mpp-assignment-risk',
        text: '⚠ ' + _mppExportModule.assignmentDateRiskMessage(first),
        color: '#f57c00',
        suffix: risky.length > 1 ? ' (+' + (risky.length - 1) + ' more)' : '',
        actions: [{
            label: 'Fix It',
            title: 'Round this task’s percent complete to 0% or 100% so Microsoft Project can represent the assignment exactly',
            onClick: function () { fixMppAssignmentWarning(0); }
        }]
    });
}

/**
 * Apply the fix for a flagged assignment-date-risk task: round its percent
 * complete to whichever of 0% or 100% is nearer -- both are verified safe
 * (see findAssignmentDateRiskTasks) -- then re-render.
 */
function fixMppAssignmentWarning(index) {
    var risky = window._mppAssignmentRiskTasks || [];
    var problem = risky[index];
    var editor = document.getElementById('planEditor');
    if (!problem || !editor || !_mppExportModule) return;

    var lineNumber = (typeof findTaskLineNumber === 'function') ? findTaskLineNumber({ name: problem.name }) : -1;
    if (lineNumber < 1) return;

    var lines = editor.value.split('\n');
    var line = lines[lineNumber - 1];
    if (line === undefined) return;

    var newPercent = _mppExportModule.safeAssignmentPercent(problem.percent);
    var fixed = line.replace(/(^|[^\w])\d+%(?!\w)/, function (m, pre) { return pre + newPercent + '%'; });
    if (fixed === line) return;

    lines[lineNumber - 1] = fixed;
    if (typeof setEditorValuePreservingCursor === 'function') {
        setEditorValuePreservingCursor(editor, lines.join('\n'));
    } else {
        editor.value = lines.join('\n');
    }

    if (editor._updateLineNumbers) editor._updateLineNumbers();
    editor.dispatchEvent(new Event('input'));

    clearStatusLogEntry('mpp-assignment-risk');
    setStatusMessage('Set "' + problem.name + '" to ' + newPercent + '% so Microsoft Project can represent the assignment', 4000);

    if (typeof renderText === 'function') setTimeout(function () { renderText(); }, 10);
}

/**
 * Move the editor cursor to the start of a line and scroll it into view.
 */
function goToEditorLine(lineNumber) {
    var editor = document.getElementById('planEditor');
    if (!editor) return;
    if (typeof SectionFolding !== 'undefined') {
        var controller = SectionFolding.controllerFor(editor);
        if (controller) {
            controller.revealRawLine(lineNumber);
            return;
        }
    }
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


// ---------------------------------------------------------------------------
// Status history popup + fullscreen log + save-to-file
// ---------------------------------------------------------------------------

function updateStatusBarHistoryToggle() {
    var btn = document.getElementById('statusBarHistoryBtn');
    if (!btn) return;
    var count = statusLog.length;
    var hasActionable = statusLog.some(function (e) { return e.actions && e.actions.length > 0; });
    btn.classList.toggle('has-entries', count > 0);
    btn.classList.toggle('has-actionable', hasActionable);
    btn.title = count > 0
        ? count + ' status message' + (count === 1 ? '' : 's') + (hasActionable ? ' — action needed' : '')
        : 'Status message history';
    btn.setAttribute('aria-expanded', statusPopupOpen ? 'true' : 'false');
}

function toggleStatusHistoryPopup() {
    if (statusPopupOpen) {
        closeStatusHistoryPopup();
    } else {
        openStatusHistoryPopup();
    }
}

function openStatusHistoryPopup() {
    statusPopupOpen = true;
    renderStatusHistoryPopup();
    var popup = document.getElementById('statusBarHistoryPopup');
    if (popup) popup.classList.add('active');
    updateStatusBarHistoryToggle();
    document.addEventListener('mousedown', handleStatusPopupOutsideClick, true);
    document.addEventListener('keydown', handleStatusPopupEscape, true);
}

function closeStatusHistoryPopup() {
    statusPopupOpen = false;
    var popup = document.getElementById('statusBarHistoryPopup');
    if (popup) popup.classList.remove('active');
    updateStatusBarHistoryToggle();
    document.removeEventListener('mousedown', handleStatusPopupOutsideClick, true);
    document.removeEventListener('keydown', handleStatusPopupEscape, true);
}

function handleStatusPopupOutsideClick(e) {
    var popup = document.getElementById('statusBarHistoryPopup');
    var btn = document.getElementById('statusBarHistoryBtn');
    if (!popup) return;
    if (popup.contains(e.target) || (btn && btn.contains(e.target))) return;
    closeStatusHistoryPopup();
}

function handleStatusPopupEscape(e) {
    if (e.key === 'Escape') closeStatusHistoryPopup();
}

function renderStatusEntryList(container, entries, emptyText) {
    container.innerHTML = '';
    if (!entries.length) {
        var empty = document.createElement('div');
        empty.className = 'status-log-empty';
        empty.textContent = emptyText;
        container.appendChild(empty);
        return;
    }
    entries.forEach(function (entry) {
        var row = document.createElement('div');
        row.className = 'status-log-row';
        if (entry.actions && entry.actions.length) row.classList.add('status-log-row-actionable');

        var time = document.createElement('span');
        time.className = 'status-log-time';
        var d = new Date(entry.timestamp);
        time.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        row.appendChild(time);

        var body = document.createElement('span');
        body.className = 'status-log-body';
        body.appendChild(buildStatusEntryNode(entry));
        row.appendChild(body);

        container.appendChild(row);
    });
}

function renderStatusHistoryPopup() {
    var container = document.getElementById('statusBarHistoryList');
    if (!container) return;
    var recent = statusLogByRecency().slice(0, STATUS_POPUP_VISIBLE);
    renderStatusEntryList(container, recent, 'No messages yet.');

    var moreNote = document.getElementById('statusBarHistoryMore');
    if (moreNote) {
        var extra = statusLog.length - recent.length;
        moreNote.textContent = extra > 0 ? '+' + extra + ' earlier message' + (extra === 1 ? '' : 's') + ' in the full log' : '';
    }
}

function openStatusLogFullscreen() {
    closeStatusHistoryPopup();
    var overlay = document.getElementById('statusLogOverlay');
    if (!overlay) return;
    overlay.classList.add('active');
    renderStatusLogFullscreen();
}

function closeStatusLogFullscreen() {
    var overlay = document.getElementById('statusLogOverlay');
    if (overlay) overlay.classList.remove('active');
}

function renderStatusLogFullscreen() {
    var container = document.getElementById('statusLogFullList');
    if (!container) return;
    renderStatusEntryList(container, statusLogByRecency(), 'No messages yet this session.');
}

/** Plain-text export of the full session log, oldest first. */
function saveStatusLogToFile() {
    var entries = statusLog.slice().sort(function (a, b) { return a.timestamp - b.timestamp; });
    var lines = entries.map(function (e) {
        var d = new Date(e.timestamp);
        var stamp = d.toISOString().slice(0, 19).replace('T', ' ');
        var text = e.text + (e.suffix || '');
        if (e.actions && e.actions.length) {
            text += ' [action available: ' + e.actions.map(function (a) { return a.label.trim(); }).join(', ') + ']';
        }
        return '[' + stamp + '] ' + text;
    });
    var content = lines.length ? lines.join('\n') + '\n' : 'No status messages this session.\n';

    var blob = new Blob([content], { type: 'text/plain' });
    var url = window.URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    var now = new Date();
    var timestamp = now.toISOString().slice(0, 19).replace(/:/g, '-').replace('T', '_');
    a.download = 'noodleplanner-status-log_' + timestamp + '.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}
