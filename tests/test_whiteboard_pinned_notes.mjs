/**
 * Regression tests for issue #1291: the whiteboard's notes are *pinned* to
 * the board, and every surface that puts one there or takes one off now says
 * so with the same pushpin.
 *
 * Four things this covers, each at the level it can actually be tested at
 * without a browser (the hover/slide behaviour itself is CSS, and the
 * Playwright suite is where a rendered note belongs):
 *
 *  - components/note/note-markup.js really exports the two glyphs, and the
 *    note header really carries a `.wb-note-pin-btn` -- built to the LEFT of
 *    the title, which is what lets the title slide over for it without the
 *    header's load-bearing right-hand cluster moving at all.
 *  - views/whiteboard.css hides that button at rest and reveals it on the
 *    card's hover/focus by animating its *width*, which is what makes the
 *    reveal a slide rather than a jump, plus the reduced-motion opt-out.
 *  - wbAddNotesViewport(): the pure placement rule behind "pin it at that
 *    position" -- a peek's pin anchors the free-space scan at the popover,
 *    an ordinary add still starts at the viewport.
 *  - wbPinTaskFromPeek(): dispatches to the same wbCommitAddNotes() every
 *    other pin control calls, with the popover's top-right corner converted
 *    to board space -- and still adds the note when there is no rect to convert.
 *
 * Run with: node --test tests/test_whiteboard_pinned_notes.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const staticDir = join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'static');
const notesSrc = readFileSync(join(staticDir, 'whiteboard-notes.js'), 'utf8');
const markupSrc = readFileSync(join(staticDir, 'components', 'note', 'note-markup.js'), 'utf8');
const peekSrc = readFileSync(join(staticDir, 'task-peek.js'), 'utf8');
const wbCss = readFileSync(join(staticDir, 'views', 'whiteboard.css'), 'utf8');
const peekCss = readFileSync(join(staticDir, 'task-peek.css'), 'utf8');

/** Top-level `function name(` ... `\n}` declarations lifted into a sandbox
 * (same helper as tests/test_whiteboard_outline_toggle.mjs). */
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

// ── The glyphs and the note's own pin ───────────────────────────────────

test('note-markup exports a pin and an unpin glyph, and hands both to the app', async () => {
    const markup = await import(join(staticDir, 'components', 'note', 'note-markup.js'));
    assert.equal(typeof markup.pinGlyph, 'function');
    assert.equal(typeof markup.unpinGlyph, 'function');

    const pin = markup.pinGlyph(13);
    const unpin = markup.unpinGlyph(13);
    assert.match(pin, /width="13" height="13"/);
    assert.match(pin, /stroke="currentColor"/,
        'the pin must inherit the surface ink, not carry a colour of its own');
    assert.ok(unpin.length > pin.length,
        'the unpin glyph is the pin plus its strike-through');
    assert.match(unpin, /M1\.6 1\.6 14\.4 14\.4/, 'no strike-through on the unpin glyph');

    // The board is a classic script and reaches them through this global.
    assert.match(markupSrc, /globalThis\.NoodleNoteMarkup = \{[\s\S]*?pinGlyph, unpinGlyph,/);
});

test('the note header builds the pin to the LEFT of the title', () => {
    assert.match(markupSrc, /el\('button', 'wb-note-pin-btn'/);
    const order = markupSrc.match(/header\.append\(([^)]*)\)/);
    assert.ok(order, 'could not find the header append');
    const children = order[1].split(',').map(s => s.trim());
    assert.equal(children[0], 'pinBtn', 'the pin is the header\'s first child');
    assert.equal(children[1], 'title');
    assert.equal(children[children.length - 1], 'linkHandle',
        'the link handle stays last -- see the header-geometry comment it protects');
});

test('the note pin unpins through the one shared removal path, and never starts a drag', () => {
    const wiring = notesSrc.match(/pinBtn\.addEventListener\('click'[\s\S]*?\}\);/);
    assert.ok(wiring, 'the pin button is not wired');
    assert.match(wiring[0], /wbRemoveNoteFromBoard\(taskName\)/,
        'the pin must reuse wbRemoveNoteFromBoard(), not reimplement removal');

    // Both press paths guard it, or a press on the pin drags or renames.
    const mouse = notesSrc.slice(notesSrc.indexOf('function wbNoteHeaderMouseDown('));
    const touch = notesSrc.slice(notesSrc.indexOf('function wbNoteHeaderTouchStart('));
    for (const [name, src] of [['mouse', mouse], ['touch', touch]]) {
        assert.match(src.slice(0, 1600), /closest\('\.wb-note-pin-btn'\)\) return;/,
            `the ${name} path does not skip the pin button`);
    }
});

test('whiteboard.css hides the note pin at rest and slides it open on hover/focus', () => {
    const rule = wbCss.match(/\.wb-note-pin-btn \{[\s\S]*?\}/);
    assert.ok(rule, 'no .wb-note-pin-btn rule');
    assert.match(rule[0], /width:\s*0;/, 'the pin must take no width at rest');
    assert.match(rule[0], /opacity:\s*0;/);
    assert.match(rule[0], /transition:[^;]*width/,
        'width is what is animated -- a display swap cannot slide');

    const reveal = wbCss.match(/\.wb-note-card:hover \.wb-note-pin-btn,[\s\S]*?\}/);
    assert.ok(reveal, 'the pin never becomes visible');
    assert.match(reveal[0], /\.wb-note-card:focus-within \.wb-note-pin-btn/,
        'keyboard users must get the pin too');
    assert.match(reveal[0], /width:\s*18px;/);

    assert.match(wbCss, /@media \(prefers-reduced-motion: reduce\) \{\s*\.wb-note-pin-btn \{\s*transition: none;/,
        'no reduced-motion opt-out for the slide');
});

// ── The peek's pin ──────────────────────────────────────────────────────

test('the peek renders a pin only when a caller supplies onPin, and disables it when already pinned', () => {
    assert.match(peekSrc, /typeof tpState\.onPin === 'function'/,
        'the peek must not assume a whiteboard exists');
    const block = peekSrc.match(/const pinBtn = document\.createElement\('button'\);[\s\S]*?header\.appendChild\(pinBtn\);/);
    assert.ok(block, 'no pin button in the peek header');
    assert.match(block[0], /className = 'task-peek-pin-btn'/);
    assert.match(block[0], /pinBtn\.disabled = true;/,
        'a task already on the board must not be pinnable a second time');
    assert.match(block[0], /getBoundingClientRect\(\)/,
        'the pin must pass the popover position through');
    assert.match(block[0], /tpClose\(\);\s*\n\s*if \(typeof onPin === 'function'\) onPin\(task, rect\);/,
        'the peek closes before pinning, so the new note is not hidden under it');

    assert.match(peekCss, /\.task-peek-pin-btn \{/);
    assert.match(peekCss, /\.task-peek-pin-btn:disabled \{/);
});

test('wbAddNotesViewport re-anchors the free-space scan at a pin point, and only then', () => {
    const sandbox = liftFunctions({
        wbCurrentViewportBoardRect: () => ({ x: 100, y: 50, width: 900, height: 600 }),
    }, notesSrc, ['wbAddNotesViewport']);

    const plain = sandbox.wbAddNotesViewport(null);
    assert.deepEqual({ ...plain }, { x: 100, y: 50, width: 900, height: 600 });

    const at = sandbox.wbAddNotesViewport({ x: 420, y: 380 });
    assert.deepEqual({ ...at }, { x: 420, y: 380, width: 900, height: 600 },
        'the point moves the origin and keeps the size, so a taken spot still resolves on screen');

    // Junk in, viewport out -- never NaN coordinates in the plan file.
    assert.deepEqual({ ...sandbox.wbAddNotesViewport({ x: NaN, y: 3 }) },
        { x: 100, y: 50, width: 900, height: 600 });
});

test('wbPinTaskFromPeek adds through wbCommitAddNotes, at the popover in board coordinates', () => {
    const calls = [];
    const sandbox = liftFunctions({
        wbClientToBoard: (x, y) => ({ x: x * 2, y: y * 2 }), // stands in for pan/zoom
        wbCommitAddNotes: (names, options) => { calls.push({ names, options }); return true; },
    }, notesSrc, ['wbPinTaskFromPeek']);

    assert.equal(sandbox.wbPinTaskFromPeek('Draft the brief', { right: 30, top: 40 }), true);
    assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{
        names: ['Draft the brief'],
        options: { at: { x: 60, y: 80 } },
    }]);

    // No rect (or no converter): still pin it, just at the usual free space.
    calls.length = 0;
    sandbox.wbPinTaskFromPeek('Draft the brief', null);
    assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ names: ['Draft the brief'], options: {} }]);

    calls.length = 0;
    assert.equal(sandbox.wbPinTaskFromPeek('', { right: 1, top: 1 }), false);
    assert.deepEqual(calls, [], 'a nameless task is never pinned');
});

test('wbTaskIsOnBoard reads the plan text, case-insensitively', () => {
    const sandbox = liftFunctions({
        document: { getElementById: () => ({ value: 'plan text' }) },
        extractWhiteboardFromPlanText: (text) => text,
        parseWhiteboardMarkdown: () => ([{ task: 'Discovery' }, { task: 'Build' }]),
    }, notesSrc, ['wbTaskIsOnBoard']);

    assert.equal(sandbox.wbTaskIsOnBoard('discovery'), true);
    assert.equal(sandbox.wbTaskIsOnBoard('Build'), true);
    assert.equal(sandbox.wbTaskIsOnBoard('Close down'), false);
    assert.equal(sandbox.wbTaskIsOnBoard(''), false);
});
