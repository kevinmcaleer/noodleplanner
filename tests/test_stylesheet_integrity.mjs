/**
 * Every stylesheet the app ships parses as a complete stylesheet.
 *
 * This exists because of a specific, repeated accident rather than a
 * hypothetical one. Twice now a scripted edit removing a CSS rule has searched
 * backwards from the rule for "the comment above it", found a comment that
 * belonged to the *previous* rule, and deleted everything in between --
 * carrying off the previous rule's closing brace, or a whole neighbouring rule,
 * along with the intended target.
 *
 * What makes that worth a test rather than more care is how quietly it fails.
 * An unterminated rule does not throw: the parser keeps consuming declarations
 * until it finds a brace to resynchronise on, so the *following* rules are
 * silently swallowed too. The first time, the whiteboard's add-task row lost
 * its hover and nothing noticed for three merges. The second time, a note's
 * "under X" caption lost its closing brace and the board's hierarchy noodles
 * turned black -- a rule six selectors away from anything being edited.
 *
 * Neither gate could see either one. `lint:design` reads declarations, and a
 * declaration that has been swallowed is not a violation; `check:contrast`
 * scores token pairings and never looks at a rule at all. Both are happy with a
 * stylesheet that no longer says what it reads as saying.
 *
 * The checks here are deliberately structural rather than stylistic. Prettier
 * already disagrees with these files and is not a gate; this is about whether
 * the browser will read them the way the author did.
 *
 * Usage:
 *     node --test tests/test_stylesheet_integrity.mjs
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATIC = path.join(HERE, '..', 'packages', 'noodle-web', 'src', 'noodle_web', 'static');

/** Every .css the app ships, minus anything vendored. */
function stylesheets(dir = STATIC, found = []) {
    for (const entry of readdirSync(dir)) {
        if (entry === 'vendor' || entry === 'node_modules') continue;
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) stylesheets(full, found);
        else if (entry.endsWith('.css')) found.push(full);
    }
    return found;
}

/**
 * Strip comments and quoted strings, so a brace inside either -- `content: "}"`
 * or a comment showing example CSS -- is not counted as structure.
 */
function structuralOnly(css) {
    let out = '';
    let i = 0;
    while (i < css.length) {
        if (css.startsWith('/*', i)) {
            const end = css.indexOf('*/', i + 2);
            i = end === -1 ? css.length : end + 2;
            continue;
        }
        const ch = css[i];
        if (ch === '"' || ch === "'") {
            let j = i + 1;
            while (j < css.length && css[j] !== ch) j += css[j] === '\\' ? 2 : 1;
            i = j + 1;
            continue;
        }
        out += ch;
        i += 1;
    }
    return out;
}

const SHEETS = stylesheets();

test('there are stylesheets to check', () => {
    assert.ok(SHEETS.length > 5, `only found ${SHEETS.length} stylesheets`);
});

for (const sheet of SHEETS) {
    const name = path.relative(STATIC, sheet);

    test(`${name}: every block is closed`, () => {
        const css = structuralOnly(readFileSync(sheet, 'utf8'));
        let depth = 0;
        let line = 1;
        let deepestLine = 1;
        for (let i = 0; i < css.length; i += 1) {
            if (css[i] === '\n') line += 1;
            else if (css[i] === '{') {
                if (depth === 0) deepestLine = line;
                depth += 1;
            } else if (css[i] === '}') {
                depth -= 1;
                assert.ok(
                    depth >= 0,
                    `${name}:${line} closes a block that was never opened -- `
                    + 'an edit above here has removed an opening brace',
                );
            }
        }
        assert.equal(
            depth, 0,
            `${name} ends inside an unclosed block opened at line ${deepestLine}. `
            + 'The browser will swallow every rule after it, silently.',
        );
    });

    test(`${name}: every comment is closed`, () => {
        const css = readFileSync(sheet, 'utf8');
        let i = 0;
        let opens = 0;
        while ((i = css.indexOf('/*', i)) !== -1) {
            const end = css.indexOf('*/', i + 2);
            assert.notEqual(
                end, -1,
                `${name} has an unterminated comment at offset ${i} -- `
                + 'everything after it is commented out',
            );
            opens += 1;
            i = end + 2;
        }
        assert.ok(opens >= 0);
    });

    test(`${name}: no declaration is stranded between rules`, () => {
        // A declaration sitting at depth 0 is the signature of the accident
        // above: the rule that used to contain it lost its opening brace, or
        // the rule before it lost its closing one.
        const css = structuralOnly(readFileSync(sheet, 'utf8'));
        let depth = 0;
        let line = 1;
        let buffer = '';
        for (let i = 0; i < css.length; i += 1) {
            const ch = css[i];
            if (ch === '\n') line += 1;
            if (ch === '{') { depth += 1; buffer = ''; continue; }
            if (ch === '}') { depth -= 1; buffer = ''; continue; }
            if (depth > 0) continue;
            if (ch === ';') {
                const stranded = buffer.trim();
                // An @import/@charset/@layer statement legitimately ends in `;`
                // at the top level; a `property: value` pair does not.
                const isAtRule = stranded.startsWith('@');
                assert.ok(
                    isAtRule || !/^[-a-zA-Z]+\s*:/.test(stranded),
                    `${name}:${line} has a declaration outside any rule `
                    + `(${JSON.stringify(stranded.slice(0, 60))}) -- a brace has gone missing`,
                );
                buffer = '';
                continue;
            }
            buffer += ch;
        }
    });
}
