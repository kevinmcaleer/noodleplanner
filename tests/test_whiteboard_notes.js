/**
 * Tests for the whiteboard post-it notes' pure view-model logic (issue #846):
 * direct-children extraction, child-count badges, progress-fraction rollup,
 * WCAG contrast selection, and the zoom-degradation threshold.
 *
 * Runs the real whiteboard-notes.js in a sandbox (same vm-sandbox pattern as
 * tests/test_whiteboard_viewport.js for #845) and exercises only the pure,
 * DOM-free helpers -- DOM rendering itself (foreignObject creation, checkbox
 * wiring, the actual commit path) is covered by the Selenium-driven
 * tests/test_whiteboard_notes.py instead.
 *
 * Run with: node tests/test_whiteboard_notes.js
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
function assertClose(actual, expected, msg, eps = 1e-6) {
    assert(Math.abs(actual - expected) < eps, `${msg} (actual=${actual}, expected=${expected})`);
}

const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const {
    wbDirectChildren,
    wbHasChildren,
    wbChildCount,
    wbIsChildComplete,
    wbNoteProgress,
    wbGetInitials,
    wbResourceList,
    wbRelativeLuminance,
    wbContrastRatio,
    wbContrastTextColour,
    wbNoteZoomTier,
    wbBuildNoteViewModel,
    wbNoteViewModels,
    wbDragBoardDelta,
    wbClampNoteWidth,
    wbClampNoteHeight,
    wbExceedsMoveThreshold,
    wbMoveTaskToEnd,
} = sandbox;

// WB_NOTE_TITLE_ONLY_ZOOM is declared `const` at module scope in
// whiteboard-notes.js, so -- like whiteboard.js's WB_MIN_ZOOM/WB_MAX_ZOOM
// (see test_whiteboard_viewport.js's note on this) -- it doesn't attach as
// an own property of the vm sandbox. Confirm the 40% threshold
// behaviourally via wbNoteZoomTier() below instead.
const WB_NOTE_TITLE_ONLY_ZOOM = 0.4;

// ── Fixture: a small outline mirroring result.tasks' real shape ────────
// Phase 1 (summary)
//   Discovery (summary, direct child of Phase 1)
//     Research @sam 2d 100%          <- leaf, complete
//     Interviews @sam 2d 50%         <- leaf, incomplete
//   Build (summary, direct child of Phase 1)
//     $Widget @sam 3d 100%           <- deliverable leaf, complete
//     Nested (summary)               <- child with its own children
//       Sub A 1d 0%
//       Sub B 1d 0%
const tasks = [
    { name: 'Phase 1', is_summary: true, parent: null, percent: 38, resources: '' },
    { name: 'Discovery', is_summary: true, parent: 'Phase 1', percent: 75, resources: '' },
    { name: 'Research', is_summary: false, parent: 'Discovery', percent: 100, resources: 'Sam Smith' },
    { name: 'Interviews', is_summary: false, parent: 'Discovery', percent: 50, resources: 'Sam Smith' },
    { name: 'Build', is_summary: true, parent: 'Phase 1', percent: 33, resources: '' },
    { name: 'Widget', is_summary: false, parent: 'Build', percent: 100, resources: 'Sam Smith', deliverable: 'Widget' },
    { name: 'Nested', is_summary: true, parent: 'Build', percent: 0, resources: '' },
    { name: 'Sub A', is_summary: false, parent: 'Nested', percent: 0, resources: '' },
    { name: 'Sub B', is_summary: false, parent: 'Nested', percent: 0, resources: '' },
    // A summary with no children is, per the real outline parser
    // (engine/scheduler.js buildTasks()), classified as a leaf
    // (is_summary: false) the moment it has zero nested lines -- this is
    // deliberately NOT is_summary:true, matching what a childless
    // whiteboard-row target actually looks like in result.tasks.
    { name: 'Empty Phase', is_summary: false, parent: null, percent: 0, resources: '' },
];

// ── wbDirectChildren / wbHasChildren / wbChildCount ─────────────────────
{
    const children = wbDirectChildren(tasks, 'Phase 1');
    assert(children.length === 2, 'Phase 1 has exactly 2 direct children');
    assert(children.map(c => c.name).join(',') === 'Discovery,Build', 'direct children are Discovery, Build in order');

    const buildChildren = wbDirectChildren(tasks, 'Build');
    assert(buildChildren.length === 2, 'Build has exactly 2 direct children (Widget, Nested)');
    assert(buildChildren.every(c => c.name !== 'Sub A' && c.name !== 'Sub B'),
        'grandchildren (Sub A/B) are never direct children of Build');

    assert(wbHasChildren(tasks, 'Nested') === true, 'Nested has its own children');
    assert(wbHasChildren(tasks, 'Widget') === false, 'a leaf task has no children');
    assert(wbChildCount(tasks, 'Nested') === 2, 'Nested has a child-count of 2 for its badge');
    assert(wbDirectChildren(tasks, 'Empty Phase').length === 0, 'a summary with no children has zero direct children');
}

// ── wbIsChildComplete / wbNoteProgress ──────────────────────────────────
{
    assert(wbIsChildComplete({ percent: 100 }) === true, '100% child counts as complete');
    assert(wbIsChildComplete({ percent: '100' }) === true, 'string "100" percent counts as complete');
    assert(wbIsChildComplete({ percent: 99 }) === false, '99% child does not count as complete');
    assert(wbIsChildComplete({ percent: '' }) === false, 'blank percent does not count as complete');

    // Direct children of Phase 1 are Discovery (75%, not complete) and
    // Build (33%, not complete) -- both summaries, using their own
    // already-rolled-up percent, same as Gantt/Kanban would show.
    const phaseProgress = wbNoteProgress(tasks, 'Phase 1');
    assert(phaseProgress.completed === 0 && phaseProgress.total === 2,
        `Phase 1 progress is 0/2 by its direct children's own rollup percent (got ${phaseProgress.completed}/${phaseProgress.total})`);

    // Build's direct children: Widget (100%, complete) and Nested (0%, not).
    const buildProgress = wbNoteProgress(tasks, 'Build');
    assert(buildProgress.completed === 1 && buildProgress.total === 2,
        `Build progress is 1/2 (got ${buildProgress.completed}/${buildProgress.total})`);

    const emptyProgress = wbNoteProgress(tasks, 'Empty Phase');
    assert(emptyProgress.completed === 0 && emptyProgress.total === 0, 'an empty summary has 0/0 progress');
}

// ── wbGetInitials / wbResourceList ───────────────────────────────────────
{
    assert(wbGetInitials('Sam Smith') === 'SS', 'two-word name uses first+last initials');
    assert(wbGetInitials('Sam') === 'SA', 'one word >=2 chars uses first two letters');
    assert(wbGetInitials('S') === 'S', 'single-char name uses itself');
    assert(wbGetInitials('') === '?', 'empty name falls back to a placeholder');

    const list = wbResourceList('Sam Smith, Jo Lee');
    assert(list.length === 2 && list[0] === 'Sam Smith' && list[1] === 'Jo Lee', 'resource list splits and trims');
    assert(wbResourceList('').length === 0, 'empty resources string yields an empty list');
}

// ── WCAG contrast helpers ────────────────────────────────────────────────
{
    assertClose(wbRelativeLuminance('#ffffff'), 1, 'white luminance is 1');
    assertClose(wbRelativeLuminance('#000000'), 0, 'black luminance is 0');
    assert(wbRelativeLuminance('not-a-colour') === null, 'invalid colour returns null luminance');

    assertClose(wbContrastRatio('#ffffff', '#000000'), 21, 'white/black contrast ratio is 21:1', 1e-3);

    // A dark navy background should get light text; a pale yellow should
    // get dark text -- checked against an actual computed ratio, not
    // eyeballed.
    assert(wbContrastTextColour('#0a1a3a') === '#fafafa', 'dark navy background gets light text');
    assert(wbContrastTextColour('#fdf6c0') === '#161616', 'pale yellow background gets dark text');
    assert(wbContrastTextColour('') === null, 'no colour returns null so the caller uses the themed default');

    // Whichever text colour wbContrastTextColour() picks must actually
    // clear WCAG AA (4.5:1) for every documented palette-style colour we
    // exercise here, not just look plausible.
    const swatches = ['#4A90D9', '#ff7b01', '#1c9e41', '#c21d1d', '#ffd641', '#161616', '#fafafa'];
    swatches.forEach(bg => {
        const text = wbContrastTextColour(bg);
        const ratio = wbContrastRatio(bg, text);
        assert(ratio >= 4.5, `${bg} + chosen text ${text} clears WCAG AA (ratio=${ratio.toFixed(2)})`);
    });
}

// ── wbNoteZoomTier ───────────────────────────────────────────────────────
{
    assert(wbNoteZoomTier(1, false) === 'full', '100% zoom renders the full note');
    assert(wbNoteZoomTier(0.5, false) === 'full', '50% zoom still renders the full note (readable, per acceptance criteria)');
    assert(wbNoteZoomTier(0.39, false) === 'title-only', 'just below the threshold degrades to title-only');
    assert(wbNoteZoomTier(WB_NOTE_TITLE_ONLY_ZOOM, false) === 'full', 'exactly at the threshold is still full (< threshold triggers title-only)');
    assert(wbNoteZoomTier(1, true) === 'title-only', 'a Collapsed=yes row is title-only regardless of zoom');
}

// ── wbBuildNoteViewModel / wbNoteViewModels ─────────────────────────────
{
    const row = { task: 'phase 1', x: 10, y: 20, colour: '', width: null, height: null, collapsed: false };
    const vm1 = wbBuildNoteViewModel(row, tasks);
    assert(vm1 !== null, 'a row matching a summary task (case-insensitively) builds a view model');
    assert(vm1.task.name === 'Phase 1', 'Task matching is case-insensitive per plan-format.rst');
    assert(vm1.children.length === 2, 'view model carries the direct children');
    assert(vm1.children.every(c => !c.hasChildren) === false, 'Build (one of the two) is flagged correctly below');

    const buildRow = { task: 'Build', x: 0, y: 0, colour: '', width: null, height: null, collapsed: false };
    const vmBuild = wbBuildNoteViewModel(buildRow, tasks);
    const nestedChild = vmBuild.children.find(c => c.task.name === 'Nested');
    const widgetChild = vmBuild.children.find(c => c.task.name === 'Widget');
    assert(nestedChild.hasChildren === true && nestedChild.childCount === 2, 'Nested child carries a 2-count badge flag');
    assert(widgetChild.hasChildren === false, 'Widget (leaf) has no badge');
    assert(widgetChild.task.deliverable === 'Widget', 'deliverable metadata passes through on the child task');

    const orphanRow = { task: 'Does Not Exist', x: 0, y: 0, colour: '', width: null, height: null, collapsed: false };
    assert(wbBuildNoteViewModel(orphanRow, tasks) === null, 'an orphan row (no matching summary task) yields no view model');

    const rows = [row, buildRow, orphanRow];
    const models = wbNoteViewModels(rows, tasks);
    assert(models.length === 2, 'wbNoteViewModels skips orphan rows and returns one model per valid row');
}

// ── Drag/resize pure helpers (issue #848) ───────────────────────────────
{
    // wbDragBoardDelta: screen-space pointer movement divided by zoom, so
    // a dragged note tracks the pointer exactly at every zoom level.
    {
        const { dx, dy } = wbDragBoardDelta(100, 100, 150, 130, 1);
        assertClose(dx, 50, 'at 100% zoom, board delta equals screen delta (x)');
        assertClose(dy, 30, 'at 100% zoom, board delta equals screen delta (y)');
    }
    {
        // At 400% zoom, the same screen-space movement is a quarter as far
        // in board units (the note is magnified 4x, so it must travel 4x
        // less board distance to keep up with the same screen distance).
        const { dx, dy } = wbDragBoardDelta(100, 100, 180, 100, 4);
        assertClose(dx, 20, 'at 400% zoom, board delta is screen delta / 4');
        assertClose(dy, 0, 'no vertical screen movement means no vertical board delta');
    }
    {
        // At 25% zoom, the same screen-space movement is 4x as far in
        // board units (the note is shrunk 4x, so it must travel 4x
        // further in board units to keep up with the same screen distance).
        const { dx } = wbDragBoardDelta(0, 0, 40, 0, 0.25);
        assertClose(dx, 160, 'at 25% zoom, board delta is screen delta / 0.25 (i.e. x4)');
    }
    assertClose(wbDragBoardDelta(0, 0, 10, 0, 0).dx, 10, 'a zero/invalid zoom falls back to treating it as 1 rather than dividing by zero');

    // wbClampNoteWidth / wbClampNoteHeight: a note can never be resized
    // smaller than its header (the existing WB_NOTE_MIN_* used by
    // rendering) nor past a sensible maximum.
    assert(wbClampNoteWidth(10) === 160, 'width clamps up to the minimum (fits the header)');
    assert(wbClampNoteHeight(10) === 120, 'height clamps up to the minimum (fits the header)');
    assert(wbClampNoteWidth(5000) === 900, 'width clamps down to the sensible maximum');
    assert(wbClampNoteHeight(5000) === 900, 'height clamps down to the sensible maximum');
    assert(wbClampNoteWidth(300) === 300, 'a width already in range is left untouched');
    assert(wbClampNoteWidth(300.6) === 301, 'a fractional in-range width is rounded to a whole board unit');

    // wbExceedsMoveThreshold: click-vs-drag (and touch tap-vs-cancel)
    // disambiguation.
    assert(wbExceedsMoveThreshold(0, 0, 1, 1, 3) === false, 'a sub-threshold wobble does not count as a move');
    assert(wbExceedsMoveThreshold(0, 0, 10, 0, 3) === true, 'a movement past the threshold counts as a drag');
    assert(wbExceedsMoveThreshold(0, 0, 0, 0, 3) === false, 'zero movement is never past any positive threshold');

    // wbMoveTaskToEnd: the row-order-derived z-order rule -- "clicking or
    // dragging a note brings it to the front" persisted as "this row's
    // rendered/created last" (see wbRenderNotes()'s creation order).
    {
        const items = [{ task: 'A' }, { task: 'B' }, { task: 'C' }];
        const { items: moved, changed } = wbMoveTaskToEnd(items, 'A');
        assert(changed === true, 'moving a non-last row reports changed=true');
        assert(moved.map(i => i.task).join(',') === 'B,C,A', 'the named row moves to the end, others keep their relative order');
        assert(items.map(i => i.task).join(',') === 'A,B,C', 'the original array is never mutated in place');
    }
    {
        const items = [{ task: 'A' }, { task: 'B' }, { task: 'C' }];
        const { items: moved, changed } = wbMoveTaskToEnd(items, 'C');
        assert(changed === false, 'a row already last reports changed=false (avoids a spurious write)');
        assert(moved === items, 'an already-last row returns the same array reference, not a copy');
    }
    {
        const items = [{ task: 'A' }, { task: 'B' }];
        const { changed } = wbMoveTaskToEnd(items, 'a'); // case-insensitive, per plan-format.rst's Task-matching rule
        assert(changed === true, 'task matching for reorder is case-insensitive');
    }
    {
        const items = [{ task: 'A' }];
        const { items: result, changed } = wbMoveTaskToEnd(items, 'Does Not Exist');
        assert(changed === false && result === items, 'an unknown task name is a safe no-op');
    }
}

// ── Summary ──────────────────────────────────────────────────────────────
if (failures > 0) {
    console.error(`\n${failures} test(s) failed.`);
    process.exit(1);
} else {
    console.log('\nAll whiteboard notes tests passed.');
}
