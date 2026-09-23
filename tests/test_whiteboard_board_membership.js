/**
 * Tests for the whiteboard's board-membership pure logic (issue #847):
 * "which tasks aren't on the board yet", "Phase › Sub-phase" path
 * building for the Add-note picker, search/filter matching, rectangle
 * overlap, and first-free-space placement (including the "re-adding a
 * removed task gets a fresh position, never a stale one" acceptance
 * criterion).
 *
 * Runs the real whiteboard-notes.js in a sandbox (same vm-sandbox pattern
 * as tests/test_whiteboard_notes.js for #846) and exercises only the
 * pure, DOM-free helpers -- the Add-note picker's actual DOM/keyboard
 * behaviour, the "Remove from board" menu item, and the real round-trip
 * through plan text are covered by the Selenium-driven
 * tests/test_whiteboard_board_membership.py instead.
 *
 * Run with: node tests/test_whiteboard_board_membership.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'packages', 'noodle-web', 'src',
        'noodle_web', 'static', 'whiteboard-notes.js'),
    'utf8'
);

let failures = 0;
function assert(condition, msg) {
    if (!condition) {
        failures++;
        console.error('FAIL:', msg);
    } else {
        console.log('PASS:', msg);
    }
}

const sandbox = { console };
vm.createContext(sandbox);
// The back-matter section markers wbInsertNewSummaryTaskLine() (issue #980)
// scans for are ordinarily globals from state.js, a separate <script> tag
// in the real app; this sandbox only loads whiteboard-notes.js, so they're
// defined here with the exact same values (see state.js) before that
// source runs. Node's vm module keeps top-level const/let bindings in the
// context's own lexical environment across separate runInContext() calls,
// so a later call (this file's own assertions, and whiteboard-notes.js's
// function bodies) can still see them by plain identifier even though
// they never become sandbox.* properties.
vm.runInContext(`
    const HIGHLIGHTS_START = '---highlights---';
    const BUDGET_START = '---budget---';
    const BENEFITS_START = '---benefits---';
    const RAID_LOG_START = '---raid log---';
    const COMMS_START = '---comms---';
    const LESSONS_START = '---lessons learned---';
    const BASELINE_START = '---baseline---';
    const WHITEBOARD_START = '---whiteboard---';
`, sandbox);
vm.runInContext(source, sandbox);

const {
    wbTaskAncestorNames,
    wbTaskAncestorPath,
    wbSummaryTaskEntries,
    wbTasksNotOnBoard,
    wbFilterPickerEntries,
    wbRectsOverlap,
    wbFindFreeSpacePosition,
    wbBuildAddNoteRows,
    wbLayoutRows,
    wbInsertNewSummaryTaskLine,
} = sandbox;

// ── Fixture: a plan with two same-named summary tasks in different
// phases -- exactly the #838 ambiguity the picker's path display exists
// to resolve -- plus a nested sub-phase three levels deep. ────────────
const tasks = [
    { name: 'Phase 1', is_summary: true, parent: null },
    { name: 'Discovery', is_summary: true, parent: 'Phase 1' },
    { name: 'Research', is_summary: false, parent: 'Discovery' },
    { name: 'Build', is_summary: true, parent: 'Phase 1' },
    { name: 'Testing', is_summary: true, parent: 'Build' },
    { name: 'Regression', is_summary: false, parent: 'Testing' },

    { name: 'Phase 2', is_summary: true, parent: null },
    // Same name as "Discovery" above -- but under a different phase,
    // which is exactly the ambiguity (#838) the picker's parent-path
    // display must resolve. Deliberately a duplicate at *this* level
    // (not e.g. a duplicate "Testing" several levels deep) -- this
    // feature's path display can only ever disambiguate a task from its
    // own siblings-by-name, not from a same-named task buried under a
    // *different* same-named ancestor further up; that deeper case is an
    // inherent limitation of the whole engine's name-only task model
    // (every other view's task lookups share it too), out of scope here.
    { name: 'Discovery', is_summary: true, parent: 'Phase 2' },

    // A leaf. Offered by the picker like any other task (see below) but
    // flagged isSummary: false so the picker can label it.
    { name: 'Leaf Task', is_summary: false, parent: 'Phase 2' },
];

// ── wbTaskAncestorNames / wbTaskAncestorPath ────────────────────────────
{
    assert(wbTaskAncestorNames(tasks, 'Phase 1').length === 0, 'a top-level phase has no ancestors');
    assert(wbTaskAncestorPath(tasks, 'Phase 1') === '', 'a top-level phase has an empty path string');

    assert(wbTaskAncestorPath(tasks, 'Discovery') === 'Phase 1', 'a direct child\'s path is just its parent');

    const regressionAncestors = wbTaskAncestorNames(tasks, 'Regression');
    assert(regressionAncestors.join('|') === 'Phase 1|Build|Testing',
        `three levels deep -> root-most first (got: ${regressionAncestors.join('|')})`);
    assert(wbTaskAncestorPath(tasks, 'Regression') === 'Phase 1 › Build › Testing',
        `ancestor path uses the "›" separator (got: ${wbTaskAncestorPath(tasks, 'Regression')})`);

    assert(wbTaskAncestorPath(tasks, 'Unknown Task') === '', 'an unknown task name has no ancestors, not a throw');
}

// ── wbSummaryTaskEntries ─────────────────────────────────────────────────
{
    const entries = wbSummaryTaskEntries(tasks);
    const names = entries.map(e => e.name);
    // Leaves are offered too, now that the board can create tasks: every
    // new post-it starts as a leaf, so a picker that hid them could not
    // re-add a note the user had just removed from the board.
    assert(names.includes('Research') && names.includes('Regression') && names.includes('Leaf Task'),
        'leaf tasks are offered as picker entries');
    assert(entries.find(e => e.name === 'Leaf Task').isSummary === false,
        'a leaf entry is flagged isSummary: false');
    assert(entries.find(e => e.name === 'Build').isSummary === true,
        'a summary entry is flagged isSummary: true');
    assert(entries.length === tasks.length, 'every task is offerable');
    assert(names.filter(n => n === 'Discovery').length === 2,
        'both same-named summary tasks appear as separate entries');

    const discoveryUnderPhase1 = entries.find(e => e.name === 'Discovery' && e.path === 'Phase 1');
    const discoveryUnderPhase2 = entries.find(e => e.name === 'Discovery' && e.path === 'Phase 2');
    assert(discoveryUnderPhase1 && discoveryUnderPhase2,
        'the two same-named "Discovery" entries are distinguished by their own parent path, ' +
        'not by re-resolving the name (which would collapse them onto one)');
}

// ── wbTasksNotOnBoard ────────────────────────────────────────────────────
{
    // "Discovery" rows are NOT distinguishable by name alone in the
    // whiteboard table (rows are keyed by Task name only, not by path) --
    // so a single row named "discovery" matches, and removes, *both*
    // same-named summary tasks from the not-on-board list. This is a
    // pre-existing whiteboard-row limitation (rows match by name only)
    // that this issue does not change; the picker's own path display is
    // what keeps *adding* unambiguous, since a user can tell the two
    // apart (and choose the right one) before ever adding either.
    const rows = [{ task: 'discovery' }]; // lower-case, must still match case-insensitively
    const remaining = wbTasksNotOnBoard(tasks, rows);
    const names = remaining.map(e => e.name);
    assert(!names.includes('Discovery'), 'both same-named tasks already on the board (case-insensitive) are excluded');
    assert(names.includes('Phase 1') && names.includes('Phase 2') && names.includes('Build') && names.includes('Testing'),
        'every other summary task is still offered');
    assert(names.includes('Leaf Task'), 'leaf tasks are still offered');
    assert(remaining.length === tasks.length - 2,
        'both same-named "Discovery" entries are removed for the one matching row');
}

// ── wbFilterPickerEntries ────────────────────────────────────────────────
{
    const entries = wbSummaryTaskEntries(tasks);

    assert(wbFilterPickerEntries(entries, '').length === entries.length, 'a blank query matches everything');
    assert(wbFilterPickerEntries(entries, '   ').length === entries.length, 'a whitespace-only query matches everything');

    const byName = wbFilterPickerEntries(entries, 'disc');
    assert(byName.filter(e => e.name === 'Discovery').length === 2,
        'search matches by name (case-insensitive, substring), including both same-named entries');
    // "Research" sits under "Discovery", so it matches on path -- the same
    // rule the byPath assertion below covers, just reached from a name.
    assert(byName.some(e => e.name === 'Research'),
        "a task whose parent path contains the query matches too");
    assert(!byName.some(e => e.name === 'Leaf Task'),
        'an entry matching on neither name nor path is excluded');

    const byPath = wbFilterPickerEntries(entries, 'phase 1');
    assert(byPath.some(e => e.name === 'Testing' && e.path === 'Phase 1 › Build'),
        'search also matches by parent path, not just name');
    assert(!byPath.some(e => e.name === 'Phase 2'), 'an entry whose own name/path do not match is excluded');
}

// ── wbRectsOverlap ────────────────────────────────────────────────────────
{
    const a = { x: 0, y: 0, width: 100, height: 100 };
    assert(wbRectsOverlap(a, { x: 50, y: 50, width: 100, height: 100 }) === true, 'overlapping rects are detected');
    assert(wbRectsOverlap(a, { x: 100, y: 0, width: 100, height: 100 }) === false, 'edge-touching rects (no gap) do not overlap');
    assert(wbRectsOverlap(a, { x: 100, y: 0, width: 100, height: 100 }, 10) === true, 'a gap buffer makes edge-touching rects count as overlapping');
    assert(wbRectsOverlap(a, { x: 500, y: 500, width: 100, height: 100 }) === false, 'far-apart rects do not overlap');
}

// ── wbFindFreeSpacePosition ──────────────────────────────────────────────
{
    const viewport = { x: 0, y: 0, width: 1200, height: 800 };
    const width = 260, height = 220, gap = 24;

    const first = wbFindFreeSpacePosition([], viewport, width, height, gap);
    assert(first.x >= viewport.x && first.y >= viewport.y, 'the first placement is inside the viewport');
    assert(first.x + width <= viewport.x + viewport.width, 'the first placement fits within the viewport width');

    const firstRect = { x: first.x, y: first.y, width, height };
    const second = wbFindFreeSpacePosition([firstRect], viewport, width, height, gap);
    assert(!wbRectsOverlap({ x: second.x, y: second.y, width, height }, firstRect, gap),
        'a second placement never overlaps the first');
    assert(!(second.x === first.x && second.y === first.y), 'a second placement is not stacked exactly on the first');

    // A tiny viewport with one existing note already filling it: there is
    // nowhere free "in the current viewport", so the scan must still
    // terminate with a genuinely non-overlapping answer (never loop
    // forever, never silently overlap) even though it can't also satisfy
    // "visible in the viewport" in this specific over-full case.
    const tinyViewport = { x: 0, y: 0, width: 300, height: 260 };
    const blocking = { x: tinyViewport.x + gap, y: tinyViewport.y + gap, width, height };
    const overflow = wbFindFreeSpacePosition([blocking], tinyViewport, width, height, gap);
    assert(!wbRectsOverlap({ x: overflow.x, y: overflow.y, width, height }, blocking, gap),
        'when the viewport is full, the scan still returns a non-overlapping position outside it');
}

// ── wbBuildAddNoteRows: batch placement + "fresh position on re-add" ────
{
    const viewport = { x: 0, y: 0, width: 1200, height: 800 };
    const opts = { width: 260, height: 220, gap: 24 };

    // Batch add: three new rows against an empty board must all land in
    // distinct, non-overlapping cells (the "tidy grid" acceptance
    // criterion) from a single call/single pass.
    const batch = wbBuildAddNoteRows([], viewport, ['A', 'B', 'C'], opts);
    assert(batch.length === 3, 'one row is produced per requested task name');
    assert(batch.map(r => r.task).join(',') === 'A,B,C', 'rows are produced in the requested order');
    for (let i = 0; i < batch.length; i++) {
        for (let j = i + 1; j < batch.length; j++) {
            const ri = { x: batch[i].x, y: batch[i].y, width: opts.width, height: opts.height };
            const rj = { x: batch[j].x, y: batch[j].y, width: opts.width, height: opts.height };
            assert(!wbRectsOverlap(ri, rj, opts.gap), `batch rows ${batch[i].task} and ${batch[j].task} do not overlap each other`);
        }
    }
    batch.forEach(row => {
        assert(row.colour === '' && row.width === null && row.height === null && row.collapsed === false,
            `new row for ${row.task} uses the default colour/size (no explicit override written)`);
    });

    // "Adding a summary task, removing it, and adding it again restores
    // it at the position it was added at, not a stale one" (acceptance
    // criteria, verbatim): simulate exactly that sequence. wbBuildAddNoteRows
    // never remembers anything between calls -- it only ever looks at the
    // existingItems it's handed -- so the proof is that re-adding after
    // the board has changed underneath it (another note now occupies the
    // original spot) produces a position that (a) differs from the first,
    // stale one and (b) still never overlaps what's actually on the board
    // right now.
    const firstAdd = wbBuildAddNoteRows([], viewport, ['A'], opts)[0];
    const staleX = firstAdd.x, staleY = firstAdd.y;

    // "A" removed, then a different note "X" is placed (by the exact same
    // free-space logic a real re-render would use) -- it lands in A's old
    // freed slot, since nothing else occupies it now.
    const xRow = wbBuildAddNoteRows([], viewport, ['X'], opts)[0];
    assert(xRow.x === staleX && xRow.y === staleY, 'sanity check: X took A\'s old freed slot');

    // Re-adding "A" now must NOT reuse the stale (staleX, staleY) -- that
    // spot is occupied by X -- it must compute a fresh, currently-free one.
    const existingNow = [{ task: 'X', x: xRow.x, y: xRow.y, width: opts.width, height: opts.height }];
    const readd = wbBuildAddNoteRows(existingNow, viewport, ['A'], opts)[0];
    assert(!(readd.x === staleX && readd.y === staleY),
        're-adding a removed task must not restore its old, now-stale position');
    const readdRect = { x: readd.x, y: readd.y, width: opts.width, height: opts.height };
    const xRect = { x: xRow.x, y: xRow.y, width: opts.width, height: opts.height };
    assert(!wbRectsOverlap(readdRect, xRect, opts.gap), 're-adding must not overlap whatever now occupies the board');
}

// ── wbLayoutRows: layout tools (tidy/hierarchy/compact/comfy/flow) ───────
{
    const viewport = { x: 0, y: 0, width: 1400, height: 900 };
    const baseItems = [
        { task: 'Phase 1', x: 500, y: 500, width: 420, height: 260 },
        { task: 'Discovery', x: 100, y: 100, width: 190, height: 180 },
        { task: 'Build', x: 200, y: 300, width: 210, height: 200 },
        { task: 'Phase 2', x: 800, y: 200, width: 220, height: 190 },
        { kind: 'text', id: 'note-1', text: 'free text', x: 33, y: 44 },
    ];

    const tidy = wbLayoutRows(baseItems, tasks, 'tidy', {
        viewportRect: viewport,
        gap: 24,
        standardSize: true,
    });
    const tidyNotes = tidy.filter(i => i.task);
    assert(tidyNotes.every(row => row.width === 260 && row.height === 220),
        'tidy layout applies a standard note size');
    assert(tidy.find(i => i.kind === 'text').x === 33 && tidy.find(i => i.kind === 'text').y === 44,
        'layout leaves free-floating text rows untouched');

    const compact = wbLayoutRows(baseItems, tasks, 'compact', { viewportRect: viewport, gap: 8 });
    const comfy = wbLayoutRows(baseItems, tasks, 'comfy', { viewportRect: viewport, gap: 56 });
    const compactStep = compact[1].x - compact[0].x;
    const comfyStep = comfy[1].x - comfy[0].x;
    assert(compactStep < comfyStep, 'compact spacing places notes closer together than comfy spacing');

    const hierarchy = wbLayoutRows(baseItems, tasks, 'hierarchy', { viewportRect: viewport, gap: 24 });
    const hByName = Object.fromEntries(hierarchy.filter(i => i.task).map(i => [i.task, i]));
    assert(hByName['Discovery'].x > hByName['Phase 1'].x,
        'hierarchy view indents a child note relative to its parent');
    assert(hByName['Phase 2'].x > hByName['Phase 1'].x,
        'hierarchy view places multiple top-level summaries in separate columns');

    const flowTasks = [
        { name: 'A', parent: null, dependencies: [] },
        { name: 'B', parent: null, dependencies: [{ target: { name: 'A' } }] },
        { name: 'C', parent: null, dependencies: [{ target: { name: 'B' } }] },
        { name: 'D', parent: null, dependencies: [{ target: { name: 'A' } }] },
    ];
    const flowItems = [
        { task: 'A', x: 0, y: 0 },
        { task: 'B', x: 0, y: 0 },
        { task: 'C', x: 0, y: 0 },
        { task: 'D', x: 0, y: 0 },
    ];
    const flow = wbLayoutRows(flowItems, flowTasks, 'flow', { viewportRect: viewport, gap: 24 });
    const flowByName = Object.fromEntries(flow.map(i => [i.task, i]));
    assert(flowByName.B.x > flowByName.A.x, 'flow view places a dependent task to the right of its prerequisite');
    assert(flowByName.C.x > flowByName.B.x, 'flow view continues dependency chains left-to-right');
    assert(flowByName.D.x > flowByName.A.x, 'flow view places sibling dependents to the right of shared prerequisites');

    const missingDepTasks = [
        { name: 'Only', parent: null, dependencies: [{ target: { name: 'Not On Board' } }] },
    ];
    const missingDepFlow = wbLayoutRows([{ task: 'Only', x: 0, y: 0 }], missingDepTasks, 'flow', {
        viewportRect: viewport, gap: 24,
    });
    assert(missingDepFlow[0].x === 24,
        'flow view ignores missing dependency targets rather than shifting a note right');
}

// ── wbInsertNewSummaryTaskLine: the picker's "create new" outline edit
// (issue #980, reworked by #1015) -- a pure text transform, no DOM, so
// it's covered here rather than only in the Selenium suite. ─────────
{
    // No back-matter at all: the new task is a single bare line at the
    // very end -- no placeholder child. Issue #1015: a brand-new note
    // starts free-form (see wbIsFreeformNote() in whiteboard-notes.js),
    // so nothing here forces it into checklist shape immediately the way
    // the old "New Task" placeholder child used to.
    const plain = 'Phase 1\n  Discovery\n    Research @sam 2d\n';
    const plainResult = wbInsertNewSummaryTaskLine(plain, 'Launch');
    assert(plainResult.endsWith('Launch\n'), 'appends just the new bare task line at the end of a plan with no back matter');
    assert(plainResult.startsWith('Phase 1\n  Discovery\n    Research @sam 2d\n\nLaunch'),
        'the existing outline is left otherwise untouched');
    assert(!plainResult.includes('New Task'), 'no placeholder child is written -- the new task starts as a childless, free-form note');

    // A whiteboard section already exists: the new line must land in the
    // outline, *before* ---whiteboard---, not inside or after it.
    const withBoard = 'Phase 1\n  Discovery\n\n---whiteboard---\n| Task | X | Y |\n|------|---|---|\n| Discovery | 10 | 20 |\n';
    const withBoardResult = wbInsertNewSummaryTaskLine(withBoard, 'Launch');
    const boardMarkerIdx = withBoardResult.indexOf('---whiteboard---');
    const launchIdx = withBoardResult.indexOf('Launch');
    assert(launchIdx !== -1 && launchIdx < boardMarkerIdx, 'the new task line lands before ---whiteboard---, not inside/after it');
    assert(withBoardResult.includes('| Discovery | 10 | 20 |'), 'the existing whiteboard section survives untouched');

    // Multiple back-matter sections: the new line must land before the
    // *first* one encountered (earliest in the text), matching
    // extractWhiteboardFromPlanText()'s own marker scan.
    const withMany = 'Phase 1\n  Discovery\n\n---budget---\nsome budget text\n\n---whiteboard---\n| Task | X | Y |\n|------|---|---|\n';
    const withManyResult = wbInsertNewSummaryTaskLine(withMany, 'Launch');
    const budgetIdx = withManyResult.indexOf('---budget---');
    const launchIdx2 = withManyResult.indexOf('Launch');
    assert(launchIdx2 !== -1 && launchIdx2 < budgetIdx, 'the new task line lands before the earliest back-matter marker');

    // A bare `---` separator ahead of ---highlights--- (written by
    // updatePlanHighlightsText()) belongs to the back matter: the new task
    // must land above it, or the parser sees a phantom task named "---"
    // with the new note stranded beneath it.
    const withHighlights = 'Phase 1\n  Discovery\n\n---\n\n---highlights---\n## 2026-01-01 @kev\nAll good\n\n---end-highlights---\n';
    const withHighlightsResult = wbInsertNewSummaryTaskLine(withHighlights, 'Launch');
    assert(withHighlightsResult.startsWith('Phase 1\n  Discovery\n\nLaunch\n\n---\n\n---highlights---\n'),
        'the new task line lands above the bare --- separator before ---highlights---');

    // A blank/whitespace-only name is a no-op (the caller -- the picker's
    // form -- is responsible for its own "enter a name" validation; this
    // function just refuses to write anything either way).
    const blankResult = wbInsertNewSummaryTaskLine(plain, '   ');
    assert(blankResult === plain, 'a blank/whitespace-only name is a no-op');
}

if (failures > 0) {
    console.error(`\n${failures} test(s) failed.`);
    process.exit(1);
} else {
    console.log('\nAll whiteboard board-membership tests passed.');
}
