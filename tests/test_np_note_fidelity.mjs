/**
 * <np-note> models every control the whiteboard note actually renders (#1242).
 *
 * Phase A of #1241 exists because the component had drifted a long way from
 * the app: the shipping note's header carries six buttons to the component's
 * one, and its checklist row up to ten children to the component's two. That
 * is not a drift anyone introduced on purpose -- it is what happens when the
 * app grows a control and nothing says the component should too.
 *
 * So this is the thing that says so. It parses the class names the app's own
 * note builders append and fails when one has no counterpart in np-note.js.
 * Add a control to a row on the board and this goes red until Storybook shows
 * it, which is the only way "a component that looks wrong in Storybook looks
 * wrong in NoodlePlanner" (docs/design/consolidation-and-handoff.md) stays
 * true rather than being a thing someone remembered to do once.
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
const componentSource = readFileSync(join(STATIC, 'components/note/np-note.js'), 'utf8');

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

/** The body of `function <name>(...)`, by brace matching from its opening `{`. */
function functionBody(source, name) {
    const start = source.indexOf(`function ${name}(`);
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
    'wbAppendRowDependencyHandle',
    'wbBuildAddChildRow',
];

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
