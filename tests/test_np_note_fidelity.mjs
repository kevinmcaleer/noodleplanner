/**
 * The note is built once, and both the board and Storybook build from it
 * (#1242, then #1249).
 *
 * Phase A of #1241 existed because the component had drifted a long way from
 * the app: the shipping note's header carried six buttons to the component's
 * one, and its checklist row up to ten children to the component's two. That
 * was not a drift anyone introduced on purpose -- it is what happens when the
 * app grows a control and nothing says the component should too.
 *
 * Phase A's answer was this test: parse the class names the app's builders
 * append, and fail when one has no counterpart in the component. That worked,
 * and it was still two sources being compared. #1249 removed the second one --
 * `components/note/note-markup.js` builds the card, the checklist row and the
 * add row, and `wbBuildChildRow()` / `wbCreateNoteNode()` / `NpNote` all call
 * it -- so the parity assertions below now read the shared module as part of
 * "the component", and a second set of assertions keeps it that way by failing
 * if either caller starts building `.wb-note-*` markup of its own again.
 *
 * Both halves matter. Parity alone would pass if someone re-typed the markup
 * identically in both places; single-source alone would pass if a control were
 * dropped from the builder entirely.
 *
 * Source-parity rather than DOM: there is no jsdom in this repo --
 * tests/test_whiteboard_notes.js runs the real module in a `vm` sandbox over
 * its DOM-free helpers and leaves rendering to the browser suites -- so
 * instantiating the custom element here would mean adding a DOM to the JS
 * suite for one test. Comparing the two sources is cheaper and catches the
 * thing that actually drifts, which is the *set of controls*.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATIC = join(HERE, '../packages/noodle-web/src/noodle_web/static');

const appSource = readFileSync(join(STATIC, 'whiteboard-notes.js'), 'utf8');
const npNoteSource = readFileSync(join(STATIC, 'components/note/np-note.js'), 'utf8');
const markupSource = readFileSync(join(STATIC, 'components/note/note-markup.js'), 'utf8');

/** "The component" is now np-note plus the builder it and the board share. */
const componentSource = npNoteSource + '\n' + markupSource;

/** Source with comments removed.
 *
 * The value assertions below are about what the component *does*. np-note.js
 * explains at length which values it stopped using and why, naming each one,
 * so a plain `includes()` over the raw file asserts on the changelog rather
 * than on the code. */
function code(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const componentCode = code(componentSource);

/** The body of `function <name>(...)` or of a class method `<name>(...) {`,
 * by brace matching from its opening `{`. Both forms are needed: the app's
 * builders are plain functions and np-note's are methods. */
function functionBody(source, name) {
    let start = source.indexOf(`function ${name}(`);
    if (start === -1) {
        const method = new RegExp(`^\\s{4}${name}\\([^)]*\\)\\s*\\{`, 'm').exec(source);
        if (method) start = method.index;
    }
    assert.notEqual(start, -1, `${name}() not found -- has it been renamed?`);
    const open = source.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) return source.slice(open, i + 1);
    }
    throw new Error(`unbalanced braces reading ${name}()`);
}

/** Every `wb-`-prefixed class token in a chunk of source. */
function classTokens(source) {
    const found = new Set();
    for (const [, literal] of source.matchAll(/'([^'\n]*\bwb-[a-z0-9-]+[^'\n]*)'/g)) {
        for (const token of literal.split(/\s+/)) {
            if (/^wb-[a-z0-9-]+$/.test(token)) found.add(token);
        }
    }
    return found;
}

// The builders that between them produce everything on a note.
const BUILDERS = [
    'wbCreateNoteNode',
    'wbUpdateNoteNode',
    'wbBuildChildRow',
    'wbAppendChildResourceControls',
    'wbBuildAddChildRow',
];

/**
 * The functions that must no longer create `.wb-note-*` markup themselves,
 * paired with the file they live in. Each one used to, and each one now asks
 * note-markup.js for it -- which is what makes the parity above structural
 * rather than a thing two files happen to agree on today.
 *
 * `wbUpdateNoteNode()` is not here: it *fills* the skeleton rather than
 * building it, and the per-render classes it toggles (`wb-note-title-only`,
 * `wb-note-flash`, the link-target states) are behaviour, not markup.
 */
const SINGLE_SOURCE = [
    ['whiteboard-notes.js', 'wbCreateNoteNode', appSource],
    ['whiteboard-notes.js', 'wbBuildChildRow', appSource],
    ['whiteboard-notes.js', 'wbBuildAddChildRow', appSource],
    ['np-note.js', '_build', npNoteSource],
    ['np-note.js', '_buildRow', npNoteSource],
    ['np-note.js', '_buildAddRow', npNoteSource],
];

/**
 * Classes a caller may still name even though it does not build the markup --
 * a state it toggles, or a slot it fills, on an element the builder made.
 */
const CALLER_MAY_NAME = new Set([
    // The board's note host is an SVG <foreignObject>, which cannot be built
    // by a markup module that knows nothing about the board's SVG layer -- so
    // wbCreateNoteNode() still makes that one element itself, and np-note puts
    // the same class on its own host.
    'wb-note',
    // np-note's own drop-target state, set from a story arg rather than from a
    // live drag. The board sets the same two classes from whiteboard-dep-noodles.js.
    'wb-dep-row-target',
    'wb-dep-row-target-invalid',
    // Filled by the caller, because only the caller knows the resources: the
    // board hands wbFillResourceStack() its own <np-resource-stack>, np-note
    // makes one from a story arg.
    'wb-note-row-avatar',
]);

/**
 * Classes the app applies that the component deliberately does not, each with
 * the reason. Anything not listed here is a real gap.
 *
 * Keep this list short and argued. A class added here without a reason is how
 * the drift this test exists to catch gets re-introduced one entry at a time.
 */
const NOT_MODELLED = new Map([
    // Empty, and that is the intended state: the component models every class
    // the six builders produce. An entry here is a hole in Storybook's
    // fidelity, so it should be argued for rather than added to quietly.
]);

test('<np-note> models every class the app builds onto a note', () => {
    const modelled = classTokens(componentSource);

    const missing = [];
    for (const builder of BUILDERS) {
        for (const token of classTokens(functionBody(appSource, builder))) {
            if (modelled.has(token) || NOT_MODELLED.has(token)) continue;
            missing.push(`${token}  (built in ${builder}())`);
        }
    }

    assert.deepEqual(
        missing,
        [],
        'np-note.js does not model these classes the app renders on a note.\n' +
        'Either add them to the component, or add them to NOT_MODELLED with a\n' +
        'reason:\n  ' + missing.join('\n  ')
    );
});

test('neither caller builds the note\'s markup itself any more', () => {
    const offenders = [];
    for (const [file, fn, source] of SINGLE_SOURCE) {
        const body = functionBody(source, fn);
        for (const token of classTokens(body)) {
            if (CALLER_MAY_NAME.has(token)) continue;
            offenders.push(`${file}: ${fn}() names ${token}`);
        }
        // The give-away is element creation, not just a class name: a caller
        // that reaches for createElement is building markup by hand again.
        //
        // One exception, and only one: the board's note host is an SVG
        // <foreignObject>, which a markup module that knows nothing about the
        // board's SVG layer cannot build. Anything created in SVG_NS is that
        // host; anything created in the HTML namespace is note markup.
        const creations = [...body.matchAll(/document\.createElement(?:NS)?\s*\(([^,)]*)/g)]
            .map((m) => m[1].trim())
            .filter((ns) => ns !== 'SVG_NS');
        if (creations.length) {
            offenders.push(`${file}: ${fn}() builds elements itself (${creations.join(', ')})`);
        }
    }
    assert.deepEqual(
        offenders,
        [],
        'the note\'s markup has to come from components/note/note-markup.js, so\n'
        + 'that Storybook and the board cannot show different notes:\n  '
        + offenders.join('\n  ')
    );
});

test('the shared builder is what both sides actually call', () => {
    // A weaker version of the test above would pass if a caller simply stopped
    // rendering the row. This is the other half: each side reaches the module.
    assert.ok(
        /globalThis\.NoodleNoteMarkup/.test(appSource),
        'whiteboard-notes.js should take its markup from globalThis.NoodleNoteMarkup'
    );
    assert.ok(
        /from '\.\/note-markup\.js'/.test(npNoteSource),
        'np-note.js should import the shared builder'
    );
    for (const fn of ['buildNoteCard', 'buildChecklistRow', 'buildAddRow']) {
        assert.ok(
            new RegExp(`export function ${fn}\\b`).test(markupSource),
            `note-markup.js should export ${fn}()`
        );
    }
});

test('the exclusion list has not grown stale', () => {
    // An entry that no builder produces any more is dead, and a dead entry is
    // an exclusion nobody is checking.
    const built = new Set();
    for (const builder of BUILDERS) {
        for (const token of classTokens(functionBody(appSource, builder))) built.add(token);
    }
    const stale = [...NOT_MODELLED.keys()].filter((token) => !built.has(token));
    assert.deepEqual(stale, [], `NOT_MODELLED lists classes no builder produces: ${stale.join(', ')}`);
});

test('the component ports the app\'s contrast algorithm, not its own', () => {
    // The pilot picked text colour on a `luminance > 0.5` threshold returning
    // #1a1a1a/#ffffff, against the app's measured-ratio #161616/#fafafa -- two
    // algorithms and four values, so Storybook could show text the app would
    // never render.
    for (const value of ['#161616', '#fafafa']) {
        assert.ok(
            componentCode.includes(value),
            `component should use the app's ${value}, not a colour of its own`
        );
    }
    for (const stale of ['#1a1a1a', '#ffffff', '#333333']) {
        assert.ok(
            !componentCode.includes(stale),
            `component still carries the pilot's own ${stale}`
        );
    }
});

test('the component offers the shipped pastel palette', () => {
    const palette = functionBody.call(null, appSource, 'wbPalette');
    assert.ok(palette.includes('WB_NOTE_PASTEL_COLOURS'), 'wbPalette() still serves the pastel list');
    const appSwatches = [...appSource.matchAll(/'(#[0-9A-F]{6})'/g)].map((m) => m[1]);
    const componentSwatches = new Set([...componentSource.matchAll(/'(#[0-9A-F]{6})'/g)].map((m) => m[1]));
    const shipped = appSwatches.filter((hex) => appSource.includes(`'${hex}', `) || appSource.includes(`'${hex}',`));
    const missing = shipped.filter((hex) => !componentSwatches.has(hex));
    assert.deepEqual(missing, [], `component is missing shipped swatches: ${missing.join(', ')}`);
});

test('the checklist row renders the app\'s checkbox component', () => {
    // This assertion has flipped, deliberately. In phase A it required the bare
    // native input, because the pilot had invented a round --np-success-filled
    // control that existed nowhere in NoodlePlanner, and "should the app have a
    // designed checkbox" could not be asked honestly while Storybook already
    // showed one. #1245 asked and answered it, so now both sides must render
    // the same component -- and neither may style a checkbox of its own.
    assert.ok(
        componentSource.includes('np-checkbox'),
        'component should render <np-checkbox>, the control the app now builds'
    );
    assert.ok(
        !/border-radius:\s*50%/.test(componentCode),
        'component styles a checkbox of its own instead of using the component'
    );
    assert.ok(
        appSource.includes('np-checkbox'),
        'the app should build <np-checkbox> too -- otherwise Storybook and the '
        + 'board show different controls again'
    );
});
