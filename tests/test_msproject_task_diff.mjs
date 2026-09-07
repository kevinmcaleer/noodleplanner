// Tests for the per-task MS Project sync diff/apply engine (issue #842).
//
// Run with: node tests/test_msproject_task_diff.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractTaskName,
  parseTaskOutline,
  diffTaskOutline,
  applyTaskDiff,
  defaultTaskSyncChoice,
} from '../packages/noodle-web/src/noodle_web/static/msproject-task-diff.js';

const BASE = [
  'Phase A',
  '  Task A1  2d',
  '  Task A2  3d',
  'Phase B',
  '  Task B1  1d',
].join('\n');

function applyAll(local, imported, overrideChoices = {}) {
  const diff = diffTaskOutline(local, imported);
  const choices = {};
  for (const entry of diff.entries) {
    choices[entry.key] = overrideChoices[entry.key] ?? defaultTaskSyncChoice(entry.kind);
  }
  return { diff, entries: diff.entries, choices, result: applyTaskDiff(local, diff, choices) };
}

// --- extractTaskName ---

test('extractTaskName strips duration, percent, resources, dependencies, notes', () => {
  assert.equal(extractTaskName('Build API  5d @jd 40% [depends Design] "note here"'), 'Build API');
  assert.equal(extractTaskName('  Nested Task  3d'), 'Nested Task');
  assert.equal(extractTaskName('Kickoff 0d'), 'Kickoff');
});

test('extractTaskName strips the star dependency shorthand', () => {
  assert.equal(extractTaskName('*Gate 0d'), extractTaskName('Gate 0d'));
});

// --- parseTaskOutline ---

test('parseTaskOutline builds parent-qualified keys matching hierarchy', () => {
  const nodes = parseTaskOutline(BASE);
  const keys = nodes.map((n) => n.key);
  assert.deepEqual(keys, [
    'Phase A',
    'Phase A › Task A1',
    'Phase A › Task A2',
    'Phase B',
    'Phase B › Task B1',
  ]);
});

test('parseTaskOutline disambiguates duplicate sibling names', () => {
  const text = ['Phase A', '  Review 1d', '  Build 1d', '  Review 1d'].join('\n');
  const nodes = parseTaskOutline(text);
  const keys = nodes.map((n) => n.key);
  assert.deepEqual(keys, ['Phase A', 'Phase A › Review', 'Phase A › Build', 'Phase A › Review#2']);
});

// --- diffTaskOutline: no-op ---

test('identical outlines produce no diff entries', () => {
  const { entries } = diffTaskOutline(BASE, BASE);
  assert.deepEqual(entries, []);
});

test('a purely whitespace/indent difference is not a diff (only logical depth matters)', () => {
  const reindented = BASE.split('\n').map((l) => (l.startsWith('  ') ? '    ' + l.slice(2) : l)).join('\n');
  const { entries } = diffTaskOutline(BASE, reindented);
  assert.deepEqual(entries, []);
});

// --- updated ---

test('a changed field on a matched task is an updated entry', () => {
  const imported = BASE.replace('Task A1  2d', 'Task A1  4d');
  const { entries } = diffTaskOutline(BASE, imported);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, 'updated');
  assert.equal(entries[0].key, 'Phase A › Task A1');
});

test('apply: an accepted update preserves the LOCAL indent, not the imported one', () => {
  // Imported uses 4-space indentation throughout; local uses 2-space.
  const imported = BASE.split('\n')
    .map((l) => (l.startsWith('  ') ? '    ' + l.slice(2).replace('2d', '4d') : l))
    .join('\n');
  const { result } = applyAll(BASE, imported);
  assert.ok(result.includes('  Task A1  4d')); // 2-space local indent, new duration
  assert.ok(!result.includes('    Task A1'));
});

// --- added ---

test('a new child under an existing parent is an added entry, inserted after the last existing child', () => {
  const imported = BASE.replace('Phase B', '  Task A3  1d\nPhase B');
  const { entries, result } = applyAll(BASE, imported);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, 'added');
  assert.equal(result, [
    'Phase A',
    '  Task A1  2d',
    '  Task A2  3d',
    '  Task A3  1d',
    'Phase B',
    '  Task B1  1d',
  ].join('\n'));
});

test('a whole new subtree (new parent + new children) is inserted together, parent before children', () => {
  const imported = BASE + '\nPhase C\n  Task C1  1d';
  const { entries, result } = applyAll(BASE, imported);
  assert.equal(entries.length, 2);
  assert.ok(entries.every((e) => e.kind === 'added'));
  assert.equal(result, [
    'Phase A',
    '  Task A1  2d',
    '  Task A2  3d',
    'Phase B',
    '  Task B1  1d',
    'Phase C',
    '  Task C1  1d',
  ].join('\n'));
});

test('accepting only a new child auto-includes its new parent, so nothing is orphaned', () => {
  const imported = BASE + '\nPhase C\n  Task C1  1d';
  const diff = diffTaskOutline(BASE, imported);
  const childEntry = diff.entries.find((e) => e.key === 'Phase C › Task C1');
  const parentEntry = diff.entries.find((e) => e.key === 'Phase C');
  // Only the child is explicitly accepted; the parent is left at its
  // default (also 'accept' here, but we simulate a reject to prove the
  // safety net, not the default).
  const choices = { [childEntry.key]: 'accept', [parentEntry.key]: 'reject' };
  const result = applyTaskDiff(BASE, diff, choices);
  assert.ok(result.includes('Phase C'));
  assert.ok(result.includes('  Task C1  1d'));
  // Phase C must appear before Task C1, and Task C1 must be indented as
  // its child, not dangling at top level.
  const lines = result.split('\n');
  const phaseCIdx = lines.indexOf('Phase C');
  const taskC1Idx = lines.indexOf('  Task C1  1d');
  assert.ok(phaseCIdx !== -1 && taskC1Idx !== -1 && phaseCIdx < taskC1Idx);
});

// --- removed ---

test('a task missing from the import is a removed entry', () => {
  const imported = BASE.replace('  Task A2  3d\n', '');
  const { entries } = diffTaskOutline(BASE, imported);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, 'removed');
  assert.equal(entries[0].key, 'Phase A › Task A2');
  assert.equal(entries[0].descendantCount, 0);
});

test('removing a summary task cascades to its children as ONE entry, not one per child', () => {
  const imported = ['Phase B', '  Task B1  1d'].join('\n'); // Phase A entirely gone
  const { entries } = diffTaskOutline(BASE, imported);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].key, 'Phase A');
  assert.equal(entries[0].kind, 'removed');
  assert.equal(entries[0].descendantCount, 2);
});

test('apply: accepting a cascading removal deletes the task and every descendant line', () => {
  const imported = ['Phase B', '  Task B1  1d'].join('\n');
  const { result } = applyAll(BASE, imported, { 'Phase A': 'accept' });
  assert.equal(result, ['Phase B', '  Task B1  1d'].join('\n'));
});

test('an unreviewed removal defaults to reject and keeps the task (never silently deletes)', () => {
  const imported = BASE.replace('  Task A2  3d\n', '');
  const diff = diffTaskOutline(BASE, imported);
  const result = applyTaskDiff(BASE, diff, {}); // no choices recorded at all
  assert.equal(result, BASE);
});

// --- rename / move limitation (documented, expected behaviour) ---

test('a renamed task shows as removed + added, not updated (documented limitation)', () => {
  const imported = BASE.replace('Task A1  2d', 'Renamed Task  2d');
  const { entries } = diffTaskOutline(BASE, imported);
  const kinds = entries.map((e) => e.kind).sort();
  assert.deepEqual(kinds, ['added', 'removed']);
});

test('a task moved to a different parent shows as removed + added', () => {
  const local = BASE;
  const imported = ['Phase A', 'Phase B', '  Task B1  1d', '  Task A1  2d', '  Task A2  3d'].join('\n');
  const { entries } = diffTaskOutline(local, imported);
  const kinds = entries.map((e) => e.kind);
  // Task A1 under Phase A is gone (removed); Task A1 under Phase B is new (added).
  assert.ok(kinds.includes('removed'));
  assert.ok(kinds.includes('added'));
});

// --- combined scenario ---

test('apply: a removal, an update, and a new subtree together produce the correct final text', () => {
  const imported = [
    'Phase A',
    '  Task A1  4d', // updated (was 2d)
    // Task A2 removed
    'Phase B',
    '  Task B1  1d',
    'Phase C', // new
    '  Task C1  1d', // new
  ].join('\n');
  const { entries, result } = applyAll(BASE, imported, { 'Phase A › Task A2': 'accept' });
  const kinds = entries.map((e) => e.kind).sort();
  assert.deepEqual(kinds, ['added', 'added', 'removed', 'updated']);
  assert.equal(result, [
    'Phase A',
    '  Task A1  4d',
    'Phase B',
    '  Task B1  1d',
    'Phase C',
    '  Task C1  1d',
  ].join('\n'));
});

test('defaultTaskSyncChoice: added/updated default to accept, removed defaults to reject', () => {
  assert.equal(defaultTaskSyncChoice('added'), 'accept');
  assert.equal(defaultTaskSyncChoice('updated'), 'accept');
  assert.equal(defaultTaskSyncChoice('removed'), 'reject');
});

// --- duplicate names ---

// --- edge cases ---

test('first sync (empty local outline): every imported task is added, whole tree lands intact', () => {
  const { entries, result } = applyAll('', BASE);
  assert.equal(entries.length, 5);
  assert.ok(entries.every((e) => e.kind === 'added'));
  assert.equal(result, BASE);
});

test('importing an empty task tree marks every local task removed (rejected by default keeps them)', () => {
  const { entries, result } = applyAll(BASE, '');
  // Only the two top-level phases are removal roots; their children cascade.
  assert.equal(entries.length, 2);
  assert.ok(entries.every((e) => e.kind === 'removed'));
  assert.equal(result, BASE); // nothing accepted by default
});

test('importing an empty task tree, all removals accepted, empties the outline', () => {
  const diff = diffTaskOutline(BASE, '');
  const choices = Object.fromEntries(diff.entries.map((e) => [e.key, 'accept']));
  const result = applyTaskDiff(BASE, diff, choices);
  assert.equal(result, '');
});

test('milestones (0d, no percent) and dependency shorthand round-trip through the identity extraction', () => {
  const text = ['Phase A', '  Kickoff 0d', '  *Gate 0d'].join('\n');
  const nodes = parseTaskOutline(text);
  assert.equal(nodes[1].name, 'Kickoff');
  assert.equal(nodes[2].name, 'Gate');
});

// --- three-way diff (base / last-synced snapshot provided) ---

test('with a base, changed-on-both-sides is a conflict instead of an update', () => {
  const base = BASE; // last-synced snapshot: original 2d
  const local = BASE.replace('Task A1  2d', 'Task A1  5d'); // plan changed it since last sync
  const imported = BASE.replace('Task A1  2d', 'Task A1  9d'); // MS Project also changed it
  const { entries } = diffTaskOutline(local, imported, base);
  const entry = entries.find((e) => e.key === 'Phase A › Task A1');
  assert.equal(entry.kind, 'conflict');
});

test('with a base, changed on the imported side only is still an update', () => {
  const base = BASE;
  const local = BASE; // plan unchanged since last sync
  const imported = BASE.replace('Task A1  2d', 'Task A1  9d');
  const { entries } = diffTaskOutline(local, imported, base);
  const entry = entries.find((e) => e.key === 'Phase A › Task A1');
  assert.equal(entry.kind, 'updated');
});

test('with a base, changed on the local side only produces no entry (import is stale)', () => {
  const base = BASE;
  const local = BASE.replace('Task A1  2d', 'Task A1  5d'); // plan changed it
  const imported = BASE; // MS Project still has the old value
  const { entries } = diffTaskOutline(local, imported, base);
  assert.deepEqual(entries.filter((e) => e.key === 'Phase A › Task A1'), []);
});

test('with a base, a task removed from the plan since last sync is not resurrected by reimport', () => {
  const base = BASE; // Task A2 existed at last sync
  const local = BASE.replace('  Task A2  3d\n', ''); // plan deliberately removed it
  const imported = BASE; // MS Project still has it (stale copy, or never told about the removal)
  const { entries } = diffTaskOutline(local, imported, base);
  assert.deepEqual(entries.filter((e) => e.key === 'Phase A › Task A2'), []);
});

test('with a base, a task added to the plan since last sync (not yet in MS Project) produces no entry', () => {
  const base = BASE; // Task A3 did not exist at last sync
  const local = BASE.replace('Phase B', '  Task A3  1d\nPhase B'); // plan added it locally
  const imported = BASE; // MS Project doesn't know about it yet
  const { entries } = diffTaskOutline(local, imported, base);
  assert.deepEqual(entries.filter((e) => e.key === 'Phase A › Task A3'), []);
});

test('with a base, a task removed from MS Project since last sync is still flagged removed', () => {
  const base = BASE;
  const local = BASE; // plan hasn't touched it
  const imported = BASE.replace('  Task A2  3d\n', ''); // MS Project removed it
  const { entries } = diffTaskOutline(local, imported, base);
  const entry = entries.find((e) => e.key === 'Phase A › Task A2');
  assert.equal(entry.kind, 'removed');
});

test('with a base, a genuinely new MS Project task (not in base) is still flagged added', () => {
  const base = BASE;
  const local = BASE;
  const imported = BASE + '\nPhase C\n  Task C1  1d';
  const { entries } = diffTaskOutline(local, imported, base);
  const keys = entries.map((e) => e.key);
  assert.ok(keys.includes('Phase C'));
  assert.ok(keys.includes('Phase C › Task C1'));
});

test('defaultTaskSyncChoice: conflict defaults to keep-mine', () => {
  assert.equal(defaultTaskSyncChoice('conflict'), 'keep-mine');
});

test('applyTaskDiff: an unreviewed conflict keeps the local value', () => {
  const base = BASE;
  const local = BASE.replace('Task A1  2d', 'Task A1  5d');
  const imported = BASE.replace('Task A1  2d', 'Task A1  9d');
  const diff = diffTaskOutline(local, imported, base);
  const result = applyTaskDiff(local, diff, {});
  assert.ok(result.includes('Task A1  5d'));
  assert.ok(!result.includes('Task A1  9d'));
});

test('applyTaskDiff: a conflict resolved keep-theirs takes the imported value', () => {
  const base = BASE;
  const local = BASE.replace('Task A1  2d', 'Task A1  5d');
  const imported = BASE.replace('Task A1  2d', 'Task A1  9d');
  const diff = diffTaskOutline(local, imported, base);
  const entry = diff.entries.find((e) => e.key === 'Phase A › Task A1');
  const result = applyTaskDiff(local, diff, { [entry.key]: 'keep-theirs' });
  assert.ok(result.includes('Task A1  9d'));
  assert.ok(!result.includes('Task A1  5d'));
});

test('a duration change on the second of two identically-named siblings matches the right one', () => {
  const local = ['Phase A', '  Review 1d', '  Build 1d', '  Review 1d'].join('\n');
  const imported = ['Phase A', '  Review 1d', '  Build 1d', '  Review 2d'].join('\n');
  const { entries, result } = applyAll(local, imported);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, 'updated');
  assert.equal(entries[0].key, 'Phase A › Review#2');
  assert.equal(result, imported);
});
