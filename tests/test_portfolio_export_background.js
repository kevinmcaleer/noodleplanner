/**
 * Tests for the portfolio PowerPoint export running as a background task
 * (issue #1276): the export used to hold the main thread for its whole run,
 * so the rest of the app stopped responding, and it reached into the live
 * portfolio timeline view to capture it -- which rebuilt a view the user
 * might be on, or flashed one up over the page they had navigated to.
 *
 * Runs the real portfolio-report.js in a sandbox (same vm-sandbox pattern as
 * tests/test_portfolio_export_worker.js). The deck's contents are covered by
 * tests/test_pptx_browser_export.mjs and the capture's pixels by
 * tests/test_portfolio_timeline_capture.mjs; this file covers the scheduling
 * and the isolation from the live DOM.
 *
 * Run with: node tests/test_portfolio_export_background.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const STATIC = path.join(__dirname, '..', 'packages', 'noodle-web', 'src',
    'noodle_web', 'static');
const source = fs.readFileSync(path.join(STATIC, 'portfolio-report.js'), 'utf8');

let failures = 0;
function assert(condition, msg) {
    if (!condition) { failures++; console.error('FAIL:', msg); }
    else { console.log('PASS:', msg); }
}
function assertEqual(actual, expected, msg) {
    if (actual !== expected) {
        failures++;
        console.error('FAIL:', msg);
        console.error('  actual:   ' + JSON.stringify(actual));
        console.error('  expected: ' + JSON.stringify(expected));
    } else {
        console.log('PASS:', msg);
    }
}

/**
 * A fresh sandbox with portfolio-report.js loaded. `setTimeout` is the real
 * one, so the yields the export performs are real turns of the event loop.
 */
function loadModule(extra) {
    const sandbox = Object.assign({
        console: { log() {}, warn() {}, error() {} },
        setTimeout,
        clearTimeout
    }, extra || {});
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    return sandbox;
}

// --- one export at a time, app-wide ----------------------------------------

(async function testSecondClickJoinsTheRunningExport() {
    const sandbox = loadModule();

    let runs = 0;
    let release;
    sandbox.runPortfolioReportExport = function() {
        runs++;
        return new Promise(function(resolve) { release = resolve; });
    };
    const messages = [];
    sandbox.showMessage = function(prefix, type, text) { messages.push({ type, text }); };

    const first = sandbox.exportPortfolioReport();
    const second = sandbox.exportPortfolioReport();

    assertEqual(runs, 1, 'a second click while an export is running does not start a second export');
    assert(first === second, 'the second click joins the export already under way');
    assertEqual(messages.length, 1, 'the user is told an export is already running');
    assertEqual(messages[0].type, 'info', 'being told so is information, not an error');

    release();
    await first;

    // Once it has finished, the next click is a fresh export -- the guard is
    // not a one-shot latch that wedges the button for the session.
    sandbox.runPortfolioReportExport = function() { runs++; return Promise.resolve(); };
    await sandbox.exportPortfolioReport();
    assertEqual(runs, 2, 'a click after the export finishes starts a new one');
})();

(async function testGuardClearsAfterAFailedExport() {
    const sandbox = loadModule();

    let runs = 0;
    sandbox.runPortfolioReportExport = function() {
        runs++;
        return Promise.reject(new Error('export blew up'));
    };

    try { await sandbox.exportPortfolioReport(); } catch (e) { /* reported to the user */ }
    try { await sandbox.exportPortfolioReport(); } catch (e) { /* ... */ }

    assertEqual(runs, 2, 'a failed export releases the guard so the user can retry');
})();

// --- the main thread is handed back while capturing ------------------------

/**
 * Stubs the capture's collaborators: every project has a timeline block, and
 * rasterising one is instant. `record` collects one entry per html2canvas
 * batch, which is what the test is really counting.
 */
function loadCaptureModule(record) {
    const sandbox = loadModule({ html2canvas: function() {} });
    sandbox.buildProjectTimelineHtml = function(tasks, name) { return '<div>' + name + '</div>'; };
    sandbox.rasteriseTimelineBlocks = function(blocks) {
        record.batches.push(blocks.length);
        return Promise.resolve(blocks.map(function(html, i) { return 'png-' + i; }));
    };
    return sandbox;
}

function projects(count) {
    const out = [];
    for (let i = 0; i < count; i++) out.push({ tasks: [], name: 'Project ' + (i + 1) });
    return out;
}

(async function testCaptureYieldsAroundTheRasterisation() {
    const record = { batches: [] };
    const sandbox = loadCaptureModule(record);

    // A macrotask that re-arms itself: it can only run while the capture is
    // in flight if the capture hands the main thread back. Before #1276 the
    // export never yielded between the parse, the capture and the download.
    let ticks = 0;
    let running = true;
    (function tick() {
        if (!running) return;
        ticks++;
        setTimeout(tick, 0);
    })();

    const seen = [];
    const images = await sandbox.captureProjectTimelineImages(projects(12), function(done, total) {
        seen.push({ done, total });
    });
    running = false;

    // One html2canvas call for the lot: it costs ~2.5s fixed plus ~0.15s per
    // block, so splitting the blocks across calls would pay that fixed cost
    // again each time (#778). The export yields around the call instead.
    assertEqual(record.batches.length, 1, 'the projects are still rasterised in one html2canvas call');
    assertEqual(record.batches[0], 12, 'every project goes into that one call');
    assertEqual(images.length, 12, 'every project gets an image back');
    assert(ticks > 1, 'the main thread runs other work around the capture (' + ticks + ' turns)');

    assertEqual(seen.length, 1, 'the capture reports progress, so the toast moves');
    assertEqual(seen[0].done, 12, 'progress reports every project captured');
    assertEqual(seen[0].total, 12, 'progress is reported against the project count');
})();

(async function testCaptureFailureFallsBackBlockByBlock() {
    const record = { batches: [] };
    const sandbox = loadCaptureModule(record);

    // The batched call fails; the fallback rasterises one block at a time
    // rather than losing the images.
    let firstCall = true;
    sandbox.rasteriseTimelineBlocks = function(blocks) {
        record.batches.push(blocks.length);
        if (firstCall) {
            firstCall = false;
            return Promise.reject(new Error('html2canvas fell over'));
        }
        return Promise.resolve(blocks.map(function() { return 'png'; }));
    };

    const seen = [];
    const images = await sandbox.captureProjectTimelineImages(projects(3), function(done, total) {
        seen.push(done + '/' + total);
    });

    assertEqual(images.length, 3, 'a failed batch still yields an image per project');
    assertEqual(images.filter(Boolean).length, 3, 'the per-block fallback recovers the images');
    assertEqual(record.batches.join(','), '3,1,1,1', 'the fallback retries one block at a time');
    assertEqual(seen.join(' '), '1/3 2/3 3/3', 'the slow fallback keeps the toast moving per block');
})();

(async function testOneBadBlockDoesNotLoseTheRest() {
    const record = { batches: [] };
    const sandbox = loadCaptureModule(record);

    let firstCall = true;
    sandbox.rasteriseTimelineBlocks = function(blocks) {
        record.batches.push(blocks.length);
        if (firstCall) {
            firstCall = false;
            return Promise.reject(new Error('html2canvas fell over'));
        }
        // The second project's block is the one that cannot be drawn.
        if (blocks[0].indexOf('Project 2') !== -1) return Promise.reject(new Error('bad block'));
        return Promise.resolve(['png']);
    };

    const images = await sandbox.captureProjectTimelineImages(projects(3));

    assertEqual(images.length, 3, 'the images stay aligned with the projects');
    assertEqual(images[1], null, 'the block that cannot be drawn comes back as no image');
    assertEqual(images.filter(Boolean).length, 2, 'the projects either side still get their timelines');
})();

(async function testCaptureWithoutHtml2canvas() {
    const sandbox = loadModule(); // no html2canvas on the page
    const images = await sandbox.captureProjectTimelineImages(projects(3));
    assertEqual(images.filter(function(i) { return i === null; }).length, 3,
        'without html2canvas the export continues with no timeline images');
})();

// --- the portfolio timeline is captured offscreen --------------------------

/** The smallest DOM the offscreen capture touches. */
function fakeDom() {
    const body = { children: [] };
    const created = [];

    function makeElement() {
        const el = {
            style: {},
            innerHTML: '',
            removed: false,
            querySelector(selector) {
                return el.innerHTML.indexOf('portfolio-timeline-container') !== -1
                    ? { selector: selector, host: el }
                    : null;
            },
            remove() {
                el.removed = true;
                const at = body.children.indexOf(el);
                if (at !== -1) body.children.splice(at, 1);
            }
        };
        created.push(el);
        return el;
    }

    return {
        created,
        body,
        document: {
            body: {
                appendChild(el) { body.children.push(el); return el; }
            },
            createElement() { return makeElement(); },
            getElementById() { return null; }
        }
    };
}

(async function testPortfolioTimelineIsCapturedOffscreen() {
    const dom = fakeDom();
    const captured = [];
    const sandbox = loadModule({
        document: dom.document,
        html2canvas: function(element, options) {
            captured.push({ element, options });
            return Promise.resolve({ toDataURL: function() { return 'data:image/png;base64,AAAA'; } });
        }
    });

    let markupCalls = 0;
    sandbox.buildPortfolioTimelineMarkup = function() {
        markupCalls++;
        return { html: '<div class="portfolio-timeline-container"></div>', timelines: [{}] };
    };

    const image = await sandbox.capturePortfolioTimelineImage([{ project: {}, parsedResult: {} }]);

    assertEqual(image, 'AAAA', 'the capture returns the base64 payload, without the data URL prefix');
    assertEqual(markupCalls, 1, 'the timeline markup is built for the capture');
    assertEqual(captured.length, 1, 'the timeline is rasterised once');

    const host = dom.created[0];
    assertEqual(host.style.left, '-9999px', 'the capture happens offscreen, not in the live view');
    assertEqual(host.style.width, '1600px', 'the deck image is a fixed width, not the current window width');
    assert(host.removed, 'the offscreen host is cleaned up afterwards');
    assertEqual(dom.body.children.length, 0, 'nothing is left behind in the document');
})();

(async function testPortfolioTimelineCaptureLeavesTheLiveViewAlone() {
    const dom = fakeDom();
    const liveView = { style: { display: 'none' }, innerHTML: 'the user\'s timeline' };
    dom.document.getElementById = function() { return liveView; };

    const sandbox = loadModule({
        document: dom.document,
        html2canvas: function() {
            return Promise.resolve({ toDataURL: function() { return 'data:image/png;base64,BBBB'; } });
        }
    });
    sandbox.buildPortfolioTimelineMarkup = function() {
        return { html: '<div class="portfolio-timeline-container"></div>', timelines: [{}] };
    };

    let renders = 0;
    sandbox.renderPortfolioTimeline = function() { renders++; return Promise.resolve(); };

    await sandbox.capturePortfolioTimelineImage([{ project: {}, parsedResult: {} }]);

    assertEqual(renders, 0, 'the export no longer re-renders the live portfolio timeline view');
    assertEqual(liveView.style.display, 'none', 'a hidden view is not forced visible mid-export');
    assertEqual(liveView.innerHTML, 'the user\'s timeline', 'the live view is not rebuilt under the user');
})();

(async function testPortfolioTimelineCaptureDegrades() {
    const dom = fakeDom();
    const sandbox = loadModule({
        document: dom.document,
        html2canvas: function() { return Promise.reject(new Error('canvas tainted')); }
    });
    sandbox.buildPortfolioTimelineMarkup = function() {
        return { html: '<div class="portfolio-timeline-container"></div>', timelines: [{}] };
    };

    const image = await sandbox.capturePortfolioTimelineImage([{ project: {}, parsedResult: {} }]);

    assertEqual(image, null, 'a capture failure costs the image, not the export');
    assert(dom.created[0].removed, 'the offscreen host is removed even when the capture throws');

    // Nothing to draw is not a failure either.
    sandbox.buildPortfolioTimelineMarkup = function() { return null; };
    assertEqual(await sandbox.capturePortfolioTimelineImage([]), null,
        'a portfolio with no dated projects exports without a timeline image');
})();

process.on('exit', function() {
    if (failures > 0) {
        console.error('\n' + failures + ' test(s) failed');
        process.exitCode = 1;
    } else {
        console.log('\nAll portfolio background export tests passed');
    }
});
