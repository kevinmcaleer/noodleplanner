/**
 * A planning-session joiner's undo and redo (static/collab-undo.js): each
 * step reverses only the joiner's own edit, on top of whatever the host and
 * other joiners have done since.
 *
 * Run with: node --test tests/test_collab_undo.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createHistory } = require('../packages/noodle-web/src/noodle_web/static/collab-undo.js');

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

test('an empty history has nothing to undo or redo', () => {
    const history = createHistory();
    assert.equal(history.canUndo(), false);
    assert.equal(history.canRedo(), false);
    assert.equal(history.undo(PLAN), null);
    assert.equal(history.redo(PLAN), null);
});

test('undo and redo walk the joiner’s own edits', () => {
    const history = createHistory();
    const moved = edit(PLAN, '| Design | 10 | 10 |', '| Design | 50 | 60 |');
    const renamed = edit(moved, '    Build', '    Build it');
    history.record(PLAN, moved);
    history.record(moved, renamed);

    assert.deepEqual(history.undo(renamed), { text: moved });
    assert.deepEqual(history.undo(moved), { text: PLAN });
    assert.equal(history.canUndo(), false);
    assert.deepEqual(history.redo(PLAN), { text: moved });
    assert.deepEqual(history.redo(moved), { text: renamed });
    assert.equal(history.canRedo(), false);
});

test('undo keeps what someone else changed since', () => {
    const history = createHistory();
    const mine = edit(PLAN, '| Design | 10 | 10 |', '| Design | 50 | 60 |');
    history.record(PLAN, mine);
    const theirs = edit(mine, '| Build | 300 | 10 |', '| Build | 400 | 20 |');

    const undone = history.undo(theirs);
    assert.equal(undone.text, edit(PLAN, '| Build | 300 | 10 |', '| Build | 400 | 20 |'));
    assert.equal(history.redo(undone.text).text, theirs);
});

test('undoing an added note leaves notes others added', () => {
    const history = createHistory();
    const mine = `${PLAN}\n| Test | 500 | 10 |`;
    history.record(PLAN, mine);
    const theirs = edit(mine, '    Build', '    Build\n    Ship');

    assert.equal(history.undo(theirs).text, edit(PLAN, '    Build', '    Build\n    Ship'));
});

test('a step someone has since overwritten is reported and dropped', () => {
    const history = createHistory();
    const first = edit(PLAN, '    Build', '    Build it');
    const mine = edit(first, '| Design | 10 | 10 |', '| Design | 50 | 60 |');
    history.record(PLAN, first);
    history.record(first, mine);
    const theirs = edit(mine, '| Design | 50 | 60 |', '| Design | 90 | 90 |');

    assert.deepEqual(history.undo(theirs), { conflict: true });
    assert.equal(history.canRedo(), false);
    // The older step is untouched by the clash, and still undoes.
    assert.equal(history.undo(theirs).text, edit(theirs, '    Build it', '    Build'));
});

test('a new edit clears the redo trail', () => {
    const history = createHistory();
    const mine = edit(PLAN, '    Build', '    Build it');
    history.record(PLAN, mine);
    history.undo(mine);
    assert.equal(history.canRedo(), true);
    history.record(PLAN, edit(PLAN, '    Design', '    Design it'));
    assert.equal(history.canRedo(), false);
});

test('a no-op edit is not recorded, and the history is capped', () => {
    const history = createHistory({ limit: 2 });
    history.record(PLAN, PLAN);
    assert.equal(history.canUndo(), false);
    let text = PLAN;
    for (const n of [1, 2, 3]) {
        const next = `${text}\n| Note ${n} | 0 | 0 |`;
        history.record(text, next);
        text = next;
    }
    assert.ok(history.undo(text));
    assert.ok(history.undo(text));
    assert.equal(history.undo(text), null);
});

test('clear forgets everything', () => {
    const history = createHistory();
    history.record(PLAN, `${PLAN}\nx`);
    history.clear();
    assert.equal(history.canUndo(), false);
    assert.equal(history.canRedo(), false);
});
