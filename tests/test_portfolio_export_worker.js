/**
 * Tests for the portfolio PowerPoint export's off-main-thread build
 * (issue #1068): how buildPortfolioDeckOffMainThread dispatches between the
 * Web Worker and the main-thread fallback, and how worker progress messages
 * map onto the toast's progress bar.
 *
 * Runs the real portfolio-report.js in a sandbox (same vm-sandbox pattern as
 * tests/test_whiteboard_noodles.js). The deck's *contents* are covered by
 * tests/test_pptx_browser_export.mjs; this file only covers the plumbing
 * around it, which is what actually decides whether an export completes.
 *
 * Run with: node tests/test_portfolio_export_worker.js
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
 * A fresh sandbox with portfolio-report.js loaded. `Worker` is whatever the
 * caller supplies (omit it to model a browser without Web Workers), and the
 * main-thread fallback is stubbed so the tests never load PptxGenJS.
 */
function loadModule({ Worker } = {}) {
    const sandbox = { console: { log() {}, warn() {}, error() {} } };
    if (Worker) sandbox.Worker = Worker;
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);

    sandbox.mainThreadCalls = [];
    sandbox.buildPortfolioDeckOnMainThread = function(portfolioData, projectReports, onProgress) {
        sandbox.mainThreadCalls.push({ portfolioData, projectReports, onProgress });
        if (onProgress) onProgress(1, 1, 'Main thread build');
        return Promise.resolve({ filename: 'Fallback.pptx', bytes: new Uint8Array([1, 2, 3]) });
    };
    return sandbox;
}

/** A fake Worker whose behaviour each test drives by hand. */
function fakeWorkerClass(record) {
    return class FakeWorker {
        constructor(url, options) {
            record.url = url;
            record.options = options;
            record.terminated = false;
            record.posted = [];
            record.instance = this;
            this.onmessage = null;
            this.onerror = null;
        }
        postMessage(data) { record.posted.push(data); }
        terminate() { record.terminated = true; }
        /** Deliver a message as the real worker would. */
        emit(data) { if (this.onmessage) this.onmessage({ data }); }
        /** Fire the error event a worker that fails to load produces. */
        emitError(err) { if (this.onerror) this.onerror(err || {}); }
    };
}

// --- the progress bar ------------------------------------------------------

(function testDeckBuildPercent() {
    const { deckBuildPercent } = loadModule();

    assertEqual(deckBuildPercent(0, 4, 62), 62, 'no slides built yet leaves the bar at the start of the band');
    assertEqual(deckBuildPercent(2, 4, 62), 78.5, 'half the slides puts the bar half way up the band');
    assertEqual(deckBuildPercent(4, 4, 78.5), 95, 'the last slide takes the bar to the top of the band');
    assertEqual(deckBuildPercent(100, 4, 95), 96, 'the bar is clamped at 96 so it never claims to be finished');

    // The worker's final "Compressing PowerPoint file" message carries no
    // slide count -- the bar used to snap back to 62% for the slowest step.
    assertEqual(deckBuildPercent(undefined, undefined, 95), 95, 'a message with no slide count holds the bar where it is');
    assertEqual(deckBuildPercent(0, 0, 95), 95, 'a zero total holds the bar rather than dividing by zero');
})();

// --- dispatching between worker and main thread ----------------------------

(async function testNoWorkerSupport() {
    const sandbox = loadModule(); // no Worker in this browser
    const result = await sandbox.buildPortfolioDeckOffMainThread({ portfolio_name: 'P' }, [], null);

    assertEqual(sandbox.mainThreadCalls.length, 1, 'without Worker support the deck is built on the main thread');
    assertEqual(result.filename, 'Fallback.pptx', 'the main-thread build resolves the export');
})();

(async function testWorkerConstructorThrows() {
    const sandbox = loadModule({
        Worker: class { constructor() { throw new Error('workers are blocked'); } }
    });
    const result = await sandbox.buildPortfolioDeckOffMainThread({ portfolio_name: 'P' }, []);

    assertEqual(sandbox.mainThreadCalls.length, 1, 'a Worker constructor that throws falls back to the main thread');
    assertEqual(result.filename, 'Fallback.pptx', 'the fallback still resolves the export');
})();

(async function testWorkerFailsToLoad() {
    // The realistic failure: the module worker's script or its imports fail
    // to load, which surfaces asynchronously as an error event. This used to
    // reject and fail the whole export instead of falling back.
    const record = {};
    const sandbox = loadModule({ Worker: fakeWorkerClass(record) });

    const pending = sandbox.buildPortfolioDeckOffMainThread({ portfolio_name: 'P' }, []);
    record.instance.emitError({ message: 'Failed to load module script' });
    const result = await pending;

    assertEqual(sandbox.mainThreadCalls.length, 1, 'a worker that fails to load falls back to the main thread');
    assertEqual(result.filename, 'Fallback.pptx', 'the export completes despite the worker never starting');
    assert(record.terminated, 'the dead worker is terminated');
})();

(async function testFallbackReportsProgress() {
    const record = {};
    const sandbox = loadModule({ Worker: fakeWorkerClass(record) });

    const seen = [];
    const pending = sandbox.buildPortfolioDeckOffMainThread({ portfolio_name: 'P' }, [],
        function(done, total, label) { seen.push(label); });
    record.instance.emitError({});
    await pending;

    assertEqual(seen.length, 1, 'the main-thread fallback keeps reporting progress, so the toast does not stall');
    assertEqual(seen[0], 'Main thread build', 'the fallback forwards the progress callback it was given');
})();

(async function testWorkerSuccess() {
    const record = {};
    const sandbox = loadModule({ Worker: fakeWorkerClass(record) });

    const seen = [];
    const pending = sandbox.buildPortfolioDeckOffMainThread(
        { portfolio_name: 'Demo' }, [{ project_name: 'Alpha' }],
        function(done, total, label) { seen.push({ done, total, label }); });

    assertEqual(record.url, '/static/pptx-build-worker.js', 'the worker is loaded from the static path');
    assertEqual(record.options && record.options.type, 'module', 'the worker is a module worker, matching its import syntax');
    assertEqual(record.posted.length, 1, 'the payload is posted to the worker');
    assertEqual(record.posted[0].projectReports[0].project_name, 'Alpha', 'the project reports are handed to the worker');

    record.instance.emit({ type: 'progress', done: 1, total: 3, label: 'Portfolio overview' });
    record.instance.emit({ type: 'progress', label: 'Compressing PowerPoint file' });
    record.instance.emit({ type: 'done', filename: 'Demo - Portfolio Report.pptx', bytes: new Uint8Array([7]) });
    const result = await pending;

    assertEqual(seen.length, 2, 'every worker progress message reaches the caller');
    assertEqual(seen[1].total, undefined, 'the compression message carries no slide count');
    assertEqual(result.filename, 'Demo - Portfolio Report.pptx', 'the worker-built deck resolves the export');
    assertEqual(sandbox.mainThreadCalls.length, 0, 'a working worker never triggers the main-thread fallback');
    assert(record.terminated, 'the worker is terminated once it is done');
})();

(async function testBuildErrorRejects() {
    // A failure *inside* the build would fail the same way on the main
    // thread, so it is reported rather than silently retried.
    const record = {};
    const sandbox = loadModule({ Worker: fakeWorkerClass(record) });

    const pending = sandbox.buildPortfolioDeckOffMainThread({ portfolio_name: 'P' }, []);
    record.instance.emit({ type: 'error', message: 'slide 3 blew up' });

    let message = null;
    try { await pending; } catch (err) { message = err.message; }

    assertEqual(message, 'slide 3 blew up', 'a build error inside the worker is reported to the caller');
    assertEqual(sandbox.mainThreadCalls.length, 0, 'a build error does not silently rebuild on the main thread');
})();

(async function testLateErrorAfterDone() {
    const record = {};
    const sandbox = loadModule({ Worker: fakeWorkerClass(record) });

    const pending = sandbox.buildPortfolioDeckOffMainThread({ portfolio_name: 'P' }, []);
    record.instance.emit({ type: 'done', filename: 'Done.pptx', bytes: new Uint8Array([1]) });
    record.instance.emitError({ message: 'too late' });
    const result = await pending;

    assertEqual(result.filename, 'Done.pptx', 'an error event after a successful build is ignored');
    assertEqual(sandbox.mainThreadCalls.length, 0, 'a late error does not start a second, redundant build');
})();

// --- the worker stays DOM-free ---------------------------------------------

(function testWorkerImportsAreDomFree() {
    const workerSource = fs.readFileSync(path.join(STATIC, 'pptx-build-worker.js'), 'utf8');
    const imported = /import\s*{([^}]*)}\s*from\s*"\.\/pptx-export\.js"/.exec(workerSource);
    assert(imported, 'the worker imports named helpers from pptx-export.js');

    // Worker scope has no document: pptx-export.js's download helpers touch
    // the DOM, so importing one here would break the export at runtime.
    const allowed = ['buildPortfolioDeck', 'deckBytes', 'pptxFilename'];
    const names = imported[1].split(',').map(function(n) { return n.trim(); }).filter(Boolean);
    names.forEach(function(name) {
        assert(allowed.indexOf(name) !== -1, 'the worker imports only DOM-free helpers (' + name + ')');
    });
})();

process.on('exit', function() {
    console.log(failures === 0 ? '\nAll tests passed' : '\n' + failures + ' test(s) failed');
    process.exitCode = failures === 0 ? 0 : 1;
});
