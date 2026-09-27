/**
 * The view catalogue (#1380, #1387, static/view-catalogue.js) against the
 * router: every view a person can navigate to has a label, an icon and a
 * phone tier, and the catalogue's groups are the router's own constants, not
 * a second hand-kept list.
 *
 * The router's registrations are read from the source (script.js registers
 * each view by name), because script.js needs a whole document to run.
 *
 * Run with: node --test tests/test_view_catalogue.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.join(here, '..', 'packages/noodle-web/src/noodle_web/static');
const read = (name) => fs.readFileSync(path.join(staticDir, name), 'utf8');

function load() {
    const sandbox = { console };
    vm.createContext(sandbox);
    // state.js first, as index.html loads it: its constants are what the
    // catalogue groups by.
    vm.runInContext(read('state.js'), sandbox);
    vm.runInContext(read('view-catalogue.js'), sandbox);
    return sandbox.NoodleViewCatalogue;
}

/** Every view name passed to NavigationController.register(), anywhere. */
function registeredViews() {
    const names = new Set();
    for (const file of fs.readdirSync(staticDir).filter((f) => f.endsWith('.js'))) {
        const src = read(file);
        for (const m of src.matchAll(/NavigationController\.register\('([^']+)'/g)) names.add(m[1]);
    }
    const script = read('script.js');
    const block = script.slice(script.indexOf('const OUTPUT_VIEWS = {'), script.indexOf('};', script.indexOf('const OUTPUT_VIEWS = {')));
    for (const m of block.matchAll(/'([^']+)':\s*'planTab'/g)) names.add(m[1]);
    return names;
}

const plain = (value) => JSON.parse(JSON.stringify(value));

test('every routed view a person can pick is in a group, and nothing else is', () => {
    const catalogue = load();
    const routed = [...registeredViews()].filter((v) => !catalogue.SHELLS.includes(v)).sort();
    const grouped = catalogue.groups().flatMap((g) => g.views.map((v) => v.id)).sort();
    assert.deepEqual(plain(grouped), routed);
});

test('every grouped view has a label, an icon and a tier', () => {
    const catalogue = load();
    for (const group of catalogue.groups()) {
        for (const view of group.views) {
            assert.ok(!view.unknown, `${view.id} has no catalogue entry`);
            assert.ok(view.label && view.icon, `${view.id} needs a label and an icon`);
            assert.ok(['phone-first', 'phone-readable', 'larger-screen'].includes(view.tier), `${view.id} tier`);
        }
    }
});

test('every icon is in the sprite', () => {
    const catalogue = load();
    const sprite = fs.readFileSync(path.join(staticDir, '..', 'templates', '_icon_sprite.html'), 'utf8');
    const icons = [
        ...catalogue.groups().flatMap((g) => g.views),
        ...catalogue.portfolioViews(),
    ].map((v) => v.icon);
    for (const icon of new Set(icons)) {
        assert.ok(sprite.includes(`id="icon-${icon}"`), `#icon-${icon} is not in _icon_sprite.html`);
    }
});

test('a larger-screen view names a phone view to go to instead', () => {
    const catalogue = load();
    const all = [...catalogue.groups().flatMap((g) => g.views), ...catalogue.portfolioViews()];
    for (const view of all.filter((v) => v.tier === 'larger-screen')) {
        assert.ok(view.nearest, `${view.id} is larger-screen but names no nearest view`);
        if (view.nearest === 'whiteboard-cards') continue; // the whiteboard's own card stack (#1384)
        const target = catalogue.get(view.nearest);
        assert.ok(target, `${view.id}'s nearest (${view.nearest}) is not a view`);
        assert.notEqual(target.tier, 'larger-screen', `${view.id} points at another larger-screen view`);
    }
});

test('the phone-first chips are the six the epic chose, all phone-first', () => {
    const catalogue = load();
    assert.deepEqual(plain(catalogue.phoneFirst().map((v) => v.label)),
        ['Dashboard', 'Tasks', 'Outline', 'Board', 'Calendar', 'RAID Log']);
    assert.ok(catalogue.phoneFirst().every((v) => v.tier === 'phone-first'));
});

test('portfolio views are addressed as portfolio:<sub-view>', () => {
    const catalogue = load();
    assert.equal(catalogue.get('portfolio:risks').label, 'Risks');
    assert.equal(catalogue.label('raid'), 'RAID Log');
    assert.equal(catalogue.get('nope'), null);
});
