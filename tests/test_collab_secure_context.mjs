/**
 * Planning sessions over plain HTTP.
 *
 * A session is end-to-end encrypted with the Web Crypto API, which a
 * browser only provides in a secure context (HTTPS, or localhost). Opened
 * over plain HTTP on a LAN address, `crypto.subtle` is undefined. The host
 * then asked the server for a session, showed "Session live" and a join
 * code, and only then threw from deriveConnectKey() -- inside a
 * try/finally with no catch, so the dialog kept advertising a session no
 * one could join. The joiner threw from generateEphemeralKeyPair() and sat
 * on "Connecting..." with the Join button disabled.
 *
 * Both pages run in tests/helpers/collab_pages.mjs's stand-in browser.
 *
 * Run with: node --test tests/test_collab_secure_context.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { sleep, startHost, loadJoiner } from './helpers/collab_pages.mjs';

test('host: without a secure context no session is started, and the dialog says why', async () => {
  const { host, fetches, sockets, toasts, document } = await startHost({ secure: false });
  assert.deepEqual(fetches, [], 'asked the server for a session it cannot encrypt');
  assert.equal(sockets.length, 0);
  assert.equal(host.live(), false);
  const status = document.getElementById('collabSessionStatus').textContent;
  assert.doesNotMatch(status, /Session live/);
  assert.match(status, /https/i);
  assert.notEqual(document.getElementById('collabSessionDetails').style.display, 'block',
    'the join code is on show for a session no one can join');
  assert.ok(toasts.some((t) => t.kind === 'error'));
});

test('host: a failure setting up the keys is reported, not left as "Session live"', async () => {
  const { host, document, sockets, toasts } = await startHost({ cryptoFails: true });
  assert.equal(sockets.length, 0);
  assert.equal(host.live(), false);
  const status = document.getElementById('collabSessionStatus').textContent;
  assert.doesNotMatch(status, /Session live/);
  assert.notEqual(document.getElementById('collabSessionDetails').style.display, 'block');
  assert.ok(toasts.some((t) => t.kind === 'error'));
});

test('joiner: without a secure context, joining says why and the form stays usable', async () => {
  const { sandbox, sockets, document } = loadJoiner({ secure: false });
  await sandbox.joinSession({ preventDefault() {} });
  await sleep(10);
  assert.equal(sockets.length, 0, 'opened a socket it can never secure');
  assert.match(document.getElementById('status').textContent, /https/i);
  assert.equal(document.getElementById('joinBtn').disabled, false, 'the Join button stayed disabled');
});
