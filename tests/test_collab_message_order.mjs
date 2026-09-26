/**
 * Planning-session message ordering: the host and the joiner each handle
 * one incoming message at a time, in arrival order.
 *
 * The host (collab-session.js) used to start handleCollabMessage() for
 * every socket message without waiting for the previous one. Applying a
 * joiner's `plan_text_replace` checks its revision, writes the editor,
 * then awaits renderPlan() -- and only bumped the revision after that. Two
 * joiners replacing at the same revision therefore both passed the check:
 * the second overwrote the first, and the first never got an answer (no
 * snapshot of its text, no stale rejection), so its planSync.sentText
 * never cleared and it never sent another edit. A replacement that changed
 * nothing got no answer either.
 *
 * The joiner (collab-join.js) had the same shape: decrypting is async, so
 * a later snapshot could finish first and then be overwritten by an older
 * one.
 *
 * Both scripts run in tests/helpers/collab_pages.mjs's stand-in browser.
 *
 * Run with: node --test tests/test_collab_message_order.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  sleep, startHost, startJoiner, fromJoiner, fromHost, sentTo,
} from './helpers/collab_pages.mjs';

test('host: two joiners replacing at the same revision -- one applies, the other is told it is stale', async () => {
  const { host, editor, sockets } = await startHost();
  const socket = sockets[0];
  host.keys.set('j1', 'k1');
  host.keys.set('j2', 'k2');

  const first = 'Phase\n  Build 2d\n  Test 1d\n';
  const second = 'Phase\n  Build 5d\n';
  // Two socket messages back to back, as the relay delivers them.
  socket.deliver(fromJoiner('j1', { type: 'plan_text_replace', rev: 0, text: first }));
  socket.deliver(fromJoiner('j2', { type: 'plan_text_replace', rev: 0, text: second }));
  await sleep(200);

  assert.equal(editor.value, first, "the second replacement overwrote the first one's edit");
  assert.equal(host.rev(), 1);
  const toFirst = sentTo(socket, 'j1');
  assert.ok(toFirst.some((m) => m.type === 'plan_snapshot' && m.rev === 1 && m.plan_text === first),
    'the first joiner never saw its edit come back, so it would wait for an answer forever');
  const toSecond = sentTo(socket, 'j2');
  assert.ok(toSecond.some((m) => m.type === 'plan_text_replace_rejected' && m.reason === 'stale'),
    'the second joiner was not told its replacement was stale');
});

test('host: a replacement that changes nothing is still answered with a snapshot of it', async () => {
  const { host, editor, sockets } = await startHost();
  const socket = sockets[0];
  host.keys.set('j1', 'k1');
  // The joiner sends exactly the host's text (the host already has it).
  socket.deliver(fromJoiner('j1', { type: 'plan_text_replace', rev: 0, text: editor.value }));
  await sleep(100);
  const toJoiner = sentTo(socket, 'j1');
  assert.ok(toJoiner.some((m) => m.type === 'plan_snapshot' && m.plan_text === editor.value && m.rev > 0),
    'no answer: the joiner keeps waiting on this replacement and never sends another');
});

test('host: the revision moves as soon as the editor changes, before the render finishes', async () => {
  const { host, editor, sockets } = await startHost({ renderDelay: 100 });
  host.keys.set('j1', 'k1');
  const next = 'Phase\n  Build 3d\n';
  sockets[0].deliver(fromJoiner('j1', { type: 'plan_text_replace', rev: 0, text: next }));
  await sleep(40);
  assert.equal(editor.value, next);
  assert.equal(host.rev(), 1, 'the editor holds the new text while the revision still names the old one');
  await sleep(150);
});

// ---------------------------------------------------------------------------
// The joiner
// ---------------------------------------------------------------------------

test('joiner: the first snapshot, at revision 0, is shown', async () => {
  const { join, socket, editor } = await startJoiner();
  socket.deliver(fromHost({ type: 'plan_snapshot', rev: 0, plan_text: 'Phase\n  Build 2d\n' }));
  await sleep(30);
  assert.equal(editor.value, 'Phase\n  Build 2d\n');
  assert.equal(join.planSync.rev, 0);
});

test('joiner: snapshots are handled in arrival order even when decrypting one takes longer', async () => {
  const { join, socket, editor } = await startJoiner();
  socket.deliver(fromHost({ type: 'plan_snapshot', rev: 1, plan_text: 'one' }, 40));
  socket.deliver(fromHost({ type: 'plan_snapshot', rev: 2, plan_text: 'two' }));
  await sleep(100);
  assert.equal(join.planSync.rev, 2);
  assert.equal(editor.value, 'two', 'the older snapshot, decrypted last, replaced the newer one');
});

test('joiner: a snapshot older than the one already shown is ignored', async () => {
  const { join, socket, editor } = await startJoiner();
  socket.deliver(fromHost({ type: 'plan_snapshot', rev: 3, plan_text: 'three' }));
  socket.deliver(fromHost({ type: 'plan_snapshot', rev: 2, plan_text: 'two' }));
  await sleep(60);
  assert.equal(join.planSync.rev, 3);
  assert.equal(join.planSync.synced, 'three');
  assert.equal(editor.value, 'three');
});
