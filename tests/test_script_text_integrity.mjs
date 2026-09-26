/**
 * Every script the app ships is plain text: no raw NUL bytes.
 *
 * A literal NUL in a source file makes git treat the whole file as binary,
 * so its diffs show only "Binary files differ" -- unreviewable -- and grep
 * skips it without saying so. noodle-layout.js, smart-date-tags.js and
 * pptx-export.js each had one inside a string or regex literal, where the
 * `\u0000` escape means exactly the same character.
 *
 * Usage:
 *     node --test tests/test_script_text_integrity.mjs
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATIC = path.join(HERE, '..', 'packages', 'noodle-web', 'src', 'noodle_web', 'static');

function scripts(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...scripts(full));
    else if (/\.m?js$/.test(entry)) found.push(full);
  }
  return found;
}

test('no static script contains a raw NUL byte', () => {
  const offenders = scripts(STATIC)
    .filter((file) => readFileSync(file).includes(0))
    .map((file) => path.relative(STATIC, file));
  assert.deepEqual(offenders, [], 'write \\u0000 instead of a literal NUL');
});
