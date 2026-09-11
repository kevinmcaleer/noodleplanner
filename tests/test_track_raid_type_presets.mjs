/**
 * Regression tests for issue #1113: the Track ribbon's RAID group buttons
 * (Risk / Issue / Assumption / Dependency / Action) must each open the New
 * RAID Item form with their own type preselected, instead of every button
 * falling back to the generic Risk default -- and there must be a Track
 * ribbon Action button at all.
 *
 * Covers two layers:
 *  - ribbon-ia.js: the Track tab's RAID group actually has all five
 *    buttons, Action included.
 *  - ribbon.js: each 'track:<Label>' entry in scopedAction()'s table calls
 *    openRaidFormWithType() with the right type -- checked by parsing the
 *    source the same conservative way tests/test_ribbon_action_coverage.mjs
 *    already does, since ribbon.js is a classic script that reaches for
 *    globals and can't be executed standalone.
 *  - script.js: openRaidFormWithType() (and openRaidForm()/addRaidItem(),
 *    which it builds on) actually preset the #raidItemType field, exercised
 *    against a lifted copy of the real function bodies with a stubbed DOM --
 *    the same "liftFunctions" approach tests/test_raid_comms_section_collision.mjs
 *    uses for the same reason.
 *
 * Run with: node --test tests/test_track_raid_type_presets.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

import { TABS } from '../packages/noodle-web/src/noodle_web/static/ribbon-ia.js';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const staticDir = join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'static');
const templatesDir = join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'templates');

const ribbonSrc = readFileSync(join(staticDir, 'ribbon.js'), 'utf8');
const scriptSrc = readFileSync(join(staticDir, 'script.js'), 'utf8');

// ---------------------------------------------------------------------------
// ribbon-ia.js: the Track tab's RAID group has all five buttons
// ---------------------------------------------------------------------------

function trackRaidGroup() {
  const trackTab = TABS.find((t) => t.id === 'track');
  assert.ok(trackTab, 'no "track" tab in TABS');
  const raidGroup = trackTab.groups.find((g) => g.name === 'RAID');
  assert.ok(raidGroup, 'Track tab has no "RAID" group');
  const labels = [
    ...(raidGroup.lg || []).map((b) => b[1]),
    ...(raidGroup.cols || []).flatMap((col) => col.map((b) => b[1])),
  ];
  return labels;
}

test('the Track ribbon RAID group has Risk, Issue, Assumption, Dependency and Action buttons', () => {
  const labels = trackRaidGroup();
  for (const label of ['Risk', 'Issue', 'Assumption', 'Dependency', 'Action']) {
    assert.ok(labels.includes(label), `Track ribbon RAID group is missing a "${label}" button`);
  }
});

// ---------------------------------------------------------------------------
// ribbon.js: scopedAction()'s table presets the right type per button
// ---------------------------------------------------------------------------

/** The (scopeId, label) -> table entry text for the ribbon action table,
 * parsed the same way tests/test_ribbon_action_coverage.mjs does (ribbon.js
 * is a classic script, not an ES module, so its tables can't be imported). */
function scopedActionTableSource() {
  const m = ribbonSrc.match(/function scopedAction[\s\S]*?const table = \{([\s\S]*?)\n {4}\};/);
  assert.ok(m, 'could not find scopedAction()\'s table in ribbon.js');
  return m[1];
}

test('each track: RAID button calls openRaidFormWithType with its own type', () => {
  const table = scopedActionTableSource();
  const expected = {
    Risk: 'risk',
    Issue: 'issue',
    // The app's RAID item types are risk/action/issue/decision/dependency --
    // there's no dedicated "assumption" type, so the Assumption button
    // presets the closest existing one, Decision (see the #1113 comment
    // just above this table in ribbon.js).
    Assumption: 'decision',
    Dependency: 'dependency',
    Action: 'action',
  };
  for (const [label, type] of Object.entries(expected)) {
    const re = new RegExp(
      `'track:${label}'\\s*:\\s*\\(\\)\\s*=>\\s*openRaidFormWithType\\('${type}'\\)`,
    );
    assert.match(table, re, `'track:${label}' should call openRaidFormWithType('${type}')`);
  }
});

// ---------------------------------------------------------------------------
// script.js: openRaidFormWithType() actually presets the type field
// ---------------------------------------------------------------------------

/** Top-level `function name(` ... `\n}` declarations from a classic script,
 * lifted into a sandboxed vm context (same helper as
 * tests/test_raid_comms_section_collision.mjs, duplicated here rather than
 * shared since neither file exports it). */
function liftFunctions(sandbox, source, names) {
  for (const name of names) {
    const start = source.indexOf(`\nfunction ${name}(`);
    assert.notEqual(start, -1, `${name} not found`);
    const end = source.indexOf('\n}\n', start);
    assert.notEqual(end, -1, `${name} has no closing brace at column 0`);
    vm.runInNewContext(source.slice(start, end + 3), sandbox);
  }
  return sandbox;
}

/** A minimal fake DOM element: just the properties openRaidForm()/
 * openRaidFormWithType() touch. */
function fakeElement() {
  return { value: '', textContent: '', style: {} };
}

function makeSandbox() {
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, fakeElement());
      return elements.get(id);
    },
  };
  const sandbox = {
    document,
    raidItems: [],
    // openRaidForm()/openRaidFormWithType() call these; neither's own
    // behaviour is under test here (updateRaidFormScore is exercised by
    // whatever already tests the RAID form, and openDetailPane is pure
    // panel-visibility plumbing), so they're no-ops.
    updateRaidFormScore: () => {},
    openDetailPane: () => {},
  };
  liftFunctions(sandbox, scriptSrc, ['addRaidItem', 'openRaidForm', 'openRaidFormWithType']);
  return sandbox;
}

test('openRaidFormWithType presets #raidItemType to the requested type', () => {
  for (const type of ['risk', 'issue', 'decision', 'dependency', 'action']) {
    const sandbox = makeSandbox();
    sandbox.openRaidFormWithType(type);
    assert.equal(sandbox.document.getElementById('raidItemType').value, type);
    // It's still the "New RAID Item" flow, not an edit of an existing row.
    assert.equal(sandbox.document.getElementById('raidFormTitle').textContent, 'New RAID Item');
    assert.equal(sandbox.document.getElementById('raidItemId').value, '');
  }
});

test('addRaidItem() (no type argument) still defaults to Risk, for callers that want the old behaviour', () => {
  const sandbox = makeSandbox();
  sandbox.addRaidItem();
  assert.equal(sandbox.document.getElementById('raidItemType').value, 'risk');
});

test('the preset type is a normal, editable form field -- the user can still change it', () => {
  const sandbox = makeSandbox();
  sandbox.openRaidFormWithType('action');
  const typeField = sandbox.document.getElementById('raidItemType');
  assert.equal(typeField.value, 'action');
  typeField.value = 'risk';
  assert.equal(typeField.value, 'risk', 'the type field must stay a plain, writable value after presetting');
});

test('the #raidItemType select in index.html is not disabled or readonly, so a preset type stays user-editable', () => {
  const html = readFileSync(join(templatesDir, 'index.html'), 'utf8');
  const m = html.match(/<select id="raidItemType"[^>]*>/);
  assert.ok(m, 'could not find the #raidItemType select in index.html');
  assert.doesNotMatch(m[0], /\bdisabled\b/);
  assert.doesNotMatch(m[0], /\breadonly\b/);
});
