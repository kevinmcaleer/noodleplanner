/**
 * The table catalogue (static/table-catalogue.js) against the router and the
 * view catalogue: the table views interface groups the app's existing views
 * under tables, so every view a person can pick must be a view of exactly one
 * table, or be left out on purpose.
 *
 * Run with: node --test tests/test_table_catalogue.mjs
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
    vm.runInContext(read('state.js'), sandbox);
    vm.runInContext(read('view-catalogue.js'), sandbox);
    vm.runInContext(read('table-catalogue.js'), sandbox);
    return { tables: sandbox.NoodleTableCatalogue, views: sandbox.NoodleViewCatalogue };
}

const plain = (value) => JSON.parse(JSON.stringify(value));

test('every view a person can pick is a view of exactly one table, or excluded', () => {
    const { tables, views } = load();
    const pickable = views.groups().flatMap((g) => g.views.map((v) => v.id));
    const covered = plain(tables.allViews());
    assert.equal(new Set(covered).size, covered.length, 'a view is in two tables');
    const excluded = Object.keys(tables.EXCLUDED);
    for (const id of excluded) assert.ok(!covered.includes(id), `${id} is both excluded and in a table`);
    assert.deepEqual([...covered, ...excluded].sort(), [...pickable].sort());
});

test('the tables Kev asked for are there, in order, with Dashboard first', () => {
    const { tables } = load();
    assert.deepEqual(plain(tables.tables().map((t) => t.id)), [
        'dashboard', 'plan', 'raid', 'highlights', 'lessons', 'budget', 'benefits', 'resources', 'stakeholders',
    ]);
    assert.equal(tables.tables()[0].home, true);
});

test('a table opens on its first view, and a view knows its table and its name there', () => {
    const { tables } = load();
    assert.equal(tables.defaultView('plan'), 'tasks');
    assert.equal(tables.tableForView('gantt').id, 'plan');
    assert.equal(tables.tableForView('timesheet').id, 'resources');
    assert.equal(tables.tableForView('comms').id, 'stakeholders');
    assert.equal(tables.viewLabel('tasks'), 'Table');
    assert.equal(tables.viewLabel('kanban'), 'Board');
    assert.equal(tables.tableForView('portfolio'), null);
    assert.equal(tables.tableForView('guide'), null);
    assert.equal(tables.defaultView('nope'), null);
});

test('every table has a label, an icon in the sprite and at least one view', () => {
    const { tables } = load();
    const sprite = fs.readFileSync(path.join(staticDir, '..', 'templates', '_icon_sprite.html'), 'utf8');
    for (const table of tables.tables()) {
        assert.ok(table.label, `${table.id} needs a label`);
        assert.ok(sprite.includes(`id="icon-${table.icon}"`), `${table.id}: no icon ${table.icon}`);
        assert.ok(table.views.length > 0, `${table.id} has no views`);
        for (const view of table.views) assert.ok(view.label, `${table.id}/${view.id} needs a label`);
    }
});

test('what the catalogue hands out is a copy', () => {
    const { tables } = load();
    tables.tables()[1].views.length = 0;
    tables.get('plan').label = 'x';
    assert.equal(tables.get('plan').label, 'Plan');
    assert.ok(tables.viewsFor('plan').length > 3);
});
