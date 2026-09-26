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
 * Both scripts run here in a vm with a stand-in DOM and socket; the crypto
 * module is a transparent fake (frames are JSON), the plan-op modules are
 * the real ones.
 *
 * Run with: node --test tests/test_collab_message_order.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

// collab-ops.js reads plan-model.js from globalThis (see test_collab_ops.mjs).
import '../packages/noodle-web/src/noodle_web/static/plan-model.js';
import * as collabOps from '../packages/noodle-web/src/noodle_web/static/collab-ops.js';
import * as backmatterOps from '../packages/noodle-web/src/noodle_web/static/collab-backmatter-ops.js';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const staticDir = join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'static');
const read = (name) => readFileSync(join(staticDir, name), 'utf8');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The pages' own timers (the joiner's presence ping, notice timeouts, the
// host's autosave debounce) must not keep this test process alive.
const timers = {
  setTimeout: (fn, ms, ...args) => { const t = setTimeout(fn, ms, ...args); t.unref(); return t; },
  setInterval: (fn, ms, ...args) => { const t = setInterval(fn, ms, ...args); t.unref(); return t; },
  clearTimeout, clearInterval,
};

// ---------------------------------------------------------------------------
// A stand-in DOM, socket and crypto module
// ---------------------------------------------------------------------------

function fakeElement(id) {
  const classes = new Set();
  const listeners = {};
  return {
    id, value: '', textContent: '', innerHTML: '', hidden: false, disabled: false,
    style: {}, scrollTop: 0, scrollHeight: 0, dataset: {},
    classList: {
      add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c),
      toggle: (c, force) => {
        const on = force === undefined ? !classes.has(c) : !!force;
        if (on) classes.add(c); else classes.delete(c);
        return on;
      },
    },
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    removeEventListener: () => {},
    dispatchEvent(event) { for (const fn of listeners[event.type] || []) fn(event); return true; },
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    appendChild: (child) => child, remove() {}, querySelector: () => null, querySelectorAll: () => [],
    focus() {}, select() {},
  };
}

function fakeDocument() {
  const elements = new Map();
  return {
    elements,
    readyState: 'complete',
    body: fakeElement('body'),
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, fakeElement(id));
      return elements.get(id);
    },
    createElement: (tag) => fakeElement(tag),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
  };
}

class FakeEvent {
  constructor(type, init) { this.type = type; Object.assign(this, init || {}); }
}

/** The WebSocket stand-in: records what the page sends, and lets a test
 * deliver messages to the page's listeners. */
function fakeWebSocketClass(sockets) {
  return class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    constructor(url) {
      this.url = url;
      this.readyState = 1;
      this.sent = [];
      this.listeners = {};
      sockets.push(this);
    }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    send(data) { this.sent.push(data); }
    close() {}
    deliver(data) { for (const fn of this.listeners.message || []) fn({ data }); }
  };
}

// Frames are JSON: {kind, ...}. "Encryption" is the identity, with an
// optional per-frame delay so a test can make an earlier message's
// decryption finish after a later one's.
const fakeCrypto = {
  classifyFrameType: (raw) => { try { return JSON.parse(raw).kind || 'unrecognized'; } catch { return 'unrecognized'; } },
  unwrapFromJoiner: (raw) => { const f = JSON.parse(raw); return { joinerId: f.joiner, frame: f.frame }; },
  async decryptMessage(key, frame) {
    const f = JSON.parse(frame);
    if (f.delay) await sleep(f.delay);
    return f.plaintext;
  },
  encryptMessage: async (key, plaintext) => plaintext,
  buildToJoinerEnvelope: (joinerId, ciphertext) => JSON.stringify({ to: joinerId, ciphertext }),
  deriveConnectKey: async () => 'connect-key',
  generateEphemeralKeyPair: async () => ({ privateKey: 'private' }),
  buildPubkeyAnnouncement: async () => JSON.stringify({ kind: 'host_pubkey' }),
  parsePubkeyAnnouncement: async () => 'peer-key',
  deriveSessionKey: async () => 'session-key',
};

const fromJoiner = (joiner, payload, delay) => JSON.stringify({
  kind: 'from_joiner', joiner, frame: JSON.stringify({ kind: 'enc', plaintext: JSON.stringify(payload), delay }),
});

// ---------------------------------------------------------------------------
// The host
// ---------------------------------------------------------------------------

async function startHost({ renderDelay = 20, secure = true } = {}) {
  const sockets = [];
  const fetches = [];
  const toasts = [];
  const document = fakeDocument();
  const sandbox = {
    console, ...timers, queueMicrotask, document,
    Event: FakeEvent,
    WebSocket: fakeWebSocketClass(sockets),
    isSecureContext: secure,
    crypto: secure ? { subtle: {}, randomUUID: () => 'id' } : { randomUUID: () => 'id' },
    location: { protocol: secure ? 'https:' : 'http:', host: 'planner.test', origin: 'https://planner.test' },
    matchMedia: () => ({ matches: true }),
    dispatchEvent() {},
    async fetch(url) {
      fetches.push(url);
      return { ok: true, json: async () => ({ session_id: 's1', join_code: 'ABC123', holding_url: '/join', host_token: 't' }) };
    },
    async renderPlan() { await sleep(renderDelay); },
    showToast: (message, kind) => toasts.push({ message, kind }),
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('collab-session.js') + `
;globalThis.__host = {
  useModules(crypto, ops, backmatter) {
    cryptoModule = Promise.resolve(crypto);
    opsModule = Promise.resolve(ops);
    backmatterOpsModule = Promise.resolve(backmatter);
    autosaveModule = Promise.resolve({ COLLAB_AUTOSAVE_DEBOUNCE_MS: 5, clearCollabAutosaveIfCurrent() {} });
  },
  keys: collabSessionKeys,
  rev: () => collabPlanRev,
  live: () => isCollabSessionLive(),
};`, sandbox);
  const host = sandbox.__host;
  host.useModules(fakeCrypto, collabOps, backmatterOps);
  const editor = document.getElementById('planEditor');
  editor.value = 'Phase\n  Build 2d\n';
  await sandbox.startCollabSession();
  return { sandbox, host, editor, sockets, fetches, toasts, document };
}

/** Everything the host sent to `joiner`, decoded. */
function sentTo(socket, joiner) {
  return socket.sent
    .map((raw) => { try { return JSON.parse(raw); } catch { return null; } })
    .filter((m) => m && m.to === joiner)
    .map((m) => JSON.parse(m.ciphertext));
}

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

async function startJoiner() {
  const sockets = [];
  const document = fakeDocument();
  const sandbox = {
    console, ...timers, queueMicrotask, document,
    Event: FakeEvent,
    Element: class {},
    WebSocket: fakeWebSocketClass(sockets),
    isSecureContext: true,
    crypto: { subtle: {}, randomUUID: () => 'id' },
    location: { protocol: 'https:', host: 'planner.test' },
    NoodleCollabChat: { render() {} },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('collab-merge.js'), sandbox);
  vm.runInContext(read('collab-undo.js'), sandbox);
  vm.runInContext(read('collab-join.js') + `
;globalThis.__join = {
  useModules(crypto) {
    cryptoModulePromise = Promise.resolve(crypto);
    localParseModulePromise = Promise.resolve({ localParse: () => ({ success: true, tasks: [] }) });
  },
  planSync,
};`, sandbox);
  const join = sandbox.__join;
  join.useModules(fakeCrypto);
  document.getElementById('joinCode').value = 'ABC123';
  document.getElementById('displayName').value = 'Sam';
  await sandbox.joinSession({ preventDefault() {} });
  const socket = sockets[0];
  socket.deliver(JSON.stringify({ type: 'joined', session_id: 's1', display_name: 'Sam' }));
  socket.deliver(JSON.stringify({ kind: 'host_pubkey' }));
  await sleep(20);
  return { sandbox, join, socket, editor: document.getElementById('planEditor') };
}

const fromHost = (payload, delay) => JSON.stringify({ kind: 'enc', plaintext: JSON.stringify(payload), delay });

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
