/**
 * The plan editor's highlight overlay keeps separator lines verbatim (#746).
 *
 * The editor is a transparent <textarea> over #highlightLayer, whose HTML
 * highlightSyntax() builds: the caret comes from the textarea, the glyphs from
 * the overlay, so both must hold the same text character for character. Lines
 * containing `---` or `===` used to be returned raw -- unescaped -- so a `<`
 * on one opened a real tag and text vanished from the overlay; and because the
 * guard matched `---`/`===` anywhere, a task like `Migrate A---B 3d` lost its
 * highlighting too.
 *
 * Runs the real task-tokenizer.js and editor.js in a vm sandbox: setupEditor()
 * paints a stand-in overlay whose innerHTML is captured and decoded the way a
 * browser would read back its textContent -- refusing any tag but <span>.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const staticDir = new URL('../packages/noodle-web/src/noodle_web/static/', import.meta.url);
const read = name => readFileSync(new URL(name, staticDir), 'utf8');

const ENTITIES = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&#8203;': '​' };

/** The text a browser would show for the overlay HTML. Only the <span>s the
 *  highlighter emits are markup; any other `<` or a bare `&` is the bug. */
function overlayText(html) {
    const stray = /<(?!\/?span[\s>])/.exec(html);
    assert.equal(stray, null, `unescaped '<' in overlay HTML: ${JSON.stringify(html.slice(stray?.index ?? 0, (stray?.index ?? 0) + 30))}`);
    const text = html.replace(/<\/?span[^>]*>/g, '');
    const bareAmp = /&(?!lt;|gt;|amp;|quot;|#39;|#8203;)/.exec(text);
    assert.equal(bareAmp, null, 'unescaped \'&\' in overlay HTML');
    assert.ok(!text.includes('>'), 'unescaped \'>\' in overlay HTML');
    return text.replace(/&(?:lt|gt|amp|quot|#39|#8203);/g, m => ENTITIES[m]);
}

function element() {
    return {
        classList: { add() {}, remove() {} },
        dataset: {},
        style: {},
        appendChild() {},
    };
}

/** Paint `text` through setupEditor() and return the overlay's HTML, plus
 *  any console.warn calls the dev-mode drift check made. */
function paint(text, { devMode = false } = {}) {
    const warnings = [];
    const editor = {
        id: 'kanbanPlanEditor', // no section folding: every line is its own record
        value: text,
        placeholder: '',
        scrollTop: 0,
        scrollLeft: 0,
        selectionStart: 0,
        parentElement: element(),
        addEventListener() {},
    };
    const lineNumbers = { ...element(), innerHTML: '', scrollTop: 0, querySelectorAll: () => [], querySelector: () => null };
    const highlightLayer = {
        style: {},
        innerHTML: '',
        get textContent() { return overlayText(this.innerHTML); },
    };
    const sandbox = {
        console: { log() {}, error() {}, warn: (...args) => warnings.push(args.join(' ')) },
        document: { createElement: () => element() },
        location: { hostname: devMode ? 'localhost' : 'noodleplanner.example' },
        setTimeout, clearTimeout,
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(read('task-tokenizer.js') + '\nglobalThis.TaskLineTokenizer = TaskLineTokenizer;', sandbox);
    vm.runInContext(read('editor.js'), sandbox);
    sandbox.setupEditor(editor, lineNumbers, highlightLayer, false);
    return { html: highlightLayer.innerHTML, warnings, sandbox };
}

/** The HTML the overlay holds for line `index` of the painted text. */
const lineHtml = (html, index) => html.split('\n')[index];

const LINES = [
    '=== Phase <1> ===',
    'Design <-- review --- notes',
    'Migrate A---B 3d',
    'Rollout A===B 2d @ops',
    '=== R&D <beta> ===',
    '--- <b>not bold</b> ---',
];

test('the overlay holds each separator-ish line verbatim', () => {
    for (const line of LINES) {
        const text = `Kickoff 1d\n${line}\nWrap up 1d [depends Kickoff]`;
        const { html } = paint(text);
        assert.equal(overlayText(html), text, `overlay drifted for ${JSON.stringify(line)}`);
    }
});

test('a whole plan with separators and back matter paints verbatim', () => {
    const text = [
        '---',
        'title: Launch <v2>',  // no '&' here: front-matter escaping is #745's
        '---',
        '=== Phase <1> ===',
        'Design <-- review --- notes',
        'Migrate A---B 3d',
        '',
        '=====',
        '---comms---',
        '| Audience | Channel |',
        '|---|---|',
        '| Board <execs> | Email |',
        '---raid log---',
        '| Type | Title |',
        '| --- | --- |',
        '| Risk | A<B |',
    ].join('\n');
    const { html } = paint(text);
    assert.equal(overlayText(html), text);
});

test('a mid-line --- or === no longer suppresses task highlighting', () => {
    const { html } = paint('Migrate A---B 3d\nRollout A===B 2d @ops');
    assert.match(lineHtml(html, 0), /<span class="syntax-duration">3d<\/span>/);
    assert.match(lineHtml(html, 1), /<span class="syntax-duration">2d<\/span>/);
    assert.match(lineHtml(html, 1), /<span class="syntax-resource">@ops<\/span>/);
});

test('real separator and section lines stay unhighlighted', () => {
    const { html } = paint('=== Phase 1 3d ===\n=====\n---comms---\n|---|---|');
    assert.equal(lineHtml(html, 0), '=== Phase 1 3d ===');
    assert.equal(lineHtml(html, 1), '=====');
    assert.equal(lineHtml(html, 2), '---comms---');
    assert.equal(lineHtml(html, 3), '|---|---|');
});

test('back-matter markers keep their delimiter styling', () => {
    const { html } = paint('Build 2d\n---raid log---\n| Type |');
    assert.equal(lineHtml(html, 1), '<span class="syntax-highlights-delimiter">---raid log---</span>');
});

test('a task named with --- is a valid dependency target', () => {
    const { html } = paint('Migrate A---B 3d\nCutover 1d [depends Migrate A---B]');
    assert.ok(!lineHtml(html, 1).includes('syntax-error'), lineHtml(html, 1));
});

test('isEditorSeparatorLine matches rules, not mid-line dashes', () => {
    const { sandbox } = paint('');
    const yes = ['---', '  ===', '=== Phase ===', '---raid log---', '-----', '|---|---|', '| :--- | ---: |'];
    const no = ['Migrate A---B 3d', 'Design <-- review --- notes', 'A === B', '--', '==', '| a | b |', ''];
    for (const line of yes) assert.equal(sandbox.isEditorSeparatorLine(line), true, line);
    for (const line of no) assert.equal(sandbox.isEditorSeparatorLine(line), false, line);
});

test('extractTaskNameFromEditorLine keeps a name with a mid-line ---', () => {
    const { sandbox } = paint('');
    sandbox.parseTaskLine = line => ({ name: line.replace(/\s+\d+d$/, '') });
    assert.equal(sandbox.extractTaskNameFromEditorLine('Migrate A---B 3d'), 'Migrate A---B');
    assert.equal(sandbox.extractTaskNameFromEditorLine('=== Phase ==='), '');
    assert.equal(sandbox.extractTaskNameFromEditorLine('---raid log---'), '');
});

test('the dev-mode drift check is silent when the overlay matches', () => {
    const { warnings } = paint(LINES.join('\n'), { devMode: true });
    assert.deepEqual(warnings, []);
});

test('the dev-mode drift check warns with the first differing index', () => {
    const { sandbox } = paint('');
    assert.equal(sandbox.firstTextDifference('abc', 'abc'), -1);
    assert.equal(sandbox.firstTextDifference('abXd', 'abcd'), 2);
    assert.equal(sandbox.firstTextDifference('ab', 'abc'), 2);

    // Force a drift: an overlay whose textContent drops a character.
    const warnings = [];
    const layer = { style: {}, innerHTML: '', get textContent() { return overlayText(this.innerHTML).slice(1); } };
    sandbox.console.warn = (...args) => warnings.push(args.join(' '));
    sandbox.location.hostname = 'localhost';
    const editor = { id: 'x', value: 'Build 2d', placeholder: '', scrollTop: 0, scrollLeft: 0, selectionStart: 0, parentElement: element(), addEventListener() {} };
    const gutter = { ...element(), innerHTML: '', scrollTop: 0, querySelectorAll: () => [], querySelector: () => null };
    sandbox.setupEditor(editor, gutter, layer, false);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /overlay drift at index 0/);
});

test('the drift check stays off in production', () => {
    let reads = 0;
    const { sandbox } = paint('');
    const layer = { style: {}, innerHTML: '', get textContent() { reads++; return ''; } };
    sandbox.location.hostname = 'noodleplanner.example';
    const editor = { id: 'x', value: 'Build 2d', placeholder: '', scrollTop: 0, scrollLeft: 0, selectionStart: 0, parentElement: element(), addEventListener() {} };
    const gutter = { ...element(), innerHTML: '', scrollTop: 0, querySelectorAll: () => [], querySelector: () => null };
    sandbox.setupEditor(editor, gutter, layer, false);
    assert.equal(reads, 0);
});
