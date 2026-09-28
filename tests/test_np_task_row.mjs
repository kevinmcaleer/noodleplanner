/**
 * <np-rag> -- the dot <np-task-row> and the report tables show -- paints RAG
 * from the same table the views do.
 *
 * The dot maps the engine's descriptive status ("On track", "Task overdue")
 * to one of four status tokens in components/rag/rag.js. script.js's
 * ragStatusToColour() is the table every other view uses. Two copies of one
 * mapping drift quietly -- the app already had three RAG palettes because of
 * exactly that -- so this runs the app's function for real and compares.
 *
 * Source-level, like test_np_resource_stack.mjs: there is no jsdom here, and
 * the thing worth pinning is that one mapping is in use.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATIC = join(HERE, '../packages/noodle-web/src/noodle_web/static');

/** ragStatusToColour() lifted out of script.js and run, not re-typed. */
function appRagColour() {
    const source = readFileSync(join(STATIC, 'script.js'), 'utf8');
    const start = source.indexOf('function ragStatusToColour(');
    assert.notEqual(start, -1, 'ragStatusToColour() not found -- renamed?');
    const open = source.indexOf('{', start);
    let depth = 0;
    let end = -1;
    for (let i = open; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) { end = i + 1; break; }
    }
    const context = { module: {} };
    vm.createContext(context);
    vm.runInContext(`${source.slice(start, end)}; module.fn = ragStatusToColour;`, context);
    return context.module.fn;
}

const { ragColour, RAG_COLOURS } = await import(join(STATIC, 'components/rag/rag.js'));

test('every status the row knows maps the way the app maps it', () => {
    const app = appRagColour();
    for (const status of Object.keys(RAG_COLOURS)) {
        assert.equal(ragColour(status), app(status), status);
        // Case and padding are not a different status.
        assert.equal(ragColour(`  ${status.toUpperCase()} `), app(status.toUpperCase()), status);
    }
});

test('an unknown or empty status has no colour, in both', () => {
    const app = appRagColour();
    for (const status of ['', null, undefined, 'purple', 'at risk']) {
        assert.equal(ragColour(status), '', String(status));
        assert.equal(app(status) || '', '', String(status));
    }
});

test('the four colours are the four the dot styles', () => {
    const css = readFileSync(join(STATIC, 'components/rag/np-rag.js'), 'utf8');
    for (const colour of new Set(Object.values(RAG_COLOURS))) {
        assert.match(css, new RegExp(`\\.dot\\[data-rag="${colour}"\\]`), colour);
    }
});

test('the row draws its status with <np-rag>, not a dot of its own', () => {
    const row = readFileSync(join(STATIC, 'components/task-row/np-task-row.js'), 'utf8');
    assert.match(row, /<np-rag\b/);
    assert.doesNotMatch(row, /data-rag="/);
});
