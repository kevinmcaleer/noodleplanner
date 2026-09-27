/**
 * Regression tests for kevinmcaleer/Snakie#978: the comms plan section
 * could leak into the RAID log view.
 *
 * Root cause: `extractRaidLogFromPlanText` in static/script.js (the
 * client-side function that backs the RAID tab's "parse from plan text"
 * fallback) only stopped at `---budget---` or `---baseline---`. In the
 * canonical write order a `---comms---` section (and, further down,
 * `---lessons learned---`) follows the RAID log directly, so whenever a
 * plan had a comms section but no budget/baseline section after the RAID
 * log, the whole comms block -- marker and table included -- was swept
 * into the extracted "RAID log" text. `parseRaidMarkdown` then happily
 * parsed the comms table's rows (its header includes "ID", one of the
 * keywords `parseRaidMarkdown` looks for) as bogus RAID items, so comms
 * activities showed up in the risk/issues log.
 *
 * The Python equivalent (`extract_raid_log` in format_converter.py) and
 * the *other* JS RAID/comms helpers (`updatePlanRaidLogText`,
 * `updatePlanCommsText`) already stopped correctly at every later section
 * marker -- only this one duplicate implementation had a stale list.
 *
 * Run with: node --test tests/test_raid_comms_section_collision.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import backMatter from '../packages/noodle-web/src/noodle_web/static/back-matter-markers.js';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const staticDir = join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'static');

/** Top-level `function name(` ... `\n}` declarations from a classic script. */
function liftFunctions(sandbox, file, names) {
  const source = readFileSync(join(staticDir, file), 'utf8');
  for (const name of names) {
    const start = source.indexOf(`\nfunction ${name}(`);
    assert.notEqual(start, -1, `${name} not found in ${file}`);
    const end = source.indexOf('\n}\n', start);
    assert.notEqual(end, -1, `${name} in ${file} has no closing brace at column 0`);
    vm.runInNewContext(source.slice(start, end + 3), sandbox);
  }
  return sandbox;
}

// The section-marker constants normally come from state.js (loaded before
// script.js in index.html). Seed them directly rather than lifting the
// whole file, since these are simple string literals.
const sandbox = {
  // The canonical back-matter marker list and section-boundary helpers,
  // from back-matter-markers.js (loaded before state.js in index.html).
  ...backMatter,
  BUDGET_START: '---budget---',
  RAID_LOG_START: '---raid log---',
  COMMS_START: '---comms---',
  BASELINE_START: '---baseline---',
  BENEFITS_START: '---benefits---',
  LESSONS_START: '---lessons learned---',
  WHITEBOARD_START: '---whiteboard---',
};

liftFunctions(sandbox, 'script.js', [
  'extractRaidLogFromPlanText',
  'parseRaidMarkdown',
  'extractRaidItemsFromPlanText',
]);

const { extractRaidLogFromPlanText, extractRaidItemsFromPlanText } = sandbox;

const RAID_TABLE = [
  '| ID | Type | Title       | Description | Raised By | Owner | Mitigation Actions | Impact | Likelihood | Score | Status | Priority | Target Date |',
  '|----|------|-------------|-------------|-----------|-------|---------------------|--------|------------|-------|--------|----------|-------------|',
  '| 1  | risk | Server down | Outage risk | PM        | Ops   |                     | 4      | 2          | 8     | open   | high     |             |',
].join('\n');

const COMMS_TABLE = [
  '| ID | Activity   | Audience | Content       | Frequency | Channel | Owner | Status |',
  '|----|------------|----------|---------------|-----------|---------|-------|--------|',
  '| 1  | Kickoff    | All      | Project intro | Once      | Email   | PM    | done   |',
].join('\n');

function plan({ withComms = true, withLessons = false, withBaseline = false } = {}) {
  let text = '# Plan\n\n- [ ] Task one\n\n---raid log---\n' + RAID_TABLE;
  if (withComms) {
    text += '\n\n---comms---\n' + COMMS_TABLE;
  }
  if (withLessons) {
    text += '\n\n---lessons learned---\nNo lessons yet.';
  }
  if (withBaseline) {
    text += '\n\n---baseline---\n| Task Name | Start | Finish | Duration |\n|---|---|---|---|\n';
  }
  return text;
}

test('extractRaidLogFromPlanText stops before a following comms section', () => {
  const text = plan({ withComms: true });
  const raidText = extractRaidLogFromPlanText(text);
  assert.ok(raidText.includes('Server down'), 'should include the RAID row');
  assert.ok(!raidText.includes('---comms---'), 'must not include the comms marker');
  assert.ok(!raidText.includes('Kickoff'), 'must not include comms row content');
});

test('extractRaidLogFromPlanText stops before a following lessons-learned section (no comms present)', () => {
  const text = plan({ withComms: false, withLessons: true });
  const raidText = extractRaidLogFromPlanText(text);
  assert.ok(raidText.includes('Server down'));
  assert.ok(!raidText.includes('---lessons learned---'));
  assert.ok(!raidText.includes('No lessons yet.'));
});

test('extractRaidLogFromPlanText still stops correctly at budget/baseline when comms is also present', () => {
  const text =
    '# Plan\n\n---raid log---\n' + RAID_TABLE +
    '\n\n---comms---\n' + COMMS_TABLE +
    '\n\n---baseline---\n| Task Name | Start | Finish | Duration |\n|---|---|---|---|\n';
  const raidText = extractRaidLogFromPlanText(text);
  assert.ok(raidText.includes('Server down'));
  assert.ok(!raidText.includes('---comms---'));
  assert.ok(!raidText.includes('---baseline---'));
});

test('a comms activity row is never parsed as a bogus RAID item (issue #978)', () => {
  const text = plan({ withComms: true });
  const items = extractRaidItemsFromPlanText(text);
  assert.equal(items.length, 1, 'only the real RAID row should be extracted');
  assert.equal(items[0].title, 'Server down');
  const bogus = items.find((i) => i.title === 'Kickoff' || i.owner === 'PM' && i.type === 'risk' && i.title === '');
  assert.equal(bogus, undefined, 'comms activity must not appear as a RAID item');
});
