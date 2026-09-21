/**
 * Regression tests for issue #1108 (part of epic #1090): the whiteboard
 * outline panel's per-row add/remove control. A task with no note on the
 * board gets a "+" ("add to board"); a task that already has one gets a
 * "−" in the exact same slot instead ("remove from board") -- the two
 * states of one toggle, never two separate controls.
 *
 * Covers the two pure/dispatchable pieces whiteboard-outline.js splits the
 * toggle into (see its own header comment and wbBuildOutlineRow()):
 *  - wbOutlineBoardToggleAction(onBoard): the plain decision, no DOM.
 *  - wbOutlineBoardToggleClicked(taskName, onBoard): dispatches to
 *    wbRemoveNoteFromBoard() or wbCommitAddNotes() -- the exact same
 *    functions the note header's own "Remove from board" menu item and
 *    the Add-note picker's "Add" button already call, so this is never a
 *    second implementation of either action.
 *  - wbBuildOutlineRow()'s own source: asserts the class/label/glyph the
 *    button gets in each state (a full DOM lift of this function is out of
 *    scope here -- it also builds the drag handle, percentage badge, etc.
 *    unrelated to #1108 -- so this reads the relevant branch directly,
 *    the same "assert the source shape" approach
 *    tests/test_track_raid_type_presets.mjs uses for a config table).
 *
 * Run with: node --test tests/test_whiteboard_outline_toggle.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const staticDir = join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'static');
const outlineSrc = readFileSync(join(staticDir, 'whiteboard-outline.js'), 'utf8');

/** Top-level `function name(` ... `\n}` declarations from a classic script,
 * lifted into a sandboxed vm context (same helper as
 * tests/test_whiteboard_dep_noodles.mjs / tests/test_baseline_dialog.mjs). */
function liftFunctions(sandbox, source, names) {
    for (const name of names) {
        const start = source.indexOf(`\nfunction ${name}(`);
        assert.notEqual(start, -1, `${name} not found`);
        const end = source.indexOf('\n}\n', start);
        assert.notEqual(end, -1, `${name} has no closing brace at column 0`);
        vm.runInNewContext(source.slice(start, end + 3), sandbox);
    }
    return sandbox;
}

/** Arrays built by code running inside the vm sandbox come from a
 * different realm than this file's own literals, which makes strict
 * assert.deepEqual report "same structure but not reference-equal" even
 * when every value matches (same gotcha as tests/test_baseline_dialog.mjs).
 * Round-trip through JSON to compare plain values instead. */
function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

function makeSandbox(overrides = {}) {
    const calls = { removed: [], added: [] };
    const sandbox = {
        wbRemoveNoteFromBoard: (name) => { calls.removed.push(name); return true; },
        wbCommitAddNotes: (names) => { calls.added.push(names); return true; },
        ...overrides,
    };
    liftFunctions(sandbox, outlineSrc, ['wbOutlineBoardToggleAction', 'wbOutlineBoardToggleClicked']);
    return { sandbox, calls };
}

test('wbOutlineBoardToggleAction: onBoard=true is "remove", onBoard=false is "add"', () => {
    const { sandbox } = makeSandbox();
    assert.equal(sandbox.wbOutlineBoardToggleAction(true), 'remove');
    assert.equal(sandbox.wbOutlineBoardToggleAction(false), 'add');
});

test('wbOutlineBoardToggleClicked(name, true) calls wbRemoveNoteFromBoard(name), never wbCommitAddNotes', () => {
    const { sandbox, calls } = makeSandbox();
    const result = sandbox.wbOutlineBoardToggleClicked('Design the API', true);
    assert.equal(result, true);
    assert.deepEqual(calls.removed, ['Design the API']);
    assert.deepEqual(calls.added, []);
});

test('wbOutlineBoardToggleClicked(name, false) calls wbCommitAddNotes([name]), never wbRemoveNoteFromBoard', () => {
    const { sandbox, calls } = makeSandbox();
    const result = sandbox.wbOutlineBoardToggleClicked('Write the tests', false);
    assert.equal(result, true);
    assert.deepEqual(plain(calls.added), [['Write the tests']]);
    assert.deepEqual(calls.removed, []);
});

test('wbOutlineBoardToggleClicked tolerates a missing target function (returns false, does not throw)', () => {
    const { sandbox: removeSandbox } = makeSandbox({ wbRemoveNoteFromBoard: undefined });
    assert.equal(removeSandbox.wbOutlineBoardToggleClicked('X', true), false);

    const { sandbox: addSandbox } = makeSandbox({ wbCommitAddNotes: undefined });
    assert.equal(addSandbox.wbOutlineBoardToggleClicked('X', false), false);
});

test('wbBuildOutlineRow keeps the one-slot toggle, now glyphed by wbOutlineSetToggleGlyph', () => {
    const m = outlineSrc.match(/const toggle = document\.createElement\('button'\);[\s\S]*?el\.appendChild\(toggle\);/);
    assert.ok(m, 'could not find the outline row toggle button block');
    assert.match(m[0], /className = 'wb-outline-add' \+ \(row\.onBoard \? ' wb-outline-remove' : ''\)/);
    assert.match(m[0], /wbOutlineSetToggleGlyph\(toggle, row\.onBoard\)/);
    // The labels say pin/unpin now (#1291), not add/remove.
    assert.match(m[0], /Unpin "\$\{row\.name\}" from the board/);
    assert.match(m[0], /Pin "\$\{row\.name\}" to the board/);
});

// ── #1291: the toggle's glyphs ──────────────────────────────────────────

/** A button stand-in with just the two properties the glyph setter writes. */
function fakeButton() {
    return { innerHTML: '', textContent: '' };
}

function glyphSandbox(markup) {
    const sandbox = { globalThis: null };
    sandbox.globalThis = sandbox;
    if (markup !== undefined) sandbox.NoodleNoteMarkup = markup;
    liftFunctions(sandbox, outlineSrc, ['wbOutlineSetToggleGlyph']);
    return sandbox;
}

test('wbOutlineSetToggleGlyph paints the shared pin glyph, struck through when on the board', () => {
    const sandbox = glyphSandbox({
        pinGlyph: (size) => `<svg data-pin="${size}"></svg>`,
        unpinGlyph: (size) => `<svg data-unpin="${size}"></svg>`,
    });

    const add = fakeButton();
    sandbox.wbOutlineSetToggleGlyph(add, false);
    assert.equal(add.innerHTML, '<svg data-pin="13"></svg>');
    assert.equal(add.textContent, '', 'the glyph replaces the "+", it does not sit beside it');

    const remove = fakeButton();
    sandbox.wbOutlineSetToggleGlyph(remove, true);
    assert.equal(remove.innerHTML, '<svg data-unpin="13"></svg>');
});

test('wbOutlineSetToggleGlyph falls back to +/- when the note-markup module never loaded', () => {
    const sandbox = glyphSandbox(undefined);

    const add = fakeButton();
    sandbox.wbOutlineSetToggleGlyph(add, false);
    assert.equal(add.textContent, '+');
    assert.equal(add.innerHTML, '');

    const remove = fakeButton();
    sandbox.wbOutlineSetToggleGlyph(remove, true);
    assert.equal(remove.textContent, '−');
});

test('index.html/whiteboard.css: the remove state has its own hover styling distinct from add', () => {
    const cssSrc = readFileSync(join(staticDir, 'views', 'whiteboard.css'), 'utf8');
    assert.match(cssSrc, /\.wb-outline-remove:hover\s*\{/, 'no distinct hover style for the remove state of the toggle');
});
