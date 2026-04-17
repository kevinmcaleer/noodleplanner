/**
 * Portfolio Resource Levelling / Capacity Planning
 *
 * Detect over-allocated resources across the portfolio and propose revised
 * task start dates that smooth each resource's daily workload.
 *
 * The algorithm is portfolio-aware: the earliest project start across the
 * whole portfolio acts as the anchor, so individual projects cannot race
 * each other's schedules when they are levelled independently.
 *
 * When applied, each levelled task gets a markdown flag appended inline:
 *     [levelled @<shortname> <YYYY-MM-DD>]
 *
 * The backend scheduler (see metadata.extract_metadata) recognises the flag
 * and uses the date inside it as the task's effective start. "Clear
 * Levelling" simply strips all such flags from every project's plan text.
 */

// Maximum capacity in working-days per calendar day for a single resource.
// 1.0 means a resource can do one working-day's worth of work on any given
// working day. Non-working days contribute zero capacity.
const LEVELLING_DAILY_CAPACITY = 1.0;

/**
 * Return true if `d` is a Monday–Friday date.
 * @param {Date} d
 */
function _isWorkingDay(d) {
    const dow = d.getDay();
    return dow >= 1 && dow <= 5;
}

/**
 * Add `n` working days to the given date (skipping weekends).
 */
function _addWorkingDays(date, n) {
    const d = new Date(date);
    let added = 0;
    while (added < n) {
        d.setDate(d.getDate() + 1);
        if (_isWorkingDay(d)) added++;
    }
    return d;
}

/**
 * Return the next working day (today or later).
 */
function _nextWorkingDay(date) {
    const d = new Date(date);
    while (!_isWorkingDay(d)) {
        d.setDate(d.getDate() + 1);
    }
    return d;
}

/**
 * Convert a display name like "Kevin McAleer" to a shortname like "kevin-mcaleer".
 * Shortnames must be a single \S+ token so the levelling flag regex works.
 */
function _toShortname(displayName) {
    return displayName.trim().toLowerCase().replace(/\s+/g, '-');
}

/**
 * Format a Date as YYYY-MM-DD in local time.
 */
function _formatISODate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/**
 * Build the chronological list of task assignments across all projects.
 *
 * Each assignment is split into one entry per assigned resource so we can
 * track per-resource allocation independently.
 *
 * Returns: Array<{
 *   projectId, projectName, taskName, resource (lowercase key),
 *   resourceDisplay, start (Date), finish (Date), durationDays,
 *   percent, coResourceCount, priority (0..3 lowest-first)
 * }>
 */
function _collectLevellingAssignments(parsedProjects) {
    const assignments = [];
    parsedProjects.forEach(({ project, parsedResult }) => {
        if (!parsedResult || !parsedResult.success || !parsedResult.tasks) return;

        parsedResult.tasks.forEach(task => {
            if (task.is_summary) return;
            if (!task.resources) return;
            if (!task.start || !task.finish) return;
            const resourceNames = task.resources.split(',').map(r => r.trim()).filter(Boolean);
            if (resourceNames.length === 0) return;

            const start = new Date(task.start);
            const finish = new Date(task.finish);
            if (isNaN(start.getTime()) || isNaN(finish.getTime())) return;

            const durationDays = task.duration_days || 0;
            const percent = parseFloat(task.percent) || 0;

            // Priority ranks (for move-last-first decisions)
            const priorityMap = { 'Urgent': 3, 'Important': 2, 'Medium': 1, 'Low': 0 };
            const priorityRank = priorityMap[task.priority] !== undefined
                ? priorityMap[task.priority] : 0;

            resourceNames.forEach(name => {
                assignments.push({
                    projectId: project.id,
                    projectName: project.name,
                    taskName: task.name,
                    resource: name.toLowerCase(),
                    resourceDisplay: name,
                    start,
                    finish,
                    durationDays,
                    percent,
                    coResourceCount: resourceNames.length,
                    priority: priorityRank,
                    alreadyLevelled: /\[levelled\s+@?\S+\s+\d{4}-\d{2}-\d{2}\s*\]/i.test(
                        task.raw_line || ''
                    ),
                });
            });
        });
    });
    return assignments;
}

/**
 * Compute the portfolio anchor date — the earliest start across every
 * project's non-summary tasks. Returns null if no dated tasks are found.
 */
function computePortfolioAnchor(parsedProjects) {
    let anchor = null;
    parsedProjects.forEach(({ parsedResult }) => {
        if (!parsedResult || !parsedResult.success || !parsedResult.tasks) return;
        parsedResult.tasks.forEach(task => {
            if (task.is_summary || !task.start) return;
            const d = new Date(task.start);
            if (isNaN(d.getTime())) return;
            if (!anchor || d < anchor) anchor = d;
        });
    });
    return anchor;
}

/**
 * Compute levelling suggestions.
 *
 * Algorithm (per-resource, independent):
 *   1. Sort the resource's assignments by (alreadyLevelled desc, completed desc,
 *      priority desc, start asc). High-priority or in-progress tasks anchor
 *      first; low-priority tasks get pushed later when necessary.
 *   2. Walk assignments in that order. Each assignment consumes
 *      `durationDays / coResourceCount` working days starting from the later
 *      of its own start or the "next available" cursor for that resource.
 *   3. If the cursor is later than the original start, record a suggestion
 *      to move the task.
 *
 * @returns Array<{
 *   projectId, projectName, taskName, resource, resourceDisplay,
 *   originalStart (YYYY-MM-DD), proposedStart (YYYY-MM-DD),
 *   shiftWorkingDays, reason
 * }>
 */
function computeLevellingSuggestions(parsedProjects) {
    const assignments = _collectLevellingAssignments(parsedProjects);
    const anchor = computePortfolioAnchor(parsedProjects);
    if (!anchor) return [];

    // Group by resource
    const byResource = new Map();
    assignments.forEach(a => {
        if (!byResource.has(a.resource)) byResource.set(a.resource, []);
        byResource.get(a.resource).push(a);
    });

    const suggestions = [];

    byResource.forEach((list, resource) => {
        // Sort: anchored first (already levelled or in-progress, higher priority,
        // earliest start), then by start date, then priority desc.
        list.sort((a, b) => {
            if (a.alreadyLevelled !== b.alreadyLevelled) {
                return a.alreadyLevelled ? -1 : 1;
            }
            const aInProg = a.percent > 0 ? 1 : 0;
            const bInProg = b.percent > 0 ? 1 : 0;
            if (aInProg !== bInProg) return bInProg - aInProg;
            if (a.priority !== b.priority) return b.priority - a.priority;
            return a.start - b.start;
        });

        // Track per-resource cursor: the next working day on which this
        // resource has any remaining capacity. Start from the portfolio anchor.
        let cursor = _nextWorkingDay(anchor);

        list.forEach(a => {
            // Portion of duration this resource shoulders
            const effectiveDays = Math.max(0,
                Math.ceil((a.durationDays / a.coResourceCount) * (1 - a.percent / 100))
            );

            // Respect the task's own original start — never pull earlier
            const earliestStart = _nextWorkingDay(a.start < cursor ? cursor : a.start);

            const shiftMs = earliestStart.getTime() - a.start.getTime();
            const originalStartStr = _formatISODate(a.start);
            const proposedStartStr = _formatISODate(earliestStart);

            // Only record a suggestion if the proposed start is strictly later
            // than the original (levelling means pushing out, never pulling in).
            if (earliestStart > a.start && proposedStartStr !== originalStartStr) {
                // Count working-day shift for display
                let shiftDays = 0;
                const w = new Date(a.start);
                while (w < earliestStart) {
                    w.setDate(w.getDate() + 1);
                    if (_isWorkingDay(w)) shiftDays++;
                }
                suggestions.push({
                    projectId: a.projectId,
                    projectName: a.projectName,
                    taskName: a.taskName,
                    resource: a.resource,
                    resourceDisplay: a.resourceDisplay,
                    originalStart: originalStartStr,
                    proposedStart: proposedStartStr,
                    shiftWorkingDays: shiftDays,
                    reason: `@${a.resourceDisplay} overloaded on ${originalStartStr}`,
                });
            }

            // Advance the resource cursor by the days this task consumes.
            // Use max(earliestStart, cursor) + effectiveDays working days.
            const consumeStart = earliestStart > cursor ? earliestStart : cursor;
            cursor = effectiveDays > 0
                ? _addWorkingDays(consumeStart, effectiveDays)
                : _nextWorkingDay(new Date(consumeStart.getTime() + 24 * 3600 * 1000));
        });
    });

    return suggestions;
}

/**
 * Append `[levelled @<res> <date>]` to the matching task line in `planText`.
 * If a flag already exists for the same resource the date is updated in place.
 *
 * The match is by task name at the start of the line (after optional
 * whitespace and a leading `*`). If no match is found the plan is returned
 * unchanged.
 *
 * Exposed for testing and for applyLevellingSuggestions.
 */
function annotateTaskWithLevellingFlag(planText, taskName, resource, proposedStart) {
    if (!planText || !taskName) return planText;

    const shortname = _toShortname(resource);
    const lines = planText.split('\n');
    const flag = `[levelled @${shortname} ${proposedStart}]`;
    // Escape regex metacharacters in task name
    const esc = taskName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Match: optional leading whitespace, optional '*', the task name, followed
    // by a word boundary / whitespace / end of line.
    const lineRe = new RegExp('^(\\s*\\*?\\s*)' + esc + '(\\s|$|[@#!%\\[])', 'i');

    let matchedIdx = -1;
    let inFront = false;
    let inSpecial = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (trimmed === '---') { inFront = !inFront; continue; }
        if (inFront) continue;
        // Skip special sections (highlights, raid, etc.)
        if (/^---(highlights|budget|raid log|comms|baseline|benefits)/i.test(trimmed)) {
            inSpecial = true;
            continue;
        }
        if (/^---end-highlights---/i.test(trimmed)) { inSpecial = false; continue; }
        if (inSpecial) continue;

        if (lineRe.test(line)) {
            matchedIdx = i;
            break;
        }
    }
    if (matchedIdx === -1) return planText;

    let line = lines[matchedIdx];

    // Remove any existing levelled flag for the same resource (case insensitive)
    const existingRe = new RegExp(
        '\\s*\\[levelled\\s+@?' + shortname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
        '\\s+\\d{4}-\\d{2}-\\d{2}\\s*\\]', 'i'
    );
    line = line.replace(existingRe, '');

    // Append the new flag (separated by a single space)
    line = line.replace(/\s+$/, '') + ' ' + flag;
    lines[matchedIdx] = line;
    return lines.join('\n');
}

/**
 * Apply levelling suggestions to all affected projects.
 *
 * Updates each project's planText via updateCachedProject() / saveProject()
 * and returns the count of tasks annotated.
 */
function applyLevellingSuggestions(suggestions) {
    if (!Array.isArray(suggestions) || suggestions.length === 0) return 0;

    // Group by project
    const byProject = new Map();
    suggestions.forEach(s => {
        if (!byProject.has(s.projectId)) byProject.set(s.projectId, []);
        byProject.get(s.projectId).push(s);
    });

    let annotated = 0;
    byProject.forEach((list, projectId) => {
        const project = (typeof getCachedProject === 'function')
            ? getCachedProject(projectId)
            : (typeof loadProject === 'function' ? loadProject(projectId) : null);
        if (!project) return;
        let text = project.planText || '';
        list.forEach(s => {
            const updated = annotateTaskWithLevellingFlag(
                text, s.taskName, s.resource, s.proposedStart
            );
            if (updated !== text) {
                annotated++;
                text = updated;
            }
        });
        if (text !== (project.planText || '')) {
            if (typeof updateCachedProject === 'function') {
                updateCachedProject(projectId, { planText: text });
            } else if (typeof saveProject === 'function') {
                saveProject(projectId, { planText: text });
            }
        }
    });

    // If the currently loaded project changed, refresh the editor in place
    if (typeof getCurrentProjectId === 'function') {
        const curId = getCurrentProjectId();
        if (curId && byProject.has(curId)) {
            const editor = document.getElementById('planEditor');
            const fresh = (typeof loadProject === 'function') ? loadProject(curId) : null;
            if (editor && fresh) editor.value = fresh.planText || '';
            if (typeof renderText === 'function') {
                try { renderText(); } catch (e) { /* ignore */ }
            }
        }
    }

    return annotated;
}

/**
 * Remove the `[levelled @... YYYY-MM-DD]` flag from every line of a plan.
 * Exposed for testing.
 */
function stripLevellingFlags(planText) {
    if (!planText) return planText;
    return planText.replace(
        /\s*\[levelled\s+@?\S+\s+\d{4}-\d{2}-\d{2}\s*\]/gi,
        ''
    );
}

/**
 * Clear all levelling flags from every project and refresh caches/editor.
 * Returns the number of projects modified.
 */
function clearAllLevelling() {
    const projects = (typeof getAllProjects === 'function') ? getAllProjects() : {};
    let modified = 0;
    Object.values(projects).forEach(project => {
        const before = project.planText || '';
        const after = stripLevellingFlags(before);
        if (after !== before) {
            modified++;
            if (typeof updateCachedProject === 'function') {
                updateCachedProject(project.id, { planText: after });
            } else if (typeof saveProject === 'function') {
                saveProject(project.id, { planText: after });
            }
        }
    });

    if (typeof getCurrentProjectId === 'function') {
        const curId = getCurrentProjectId();
        if (curId) {
            const editor = document.getElementById('planEditor');
            const fresh = (typeof loadProject === 'function') ? loadProject(curId) : null;
            if (editor && fresh) editor.value = fresh.planText || '';
            if (typeof renderText === 'function') {
                try { renderText(); } catch (e) { /* ignore */ }
            }
        }
    }
    return modified;
}

// ---- UI wiring --------------------------------------------------------------

/**
 * Entry points used by the portfolio resource view buttons.
 * These are intentionally defined on window so the inline onclick handlers
 * emitted by portfolio-resources.js can reach them.
 */

async function showLevellingSuggestions() {
    const btn = document.getElementById('btnShowLevelling');
    if (btn) btn.disabled = true;
    try {
        const parsedProjects = await parseAllProjects();
        const suggestions = computeLevellingSuggestions(parsedProjects);
        window.portfolioLevellingSuggestions = suggestions;
        renderLevellingSuggestionsPanel(suggestions);
    } catch (e) {
        console.error('Levelling suggestions failed:', e);
        alert('Failed to compute levelling suggestions. See console for details.');
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function applyLevellingNow() {
    let suggestions = window.portfolioLevellingSuggestions;
    if (!suggestions || suggestions.length === 0) {
        const parsedProjects = await parseAllProjects();
        suggestions = computeLevellingSuggestions(parsedProjects);
    }
    if (!suggestions || suggestions.length === 0) {
        alert('No levelling changes to apply — workload already looks smooth.');
        return;
    }
    const n = applyLevellingSuggestions(suggestions);
    window.portfolioLevellingSuggestions = [];
    if (typeof renderPortfolioResources === 'function') {
        renderPortfolioResources();
    }
    alert(`Levelling applied to ${n} task${n === 1 ? '' : 's'}.`);
}

function clearLevellingNow() {
    if (!confirm('Remove all [levelled] flags from every project? This cannot be undone.')) {
        return;
    }
    const n = clearAllLevelling();
    window.portfolioLevellingSuggestions = [];
    if (typeof renderPortfolioResources === 'function') {
        renderPortfolioResources();
    }
    alert(`Cleared levelling from ${n} project${n === 1 ? '' : 's'}.`);
}

function renderLevellingSuggestionsPanel(suggestions) {
    const container = document.getElementById('levellingSuggestionsPanel');
    if (!container) return;
    if (!suggestions || suggestions.length === 0) {
        container.innerHTML =
            '<div class="levelling-empty">' +
            '<strong>No levelling suggestions.</strong> Every resource fits within ' +
            'its daily capacity based on the current plan.' +
            '</div>';
        container.style.display = 'block';
        return;
    }

    let html = '<div class="levelling-panel-header">' +
        '<h3>Levelling Suggestions (' + suggestions.length + ')</h3>' +
        '<p class="levelling-hint">Each row shows a proposed new start date that ' +
        'smooths the owning resource\'s workload. Click ' +
        '<em>Level Resources</em> to apply these, ' +
        'or <em>Clear Levelling</em> to remove previously-applied flags.</p>' +
        '</div>';

    html += '<div class="levelling-table-wrapper">' +
        '<table class="levelling-table">' +
        '<thead><tr>' +
        '<th>Project</th>' +
        '<th>Task</th>' +
        '<th>Resource</th>' +
        '<th>Original Start</th>' +
        '<th>Proposed Start</th>' +
        '<th>Shift (wd)</th>' +
        '</tr></thead><tbody>';
    suggestions.forEach(s => {
        html += '<tr>' +
            '<td>' + escapeHtml(s.projectName) + '</td>' +
            '<td>' + escapeHtml(s.taskName) + '</td>' +
            '<td>@' + escapeHtml(s.resourceDisplay) + '</td>' +
            '<td>' + s.originalStart + '</td>' +
            '<td><strong>' + s.proposedStart + '</strong></td>' +
            '<td style="text-align:center;">+' + s.shiftWorkingDays + '</td>' +
            '</tr>';
    });
    html += '</tbody></table></div>';

    container.innerHTML = html;
    container.style.display = 'block';
}

// Expose functions for inline onclick handlers and for Node unit tests
if (typeof window !== 'undefined') {
    window.showLevellingSuggestions = showLevellingSuggestions;
    window.applyLevellingNow = applyLevellingNow;
    window.clearLevellingNow = clearLevellingNow;
    window.computeLevellingSuggestions = computeLevellingSuggestions;
    window.applyLevellingSuggestions = applyLevellingSuggestions;
    window.stripLevellingFlags = stripLevellingFlags;
    window.clearAllLevelling = clearAllLevelling;
    window.annotateTaskWithLevellingFlag = annotateTaskWithLevellingFlag;
    window.computePortfolioAnchor = computePortfolioAnchor;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        computeLevellingSuggestions,
        applyLevellingSuggestions,
        annotateTaskWithLevellingFlag,
        stripLevellingFlags,
        clearAllLevelling,
        computePortfolioAnchor,
        _toShortname,
    };
}
