/**
 * Board filter query (#1542): parse, match, suggest.
 * Run with: node --test tests/test_board_filter.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import BoardFilter from '../packages/noodle-web/src/noodle_web/static/board-filter.js';

const task = (over) => ({
  name: 'Build login page', comment: '', labelsArray: [], resourceShortnames: [],
  resourcesArray: [], bucket: '', phase: 'Design', progressStatus: 'not_started', ...over,
});
const run = (q, t) => BoardFilter.matches(t, BoardFilter.parse(q));

test('empty query matches everything', () => {
  assert.equal(run('', task()), true);
  assert.equal(run('   ', task()), true);
});

test('keyword matches name and comment, case-insensitively', () => {
  assert.equal(run('LOGIN', task()), true);
  assert.equal(run('payment', task()), false);
  assert.equal(run('payment', task({ comment: 'blocked on Payment gateway' })), true);
});

test('label qualifier, with comma OR', () => {
  const t = task({ labelsArray: ['must', 'ui'] });
  assert.equal(run('label:must', t), true);
  assert.equal(run('label:should', t), false);
  assert.equal(run('label:should,ui', t), true);
  assert.equal(run('labels:MUST', t), true);
});

test('leading - excludes', () => {
  const done = task({ progressStatus: 'complete' });
  assert.equal(run('-status:Complete', done), false);
  assert.equal(run('-status:Complete', task()), true);
  assert.equal(run('-login', task()), false);
  assert.equal(run('-label:a,b', task({ labelsArray: ['b'] })), false);
});

test('status accepts names and aliases', () => {
  assert.equal(run('status:"In progress"', task({ progressStatus: 'in_progress' })), true);
  assert.equal(run('status:in-progress', task({ progressStatus: 'in_progress' })), true);
  assert.equal(run('status:done', task({ progressStatus: 'complete' })), true);
  assert.equal(run('status:notstarted', task()), true);
});

test('resource matches shortname or full name, with or without @', () => {
  const t = task({ resourceShortnames: ['kev'], resourcesArray: ['Kevin McAleer'] });
  assert.equal(run('resource:kev', t), true);
  assert.equal(run('resource:@kev', t), true);
  assert.equal(run('resource:"Kevin McAleer"', t), true);
  assert.equal(run('resource:jen', t), false);
});

test('bucket and phase, including quoted values and no bucket', () => {
  assert.equal(run('phase:design', task()), true);
  assert.equal(run('phase:"Phase 1"', task({ phase: 'Phase 1' })), true);
  assert.equal(run('bucket:Doing', task({ bucket: 'Doing' })), true);
  assert.equal(run('bucket:none', task()), true);
  assert.equal(run('bucket:none', task({ bucket: 'Doing' })), false);
});

test('terms combine with AND', () => {
  const t = task({ labelsArray: ['must'], phase: 'Design' });
  assert.equal(run('label:must phase:Design login', t), true);
  assert.equal(run('label:must phase:Build', t), false);
});

test('unknown keys and statuses are reported, not applied', () => {
  const p = BoardFilter.parse('foo:bar status:wibble login');
  assert.equal(p.errors.length, 2);
  assert.equal(p.terms.length, 1);
  assert.equal(BoardFilter.parse('label:').terms.length, 0); // still being typed
});

test('suggests qualifier keys at the start of a term', () => {
  const all = BoardFilter.suggest('', 0, {});
  assert.deepEqual(all.items.map(i => i.insert), ['label:', 'status:', 'bucket:', 'resource:', 'phase:']);
  assert.deepEqual(BoardFilter.suggest('re', 2, {}).items.map(i => i.insert), ['resource:']);
  assert.deepEqual(BoardFilter.suggest('-st', 3, {}).items.map(i => i.insert), ['-status:']);
  assert.equal(BoardFilter.suggest('login ', 6, {}).items.length, 5);
});

test('suggests values valid for the chosen key', () => {
  const vocab = BoardFilter.buildVocab([
    task({ labelsArray: ['must', 'ui'], phase: 'Design', resourceShortnames: ['kev'], resourcesArray: ['Kevin'] }),
  ], { phases: ['Build'] });
  const s = BoardFilter.suggest('label:', 6, vocab);
  assert.deepEqual(s.items.map(i => i.label), ['must', 'ui']);
  assert.deepEqual(BoardFilter.suggest('status:', 7, vocab).items.map(i => i.label),
    ['Not started', 'In progress', 'Complete']);
  assert.deepEqual(BoardFilter.suggest('phase:', 6, vocab).items.map(i => i.label), ['Build', 'Design']);
  assert.equal(BoardFilter.suggest('resource:', 9, vocab).items[0].description, 'Kevin');
});

test('value suggestions narrow, quote spaces and skip values already chosen', () => {
  const vocab = { phase: ['Phase 1', 'Phase 2', 'Design'], label: ['must', 'should'] };
  const q = BoardFilter.suggest('phase:ph', 8, vocab);
  assert.deepEqual(q.items.map(i => i.insert), ['phase:"Phase 1"', 'phase:"Phase 2"']);
  const more = BoardFilter.suggest('-label:must,s', 13, vocab);
  assert.deepEqual(more.items.map(i => i.insert), ['-label:must,should']);
  assert.deepEqual(BoardFilter.suggest('label:must,', 11, vocab).items.map(i => i.label), ['should']);
});

test('suggestions replace only the token under the caret', () => {
  const s = BoardFilter.suggest('login la phase:Design', 8, {});
  assert.equal(s.from, 6);
  assert.equal(s.to, 8);
  assert.deepEqual(s.items.map(i => i.insert), ['label:']);
});
