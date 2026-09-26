/**
 * A plain editor render must not go to the server.
 *
 * render() used to POST /render on every (debounced) edit before it would
 * call updateAllViews(). Without an export the only thing /render returns
 * is the ASCII table for #editorOutput, which is display:none, and
 * updateAllViews() already schedules the plan in the browser (issue #793).
 * So each edit paid a full server parse and schedule for nothing, and any
 * failure of that round trip -- offline, a 429, a 5xx -- meant the edit
 * never reached a single view.
 *
 * render() is lifted out of script.js into a vm sandbox with a spy fetch
 * and updateAllViews, the same approach as tests/test_export_auto_render.mjs.
 *
 * Run with: node --test tests/test_editor_render_offline.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const scriptSrc = readFileSync(
  join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'static', 'script.js'), 'utf8');

function extractFunction(source, name) {
  const m = new RegExp(`\\n(?:async )?function ${name}\\(`).exec(source);
  assert.ok(m, `${name} not found in script.js`);
  const end = source.indexOf('\n}\n', m.index);
  assert.notEqual(end, -1, `${name} has no closing brace at column 0`);
  return source.slice(m.index, end + 3);
}

function makeSandbox({ fetchImpl } = {}) {
  const calls = { fetch: [], updateAllViews: [], showMessage: [] };
  const elements = new Map();
  const sandbox = {
    document: {
      getElementById(id) {
        if (!elements.has(id)) {
          elements.set(id, { disabled: false, style: {}, textContent: '', classList: { add() {}, remove() {} } });
        }
        return elements.get(id);
      },
    },
    console: { log() {}, error() {} },
    fetch: async (url, opts) => {
      calls.fetch.push({ url, body: JSON.parse(opts.body) });
      if (fetchImpl) return fetchImpl(url, opts);
      throw new TypeError('Failed to fetch');  // offline
    },
    updateAllViews: async (planText, projectName) => { calls.updateAllViews.push({ planText, projectName }); },
    showMessage: (prefix, type, text) => calls.showMessage.push({ prefix, type, text }),
    updateHighlightsView() {},
    extractHighlightsFromText: () => [],
  };
  vm.runInNewContext(extractFunction(scriptSrc, 'render'), sandbox);
  return { sandbox, calls, elements };
}

test('an editor render with no export updates the views without a request', async () => {
  const { sandbox, calls, elements } = makeSandbox();

  await sandbox.render('Build 3d', 'Demo', false, false, false, false, 'editor');

  assert.equal(calls.fetch.length, 0, 'no request should be made for a plain render');
  assert.deepEqual(calls.updateAllViews, [{ planText: 'Build 3d', projectName: 'Demo' }]);
  assert.deepEqual(calls.showMessage, [], 'an offline edit is not an error');
  assert.equal(elements.get('editorBtn').disabled, false, 'the render button is re-enabled');
  assert.equal(elements.get('editorSpinner').style.display, 'none', 'the spinner is hidden');
});

test('an export still goes to /render with its flag set', async () => {
  const { sandbox, calls } = makeSandbox({
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ ascii_output: '' }),
    }),
  });

  await sandbox.render('Build 3d', 'Demo', false, true, false, false, 'editor');

  assert.equal(calls.fetch.length, 1);
  assert.equal(calls.fetch[0].url, '/render');
  assert.equal(calls.fetch[0].body.export_csv, true);
});

test('a non-JSON error page reports the HTTP status, not a SyntaxError', async () => {
  const { sandbox, calls } = makeSandbox({
    fetchImpl: async () => ({
      ok: false,
      status: 502,
      headers: { get: () => 'text/html' },
      json: async () => { throw new SyntaxError('Unexpected token <'); },
    }),
  });

  await sandbox.render('Build 3d', 'Demo', true, false, false, false, 'editor');

  assert.equal(calls.showMessage.length, 1);
  assert.equal(calls.showMessage[0].type, 'error');
  assert.match(calls.showMessage[0].text, /HTTP 502/);
});

// The server sends a non-Latin-1 download name as RFC 5987 filename* beside
// an ASCII fallback (a raw one in the header was a 500). These are exactly
// what noodle_web.app.content_disposition() produces.
test('download names prefer the UTF-8 filename* over the ASCII fallback', () => {
  const sandbox = {};
  vm.runInNewContext(extractFunction(scriptSrc, 'filenameFromDisposition'), sandbox);
  const name = sandbox.filenameFromDisposition;

  assert.equal(
    name(`attachment; filename="______ _____.csv"; filename*=UTF-8''%D0%9F%D1%80%D0%BE%D0%B5%D0%BA%D1%82%20%D0%90%D0%BB%D1%8C%D1%84%D0%B0.csv`),
    'Проект Альфа.csv');
  assert.equal(
    name(`attachment; filename="Plan _ v2.xlsx"; filename*=UTF-8''Plan%20%E2%80%94%20v2.xlsx`),
    'Plan — v2.xlsx');
  assert.equal(name(`attachment; filename="Demo.zip"; filename*=UTF-8''Demo.zip`), 'Demo.zip');
  assert.equal(name('attachment; filename="Old-style.xlsx"'), 'Old-style.xlsx');
  assert.equal(name(`attachment; filename="fallback.csv"; filename*=UTF-8''%E0%A4%A`), 'fallback.csv',
    'a malformed encoding falls back rather than throwing');
  assert.equal(name(null), null);
  assert.equal(name('attachment'), null);
});
