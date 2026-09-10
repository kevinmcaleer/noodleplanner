/**
 * Tests for calculateDeliveryForecast in portfolio-status.js.
 *
 * Verifies that a green-RAG project is not flagged 'At Risk' just
 * because its completion percentage has stagnated.
 *
 * Run with: node tests/test_forecast_green_rag.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'packages', 'noodle-web', 'src',
        'noodle_web', 'static', 'portfolio-status.js'),
    'utf8'
);

// Stub global hooks the forecast function depends on. The sandbox lets
// each test set the history/percent results before calling.
let stubHistory = [];
let stubCompletionByPlanText = new Map();

const sandbox = {
    console,
    getVersionHistory(_projectId) { return stubHistory; },
    extractCompletionFromPlanText(text) {
        return stubCompletionByPlanText.has(text)
            ? stubCompletionByPlanText.get(text)
            : null;
    },
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const { calculateDeliveryForecast } = sandbox;

let failures = 0;
function assert(condition, msg) {
    if (!condition) { failures++; console.error('FAIL:', msg); }
    else { console.log('PASS:', msg); }
}

// Pin "now" so the system clock can't make velocity flip sign.
const now = new Date(2026, 4, 11);

// Helper: build history where current % is identical to oldest %, so
// velocity is exactly zero.
function flatHistory() {
    stubHistory = [
        { planText: 'newer', date: new Date(2026, 4, 1).toISOString() },
        { planText: 'older', date: new Date(2026, 3, 1).toISOString() },
    ];
    stubCompletionByPlanText = new Map([
        ['newer', 40],
        ['older', 40],
    ]);
}

// ── Green RAG + flat velocity → On Track (was At Risk) ─────────────
{
    flatHistory();
    const result = calculateDeliveryForecast('p1', 40, 'green', now);
    assert(result.status === 'on-track', 'green RAG with stuck % shows On Track');
    assert(result.label === 'On Track', 'label reads "On Track"');
    assert(result.forecastDate === null, 'no forecast date when extrapolation is impossible');
}

// ── Amber RAG + flat velocity → still At Risk ──────────────────────
{
    flatHistory();
    const result = calculateDeliveryForecast('p1', 40, 'amber', now);
    assert(result.status === 'at-risk', 'amber RAG with stuck % stays At Risk');
}

// ── Red RAG + flat velocity → still At Risk ────────────────────────
{
    flatHistory();
    const result = calculateDeliveryForecast('p1', 40, 'red', now);
    assert(result.status === 'at-risk', 'red RAG with stuck % stays At Risk');
}

// ── Green RAG + positive velocity → still a real forecast date ─────
{
    stubHistory = [
        { planText: 'newer', date: new Date(2026, 4, 1).toISOString() },
        { planText: 'older', date: new Date(2026, 3, 1).toISOString() },
    ];
    stubCompletionByPlanText = new Map([
        ['newer', 60],
        ['older', 20],
    ]);
    const result = calculateDeliveryForecast('p1', 60, 'green', now);
    assert(result.status === 'on-track', 'green RAG with positive velocity → On Track');
    // vm sandbox has its own Date constructor, so instanceof Date is
    // false across the realm boundary — duck-type instead.
    assert(result.forecastDate && typeof result.forecastDate.getTime === 'function',
        'forecast date is returned when velocity is positive');
}

// ── Complete project → Complete regardless of RAG ──────────────────
{
    flatHistory();
    const result = calculateDeliveryForecast('p1', 100, 'amber', now);
    assert(result.status === 'complete', '100% complete → Complete regardless of RAG');
}

// ── No history → No History regardless of RAG ──────────────────────
{
    stubHistory = [];
    const result = calculateDeliveryForecast('p1', 40, 'green', now);
    assert(result.status === 'no-forecast', 'no history → No History');
    assert(result.label === 'No History', 'label reads "No History"');
}

if (failures > 0) {
    console.error(`\n${failures} test(s) failed.`);
    process.exit(1);
}
console.log('\nAll tests passed.');
