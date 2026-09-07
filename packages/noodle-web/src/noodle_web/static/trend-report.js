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
 * Clean a raw task name by stripping markdown tokens ($product, @resource,
 * durations, dates, percentages, brackets, etc.) to produce a friendly name.
 */
function cleanTaskName(raw) {
    if (!raw) return '';
    let name = raw;
    // Strip deliverable tokens: /$product, ^$product, $product
    name = name.replace(/[/^]?\$[A-Za-z_][A-Za-z0-9_-]*/g, '');
    // Strip resource tokens: @name or @name:P/R/A
    name = name.replace(/@\w+(?::[PRA])?/gi, '');
    // Strip durations: 5d, 2w, 1m, 3y
    name = name.replace(/\b\d+[dwmy]\b/g, '');
    // Strip dates: 2026-04-14
    name = name.replace(/\d{4}-\d{2}-\d{2}/g, '');
    // Strip percentages: 50%
    name = name.replace(/\b\d{1,3}%/g, '');
    // Strip [depends ...] brackets
    name = name.replace(/\[depends[^\]]*\]/gi, '');
    // Strip comments: !"..."
    name = name.replace(/!"[^"]*"/g, '');
    // Strip priority: !high, !low, !medium
    name = name.replace(/!(high|medium|low)\b/gi, '');
    // Strip labels: #tag
    name = name.replace(/#\S+/g, '');
    // Strip leading * (milestone marker)
    name = name.replace(/^\*+/, '');
    // Collapse whitespace and trim
    name = name.replace(/\s+/g, ' ').trim();
    // Convert snake_case to spaces
    name = name.replace(/_/g, ' ');
    return name;
}

/**
 * Map a resource shortname to its full name using the resource map from
 * front matter, if available.
 */
function resolveResourceName(shortname, planText) {
    if (!planText || !shortname) return shortname;
    // Look for "- @short: Full Name" in front matter Resources section
    const fmMatch = planText.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return shortname;
    const re = new RegExp('-\\s*@' + shortname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':\\s*([^,\\n]+)', 'i');
    const m = fmMatch[1].match(re);
    return m ? m[1].trim() : shortname;
}

/**
 * Extract task lines from plan text.
 * Returns an array of {name, friendlyName, percent, resources, start, end, duration, isMilestone}.
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
        '---raid log---', '---comms---', '---lessons learned---', '---baseline---',
        '---whiteboard---'
    ];
    let endIdx = body.length;
    for (const marker of sectionMarkers) {
        const idx = body.indexOf(marker);
        if (idx !== -1 && idx < endIdx) endIdx = idx;
    }
    body = body.substring(0, endIdx);

    const lines = body.split('\n');

    for (const line of lines) {
        const stripped = line.trim();
        if (!stripped) continue;

        // Skip commented-out lines
        if (stripped.startsWith('//')) continue;

        // A task line must have at least one metadata token:
        // @resource, duration (\d+[dwmy]), $deliverable, [depends], %, or date
        const hasResource = /@\w+/.test(stripped);
        const hasDuration = /\b\d+[dwmy]\b/.test(stripped);
        const hasDeliverable = /[/^]?\$[A-Za-z_]/.test(stripped);
        const hasDepends = /\[depends/i.test(stripped);
        const hasPct = /\b\d{1,3}%/.test(stripped);
        const hasDate = /\d{4}-\d{2}-\d{2}/.test(stripped);
        const hasSeqMarker = stripped.startsWith('*');

        if (!hasResource && !hasDuration && !hasDeliverable && !hasDepends && !hasPct && !hasDate && !hasSeqMarker) continue;

        const pctMatch = stripped.match(/\b(\d{1,3})%/);
        const percent = pctMatch ? parseInt(pctMatch[1], 10) : 0;
        const indent = line.length - line.trimStart().length;
        const milestone = stripped.startsWith('*');

        // Extract resources (@name tokens)
        const resources = [];
        const resRe = /@(\w+)(?::[PRA])?/gi;
        let rm;
        while ((rm = resRe.exec(stripped)) !== null) {
            resources.push(rm[1]);
        }

        // Extract dates
        const dates = stripped.match(/\d{4}-\d{2}-\d{2}/g) || [];
        const start = dates[0] || '';
        const end = dates[1] || dates[0] || '';

        // Extract duration
        const durMatch = stripped.match(/\b(\d+[dwmy])\b/);
        const duration = durMatch ? durMatch[1] : '';

        const friendlyName = cleanTaskName(stripped);
        if (!friendlyName) continue;

        const isMilestone = milestone || (start && end && start === end) || duration === '0d';

        tasks.push({
            name: stripped,
            friendlyName: friendlyName,
            percent: percent,
            resources: resources,
            start: start,
            end: end,
            duration: duration,
            isMilestone: isMilestone,
            indent: indent,
            isSummary: false  // will be set in the next pass
        });
    }

    // Mark summary tasks: a task is a summary if the next task has greater indent
    for (let i = 0; i < tasks.length - 1; i++) {
        if (tasks[i + 1].indent > tasks[i].indent) {
            tasks[i].isSummary = true;
        }
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

    // Only use leaf tasks (non-summary) for the overall % calculation,
    // matching the logic in calculateProjectCompletionFromTasks.
    const oldLeaf = oldTasks.filter(t => !t.isSummary);
    const newLeaf = newTasks.filter(t => !t.isSummary);

    if (oldLeaf.length > 0) {
        result.oldOverallPercent = Math.round(
            oldLeaf.reduce((sum, t) => sum + t.percent, 0) / oldLeaf.length
        );
    }
    if (newLeaf.length > 0) {
        result.newOverallPercent = Math.round(
            newLeaf.reduce((sum, t) => sum + t.percent, 0) / newLeaf.length
        );
    }

    // Build maps by friendly name for comparison
    const oldMap = new Map();
    oldTasks.forEach(t => oldMap.set(t.friendlyName.toLowerCase(), t));

    const newMap = new Map();
    newTasks.forEach(t => newMap.set(t.friendlyName.toLowerCase(), t));

    // Find completed, changed, and added tasks
    for (const [key, newTask] of newMap) {
        const oldTask = oldMap.get(key);
        if (!oldTask) {
            result.added.push(newTask.friendlyName);
        } else {
            if (newTask.percent === 100 && oldTask.percent < 100) {
                result.completed.push(newTask.friendlyName);
            } else if (newTask.percent !== oldTask.percent) {
                result.changed.push({
                    name: newTask.friendlyName,
                    oldPercent: oldTask.percent,
                    newPercent: newTask.percent
                });
            }
        }
    }

    // Find removed tasks
    for (const [key, oldTask] of oldMap) {
        if (!newMap.has(key)) {
            result.removed.push(oldTask.friendlyName);
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
    oldMilestones.forEach(m => oldMap.set(m.friendlyName.toLowerCase(), m));

    const newMap = new Map();
    newMilestones.forEach(m => newMap.set(m.friendlyName.toLowerCase(), m));

    for (const [key, newMs] of newMap) {
        const oldMs = oldMap.get(key);
        if (!oldMs) {
            result.added.push(newMs.friendlyName);
        } else {
            if (newMs.percent === 100 && oldMs.percent < 100) {
                result.achieved.push({
                    name: newMs.friendlyName,
                    date: newMs.end || newMs.start || ''
                });
            }
            if (oldMs.end && newMs.end && oldMs.end !== newMs.end) {
                const oldDate = new Date(oldMs.end);
                const newDate = new Date(newMs.end);
                const daysDiff = Math.round((newDate - oldDate) / (1000 * 60 * 60 * 24));
                result.dateChanged.push({
                    name: newMs.friendlyName,
                    oldDate: oldMs.end,
                    newDate: newMs.end,
                    daysDiff: daysDiff
                });
            }
        }
    }

    for (const [key] of oldMap) {
        if (!newMap.has(key)) {
            result.removed.push(oldMap.get(key).friendlyName);
        }
    }

    return result;
}

// ---------------------------------------------------------------------------
// Comms plan extraction and comparison
// ---------------------------------------------------------------------------

/**
 * Extract comms plan items from plan text for comparison.
 * Delegates to extractCommsItemsFromPlanText when available,
 * otherwise returns an empty array.
 */
function extractCommsForComparison(planText) {
    if (typeof extractCommsItemsFromPlanText === 'function') {
        return extractCommsItemsFromPlanText(planText);
    }
    return [];
}

/**
 * Compare two sets of comms plan items and return a summary.
 */
function compareComms(oldItems, newItems) {
    const result = {
        added: [],
        removed: [],
        changed: [],
        unchanged: 0
    };

    const oldMap = new Map();
    oldItems.forEach(item => {
        const key = (item.activity || '').toLowerCase();
        if (key) oldMap.set(key, item);
    });

    const newMap = new Map();
    newItems.forEach(item => {
        const key = (item.activity || '').toLowerCase();
        if (key) newMap.set(key, item);
    });

    for (const [key, newItem] of newMap) {
        const oldItem = oldMap.get(key);
        if (!oldItem) {
            result.added.push({ activity: newItem.activity || 'Untitled' });
        } else {
            // Check for changes in audience, frequency, channel, status, owner
            const changes = [];
            if ((oldItem.audience || '') !== (newItem.audience || '')) changes.push('audience');
            if ((oldItem.frequency || '') !== (newItem.frequency || '')) changes.push('frequency');
            if ((oldItem.channel || '') !== (newItem.channel || '')) changes.push('channel');
            if ((oldItem.status || '') !== (newItem.status || '')) changes.push('status changed to ' + (newItem.status || '?'));
            if ((oldItem.owner || '') !== (newItem.owner || '')) changes.push('owner');
            if (changes.length > 0) {
                result.changed.push({ activity: newItem.activity || 'Untitled', changes: changes });
            } else {
                result.unchanged++;
            }
        }
    }

    for (const [key, oldItem] of oldMap) {
        if (!newMap.has(key)) {
            result.removed.push({ activity: oldItem.activity || 'Untitled' });
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
        lines.push(taskDiff.removed.length + ' task' + (taskDiff.removed.length !== 1 ? 's' : '') + ' removed or commented out');
    }
    if (taskDiff.changed.length > 0) {
        const changes = taskDiff.changed.map(c =>
            c.name + ' (' + c.oldPercent + '% → ' + c.newPercent + '%)'
        );
        lines.push('Progress: ' + changes.join(', '));
    }

    return lines.length > 0 ? lines.join('\n') : 'No changes detected.';
}

/**
 * Generate a full trend report comparing two plan versions.
 * Returns a formatted markdown string.
 */
function generateTrendReport(currentPlanText, comparisonPlanText, currentVersion, comparisonVersion, currentDate, comparisonDate) {
    const oldTasks = extractTasksFromPlanText(comparisonPlanText);
    const newTasks = extractTasksFromPlanText(currentPlanText);
    const taskDiff = compareTasks(oldTasks, newTasks);

    const oldRaid = extractRaidForComparison(comparisonPlanText);
    const newRaid = extractRaidForComparison(currentPlanText);
    const raidDiff = compareRaid(oldRaid, newRaid);

    const milestoneDiff = compareMilestones(oldTasks, newTasks);

    const oldComms = extractCommsForComparison(comparisonPlanText);
    const newComms = extractCommsForComparison(currentPlanText);
    const commsDiff = compareComms(oldComms, newComms);

    // Format date as "13 Apr 26"
    function fmtDate(dateStr) {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        if (isNaN(d)) return '';
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return d.getDate() + ' ' + months[d.getMonth()] + ' ' + String(d.getFullYear()).slice(-2);
    }

    let vLabel = '';
    if (comparisonDate || comparisonVersion) {
        const fromParts = [];
        if (comparisonDate) fromParts.push(fmtDate(comparisonDate));
        if (comparisonVersion) fromParts.push('v' + comparisonVersion);
        const toParts = [];
        if (currentDate) toParts.push(fmtDate(currentDate));
        if (currentVersion) toParts.push('v' + currentVersion);
        vLabel = ' ' + fromParts.join(' (') + (fromParts.length > 1 ? ')' : '') +
                 ' → ' + toParts.join(' (') + (toParts.length > 1 ? ')' : '');
    }

    const lines = [];
    lines.push('**Progress Summary' + vLabel + '**');
    lines.push('');

    // --- Plan Progress ---
    const taskChangeCount = taskDiff.completed.length + taskDiff.added.length +
        taskDiff.removed.length + taskDiff.changed.length;
    lines.push('**Plan Progress — ' + taskChangeCount + ' change' + (taskChangeCount !== 1 ? 's' : '') + '**');

    const pctChange = taskDiff.newOverallPercent - taskDiff.oldOverallPercent;
    const pctSign = pctChange >= 0 ? '+' : '';
    lines.push('- Overall completion: ' + taskDiff.oldOverallPercent + '% → ' +
        taskDiff.newOverallPercent + '% (' + pctSign + pctChange + '%)');

    if (taskDiff.completed.length > 0) {
        lines.push('- Completed: ' + taskDiff.completed.join(', '));
    }
    if (taskDiff.added.length > 0) {
        lines.push('- Added: ' + taskDiff.added.join(', '));
    }
    if (taskDiff.removed.length > 0) {
        lines.push('- ' + taskDiff.removed.length + ' task' + (taskDiff.removed.length !== 1 ? 's' : '') + ' removed or commented out');
    }
    if (taskDiff.changed.length > 0) {
        const topChanges = taskDiff.changed
            .sort((a, b) => Math.abs(b.newPercent - b.oldPercent) - Math.abs(a.newPercent - a.oldPercent))
            .slice(0, 5);
        for (const c of topChanges) {
            const diff = c.newPercent - c.oldPercent;
            const sign = diff >= 0 ? '+' : '';
            lines.push('- ' + c.name + ': ' + c.oldPercent + '% → ' +
                c.newPercent + '% (' + sign + diff + '%)');
        }
        if (taskDiff.changed.length > 5) {
            lines.push('- …and ' + (taskDiff.changed.length - 5) + ' more');
        }
    }
    if (taskChangeCount === 0) {
        lines.push('- No task changes detected');
    }

    lines.push('');

    // --- Risks & Issues ---
    const raidChangeCount = raidDiff.added.length + raidDiff.statusChanged.length + raidDiff.removed.length;
    lines.push('**Risks & Issues — ' + raidChangeCount + ' change' + (raidChangeCount !== 1 ? 's' : '') + '**');

    if (raidDiff.added.length > 0) {
        for (const item of raidDiff.added) {
            lines.push('- New: ' + item.title);
        }
    }
    if (raidDiff.statusChanged.length > 0) {
        for (const item of raidDiff.statusChanged) {
            lines.push('- ' + item.title + ': ' + item.oldStatus + ' → ' + item.newStatus);
        }
    }
    if (raidDiff.removed.length > 0) {
        for (const item of raidDiff.removed) {
            lines.push('- Removed: ' + item.title);
        }
    }
    if (raidChangeCount === 0) {
        lines.push('- No changes');
    }

    lines.push('');

    // --- Milestones ---
    const msChangeCount = milestoneDiff.achieved.length + milestoneDiff.dateChanged.length +
        milestoneDiff.added.length + milestoneDiff.removed.length;
    lines.push('**Milestones — ' + msChangeCount + ' change' + (msChangeCount !== 1 ? 's' : '') + '**');

    if (milestoneDiff.achieved.length > 0) {
        for (const ms of milestoneDiff.achieved) {
            const dateStr = ms.date ? ' on ' + ms.date : '';
            lines.push('- Achieved: ' + ms.name + dateStr);
        }
    }
    if (milestoneDiff.dateChanged.length > 0) {
        for (const ms of milestoneDiff.dateChanged) {
            const direction = ms.daysDiff > 0 ? 'slipped' : 'brought forward';
            lines.push('- ' + ms.name + ' ' + direction + ': ' +
                ms.oldDate + ' → ' + ms.newDate +
                ' (' + (ms.daysDiff > 0 ? '+' : '') + ms.daysDiff + 'd)');
        }
    }
    if (milestoneDiff.added.length > 0) {
        lines.push('- Added: ' + milestoneDiff.added.join(', '));
    }
    if (milestoneDiff.removed.length > 0) {
        lines.push('- Removed: ' + milestoneDiff.removed.join(', '));
    }
    if (msChangeCount === 0) {
        lines.push('- No changes');
    }

    // --- Comms Plan ---
    const commsChangeCount = commsDiff.added.length + commsDiff.changed.length + commsDiff.removed.length;
    if (commsChangeCount > 0) {
        lines.push('');
        lines.push('**Comms Plan — ' + commsChangeCount + ' change' + (commsChangeCount !== 1 ? 's' : '') + '**');

        if (commsDiff.added.length > 0) {
            for (const item of commsDiff.added) {
                lines.push('- New activity: ' + item.activity);
            }
        }
        if (commsDiff.changed.length > 0) {
            for (const item of commsDiff.changed) {
                lines.push('- ' + item.activity + ': ' + item.changes.join(', ') + ' updated');
            }
        }
        if (commsDiff.removed.length > 0) {
            for (const item of commsDiff.removed) {
                lines.push('- Removed activity: ' + item.activity);
            }
        }
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
        comparisonEntry.version || '?',
        new Date().toISOString(),
        comparisonEntry.date || ''
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
        author: 'AutoReport',
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
