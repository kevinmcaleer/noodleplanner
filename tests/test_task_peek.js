/**
 * Tests for the task-peek popover's pure breadcrumb-stack logic (issue
 * #850): pushing a new level when drilling into a child, truncating back
 * to any earlier crumb (both "back one" and "jump straight to crumb N"),
 * and reading the current/breadcrumb state off the stack.
 *
 * Runs the real task-peek.js in a sandbox (same vm-sandbox pattern as
 * tests/test_whiteboard_notes.js for #846/#849) and exercises only the
 * pure, DOM-free helpers -- the popover's actual DOM (positioning,
 * checkbox wiring, Escape/outside-click, the real "Open task details"
 * round trip) is covered by the Selenium-driven tests/test_task_peek.py
 * instead.
 *
 * Run with: node tests/test_task_peek.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'packages', 'noodle-web', 'src',
        'noodle_web', 'static', 'task-peek.js'),
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
vm.runInContext(source, sandbox);

const { tpPushLevel, tpPopToIndex, tpCurrentLevel, tpBreadcrumbNames } = sandbox;

// ── Fixture: three levels deep, mirroring a real drill-down session ────
// Build (root, opened from the note's badge)
//   -> Nested (drilled into from Build's own row)
//     -> Sub-Nested (drilled into from Nested's row)
const buildLevel = { task: { name: 'Build' }, children: [{ task: { name: 'Nested' }, hasChildren: true }] };
const nestedLevel = { task: { name: 'Nested' }, children: [{ task: { name: 'Sub-Nested' }, hasChildren: true }] };
const subNestedLevel = { task: { name: 'Sub-Nested' }, children: [] };

// ── tpPushLevel ──────────────────────────────────────────────────────────
{
    assert(tpPushLevel([], buildLevel).length === 1, 'pushing onto an empty stack yields a single-level stack');
    assert(tpPushLevel(undefined, buildLevel).length === 1, 'pushing onto an undefined stack is treated as empty');

    const oneDeep = tpPushLevel([buildLevel], nestedLevel);
    assert(oneDeep.length === 2, 'drilling in pushes a second level');
    assert(oneDeep[0] === buildLevel && oneDeep[1] === nestedLevel, 'push preserves order (root first, current last)');

    const original = [buildLevel];
    tpPushLevel(original, nestedLevel);
    assert(original.length === 1, 'tpPushLevel does not mutate the array it was given');

    assert(tpPushLevel([buildLevel], null).length === 1, 'pushing a falsy level is a no-op');
}

// ── tpCurrentLevel ───────────────────────────────────────────────────────
{
    assert(tpCurrentLevel([]) === null, 'an empty stack has no current level');
    assert(tpCurrentLevel(null) === null, 'a null stack has no current level');
    assert(tpCurrentLevel([buildLevel]) === buildLevel, 'a single-level stack\'s current level is that level');
    const threeDeep = [buildLevel, nestedLevel, subNestedLevel];
    assert(tpCurrentLevel(threeDeep) === subNestedLevel, 'the current level is always the last one pushed');
}

// ── tpPopToIndex ─────────────────────────────────────────────────────────
{
    const threeDeep = [buildLevel, nestedLevel, subNestedLevel];

    const backOne = tpPopToIndex(threeDeep, 1);
    assert(backOne.length === 2 && backOne[1] === nestedLevel,
        '"back one" (index = length-2) truncates to the previous crumb');

    const jumpToRoot = tpPopToIndex(threeDeep, 0);
    assert(jumpToRoot.length === 1 && jumpToRoot[0] === buildLevel,
        'clicking the root crumb directly jumps straight back to it, not just one level');

    const staySame = tpPopToIndex(threeDeep, 2);
    assert(staySame.length === 3, 'popping to the current index is a no-op (still 3 levels)');

    assert(tpPopToIndex(threeDeep, 99).length === 3, 'an out-of-range high index clamps to the current level rather than throwing');
    assert(tpPopToIndex(threeDeep, -5).length === 1, 'an out-of-range low index clamps to the root rather than throwing');

    assert(tpPopToIndex([], 0).length === 0, 'popping an empty stack yields an empty stack');
    assert(tpPopToIndex(null, 0).length === 0, 'popping a null stack yields an empty array, not a throw');

    const untouched = [buildLevel, nestedLevel, subNestedLevel];
    tpPopToIndex(untouched, 0);
    assert(untouched.length === 3, 'tpPopToIndex does not mutate the array it was given');
}

// ── tpBreadcrumbNames ────────────────────────────────────────────────────
{
    const threeDeep = [buildLevel, nestedLevel, subNestedLevel];
    assert(tpBreadcrumbNames(threeDeep).join(' > ') === 'Build > Nested > Sub-Nested',
        'breadcrumb names read root-to-current, in stack order');
    assert(tpBreadcrumbNames([buildLevel]).join(',') === 'Build', 'a single-level stack has a one-crumb breadcrumb');
    assert(tpBreadcrumbNames([]).length === 0, 'an empty stack has no breadcrumb names');
    assert(tpBreadcrumbNames(null).length === 0, 'a null stack has no breadcrumb names');
}

// ── End-to-end stack walk (push, push, pop to root, push again) ────────
{
    let levels = [];
    levels = tpPushLevel(levels, buildLevel);
    levels = tpPushLevel(levels, nestedLevel);
    levels = tpPushLevel(levels, subNestedLevel);
    assert(tpBreadcrumbNames(levels).join(' > ') === 'Build > Nested > Sub-Nested', 'three drill-downs build a three-deep breadcrumb');

    levels = tpPopToIndex(levels, 0);
    assert(tpCurrentLevel(levels) === buildLevel, 'navigating back to the root crumb makes it current again');

    levels = tpPushLevel(levels, nestedLevel);
    assert(tpBreadcrumbNames(levels).join(' > ') === 'Build > Nested', 'drilling in again after navigating back extends from the new current level, not the old deepest one');
}

if (failures > 0) {
    console.error(`\n${failures} test(s) failed.`);
    process.exit(1);
} else {
    console.log('\nAll task-peek breadcrumb tests passed.');
}
