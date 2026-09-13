/**
 * Regression tests for issue #979 (task completion UX), tracked in the
 * kevinmcaleer/Snakie repo:
 *
 *   1. Clicking the completion progress bar in the task details form jumps
 *      the task straight to 100% (setTaskPercentQuick / progress bar click).
 *   2. The 0/25/50/75/100 quick-set mini-toolbar sets the expected percent.
 *   3. The "Sub Tasks" list in a summary task's details form lists every
 *      descendant task, not just direct children (getTaskDescendants).
 *
 * The functions under test are classic browser-script top-level function
 * declarations in static/script.js, lifted into a vm sandbox the same way
 * tests/test_markdown_roundtrip.mjs and tests/test_task_tokenizer.js do.
 *
 * Run with: node tests/test_task_completion_ux.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const staticDir = path.join(__dirname, '..', 'packages', 'noodle-web', 'src', 'noodle_web', 'static');
const scriptSource = fs.readFileSync(path.join(staticDir, 'script.js'), 'utf8');
const tokenizerSource = fs.readFileSync(path.join(staticDir, 'task-tokenizer.js'), 'utf8');

/** Slice out a top-level `function name(` ... `\n}\n` declaration by name. */
function extractFunction(source, name) {
    const start = source.indexOf(`\nfunction ${name}(`);
    assert.notStrictEqual(start, -1, `${name} not found in script.js`);
    const end = source.indexOf('\n}\n', start);
    assert.notStrictEqual(end, -1, `${name} has no closing brace at column 0`);
    return source.slice(start, end + 3);
}

let failures = 0;
function check(condition, message) {
    if (!condition) {
        failures++;
        console.error('FAIL:', message);
    } else {
        console.log('PASS:', message);
    }
}
function equal(actual, expected, message) {
    check(JSON.stringify(actual) === JSON.stringify(expected),
        `${message}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
}

// ---------------------------------------------------------------------
// Part 1: getTaskDescendants -- every descendant, not just direct children
// ---------------------------------------------------------------------
{
    const sandbox = vm.createContext({ console, document: { getElementById: () => null } });
    vm.runInContext(tokenizerSource + '\nglobalThis.tokenizer = TaskLineTokenizer;', sandbox);
    vm.runInContext(extractFunction(scriptSource, 'parseTaskLine') + '\nglobalThis.parseTaskLine = parseTaskLine;', sandbox);
    vm.runInContext(extractFunction(scriptSource, 'getIndentWidth') + '\nglobalThis.getIndentWidth = getIndentWidth;', sandbox);
    vm.runInContext(extractFunction(scriptSource, 'getTaskDescendants') + '\nglobalThis.getTaskDescendants = getTaskDescendants;', sandbox);
    const getTaskDescendants = sandbox.getTaskDescendants;

    // A 4-level-deep outline: Phase (summary) -> Sub-phase (summary) ->
    // Sub-sub-phase (summary) -> two leaf tasks, plus a sibling leaf at the
    // sub-phase level. Line numbers below are 1-based, matching the editor.
    const plan4Level = [
        /* 1 */ '# Phase',
        /* 2 */ 'Kickoff phase 5d',
        /* 3 */ '  Sub-phase A',
        /* 4 */ '    Sub-sub-phase A1',
        /* 5 */ '      Leaf task A1a 2d 25%',
        /* 6 */ '      Leaf task A1b 3d 0%',
        /* 7 */ '    Leaf task A2 1d 50%',
        /* 8 */ '  Sub-phase B',
        /* 9 */ '    Leaf task B1 2d 100%',
        /* 10 */ 'Next top-level task 1d',
    ];

    const descendants = getTaskDescendants(3, plan4Level); // beneath "Sub-phase A" (line 3)
    equal(
        descendants.map(d => d.name).sort(),
        ['Leaf task A1a', 'Leaf task A1b', 'Leaf task A2', 'Sub-sub-phase A1'].sort(),
        'getTaskDescendants returns every descendant beneath a 3+ level summary, not just direct children'
    );
    check(
        descendants.every(d => d.name !== 'Sub-phase B' && d.name !== 'Leaf task B1'),
        'getTaskDescendants does not cross into a sibling subtree'
    );
    check(
        !descendants.some(d => d.name === 'Next top-level task'),
        'getTaskDescendants stops at the parent\'s own indent level (sibling of the parent excluded)'
    );

    const bySubSub = Object.fromEntries(descendants.map(d => [d.name, d]));
    equal(bySubSub['Sub-sub-phase A1'].depth, 1, 'direct child is depth 1');
    equal(bySubSub['Leaf task A2'].depth, 1, 'a second direct child is also depth 1');
    equal(bySubSub['Leaf task A1a'].depth, 2, 'a grandchild (leaf under sub-sub-phase) is depth 2');
    equal(bySubSub['Leaf task A1b'].depth, 2, 'a second grandchild is also depth 2');

    // Full 5-level chain, to be sure recursion isn't hardcoded to one extra level.
    const deepChain = [
        'Level0',
        '  Level1',
        '    Level2',
        '      Level3',
        '        Level4 leaf 100%',
    ];
    const fromRoot = getTaskDescendants(1, deepChain);
    equal(fromRoot.map(d => d.name), ['Level1', 'Level2', 'Level3', 'Level4 leaf'],
        'a 5-level chain surfaces every descendant down to the leaf');
    equal(fromRoot.map(d => d.depth), [1, 2, 3, 4], 'depth increases by one at each nesting level');

    // Direct-children-only view (what the summary rollup average should use)
    // still gets exactly the immediate children, unaffected by deeper descendants.
    const directOnly = getTaskDescendants(3, plan4Level).filter(d => d.depth === 1);
    equal(directOnly.map(d => d.name), ['Sub-sub-phase A1', 'Leaf task A2'],
        'depth === 1 isolates direct children for the percent rollup, even though the full list is flat');

    // A task with no descendants at all.
    equal(getTaskDescendants(9, plan4Level), [], 'a leaf task with no descendants returns an empty list');
}

// ---------------------------------------------------------------------
// Part 2: setTaskPercentQuick -- click-to-complete + 0/25/50/75/100 toolbar
// ---------------------------------------------------------------------
{
    function makeSandbox() {
        const calls = [];
        const percentInput = { value: '', readOnly: false };
        const elements = { taskPercent: percentInput };
        const sandbox = vm.createContext({
            console,
            document: {
                getElementById: (id) => elements[id] || null,
            },
            // Real setTaskPercentQuick calls straight through to these three;
            // stub them so this test isolates setTaskPercentQuick's own
            // contract (value set + guard) rather than the full markdown
            // line-rebuild saveTask() performs (covered by manual/Selenium
            // verification per the issue's testing notes and by the existing
            // markdown round-trip suite, since it reuses the exact same
            // saveTask() path manual percent entry already uses).
            saveTask: () => calls.push('saveTask'),
            updateRagDisplay: () => calls.push('updateRagDisplay'),
            updateProgressBar: () => calls.push('updateProgressBar'),
        });
        vm.runInContext(extractFunction(scriptSource, 'setTaskPercentQuick') + '\nglobalThis.setTaskPercentQuick = setTaskPercentQuick;', sandbox);
        return { sandbox, calls, percentInput };
    }

    [0, 25, 50, 75, 100].forEach(value => {
        const { sandbox, calls, percentInput } = makeSandbox();
        sandbox.setTaskPercentQuick(value);
        equal(percentInput.value, value, `quick-set button for ${value}% sets #taskPercent to ${value}`);
        equal(calls, ['saveTask', 'updateRagDisplay', 'updateProgressBar'],
            `quick-set ${value}% goes through the same save/RAG/progress-bar refresh manual entry uses`);
    });

    // Clicking the progress bar itself always jumps to 100%, per issue #979
    // item 1 -- exercised the same way (setTaskPercentQuick(100)).
    {
        const { sandbox, calls, percentInput } = makeSandbox();
        percentInput.value = '40';
        sandbox.setTaskPercentQuick(100);
        equal(percentInput.value, 100, 'clicking the completion progress bar jumps the task to 100%');
        equal(calls, ['saveTask', 'updateRagDisplay', 'updateProgressBar'], 'the 100% jump also saves and refreshes the display');
    }

    // Summary/effort-driven tasks: #taskPercent is readOnly while its value
    // is auto-calculated. The quick controls must not be able to fight that.
    {
        const { sandbox, calls, percentInput } = makeSandbox();
        percentInput.readOnly = true;
        percentInput.value = '60';
        sandbox.setTaskPercentQuick(100);
        equal(percentInput.value, '60', 'quick-set is a no-op while #taskPercent is readOnly (summary/effort-driven task)');
        equal(calls, [], 'no save/refresh happens when the quick-set click is ignored');
    }
}

if (failures) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
}
console.log('\nAll tests passed');
