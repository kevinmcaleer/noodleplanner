// local-parse.js's parseFrontMatter() and the `settings:` block (#1409).
//
// The server's plan_service.parse_front_matter() returns the settings block
// as `settings: { key: value }`, which is what settings.js's
// applySettingsFromFrontMatter() reads. The local (browser) engine, on by
// default, read it as an empty list and left its keys loose at the top level,
// so no project setting -- the forms' peek mode, the board's and timeline's
// toggles -- was applied when a plan loaded.
//
// Run with: node --test tests/test_local_parse_front_matter.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseFrontMatter } from '../packages/noodle-web/src/noodle_web/static/engine/local-parse.js';

const PLAN = [
  '---',
  'title: Settings',
  'settings:',
  '  detail_peek: center',
  '  board_hide_completed: true',
  '  timeline_today: false',
  'resources:',
  '  - @alex: Alex Smith',
  'rag: green',
  '---',
  '',
  'Design 2d',
].join('\n');

test('the settings block is nested, as the server returns it', () => {
  const fm = parseFrontMatter(PLAN);
  assert.deepEqual(fm.settings, {
    detail_peek: 'center',
    board_hide_completed: true,
    timeline_today: false,
  });
  assert.equal(fm.detail_peek, undefined);
});

test('keys after the settings block are read as before', () => {
  const fm = parseFrontMatter(PLAN);
  assert.equal(fm.title, 'Settings');
  assert.deepEqual(fm.resources, ['@alex: Alex Smith']);
  assert.equal(fm.rag, 'green');
});

test('a plan with no settings block has no settings', () => {
  const fm = parseFrontMatter('---\ntitle: Plain\n---\n\nDesign 2d');
  assert.equal(fm.settings, undefined);
  assert.equal(fm.title, 'Plain');
});
