/**
 * Saved board views (#1552): parse / write the Views: front-matter block.
 * Run with: node --test tests/test_board_views.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import BoardViews from '../packages/noodle-web/src/noodle_web/static/board-views.js';

const PLAN = `---
Title: Demo
Theme:
- Design: #112233
Views:
  - name: Must haves
    filter: "label:must -status:Complete"
  - name: Kev's open work
    filter: 'resource:Kev -status:Complete phase:"Phase 1"'
Resources:
- Kev: Kevin McAleer
---

# Plan

Body text.
`;

test('parses a Views block in order', () => {
  const { views, errors } = BoardViews.parseViews(PLAN);
  assert.deepEqual(errors, []);
  assert.deepEqual(views, [
    { name: 'Must haves', filter: 'label:must -status:Complete' },
    { name: "Kev's open work", filter: 'resource:Kev -status:Complete phase:"Phase 1"' },
  ]);
});

test('no front matter or no Views block gives no views', () => {
  assert.deepEqual(BoardViews.parseViews('# Plan').views, []);
  assert.deepEqual(BoardViews.parseViews('---\nTitle: x\n---\nbody').views, []);
  assert.deepEqual(BoardViews.parseViews(undefined).views, []);
});

test('write then parse round-trips awkward filters', () => {
  const views = [
    { name: 'Colon: and "quotes"', filter: 'phase:"Phase 1" -login' },
    { name: 'Back\\slash', filter: '' },
    { name: '#hash', filter: "it's" },
  ];
  const text = BoardViews.buildPlanTextWithViews('---\nTitle: x\n---\nbody', views);
  const parsed = BoardViews.parseViews(text);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.views, views);
});

test('rewriting leaves other keys and the body untouched', () => {
  const next = [{ name: 'Doing', filter: 'bucket:Doing' }];
  const out = BoardViews.buildPlanTextWithViews(PLAN, next);
  assert.ok(out.includes('Title: Demo\nTheme:\n- Design: #112233\n'));
  assert.ok(out.includes('Resources:\n- Kev: Kevin McAleer\n---\n\n# Plan\n\nBody text.\n'));
  assert.deepEqual(BoardViews.parseViews(out).views, next);
  assert.equal(out.match(/^Views:/gm).length, 1);
});

test('empty list removes the block', () => {
  const out = BoardViews.buildPlanTextWithViews(PLAN, []);
  assert.ok(!out.includes('Views:'));
  assert.ok(!out.includes('Must haves'));
  assert.ok(out.includes('Resources:'));
  assert.deepEqual(BoardViews.parseViews(out).views, []);
});

test('adds the block to front matter that lacks it, or creates front matter', () => {
  const v = [{ name: 'A', filter: 'x' }];
  const a = BoardViews.buildPlanTextWithViews('---\nTitle: x\n---\nbody', v);
  assert.equal(a, '---\nTitle: x\nViews:\n  - name: "A"\n    filter: "x"\n---\nbody');
  const b = BoardViews.buildPlanTextWithViews('# Plan\n', v);
  assert.ok(b.startsWith('---\nViews:\n'));
  assert.ok(b.endsWith('---\n\n# Plan\n'));
  assert.equal(BoardViews.buildPlanTextWithViews('# Plan\n', []), '# Plan\n');
});

test('writing is idempotent', () => {
  const { views } = BoardViews.parseViews(PLAN);
  const once = BoardViews.buildPlanTextWithViews(PLAN, views);
  assert.equal(BoardViews.buildPlanTextWithViews(once, views), once);
});

test('Views block as the only or last key', () => {
  const only = BoardViews.buildPlanTextWithViews('---\nViews:\n  - name: A\n    filter: x\n---\nbody', [{ name: 'B', filter: 'y' }]);
  assert.deepEqual(BoardViews.parseViews(only).views, [{ name: 'B', filter: 'y' }]);
  const emptied = BoardViews.buildPlanTextWithViews(only, []);
  assert.ok(!emptied.includes('Views') && emptied.endsWith('body'));
  assert.deepEqual(BoardViews.parseViews(emptied).views, []);
});

test('invalid entries are skipped and reported, never thrown', () => {
  const text = `---
Views:
  - filter: "label:x"
  - name: Dup
    filter: a
  - name: dup
    filter: b
  - name: Bad
    filter: "unterminated
  - name: Keep
    colour: red
    filter: ok
---
`;
  const { views, errors } = BoardViews.parseViews(text);
  assert.deepEqual(views, [{ name: 'Dup', filter: 'a' }, { name: 'Keep', filter: 'ok' }]);
  assert.equal(errors.length, 3);
});

test('writer refuses duplicate or empty names', () => {
  assert.throws(() => BoardViews.buildPlanTextWithViews('', [{ name: 'A', filter: '' }, { name: 'a', filter: '' }]));
  assert.throws(() => BoardViews.buildPlanTextWithViews('', [{ name: '  ', filter: '' }]));
});

test('handles CRLF files', () => {
  const crlf = '---\r\nTitle: x\r\nViews:\r\n  - name: A\r\n    filter: x\r\n---\r\nbody';
  assert.deepEqual(BoardViews.parseViews(crlf).views, [{ name: 'A', filter: 'x' }]);
  const out = BoardViews.buildPlanTextWithViews(crlf, [{ name: 'B', filter: 'y' }]);
  assert.ok(!/[^\r]\n/.test(out.split('body')[0]));
  assert.deepEqual(BoardViews.parseViews(out).views, [{ name: 'B', filter: 'y' }]);
});

test('moveView reorders and clamps at the ends', () => {
  const v = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
  assert.deepEqual(BoardViews.moveView(v, 1, -1).map((x) => x.name), ['b', 'a', 'c']);
  assert.deepEqual(BoardViews.moveView(v, 1, 1).map((x) => x.name), ['a', 'c', 'b']);
  assert.deepEqual(BoardViews.moveView(v, 0, -1).map((x) => x.name), ['a', 'b', 'c']);
  assert.deepEqual(BoardViews.moveView(v, 2, 1).map((x) => x.name), ['a', 'b', 'c']);
  assert.equal(v[0].name, 'a');
});

test('isNameAvailable is case-insensitive and can ignore the view being renamed', () => {
  const v = [{ name: 'Doing' }, { name: 'Done' }];
  assert.equal(BoardViews.isNameAvailable(v, 'doing'), false);
  assert.equal(BoardViews.isNameAvailable(v, 'Review'), true);
  assert.equal(BoardViews.isNameAvailable(v, ' '), false);
  assert.equal(BoardViews.isNameAvailable(v, 'DOING', 'Doing'), true);
});
