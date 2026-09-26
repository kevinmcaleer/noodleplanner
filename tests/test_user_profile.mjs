/**
 * The user's own profile (#1377, static/user-profile.js): what it keeps, and
 * that it keeps working when the browser's storage does not.
 *
 * Each case loads the script into a fresh context with its own localStorage
 * stand-in, because the module holds the profile in memory once read.
 *
 * Run with: node --test tests/test_user_profile.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(
    path.join(here, '..', 'packages/noodle-web/src/noodle_web/static/user-profile.js'),
    'utf8',
);

function memoryStorage(initial = {}) {
    const items = new Map(Object.entries(initial));
    return {
        items,
        getItem: (key) => (items.has(key) ? items.get(key) : null),
        setItem: (key, value) => { items.set(key, String(value)); },
        removeItem: (key) => { items.delete(key); },
    };
}

/** A fresh copy of the module. `storage` is what `localStorage` gives back;
 * pass a function to make reading `localStorage` itself throw. */
function load(storage) {
    const sandbox = {};
    if (typeof storage === 'function') {
        Object.defineProperty(sandbox, 'localStorage', { get: storage });
    } else {
        sandbox.localStorage = storage;
    }
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    return sandbox.NoodleUserProfile;
}

const KEY = 'np-user-profile';

// Objects made inside the vm context have that context's Object.prototype,
// which deepEqual would count as a difference; compare their plain JSON.
const plain = (value) => JSON.parse(JSON.stringify(value));

test('normalise keeps what the resource form keeps, cleaned', () => {
    const profile = load(memoryStorage());
    assert.deepEqual(plain(profile.normalise({
        shortname: ' @alice ',
        fullName: '  Alice \n  Smith ',
        role: 'Project\tManager',
        email: ' alice@example.com ',
        allocation: '42.6',
        nonWorkingDays: [
            { name: 'Doctor', start: '2026-04-01', finish: '' },
            { name: 'Leave', start: '2026-03-01', finish: '2026-03-14' },
        ],
    })), {
        shortname: 'alice',
        fullName: 'Alice Smith',
        role: 'Project Manager',
        email: 'alice@example.com',
        allocation: 43,
        nonWorkingDays: [
            { name: 'Leave', start: '2026-03-01', finish: '2026-03-14' },
            { name: 'Doctor', start: '2026-04-01', finish: '' },
        ],
    });
});

test('nothing in it is no profile at all', () => {
    const profile = load(memoryStorage());
    assert.equal(profile.normalise(null), null);
    assert.equal(profile.normalise('Alice'), null);
    assert.equal(profile.normalise([]), null);
    assert.equal(profile.normalise({}), null);
    assert.equal(profile.normalise({ fullName: '   ', allocation: '', nonWorkingDays: [] }), null);
});

test('a shortname loses what would end it in a plan', () => {
    const profile = load(memoryStorage());
    assert.equal(profile.normalise({ shortname: '@@al ice:x,y@z' }).shortname, 'alicexyz');
});

test('allocation is a whole percentage from 0 to 100, or nothing', () => {
    const profile = load(memoryStorage());
    const allocation = (value) => profile.normalise({ fullName: 'A', allocation: value }).allocation;
    assert.equal(allocation(150), 100);
    assert.equal(allocation(-5), 0);
    assert.equal(allocation('abc'), null);
    assert.equal(allocation(''), null);
    assert.equal(allocation(undefined), null);
    assert.equal(allocation('0'), 0);
});

test('non-working days need a real start, and a finish no earlier than it', () => {
    const profile = load(memoryStorage());
    const days = profile.normalise({
        fullName: 'A',
        nonWorkingDays: [
            { name: 'No start', start: '', finish: '2026-01-02' },
            { name: 'Bad start', start: 'tomorrow' },
            { name: 'Backwards', start: '2026-05-10', finish: '2026-05-01' },
            'not an entry',
        ],
    }).nonWorkingDays;
    assert.deepEqual(plain(days), [{ name: 'Backwards', start: '2026-05-10', finish: '' }]);
});

test('names are capped where the server caps a joiner name', () => {
    const profile = load(memoryStorage());
    assert.equal(profile.normalise({ fullName: 'x'.repeat(300) }).fullName.length, 100);
});

test('displayName is the full name, else the shortname, else nothing', () => {
    const profile = load(memoryStorage());
    assert.equal(profile.displayName({ fullName: 'Alice Smith', shortname: 'alice' }), 'Alice Smith');
    assert.equal(profile.displayName({ fullName: '', shortname: 'alice' }), 'alice');
    assert.equal(profile.displayName(null), '');
});

test('a saved profile is read back, in the page and after a reload', () => {
    const storage = memoryStorage();
    const profile = load(storage);
    assert.equal(profile.get(), null);
    assert.equal(profile.set({ fullName: 'Mary Jane Watson', role: 'PM' }), true);
    assert.equal(profile.get().fullName, 'Mary Jane Watson');
    assert.deepEqual(JSON.parse(storage.getItem(KEY)), plain(profile.get()));

    const reloaded = load(storage);
    assert.equal(reloaded.get().role, 'PM');
});

test('saving an empty profile, or clearing it, removes it', () => {
    const storage = memoryStorage();
    const profile = load(storage);
    profile.set({ fullName: 'Alice' });
    profile.set({ fullName: '  ' });
    assert.equal(storage.getItem(KEY), null);
    assert.equal(profile.get(), null);

    profile.set({ fullName: 'Alice' });
    assert.equal(profile.clear(), true);
    assert.equal(storage.getItem(KEY), null);
    assert.equal(profile.get(), null);
});

test('a hand-edited or corrupt stored value cannot break the page', () => {
    assert.equal(load(memoryStorage({ [KEY]: '{not json' })).get(), null);
    assert.equal(load(memoryStorage({ [KEY]: '"Alice"' })).get(), null);
    const edited = load(memoryStorage({ [KEY]: JSON.stringify({ fullName: 'Alice\nAdmin', allocation: 900 }) }));
    assert.equal(edited.get().fullName, 'Alice Admin');
    assert.equal(edited.get().allocation, 100);
});

test('with storage blocked, the profile still lasts for the page', () => {
    const profile = load(() => { throw new Error('SecurityError: storage is disabled'); });
    assert.equal(profile.get(), null);
    assert.equal(profile.set({ fullName: 'Alice' }), false, 'reports it did not persist');
    assert.equal(profile.get().fullName, 'Alice', 'but this page still has it');
    assert.equal(profile.clear(), false);
    assert.equal(profile.get(), null);
});

test('a full storage quota is reported, not thrown', () => {
    const storage = memoryStorage();
    storage.setItem = () => { throw new Error('QuotaExceededError'); };
    const profile = load(storage);
    assert.equal(profile.set({ fullName: 'Alice' }), false);
    assert.equal(profile.get().fullName, 'Alice');
});

test('no localStorage at all is the same as an empty one', () => {
    const profile = load(undefined);
    assert.equal(profile.get(), null);
    assert.equal(profile.set({ fullName: 'Alice' }), false);
    assert.equal(profile.get().fullName, 'Alice');
});
