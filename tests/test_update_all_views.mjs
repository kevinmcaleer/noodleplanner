/**
 * updateAllViews() (script.js) runs each view's updater once per parse.
 *
 * Its `viewUpdates` list named the Benefits map twice, so every edit ran
 * updateBenefits() -- a full re-parse, re-render and zoom-to-fit of the
 * benefits diagram -- two times over.
 *
 * Run with: node --test tests/test_update_all_views.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const script = readFileSync(join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'static', 'script.js'), 'utf8');

/** The `{ name, fn }` entries of updateAllViews()'s viewUpdates list. */
function viewUpdates() {
  const start = script.indexOf('\nasync function updateAllViews(');
  assert.notEqual(start, -1, 'updateAllViews not found');
  const list = script.slice(script.indexOf('const viewUpdates = [', start));
  const body = list.slice(0, list.indexOf('\n        ];'));
  return [...body.matchAll(/\{ name: '([^']+)',\s*fn: (.*) \},?$/gm)].map(m => ({ name: m[1], fn: m[2] }));
}

test('updateAllViews() lists each view updater once', () => {
  const entries = viewUpdates();
  assert.ok(entries.length > 30, `only found ${entries.length} entries`);
  const repeated = (key) => entries.map(e => e[key]).filter((value, i, all) => all.indexOf(value) !== i);
  assert.deepEqual(repeated('name'), []);
  assert.deepEqual(repeated('fn'), []);
  assert.equal(entries.filter(e => e.fn.includes('updateBenefits(')).length, 1);
});
