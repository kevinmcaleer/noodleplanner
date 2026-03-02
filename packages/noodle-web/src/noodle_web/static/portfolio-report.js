/**
 * Portfolio Report Export
 * Collects data from all projects and exports a multi-slide PowerPoint deck
 * with a portfolio overview slide followed by one slide per project.
 */

/**
 * Export the portfolio as a PowerPoint report.
 * Parses all projects via /api/parse, collects report data for each,
 * then sends it to /api/portfolio/export-pptx.
 */
async function exportPortfolioReport() {
    // Show a loading indicator
    const btn = document.getElementById('portfolioExportBtn');
    const originalText = btn ? btn.textContent : '';
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Exporting...';
    }

    try {
        const parsedProjects = await parseAllProjects();

        if (parsedProjects.length === 0) {
            if (typeof showMessage === 'function') {
                showMessage('editor', 'error', 'No projects to export.');
            }
            return;
        }

        const reportDate = new Date().toISOString().split('T')[0];

        // Build portfolio overview data and individual project reports
        const portfolioProjects = [];
        const projectReports = [];

        for (const { project, parsedResult } of parsedProjects) {
            const tasks = (parsedResult && parsedResult.success) ? (parsedResult.tasks || []) : [];
            const frontMatter = (parsedResult && parsedResult.success) ? (parsedResult.front_matter || {}) : {};
            const raidItems = (parsedResult && parsedResult.success) ? (parsedResult.raid_items || []) : [];
            const highlights = (parsedResult && parsedResult.success) ? (parsedResult.highlights || []) : [];

            // Calculate status data using existing portfolio-status.js functions
            const completion = calculateProjectCompletionFromTasks(tasks);
            const ragStatus = extractRAGStatus(frontMatter, tasks, completion);
            const statusLabel = extractProjectStatusLabel(frontMatter, completion, ragStatus);

            const openRisks = raidItems.filter(function(item) {
                return (item.type === 'risk' || item.type === 'issue') && item.status === 'open';
            }).length;

            // Compute project date range
            let startDate = null;
            let endDate = null;
            tasks.forEach(function(t) {
                if (t.start) {
                    if (!startDate || t.start < startDate) startDate = t.start;
                }
                if (t.finish) {
                    if (!endDate || t.finish > endDate) endDate = t.finish;
                }
            });

            var budget = '';
            if (frontMatter) {
                budget = frontMatter['budget'] || '';
            }

            portfolioProjects.push({
                name: project.name,
                status: statusLabel,
                rag: ragStatus,
                completion: completion,
                risk_count: openRisks,
                budget: String(budget),
                start_date: startDate,
                end_date: endDate
            });

            // Build individual project report data
            const reportData = buildProjectReportData(project, tasks, frontMatter, raidItems, highlights, reportDate);
            projectReports.push(reportData);
        }

        // Sort portfolio projects by RAG (red first, then amber, then green)
        var ragOrder = { 'red': 0, 'amber': 1, 'green': 2 };
        portfolioProjects.sort(function(a, b) {
            return (ragOrder[a.rag] || 2) - (ragOrder[b.rag] || 2);
        });

        // Capture the portfolio timeline as a PNG image using html2canvas
        // so the PPTX gets a high-fidelity rendering of the SVG-based timeline.
        let timelineImageB64 = null;
        const timelineContainer = document.querySelector('#portfolioTimelineView .portfolio-timeline-container');
        if (timelineContainer && typeof html2canvas !== 'undefined') {
            try {
                // Temporarily ensure timeline view is visible for capture
                const timelineView = document.getElementById('portfolioTimelineView');
                const wasHidden = timelineView && timelineView.style.display === 'none';
                if (wasHidden) timelineView.style.display = 'block';

                const canvas = await html2canvas(timelineContainer, { backgroundColor: '#ffffff', scale: 2 });

                if (wasHidden) timelineView.style.display = 'none';

                const dataUrl = canvas.toDataURL('image/png');
                // Strip the data:image/png;base64, prefix
                timelineImageB64 = dataUrl.split(',')[1] || null;
            } catch (err) {
                console.warn('Could not capture portfolio timeline as image:', err);
            }
        }

        const payload = {
            portfolio_name: 'Portfolio',
            date: reportDate,
            projects: portfolioProjects,
            project_reports: projectReports,
            timeline_image: timelineImageB64
        };

        const response = await fetch('/api/portfolio/export-pptx', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || 'Portfolio export failed');
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'Portfolio-Report-' + reportDate + '.pptx';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();

        if (typeof showMessage === 'function') {
            showMessage('editor', 'success', 'Portfolio report exported to PowerPoint successfully!');
        }
    } catch (error) {
        console.error('Error exporting portfolio report:', error);
        if (typeof showMessage === 'function') {
            showMessage('editor', 'error', 'Failed to export portfolio report: ' + error.message);
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    }
}

/**
 * Build the report data payload for a single project.
 * Mirrors the data collection logic in exportReportPptx (script.js)
 * but works from parsed API data rather than the DOM.
 *
 * @param {Object} project - The project object (id, name, planText, etc.)
 * @param {Array} tasks - Parsed tasks from /api/parse
 * @param {Object} frontMatter - Front matter from /api/parse
 * @param {Array} raidItems - RAID items from /api/parse
 * @param {string} reportDate - Date string for the report
 * @returns {Object} Report data matching the ReportExportRequest schema
 */
function buildProjectReportData(project, tasks, frontMatter, raidItems, highlights, reportDate) {
    // Extract header info from front matter
    var manager = '';
    var sponsor = '';
    var budget = '';
    var status = '';

    if (frontMatter) {
        manager = frontMatter['manager'] || frontMatter['pm'] || frontMatter['project_manager'] || '';
        sponsor = frontMatter['sponsor'] || '';
        budget = frontMatter['budget'] || '';

        // RAG status
        var ragKeys = ['rag', 'rag status', 'rag_status'];
        for (var k = 0; k < ragKeys.length; k++) {
            if (frontMatter[ragKeys[k]]) {
                status = String(frontMatter[ragKeys[k]]).trim();
                break;
            }
        }
    }

    // If no explicit status, derive from tasks
    if (!status) {
        var completion = calculateProjectCompletionFromTasks(tasks);
        var ragStatus = extractRAGStatus(frontMatter, tasks, completion);
        status = ragStatus;
    }

    // Build milestones list (zero-duration tasks)
    var milestones = [];
    tasks.forEach(function(t) {
        if (!t.is_summary && t.duration_days === 0 && t.finish) {
            var rag = t.rag || '';
            milestones.push({
                name: t.name || '',
                date: t.finish || '',
                rag: rag
            });
        }
    });

    // Build up-next list (leaf tasks starting within 2 weeks)
    var upNext = [];
    var twoWeeksFromNow = new Date();
    twoWeeksFromNow.setDate(twoWeeksFromNow.getDate() + 14);
    var today = new Date();

    tasks.forEach(function(t) {
        if (t.is_summary) return;
        if (t.duration_days === 0) return; // skip milestones
        var pct = parseFloat(t.percent) || 0;
        if (pct >= 100) return; // skip completed

        if (t.start) {
            var startDate = new Date(t.start);
            if (startDate <= twoWeeksFromNow) {
                upNext.push({
                    name: t.name || '',
                    start: t.start || '',
                    finish: t.finish || '',
                    rag: t.rag || ''
                });
            }
        }
    });
    upNext = upNext.slice(0, 10);

    // Risks & issues from RAID items
    var risksIssues = [];
    raidItems.forEach(function(item) {
        if (item.type === 'risk' || item.type === 'issue') {
            if (item.status === 'closed') return;
            risksIssues.push({
                type: item.type,
                title: item.title || item.description || '',
                score: item.score || 0
            });
        }
    });

    // Timeline tasks (phases + milestones for server-side rendering)
    var timelineTasks = [];
    var filteredTasks = tasks;
    if (filteredTasks.length > 0) {
        var minLevel = Math.min.apply(null, filteredTasks.map(function(t) { return t.level; }));
        var topLevelTasks = filteredTasks.filter(function(t) { return t.level === minLevel; });
        if (topLevelTasks.length === 1) {
            filteredTasks = filteredTasks.filter(function(t) { return t.level !== minLevel; });
        }
    }
    filteredTasks.forEach(function(t) {
        var isMilestone = t.duration_days === 0 && !t.is_summary;
        var isPhase = t.is_summary && t.start && t.finish;
        if (isMilestone || isPhase) {
            timelineTasks.push({
                name: t.name || '',
                start: t.start || '',
                finish: t.finish || '',
                percent: parseFloat(t.percent) || 0,
                is_summary: !!t.is_summary,
                duration_days: t.duration_days || 0
            });
        }
    });

    return {
        project_name: project.name || 'Project',
        manager: manager,
        sponsor: sponsor,
        budget: String(budget),
        date: reportDate,
        status: status,
        milestones: milestones,
        up_next: upNext,
        highlight: highlights && highlights.length > 0 ? {
            date: highlights[0].date || null,
            author: highlights[0].author || null,
            content: highlights[0].content || null
        } : null,
        risks_issues: risksIssues,
        timeline_tasks: timelineTasks
    };
}
