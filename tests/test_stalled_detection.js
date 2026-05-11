/**
 * Tests for detectStalledProject in portfolio-status.js.
 *
 * Verifies that "stalled" status is driven by the `last_saved` front
 * matter timestamp and not by stagnant completion percentage.
 *
 * Run with: node tests/test_stalled_detection.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'packages', 'noodle-web', 'src',
        'noodle_web', 'static', 'portfolio-status.js'),
    'utf8'
);

// detectStalledProject only uses Date and frontMatter — no DOM or
// version-history stubs needed.
const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const { detectStalledProject } = sandbox;

let failures = 0;

function assert(condition, msg) {
    if (!condition) {
        failures++;
        console.error('FAIL:', msg);
    } else {
        console.log('PASS:', msg);
    }
}

// Pin "now" to a known date so timestamps are deterministic.
const now = new Date(2026, 4, 11); // 2026-05-11

function daysAgo(d) {
    // Use the same time-of-day as `now` so floor(elapsed / 86400000)
    // returns exactly `d`.
    const dt = new Date(now);
    dt.setDate(dt.getDate() - d);
    const pad = (n) => String(n).padStart(2, '0');
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} 00:00`;
}

// ── Recent save → not stalled, even if % hasn't moved ──────────────
{
    const fm = { last_saved: daysAgo(1) };
    const result = detectStalledProject(fm, 30, now);
    assert(result.stalled === false, 'saved yesterday is not stalled (even if % stuck)');
    assert(result.daysSinceSave === 1, 'reports 1 day since save');
}

// ── 13 days old → still not stalled (just under threshold) ─────────
{
    const fm = { last_saved: daysAgo(13) };
    const result = detectStalledProject(fm, 50, now);
    assert(result.stalled === false, '13 days since save is not yet stalled');
}

// ── 14 days old → stalled (threshold reached) ──────────────────────
{
    const fm = { last_saved: daysAgo(14) };
    const result = detectStalledProject(fm, 50, now);
    assert(result.stalled === true, '14 days since save is stalled');
    assert(result.daysSinceSave === 14, 'reports 14 days since save');
}

// ── 30 days old → stalled ──────────────────────────────────────────
{
    const fm = { last_saved: daysAgo(30) };
    const result = detectStalledProject(fm, 50, now);
    assert(result.stalled === true, '30 days since save is stalled');
}

// ── Completed projects are never stalled ───────────────────────────
{
    const fm = { last_saved: daysAgo(60) };
    const result = detectStalledProject(fm, 100, now);
    assert(result.stalled === false, '100% complete project is never stalled even if old');
}

// ── Missing last_saved → not stalled (conservative default) ────────
{
    const result = detectStalledProject({}, 50, now);
    assert(result.stalled === false, 'missing last_saved is not stalled');
    assert(result.daysSinceSave === null, 'daysSinceSave is null when no timestamp');
}

// ── Unparseable last_saved → not stalled ───────────────────────────
{
    const result = detectStalledProject({ last_saved: 'not a date' }, 50, now);
    assert(result.stalled === false, 'unparseable last_saved is not stalled');
}

// ── Null frontMatter → not stalled ─────────────────────────────────
{
    const result = detectStalledProject(null, 50, now);
    assert(result.stalled === false, 'null frontMatter is handled gracefully');
}

if (failures > 0) {
    console.error(`\n${failures} test(s) failed.`);
    process.exit(1);
}
console.log('\nAll tests passed.');
