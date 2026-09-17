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

const NoodlePlanModel = require(path.join(__dirname, '..', 'packages', 'noodle-web', 'src',
    'noodle_web', 'static', 'plan-model.js'));
const sandbox = { console, NoodlePlanModel };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'packages', 'noodle-web', 'src',
    'noodle_web', 'static', 'task-tokenizer.js'), 'utf8'), sandbox);
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
    wbBuildPeekLevel,
    wbIsFreeformNote,
    wbSanitiseChildTaskName,
    wbPalette,
    wbShadeColour,
    wbDerivedPaletteColour,
    wbThemeColourFor,
    wbResolveNoteColour,
    wbDragBoardDelta,
    wbClampNoteWidth,
    wbClampNoteHeight,
    wbExceedsMoveThreshold,
    wbMoveTaskToEnd,
    wbActivityLanguageHint,
    wbTaskPlanningType,
    wbReplacePlanningTypeToken,
    wbApplyPlanningTypeToPlanText,
    wbAddNamedDependencyToPlanText,
    wbDetectNaturalDates,
    wbApplyDateChoiceToLine,
    wbApplyDateChoiceToPlanText,
    wbResourceOptionsFromPlanText,
    wbApplyResourceToLine,
    wbApplyResourceToPlanText,
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
    // whiteboard-row target actually looks like in result.tasks. Carries a
    // `comment` -- the same field the task-details form's "Comment"
    // textarea reads/writes -- so this doubles as the free-form note
    // (issue #1015) fixture: zero children, some free text.
    { name: 'Empty Phase', is_summary: false, parent: null, percent: 0, resources: '', comment: 'Chase the vendor for a quote.' },
    // A second childless task with no comment at all, for the "blank
    // free-form note" case -- no text, no placeholder, nothing.
    { name: 'Blank Idea', is_summary: false, parent: null, percent: 0, resources: '' },
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

// ── Parser-only facilitator hints and planning type (#875) ─────────────
{
    assert(wbActivityLanguageHint('Draft the business case').word === 'draft',
        'curated leading producer verb gets a gentle activity hint');
    assert(wbActivityLanguageHint('Installing the agent').kind === 'gerund',
        'leading gerund gets an activity hint');
    assert(wbActivityLanguageHint('Test plan') === null,
        'product-shaped “Test plan” is not misclassified as an activity');
    assert(wbActivityLanguageHint('Test the integration').word === 'test',
        'verb-shaped “Test the integration” still gets a hint');
    assert(wbActivityLanguageHint('Approved design') === null,
        'ordinary product noun phrase remains untyped');

    assert(wbTaskPlanningType({ labels: 'urgent, product' }) === 'product',
        '#product is read from ordinary task labels');
    assert(wbTaskPlanningType({ labels: 'activity' }) === 'activity',
        '#activity is read from ordinary task labels');
    assert(wbTaskPlanningType({ labels: '' }) === null, 'classification stays optional');

    const typed = wbReplacePlanningTypeToken('  Draft case 2d #urgent #activity "say #product here"', 'product');
    assert(typed.includes('#urgent') && typed.endsWith('#product'),
        'changing planning type preserves other metadata and writes the new ordinary label');
    assert(typed.includes('"say #product here"'), 'planning type tokens inside comments are never rewritten');
    assert(!typed.includes('#activity'), 'old planning type is removed');

    const plan = 'Phase\n  Draft case 2d #urgent\n  Review 1d\n';
    const classified = wbApplyPlanningTypeToPlanText(plan, 'Draft case', 'activity');
    assert(classified.includes('Draft case 2d #urgent #activity'), 'classification updates the canonical task line');
    const linked = wbAddNamedDependencyToPlanText(classified, 'Review', 'Draft case');
    assert(linked.includes('Review 1d [depends Draft case]'), 'facilitator-created relation is a real scheduling dependency');
}

// ── Natural-language dates and quick assignment (#878) ────────────────
{
    const reference = new Date(2026, 8, 10);
    const detected = wbDetectNaturalDates('Go live 15th March; review March 20, 2027.', reference);
    assert(detected.length === 2, 'day-first and month-first prose dates are detected');
    assert(detected[0].date === '2026-03-15' && detected[1].date === '2027-03-20',
        'yearless prose uses the reference year and an explicit year is preserved');
    assert(wbDetectNaturalDates('Maybe on 31 February 2026', reference).length === 0,
        'impossible prose dates are ignored');
    assert(wbDetectNaturalDates('Ship 14/04/2027', reference)[0].date === '2027-04-14',
        'unambiguous day/month numeric dates are detected');

    assert(wbApplyDateChoiceToLine('Launch 2d', 'start', '2026-03-15') === 'Launch 2d 2026-03-15',
        'start attaches through existing positional date syntax');
    assert(wbApplyDateChoiceToLine('Launch 2d 2026-03-01', 'finish', '2026-03-15') === 'Launch 2d 2026-03-01 2026-03-15',
        'finish becomes the second positional date');
    const milestone = wbApplyDateChoiceToLine('Launch 4d 2026-03-01 @sam', 'milestone', '2026-03-15');
    assert(milestone === 'Launch @sam 0d 2026-03-15', 'milestone replaces scheduling dates/duration while preserving other metadata');
    const deadline = wbApplyDateChoiceToLine('Launch 2d', 'deadline', '2026-03-15');
    assert(deadline === 'Launch 2d D2026-03-15', 'deadline is explicit and does not masquerade as a start date');

    const datedPlan = wbApplyDateChoiceToPlanText('Phase\n  Go live 15th March 2d\n', 'Go live 15th March', 'start', '2026-03-15');
    assert(datedPlan.includes('Go live 15th March 2d 2026-03-15'), 'confirmed smart tag updates the canonical task line');

    const frontMatter = '---\nResources:\n  - @sam: Sam Smith, Developer\n  - @jo: Jo Lee\n---\nPhase\n  Build 2d\n';
    const options = wbResourceOptionsFromPlanText(frontMatter);
    assert(options.length === 2 && options[0].shortname === 'sam' && options[0].role === 'Developer',
        'quick assignment reuses resources declared in front matter');
    assert(wbApplyResourceToLine('Build 2d "ask @sam later"', 'sam', true) === 'Build 2d "ask @sam later" @sam',
        'assignment preserves resource-like text inside comments');
    const assigned = wbApplyResourceToPlanText(frontMatter, 'Build', 'sam', true);
    assert(assigned.includes('Build 2d @sam'), 'quick assignment writes the ordinary resource token');
    const removed = wbApplyResourceToPlanText(assigned, 'Build', 'sam', false);
    assert(!removed.includes('Build 2d @sam'), 'clicking an assigned resource removes its ordinary token');
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

// ── wbIsFreeformNote (issue #1015 -- free-form vs. checklist note) ──────
{
    const emptyRow = { task: 'Empty Phase', x: 0, y: 0, colour: '', width: null, height: null, collapsed: false };
    const vmEmpty = wbBuildNoteViewModel(emptyRow, tasks);
    assert(wbIsFreeformNote(vmEmpty) === true, 'a task with zero children builds a free-form view model');
    assert(vmEmpty.task.comment === 'Chase the vendor for a quote.', 'the free-form view model carries the task\'s own comment');

    const blankRow = { task: 'Blank Idea', x: 0, y: 0, colour: '', width: null, height: null, collapsed: false };
    const vmBlank = wbBuildNoteViewModel(blankRow, tasks);
    assert(wbIsFreeformNote(vmBlank) === true, 'a childless task with no comment is still free-form (just blank)');
    assert(!vmBlank.task.comment, 'no comment means nothing to show in the free-form body');

    const buildRow2 = { task: 'Build', x: 0, y: 0, colour: '', width: null, height: null, collapsed: false };
    const vmBuild2 = wbBuildNoteViewModel(buildRow2, tasks);
    assert(wbIsFreeformNote(vmBuild2) === false, 'a task with children is a checklist note, not free-form');

    // A task all of whose children have been noodled onto their own notes
    // (children.length === 0 but linkedChildren.length > 0) is still a
    // checklist -- real structure exists in the outline, it just isn't
    // drawn as rows inside *this* note. See wbIsFreeformNote()'s own doc
    // comment for why this deliberately isn't free-form.
    const linkedOnlyRow = { task: 'Build', x: 0, y: 0, colour: '', width: null, height: null, collapsed: false };
    const vmLinkedOnly = wbBuildNoteViewModel(linkedOnlyRow, tasks, {}, ['widget', 'nested']);
    assert(vmLinkedOnly.children.length === 0 && vmLinkedOnly.linkedChildren.length === 2,
        'both of Build\'s children are treated as already on the board for this check');
    assert(wbIsFreeformNote(vmLinkedOnly) === false,
        'a task whose children are all shown as noodles elsewhere is still a checklist, not free-form');

    assert(wbIsFreeformNote(null) === false, 'a missing view model is never treated as free-form');
}

// ── wbSanitiseChildTaskName (issue #1020 -- "promote to task") ──────────
{
    assert(wbSanitiseChildTaskName('Chase the vendor for a quote.') === 'Chase the vendor for a quote.',
        'ordinary comment text passes through unchanged');
    assert(wbSanitiseChildTaskName('  Needs   sign-off   ') === 'Needs sign-off',
        'whitespace runs collapse to one space and the ends are trimmed');
    assert(wbSanitiseChildTaskName('Line one\nLine two\r\nLine three') === 'Line one Line two Line three',
        'embedded newlines collapse to a space, same defence as #1006\'s newline-injection fix');
    assert(wbSanitiseChildTaskName('Say "hello" to the vendor') === "Say 'hello' to the vendor",
        'double quotes -- the outline\'s own comment delimiter -- become single quotes');
    assert(wbSanitiseChildTaskName('   ') === '', 'whitespace-only text sanitises to nothing');
    assert(wbSanitiseChildTaskName('') === '', 'empty text sanitises to nothing');
    assert(wbSanitiseChildTaskName(null) === '', 'null text sanitises to nothing');

    const long = 'x'.repeat(120);
    const sanitisedLong = wbSanitiseChildTaskName(long);
    assert(sanitisedLong.length === 81, 'a long comment is capped to 80 characters plus an ellipsis');
    assert(sanitisedLong.endsWith('…'), 'a truncated name ends with an ellipsis marking the cut');
    assert(sanitisedLong.startsWith('x'.repeat(80)), 'a truncated name keeps its first 80 characters intact');
}

// ── wbBuildPeekLevel (issue #850 -- task-peek popover's view-model) ─────
{
    const buildLevel = wbBuildPeekLevel('Build', tasks);
    assert(buildLevel !== null, 'a known task builds a peek level');
    assert(buildLevel.task.name === 'Build', 'the level carries the requested task');
    assert(buildLevel.children.length === 2, 'Build has exactly 2 direct children (Widget, Nested)');

    const nestedInPeek = buildLevel.children.find(c => c.task.name === 'Nested');
    const widgetInPeek = buildLevel.children.find(c => c.task.name === 'Widget');
    assert(nestedInPeek.hasChildren === true && nestedInPeek.childCount === 2,
        'a peek row for a child-with-children carries the same hasChildren/childCount a note row does');
    assert(nestedInPeek.complete === false, 'Nested (0%) is not complete');
    assert(widgetInPeek.hasChildren === false, 'a leaf child has no drill-down badge in the peek either');
    assert(widgetInPeek.complete === true, 'Widget (100%) is complete');
    assert(widgetInPeek.resources.length === 1 && widgetInPeek.resources[0] === 'Sam Smith',
        'each peek row carries *that child\'s own* resources (unlike a note footer, which only shows the summary\'s own)');

    const caseInsensitive = wbBuildPeekLevel('build', tasks);
    assert(caseInsensitive !== null && caseInsensitive.task.name === 'Build',
        'peek level lookup is case-insensitive, matching plan-format.rst\'s Task-matching rule');

    const nestedLevel = wbBuildPeekLevel('Nested', tasks);
    assert(nestedLevel.children.map(c => c.task.name).join(',') === 'Sub A,Sub B',
        'drilling into Nested (a grandchild of Build) lists its own direct children -- the recursive step');
    assert(nestedLevel.children.every(c => c.hasChildren === false),
        'Sub A/Sub B are leaves -- no further drill-down badge');

    assert(wbBuildPeekLevel('Does Not Exist', tasks) === null,
        'an unknown task name yields no peek level, so callers can fail closed');
    assert(wbBuildPeekLevel('', tasks) === null, 'an empty task name yields no peek level');
    assert(wbBuildPeekLevel('Build', null) === null, 'a missing tasks array yields no peek level');

    const emptyLevel = wbBuildPeekLevel('Empty Phase', tasks);
    assert(emptyLevel !== null && emptyLevel.children.length === 0,
        'a childless task still builds a level (an empty peek), matching the note body\'s own empty-state handling');
}

// ── Colour precedence (issue #849) ──────────────────────────────────────
// Precedence, highest first: whiteboard row Colour -> Theme: entry ->
// derived palette colour by outline position. See wbResolveNoteColour()
// and this file's header comment in whiteboard-notes.js.
{
    const palette = wbPalette();
    assert(Array.isArray(palette) && palette.length > 0, 'wbPalette() returns a non-empty swatch list');

    // Issue #1017: wbPalette() is a fixed pastel "post-it" palette dedicated
    // to whiteboard notes -- no longer mindmap.js's MM_BRANCH_COLOURS (this
    // sandbox never loads mindmap.js, so a residual dependency on it would
    // throw a ReferenceError or yield an empty list rather than pass above),
    // and no longer the boards view's own CF_PASTEL_COLOURS/CF_DARK_COLOURS
    // conditional-formatting swatches.
    assert(palette.length === 10, 'wbPalette() offers ten dedicated pastel swatches (two shades each of yellow/pink/green/blue/red)');
    assert(palette.every(c => /^#[0-9A-Fa-f]{6}$/.test(c)), 'every palette entry is a valid #RRGGBB colour');
    assert(wbPalette() === palette, 'wbPalette() returns the same fixed list on every call, not a fresh copy');

    // wbShadeColour: factor < 1 darkens, factor > 1 blends towards white.
    assert(wbShadeColour('#808080', 0.5) === '#404040', 'factor 0.5 halves each channel');
    assert(wbShadeColour('#000000', 1.5) === '#808080', 'factor 1.5 blends black half-way to white');
    assert(wbShadeColour('#ffffff', 0.5) === '#808080', 'factor 0.5 halves white to mid-grey');

    // wbDerivedPaletteColour: stable by the task's own index in `tasks`,
    // not by row/insertion order, and wraps around the palette length.
    const buildIndex = tasks.findIndex(t => t.name === 'Build');
    assert(wbDerivedPaletteColour(tasks, 'Build') === palette[buildIndex % palette.length],
        'derived colour matches the task\'s own index into the palette');
    assert(wbDerivedPaletteColour(tasks, 'Phase 1') === wbDerivedPaletteColour(tasks, 'Phase 1'),
        'derived colour is stable across repeated calls for the same task');
    assert(wbDerivedPaletteColour(tasks, 'No Such Task') === palette[0],
        'an unknown task name falls back to the palette\'s first entry rather than throwing');

    // wbThemeColourFor: exact (case-sensitive) key match against the map,
    // mirroring how kanban.js itself keys this map by literal task name.
    const themeColours = { 'Build': '#112233', 'Phase 1': '#445566' };
    assert(wbThemeColourFor('Build', themeColours) === '#112233', 'exact-name Theme: lookup');
    assert(wbThemeColourFor('build', themeColours) === null, 'Theme: lookup is case-sensitive (unlike Task matching)');
    assert(wbThemeColourFor('Nobody', themeColours) === null, 'no entry for this task returns null');
    assert(wbThemeColourFor('Build', null) === null, 'a missing themeColours map returns null rather than throwing');

    // wbResolveNoteColour: the full 3-tier precedence.
    const buildTask = tasks.find(t => t.name === 'Build');
    const rowWithColour = { task: 'Build', colour: '#abcdef' };
    const rowNoColour = { task: 'Build', colour: '' };

    const tier1 = wbResolveNoteColour(rowWithColour, buildTask, tasks, themeColours);
    assert(tier1.colour === '#ABCDEF' && tier1.source === 'row',
        'tier 1: a row Colour wins over Theme: and the derived palette');

    const tier2 = wbResolveNoteColour(rowNoColour, buildTask, tasks, themeColours);
    assert(tier2.colour === '#112233' && tier2.source === 'theme',
        'tier 2: no row Colour falls back to the Theme: entry');

    const tier3 = wbResolveNoteColour(rowNoColour, buildTask, tasks, {});
    assert(tier3.colour === wbDerivedPaletteColour(tasks, 'Build') && tier3.source === 'derived',
        'tier 3: no row Colour and no Theme: entry falls back to the derived palette colour');
    assert(!!tier3.colour, 'the derived tier always yields a real colour -- a note is never left uncoloured');
}

// ── wbBuildNoteViewModel carries the resolved colour ────────────────────
{
    const themeColours = { 'Phase 1': '#334455' };
    const row = { task: 'Phase 1', colour: '', x: 0, y: 0, width: null, height: null, collapsed: false };

    const vmNoTheme = wbBuildNoteViewModel(row, tasks);
    assert(vmNoTheme.colourSource === 'derived', 'omitting themeColours behaves as if there were no Theme: entries');

    const vmWithTheme = wbBuildNoteViewModel(row, tasks, themeColours);
    assert(vmWithTheme.colour === '#334455' && vmWithTheme.colourSource === 'theme',
        'the view model surfaces the Theme:-sourced colour when present');

    const overrideRow = { task: 'Phase 1', colour: '#010203', x: 0, y: 0, width: null, height: null, collapsed: false };
    const vmWithRowColour = wbBuildNoteViewModel(overrideRow, tasks, themeColours);
    assert(vmWithRowColour.colour === '#010203' && vmWithRowColour.colourSource === 'row',
        'a row Colour still wins over a Theme: entry when both are present');
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

// ── Quick resource assign: the plan-text fallback ──────────────────────
//
// A plan that uses @tokens without declaring them in front matter used to
// get an empty menu here and a populated one from the assign bubble
// (#1162), because the two controls read two different resource lists.
// With the controls merged, this menu covers both.
{
    const declared = [
        '---', 'resources:', '  - @sam: Sam Smith, Developer', '---', '',
        '# Plan', '* Phase', '  Child @alex 2d',
    ].join('\n');
    const options = wbResourceOptionsFromPlanText(declared);
    assert(
        options.length === 1 && options[0].shortname === 'sam' && options[0].role === 'Developer',
        'front matter wins: it is the only source carrying a display name and a role'
    );

    const undeclared = ['# Plan', '* Phase', '  Child A @sam 2d', '  Child B @alex @sam 1d'].join('\n');
    const harvested = wbResourceOptionsFromPlanText(undeclared);
    assert(
        harvested.map(o => o.shortname).join(',') === 'alex,sam',
        'with no front matter, @tokens on task lines are harvested, deduped and sorted'
    );
    assert(
        harvested.every(o => o.name === o.shortname && o.role === ''),
        'a harvested resource has no display name or role to offer, only its shortname'
    );

    assert(
        wbResourceOptionsFromPlanText('# Plan\n* Phase\n  Child 2d').length === 0,
        'a plan with no resources anywhere still yields no options'
    );
}
{
    const tasks = [
        { name: 'Phase', parent: null },
        { name: 'Child A', parent: 'Phase', resources: 'alex, sam' },
        { name: 'Child B', parent: 'Phase' },
    ];
    const vm = wbBuildNoteViewModel({ task: 'Phase', x: 0, y: 0 }, tasks);
    const childA = vm.children.find(c => c.task.name === 'Child A');
    const childB = vm.children.find(c => c.task.name === 'Child B');
    assert(
        JSON.stringify(childA.resources) === JSON.stringify(['alex', 'sam']),
        "a child row's view model carries its own resources for the row's avatars"
    );
    assert(
        JSON.stringify(childB.resources) === JSON.stringify([]),
        'a child with no resources gets an empty array, not undefined'
    );
}

// ── Summary ──────────────────────────────────────────────────────────────
if (failures > 0) {
    console.error(`\n${failures} test(s) failed.`);
    process.exit(1);
} else {
    console.log('\nAll whiteboard notes tests passed.');
}
