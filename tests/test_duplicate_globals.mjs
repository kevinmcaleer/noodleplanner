/**
 * No two top-level function declarations share a name across the classic
 * scripts a page loads.
 *
 * The app has no bundler: index.html loads ~85 classic <script>s that share
 * one global scope, so a `function name()` declared at the top level of two
 * files is not an error -- the one loaded later silently replaces the other
 * for every caller, in every file. That is how views-tables.js's
 * startInlineRename(cell, shortname) (the Resources table's shortname
 * rename) came to be replaced by portfolio-projects-table.js's
 * startInlineRename(projectId, cellElement), so double-clicking a
 * shortname threw instead of renaming it; and how four escapeHtml()s
 * competed. A second declaration inside one file behaves the same way (the
 * later one wins), and is caught too.
 *
 * Top-level here means `function` at column 0, the house style for a
 * top-level declaration (functions nested in an IIFE or a class are
 * indented, and are not globals).
 *
 * Run with: node --test tests/test_duplicate_globals.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const staticDir = join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'static');
const templatesDir = join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'templates');

// Files whose whole purpose is to replace functions an earlier script on the
// same page declared. collab_join.html loads script.js and kanban.js for
// their helpers, then collab-join.js stubs out or redirects the parts of
// them the joiner page has no use for (see collab-join.js's header).
const DELIBERATE_OVERRIDES = new Set(['collab-join.js']);

// Names still declared twice that this check knows about. Keep this empty:
// an entry here is a bug that has not been fixed yet, not an exemption.
//
// wbClientToBoard: whiteboard-groups.js and whiteboard-noodles.js each
// declare one; the noodles copy (loaded later) is the one that runs. Left
// for a change to the whiteboard scripts to remove.
const KNOWN_DUPLICATES = new Set(['wbClientToBoard']);

/** The classic (non-module) /static scripts a template loads, in order. */
function classicScripts(template) {
  const html = readFileSync(join(templatesDir, template), 'utf8');
  return [...html.matchAll(/<script\b([^>]*)\bsrc="\/static\/([^"?]+)/g)]
    .filter(m => !/type="module"/.test(m[1]))
    .map(m => m[2]);
}

/** name -> the files declaring it, in load order (a file once per declaration). */
function topLevelFunctions(files) {
  const declared = new Map();
  for (const file of files) {
    const source = readFileSync(join(staticDir, file), 'utf8');
    for (const m of source.matchAll(/^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/gm)) {
      if (!declared.has(m[1])) declared.set(m[1], []);
      declared.get(m[1]).push(file);
    }
  }
  return declared;
}

function duplicates(template) {
  const found = [];
  for (const [name, files] of topLevelFunctions(classicScripts(template))) {
    if (files.length < 2 || KNOWN_DUPLICATES.has(name)) continue;
    if (DELIBERATE_OVERRIDES.has(files[files.length - 1])) continue;
    found.push(`${name}: ${files.join(', ')}`);
  }
  return found;
}

test('index.html loads the classic scripts this check scans', () => {
  const scripts = classicScripts('index.html');
  assert.ok(scripts.length > 50, `only found ${scripts.length} scripts`);
  assert.ok(scripts.includes('script.js') && scripts.includes('views-tables.js'));
});

for (const template of ['index.html', 'collab_join.html']) {
  test(`${template}: no top-level function is declared twice`, () => {
    assert.deepEqual(duplicates(template), []);
  });
}

test('every known duplicate is still a duplicate (drop it from the list once fixed)', () => {
  const declared = topLevelFunctions(classicScripts('index.html'));
  for (const name of KNOWN_DUPLICATES) {
    assert.ok((declared.get(name) || []).length > 1, `${name} is no longer duplicated`);
  }
});
