/**
 * Account sync (static/account-sync.js): the rules for moving plans between
 * this browser's store and the signed-in account's plans on the server.
 *
 * The server here is a small in-memory copy of accounts_routes.py's plan API
 * (revisions, 409 with the server's copy on a stale PUT), and each "browser"
 * is an in-memory store, so two devices can be run against one account.
 *
 * Run with: node --test tests/test_account_sync.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(
    path.join(here, '..', 'packages/noodle-web/src/noodle_web/static/account-sync.js'),
    'utf8',
);
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const { createSync, meaningful } = sandbox.NoodleSync;

/** The plan API of accounts_routes.py, one account per cookie-less "session". */
function makeServer() {
    const users = { alice: { id: 'u-alice', email: 'a@example.com' }, bob: { id: 'u-bob', email: 'b@example.com' } };
    const plans = { 'u-alice': new Map(), 'u-bob': new Map() };
    let seq = 0;
    const server = { plans, failNext: null, requests: [], of: (id) => plans[id] };
    server.fetchFor = (who) => async (url, init) => {
        const method = init.method;
        server.requests.push(method + ' ' + url);
        const reply = (status, body) => ({ status, json: async () => body });
        if (url === '/api/v1/session' && who === null) return reply(200, { user: null });
        if (who === null) return reply(401, { detail: 'Sign in required.' });
        const user = users[who];
        if (url === '/api/v1/session') return reply(200, { user });
        const mine = plans[user.id];
        const body = init.body ? JSON.parse(init.body) : null;
        const full = (p) => ({ ...p });
        const summary = (p) => ({ id: p.id, name: p.name, revision: p.revision });
        if (url === '/api/v1/me') return reply(200, user);
        if (url === '/api/v1/plans' && method === 'GET') return reply(200, { plans: [...mine.values()].map(summary) });
        if (url === '/api/v1/plans' && method === 'POST') {
            if (server.failNext === body.name) return reply(422, { detail: 'Plan is too large.' });
            const p = { id: 'srv-' + (++seq), name: body.name, content: body.content, revision: 1 };
            mine.set(p.id, p);
            return reply(201, full(p));
        }
        const id = decodeURIComponent(url.split('/').pop());
        const p = mine.get(id);
        if (!p) return reply(404, { detail: 'Plan not found.' });
        if (method === 'GET') return reply(200, full(p));
        if (method === 'DELETE') { mine.delete(id); return { status: 204, json: async () => null }; }
        if (method === 'PUT') {
            if (body.base_revision !== p.revision) {
                return reply(409, { detail: 'The plan changed on the server.', current: full(p) });
            }
            p.name = body.name ?? p.name;
            p.content = body.content ?? p.content;
            p.revision += 1;
            return reply(200, full(p));
        }
        throw new Error('unexpected ' + method + ' ' + url);
    };
    return server;
}

/** One browser: a store adapter over a Map, plus its sync state in memory. */
function makeBrowser(server, who, initial = {}) {
    const projects = new Map(Object.entries(initial).map(([id, [name, text]]) => [id, { id, name, planText: text }]));
    let n = 0;
    const browser = {
        projects, current: null, editor: null, reloads: [], changed: 0,
        storage: new Map(),
        who,
        store: {
            list: () => [...projects.values()].map((p) => ({ ...p })),
            create(name, text) { const id = 'local-' + (++n) + '-' + Math.random().toString(36).slice(2, 6); projects.set(id, { id, name, planText: text }); return id; },
            update(id, f) { Object.assign(projects.get(id), f); },
            remove(id) { projects.delete(id); },
            currentId: () => browser.current,
            editorText: () => browser.editor,
            flush() {},
            reloadCurrent(id) { browser.reloads.push(id); },
        },
    };
    browser.sync = createSync({
        fetch: server.fetchFor(who),
        store: browser.store,
        storage: { getItem: (k) => browser.storage.get(k) ?? null, setItem: (k, v) => browser.storage.set(k, v) },
        now: () => Date.UTC(2026, 9, 11, 12, 0, 0),
        onChanged: () => { browser.changed++; },
    });
    return browser;
}

const texts = (b) => [...b.projects.values()].map((p) => p.name + ':' + p.planText).sort();

test('nothing happens until sync is turned on', async () => {
    const server = makeServer();
    const b = makeBrowser(server, 'alice', { p1: ['Plan', 'Task 1'] });
    await b.sync.sync();
    assert.equal(b.sync.getStatus().kind, 'off');
    assert.equal(server.plans['u-alice'].size, 0);
});

test('signed out is reported and nothing is touched', async () => {
    const server = makeServer();
    const b = makeBrowser(server, null, { p1: ['Plan', 'Task 1'] });
    await b.sync.enable();
    assert.equal(b.sync.getStatus().kind, 'signed-out');
    assert.deepEqual(texts(b), ['Plan:Task 1']);
});

test('first sync uploads local plans; a second device downloads them', async () => {
    const server = makeServer();
    const a = makeBrowser(server, 'alice', { p1: ['Launch', 'Task 1'], p2: ['Other', 'Task 2'] });
    await a.sync.enable();
    assert.equal(server.plans['u-alice'].size, 2);
    assert.equal(a.sync.getStatus().summary.created, 2);

    const b = makeBrowser(server, 'alice');
    await b.sync.enable();
    assert.deepEqual(texts(b), ['Launch:Task 1', 'Other:Task 2']);
    assert.equal(b.sync.getStatus().summary.downloaded, 2);

    // A further run changes nothing.
    server.requests.length = 0;
    await b.sync.sync();
    assert.deepEqual(server.requests.filter((r) => !r.startsWith('GET')), []);
    assert.equal(server.plans['u-alice'].size, 2);
});

test('an edit on one device reaches the other', async () => {
    const server = makeServer();
    const a = makeBrowser(server, 'alice', { p1: ['Launch', 'v1'] });
    await a.sync.enable();
    const b = makeBrowser(server, 'alice');
    await b.sync.enable();

    a.projects.get('p1').planText = 'v2';
    await a.sync.sync();
    await b.sync.sync();
    assert.deepEqual(texts(b), ['Launch:v2']);

    const [bid] = [...b.projects.keys()];
    b.projects.get(bid).name = 'Renamed';
    await b.sync.sync();
    await a.sync.sync();
    assert.equal(a.projects.get('p1').name, 'Renamed');
});

test('both devices edit: the server copy wins, the other text is kept as a conflict copy', async () => {
    const server = makeServer();
    const a = makeBrowser(server, 'alice', { p1: ['Launch', 'base'] });
    await a.sync.enable();
    const b = makeBrowser(server, 'alice');
    await b.sync.enable();

    a.projects.get('p1').planText = 'from A';
    await a.sync.sync();                                  // server: from A
    const [bid] = [...b.projects.keys()];
    b.projects.get(bid).planText = 'from B';
    await b.sync.sync();                                  // B's push is stale

    assert.equal(b.sync.getStatus().summary.conflicts, 1);
    assert.equal(b.projects.get(bid).planText, 'from A');
    const copies = [...b.projects.values()].filter((p) => p.id !== bid);
    assert.equal(copies.length, 1);
    assert.equal(copies[0].planText, 'from B');
    assert.equal(copies[0].name, 'Launch (conflict 2026-10-11)');

    // The conflict copy is itself uploaded, and A ends up with both.
    await a.sync.sync();
    assert.deepEqual(texts(a), ['Launch (conflict 2026-10-11):from B', 'Launch:from A']);
    assert.deepEqual(texts(b), texts(a));
});

test('the autosave timestamp alone never counts as an edit', async () => {
    const server = makeServer();
    const body = (stamp) => `---\ntitle: P\nlast_saved: ${stamp}\n---\nTask 1`;
    const a = makeBrowser(server, 'alice', { p1: ['P', body('2026-10-11 10:00')] });
    await a.sync.enable();
    const b = makeBrowser(server, 'alice');
    await b.sync.enable();

    a.projects.get('p1').planText = body('2026-10-11 10:01');
    const [bid] = [...b.projects.keys()];
    b.projects.get(bid).planText = body('2026-10-11 10:02');
    server.requests.length = 0;
    await a.sync.sync();
    await b.sync.sync();
    assert.deepEqual(server.requests.filter((r) => !r.startsWith('GET')), []);
    assert.equal(meaningful(body('x')), '---\ntitle: P\n---\nTask 1');
});

test('deleting a plan here deletes it on the server and on the other device', async () => {
    const server = makeServer();
    const a = makeBrowser(server, 'alice', { p1: ['Launch', 'x'], p2: ['Keep', 'y'] });
    await a.sync.enable();
    const b = makeBrowser(server, 'alice');
    await b.sync.enable();

    a.projects.delete('p1');
    await a.sync.sync();
    assert.equal(server.plans['u-alice'].size, 1);
    await b.sync.sync();
    assert.deepEqual(texts(b), ['Keep:y']);
});

test('a plan removed on the server is kept if it was edited, or open, or the server looks reset', async () => {
    const server = makeServer();
    const a = makeBrowser(server, 'alice', { p1: ['Edited', 'x'], p2: ['Open', 'y'], p3: ['Untouched', 'z'] });
    await a.sync.enable();
    server.plans['u-alice'] = new Map([...server.plans['u-alice']].filter(([, p]) => p.name === 'Untouched'));
    // p3 stays on the server; p1 and p2 vanish from it.
    a.projects.get('p1').planText = 'edited here';
    a.current = 'p2';
    await a.sync.sync();
    assert.ok(a.projects.has('p1') && a.projects.has('p2') && a.projects.has('p3'));
    // Both survivors were re-uploaded rather than lost.
    assert.deepEqual([...server.plans['u-alice'].values()].map((p) => p.name).sort(), ['Edited', 'Open', 'Untouched']);

    // An untouched plan deleted elsewhere goes.
    const [sid] = [...server.plans['u-alice']].find(([, p]) => p.name === 'Untouched');
    server.plans['u-alice'].delete(sid);
    await a.sync.sync();
    assert.ok(!a.projects.has('p3'));

    // A wholly empty listing is treated as a reset server, not as "delete everything".
    server.plans['u-alice'] = new Map();
    await a.sync.sync();
    assert.ok(a.projects.has('p1') && a.projects.has('p2'));
    assert.equal(server.plans['u-alice'].size, 2);
});

test('a pull into the open plan reloads the editor, unless typing landed meanwhile', async () => {
    const server = makeServer();
    const a = makeBrowser(server, 'alice', { p1: ['Launch', 'v1'] });
    await a.sync.enable();
    const b = makeBrowser(server, 'alice');
    await b.sync.enable();
    const [bid] = [...b.projects.keys()];
    b.current = bid;
    b.editor = 'v1';

    a.projects.get('p1').planText = 'v2';
    await a.sync.sync();
    await b.sync.sync();
    assert.equal(b.projects.get(bid).planText, 'v2');
    assert.deepEqual(b.reloads, [bid]);

    // Now B types something and the server also moves on: B's text is not overwritten.
    a.projects.get('p1').planText = 'v3';
    await a.sync.sync();
    b.editor = 'v2 plus typing';
    await b.sync.sync();
    assert.equal(b.projects.get(bid).planText, 'v2');
    assert.deepEqual(b.reloads, [bid]);
});

test('signing in as a different account never carries plans across', async () => {
    const server = makeServer();
    const a = makeBrowser(server, 'alice', { p1: ['Alice plan', 'x'] });
    await a.sync.enable();
    // Same browser, different account.
    const asBob = createSync({
        fetch: server.fetchFor('bob'),
        store: a.store,
        storage: { getItem: (k) => a.storage.get(k) ?? null, setItem: (k, v) => a.storage.set(k, v) },
    });
    await asBob.sync();
    assert.equal(asBob.getStatus().kind, 'off');
    assert.equal(server.plans['u-bob'].size, 0);
    assert.equal(a.projects.size, 1);
});

test('one plan failing does not stop the others, and is reported', async () => {
    const server = makeServer();
    server.failNext = 'Huge';
    const a = makeBrowser(server, 'alice', { p1: ['Huge', 'x'], p2: ['Fine', 'y'] });
    await a.sync.enable();
    const s = a.sync.getStatus();
    assert.equal(s.kind, 'error');
    assert.match(s.error, /Huge: Plan is too large/);
    assert.deepEqual([...server.plans['u-alice'].values()].map((p) => p.name), ['Fine']);
});

test('disabling stops syncing and leaves both sides alone', async () => {
    const server = makeServer();
    const a = makeBrowser(server, 'alice', { p1: ['Launch', 'x'] });
    await a.sync.enable();
    a.sync.disable();
    a.projects.delete('p1');
    await a.sync.sync();
    assert.equal(server.plans['u-alice'].size, 1);
    assert.equal(a.sync.getStatus().kind, 'off');
});
