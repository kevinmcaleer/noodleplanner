/**
 * The whiteboard note's palette and its ink ladder have one source (#1250).
 *
 * Two facts this pins, both of which are duplication the design system asks
 * for and neither of which any other check can see:
 *
 * 1.  The ten pastels are declared as `--np-note-*` tokens in
 *     visual-system.css *and* as WB_NOTE_PASTEL_COLOURS in
 *     whiteboard-notes.js. They have to be, from opposite directions:
 *     CLAUDE.md puts every design token in visual-system.css and nowhere
 *     else, and scripts/check-contrast.mjs can only score a colour it finds
 *     there -- while the note's fill is written into the plan's `Theme:`
 *     front matter as a literal by JS that cannot read a stylesheet. So the
 *     JS array stays, and this asserts it is the same ten values in the same
 *     order, which is what makes the contrast report describe the app.
 *
 * 2.  `--np-note-ink-muted` / `--np-note-ink-faint` carry the two de-emphasis
 *     levels as `#rrggbbaa` literals so the checker can composite them, while
 *     views/whiteboard.css derives the levels it actually paints with
 *     `color-mix(... var(--wb-note-text) N%, transparent)` -- because the ink
 *     flips to near-white on a dark custom fill and a literal cannot follow
 *     it. The alpha and the percentage are the same measurement written
 *     twice. If they drift, check-contrast.mjs goes on reporting 4.90:1 for
 *     something the browser is painting at some other ratio, which is worse
 *     than not checking at all.
 *
 * Source-level, like tests/test_np_note_fidelity.mjs and
 * tests/test_np_resource_stack.mjs next door: there is no jsdom here, and
 * what is worth pinning is the authored values, not a rendered one.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATIC = join(HERE, '../packages/noodle-web/src/noodle_web/static');

const VISUAL_SYSTEM = readFileSync(join(STATIC, 'visual-system.css'), 'utf8');
const WHITEBOARD_CSS = readFileSync(join(STATIC, 'views/whiteboard.css'), 'utf8');
const NOTES_JS = readFileSync(join(STATIC, 'whiteboard-notes.js'), 'utf8');

/** The declared value of a custom property in visual-system.css's :root. */
function token(name) {
    const m = new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'm').exec(VISUAL_SYSTEM);
    assert.ok(m, `${name} is not declared in visual-system.css`);
    return m[1].trim();
}

/** The N in `color-mix(in srgb, var(--wb-note-text) N%, transparent)`. */
function mixPercent(property) {
    const m = new RegExp(
        `${property}:\\s*color-mix\\(in srgb,\\s*var\\(--wb-note-text\\)\\s*([0-9.]+)%,\\s*transparent\\)`,
    ).exec(WHITEBOARD_CSS);
    assert.ok(m, `${property} is not a color-mix of --wb-note-text in views/whiteboard.css`);
    return Number(m[1]);
}

const SWATCHES = [
    'yellow-1', 'yellow-2',
    'pink-1', 'pink-2',
    'green-1', 'green-2',
    'blue-1', 'blue-2',
    'red-1', 'red-2',
];

test('the note palette is the same ten colours in CSS and in JS', () => {
    const start = NOTES_JS.indexOf('const WB_NOTE_PASTEL_COLOURS = [');
    assert.notEqual(start, -1, 'WB_NOTE_PASTEL_COLOURS not found -- renamed?');
    const end = NOTES_JS.indexOf(']', start);
    const fromJs = [...NOTES_JS.slice(start, end).matchAll(/'(#[0-9A-Fa-f]{6})'/g)]
        .map((m) => m[1].toUpperCase());
    const fromCss = SWATCHES.map((s) => token(`--np-note-${s}`).toUpperCase());

    assert.equal(fromJs.length, 10, 'the palette is ten swatches');
    assert.deepEqual(
        fromJs,
        fromCss,
        'WB_NOTE_PASTEL_COLOURS and the --np-note-* tokens have drifted apart; '
        + 'scripts/check-contrast.mjs scores the tokens, so the report would be '
        + 'about colours the board does not paint',
    );
});

test('the ink ladder alphas match the percentages whiteboard.css mixes', () => {
    // The tokens are the ink at some alpha; the stylesheet mixes the same
    // fraction of the note's own text colour.
    const ink = token('--np-note-ink').toUpperCase();
    for (const [name, property] of [
        ['--np-note-ink-muted', '--wb-note-ink-muted'],
        ['--np-note-ink-faint', '--wb-note-ink-faint'],
    ]) {
        const value = token(name).toUpperCase();
        assert.ok(
            value.startsWith(ink),
            `${name} (${value}) should be ${name.replace(/-(muted|faint)$/, '')} (${ink}) plus an alpha`,
        );
        const alpha = parseInt(value.slice(ink.length), 16);
        assert.ok(Number.isFinite(alpha), `${name} does not end in a two-digit alpha`);

        const percent = mixPercent(property);
        // One step of 8-bit alpha is 0.39 of a percent, so the token can only
        // ever land within half a step of the authored percentage.
        assert.ok(
            Math.abs((alpha / 255) * 100 - percent) < 0.2,
            `${name} is ${((alpha / 255) * 100).toFixed(2)}% but ${property} mixes ${percent}% -- `
            + 'check-contrast.mjs would be scoring a ratio the browser does not paint',
        );
    }
});

test('the note ink is what wbContrastTextColour() picks for every swatch', () => {
    // --np-note-ink is only the right thing to score if it is the colour the
    // app actually chooses on each of these fills. All ten are light, so it
    // should be the near-black arm of that function every time.
    const channel = (c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (hex) => {
        const n = parseInt(hex.slice(1), 16);
        return 0.2126 * channel((n >> 16) & 255)
            + 0.7152 * channel((n >> 8) & 255)
            + 0.0722 * channel(n & 255);
    };
    const ratio = (a, b) => {
        const [hi, lo] = luminance(a) > luminance(b) ? [luminance(a), luminance(b)] : [luminance(b), luminance(a)];
        return (hi + 0.05) / (lo + 0.05);
    };

    const ink = token('--np-note-ink');
    // The two arms of wbContrastTextColour(), read out of the app rather than
    // re-typed, so a change to either is a failure here.
    const arms = [...NOTES_JS.slice(
        NOTES_JS.indexOf('function wbContrastTextColour('),
        NOTES_JS.indexOf('function wbContrastTextColour(') + 400,
    ).matchAll(/const (?:dark|light) = '(#[0-9a-fA-F]{6})';/g)].map((m) => m[1]);
    assert.equal(arms.length, 2, 'wbContrastTextColour() no longer has two fixed arms');
    assert.ok(
        arms.some((arm) => arm.toUpperCase() === ink.toUpperCase()),
        `--np-note-ink (${ink}) is not one of wbContrastTextColour()'s arms (${arms.join(', ')})`,
    );

    for (const swatch of SWATCHES) {
        const fill = token(`--np-note-${swatch}`);
        const best = arms.reduce((a, b) => (ratio(fill, a) >= ratio(fill, b) ? a : b));
        assert.equal(
            best.toUpperCase(),
            ink.toUpperCase(),
            `on ${swatch} the app would pick ${best}, not --np-note-ink`,
        );
    }
});
