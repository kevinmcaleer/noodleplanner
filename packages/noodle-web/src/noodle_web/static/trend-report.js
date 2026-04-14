/**
 * trend-report.js — Trend reporting for NoodlePlanner.
 *
 * Compares two plan versions and generates a text-based progress report
 * covering plan progress, risk/issue changes, and milestone completion.
 *
 * Must be loaded after script.js, version-history.js.
 */

// ---------------------------------------------------------------------------
// Task extraction from plan text
// ---------------------------------------------------------------------------

/**
 * Extract task lines from plan text.
 * Returns an array of {name, percent, resources, start, end, isMilestone}.
 *
 * Task lines follow the pattern:
 *   TaskName [ResourceA, ResourceB] 2025-01-01 2025-03-01 50%
 * Milestones are tasks prefixed with * or that have identical start/end dates.
 */
function extractTasksFromPlanText(planText) {
    if (!planText) return [];

    const tasks = [];
    // Strip front matter
    let body = planText;
    const fmMatch = body.match(/^---\n[\s\S]*?\n---\n?/);
    if (fmMatch) {
        body = body.substring(fmMatch[0].length);
    }

    // Stop at special sections
    const sectionMarkers = [
        '---highlights---', '---budget---', '---benefits---',
        '---raid log---', '---comms---', '---baseline---'
    ];
    let endIdx = body.length;
    for (const marker of sectionMarkers) {
        const idx = body.indexOf(marker);
        if (idx !== -1 && idx < endIdx) endIdx = idx;
    }
    body = body.substring(0, endIdx);

    const lines = body.split('\n');

    // Task line regex: name [resources] start end percent
    // Handles indented tasks, milestones (*name), and various formats
    const taskRe = /^(\s*)(\*?)([^[\]]+?)\s*(?:\[([^\]]*)\])?\s*(\d{4}-\d{2}-\d{2})?\s*(\d{4}-\d{2}-\d{2})?\s*(\d+)%/;

    for (const line of lines) {
        const m = line.match(taskRe);
        if (!m) continue;

        const indent = m[1] || '';
        const milestone = m[2] === '*';
        const name = m[3].trim();
        const resources = m[4] ? m[4].split(',').map(r => r.trim()).filter(Boolean) : [];
        const start = m[5] || '';
        const end = m[6] || '';
        const percent = parseInt(m[7], 10);

        // Skip summary/group lines (lines that are just section headers)
        if (!name) continue;

        const isMilestone = milestone || (start && end && start === end);

        tasks.push({
            name: name,
            percent: percent,
            resources: resources,
            start: start,
            end: end,
            isMilestone: isMilestone,
            indent: indent.length
        });
    }

    return tasks;
}

// ---------------------------------------------------------------------------
// RAID extraction (reuses existing patterns from script.js)
// ---------------------------------------------------------------------------

/**
 * Extract RAID items from plan text.
 * Delegates to the existing extractRaidItemsFromPlanText when available,
 * otherwise falls back to a simple extraction.
 */
function extractRaidForComparison(planText) {
    if (typeof extractRaidItemsFromPlanText === 'function') {
        return extractRaidItemsFromPlanText(planText);
    }
    return [];
}

// ---------------------------------------------------------------------------
// Comparison logic
// ---------------------------------------------------------------------------

/**
 * Compare two sets of tasks and return a summary object.
 */
function compareTasks(oldTasks, newTasks) {
    const result = {
        oldTotal: oldTasks.length,
        newTotal: newTasks.length,
        oldOverallPercent: 0,
        newOverallPercent: 0,
        completed: [],      // tasks that went to 100%
        added: [],          // new task names
        removed: [],        // removed task names
        changed: []         // tasks with % change
    };

    if (oldTasks.length > 0) {
        result.oldOverallPercent = Math.round(
            oldTasks.reduce((sum, t) => sum + t.percent, 0) / oldTasks.length
        );
    }
    if (newTasks.length > 0) {
        result.newOverallPercent = Math.round(
            newTasks.reduce((sum, t) => sum + t.percent, 0) / newTasks.length
        );
    }

    // Build maps by task name for comparison
    const oldMap = new Map();
    oldTasks.forEach(t => oldMap.set(t.name.toLowerCase(), t));

    const newMap = new Map();
    newTasks.forEach(t => newMap.set(t.name.toLowerCase(), t));

    // Find completed, changed, and added tasks
    for (const [key, newTask] of newMap) {
        const oldTask = oldMap.get(key);
        if (!oldTask) {
            result.added.push(newTask.name);
        } else {
            if (newTask.percent === 100 && oldTask.percent < 100) {
                result.completed.push(newTask.name);
            } else if (newTask.percent !== oldTask.percent) {
                result.changed.push({
                    name: newTask.name,
                    oldPercent: oldTask.percent,
                    newPercent: newTask.percent
                });
            }
        }
    }

    // Find removed tasks
    for (const [key, oldTask] of oldMap) {
        if (!newMap.has(key)) {
            result.removed.push(oldTask.name);
        }
    }

    return result;
}

/**
 * Compare two sets of RAID items and return a summary object.
 */
function compareRaid(oldItems, newItems) {
    const result = {
        added: [],
        removed: [],
        statusChanged: [],
        unchanged: 0
    };

    const oldMap = new Map();
    oldItems.forEach(item => {
        const key = (item.title || item.description || '').toLowerCase();
        if (key) oldMap.set(key, item);
    });

    const newMap = new Map();
    newItems.forEach(item => {
        const key = (item.title || item.description || '').toLowerCase();
        if (key) newMap.set(key, item);
    });

    for (const [key, newItem] of newMap) {
        const oldItem = oldMap.get(key);
        if (!oldItem) {
            result.added.push({
                title: newItem.title || newItem.description || 'Untitled',
                type: newItem.type || 'risk',
                status: newItem.status || 'open'
            });
        } else {
            if (oldItem.status !== newItem.status) {
                result.statusChanged.push({
                    title: newItem.title || newItem.description || 'Untitled',
                    type: newItem.type || 'risk',
                    oldStatus: oldItem.status || 'open',
                    newStatus: newItem.status || 'open'
                });
            } else {
                result.unchanged++;
            }
        }
    }

    for (const [key, oldItem] of oldMap) {
        if (!newMap.has(key)) {
            result.removed.push({
                title: oldItem.title || oldItem.description || 'Untitled',
                type: oldItem.type || 'risk',
                status: oldItem.status || 'open'
            });
        }
    }

    return result;
}

/**
 * Compare milestone tasks between two versions.
 */
function compareMilestones(oldTasks, newTasks) {
    const oldMilestones = oldTasks.filter(t => t.isMilestone);
    const newMilestones = newTasks.filter(t => t.isMilestone);

    const result = {
        achieved: [],
        dateChanged: [],
        added: [],
        removed: []
    };

    const oldMap = new Map();
    oldMilestones.forEach(m => oldMap.set(m.name.toLowerCase(), m));

    const newMap = new Map();
    newMilestones.forEach(m => newMap.set(m.name.toLowerCase(), m));

    for (const [key, newMs] of newMap) {
        const oldMs = oldMap.get(key);
        if (!oldMs) {
            result.added.push(newMs.name);
        } else {
            // Check if achieved (went to 100%)
            if (newMs.percent === 100 && oldMs.percent < 100) {
                result.achieved.push({
                    name: newMs.name,
                    date: newMs.end || newMs.start || ''
                });
            }
            // Check for date slippage
            if (oldMs.end && newMs.end && oldMs.end !== newMs.end) {
                const oldDate = new Date(oldMs.end);
                const newDate = new Date(newMs.end);
                const daysDiff = Math.round((newDate - oldDate) / (1000 * 60 * 60 * 24));
                result.dateChanged.push({
                    name: newMs.name,
                    oldDate: oldMs.end,
                    newDate: newMs.end,
                    daysDiff: daysDiff
                });
            }
        }
    }

    for (const [key] of oldMap) {
        if (!newMap.has(key)) {
            result.removed.push(oldMap.get(key).name);
        }
    }

    return result;
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

/**
 * Generate a change log between two plan versions.
 */
function generateChangeLog(currentPlanText, previousPlanText) {
    const oldTasks = extractTasksFromPlanText(previousPlanText);
    const newTasks = extractTasksFromPlanText(currentPlanText);
    const taskDiff = compareTasks(oldTasks, newTasks);

    const lines = [];

    if (taskDiff.completed.length > 0) {
        lines.push('Completed: ' + taskDiff.completed.join(', '));
    }
    if (taskDiff.added.length > 0) {
        lines.push('Added: ' + taskDiff.added.join(', '));
    }
    if (taskDiff.removed.length > 0) {
        lines.push('Removed: ' + taskDiff.removed.join(', '));
    }
    if (taskDiff.changed.length > 0) {
        const changes = taskDiff.changed.map(c =>
            c.name + ' (' + c.oldPercent + '% -> ' + c.newPercent + '%)'
        );
        lines.push('Progress changes: ' + changes.join(', '));
    }

    return lines.length > 0 ? lines.join('\n') : 'No changes detected.';
}

/**
 * Generate a full trend report comparing two plan versions.
 * Returns a formatted markdown string.
 */
function generateTrendReport(currentPlanText, comparisonPlanText, currentVersion, comparisonVersion) {
    const oldTasks = extractTasksFromPlanText(comparisonPlanText);
    const newTasks = extractTasksFromPlanText(currentPlanText);
    const taskDiff = compareTasks(oldTasks, newTasks);

    const oldRaid = extractRaidForComparison(comparisonPlanText);
    const newRaid = extractRaidForComparison(currentPlanText);
    const raidDiff = compareRaid(oldRaid, newRaid);

    const milestoneDiff = compareMilestones(oldTasks, newTasks);

    const vLabel = (currentVersion && comparisonVersion)
        ? ' (v' + comparisonVersion + ' -> v' + currentVersion + ')'
        : '';

    const lines = [];
    lines.push('## Progress Summary' + vLabel);
    lines.push('');

    // --- Plan Progress ---
    lines.push('### Plan Progress');
    const pctChange = taskDiff.newOverallPercent - taskDiff.oldOverallPercent;
    const pctSign = pctChange >= 0 ? '+' : '';
    lines.push('- Overall completion: ' + taskDiff.oldOverallPercent + '% -> ' +
        taskDiff.newOverallPercent + '% (' + pctSign + pctChange + '%)');

    if (taskDiff.completed.length > 0) {
        lines.push('- ' + taskDiff.completed.length + ' task' +
            (taskDiff.completed.length !== 1 ? 's' : '') +
            ' completed since v' + (comparisonVersion || '?') + ': ' +
            taskDiff.completed.map(n => '"' + n + '"').join(', '));
    }
    if (taskDiff.added.length > 0) {
        lines.push('- ' + taskDiff.added.length + ' new task' +
            (taskDiff.added.length !== 1 ? 's' : '') + ' added: ' +
            taskDiff.added.map(n => '"' + n + '"').join(', '));
    }
    if (taskDiff.removed.length > 0) {
        lines.push('- ' + taskDiff.removed.length + ' task' +
            (taskDiff.removed.length !== 1 ? 's' : '') + ' removed: ' +
            taskDiff.removed.map(n => '"' + n + '"').join(', '));
    }
    if (taskDiff.changed.length > 0) {
        const topChanges = taskDiff.changed
            .sort((a, b) => Math.abs(b.newPercent - b.oldPercent) - Math.abs(a.newPercent - a.oldPercent))
            .slice(0, 5);
        for (const c of topChanges) {
            const diff = c.newPercent - c.oldPercent;
            const sign = diff >= 0 ? '+' : '';
            lines.push('- "' + c.name + '": ' + c.oldPercent + '% -> ' +
                c.newPercent + '% (' + sign + diff + '%)');
        }
        if (taskDiff.changed.length > 5) {
            lines.push('- ...and ' + (taskDiff.changed.length - 5) + ' more tasks with progress changes');
        }
    }
    if (taskDiff.completed.length === 0 && taskDiff.added.length === 0 &&
        taskDiff.removed.length === 0 && taskDiff.changed.length === 0) {
        lines.push('- No task changes detected');
    }

    lines.push('');

    // --- Risks & Issues ---
    lines.push('### Risks & Issues');
    if (raidDiff.added.length > 0) {
        for (const item of raidDiff.added) {
            const typeLabel = item.type.charAt(0).toUpperCase() + item.type.slice(1);
            lines.push('- New ' + typeLabel.toLowerCase() + ' added: "' + item.title + '"');
        }
    }
    if (raidDiff.statusChanged.length > 0) {
        for (const item of raidDiff.statusChanged) {
            const typeLabel = item.type.charAt(0).toUpperCase() + item.type.slice(1);
            lines.push('- ' + typeLabel + ' "' + item.title + '" status changed: ' +
                item.oldStatus + ' -> ' + item.newStatus);
        }
    }
    if (raidDiff.removed.length > 0) {
        for (const item of raidDiff.removed) {
            const typeLabel = item.type.charAt(0).toUpperCase() + item.type.slice(1);
            lines.push('- ' + typeLabel + ' "' + item.title + '" removed');
        }
    }
    if (raidDiff.unchanged > 0) {
        lines.push('- ' + raidDiff.unchanged + ' item' +
            (raidDiff.unchanged !== 1 ? 's' : '') + ' remain unchanged');
    }
    if (raidDiff.added.length === 0 && raidDiff.statusChanged.length === 0 &&
        raidDiff.removed.length === 0 && raidDiff.unchanged === 0) {
        lines.push('- No RAID items found or no changes detected');
    }

    lines.push('');

    // --- Milestones ---
    lines.push('### Milestones');
    if (milestoneDiff.achieved.length > 0) {
        for (const ms of milestoneDiff.achieved) {
            const dateStr = ms.date ? ' on ' + ms.date : '';
            lines.push('- "' + ms.name + '" achieved' + dateStr);
        }
    }
    if (milestoneDiff.dateChanged.length > 0) {
        for (const ms of milestoneDiff.dateChanged) {
            const direction = ms.daysDiff > 0 ? 'slipped' : 'brought forward';
            lines.push('- "' + ms.name + '" date ' + direction + ': ' +
                ms.oldDate + ' -> ' + ms.newDate +
                ' (' + (ms.daysDiff > 0 ? '+' : '') + ms.daysDiff + ' days)');
        }
    }
    if (milestoneDiff.added.length > 0) {
        lines.push('- New milestone' + (milestoneDiff.added.length !== 1 ? 's' : '') +
            ': ' + milestoneDiff.added.map(n => '"' + n + '"').join(', '));
    }
    if (milestoneDiff.removed.length > 0) {
        lines.push('- Removed milestone' + (milestoneDiff.removed.length !== 1 ? 's' : '') +
            ': ' + milestoneDiff.removed.map(n => '"' + n + '"').join(', '));
    }
    if (milestoneDiff.achieved.length === 0 && milestoneDiff.dateChanged.length === 0 &&
        milestoneDiff.added.length === 0 && milestoneDiff.removed.length === 0) {
        lines.push('- No milestone changes detected');
    }

    return lines.join('\n');
}

// ---------------------------------------------------------------------------
// UI: Trend Report Dialog
// ---------------------------------------------------------------------------

/**
 * Show the trend report dialog/modal.
 * Populates the version dropdown from history and allows generating a report.
 */
function showTrendReportDialog() {
    const projectId = typeof getCurrentProjectId === 'function' ? getCurrentProjectId() : null;
    if (!projectId) {
        alert('No project selected. Please open a project first.');
        return;
    }

    const history = typeof getVersionHistory === 'function' ? getVersionHistory(projectId) : [];

    const overlay = document.getElementById('trendReportOverlay');
    if (!overlay) return;

    // Populate the version dropdown
    const select = document.getElementById('trendCompareVersion');
    if (select) {
        select.innerHTML = '';
        if (history.length === 0) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = 'No version history available';
            select.appendChild(opt);
        } else {
            history.forEach(function (entry, idx) {
                const opt = document.createElement('option');
                opt.value = String(idx);
                const dateObj = new Date(entry.date);
                const dateStr = dateObj.toLocaleDateString(undefined, {
                    year: 'numeric', month: 'short', day: 'numeric'
                });
                const timeStr = dateObj.toLocaleTimeString(undefined, {
                    hour: '2-digit', minute: '2-digit'
                });
                opt.textContent = 'v' + (entry.version || '?') + ' - ' + dateStr + ' ' + timeStr;
                select.appendChild(opt);
            });
        }
    }

    // Clear previous output
    const preview = document.getElementById('trendReportPreview');
    if (preview) {
        preview.value = '';
        preview.style.display = 'none';
    }
    const addBtn = document.getElementById('trendReportAddBtn');
    if (addBtn) addBtn.style.display = 'none';

    overlay.classList.add('active');
}

/**
 * Close the trend report dialog.
 */
function closeTrendReportDialog() {
    const overlay = document.getElementById('trendReportOverlay');
    if (overlay) overlay.classList.remove('active');
}

/**
 * Generate the trend report from the selected comparison version.
 */
function generateTrendReportFromDialog() {
    const projectId = typeof getCurrentProjectId === 'function' ? getCurrentProjectId() : null;
    if (!projectId) return;

    const select = document.getElementById('trendCompareVersion');
    if (!select || select.value === '') {
        alert('Please select a version to compare against.');
        return;
    }

    const history = typeof getVersionHistory === 'function' ? getVersionHistory(projectId) : [];
    const idx = parseInt(select.value, 10);
    if (idx < 0 || idx >= history.length) return;

    const comparisonEntry = history[idx];
    const editor = document.getElementById('planEditor');
    if (!editor) return;

    const currentPlanText = editor.value;
    const currentVersion = typeof getVersionFromFrontMatter === 'function'
        ? getVersionFromFrontMatter(currentPlanText) || '?'
        : '?';

    const report = generateTrendReport(
        currentPlanText,
        comparisonEntry.planText,
        currentVersion,
        comparisonEntry.version || '?'
    );

    const preview = document.getElementById('trendReportPreview');
    if (preview) {
        preview.value = report;
        preview.style.display = 'block';
    }

    const addBtn = document.getElementById('trendReportAddBtn');
    if (addBtn) addBtn.style.display = 'inline-flex';
}

/**
 * Add the generated report text as a new highlight entry.
 */
function addReportToHighlights() {
    const preview = document.getElementById('trendReportPreview');
    if (!preview || !preview.value.trim()) {
        alert('No report to add. Please generate a report first.');
        return;
    }

    const reportText = preview.value.trim();
    const today = new Date().toISOString().slice(0, 10);

    const item = {
        date: today,
        author: 'Auto Report',
        content: reportText
    };

    if (typeof highlightsData !== 'undefined') {
        highlightsData.push(item);
    }

    if (typeof renderHighlightsList === 'function') {
        renderHighlightsList();
    }
    if (typeof syncHighlightsToPlanText === 'function') {
        syncHighlightsToPlanText();
    }
    if (typeof updateReportHighlight === 'function') {
        updateReportHighlight();
    }

    closeTrendReportDialog();

    if (typeof setStatusMessage === 'function') {
        setStatusMessage('Trend report added to highlights');
    }
}
