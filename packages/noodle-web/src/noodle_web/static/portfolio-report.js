/**
 * Portfolio Report Export
 * Collects data from all projects and exports a multi-slide PowerPoint deck
 * with a portfolio overview slide followed by one slide per project.
 */

/** Where the toast's progress bar sits when deck building starts (#1068). */
const DECK_BUILD_START_PCT = 62;

/**
 * The toast percentage for a deck-build progress message. The worker reports
 * a slide count while assembling, then a final "compressing" message with no
 * count at all -- so hold the bar where it was rather than snapping it back
 * to the start of the band for the last (and slowest) step.
 *
 * @param {number} done   Slides built so far, if known
 * @param {number} total  Slides in the deck, if known
 * @param {number} previous  The percentage currently shown
 */
function deckBuildPercent(done, total, previous) {
    if (!total) return previous;
    return Math.min(DECK_BUILD_START_PCT + (done / total) * 33, 96);
}

/** html2canvas renders at 2x so the slide image is not soft on a projector. */
const TIMELINE_CAPTURE_SCALE = 2;

/** The offscreen capture width, in CSS pixels, as it has always been. */
const TIMELINE_CAPTURE_WIDTH = 1200;

/**
 * The width the portfolio timeline is rasterised at (#1276).
 *
 * The capture used to be taken from the live `#portfolioTimelineView`, so the
 * deck's timeline came out as wide as whatever window the export happened to
 * run in. It is rendered offscreen at a fixed width now, which both keeps the
 * image the same for everyone and leaves the user's view alone.
 */
const PORTFOLIO_TIMELINE_CAPTURE_WIDTH = 1600;

/**
 * Hand the main thread back to the browser, so queued input and a paint can
 * run before the export takes it again (#1276).
 */
function yieldToUi() {
    if (typeof scheduler !== 'undefined' && scheduler && typeof scheduler.yield === 'function') {
        return scheduler.yield();
    }
    return new Promise(function(resolve) { setTimeout(resolve, 0); });
}

/**
 * The markup for one project's timeline block: a date scale header, the SVG
 * swimlane, and a "today" marker when today falls inside the range.
 *
 * @param {Array} tasks - Parsed tasks for the project
 * @param {string} projectName - Project name, shown in the row label
 * @returns {string|null} Inner HTML for the block, or null if there is
 *   nothing worth drawing (no phases, no milestones, or no dates).
 */
function buildProjectTimelineHtml(tasks, projectName) {
    if (typeof renderTimelineScale !== 'function' || typeof assignSwimlanePhaseRows !== 'function') return null;

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

    return scaleHtml + swimlaneHtml + todayHtml;
}

/**
 * One timeline block, as the element html2canvas rasterises.
 *
 * Every block is `.portfolio-timeline-container` with the same width and the
 * same children in the same order, because both of those decide how it looks:
 * the class carries the 12/12/24 padding, and `.timeline-project-row` is
 * styled by `:nth-child(even)`, so the swimlane must stay the second child to
 * keep its zebra background. `position: relative` makes the block the
 * containing block for the absolutely positioned "today" line, which is what
 * the single-block container used to be.
 */
function buildTimelineBlockElement(innerHtml) {
    var block = document.createElement('div');
    block.className = 'portfolio-timeline-container';
    block.style.position = 'relative';
    block.style.width = TIMELINE_CAPTURE_WIDTH + 'px';
    block.style.background = '#ffffff';
    block.innerHTML = innerHtml;
    return block;
}

/**
 * Rasterise several timeline blocks in a single html2canvas call (issue #778).
 *
 * html2canvas clones the whole document into an iframe and re-resolves every
 * stylesheet against it on each call. On this page that fixed cost is ~2.2 s
 * -- an empty element costs the same as a swimlane -- and it used to be paid
 * once per project, which was 87% of a ten-project export's wall clock. The
 * blocks are laid out stacked in one offscreen container instead, rasterised
 * together, and cropped apart afterwards, so the clone is paid once.
 *
 * The pixels are unchanged: each block is the same element, at the same
 * width, with the same class and children as the container that used to be
 * captured on its own, and the crop is taken from its measured box.
 *
 * @param {Array<string|null>} blocks - Inner HTML per project; null entries
 *   are skipped and come back as null.
 * @returns {Promise<Array<string|null>>} Base64 PNGs, aligned with `blocks`.
 */
async function rasteriseTimelineBlocks(blocks) {
    var images = blocks.map(function() { return null; });
    var drawable = blocks
        .map(function(html, index) { return { html: html, index: index }; })
        .filter(function(entry) { return entry.html; });
    if (drawable.length === 0) return images;

    var container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.left = '-9999px';
    container.style.top = '0';
    container.style.width = TIMELINE_CAPTURE_WIDTH + 'px';
    container.style.background = '#ffffff';

    var elements = drawable.map(function(entry) {
        var block = buildTimelineBlockElement(entry.html);
        container.appendChild(block);
        return block;
    });
    document.body.appendChild(container);

    try {
        // Snap each block to a whole CSS pixel first. Block heights are
        // content-driven and land on fractions, which would stack the blocks
        // below the first at fractional offsets -- and text and bar edges
        // rasterise differently at a fractional offset than at zero, which is
        // where a solo capture always drew them. Rounding up costs a row of
        // the block's own white bottom padding and makes every block start on
        // a whole pixel, so each crop matches the solo capture exactly.
        // `box-sizing: border-box` is global here, so this is the same box
        // getBoundingClientRect reports.
        elements.forEach(function(block) {
            block.style.height = Math.ceil(block.getBoundingClientRect().height) + 'px';
        });

        // Measure after the snap: html2canvas leaves the live DOM alone, but
        // reading here keeps the geometry and the pixels from one layout pass.
        var origin = container.getBoundingClientRect();
        var boxes = elements.map(function(block) {
            var rect = block.getBoundingClientRect();
            return {
                left: Math.round((rect.left - origin.left) * TIMELINE_CAPTURE_SCALE),
                top: Math.round((rect.top - origin.top) * TIMELINE_CAPTURE_SCALE),
                // html2canvas ceils an element's box to whole CSS pixels before
                // scaling it, so a block 329.6px tall becomes a 660px canvas at
                // 2x, not 659. Round the same way and the crop comes out the
                // exact size the per-block capture used to produce. The extra
                // row is the block's own white bottom padding either way.
                width: Math.floor(Math.ceil(rect.width) * TIMELINE_CAPTURE_SCALE),
                height: Math.floor(Math.ceil(rect.height) * TIMELINE_CAPTURE_SCALE)
            };
        });

        var sheet = await html2canvas(container, {
            backgroundColor: '#ffffff',
            scale: TIMELINE_CAPTURE_SCALE
        });

        drawable.forEach(function(entry, position) {
            var box = boxes[position];
            if (box.width <= 0 || box.height <= 0) return;
            var crop = document.createElement('canvas');
            crop.width = box.width;
            crop.height = box.height;
            var ctx = crop.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, box.width, box.height);
            ctx.drawImage(sheet, box.left, box.top, box.width, box.height, 0, 0, box.width, box.height);
            images[entry.index] = crop.toDataURL('image/png').split(',')[1] || null;
        });
    } finally {
        container.remove();
    }

    return images;
}

/**
 * Capture one timeline PNG per project.
 *
 * Takes the batched path, and falls back to one html2canvas call per project
 * if that fails, so a capture problem costs speed rather than the images.
 *
 * @param {Array<{tasks: Array, name: string}>} projects
 * @returns {Promise<Array<string|null>>} Base64 PNGs, aligned with `projects`.
 */
async function captureProjectTimelineImages(projects, onProgress) {
    if (typeof html2canvas === 'undefined') return projects.map(function() { return null; });

    var blocks = projects.map(function(project) {
        try {
            return buildProjectTimelineHtml(project.tasks, project.name);
        } catch (err) {
            console.warn('Could not build timeline for ' + project.name + ':', err);
            return null;
        }
    });

    // Hand the main thread back before and after the capture. html2canvas
    // itself is one long task -- measured at ~2.5s fixed plus ~0.15s per
    // block on a ten-project portfolio -- and there is no way to chunk it
    // from out here: splitting the blocks across calls pays that 2.5s again
    // per call to shave under a second off the longest pause. So the export
    // yields around it instead, which is what lets the toast repaint and the
    // queued clicks run (#1276).
    await yieldToUi();

    var images;
    try {
        images = await rasteriseTimelineBlocks(blocks);
    } catch (err) {
        console.warn('Batched timeline capture failed, falling back to one at a time:', err);
        images = [];
        for (var i = 0; i < blocks.length; i++) {
            await yieldToUi();
            try {
                images.push((await rasteriseTimelineBlocks([blocks[i]]))[0]);
            } catch (inner) {
                console.warn('Could not capture project timeline for ' + projects[i].name + ':', inner);
                images.push(null);
            }
            if (onProgress) onProgress(images.length, blocks.length);
        }
        return images;
    }

    if (onProgress) onProgress(images.length, blocks.length);
    await yieldToUi();
    return images;
}

/**
 * Capture the portfolio-wide timeline as a PNG, rendered offscreen (#1276).
 *
 * The export used to force `#portfolioTimelineView` visible, re-render it
 * from scratch and rasterise it in place. That made an export the user had
 * left running in the background reach in and rebuild a view they might be
 * reading -- and it tied the deck's image to the current window width. The
 * same markup is built into a detached, fixed-width element here instead, so
 * nothing the user can see moves.
 *
 * @param {Array} parsedProjects Results in parseAllProjects() shape
 * @returns {Promise<string|null>} Base64 PNG, or null when there is nothing
 *   to draw or the capture fails.
 */
async function capturePortfolioTimelineImage(parsedProjects) {
    if (typeof html2canvas === 'undefined') return null;
    if (typeof buildPortfolioTimelineMarkup !== 'function') return null;

    var built;
    try {
        built = buildPortfolioTimelineMarkup(parsedProjects);
    } catch (err) {
        console.warn('Could not build the portfolio timeline for export:', err);
        return null;
    }
    if (!built) return null;

    var host = document.createElement('div');
    host.style.position = 'absolute';
    host.style.left = '-9999px';
    host.style.top = '0';
    host.style.width = PORTFOLIO_TIMELINE_CAPTURE_WIDTH + 'px';
    host.style.background = '#ffffff';
    host.innerHTML = built.html;
    document.body.appendChild(host);

    try {
        var target = host.querySelector('.portfolio-timeline-container');
        if (!target) return null;
        var canvas = await html2canvas(target, { backgroundColor: '#ffffff', scale: TIMELINE_CAPTURE_SCALE });
        return canvas.toDataURL('image/png').split(',')[1] || null;
    } catch (err) {
        console.warn('Could not capture portfolio timeline as image:', err);
        return null;
    } finally {
        host.remove();
    }
}

/**
 * Capture a single project's timeline as a PNG image using the swimlane style.
 *
 * @param {Array} tasks - Parsed tasks for the project
 * @param {string} projectName - Project name (for logging)
 * @returns {Promise<string|null>} Base64-encoded PNG string, or null on failure
 */
async function captureProjectTimelineImage(tasks, projectName) {
    var images = await captureProjectTimelineImages([{ tasks: tasks, name: projectName }]);
    return images[0];
}

/** The export in flight, if there is one -- see exportPortfolioReport. */
let portfolioExportInFlight = null;

/**
 * Export the portfolio as a PowerPoint report.
 *
 * The work runs in the background (#1276): it is one task, app-wide, that
 * keeps going while the user moves around the app, reports into a toast that
 * outlives the portfolio view, and hands the main thread back between steps
 * so the rest of the app stays responsive. A second click while one is
 * running joins the export already under way rather than starting another --
 * two exports would compete for the same main thread and rasterise the same
 * timelines twice.
 *
 * @returns {Promise} Resolves when the export finishes (or fails).
 */
function exportPortfolioReport() {
    if (portfolioExportInFlight) {
        if (typeof showMessage === 'function') {
            showMessage('editor', 'info', 'A portfolio report export is already running.');
        }
        return portfolioExportInFlight;
    }

    portfolioExportInFlight = runPortfolioReportExport().finally(function() {
        portfolioExportInFlight = null;
    });
    return portfolioExportInFlight;
}

/**
 * The export itself. Parses all projects via /api/parse, collects report data
 * for each, captures the timelines, and builds the deck.
 */
async function runPortfolioReportExport() {
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
        const timelineSpecs = [];
        const totalProjects = parsedProjects.length;
        let projectIndex = 0;

        for (const { project, parsedResult } of parsedProjects) {
            projectIndex++;
            // One project's worth of work per task, so a portfolio of any
            // size never holds the main thread for the whole loop (#1276).
            await yieldToUi();
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

            // The timelines are captured together once the loop has finished,
            // not one per project -- see captureProjectTimelineImages (#778).
            timelineSpecs.push({ tasks: tasks, name: project.name });

            projectReports.push(reportData);
        }

        if (progress) {
            progress.update('Capturing project timelines (' + totalProjects + ')...', 40);
        }
        const timelineImages = await captureProjectTimelineImages(timelineSpecs, function(done, total) {
            if (progress) {
                progress.update(
                    'Capturing project timelines (' + done + '/' + total + ')...',
                    40 + (done / Math.max(total, 1)) * 12
                );
            }
        });
        timelineImages.forEach(function(image, index) {
            if (image) projectReports[index].timeline_image = image;
        });

        // Sort portfolio projects by RAG (red first, then amber, then green)
        var ragOrder = { 'red': 0, 'amber': 1, 'green': 2 };
        portfolioProjects.sort(function(a, b) {
            return (ragOrder[a.rag] || 2) - (ragOrder[b.rag] || 2);
        });

        if (progress) progress.update('Capturing portfolio timeline...', 56);

        // Built and rasterised offscreen, so an export running in the
        // background never touches the view the user is on (#1276).
        await yieldToUi();
        const timelineImageB64 = await capturePortfolioTimelineImage(parsedProjects);

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
            if (progress) progress.update('Building PowerPoint deck...', DECK_BUILD_START_PCT);
            let deckPct = DECK_BUILD_START_PCT;
            const { filename, bytes } = await buildPortfolioDeckOffMainThread(
                { portfolio_name: payload.portfolio_name, date: payload.date, projects: payload.projects, timeline_image: payload.timeline_image },
                payload.project_reports,
                function(done, total, label) {
                    if (!progress) return;
                    deckPct = deckBuildPercent(done, total, deckPct);
                    var suffix = total ? ' (' + done + '/' + total + ')' : '';
                    progress.update('Building PowerPoint: ' + (label || '') + suffix, deckPct);
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
 * block the UI on a large portfolio (issue #1068).
 *
 * Every way the worker itself can fail to run -- no Worker constructor, a
 * constructor that throws, or a module worker that fails to load (older
 * browsers, a blocked or stale asset), which surfaces asynchronously as an
 * error event -- falls back to building on the main thread. Only a failure
 * *inside* the build is reported as an error, since that would fail the same
 * way on either thread.
 *
 * @param {Object} portfolioData
 * @param {Array} projectReports
 * @param {(done: number, total: number, label: string) => void} [onProgress]
 * @returns {Promise<{filename: string, bytes: Uint8Array}>}
 */
function buildPortfolioDeckOffMainThread(portfolioData, projectReports, onProgress) {
    if (typeof Worker === 'undefined') {
        return buildPortfolioDeckOnMainThread(portfolioData, projectReports, onProgress);
    }

    return new Promise(function(resolve, reject) {
        let worker;
        let settled = false;

        function settle(fn, value) {
            if (settled) return;
            settled = true;
            if (worker) worker.terminate();
            fn(value);
        }

        try {
            worker = new Worker('/static/pptx-build-worker.js', { type: 'module' });
        } catch (err) {
            console.warn('Portfolio export: Web Worker unavailable, building on the main thread:', err);
            resolve(buildPortfolioDeckOnMainThread(portfolioData, projectReports, onProgress));
            return;
        }

        worker.onmessage = function(event) {
            const msg = event.data || {};
            if (msg.type === 'progress') {
                if (onProgress) onProgress(msg.done, msg.total, msg.label);
            } else if (msg.type === 'done') {
                settle(resolve, { filename: msg.filename, bytes: msg.bytes });
            } else if (msg.type === 'error') {
                settle(reject, new Error(msg.message || 'Portfolio export failed'));
            }
        };
        worker.onerror = function(err) {
            // The worker never got as far as running: fall back rather than
            // failing the export outright.
            if (settled) return;
            console.warn('Portfolio export: worker failed to start, building on the main thread:', err);
            settle(resolve, buildPortfolioDeckOnMainThread(portfolioData, projectReports, onProgress));
        };
        worker.postMessage({ portfolioData, projectReports });
    });
}

/**
 * Fallback used when the worker can't run: builds on the main thread, with
 * the same progress reporting so the toast keeps moving.
 */
async function buildPortfolioDeckOnMainThread(portfolioData, projectReports, onProgress) {
    const { buildPortfolioDeck, deckBytes, pptxFilename } = await import('/static/pptx-export.js');
    const pptx = buildPortfolioDeck(portfolioData, projectReports, onProgress);
    if (onProgress) onProgress(undefined, undefined, 'Compressing PowerPoint file');
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
