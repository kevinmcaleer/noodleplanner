/**
 * Tests for assignPhaseRows in views-timeline.js.
 *
 * Verifies the row-assignment rules for the minimal timeline:
 *   - Parents (lower `level`) land in earlier rows than their sub-summaries.
 *   - Total row count is capped at MAX_MINIMAL_TIMELINE_ROWS (= 5).
 *
 * Run with: node tests/test_minimal_timeline_rows.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'packages', 'noodle-web', 'src',
        'noodle_web', 'static', 'views-timeline.js'),
    'utf8'
);

// Sandbox with the minimal set of globals views-timeline.js's
// top-level function definitions need. `assignPhaseRows` itself only
// references `parseLocalDate` from the rest of the codebase.
const sandbox = {
    parseLocalDate(s) {
        if (!s) return null;
        const [y, m, d] = s.split('-').map(Number);
        return new Date(y, m - 1, d);
    },
    document: { getElementById: () => null },
    console,
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const { assignPhaseRows } = sandbox;
// MAX_MINIMAL_TIMELINE_ROWS is a `const` in views-timeline.js, which
// vm.runInContext does not expose on the sandbox. Mirror the value here.
const MAX_MINIMAL_TIMELINE_ROWS = 5;

let failures = 0;

function assertEqual(actual, expected, msg) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) {
        failures++;
        console.error('FAIL:', msg);
        console.error('  expected:', JSON.stringify(expected));
        console.error('  actual:  ', JSON.stringify(actual));
    } else {
        console.log('PASS:', msg);
    }
}

// Helpers — pick a minDate / totalDays / width that make positions
// trivial: 1 day == 1 unit, so startPos/endPos line up with day offsets.
const minDate = new Date(2026, 0, 1); // 2026-01-01
const totalDays = 100;
const timelineWidth = 100; // pixels-per-day = 1

// ── Test 1: parent first, then sub-summary ─────────────────────────
// Parent phase (level 1) spans 0–30 days; child sub-summary (level 2)
// spans 0–15 days. They share a start date. Greedy packing without
// hierarchy could put the child in row 0 if it sorted first; this test
// pins the new behaviour: parent (lower level) goes in row 0.
{
    const phases = [
        { name: 'child', level: 2, start: '2026-01-01', finish: '2026-01-15' },
        { name: 'parent', level: 1, start: '2026-01-01', finish: '2026-01-30' },
    ];
    const result = assignPhaseRows(phases, minDate, totalDays, timelineWidth);
    const byName = Object.fromEntries(result.map(r => [r.phase.name, r.row]));
    assertEqual(byName.parent, 0, 'parent (level 1) lands in row 0');
    assertEqual(byName.child > byName.parent, true, 'child (level 2) lands below parent');
}

// ── Test 2: row cap drops the deepest sub-summaries ────────────────
// Six fully-overlapping phases, all at different levels. With the cap
// of 5, only the first five (sorted by level) should appear.
{
    const phases = Array.from({ length: 6 }, (_, i) => ({
        name: `p${i + 1}`,
        level: i + 1,
        start: '2026-01-01',
        finish: '2026-01-30',
    }));
    const result = assignPhaseRows(phases, minDate, totalDays, timelineWidth);
    assertEqual(result.length, MAX_MINIMAL_TIMELINE_ROWS, 'row count capped at 5');
    const usedRows = new Set(result.map(r => r.row));
    assertEqual(usedRows.size, MAX_MINIMAL_TIMELINE_ROWS, '5 distinct rows used');
    const names = result.map(r => r.phase.name).sort();
    // The deepest (level 6) should be dropped.
    assertEqual(names.includes('p6'), false, 'deepest sub-summary (level 6) is dropped');
    assertEqual(names.includes('p1'), true, 'top-level parent (level 1) kept');
}

// ── Test 3: same-level phases that do not overlap share a row ──────
{
    const phases = [
        { name: 'a', level: 1, start: '2026-01-01', finish: '2026-01-10' },
        { name: 'b', level: 1, start: '2026-01-15', finish: '2026-01-25' },
        { name: 'c', level: 1, start: '2026-01-30', finish: '2026-02-09' },
    ];
    const result = assignPhaseRows(phases, minDate, totalDays, timelineWidth);
    const byName = Object.fromEntries(result.map(r => [r.phase.name, r.row]));
    assertEqual(byName.a, 0, 'non-overlapping a at row 0');
    assertEqual(byName.b, 0, 'non-overlapping b reuses row 0');
    assertEqual(byName.c, 0, 'non-overlapping c reuses row 0');
}

// ── Test 4: missing level defaults to 0 (top level) ────────────────
{
    const phases = [
        { name: 'untagged', start: '2026-01-01', finish: '2026-01-10' },
        { name: 'level3', level: 3, start: '2026-01-01', finish: '2026-01-10' },
    ];
    const result = assignPhaseRows(phases, minDate, totalDays, timelineWidth);
    const byName = Object.fromEntries(result.map(r => [r.phase.name, r.row]));
    assertEqual(byName.untagged, 0, 'phase with no level treated as top level (row 0)');
    assertEqual(byName.level3 > byName.untagged, true, 'level-3 phase placed below untagged');
}

// ── Test 5: sub-summary stays beneath its parent even when row 0 has
// horizontal room ───────────────────────────────────────────────────
// B1 is a child of B (document order: nearest preceding lower level)
// and starts after everything in row 0 has finished. Pure greedy
// packing used to place it in row 0 next to the top-level groups;
// it must land strictly below its parent's row instead.
{
    const phases = [
        { name: 'A',  level: 1, start: '2026-01-01', finish: '2026-01-10' },
        { name: 'B',  level: 1, start: '2026-01-12', finish: '2026-01-20' },
        { name: 'B1', level: 2, start: '2026-01-21', finish: '2026-01-28' },
    ];
    const result = assignPhaseRows(phases, minDate, totalDays, timelineWidth);
    const byName = Object.fromEntries(result.map(r => [r.phase.name, r.row]));
    assertEqual(byName.A, 0, 'top-level A in row 0');
    assertEqual(byName.B, 0, 'top-level B reuses row 0');
    assertEqual(byName.B1 > byName.B, true, 'sub-summary B1 lands beneath its parent B, not in row 0');
}

// ── Test 6: children of nested parents stack beneath their own chain ─
// C1 is a child of C; C1a is a child of C1. Each must be strictly
// below its own parent, giving three stacked rows.
{
    const phases = [
        { name: 'C',   level: 1, start: '2026-01-01', finish: '2026-02-09' },
        { name: 'C1',  level: 2, start: '2026-01-01', finish: '2026-01-20' },
        { name: 'C1a', level: 3, start: '2026-01-25', finish: '2026-02-04' },
    ];
    const result = assignPhaseRows(phases, minDate, totalDays, timelineWidth);
    const byName = Object.fromEntries(result.map(r => [r.phase.name, r.row]));
    assertEqual(byName.C, 0, 'parent C in row 0');
    assertEqual(byName.C1 > byName.C, true, 'C1 beneath C');
    // C1a starts after C1 ends, but must still sit beneath C1, not beside it.
    assertEqual(byName.C1a > byName.C1, true, 'C1a beneath C1 despite no horizontal overlap');
}

// ── Test 7: children of a dropped parent are dropped too ───────────
// A 7-deep fully-overlapping chain: levels 6 and 7 both exceed the
// 5-row cap. Level 7's parent (level 6) is dropped, so level 7 must
// not reappear in some higher row.
{
    const phases = Array.from({ length: 7 }, (_, i) => ({
        name: `p${i + 1}`,
        level: i + 1,
        start: '2026-01-01',
        finish: '2026-01-30',
    }));
    const result = assignPhaseRows(phases, minDate, totalDays, timelineWidth);
    const names = result.map(r => r.phase.name);
    assertEqual(result.length, MAX_MINIMAL_TIMELINE_ROWS, 'row cap still enforced at 5');
    assertEqual(names.includes('p6'), false, 'p6 dropped by cap');
    assertEqual(names.includes('p7'), false, 'p7 dropped because its parent was dropped');
}

if (failures > 0) {
    console.error(`\n${failures} test(s) failed.`);
    process.exit(1);
}
console.log('\nAll tests passed.');
