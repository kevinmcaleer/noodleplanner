/**
 * Shared task-line grammar regression tests for #748.
 *
 * Run with: node tests/test_task_tokenizer.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const staticDir = path.join(__dirname, '..', 'packages', 'noodle-web', 'src', 'noodle_web', 'static');
const context = vm.createContext({ console, document: { getElementById: () => null } });
const tokenizerSource = fs.readFileSync(path.join(staticDir, 'task-tokenizer.js'), 'utf8');
vm.runInContext(tokenizerSource + '\nglobalThis.tokenizer = TaskLineTokenizer;', context);

const scriptSource = fs.readFileSync(path.join(staticDir, 'script.js'), 'utf8');
const parseStart = scriptSource.indexOf('function parseTaskLine(');
const parseEnd = scriptSource.indexOf('\n/**\n * Parse front matter', parseStart);
vm.runInContext(scriptSource.slice(parseStart, parseEnd) + '\nglobalThis.parseTaskLine = parseTaskLine;', context);

let failures = 0;
function equal(actual, expected, message) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        failures++;
        console.error('FAIL:', message, '\n expected:', expected, '\n actual:  ', actual);
    } else {
        console.log('PASS:', message);
    }
}
function tokenTypes(line) {
    return context.tokenizer.tokenize(line).map(token => [token.type, token.text]);
}

equal(context.parseTaskLine('Release 3y', 1).duration, '3', 'year durations are parsed');
equal(context.parseTaskLine('Release 3y', 1).name, 'Release', 'year durations are excluded from task names');
equal(context.parseTaskLine('Launch! 2d', 1).priority, 'Low', 'punctuation in task names is not priority');
equal(context.parseTaskLine('Launch! 2d', 1).name, 'Launch!', 'task-name punctuation is preserved');
equal(context.parseTaskLine('Task A 0%', 1).percent, '0', 'trailing percentages are parsed');
equal(context.parseTaskLine('Task A 0%', 1).name, 'Task A', 'trailing percentages are excluded from task names');
equal(tokenTypes('Design @dev[30%] 5d 0%'), [['resource', '@dev[30%]'], ['duration', '5d'], ['percent', '0%']],
    'a resource allocation is part of the resource, not a percent');
equal(context.parseTaskLine('Design @dev[30%] 5d 0%', 1).percent, '0', 'an allocation does not set percent complete');
equal(context.parseTaskLine('Design @dev[30%] 5d', 1).percent, '', 'an allocation alone leaves percent unset');
equal(context.parseTaskLine('Design @dev[30%] 5d', 1).name, 'Design', 'an allocation is excluded from task names');
equal(tokenTypes('Build ~8h 2d'), [['effort', '~8h'], ['duration', '2d']], 'effort and duration have source spans');
equal(context.parseTaskLine('Build ~8h 2d', 1).effortTotal, '8', 'effort metadata is parsed from the shared grammar');
equal(tokenTypes('Task 2d [depends $product:FS +2d]'), [['duration', '2d'], ['dependency', '[depends $product:FS +2d]']],
    'dependency contents are not re-tokenised as task metadata');
equal(context.parseTaskLine('Task 2d [depends $product:FS +2d]', 1).dependencies, '$product:FS +2d',
    'deliverable dependencies are retained');
equal(tokenTypes('Task "first" "second" 2d').filter(token => token[0] === 'comment'),
    [['comment', '"first"'], ['comment', '"second"']], 'every quoted comment has a source span');
equal(context.parseTaskLine('Task "first" "second" 2d', 1).name, 'Task',
    'all quoted comments are excluded from task names');
equal(context.parseTaskLine('Task 5d D2026-09-10', 1).deadline, '2026-09-10',
    'a D-prefixed deadline tag is parsed');
equal(context.parseTaskLine('Task 5d D2026-09-10', 1).name, 'Task',
    'a deadline tag is excluded from the task name');
equal(context.parseTaskLine('Task 2026-01-01 2026-02-01 5d D2026-09-10', 1).startDate, '2026-01-01',
    'a deadline tag does not shadow the start date');
equal(context.parseTaskLine('Task 2026-01-01 2026-02-01 5d D2026-09-10', 1).finishDate, '2026-02-01',
    'a deadline tag does not shadow the finish date');
equal(context.parseTaskLine('Task 5d', 1).deadline, '',
    'a task with no deadline reports an empty deadline');

if (failures) process.exit(1);
console.log('\nAll tests passed');
