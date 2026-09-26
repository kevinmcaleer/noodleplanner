/**
 * A stand-in browser for the planning-session pages: runs collab-session.js
 * (the host) or collab-join.js (the joiner) in a vm with a fake DOM, a fake
 * WebSocket and a transparent fake crypto module (frames are JSON), so a
 * test can drive socket messages and read what the page did. The plan-op
 * modules the host loads are the real ones.
 *
 * Used by tests/test_collab_message_order.mjs and
 * tests/test_collab_secure_context.mjs.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

// collab-ops.js reads plan-model.js from globalThis (see test_collab_ops.mjs).
import '../../packages/noodle-web/src/noodle_web/static/plan-model.js';
import * as collabOps from '../../packages/noodle-web/src/noodle_web/static/collab-ops.js';
import * as backmatterOps from '../../packages/noodle-web/src/noodle_web/static/collab-backmatter-ops.js';

const repo = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const staticDir = join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'static');
const read = (name) => readFileSync(join(staticDir, name), 'utf8');

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

/** The fake crypto module as the page in `sandbox` sees it: like the real
 * one, key setup throws when the page has no crypto.subtle (or, with
 * `fails`, regardless). */
function cryptoFor(sandbox, { fails = false } = {}) {
  const needsSubtle = (value) => async () => {
    if (fails || !sandbox.crypto.subtle) throw new TypeError("Cannot read properties of undefined (reading 'importKey')");
    return value;
  };
  return {
    ...fakeCrypto,
    deriveConnectKey: needsSubtle('connect-key'),
    generateEphemeralKeyPair: needsSubtle({ privateKey: 'private' }),
  };
}

export const fromJoiner = (joiner, payload, delay) => JSON.stringify({
  kind: 'from_joiner', joiner, frame: JSON.stringify({ kind: 'enc', plaintext: JSON.stringify(payload), delay }),
});

// ---------------------------------------------------------------------------
// The host
// ---------------------------------------------------------------------------

/** The host's app page, after the planning-session button was pressed.
 * `secure: false` is the app opened over plain HTTP on a LAN address;
 * `cryptoFails` makes the key setup throw even in a secure context. */
export async function startHost({ renderDelay = 20, secure = true, cryptoFails = false } = {}) {
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
  host.useModules(cryptoFor(sandbox, { fails: cryptoFails }), collabOps, backmatterOps);
  const editor = document.getElementById('planEditor');
  editor.value = 'Phase\n  Build 2d\n';
  await sandbox.startCollabSession();
  return { sandbox, host, editor, sockets, fetches, toasts, document };
}

/** Everything the host sent to `joiner`, decoded. */
export function sentTo(socket, joiner) {
  return socket.sent
    .map((raw) => { try { return JSON.parse(raw); } catch { return null; } })
    .filter((m) => m && m.to === joiner)
    .map((m) => JSON.parse(m.ciphertext));
}

// ---------------------------------------------------------------------------
// The joiner
// ---------------------------------------------------------------------------

/** The joiner page, loaded, with the join form filled in but not sent.
 * `secure: false` is a page opened over plain HTTP on a LAN address: no
 * isSecureContext, so no crypto.subtle. */
export function loadJoiner({ secure = true } = {}) {
  const sockets = [];
  const document = fakeDocument();
  const sandbox = {
    console, ...timers, queueMicrotask, document,
    Event: FakeEvent,
    Element: class {},
    WebSocket: fakeWebSocketClass(sockets),
    isSecureContext: secure,
    crypto: secure ? { subtle: {}, randomUUID: () => 'id' } : { randomUUID: () => 'id' },
    location: { protocol: secure ? 'https:' : 'http:', host: 'planner.test' },
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
  join.useModules(cryptoFor(sandbox));
  document.getElementById('joinCode').value = 'ABC123';
  document.getElementById('displayName').value = 'Sam';
  return { sandbox, join, sockets, document };
}

/** The joiner page, joined, with its secure channel to the host up. */
export async function startJoiner() {
  const { sandbox, join, sockets, document } = loadJoiner();
  await sandbox.joinSession({ preventDefault() {} });
  const socket = sockets[0];
  socket.deliver(JSON.stringify({ type: 'joined', session_id: 's1', display_name: 'Sam' }));
  socket.deliver(JSON.stringify({ kind: 'host_pubkey' }));
  await sleep(20);
  return { sandbox, join, socket, editor: document.getElementById('planEditor') };
}

export const fromHost = (payload, delay) => JSON.stringify({ kind: 'enc', plaintext: JSON.stringify(payload), delay });
