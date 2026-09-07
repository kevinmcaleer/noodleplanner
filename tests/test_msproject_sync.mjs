// Tests for the MS Project import merge (issue #842, follow-up from #761).
//
// The bug being fixed: uploadMSProjectFile() used to do
// `editor.value = markdown` on every import, and the imported markdown only
// ever has a bare title + Resources front matter and a task tree -- so a
// wholesale replace silently discarded version, project manager, rag,
// last_saved, custom fields, and every back-matter section (highlights,
// budget, benefits, RAID log, comms, lessons learned, baseline).
//
// Run with: node tests/test_msproject_sync.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

// Node has no global localStorage; getMspSyncState/setMspSyncState/
// clearMspSyncState need one to actually exercise their real behaviour
// rather than silently no-op through their try/catch guards.
globalThis.localStorage = (() => {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
})();

import {
  mergeFrontMatter,
  extractBackMatterSections,
  stripBackMatterSections,
  mergeImportedTasks,
  upsertFrontMatterField,
  getMspSyncState,
  setMspSyncState,
  clearMspSyncState,
} from '../packages/noodle-web/src/noodle_web/static/msproject-sync.js';

test('mergeFrontMatter replaces an existing key in place, preserving order', () => {
  const current = ['title: Old Title', 'version: 3.2', 'project manager: Jane Doe'];
  const imported = ['title: New Title'];
  const merged = mergeFrontMatter(current, imported);
  assert.deepEqual(merged, ['title: New Title', 'version: 3.2', 'project manager: Jane Doe']);
});

test('mergeFrontMatter appends a key the current plan does not have', () => {
  const current = ['title: Plan', 'version: 1.0'];
  const imported = ['title: Plan', 'Resources:', '- @jd: Jane Doe'];
  const merged = mergeFrontMatter(current, imported);
  assert.deepEqual(merged, ['title: Plan', 'version: 1.0', 'Resources:', '- @jd: Jane Doe']);
});

test('mergeFrontMatter preserves fields the import knows nothing about', () => {
  const current = [
    'title: Old', 'version: 5.3', 'project manager: Jane Doe',
    'rag: amber', 'last_saved: 2026-01-01 10:00', 'custom_field: keep me',
  ];
  const imported = ['title: New From MPP'];
  const merged = mergeFrontMatter(current, imported);
  assert.ok(merged.includes('version: 5.3'));
  assert.ok(merged.includes('project manager: Jane Doe'));
  assert.ok(merged.includes('rag: amber'));
  assert.ok(merged.includes('last_saved: 2026-01-01 10:00'));
  assert.ok(merged.includes('custom_field: keep me'));
  assert.ok(merged.includes('title: New From MPP'));
  assert.ok(!merged.includes('title: Old'));
});

test('mergeFrontMatter treats a multi-line block (Resources: + list) as one unit', () => {
  const current = ['title: Plan', 'Resources:', '- @ab: Old Person'];
  const imported = ['title: Plan', 'Resources:', '- @cd: New Person', '- @ef: Another Person'];
  const merged = mergeFrontMatter(current, imported);
  assert.deepEqual(merged, ['title: Plan', 'Resources:', '- @cd: New Person', '- @ef: Another Person']);
});

test('extractBackMatterSections pulls out every section verbatim', () => {
  const body = [
    '# Plan',
    '- Task 1',
    '',
    '---',
    '',
    '---highlights---',
    'Something good happened',
    '---end-highlights---',
    '',
    '---budget---',
    '| ID | Description |',
    '',
    '---benefits---',
    'benefit text',
    '',
    '---raid log---',
    '| ID | Type |',
    '',
    '---comms---',
    'comms text',
    '',
    '---lessons learned---',
    'lessons text',
    '',
    '---baseline---',
    'baseline text',
    '',
    '---whiteboard---',
    '| Task | X | Y |',
  ].join('\n');

  const sections = extractBackMatterSections(body);
  assert.equal(sections.highlights, 'Something good happened');
  assert.equal(sections.hasEndHighlights, true);
  assert.equal(sections.budget, '| ID | Description |');
  assert.equal(sections.benefits, 'benefit text');
  assert.equal(sections.raidLog, '| ID | Type |');
  assert.equal(sections.comms, 'comms text');
  assert.equal(sections.lessons, 'lessons text');
  assert.equal(sections.baseline, 'baseline text');
  assert.equal(sections.whiteboard, '| Task | X | Y |');
});

test('extractBackMatterSections stops baseline before a following whiteboard section', () => {
  // Before issue #844, baseline was assumed to always be last and read to
  // EOF unconditionally -- this would have swallowed a following
  // whiteboard section whole.
  const body = [
    '# Plan', '- Task 1', '',
    '---baseline---', 'baseline text', '',
    '---whiteboard---', 'whiteboard text',
  ].join('\n');
  const sections = extractBackMatterSections(body);
  assert.equal(sections.baseline, 'baseline text');
  assert.equal(sections.whiteboard, 'whiteboard text');
});

test('extractBackMatterSections returns empty strings when a plan has no back matter', () => {
  const body = '# Plan\n- Task 1\n- Task 2\n';
  const sections = extractBackMatterSections(body);
  assert.equal(sections.highlights, '');
  assert.equal(sections.budget, '');
  assert.equal(sections.benefits, '');
  assert.equal(sections.raidLog, '');
  assert.equal(sections.comms, '');
  assert.equal(sections.lessons, '');
  assert.equal(sections.baseline, '');
  assert.equal(sections.whiteboard, '');
});

test('stripBackMatterSections leaves only the task outline', () => {
  const body = '# Plan\n- Task 1\n- Task 2\n\n---\n\n---raid log---\n| ID | Type |\n';
  const stripped = stripBackMatterSections(body);
  assert.equal(stripped, '# Plan\n- Task 1\n- Task 2');
});

test('mergeImportedTasks preserves front matter fields and every back-matter section', () => {
  const currentPlan = [
    '---',
    'title: Old Project Plan',
    'version: 4.1',
    'project manager: Jane Doe',
    'rag: amber',
    'last_saved: 2026-01-01 10:00',
    '---',
    '# Old Project Plan',
    '- Old Task 1',
    '- Old Task 2',
    '',
    '---',
    '',
    '---budget---',
    '| ID | Description | Estimate |',
    '|----|-------------|----------|',
    '| 1  | Consultancy | 5000     |',
    '',
    '---raid log---',
    '| ID | Type | Title |',
    '|----|------|-------|',
    '| 1  | risk | A risk |',
  ].join('\n');

  const importedMarkdown = [
    '---',
    'title: Reimported From MS Project',
    'Resources:',
    '- @jd: Jane Doe',
    '---',
    '',
    'New Task 1  5d @jd',
    '  New Subtask 1.1  2d @jd',
    'New Task 2  3d',
  ].join('\n');

  const merged = mergeImportedTasks(currentPlan, importedMarkdown);

  // Front matter: title updated, Resources added, everything else preserved.
  assert.match(merged, /title: Reimported From MS Project/);
  assert.match(merged, /Resources:\n- @jd: Jane Doe/);
  assert.match(merged, /version: 4\.1/);
  assert.match(merged, /project manager: Jane Doe/);
  assert.match(merged, /rag: amber/);
  assert.match(merged, /last_saved: 2026-01-01 10:00/);
  assert.doesNotMatch(merged, /Old Project Plan/);

  // Tasks: new tree present, old tasks gone.
  assert.match(merged, /New Task 1  5d @jd/);
  assert.match(merged, /New Subtask 1\.1  2d @jd/);
  assert.match(merged, /New Task 2  3d/);
  assert.doesNotMatch(merged, /Old Task 1/);
  assert.doesNotMatch(merged, /Old Task 2/);

  // Back matter: budget and RAID log both survive untouched.
  assert.match(merged, /---budget---\n\| ID \| Description \| Estimate \|/);
  assert.match(merged, /\| 1  \| Consultancy \| 5000     \|/);
  assert.match(merged, /---raid log---\n\| ID \| Type \| Title \|/);
  assert.match(merged, /\| 1  \| risk \| A risk \|/);
});

test('mergeImportedTasks preserves a whiteboard section (issue #844)', () => {
  const currentPlan = [
    '---', 'title: Old Project Plan', '---',
    '# Old Project Plan', '- Old Task 1', '',
    '---', '',
    '---whiteboard---',
    '| Task | X | Y |',
    '|------|---|---|',
    '| Old Task 1 | 120 | 80 |',
  ].join('\n');
  const importedMarkdown = ['---', 'title: Reimported', '---', '', 'New Task 1  5d'].join('\n');

  const merged = mergeImportedTasks(currentPlan, importedMarkdown);
  assert.match(merged, /---whiteboard---\n\| Task \| X \| Y \|/);
  assert.match(merged, /\| Old Task 1 \| 120 \| 80 \|/);
  assert.match(merged, /New Task 1  5d/);
});

test('mergeImportedTasks on a plan with no back matter produces no dangling section markers', () => {
  const currentPlan = '---\ntitle: Plan\n---\n# Plan\n- Old Task\n';
  const importedMarkdown = '---\ntitle: Plan\n---\n\nNew Task  2d\n';
  const merged = mergeImportedTasks(currentPlan, importedMarkdown);
  assert.doesNotMatch(merged, /---budget---/);
  assert.doesNotMatch(merged, /---raid log---/);
  assert.doesNotMatch(merged, /---benefits---/);
  assert.doesNotMatch(merged, /---whiteboard---/);
  assert.match(merged, /New Task  2d/);
  assert.doesNotMatch(merged, /Old Task/);
});

test('getMspSyncState returns null when nothing has been synced yet', () => {
  assert.equal(getMspSyncState('test-project-1'), null);
});

test('setMspSyncState / getMspSyncState round-trip, scoped per project', () => {
  setMspSyncState('test-project-2', { taskBody: 'Task A  1d', syncedAt: '2026-09-07T12:00:00Z' });
  const state = getMspSyncState('test-project-2');
  assert.equal(state.taskBody, 'Task A  1d');
  assert.equal(getMspSyncState('a-different-project'), null);
});

test('clearMspSyncState removes a stored snapshot', () => {
  setMspSyncState('test-project-3', { taskBody: 'Task A  1d' });
  clearMspSyncState('test-project-3');
  assert.equal(getMspSyncState('test-project-3'), null);
});

test('upsertFrontMatterField adds msproject_file and msproject_file_synced', () => {
  const text = '---\ntitle: Plan\n---\n# Plan\n';
  let updated = upsertFrontMatterField(text, 'msproject_file', 'plan.mpp');
  updated = upsertFrontMatterField(updated, 'msproject_file_synced', '2026-09-07 12:00');
  assert.match(updated, /msproject_file: plan\.mpp/);
  assert.match(updated, /msproject_file_synced: 2026-09-07 12:00/);
});
