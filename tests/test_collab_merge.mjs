/**
 * The planning-session joiner's three-way merge (#1347,
 * static/collab-merge.js): how a joiner's unconfirmed whiteboard edit is
 * rebased onto a plan someone else has changed in the meantime.
 *
 * Run with: node --test tests/test_collab_merge.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { merge3, diffHunks } = require('../packages/noodle-web/src/noodle_web/static/collab-merge.js');

const PLAN = [
    'Launch',
    '    Design',
    '    Build',
    '',
    '---whiteboard---',
    '| Task | X | Y |',
    '| --- | --- | --- |',
    '| Design | 10 | 10 |',
    '| Build | 300 | 10 |',
].join('\n');

const edit = (text, from, to) => {
    assert.ok(text.includes(from), `fixture has ${from}`);
    return text.replace(from, to);
};

test('no change on one side takes the other', () => {
    const ours = edit(PLAN, '| Design | 10 | 10 |', '| Design | 50 | 60 |');
    assert.equal(merge3(PLAN, ours, PLAN), ours);
    assert.equal(merge3(PLAN, PLAN, ours), ours);
});

test('the same change on both sides is not a conflict', () => {
    const both = edit(PLAN, '    Build', '    Build it');
    assert.equal(merge3(PLAN, both, both), both);
});

test('moving two different notes keeps both moves', () => {
    const ours = edit(PLAN, '| Design | 10 | 10 |', '| Design | 50 | 60 |');
    const theirs = edit(PLAN, '| Build | 300 | 10 |', '| Build | 400 | 90 |');
    const merged = merge3(PLAN, ours, theirs);
    assert.ok(merged.includes('| Design | 50 | 60 |'));
    assert.ok(merged.includes('| Build | 400 | 90 |'));
});

test('a joiner rename survives the host typing a new task elsewhere', () => {
    const ours = edit(PLAN, '    Design', '    Design review');
    const theirs = edit(PLAN, '    Build', '    Build\n    Test');
    assert.equal(
        merge3(PLAN, ours, theirs),
        PLAN.replace('    Design', '    Design review').replace('    Build', '    Build\n    Test'),
    );
});

test('two people adding a note at once keeps both, theirs first', () => {
    const ours = PLAN + '\n| Mine | 1 | 1 |';
    const theirs = PLAN + '\n| Yours | 2 | 2 |';
    assert.equal(merge3(PLAN, ours, theirs), PLAN + '\n| Yours | 2 | 2 |\n| Mine | 1 | 1 |');
});

test('both changing the same line is a conflict', () => {
    const ours = edit(PLAN, '| Design | 10 | 10 |', '| Design | 50 | 60 |');
    const theirs = edit(PLAN, '| Design | 10 | 10 |', '| Design | 70 | 80 |');
    assert.equal(merge3(PLAN, ours, theirs), null);
});

test('an insertion inside a range the other side replaced is a conflict', () => {
    const base = 'a\nb\nc\nd';
    assert.equal(merge3(base, 'a\nb\nX\nc\nd', 'a\nB\nC\nd'), null);
});

test('diffHunks describes a replacement, an insertion and a deletion', () => {
    assert.deepEqual(diffHunks(['a', 'b', 'c'], ['a', 'B', 'c']), [{ start: 1, end: 2, lines: ['B'] }]);
    assert.deepEqual(diffHunks(['a', 'c'], ['a', 'b', 'c']), [{ start: 1, end: 1, lines: ['b'] }]);
    assert.deepEqual(diffHunks(['a', 'b', 'c'], ['a', 'c']), [{ start: 1, end: 2, lines: [] }]);
    assert.deepEqual(diffHunks(['a'], ['a']), []);
});

test('deleting a note while someone else moves another keeps both', () => {
    const ours = edit(PLAN, '| Design | 10 | 10 |\n', '');
    const theirs = edit(PLAN, '| Build | 300 | 10 |', '| Build | 1 | 2 |');
    const merged = merge3(PLAN, ours, theirs);
    assert.ok(!merged.includes('| Design | 10 | 10 |'));
    assert.ok(merged.includes('| Build | 1 | 2 |'));
});
