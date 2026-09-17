/**
 * <np-resource-stack> derives initials the way the app does (#1246/#1199).
 *
 * The app had four implementations of one algorithm -- wbGetInitials()
 * (whiteboard-notes.js), tpGetInitials() (task-peek.js, which delegates to the
 * first when it is loaded and duplicates the body when it is not),
 * KanbanBoard.getInitials() (kanban.js) and getResourceInitials()
 * (script.js) -- and the two pilot components sidestepped it entirely by
 * taking pre-computed initials as a string attribute.
 *
 * When <np-note> grew a copy during #1242 it drifted immediately and quietly:
 * it took the first *two* words where the app takes the first and the *last*,
 * so "Mary Jane Watson" came out MJ here and MW on the board. Nothing caught
 * it, because nothing compared them. This does.
 *
 * Source-level rather than DOM-level for the same reason
 * tests/test_np_note_fidelity.mjs is: there is no jsdom in this repo, and the
 * thing worth pinning is that one algorithm is in use, not that a custom
 * element upgrades.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATIC = join(HERE, '../packages/noodle-web/src/noodle_web/static');

/** wbGetInitials() lifted out of whiteboard-notes.js and run for real, rather
 * than re-typed here -- a re-typed copy would be a fifth implementation. */
function appInitials() {
    const source = readFileSync(join(STATIC, 'whiteboard-notes.js'), 'utf8');
    const start = source.indexOf('function wbGetInitials(');
    assert.notEqual(start, -1, 'wbGetInitials() not found -- renamed?');
    const open = source.indexOf('{', start);
    let depth = 0;
    let end = -1;
    for (let i = open; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) { end = i + 1; break; }
    }
    const context = { module: {} };
    vm.createContext(context);
    vm.runInContext(`${source.slice(start, end)}; module.fn = wbGetInitials;`, context);
    return context.module.fn;
}

const { initialsFor } = await import(
    join(STATIC, 'components/resource-stack/initials.js')
);

// The awkward cases, which is where the copies disagreed.
const NAMES = [
    'Sam Smith',
    'Jo Lee',
    // Three words: first + last, not first + second. This is the one <np-note>
    // got wrong.
    'Mary Jane Watson',
    'Jean-Luc Picard',
    'Cher',
    'X',
    '',
    '   ',
    'sam smith',
    'de la Cruz',
];

test('the component derives the same initials as the app, name for name', () => {
    const app = appInitials();
    const mismatches = NAMES
        .map((name) => ({ name, app: app(name), component: initialsFor(name) }))
        .filter((r) => r.app !== r.component);
    assert.deepEqual(
        mismatches, [],
        'the component and whiteboard-notes.js disagree: '
        + mismatches.map((m) => `${JSON.stringify(m.name)} -> ${m.app} vs ${m.component}`).join(', ')
    );
});

test('a three-word name takes the first and last initial', () => {
    // Spelled out on its own because it is the specific drift this file exists
    // for, and a corpus comparison passes trivially if both sides are wrong.
    assert.equal(initialsFor('Mary Jane Watson'), 'MW');
});

test('an empty name is a question mark rather than a crash', () => {
    assert.equal(initialsFor(''), '?');
    assert.equal(initialsFor(null), '?');
    assert.equal(initialsFor(undefined), '?');
});

test('nothing else derives initials inside the note component any more', () => {
    const note = readFileSync(join(STATIC, 'components/note/np-note.js'), 'utf8');
    assert.ok(
        !/function getInitials|getInitials\s*=/.test(note),
        'np-note.js has grown its own initials implementation again'
    );
});
