/**
 * Portfolio Report Export
 * Collects data from all projects and exports a multi-slide PowerPoint deck
 * with a portfolio overview slide followed by one slide per project.
 */

/**
 * Capture a per-project timeline as a PNG image using the swimlane style.
 * Builds an offscreen container with a date scale header and SVG swimlane,
 * captures with html2canvas, then cleans up.
 *
 * @param {Array} tasks - Parsed tasks for the project
 * @param {string} projectName - Project name (for logging)
 * @returns {string|null} Base64-encoded PNG string, or null on failure
 */
async function captureProjectTimelineImage(tasks, projectName) {
    if (typeof html2canvas === 'undefined') return null;
    if (typeof renderTimelineScale !== 'function' || typeof assignSwimlanePhaseRows !== 'function') return null;

    try {
        var phases = tasks.filter(function(t) { return t.is_summary && t.start && t.finish; });
        var milestones = tasks.filter(function(t) { return !t.is_summary && t.duration_days === 0 && t.finish; });

        if (phases.length === 0 && milestones.length === 0) return null;

        // Compute date range
        var projectStart = null;
        var projectEnd = null;
        tasks.forEach(function(t) {
            if (t.start) {
                var s = new Date(t.start);
                if (!projectStart || s < projectStart) projectStart = s;
            }
            if (t.finish) {
                var f = new Date(t.finish);
                if (!projectEnd || f > projectEnd) projectEnd = f;
            }
        });
        if (!projectStart || !projectEnd) return null;

        // 7-day padding
        var padding = 7 * 24 * 60 * 60 * 1000;
        var globalStart = new Date(projectStart.getTime() - padding);
        var globalEnd = new Date(projectEnd.getTime() + padding);

        // Build timeline data object matching renderProjectSwimlane expectations
        var timeline = {
            projectId: '',
            projectName: projectName,
            phases: phases,
            milestones: milestones,
            startDate: projectStart,
            endDate: projectEnd
        };

        // Build HTML: date scale + swimlane
        var scaleHtml = renderTimelineScale(globalStart, globalEnd, 'months');
        var swimlaneHtml = renderProjectSwimlane(timeline, globalStart, globalEnd);

        // Today marker
        var todayHtml = '';
        var today = new Date();
        if (today >= globalStart && today <= globalEnd) {
            var todayPct = ((today - globalStart) / (globalEnd - globalStart)) * 100;
            todayHtml = '<div class="portfolio-today-line" style="left: calc(200px + (100% - 200px) * ' +
                (todayPct / 100) + ');"></div>';
        }

        // Create offscreen container
        var container = document.createElement('div');
        container.style.position = 'absolute';
        container.style.left = '-9999px';
        container.style.width = '1200px';
        container.className = 'portfolio-timeline-container';
        container.style.background = '#ffffff';
        container.innerHTML = scaleHtml + swimlaneHtml + todayHtml;

        document.body.appendChild(container);

        var canvas = await html2canvas(container, { backgroundColor: '#ffffff', scale: 2 });
        var dataUrl = canvas.toDataURL('image/png');
        var base64 = dataUrl.split(',')[1] || null;

        document.body.removeChild(container);
        return base64;
    } catch (err) {
        console.warn('Could not capture project timeline for ' + projectName + ':', err);
        return null;
    }
}

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

    // A persistent toast with a progress bar, so the (potentially slow)
    // export runs visibly instead of leaving the UI looking stuck (#1068).
    const progress = (typeof showProgressToast === 'function')
        ? showProgressToast('Preparing portfolio export...')
        : null;

    try {
        const parsedProjects = await parseAllProjects();

        if (parsedProjects.length === 0) {
            if (progress) progress.fail('No projects to export.');
            if (typeof showMessage === 'function') {
                showMessage('editor', 'error', 'No projects to export.');
            }
            return;
        }

        const reportDate = new Date().toISOString().split('T')[0];

        // Build portfolio overview data and individual project reports
        const portfolioProjects = [];
        const projectReports = [];
        const totalProjects = parsedProjects.length;
        let projectIndex = 0;

        for (const { project, parsedResult } of parsedProjects) {
            projectIndex++;
            if (progress) {
                progress.update(
                    'Collecting data: ' + (project.name || 'project') + ' (' + projectIndex + '/' + totalProjects + ')',
                    5 + (projectIndex / totalProjects) * 20
                );
            }
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

            // Build deliverables matrix data for appendix slides
            const resourceMap = (parsedResult && parsedResult.success) ? (parsedResult.resource_map || {}) : {};
            const resourceRoles = (parsedResult && parsedResult.success) ? (parsedResult.resource_roles || {}) : {};
            const stakeholders = (parsedResult && parsedResult.success) ? (parsedResult.stakeholders || []) : [];
            const deliverablesData = buildDeliverablesData(tasks, resourceMap, resourceRoles, stakeholders);
            if (deliverablesData) reportData.deliverables = deliverablesData;

            // Capture per-project timeline as a PNG image using swimlane style
            if (progress) {
                progress.update(
                    'Capturing timeline: ' + (project.name || 'project') + ' (' + projectIndex + '/' + totalProjects + ')',
                    25 + (projectIndex / totalProjects) * 25
                );
            }
            const timelineImage = await captureProjectTimelineImage(tasks, project.name);
            if (timelineImage) reportData.timeline_image = timelineImage;

            projectReports.push(reportData);
        }

        // Sort portfolio projects by RAG (red first, then amber, then green)
        var ragOrder = { 'red': 0, 'amber': 1, 'green': 2 };
        portfolioProjects.sort(function(a, b) {
            return (ragOrder[a.rag] || 2) - (ragOrder[b.rag] || 2);
        });

        if (progress) progress.update('Rendering portfolio timeline...', 52);

        // Ensure the portfolio timeline SVG is rendered before capture
        if (typeof renderPortfolioTimeline === 'function') {
            const timelineView = document.getElementById('portfolioTimelineView');
            const wasHiddenPre = timelineView && timelineView.style.display === 'none';
            if (wasHiddenPre) timelineView.style.display = 'block';
            await renderPortfolioTimeline();
            if (wasHiddenPre) timelineView.style.display = 'none';
        }

        if (progress) progress.update('Capturing portfolio timeline...', 58);

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

        // The deck is built in the browser from this payload; nothing is sent
        // to the server (issue #791). np-server-exports=1 keeps the server
        // route, the same flag the other document exports use.
        const serverExports = (() => {
            try {
                return typeof localStorage !== 'undefined' && localStorage.getItem('np-server-exports') === '1';
            } catch (e) {
                return false;
            }
        })();

        if (!serverExports) {
            // Build and zip the deck off the main thread (issue #1068): this
            // is the CPU-heavy, DOM-free part, and the part that used to
            // freeze the UI on a large portfolio.
            if (progress) progress.update('Building PowerPoint deck...', 62);
            const { filename, bytes } = await buildPortfolioDeckOffMainThread(
                { portfolio_name: payload.portfolio_name, date: payload.date, projects: payload.projects, timeline_image: payload.timeline_image },
                payload.project_reports,
                function(done, total, label) {
                    if (!progress) return;
                    var pct = total ? 62 + (done / total) * 33 : 62;
                    var suffix = total ? ' (' + done + '/' + total + ')' : '';
                    progress.update('Building PowerPoint: ' + (label || '') + suffix, Math.min(pct, 96));
                }
            );
            downloadPptxBytes(bytes, filename);
            if (progress) progress.done('Exported ' + filename);
            if (typeof showMessage === 'function') {
                showMessage('editor', 'success', 'Exported ' + filename);
            }
            return;
        }

        if (progress) progress.update('Uploading to server for rendering...', 70);

        const response = await fetch('/api/portfolio/export-pptx', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || 'Portfolio export failed');
        }

        if (progress) progress.update('Downloading PowerPoint file...', 90);

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'Portfolio-Report-' + reportDate + '.pptx';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();

        if (progress) progress.done('Portfolio report exported to PowerPoint successfully!');
        if (typeof showMessage === 'function') {
            showMessage('editor', 'success', 'Portfolio report exported to PowerPoint successfully!');
        }
    } catch (error) {
        console.error('Error exporting portfolio report:', error);
        if (progress) progress.fail('Failed to export: ' + error.message);
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
 * Build and serialize the portfolio deck in a Web Worker, so slide assembly
 * (PptxGenJS) and zip compression (JSZip) run off the main thread and don't
 * block the UI on a large portfolio (issue #1068). Falls back to building on
 * the main thread if Web Workers aren't available.
 *
 * @param {Object} portfolioData
 * @param {Array} projectReports
 * @param {(done: number, total: number, label: string) => void} [onProgress]
 * @returns {Promise<{filename: string, bytes: Uint8Array}>}
 */
function buildPortfolioDeckOffMainThread(portfolioData, projectReports, onProgress) {
    if (typeof Worker === 'undefined') {
        return buildPortfolioDeckOnMainThread(portfolioData, projectReports);
    }

    return new Promise(function(resolve, reject) {
        let worker;
        try {
            worker = new Worker('/static/pptx-build-worker.js', { type: 'module' });
        } catch (err) {
            resolve(buildPortfolioDeckOnMainThread(portfolioData, projectReports));
            return;
        }

        worker.onmessage = function(event) {
            const msg = event.data || {};
            if (msg.type === 'progress') {
                if (onProgress) onProgress(msg.done, msg.total, msg.label);
            } else if (msg.type === 'done') {
                worker.terminate();
                resolve({ filename: msg.filename, bytes: msg.bytes });
            } else if (msg.type === 'error') {
                worker.terminate();
                reject(new Error(msg.message || 'Portfolio export failed'));
            }
        };
        worker.onerror = function(err) {
            worker.terminate();
            reject((err && err.error) || new Error((err && err.message) || 'Portfolio export failed'));
        };
        worker.postMessage({ portfolioData, projectReports });
    });
}

/** Fallback used when Web Workers are unavailable: builds on the main thread. */
async function buildPortfolioDeckOnMainThread(portfolioData, projectReports) {
    const { buildPortfolioDeck, deckBytes, pptxFilename } = await import('/static/pptx-export.js');
    const pptx = buildPortfolioDeck(portfolioData, projectReports);
    const bytes = await deckBytes(pptx);
    const filename = pptxFilename(portfolioData && portfolioData.portfolio_name, ' - Portfolio Report');
    return { filename, bytes };
}

/** Trigger a browser download for the deck bytes built off-thread. */
function downloadPptxBytes(bytes, filename) {
    const blob = new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
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
    var percentComplete = calculateProjectCompletionFromTasks(tasks);

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
                description: item.description || '',
                mitigation: item.mitigation_actions || '',
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
        highlight: highlights && highlights.length > 0 ? (() => {
            const latest = highlights.reduce((newest, current) => {
                if (!newest) return current;
                return current.date > newest.date ? current : newest;
            }, null);
            return {
                date: latest.date || null,
                author: latest.author || null,
                content: latest.content || null
            };
        })() : null,
        risks_issues: risksIssues,
        timeline_tasks: timelineTasks,
        percent_complete: percentComplete
    };
}


/**
 * Build deliverables matrix data for a project.
 * Mirrors the logic in the Excel exporter (exporters.py) to collect
 * deliverable tasks, people, and role mappings.
 *
 * @param {Array} tasks - Parsed tasks from the API
 * @param {Object} resourceMap - Mapping of shortname -> full name
 * @param {Object} resourceRoles - Mapping of shortname -> role title (from Resources front matter)
 * @param {Array} stakeholders - Stakeholder entries from front matter
 * @returns {Object|null} Deliverables data or null if no deliverables
 */
function buildDeliverablesData(tasks, resourceMap, resourceRoles, stakeholders) {
    // Collect deliverable tasks (exclude group product types)
    var deliverables = tasks.filter(function(t) {
        return t.deliverable && t.product_type !== 'group';
    });

    if (deliverables.length === 0) return null;

    // Collect people from all tasks (quality_roles + resources)
    var people = {};
    tasks.forEach(function(t) {
        var qr = t.quality_roles || {};
        for (var name in qr) {
            var key = name.toLowerCase();
            if (!people[key]) {
                people[key] = (resourceMap && resourceMap[key]) || name;
            }
        }
        var resStr = t.resources || '';
        if (resStr) {
            resStr.split(',').forEach(function(r) {
                var key = r.trim().toLowerCase();
                if (key && !people[key]) {
                    people[key] = (resourceMap && resourceMap[key]) || r.trim();
                }
            });
        }
    });
    // Include all resources from resource map
    if (resourceMap) {
        for (var rmKey in resourceMap) {
            if (!people[rmKey.toLowerCase()]) {
                people[rmKey.toLowerCase()] = resourceMap[rmKey];
            }
        }
    }

    var peopleList = Object.keys(people).sort();

    // Build role lookup: shortname -> role title (from resources and stakeholders)
    // Strip email addresses from role values
    var emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
    function cleanRole(roleStr) {
        if (!roleStr) return '';
        var parts = roleStr.split(',').map(function(p) { return p.trim(); });
        var cleaned = parts.filter(function(p) { return p && !emailPattern.test(p); });
        return cleaned.join(', ');
    }

    var roleMap = {};

    // Resource roles from front matter (shortname -> role title)
    if (resourceRoles) {
        for (var rkey in resourceRoles) {
            var cleaned = cleanRole(resourceRoles[rkey]);
            if (cleaned) {
                roleMap[rkey.toLowerCase()] = cleaned;
            }
        }
    }

    // Stakeholder roles (only if not already mapped from resources)
    if (stakeholders && stakeholders.length > 0) {
        stakeholders.forEach(function(s) {
            var skey = (s.shortname || s.name || '').toLowerCase();
            if (skey && s.role && !roleMap[skey]) {
                var cleanedRole = cleanRole(s.role);
                if (cleanedRole) {
                    roleMap[skey] = cleanedRole;
                }
            }
        });
    }

    // Build deliverable items with merged roles
    var items = deliverables.map(function(dtask) {
        var mergedRoles = {};
        var qr = dtask.quality_roles || {};
        for (var name in qr) {
            mergedRoles[name.toLowerCase()] = qr[name];
        }
        var resStr = dtask.resources || '';
        if (resStr) {
            resStr.split(',').forEach(function(r) {
                var key = r.trim().toLowerCase();
                if (key && !mergedRoles[key]) {
                    mergedRoles[key] = 'P';
                }
            });
        }
        // Merge child task roles (tasks whose parent matches this deliverable)
        var dtaskName = (dtask.name || '').toLowerCase();
        tasks.forEach(function(t) {
            if ((t.parent || '').toLowerCase() === dtaskName) {
                var childQr = t.quality_roles || {};
                for (var cname in childQr) {
                    if (!mergedRoles[cname.toLowerCase()]) {
                        mergedRoles[cname.toLowerCase()] = childQr[cname];
                    }
                }
                var childRes = t.resources || '';
                if (childRes) {
                    childRes.split(',').forEach(function(r) {
                        var key = r.trim().toLowerCase();
                        if (key && !mergedRoles[key]) {
                            mergedRoles[key] = 'P';
                        }
                    });
                }
            }
        });

        var pct = parseFloat(dtask.percent) || 0;
        var status = pct === 100 ? 'Complete' : (pct > 0 ? 'In Progress' : '');

        return {
            name: (dtask.deliverable || dtask.name || '').replace(/_/g, ' '),
            start: dtask.start || '',
            finish: dtask.finish || '',
            status: status,
            roles: mergedRoles
        };
    });

    return {
        items: items,
        people: peopleList,
        role_map: roleMap
    };
}
