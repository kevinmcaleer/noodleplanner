// Tests for the RAID <-> Excel sync diff engine (issue #761).
//
// Run with: node tests/test_raid_sync.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DIFF_KIND,
  diffRaidSync,
  applyRaidSyncDiff,
  defaultRaidSyncChoice,
  upsertFrontMatterField,
  getFrontMatterField,
} from '../packages/noodle-web/src/noodle_web/static/raid-sync.js';

function risk(id, overrides = {}) {
  return {
    id,
    type: 'risk',
    title: `Risk ${id}`,
    description: 'A risk',
    raised_by: 'PM',
    owner: 'PM',
    mitigation_actions: '',
    impact: 3,
    likelihood: 3,
    score: 9,
    status: 'open',
    ...overrides,
  };
}

test('unchanged rows produce no diff entries', () => {
  const local = [risk(1)];
  const external = [risk(1)];
  const base = [risk(1)];
  assert.deepEqual(diffRaidSync(local, external, base), []);
});

test('a row only in the workbook is a first-sync addition', () => {
  const entries = diffRaidSync([], [risk(1)], []);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, DIFF_KIND.ADDED);
  assert.equal(entries[0].id, 1);
});

test('a row deliberately deleted from the plan is not resurrected', () => {
  // It existed at the last sync (base) and is still in the external file,
  // but the plan removed it — that is a decision, not something to import.
  const entries = diffRaidSync([], [risk(1)], [risk(1)]);
  assert.deepEqual(entries, []);
});

test('a row removed from the workbook since last sync is flagged for removal', () => {
  const entries = diffRaidSync([risk(1)], [], [risk(1)]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, DIFF_KIND.REMOVED);
});

test('a row added locally since last sync (not yet in the workbook) is not shown', () => {
  const entries = diffRaidSync([risk(1)], [], []);
  assert.deepEqual(entries, []);
});

test('external-only change since last sync is an update', () => {
  const base = [risk(1, { title: 'Original' })];
  const local = [risk(1, { title: 'Original' })];
  const external = [risk(1, { title: 'Renamed in Excel' })];
  const entries = diffRaidSync(local, external, base);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, DIFF_KIND.UPDATED);
  assert.equal(entries[0].external.title, 'Renamed in Excel');
});

test('local-only change since last sync produces no entry (workbook is stale)', () => {
  const base = [risk(1, { title: 'Original' })];
  const local = [risk(1, { title: 'Renamed in app' })];
  const external = [risk(1, { title: 'Original' })];
  assert.deepEqual(diffRaidSync(local, external, base), []);
});

test('both sides changed the same row since last sync is a conflict', () => {
  const base = [risk(1, { title: 'Original' })];
  const local = [risk(1, { title: 'Renamed in app' })];
  const external = [risk(1, { title: 'Renamed in Excel' })];
  const entries = diffRaidSync(local, external, base);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, DIFF_KIND.CONFLICT);
});

test('entries are ordered conflicts, added, updated, removed', () => {
  const base = [risk(2, { title: 'B' }), risk(3, { title: 'C' })];
  const local = [risk(2, { title: 'B-local' }), risk(3, { title: 'C' }), risk(4)];
  const external = [
    risk(1), // added
    risk(2, { title: 'B-external' }), // conflict
    // 3 removed
    risk(4, { title: 'D-external' }), // conflict — id 4 has no base entry, so both sides count as "changed"
  ];
  const entries = diffRaidSync(local, external, base);
  const kinds = entries.map((e) => e.kind);
  // conflicts (2, 4) first, then added (1), then removed (3) last.
  assert.equal(kinds[0], DIFF_KIND.CONFLICT);
  assert.equal(kinds[kinds.length - 1], DIFF_KIND.REMOVED);
});

test('defaultRaidSyncChoice: additions and updates default to accept, removals to reject, conflicts to keep-mine', () => {
  assert.equal(defaultRaidSyncChoice(DIFF_KIND.ADDED), 'accept');
  assert.equal(defaultRaidSyncChoice(DIFF_KIND.UPDATED), 'accept');
  assert.equal(defaultRaidSyncChoice(DIFF_KIND.REMOVED), 'reject');
  assert.equal(defaultRaidSyncChoice(DIFF_KIND.CONFLICT), 'keep-mine');
});

test('applyRaidSyncDiff: accepted addition is appended', () => {
  const entries = diffRaidSync([], [risk(1)], []);
  const result = applyRaidSyncDiff([], entries, { 1: 'accept' });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 1);
});

test('applyRaidSyncDiff: rejected addition is not appended', () => {
  const entries = diffRaidSync([], [risk(1)], []);
  const result = applyRaidSyncDiff([], entries, { 1: 'reject' });
  assert.deepEqual(result, []);
});

test('applyRaidSyncDiff: accepted update replaces the local row', () => {
  const base = [risk(1, { title: 'Original' })];
  const local = [risk(1, { title: 'Original' })];
  const external = [risk(1, { title: 'Renamed in Excel' })];
  const entries = diffRaidSync(local, external, base);
  const result = applyRaidSyncDiff(local, entries, { 1: 'accept' });
  assert.equal(result[0].title, 'Renamed in Excel');
});

test('applyRaidSyncDiff: accepted removal deletes the local row', () => {
  const entries = diffRaidSync([risk(1)], [], [risk(1)]);
  const result = applyRaidSyncDiff([risk(1)], entries, { 1: 'accept' });
  assert.deepEqual(result, []);
});

test('applyRaidSyncDiff: an unreviewed removal defaults to keeping the row (never silently deletes)', () => {
  const entries = diffRaidSync([risk(1)], [], [risk(1)]);
  const result = applyRaidSyncDiff([risk(1)], entries, {});
  assert.equal(result.length, 1);
});

test('applyRaidSyncDiff: conflict with no choice keeps the local value', () => {
  const base = [risk(1, { title: 'Original' })];
  const local = [risk(1, { title: 'Mine' })];
  const external = [risk(1, { title: 'Theirs' })];
  const entries = diffRaidSync(local, external, base);
  const result = applyRaidSyncDiff(local, entries, {});
  assert.equal(result[0].title, 'Mine');
});

test('applyRaidSyncDiff: conflict resolved keep-theirs takes the external value', () => {
  const base = [risk(1, { title: 'Original' })];
  const local = [risk(1, { title: 'Mine' })];
  const external = [risk(1, { title: 'Theirs' })];
  const entries = diffRaidSync(local, external, base);
  const result = applyRaidSyncDiff(local, entries, { 1: 'keep-theirs' });
  assert.equal(result[0].title, 'Theirs');
});

test('upsertFrontMatterField adds a new key to existing front matter', () => {
  const text = '---\ntitle: Demo\n---\n# Plan\n';
  const updated = upsertFrontMatterField(text, 'excel_file', 'raid.xlsx');
  assert.equal(getFrontMatterField(updated, 'excel_file'), 'raid.xlsx');
  assert.equal(getFrontMatterField(updated, 'title'), 'Demo');
});

test('upsertFrontMatterField replaces an existing key in place', () => {
  const text = '---\ntitle: Demo\nexcel_file: old.xlsx\n---\n# Plan\n';
  const updated = upsertFrontMatterField(text, 'excel_file', 'new.xlsx');
  assert.equal(getFrontMatterField(updated, 'excel_file'), 'new.xlsx');
  assert.equal((updated.match(/excel_file:/g) || []).length, 1);
});

test('upsertFrontMatterField creates front matter when none exists', () => {
  const text = '# Plan\n- Task 1\n';
  const updated = upsertFrontMatterField(text, 'excel_file', 'raid.xlsx');
  assert.equal(getFrontMatterField(updated, 'excel_file'), 'raid.xlsx');
  assert.ok(updated.includes('# Plan'));
});
