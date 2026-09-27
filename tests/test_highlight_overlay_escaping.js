/**
 * Regression tests for #745: the editor is a transparent textarea over the
 * syntax-highlight overlay, whose innerHTML highlightSyntax() builds. Most of
 * its line sites escaped only < and >, never &, so entity-like text in the
 * plan ("Read &amp; review", "R&Damp", "&not", "&#169;") collapsed to a single
 * glyph in the overlay and the caret drifted right of the character being
 * edited — the same failure class as #744.
 *
 * The invariant: for every line, the text a browser would render from the
 * overlay HTML is exactly the textarea line. The check is strict — after the
 * tags are stripped, the only entities allowed are &amp; &lt; &gt; (which a
 * browser decodes back to one character each), so any unescaped & fails even
 * where it would happen to render correctly.
 *
 * Run with: node tests/test_highlight_overlay_escaping.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const staticDir = path.join(__dirname, '..', 'packages', 'noodle-web', 'src', 'noodle_web', 'static');
const editorSource = fs.readFileSync(path.join(staticDir, 'editor.js'), 'utf8');
const tokenizerSource = fs.readFileSync(path.join(staticDir, 'task-tokenizer.js'), 'utf8');

const start = editorSource.indexOf('function highlightSyntax(');
const end = editorSource.indexOf('// Update line numbers and syntax highlighting', start);
if (start < 0 || end < 0) throw new Error('highlightSyntax not found in editor.js');

const context = vm.createContext({ window: {}, sectionFoldingController: null });
vm.runInContext(tokenizerSource + '\nglobalThis.TaskLineTokenizer = TaskLineTokenizer;', context);
// highlightSyntax() leans on top-level helpers elsewhere in editor.js (#746's
// isEditorSeparatorLine); load whichever of them this editor.js defines.
for (const helper of ['isEditorSeparatorLine']) {
    const at = editorSource.indexOf('function ' + helper + '(');
    if (at < 0) continue;
    const close = editorSource.indexOf('\n}\n', at);
    vm.runInContext(editorSource.slice(at, close + 2), context);
}
vm.runInContext(editorSource.slice(start, end) + '\nglobalThis.highlightSyntax = highlightSyntax;', context);

let failures = 0;
function check(condition, message, detail) {
    if (condition) {
        console.log('PASS:', message);
    } else {
        failures++;
        console.error('FAIL:', message, detail || '');
    }
}

// What the overlay shows for one line of highlightSyntax() output, or null
// if it contains anything a browser would not decode back char-for-char.
function renderedText(html) {
    const text = html.replace(/<[^>]*>/g, '');
    if (/[<>]/.test(text) || /&(?!(?:amp|lt|gt);)/.test(text)) return null;
    return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function assertOverlayMatches(plan, label) {
    const inputLines = plan.split('\n');
    const outputLines = context.highlightSyntax(plan).split('\n');
    check(outputLines.length === inputLines.length, label + ': one overlay line per editor line',
        '\n expected ' + inputLines.length + ', got ' + outputLines.length);
    inputLines.forEach((line, i) => {
        const rendered = renderedText(outputLines[i] || '');
        check(rendered === line, label + ' line ' + (i + 1) + ': ' + JSON.stringify(line),
            '\n expected: ' + JSON.stringify(line) +
            '\n rendered: ' + JSON.stringify(rendered) +
            '\n html:     ' + JSON.stringify(outputLines[i]));
    });
}

const samples = ['&amp;', '&lt;', 'R&Damp', '&not', '&#169;', 'a & b', '<tag>', '&#x41;', '&amp;amp;'];

// Each sample, in each kind of line highlightSyntax() treats differently.
for (const sample of samples) {
    const plan = [
        '---',
        'title: Plan ' + sample,
        '- @alice ' + sample,
        '---',
        '# Phase ' + sample,
        'Read ' + sample + ' review 2d @bob',
        'Build ' + sample + ' "note ' + sample + '" 3d [depends Read]',
        '// comment ' + sample,
        '---highlights---',
        'Highlight ' + sample,
        '---end-highlights---',
        '---budget---',
        'Budget ' + sample,
        '---raid log---',
        'Risk ' + sample,
        '---baseline---',
        'Baseline ' + sample,
        '---whiteboard---',
        'Board ' + sample,
        '---parking lot---',
        'Parked ' + sample,
    ].join('\n');
    assertOverlayMatches(plan, 'sample ' + sample);
}

// A varied plan exercising every token type alongside entity-like text.
assertOverlayMatches([
    '---',
    'title: R&D &amp; ops <draft>',
    'owner: Q&A',
    'resources:',
    '  - @alice &lt;lead&gt;',
    '---',
    '# Design &amp; build',
    'Read &amp; review 2d @alice 50% #docs "check &not; &#169;"',
    '* +2d Ship &copy it 2026-01-05 !! {Now &amp; next}',
    'Plan &nbsp;spacing ~3h/1d $GW&amp [depends Read &amp; review, Nope&lt;]',
    'Weekly sync 1w [repeats weekly] D2026-02-01',
    '  // indented comment <b>&amp;</b>',
    '---raid log---',
    '| R1 | Risk | a & b &amp; <c> |',
    '---baseline---',
    'Read &amp; review | 2026-01-01 | 2026-01-03',
].join('\n'), 'varied plan');

if (failures) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
}
console.log('\nAll highlight overlay escaping tests passed');
