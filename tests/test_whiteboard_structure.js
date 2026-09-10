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
    wbRenameTaskInPlanText,
    wbDeleteTaskFromPlanText,
    wbBuildOutlineTree,
    wbFlattenOutline,
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

console.log(failures === 0 ? '\nAll structure tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
