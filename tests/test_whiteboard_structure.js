/**
 * Tests for the whiteboard's plan-structure helpers (authoring the outline
 * from the board): appending a new top-level task, re-parenting a task's
 * whole subtree when a noodle is drawn or cut, rename, delete, cycle
 * refusal, and the outline-panel tree/flatten pair.
 *
 * Runs the real whiteboard-structure.js in a sandbox alongside the real
 * task-tokenizer.js (whose grammar wbTaskNameFromLine() delegates to),
 * same vm-sandbox pattern as tests/test_whiteboard_notes.js. DOM wiring --
 * noodle dragging, the outline panel, the commit path -- is covered by
 * tests/test_whiteboard_structure.py instead.
 *
 * Run with: node tests/test_whiteboard_structure.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const staticDir = path.join(__dirname, '..', 'packages', 'noodle-web', 'src', 'noodle_web', 'static');
const read = (name) => fs.readFileSync(path.join(staticDir, name), 'utf8');

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

const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(read('task-tokenizer.js'), sandbox);
vm.runInContext(read('whiteboard-structure.js'), sandbox);

const {
    wbTaskNameFromLine,
    wbOutlineRegion,
    wbParseOutline,
    wbSubtreeEndIndex,
    wbFindOutlineIndex,
    wbUniqueTaskName,
    wbCanLinkNotes,
    wbDescendantNames,
    wbAppendTopLevelTask,
    wbAppendChildTask,
    wbReparentTaskInPlanText,
    wbMoveTaskInPlanText,
    wbRenameTaskInPlanText,
    wbDeleteTaskFromPlanText,
    wbSplitChecklistAt,
    wbGroupTasksInPlanText,
    wbUngroupTasksInPlanText,
    wbMergeTasksInPlanText,
    wbOutlineTaskNames,
    wbBuildOutlineTree,
    wbFlattenOutline,
    wbThoughtFromLine,
    wbParseThoughts,
    wbAppendThought,
    wbRenameThoughtInPlanText,
    wbSetThoughtCommentInPlanText,
    wbPromoteThoughtInPlanText,
    wbDemoteTaskToThoughtInPlanText,
    wbDeleteThoughtFromPlanText,
    wbOutlineNeighbours,
    wbIndentTaskInPlanText,
    wbOutdentTaskInPlanText,
    wbSetTaskFieldsInPlanText,
    wbTaskFieldsFromPlanText,
} = sandbox;

// ── Fixtures ────────────────────────────────────────────────────────────

const PLAN = [
    '---',
    'title: Test Plan',
    '---',
    '',
    'Discovery',
    '  Kick-off @kev 1d 100%',
    '  Interviews @kev 3d 60%',
    '',
    'Build [depends Discovery]',
    '  Design @adam 5d',
    '    Wireframes @adam 2d',
    '  Develop @adam 8d',
    '',
    '---whiteboard---',
    '| Task      | X   | Y  | Colour | Width | Height | Collapsed |',
    '|-----------|-----|----|--------|-------|--------|-----------|',
    '| Discovery | 120 | 80 |        | 240   | 200    | no        |',
].join('\n');

// Flat task list in the shape engine/scheduler.js produces.
const TASKS = [
    { name: 'Discovery', parent: '', percent: 80 },
    { name: 'Kick-off', parent: 'Discovery', percent: 100 },
    { name: 'Interviews', parent: 'Discovery', percent: 60 },
    { name: 'Build', parent: '', percent: 0 },
    { name: 'Design', parent: 'Build', percent: 0 },
    { name: 'Wireframes', parent: 'Design', percent: 0 },
    { name: 'Develop', parent: 'Build', percent: 0 },
];

// ── Line parsing ────────────────────────────────────────────────────────

assertEqual(wbTaskNameFromLine('  Kick-off @kev 1d 100%'), 'Kick-off', 'name strips resource/duration/percent');
assertEqual(wbTaskNameFromLine('Build [depends Discovery]'), 'Build', 'name strips a dependency');
assertEqual(wbTaskNameFromLine('  Design @adam 5d "needs sign-off"'), 'Design', 'name strips a quoted comment');
assertEqual(wbTaskNameFromLine(''), '', 'blank line has no name');
assertEqual(wbTaskNameFromLine('---'), '', 'front-matter fence has no name');
assertEqual(wbTaskNameFromLine('# a comment'), '', 'comment line has no name');
assertEqual(wbTaskNameFromLine('| Discovery | 1 |'), '', 'a markdown table row is not a task');

// ── Outline region ──────────────────────────────────────────────────────

const region = wbOutlineRegion(PLAN.split('\n'));
assertEqual(region.start, 3, 'outline starts after the front matter');
assertEqual(region.end, 13, 'outline ends at the ---whiteboard--- marker');

const parsed = wbParseOutline(PLAN);
assertEqual(parsed.entries.length, 7, 'seven task lines parsed');
assertEqual(parsed.entries[0].name, 'Discovery', 'first entry is Discovery');
assertEqual(parsed.entries[0].indent, 0, 'Discovery is top level');
assertEqual(parsed.entries[5].name, 'Wireframes', 'Wireframes parsed');
assertEqual(parsed.entries[5].indent, 4, 'Wireframes is two levels deep');

// Subtree of Design (entry pos 4) covers Wireframes but not Develop.
assertEqual(wbSubtreeEndIndex(parsed, 4), 10, "Design's subtree ends at Wireframes");
// Subtree of Discovery covers both its children, not the blank line after.
assertEqual(wbSubtreeEndIndex(parsed, 0), 6, "Discovery's subtree ends at Interviews, not the blank line");

// ── Unique names ────────────────────────────────────────────────────────

assertEqual(wbUniqueTaskName(['Discovery'], 'New idea'), 'New idea', 'unused name is kept');
assertEqual(wbUniqueTaskName(['New idea'], 'New idea'), 'New idea 2', 'first collision gets 2');
assertEqual(wbUniqueTaskName(['new idea', 'New idea 2'], 'New idea'), 'New idea 3', 'collision check is case-insensitive');

// ── Cycle / link legality ───────────────────────────────────────────────

assert(wbCanLinkNotes(TASKS, 'Discovery', 'Build').ok, 'linking two unrelated roots is allowed');
assert(!wbCanLinkNotes(TASKS, 'Discovery', 'Discovery').ok, 'a note cannot link to itself');
assert(!wbCanLinkNotes(TASKS, 'Wireframes', 'Build').ok, 'linking a note under its own descendant is refused');
assert(!wbCanLinkNotes(TASKS, 'Discovery', 'Kick-off').ok, 'an existing link is refused as a no-op');
assert(wbDescendantNames(TASKS, 'Build').has('wireframes'), 'descendants are found transitively');
assert(!wbDescendantNames(TASKS, 'Design').has('develop'), 'a sibling is not a descendant');

// A cyclic .parent chain must not hang the descendant walk.
const CYCLIC = [{ name: 'A', parent: 'B' }, { name: 'B', parent: 'A' }];
assert(wbDescendantNames(CYCLIC, 'A').size <= 2, 'a cyclic parent chain terminates');

// ── Append a new top-level task ─────────────────────────────────────────

const appended = wbAppendTopLevelTask(PLAN, 'Fresh idea');
assert(appended.includes('\nFresh idea\n'), 'new task appended at top level');
assert(appended.indexOf('Fresh idea') < appended.indexOf('---whiteboard---'),
    'new task lands inside the outline, before the back matter');
assert(appended.includes('| Discovery | 120 | 80 |'), 'append leaves the whiteboard section intact');
assertEqual(wbAppendTopLevelTask(PLAN, '   '), PLAN, 'appending a blank name is a no-op');
assertEqual(wbParseOutline(appended).entries.length, 8, 'appended task is parseable as a task');

// A bare `---` separator before the back matter (the one written ahead of
// ---highlights---) is not part of the outline: a new task goes above it.
const WITH_SEPARATOR = 'Discovery\n  Kick-off\n\n---\n\n---highlights---\n## 2026-01-01 @kev\nAll good';
assertEqual(wbAppendTopLevelTask(WITH_SEPARATOR, 'Fresh idea'),
    'Discovery\n  Kick-off\nFresh idea\n\n---\n\n---highlights---\n## 2026-01-01 @kev\nAll good',
    'new task lands above the bare --- separator, not beneath it');
assertEqual(wbAppendTopLevelTask('Alpha\n\n---\n', 'Beta'), 'Alpha\nBeta\n\n---\n',
    'a trailing hand-typed --- divider also stays below appended tasks');

// Appending to a plan with no front matter and no back matter.
assertEqual(wbAppendTopLevelTask('Alpha\n  Beta', 'Gamma'), 'Alpha\n  Beta\nGamma',
    'append works on a bare outline');
assertEqual(wbAppendTopLevelTask('', 'Alpha'), 'Alpha', 'append works on an empty plan');

// ── Append a new child task (issue #1020, "promote to task") ───────────

const withChild = wbAppendChildTask(PLAN, 'Discovery', 'New idea');
const withChildLines = withChild.split('\n');
assert(withChildLines.includes('  New idea'), 'new child indented one level under its parent');
assertEqual(wbFindOutlineIndex(wbParseOutline(withChild).entries, 'New idea'),
    wbFindOutlineIndex(wbParseOutline(withChild).entries, 'Interviews') + 1,
    "new child lands right after the parent's existing last child");
assert(withChild.includes('| Discovery | 120 | 80 |'), 'append leaves the whiteboard section intact');
assertEqual(wbParseOutline(withChild).entries.length, 8, 'appended child is parseable as a task');

const childOfLeaf = wbAppendChildTask(PLAN, 'Wireframes', 'Grandchild');
const childOfLeafLines = childOfLeaf.split('\n');
assert(childOfLeafLines.includes('      Grandchild'), 'a leaf with no children yet gets one, indented one deeper');

assertEqual(wbAppendChildTask(PLAN, 'Discovery', '   '), PLAN, 'appending a blank name is a no-op');
assertEqual(wbAppendChildTask(PLAN, 'Does Not Exist', 'New idea'), PLAN,
    'appending under an unknown parent is a no-op');

// ── Re-parent: draw a noodle ────────────────────────────────────────────

const linked = wbReparentTaskInPlanText(PLAN, 'Build', 'Discovery');
const linkedLines = linked.split('\n');
assert(linkedLines.includes('  Build [depends Discovery]'), 'Build is now indented under Discovery');
assert(linkedLines.includes('    Design @adam 5d'), "Build's children shifted with it");
assert(linkedLines.includes('      Wireframes @adam 2d'), 'a grandchild keeps its relative depth');
assert(linked.includes('---whiteboard---'), 're-parent preserves back matter');
assert(linked.includes('| Discovery | 120 | 80 |'), 're-parent preserves the whiteboard row');
assertEqual(wbParseOutline(linked).entries.length, 7, 'no task lost or duplicated by a re-parent');

// Metadata on every moved line must survive verbatim.
assert(linked.includes('[depends Discovery]'), 're-parent keeps a dependency token');
assert(linked.includes('@adam 8d'), 're-parent keeps resources and durations');

// Move a leaf under a different parent.
const moved = wbReparentTaskInPlanText(PLAN, 'Interviews', 'Design');
const movedLines = moved.split('\n');
assert(movedLines.includes('    Interviews @kev 3d 60%'), 'Interviews re-indented under Design');
assert(movedLines.indexOf('    Interviews @kev 3d 60%') > movedLines.indexOf('    Wireframes @adam 2d'),
    'the moved task lands as the last child of its new parent');
assertEqual(movedLines.filter(l => l.includes('Interviews')).length, 1, 'the old line is gone, not duplicated');

// ── Re-parent: cut a noodle (back to top level) ─────────────────────────

const detached = wbReparentTaskInPlanText(PLAN, 'Design', null);
const detachedLines = detached.split('\n');
assert(detachedLines.includes('Design @adam 5d'), 'Design is now top level');
assert(detachedLines.includes('  Wireframes @adam 2d'), 'its child came with it, one level shallower');
assertEqual(wbParseOutline(detached).entries.length, 7, 'no task lost by a detach');

// ── Re-parent: refusals are no-ops ──────────────────────────────────────

assertEqual(wbReparentTaskInPlanText(PLAN, 'Design', 'Wireframes'), PLAN,
    'moving a task under its own child is a no-op');
assertEqual(wbReparentTaskInPlanText(PLAN, 'Design', 'Design'), PLAN,
    'moving a task under itself is a no-op');
assertEqual(wbReparentTaskInPlanText(PLAN, 'Nope', 'Discovery'), PLAN,
    'an unknown child is a no-op');
assertEqual(wbReparentTaskInPlanText(PLAN, 'Design', 'Nope'), PLAN,
    'an unknown parent is a no-op');
assertEqual(wbReparentTaskInPlanText(PLAN, 'Design', 'Build'), PLAN,
    'a link that already exists is a no-op (no spurious undo step)');
assertEqual(wbReparentTaskInPlanText(PLAN, 'Discovery', null), PLAN,
    'detaching an already-top-level task is a no-op');

// ── Reorder: drag a row up/down in the structure panel (issue #1156) ────

const movedBefore = wbMoveTaskInPlanText(PLAN, 'Build', 'Discovery', true);
assertEqual(
    JSON.stringify(wbParseOutline(movedBefore).entries.map(e => e.name)),
    JSON.stringify(['Build', 'Design', 'Wireframes', 'Develop', 'Discovery', 'Kick-off', 'Interviews']),
    'moving Build before Discovery takes its whole subtree with it, ahead of Discovery'
);
assert(movedBefore.includes('[depends Discovery]'), 'a reorder keeps a dependency token');
assert(movedBefore.includes('@adam 8d'), 'a reorder keeps resources and durations');
assert(movedBefore.includes('---whiteboard---'), 'a reorder preserves back matter');

// Kick-off (Discovery's child) reordered to sit after Build, a top-level
// task -- it un-nests to Build's own (top) level, with no separate
// outdent gesture needed, and lands after all of Build's own children
// since a sibling of Build can't sit inside Build's subtree.
const movedAfter = wbMoveTaskInPlanText(PLAN, 'Kick-off', 'Build', false);
const movedAfterOutline = wbParseOutline(movedAfter);
assertEqual(
    JSON.stringify(movedAfterOutline.entries.map(e => e.name)),
    JSON.stringify(['Discovery', 'Interviews', 'Build', 'Design', 'Wireframes', 'Develop', 'Kick-off']),
    'Kick-off reordered to sit after Build\'s whole subtree'
);
assertEqual(
    movedAfterOutline.entries.find(e => e.name === 'Kick-off').indent, 0,
    'reordering next to a top-level task un-nests it -- no separate outdent gesture needed'
);

// A move can change depth without changing document order: Wireframes
// (Design's child) becomes Develop's *sibling* rather than moving past it.
const promoted = wbMoveTaskInPlanText(PLAN, 'Wireframes', 'Develop', true);
assert(promoted.split('\n').includes('  Wireframes @adam 2d'),
    'Wireframes promoted to Build\'s direct child, at Develop\'s indent');
assertEqual(
    JSON.stringify(wbParseOutline(promoted).entries.map(e => e.name)),
    JSON.stringify(['Discovery', 'Kick-off', 'Interviews', 'Build', 'Design', 'Wireframes', 'Develop']),
    'document order is unchanged -- only depth moved'
);

assertEqual(wbMoveTaskInPlanText(PLAN, 'Design', 'Wireframes', true), PLAN,
    'moving a task next to its own descendant is a no-op');
assertEqual(wbMoveTaskInPlanText(PLAN, 'Design', 'Design', true), PLAN,
    'moving a task next to itself is a no-op');
assertEqual(wbMoveTaskInPlanText(PLAN, 'Nope', 'Discovery', true), PLAN,
    'an unknown task is a no-op');
assertEqual(wbMoveTaskInPlanText(PLAN, 'Design', 'Nope', true), PLAN,
    'an unknown reference is a no-op');
assertEqual(wbMoveTaskInPlanText(PLAN, 'Interviews', 'Kick-off', false), PLAN,
    'dropping a row right back where it already was creates no spurious undo step');

// ── Rename ──────────────────────────────────────────────────────────────

const renamed = wbRenameTaskInPlanText(PLAN, 'Design', 'Wireframing');
assert(renamed.includes('  Wireframing @adam 5d'), 'rename keeps the rest of the line');
assert(renamed.includes('    Wireframes @adam 2d'), 'rename leaves children untouched');
assertEqual(wbRenameTaskInPlanText(PLAN, 'Design', 'Design'), PLAN, 'renaming to the same name is a no-op');
assertEqual(wbRenameTaskInPlanText(PLAN, 'Design', '  '), PLAN, 'renaming to blank is a no-op');
assertEqual(wbRenameTaskInPlanText(PLAN, 'Nope', 'X'), PLAN, 'renaming an unknown task is a no-op');

// ── Delete ──────────────────────────────────────────────────────────────

const deleted = wbDeleteTaskFromPlanText(PLAN, 'Design');
assert(!deleted.includes('Design @adam 5d'), 'the task line is gone');
assert(!deleted.includes('Wireframes'), 'its subtree went with it');
assert(deleted.includes('  Develop @adam 8d'), 'a sibling survives the delete');
assert(deleted.includes('---whiteboard---'), 'delete preserves back matter');

// ── Outline tree + flatten ──────────────────────────────────────────────

const tree = wbBuildOutlineTree(TASKS, ['Discovery', 'build']);
assertEqual(tree.length, 2, 'two roots');
assertEqual(tree[0].name, 'Discovery', 'first root is Discovery');
assertEqual(tree[0].children.length, 2, 'Discovery has two children');
assertEqual(tree[1].children[0].children[0].name, 'Wireframes', 'the tree nests three deep');
assert(tree[0].onBoard, 'Discovery is flagged as on the board');
assert(tree[1].onBoard, 'board membership matches case-insensitively');
assert(!tree[0].children[0].onBoard, 'Kick-off is not on the board');

const allRows = wbFlattenOutline(tree, new Set(), '');
assertEqual(allRows.length, 7, 'every task rendered when nothing is collapsed');
assert(allRows[0].hasChildren, 'Discovery reports children for its chevron');
assert(!allRows[1].hasChildren, 'Kick-off reports no children');

const collapsedRows = wbFlattenOutline(tree, new Set(['discovery']), '');
assertEqual(collapsedRows.length, 5, "a collapsed node hides its children");
assert(collapsedRows[0].collapsed, 'the collapsed node is flagged as such');
assert(!collapsedRows.some(r => r.name === 'Kick-off'), 'the hidden child is absent');

const searchRows = wbFlattenOutline(tree, new Set(), 'wire');
assertEqual(searchRows.map(r => r.name).join(','), 'Build,Design,Wireframes',
    'search keeps a match and its ancestors only');
assert(searchRows[2].matched, 'the matching row is flagged');
assert(!searchRows[0].matched, 'an ancestor kept for context is not flagged as a match');

const searchThroughCollapse = wbFlattenOutline(tree, new Set(['build']), 'wire');
assertEqual(searchThroughCollapse.length, 3, 'search ignores collapse so results are never hidden');

// ── Scissors split (issue #874) ─────────────────────────────────────────

const CLUSTER = [
    '---',
    'title: Split Plan',
    'Theme:',
    '  Cluster: #FCE38A',
    '---',
    '',
    'Cluster',
    '  Alpha @sam 1d [depends Kick-off] 2026-03-12 #urgent 10% "needs sign-off"',
    '  Beta @jo 2d',
    '    Nested @jo 1d',
    '  Gamma @sam 3d',
    '',
    '---whiteboard---',
    '| Task    | X   | Y  | Colour  | Width | Height | Collapsed |',
    '|---------|-----|----|---------|-------|--------|-----------|',
    '| Cluster | 120 | 80 | #FCE38A | 240   | 200    | no        |',
    '',
    '---parking lot---',
    '| ID | Text | Date Parked |',
    '|----|------|-------------|',
    '| p1 | leftover idea | 2026-03-01 |',
].join('\n');

const splitMid = wbSplitChecklistAt(CLUSTER, 'Cluster', 'Alpha', 'New idea');
const splitMidNames = wbParseOutline(splitMid).entries.map(e => e.name);
assertEqual(
    JSON.stringify(splitMidNames),
    JSON.stringify(['Cluster', 'Alpha', 'New idea', 'Beta', 'Nested', 'Gamma']),
    'split after first of three: Alpha stays, Beta+Gamma become the new note'
);
assertEqual(
    wbParseOutline(splitMid).entries.find(e => e.name === 'Cluster').indent, 0,
    'original parent stays top-level'
);
assertEqual(
    wbParseOutline(splitMid).entries.find(e => e.name === 'Alpha').indent, 2,
    'the staying child is still indented under the original parent'
);
assertEqual(
    wbParseOutline(splitMid).entries.find(e => e.name === 'New idea').indent, 0,
    'the new note is a top-level task'
);
assertEqual(
    wbParseOutline(splitMid).entries.find(e => e.name === 'Beta').indent, 2,
    'moved children sit under the new note at one indent'
);
assertEqual(
    wbParseOutline(splitMid).entries.find(e => e.name === 'Nested').indent, 4,
    'nested children of a cut row travel with it, relative depth kept'
);
assertEqual(
    wbParseOutline(splitMid).entries.find(e => e.name === 'Gamma').indent, 2,
    'a later sibling of the cut row moves too'
);

const alphaLine = splitMid.split('\n').find(l => l.includes('Alpha'));
assert(alphaLine.includes('@sam 1d'), 'staying row keeps resources and duration');
assert(alphaLine.includes('[depends Kick-off]'), 'staying row keeps a dependency token');
assert(alphaLine.includes('2026-03-12'), 'staying row keeps a date');
assert(alphaLine.includes('#urgent'), 'staying row keeps a label');
assert(alphaLine.includes('10%'), 'staying row keeps a percent');
assert(alphaLine.includes('"needs sign-off"'), 'staying row keeps a comment');

const betaLine = splitMid.split('\n').find(l => /^\s+Beta /.test(l));
assert(betaLine.includes('@jo 2d'), 'moved row keeps resources and duration');
assert(splitMid.includes('    Nested @jo 1d'), 'moved grandchild keeps its tokens');
assert(splitMid.includes('  Gamma @sam 3d'), 'moved later sibling keeps its tokens');

assert(splitMid.includes('Theme:'), 'split leaves front matter byte-for-byte');
assert(splitMid.includes('  Cluster: #FCE38A'), 'split leaves Theme: entries');
assert(splitMid.includes('---whiteboard---'), 'split leaves the whiteboard marker');
assert(splitMid.includes('| Cluster | 120 | 80 | #FCE38A |'),
    'split does not add or rewrite the source whiteboard row');
assert(!splitMid.includes('| New idea |'),
    'the structure helper does not write a whiteboard row (the board layer does)');
assert(splitMid.includes('---parking lot---'), 'split leaves later back-matter sections');
assert(splitMid.includes('| p1 | leftover idea | 2026-03-01 |'),
    'parking-lot rows come back byte-for-byte');

const lastRow = wbSplitChecklistAt(CLUSTER, 'Cluster', 'Beta', 'Torn off');
assertEqual(
    JSON.stringify(wbParseOutline(lastRow).entries.map(e => e.name)),
    JSON.stringify(['Cluster', 'Alpha', 'Beta', 'Nested', 'Torn off', 'Gamma']),
    'splitting off the last row is allowed: only Gamma lifts off'
);
assert(lastRow.includes('    Nested @jo 1d'),
    'a last-row split leaves an earlier sibling\'s subtree on the original note');

assertEqual(wbSplitChecklistAt(CLUSTER, 'Nope', 'Alpha', 'New idea'), CLUSTER,
    'an unknown parent is a no-op');
assertEqual(wbSplitChecklistAt(CLUSTER, 'Cluster', 'Nope', 'New idea'), CLUSTER,
    'an unknown child is a no-op');
assertEqual(wbSplitChecklistAt(CLUSTER, 'Cluster', 'Nested', 'New idea'), CLUSTER,
    'a grandchild is not a cut point (scissors sit between direct rows)');
assertEqual(wbSplitChecklistAt(CLUSTER, 'Cluster', 'Gamma', 'New idea'), CLUSTER,
    'cutting after the last child (nothing below) is a no-op');
assertEqual(wbSplitChecklistAt(CLUSTER, 'Cluster', 'Alpha', '   '), CLUSTER,
    'a blank new name is a no-op');
assertEqual(wbSplitChecklistAt(CLUSTER, 'Cluster', 'Alpha', 'Cluster'), CLUSTER,
    'a new name that already exists is a no-op');

const withIdea = wbAppendTopLevelTask(CLUSTER, 'New idea');
assertEqual(wbSplitChecklistAt(withIdea, 'Cluster', 'Alpha', 'New idea'), withIdea,
    'refusing a colliding new name leaves the plan unchanged');
const unique = wbUniqueTaskName(wbOutlineTaskNames(withIdea), 'New idea');
assertEqual(unique, 'New idea 2', 'the uniquifier yields New idea 2 when New idea is taken');
const splitUnique = wbSplitChecklistAt(withIdea, 'Cluster', 'Alpha', unique);
assert(splitUnique.includes('\nNew idea 2\n'), 'the caller-supplied unique name is what gets written');
assert(splitUnique.includes('\nNew idea\n') || splitUnique.split('\n').includes('New idea'),
    'the pre-existing New idea task is still there');

const twoKids = [
    'Parent',
    '  Only',
].join('\n');
assertEqual(wbSplitChecklistAt(twoKids, 'Parent', 'Only', 'New idea'), twoKids,
    'a note with a single checklist row cannot split');

// ── Grouping and merging (issue #874) ───────────────────────────────────

const BOARD = [
    'Alpha',
    '  Alpha one',
    '  Alpha two',
    'Beta',
    '  Beta one',
    'Gamma',
].join('\n');

const grouped = wbGroupTasksInPlanText(BOARD, ['Alpha', 'Beta'], 'Discovery');
assertEqual(grouped, [
    'Gamma',
    'Discovery',
    '  Alpha',
    '    Alpha one',
    '    Alpha two',
    '  Beta',
    '    Beta one',
].join('\n'), 'grouping gathers both members, subtrees intact, under a new summary task');

const orderSwapped = wbGroupTasksInPlanText(BOARD, ['Beta', 'Alpha'], 'Discovery');
assert(orderSwapped.indexOf('\n  Beta') < orderSwapped.indexOf('\n  Alpha'),
    'members land in the order they were selected, not their outline order');

assertEqual(wbGroupTasksInPlanText(BOARD, ['Alpha'], 'Discovery'), BOARD,
    'grouping one note is a no-op -- a group of one is not a group');
assertEqual(wbGroupTasksInPlanText(BOARD, ['Alpha', 'Nope'], 'Discovery'), BOARD,
    'a member missing from the outline refuses the whole gesture');
assertEqual(wbGroupTasksInPlanText(BOARD, ['Alpha', 'Beta'], 'Alpha'), BOARD,
    'a group name that is already a task is a no-op');
assertEqual(wbGroupTasksInPlanText(BOARD, ['Alpha', 'Beta'], '   '), BOARD,
    'a blank group name is a no-op');
assertEqual(wbGroupTasksInPlanText(BOARD, ['Alpha', 'Alpha one'], 'Discovery'), BOARD,
    'grouping a note with its own child is refused rather than half-done');

// Nesting: a group is just a task, so grouping one with a note nests it.
const nested = wbGroupTasksInPlanText(grouped, ['Discovery', 'Gamma'], 'Phase 1');
assertEqual(nested, [
    'Phase 1',
    '  Discovery',
    '    Alpha',
    '      Alpha one',
    '      Alpha two',
    '    Beta',
    '      Beta one',
    '  Gamma',
].join('\n'), 'a group nests inside another group, subtree depths shifting together');

assertEqual(wbUngroupTasksInPlanText(grouped, 'Discovery'), [
    'Gamma',
    'Alpha',
    '  Alpha one',
    '  Alpha two',
    'Beta',
    '  Beta one',
].join('\n'), 'ungrouping hands the members back at the top level with their subtrees');

const innerKept = wbUngroupTasksInPlanText(nested, 'Phase 1');
assert(innerKept.includes('Discovery\n  Alpha'),
    'ungrouping the outer group leaves the inner group whole');

assertEqual(wbUngroupTasksInPlanText(BOARD, 'Nope'), BOARD,
    'ungrouping something that is not there is a no-op');

const merged = wbMergeTasksInPlanText(BOARD, 'Alpha', ['Beta']);
assertEqual(merged, [
    'Alpha',
    '  Alpha one',
    '  Alpha two',
    '  Beta one',
    'Gamma',
].join('\n'), "merging appends the source's items to the target and the emptied source goes");

const mergedBare = wbMergeTasksInPlanText(BOARD, 'Alpha', ['Gamma']);
assertEqual(mergedBare, [
    'Alpha',
    '  Alpha one',
    '  Alpha two',
    '  Gamma',
    'Beta',
    '  Beta one',
].join('\n'), 'a note with nothing inside it becomes an item on the target, not nothing');

const mergedMany = wbMergeTasksInPlanText(BOARD, 'Alpha', ['Beta', 'Gamma']);
assertEqual(mergedMany, [
    'Alpha',
    '  Alpha one',
    '  Alpha two',
    '  Beta one',
    '  Gamma',
].join('\n'), 'combining several sources folds them all in, in order');

assertEqual(wbMergeTasksInPlanText(BOARD, 'Alpha', ['Alpha']), BOARD,
    'merging a note into itself is a no-op');
assertEqual(wbMergeTasksInPlanText(BOARD, 'Alpha', ['Nope']), BOARD,
    'a missing source refuses the whole merge');
assertEqual(wbMergeTasksInPlanText(BOARD, 'Nope', ['Beta']), BOARD,
    'a missing target refuses the merge');
assertEqual(wbMergeTasksInPlanText(BOARD, 'Alpha', []), BOARD,
    'merging nothing is a no-op');
assertEqual(wbMergeTasksInPlanText(BOARD, 'Alpha one', ['Alpha']), BOARD,
    'merging a note into its own child is refused -- that is a move, not a merge');

// The two gestures have to end somewhere different, which is the thing the
// issue asks to be obvious at the moment of choosing.
assert(grouped !== merged, 'group and merge do not produce the same outline');
assert(grouped.includes('\n  Alpha\n'), 'group leaves each member a task of its own');
assert(!merged.split('\n').includes('Beta'), 'merge leaves one task holding everything');

// ── Thoughts: text notes that are not tasks ─────────────────────────────

{
    console.log('\n--- thoughts ---');

    assertEqual(wbTaskNameFromLine('// Foo 3d'), '',
        'a comment line is not a task (the scheduler skips it too)');
    assertEqual(wbParseOutline('Alpha\n// Beta\n  Gamma').entries.map(e => e.name).join(','), 'Alpha,Gamma',
        'the outline parse skips comment lines rather than naming a task "// Beta"');

    const thought = wbThoughtFromLine('  // Ask legal 3d "they were slow"');
    assertEqual(thought && thought.name, 'Ask legal', 'a thought is named by the task grammar');
    assertEqual(thought && thought.comment, 'they were slow', 'its quoted text is its body');
    assertEqual(wbThoughtFromLine('Alpha'), null, 'a task line is not a thought');
    assertEqual(wbThoughtFromLine('//   '), null, 'an empty comment is not a thought');

    const THOUGHT_PLAN = [
        '---', 'title: T', '---', '',
        'Alpha',
        '  Alpha one',
        '',
        '---whiteboard---',
        '| Task | X | Y |',
        '|---|---|---|',
        '| Alpha | 0 | 0 |',
    ].join('\n');

    const withThought = wbAppendThought(THOUGHT_PLAN, 'Idea');
    assert(withThought.includes('  Alpha one\n// Idea\n'),
        'a new thought is a commented-out line at the end of the outline, before the back matter');
    assertEqual(wbParseThoughts(withThought).map(t => t.name).join(','), 'Idea',
        'it parses back as a thought');
    assertEqual(wbParseThoughts(THOUGHT_PLAN + '\n// not in the outline').length, 0,
        'a comment in the back matter is not a thought');
    assertEqual(wbOutlineTaskNames(withThought).join(','), 'Alpha,Alpha one',
        'and it is not a task');

    const described = wbSetThoughtCommentInPlanText(withThought, 'idea', 'Say "hi"\nsoon');
    assert(described.includes('\n// Idea "Say \'hi\' soon"\n'),
        'the body is written as the quoted comment, quotes and newlines neutralised');
    const renamedThought = wbRenameThoughtInPlanText(described, 'Idea', 'Big idea');
    assert(renamedThought.includes('\n// Big idea "Say \'hi\' soon"\n'), 'rename keeps the body');
    assertEqual(wbRenameThoughtInPlanText(described, 'Nope', 'X'), described,
        'renaming a missing thought changes nothing');

    const promoted = wbPromoteThoughtInPlanText(renamedThought, 'Big idea');
    assert(promoted.includes('\nBig idea "Say \'hi\' soon"\n'), 'promote uncomments the line');
    assertEqual(wbOutlineTaskNames(promoted).join(','), 'Alpha,Alpha one,Big idea',
        'and the line is now a task');
    assertEqual(wbPromoteThoughtInPlanText('Alpha\n  // Sub', 'Sub'), 'Alpha\n  Sub',
        'promote keeps the indent -- an indented thought becomes a subtask');
    assertEqual(wbPromoteThoughtInPlanText(renamedThought, 'Alpha'), renamedThought,
        'promoting a task (not a thought) changes nothing');

    assertEqual(wbDeleteThoughtFromPlanText(withThought, 'Idea'), THOUGHT_PLAN,
        'deleting a thought removes exactly its line');

    // Back the other way: a task becomes a thought by commenting its line.
    const demoted = wbDemoteTaskToThoughtInPlanText(promoted, 'Big idea');
    assertEqual(demoted, renamedThought, 'demote is the exact reverse of promote');
    assertEqual(wbDemoteTaskToThoughtInPlanText('Alpha\n  Sub 3d @Ann "why"', 'Sub'),
        'Alpha\n  // Sub 3d @Ann "why"',
        'demote keeps the indent and everything else on the line');
    assertEqual(wbParseThoughts('Alpha\n  // Sub 3d "why"').map(t => `${t.name}|${t.comment}`).join(),
        'Sub|why', 'and the demoted line reads back as a thought with the comment as its text');
    assertEqual(wbDemoteTaskToThoughtInPlanText('Alpha\n  Sub', 'Alpha'), 'Alpha\n  Sub',
        'a task with subtasks is refused -- they would be orphaned');
    assertEqual(wbDemoteTaskToThoughtInPlanText('Alpha', 'Nope'), 'Alpha',
        'demoting a missing task changes nothing');
}

// ── Indent / outdent and the quick editor's field writes ───────────────
{
    const PLAN = [
        'Alpha 2d',
        '  One 1d',
        '  Two 1d',
        '    Deep 1d',
        '  Three 1d',
        'Beta',
    ].join('\n');

    const n = wbOutlineNeighbours(PLAN, 'two');
    assertEqual(`${n.previousSibling}|${n.parent}`, 'One|Alpha', 'neighbours of a middle child');
    assertEqual(wbOutlineNeighbours(PLAN, 'One').previousSibling, '',
        'a first child has no previous sibling');
    assertEqual(wbOutlineNeighbours(PLAN, 'Beta').previousSibling, 'Alpha',
        'a top-level task\'s previous sibling skips the earlier task\'s subtree');
    assertEqual(wbOutlineNeighbours(PLAN, 'Beta').parent, '', 'a top-level task has no parent');

    assertEqual(wbIndentTaskInPlanText(PLAN, 'Two'),
        ['Alpha 2d', '  One 1d', '    Two 1d', '      Deep 1d', '  Three 1d', 'Beta'].join('\n'),
        'indent nests a task under its previous sibling, in place, taking its subtree');
    assertEqual(wbIndentTaskInPlanText(PLAN, 'Beta'),
        ['Alpha 2d', '  One 1d', '  Two 1d', '    Deep 1d', '  Three 1d', '  Beta'].join('\n'),
        'indenting a top-level task makes it the last child of the task above');
    assertEqual(wbIndentTaskInPlanText(PLAN, 'One'), PLAN, 'a first child cannot be indented');
    assertEqual(wbIndentTaskInPlanText(PLAN, 'Alpha'), PLAN, 'nor can the first task in the plan');
    assertEqual(wbIndentTaskInPlanText(PLAN, 'Nope'), PLAN, 'a missing task changes nothing');

    assertEqual(wbOutdentTaskInPlanText(PLAN, 'Two'),
        ['Alpha 2d', '  One 1d', '  Three 1d', 'Two 1d', '  Deep 1d', 'Beta'].join('\n'),
        'outdent makes a task its parent\'s next sibling, taking its subtree');
    assertEqual(wbOutdentTaskInPlanText(PLAN, 'Deep'),
        ['Alpha 2d', '  One 1d', '  Two 1d', '  Deep 1d', '  Three 1d', 'Beta'].join('\n'),
        'outdenting a last child leaves it where it was, one level out');
    assertEqual(wbOutdentTaskInPlanText(PLAN, 'Beta'), PLAN, 'a top-level task cannot be outdented');
    assertEqual(wbOutdentTaskInPlanText(wbIndentTaskInPlanText(PLAN, 'Three'), 'Three'), PLAN,
        'outdent undoes indent for a last child');

    const LINE = 'Alpha\n  Build @kev 3d [depends Alpha] "old note" 20%';
    assertEqual(wbSetTaskFieldsInPlanText(LINE, 'build', { duration: '5', percent: '60', comment: 'new "one"' }),
        'Alpha\n  Build @kev 5d [depends Alpha] "new \'one\'" 60%',
        'fields are replaced in place, leaving every other token alone');
    assertEqual(wbSetTaskFieldsInPlanText('Alpha', 'Alpha', { duration: '2w', percent: '10', comment: 'hi' }),
        'Alpha 2w 10% "hi"', 'missing fields are appended');
    assertEqual(wbSetTaskFieldsInPlanText(LINE, 'Build', { duration: '', percent: '', comment: '' }),
        'Alpha\n  Build @kev [depends Alpha]', 'an empty value removes the token and its space');
    assertEqual(wbSetTaskFieldsInPlanText(LINE, 'Build', { percent: '250' }),
        'Alpha\n  Build @kev 3d [depends Alpha] "old note" 100%', 'percent is capped at 100');
    assertEqual(wbSetTaskFieldsInPlanText(LINE, 'Build', { duration: 'soon' }), LINE,
        'an invalid duration changes nothing');
    assertEqual(wbSetTaskFieldsInPlanText(LINE, 'Nope', { duration: '1' }), LINE,
        'a missing task changes nothing');
    assertEqual(wbSetTaskFieldsInPlanText(LINE, 'Build', {}), LINE, 'no fields, no change');

    assertEqual(JSON.stringify(wbTaskFieldsFromPlanText(LINE, 'build')),
        JSON.stringify({ name: 'Build', duration: '3d', percent: '20', comment: 'old note' }),
        'the fields read back from the line, under the outline\'s own spelling of the name');
    assertEqual(JSON.stringify(wbTaskFieldsFromPlanText('Alpha', 'Alpha')),
        JSON.stringify({ name: 'Alpha', duration: '', percent: '', comment: '' }),
        'absent fields read as empty');
    assertEqual(wbTaskFieldsFromPlanText(LINE, 'Nope'), null, 'a missing task reads as null');
}

// ── wbMoveRowInPlanText: dragging a checklist row on the board ─────────
{
    const { wbMoveRowInPlanText } = sandbox;
    const ROWS = [
        'Build',
        '  Keep @sam 1d',
        '  MoveMe @jo 2d [depends Keep]',
        '    Nested 1d',
        '  After 3d',
        'Other',
        '  Existing 1d',
        'Empty',
    ].join('\n');

    assertEqual(wbMoveRowInPlanText(ROWS, 'After', { kind: 'row', ref: 'Keep', before: true }),
        ['Build', '  After 3d', '  Keep @sam 1d', '  MoveMe @jo 2d [depends Keep]', '    Nested 1d',
            'Other', '  Existing 1d', 'Empty'].join('\n'),
        'a row dropped before another row of the same note re-orders it');

    assertEqual(wbMoveRowInPlanText(ROWS, 'MoveMe', { kind: 'row', ref: 'Existing', before: false }),
        ['Build', '  Keep @sam 1d', '  After 3d', 'Other', '  Existing 1d',
            '  MoveMe @jo 2d [depends Keep]', '    Nested 1d', 'Empty'].join('\n'),
        'a row dropped between another note\'s rows moves there, subtree and tokens included');

    assertEqual(wbMoveRowInPlanText(ROWS, 'Keep', { kind: 'note', note: 'Empty' }),
        ['Build', '  MoveMe @jo 2d [depends Keep]', '    Nested 1d', '  After 3d',
            'Other', '  Existing 1d', 'Empty', '  Keep @sam 1d'].join('\n'),
        'a row dropped on a note with no rows becomes its last child');

    assertEqual(wbMoveRowInPlanText(ROWS, 'MoveMe', { kind: 'top' }),
        ['Build', '  Keep @sam 1d', '  After 3d', 'Other', '  Existing 1d', 'Empty',
            'MoveMe @jo 2d [depends Keep]', '  Nested 1d'].join('\n'),
        'a row dragged onto bare board comes out to the top level, unlinked');

    assertEqual(wbMoveRowInPlanText(ROWS, 'Keep', { kind: 'row', ref: 'Keep', before: true }), ROWS,
        'a row dropped on itself changes nothing');
    assertEqual(wbMoveRowInPlanText(ROWS, 'MoveMe', { kind: 'note', note: 'Nested' }), ROWS,
        'a row cannot be dropped into its own subtree');
    assertEqual(wbMoveRowInPlanText(ROWS, 'Keep', { kind: 'invalid', note: 'Other' }), ROWS,
        'an invalid target changes nothing');
    assertEqual(wbMoveRowInPlanText(ROWS, 'Nope', { kind: 'top' }), ROWS,
        'a missing task changes nothing');
}

console.log(failures === 0 ? '\nAll structure tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
