/**
 * Regression tests for #744: the editor is a transparent textarea over the
 * syntax-highlight overlay, so the overlay must render char-for-char the same
 * text. The [depends ...] highlighter used to rebuild the block (normalising
 * commas and spaces, dropping "Milestone:", upper-casing link types), which
 * shifted every following glyph and left the caret beside the character it
 * was editing.
 *
 * Run with: node tests/test_depends_highlight_fidelity.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'packages', 'noodle-web', 'src', 'noodle_web', 'static', 'editor.js'),
    'utf8'
);
const start = source.indexOf('function highlightDependencyBlock(');
const end = source.indexOf('function highlightTaskLine(', start);
if (start < 0 || end < 0) throw new Error('highlightDependencyBlock not found in editor.js');

const context = vm.createContext({
    allTaskNames: new Set(['design', 'build', 'launch', 'task a']),
    circularByLine: { 3: new Set(['build']) },
    escapeSyntaxHtml: value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
});
vm.runInContext(source.slice(start, end) +
    '\nglobalThis.highlightDependencyBlock = highlightDependencyBlock;', context);

let failures = 0;
function check(condition, message, detail) {
    if (condition) {
        console.log('PASS:', message);
    } else {
        failures++;
        console.error('FAIL:', message, detail || '');
    }
}

function visibleText(html) {
    return html.replace(/<[^>]*>/g, '')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

const cases = [
    '[depends Design]',
    '[depends Design,Build]',
    '[depends Design,]',
    '[depends Design, ]',
    '[depends  Design]',
    '[depends Design , Build]',
    '[depends: Design]',
    '[depends:Design]',
    '[depends Milestone: Launch]',
    '[depends Design:ss]',
    '[depends Design :FF +2d]',
    '[depends Design  -1w, Task A]',
    '[depends Unknown<b>&, Design]',
    '[depends ,,Design]',
];
for (const text of cases) {
    const html = context.highlightDependencyBlock(text, 0);
    check(visibleText(html) === text, 'overlay text matches source: ' + text,
        '\n expected: ' + text + '\n actual:   ' + visibleText(html));
}

const typed = context.highlightDependencyBlock('[depends Design:ss +2d]', 0);
check(typed.includes('<span class="syntax-dep-type">:ss</span>'), 'link type keeps its original case');
check(typed.includes('<span class="syntax-lag-lead">+2d</span>'), 'lag is still highlighted');
check(!typed.includes('syntax-error'), 'a known dependency is not flagged');

const milestone = context.highlightDependencyBlock('[depends Milestone: Launch]', 0);
check(!milestone.includes('syntax-error'), 'Milestone: prefix is ignored when validating');

const unknown = context.highlightDependencyBlock('[depends Nope, Design]', 0);
check(unknown.includes('<span class="syntax-error">Nope</span>'), 'an unknown dependency is flagged');

const circular = context.highlightDependencyBlock('[depends Build]', 2);
check(circular.includes('<span class="syntax-circular" title="Circular dependency">Build</span>'),
    'a circular dependency is flagged');

if (failures) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
}
console.log('\nAll depends highlight fidelity tests passed');
