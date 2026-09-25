/**
 * The genie pin's geometry (whiteboard-genie.js): the funnel polygon that
 * carries a pinned task out of its row and into its new note.
 *
 * What the animation looks like is the Playwright suite's business
 * (tests/ui/test_whiteboard_genie.py); these pin the shape itself, which is
 * what makes it a genie rather than a box tween:
 *
 *  - every frame has the same number of points (so the Web Animations API
 *    can interpolate clip-path between keyframes at all);
 *  - it starts as nothing at the source surface's edge, is the row's own
 *    rect once slid out, and ends exactly on the note's rect;
 *  - mid-flight the leading edge is taller than the trailing one, with
 *    curved (not straight) top and bottom edges between;
 *  - a note landing to the *left* slides the drawer out leftwards.
 *
 * Run with: node --test tests/test_whiteboard_genie.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    wbGeniePolygon, wbGenieKeyframes, WB_GENIE_SLIDE_SHARE, WB_GENIE_EDGE_SAMPLES,
} = require('../packages/noodle-web/src/noodle_web/static/whiteboard-genie.js');

// A 200x28 row inside a note whose right edge is at x=260, pinned into a
// 220x160 note further right and a little lower.
const row = { left: 50, top: 100, right: 250, bottom: 128 };
const edgeX = 260;
const note = { left: 500, top: 150, right: 720, bottom: 310 };

const POINTS = 2 * (WB_GENIE_EDGE_SAMPLES + 1);

function bounds(points) {
    const xs = points.map(p => p[0]);
    const ys = points.map(p => p[1]);
    return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
}

function close(actual, expected, label) {
    for (const key of Object.keys(expected)) {
        assert.ok(Math.abs(actual[key] - expected[key]) < 0.01,
            `${label}: ${key} was ${actual[key]}, expected ${expected[key]}`);
    }
}

test('every frame has the same number of points', () => {
    for (let i = 0; i <= 20; i++) {
        assert.equal(wbGeniePolygon(i / 20, row, edgeX, note).length, POINTS);
    }
});

test('starts as a zero-width sliver at the source surface edge', () => {
    const b = bounds(wbGeniePolygon(0, row, edgeX, note));
    close(b, { left: edgeX, right: edgeX, top: row.top, bottom: row.bottom }, 't=0');
});

test('is the row, slid clear of the note, at the end of the slide', () => {
    const b = bounds(wbGeniePolygon(WB_GENIE_SLIDE_SHARE, row, edgeX, note));
    close(b, { left: edgeX, right: edgeX + 200, top: row.top, bottom: row.bottom }, 'slid out');
});

test('ends exactly on the new note', () => {
    const b = bounds(wbGeniePolygon(1, row, edgeX, note));
    close(b, note, 't=1');
});

test('mid-flight it is a funnel: taller leading edge, curved sides', () => {
    const points = wbGeniePolygon(0.6, row, edgeX, note);
    const topEdge = points.slice(0, WB_GENIE_EDGE_SAMPLES + 1);
    const bottomEdge = points.slice(WB_GENIE_EDGE_SAMPLES + 1).reverse();
    const height = i => bottomEdge[i][1] - topEdge[i][1];
    const last = WB_GENIE_EDGE_SAMPLES;
    assert.ok(height(last) > height(0) + 10, `lead ${height(last)} vs trail ${height(0)}`);

    // A straight edge would put the midpoint exactly halfway; smoothstep
    // bends it into the genie's neck.
    const mid = last / 2;
    const quarter = Math.round(last / 4);
    const straight = topEdge[0][1] + (topEdge[last][1] - topEdge[0][1]) * (quarter / last);
    assert.ok(Math.abs(topEdge[quarter][1] - straight) > 0.5, 'top edge is curved');
    assert.ok(topEdge[mid][0] > topEdge[0][0] && topEdge[mid][0] < topEdge[last][0]);
});

test('a note landing to the left slides the drawer out leftwards', () => {
    const leftNote = { left: -400, top: 80, right: -180, bottom: 240 };
    const leftEdge = 40;
    const slid = bounds(wbGeniePolygon(WB_GENIE_SLIDE_SHARE, row, leftEdge, leftNote));
    close(slid, { left: leftEdge - 200, right: leftEdge }, 'slid left');
    close(bounds(wbGeniePolygon(1, row, leftEdge, leftNote)), leftNote, 'lands left');
});

test('keyframes run 0..1 as polygon() clip-paths', () => {
    const frames = wbGenieKeyframes(row, edgeX, note, 10);
    assert.equal(frames.length, 11);
    assert.equal(frames[0].offset, 0);
    assert.equal(frames[10].offset, 1);
    for (const frame of frames) {
        assert.match(frame.clipPath, /^polygon\(.+\)$/);
        assert.equal(frame.clipPath.split(',').length, POINTS);
    }
});
