/**
 * Portfolio Status View
 * Shows project status dashboard with RAG indicators and progress tracking
 * Uses /api/parse data for accurate completion and status
 */

/**
 * Calculate project completion from parsed tasks
 */
function calculateProjectCompletionFromTasks(tasks) {
    if (!tasks || tasks.length === 0) return 0;

    // Use leaf tasks (non-summary) that have a percent value
    const leafTasks = tasks.filter(t => !t.is_summary);
    if (leafTasks.length === 0) return 0;

    let totalPercent = 0;
    leafTasks.forEach(t => {
        totalPercent += parseFloat(t.percent) || 0;
    });

    return Math.round(totalPercent / leafTasks.length);
}

/**
 * Extract RAG status from front matter or compute from tasks.
 *
 * Priority order:
 *   1. Explicit RAG in front matter (rag / rag status / rag_status)
 *   2. Explicit RAG values on individual tasks (worst-case wins)
 *   3. Schedule-based heuristic:
 *        Red   – any leaf task whose finish date is in the past and
 *                is not yet started (0% complete)
 *        Amber – any leaf task whose finish date is in the past and
 *                is not yet complete (> 0% but < 100%)
 *        Green – everything else (on track or no schedule data)
 */
function extractRAGStatus(frontMatter, tasks, completion) {
    // Compute RAG from actual task statuses. The front matter rag: field is
    // written as output (for version history) and should not override the
    // computed value — otherwise fixing a task leaves the plan stuck at amber/red.

    // Check individual task RAG statuses
    if (tasks && tasks.length > 0) {
        const ragCounts = { red: 0, amber: 0, green: 0 };
        tasks.forEach(t => {
            if (t.rag) {
                const r = t.rag.toLowerCase();
                if (r.includes('red') || r === 'r') ragCounts.red++;
                else if (r.includes('amber') || r.includes('yellow') || r === 'a') ragCounts.amber++;
                else if (r.includes('green') || r === 'g') ragCounts.green++;
            }
        });

        // If any tasks have explicit RAG, use worst-case
        if (ragCounts.red + ragCounts.amber + ragCounts.green > 0) {
            if (ragCounts.red > 0) return 'red';
            if (ragCounts.amber > 0) return 'amber';
            return 'green';
        }
    }

    // Schedule-based heuristic: check leaf tasks against today's date
    if (tasks && tasks.length > 0) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let hasOverdueNotStarted = false;
        let hasOverdueBehind = false;

        const leafTasks = tasks.filter(t => !t.is_summary);
        for (const t of leafTasks) {
            if (!t.finish) continue;
            const finish = new Date(t.finish);
            if (isNaN(finish)) continue;
            finish.setHours(0, 0, 0, 0);

            if (finish >= today) continue; // not overdue

            const pct = parseFloat(t.percent) || 0;
            if (pct >= 100) continue; // completed, no concern

            if (pct === 0) {
                hasOverdueNotStarted = true;
            } else {
                hasOverdueBehind = true;
            }
        }

        if (hasOverdueNotStarted) return 'red';
        if (hasOverdueBehind) return 'amber';
    }

    // No issues detected — project is on track
    return 'green';
}

/**
 * Extract project status label from front matter or compute it
 */
function extractProjectStatusLabel(frontMatter, completion, ragStatus) {
    // Check front matter for explicit status
    if (frontMatter) {
        const statusKeys = ['status', 'project status', 'project_status'];
        for (const key of statusKeys) {
            if (frontMatter[key]) {
                return String(frontMatter[key]).split('\n')[0].trim();
            }
        }
    }

    // Derive from completion and RAG
    if (completion === 100) return 'Complete';
    if (ragStatus === 'red') return 'At Risk';
    if (ragStatus === 'amber') return 'Behind Schedule';
    if (completion === 0) return 'Not Started';
    return 'On Track';
}

/**
 * Get the last N RAG statuses from version history for a project.
 * Returns an array of RAG letter strings ('R', 'A', 'G', 'B') in
 * chronological order (oldest first), up to `count` entries.
 * If currentRag is provided it is appended as the latest status.
 */
function getVersionHistoryRag(projectId, currentRag, count) {
    count = count || 5;
    let entries = [];
    if (typeof getVersionHistory === 'function') {
        // getVersionHistory returns newest-first
        const history = getVersionHistory(projectId);
        entries = history
            .filter(function (e) { return e.rag; })
            .map(function (e) {
                const r = e.rag.toLowerCase();
                if (r === 'red' || r === 'r') return 'R';
                if (r === 'amber' || r === 'a') return 'A';
                if (r === 'green' || r === 'g') return 'G';
                if (r === 'blue' || r === 'b') return 'B';
                return null;
            })
            .filter(Boolean)
            .reverse(); // oldest first
    }
    // Append current computed RAG so the trend includes the live status
    if (currentRag) {
        const letter = currentRag === 'red' ? 'R' : currentRag === 'amber' ? 'A' : currentRag === 'blue' ? 'B' : 'G';
        // Only append if it differs from the last entry or there are none
        if (entries.length === 0 || entries[entries.length - 1] !== letter) {
            entries.push(letter);
        }
    }
    return entries.slice(-count);
}

/**
 * Calculate project trend from a RAG letters array.
 * Compares first and last letters: improving if last is better,
 * declining if worse, stable if same or insufficient data.
 * Rank: R(0) < A(1) < G(2); B treated as G.
 */
function calculateProjectTrend(ragLetters) {
    if (!ragLetters || ragLetters.length < 2) return 'stable';
    const ragRank = { 'R': 0, 'A': 1, 'G': 2, 'B': 2 };
    const first = ragRank[ragLetters[0]];
    const last = ragRank[ragLetters[ragLetters.length - 1]];
    if (first === undefined || last === undefined) return 'stable';
    if (last > first) return 'up';
    if (last < first) return 'down';
    return 'stable';
}

// A project is considered stalled when its plan has not been saved in
// this many days. Editing/saving a plan refreshes its `last_saved`
// front-matter timestamp, so any real activity clears the stall.
var STALLED_DAYS_THRESHOLD = 14;

/**
 * Detect whether a project is stalled based on its `last_saved` front
 * matter timestamp. A project is stalled when:
 *   - It is not complete (% < 100), and
 *   - `last_saved` is older than STALLED_DAYS_THRESHOLD days.
 *
 * Plans without a `last_saved` value, or with an unparseable one, are
 * treated as not stalled (don't surprise users with false positives).
 *
 * @param {Object} frontMatter - Parsed front matter (may be empty).
 * @param {number} currentCompletion - Overall % complete (0-100).
 * @param {Date} [now] - Override for testing.
 * @returns {{ stalled: boolean, daysSinceSave: number|null }}
 */
function detectStalledProject(frontMatter, currentCompletion, now) {
    if (currentCompletion >= 100) return { stalled: false, daysSinceSave: null };

    var lastSavedStr = frontMatter && frontMatter.last_saved;
    if (!lastSavedStr) return { stalled: false, daysSinceSave: null };

    var lastSaved = new Date(lastSavedStr);
    if (isNaN(lastSaved.getTime())) return { stalled: false, daysSinceSave: null };

    var nowDate = now || new Date();
    var daysSinceSave = Math.floor((nowDate - lastSaved) / (1000 * 60 * 60 * 24));

    return {
        stalled: daysSinceSave >= STALLED_DAYS_THRESHOLD,
        daysSinceSave: daysSinceSave,
    };
}

/**
 * Calculate a delivery forecast date based on historical velocity.
 *
 * If the project's current RAG is green, a non-positive velocity is
 * reported as 'On Track' rather than 'At Risk' — completion can
 * stagnate while a project is being actively re-scoped, and an
 * otherwise healthy project should not be flagged on the dashboard.
 *
 * Returns { forecastDate: Date|null, status: 'on-track'|'at-risk'|'no-forecast'|'complete', label: string }.
 */
function calculateDeliveryForecast(projectId, currentCompletion, ragStatus, now) {
    if (currentCompletion >= 100) {
        return { forecastDate: null, status: 'complete', label: 'Complete' };
    }

    if (typeof getVersionHistory !== 'function') {
        return { forecastDate: null, status: 'no-forecast', label: 'No History' };
    }

    var history = getVersionHistory(projectId);
    if (history.length < 2) {
        return { forecastDate: null, status: 'no-forecast', label: 'No History' };
    }

    // Build data points: { date, completion } from history (newest first)
    var points = [];
    var limit = Math.min(history.length, 10);
    for (var i = 0; i < limit; i++) {
        var pct = null;
        if (typeof extractCompletionFromPlanText === 'function') {
            pct = extractCompletionFromPlanText(history[i].planText);
        }
        if (pct !== null && history[i].date) {
            points.push({ date: new Date(history[i].date), completion: pct });
        }
    }

    if (points.length < 2) {
        return { forecastDate: null, status: 'no-forecast', label: 'No History' };
    }

    // Reverse to chronological order (oldest first)
    points.reverse();

    // Calculate velocity: % change per day using first and last points
    var oldest = points[0];
    var newest = points[points.length - 1];
    var daysDiff = (newest.date - oldest.date) / (1000 * 60 * 60 * 24);
    if (daysDiff < 1) daysDiff = 1;

    var pctChange = newest.completion - oldest.completion;
    var nowMs = (now && now.getTime) ? now.getTime() : Date.now();
    // Use current completion as the latest value for more accuracy
    var actualPctChange = currentCompletion - oldest.completion;
    var actualDays = (nowMs - oldest.date.getTime()) / (1000 * 60 * 60 * 24);
    if (actualDays < 1) actualDays = 1;

    var velocityPerDay = actualPctChange / actualDays;

    if (velocityPerDay <= 0) {
        if (ragStatus === 'green') {
            return { forecastDate: null, status: 'on-track', label: 'On Track' };
        }
        return { forecastDate: null, status: 'at-risk', label: 'At Risk' };
    }

    var remaining = 100 - currentCompletion;
    var daysToComplete = remaining / velocityPerDay;
    var forecastDate = new Date(nowMs + daysToComplete * 24 * 60 * 60 * 1000);

    var label = forecastDate.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

    return { forecastDate: forecastDate, status: 'on-track', label: label };
}

/**
 * Render RAG history as coloured dots (oldest to newest, left to right)
 */
function renderRagHistoryDots(ragLetters) {
    if (!ragLetters || ragLetters.length === 0) return '';
    let html = '<div class="rag-history">';
    for (var i = 0; i < ragLetters.length; i++) {
        html += '<span class="rag-dot rag-dot-' + ragLetters[i] + '"></span>';
    }
    html += '</div>';
    return html;
}

/**
 * Render portfolio status view (async — uses /api/parse)
 */
async function renderPortfolioStatus() {
    const container = document.getElementById('portfolioStatusView');
    if (!container) return;

    // Show loading state
    container.innerHTML = '<div class="portfolio-loading">' +
        '<div class="portfolio-loading-spinner"></div>' +
        '<p>Loading project status...</p>' +
        '</div>';

    try {
        const parsedProjects = await parseAllProjects();

        if (parsedProjects.length === 0) {
            container.innerHTML = '<div class="portfolio-empty-state">' +
                '<h3>No Projects</h3>' +
                '<p>Create projects to see their status here.</p>' +
                '</div>';
            return;
        }

        // Calculate status for each project using parsed data
        const statusData = parsedProjects.map(({ project, parsedResult }) => {
            const tasks = (parsedResult && parsedResult.success) ? (parsedResult.tasks || []) : [];
            const frontMatter = (parsedResult && parsedResult.success) ? (parsedResult.front_matter || {}) : {};
            // RAID items are parsed independently of tasks, so use them
            // even when task parsing fails (success may be false).
            const raidItems = (parsedResult) ? (parsedResult.raid_items || []) : [];

            const completion = calculateProjectCompletionFromTasks(tasks);
            const ragStatus = extractRAGStatus(frontMatter, tasks, completion);
            const statusLabel = extractProjectStatusLabel(frontMatter, completion, ragStatus);
            const ragLetters = getVersionHistoryRag(project.id, ragStatus, 5);
            const trend = calculateProjectTrend(ragLetters);

            const openRisks = raidItems.filter(item => {
                const type = (item.type || '').toLowerCase();
                const status = (item.status || '').toLowerCase();
                return (type === 'risk' || type === 'issue') && status === 'open';
            }).length;

            const stalledInfo = detectStalledProject(frontMatter, completion);
            const forecast = calculateDeliveryForecast(project.id, completion, ragStatus);

            return {
                id: project.id,
                name: project.name,
                completion: completion,
                ragStatus: ragStatus,
                statusLabel: statusLabel,
                trend: trend,
                ragLetters: ragLetters,
                updatedAt: project.updatedAt,
                riskCount: openRisks,
                stalled: stalledInfo.stalled,
                daysSinceSave: stalledInfo.daysSinceSave,
                forecast: forecast
            };
        });

        // Sort by RAG status (red first, then amber, then green)
        const ragOrder = { 'red': 0, 'amber': 1, 'green': 2 };
        statusData.sort((a, b) => ragOrder[a.ragStatus] - ragOrder[b.ragStatus]);

        let html = '<div class="portfolio-status-header">' +
            '<h2><span class="ribbon-banner ribbon-banner--blue">Project Status Dashboard</span></h2>' +
            '<div class="portfolio-status-filters">' +
            '<label>Filter by: </label>' +
            '<select id="portfolioStatusFilter" onchange="filterPortfolioStatus()">' +
            '<option value="all">All Projects</option>' +
            '<option value="red">At Risk</option>' +
            '<option value="amber">In Progress</option>' +
            '<option value="green">On Track</option>' +
            '</select>' +
            '</div>' +
            '</div>';

        html += '<div class="portfolio-status-table-wrapper">' +
            '<table class="portfolio-status-table">' +
            '<thead>' +
            '<tr>' +
            '<th onclick="sortPortfolioStatus(\'name\')">Project <span class="sort-indicator"></span></th>' +
            '<th onclick="sortPortfolioStatus(\'status\')">Status <span class="sort-indicator"></span></th>' +
            '<th onclick="sortPortfolioStatus(\'completion\')">Progress <span class="sort-indicator"></span></th>' +
            '<th onclick="sortPortfolioStatus(\'rag\')">RAG <span class="sort-indicator"></span></th>' +
            '<th onclick="sortPortfolioStatus(\'risks\')">Open Risks <span class="sort-indicator"></span></th>' +
            '<th onclick="sortPortfolioStatus(\'updated\')">Last Updated <span class="sort-indicator"></span></th>' +
            '<th onclick="sortPortfolioStatus(\'forecast\')">Forecast <span class="sort-indicator"></span></th>' +
            '<th>Trend</th>' +
            '</tr>' +
            '</thead>' +
            '<tbody id="portfolioStatusTableBody">';

        statusData.forEach(proj => {
            const updatedDate = new Date(proj.updatedAt).toLocaleDateString();
            const trendIcon = proj.trend === 'up' ? '↑' : proj.trend === 'down' ? '↓' : '→';
            const trendClass = 'trend-' + proj.trend;

            // Stalled badge
            var stalledBadge = '';
            if (proj.stalled) {
                stalledBadge = ' <span class="stalled-badge" title="No save in the last ' + proj.daysSinceSave + ' days">Stalled</span>';
            }

            // Forecast cell
            var forecastClass = 'forecast-' + proj.forecast.status;
            var forecastLabel = escapeHtml(proj.forecast.label);

            html += '<tr class="status-row" onclick="openProjectDashboard(\'' + proj.id + '\')" data-rag="' + proj.ragStatus + '">' +
                '<td class="project-name">' + escapeHtml(proj.name) + stalledBadge + '</td>' +
                '<td><span class="status-badge status-' + proj.ragStatus + '">' + escapeHtml(proj.statusLabel) + '</span></td>' +
                '<td>' +
                '<div class="progress-bar-container">' +
                '<div class="progress-bar" style="width: ' + proj.completion + '%"></div>' +
                '<span class="progress-text">' + proj.completion + '%</span>' +
                '</div>' +
                '</td>' +
                '<td><span class="rag-badge rag-' + proj.ragStatus + '">' + proj.ragStatus.toUpperCase() + '</span></td>' +
                '<td class="risk-count">' + proj.riskCount + '</td>' +
                '<td>' + updatedDate + '</td>' +
                '<td><span class="' + forecastClass + '">' + forecastLabel + '</span></td>' +
                '<td>' + renderRagHistoryDots(proj.ragLetters) +
                '<span class="trend-indicator ' + trendClass + '">' + trendIcon + '</span></td>' +
                '</tr>';
        });

        html += '</tbody></table></div>';

        container.innerHTML = html;

        // Store data for sorting
        window.portfolioStatusData = statusData;

    } catch (error) {
        console.error('Error rendering portfolio status:', error);
        container.innerHTML = '<div class="portfolio-empty-state">' +
            '<h3>Error Loading Status</h3>' +
            '<p>Failed to load project status. Please try again.</p>' +
            '</div>';
    }
}

/**
 * Filter portfolio status by RAG
 */
function filterPortfolioStatus() {
    const filter = document.getElementById('portfolioStatusFilter')?.value || 'all';
    const rows = document.querySelectorAll('.status-row');

    rows.forEach(row => {
        if (filter === 'all' || row.dataset.rag === filter) {
            row.style.display = '';
        } else {
            row.style.display = 'none';
        }
    });
}

/**
 * Sort portfolio status table
 */
let portfolioStatusSortColumn = 'rag';
let portfolioStatusSortAsc = true;

function sortPortfolioStatus(column) {
    if (portfolioStatusSortColumn === column) {
        portfolioStatusSortAsc = !portfolioStatusSortAsc;
    } else {
        portfolioStatusSortColumn = column;
        portfolioStatusSortAsc = true;
    }

    if (!window.portfolioStatusData) return;

    const data = [...window.portfolioStatusData];

    data.sort((a, b) => {
        let valA, valB;

        switch (column) {
            case 'name':
                valA = a.name.toLowerCase();
                valB = b.name.toLowerCase();
                break;
            case 'completion':
                valA = a.completion;
                valB = b.completion;
                break;
            case 'rag':
                const ragOrder = { 'red': 0, 'amber': 1, 'green': 2 };
                valA = ragOrder[a.ragStatus];
                valB = ragOrder[b.ragStatus];
                break;
            case 'risks':
                valA = a.riskCount;
                valB = b.riskCount;
                break;
            case 'updated':
                valA = a.updatedAt;
                valB = b.updatedAt;
                break;
            case 'forecast':
                // Sort by forecast date; no-forecast/at-risk go to the end
                valA = a.forecast.forecastDate ? a.forecast.forecastDate.getTime() : Infinity;
                valB = b.forecast.forecastDate ? b.forecast.forecastDate.getTime() : Infinity;
                break;
            default:
                return 0;
        }

        if (valA < valB) return portfolioStatusSortAsc ? -1 : 1;
        if (valA > valB) return portfolioStatusSortAsc ? 1 : -1;
        return 0;
    });

    window.portfolioStatusData = data;
    renderPortfolioStatus();
}
