/**
 * Regression tests for issue #1120: clicking Excel/CSV export on a plan
 * that has not been (re-)rendered since the last edit must render it
 * automatically and proceed with the export, instead of blocking with
 * "Render the latest plan changes before using browser Excel or CSV
 * export." and making the user click Render themselves first.
 *
 * script.js is a classic script full of DOM/network calls, so exportFile()
 * and its helpers are lifted into a sandboxed vm context with a stubbed
 * DOM, a fake browser-excel module, and a spy render/showMessage -- the
 * same liftFunctions approach tests/test_track_raid_type_presets.mjs and
 * tests/test_raid_comms_section_collision.mjs use for the same reason.
 * The one addition here: exportFile() reaches for `browser-excel.js` via a
 * dynamic import(), which Node's vm module refuses without a callback
 * (ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING) -- so the extracted source has
 * that one call swapped for a plain global stub before it's run.
 *
 * Run with: node --test tests/test_export_auto_render.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const staticDir = join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'static');
const scriptSrc = readFileSync(join(staticDir, 'script.js'), 'utf8');

/** Extract a top-level `[async ]function name(` ... `\n}\n` declaration from
 * a classic script (same technique as the liftFunctions helper duplicated
 * across tests/test_track_raid_type_presets.mjs and
 * tests/test_raid_comms_section_collision.mjs, extended here to also match
 * `async function`). */
function extractFunction(source, name) {
  const marker = new RegExp(`\\n(?:async )?function ${name}\\(`);
  const m = marker.exec(source);
  assert.ok(m, `${name} not found in script.js`);
  const start = m.index;
  const end = source.indexOf('\n}\n', start);
  assert.notEqual(end, -1, `${name} has no closing brace at column 0`);
  return source.slice(start, end + 3);
}

/**
 * Builds a sandbox with exportFile(), currentParseResult(),
 * browserExcelExportsEnabled() and useServerExports() lifted from the real
 * script.js, plus stubs for everything they touch. `renderText` is a spy
 * standing in for the real render pipeline: each call "renders" the plan
 * editor's current text into `lastParseResult`, succeeding or failing per
 * `renderSucceeds`.
 */
function makeSandbox({ planText, initialParseResult = null, renderSucceeds = true, renderedProjectName = 'Project' }) {
  const calls = { renderText: 0, showMessage: [], excel: [], csv: [], serverFallback: [], consoleErrors: [] };

  const planEditorEl = { value: planText };
  const elements = new Map([['planEditor', planEditorEl]]);

  const sandbox = {
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, { value: '', style: {}, textContent: '' });
        return elements.get(id);
      },
    },
    console: {
      error: (...args) => calls.consoleErrors.push(args),
      log: () => {},
    },
    budgetItems: [],
    lastParseResult: initialParseResult,
    // Browser Excel/CSV export is the default path (issue #790): no
    // np-server-exports opt-in.
    localStorage: { getItem: () => null },
    closeAllNavMenus: () => {},
    showMessage: (prefix, type, text) => calls.showMessage.push({ prefix, type, text }),
    // Stands in for the backend /render fallback exportFile() falls back to
    // when the browser path throws.
    render: async (...args) => { calls.serverFallback.push(args); },
    // Stands in for the real render pipeline: sets lastParseResult the way
    // renderText()/render() would once the plan has been (re-)parsed.
    renderText: async () => {
      calls.renderText += 1;
      const text = elements.get('planEditor').value.trim();
      sandbox.lastParseResult = renderSucceeds
        ? { planText: text, result: { success: true, project_name: renderedProjectName } }
        : { planText: text, result: { success: false } };
    },
    __loadBrowserExcelModule: async () => ({
      exportPlanExcelInBrowser: async (parse, opts) => {
        calls.excel.push({ parse, opts });
        return { filename: opts.filename, elapsedMs: 1 };
      },
      exportPlanCsvInBrowser: async (parse, opts) => {
        calls.csv.push({ parse, opts });
        return { filename: opts.filename, elapsedMs: 1 };
      },
    }),
  };

  for (const name of ['useServerExports', 'browserExcelExportsEnabled', 'currentParseResult']) {
    vm.runInNewContext(extractFunction(scriptSrc, name), sandbox);
  }

  const exportFileSrc = extractFunction(scriptSrc, 'exportFile')
    .replace("await import('/static/browser-excel.js')", 'await __loadBrowserExcelModule()');
  vm.runInNewContext(exportFileSrc, sandbox);

  return { sandbox, calls };
}

test('exporting an unrendered plan to Excel renders it automatically and completes the export', async () => {
  const { sandbox, calls } = makeSandbox({ planText: 'Task: Do the thing', initialParseResult: null });

  await sandbox.exportFile('excel', 'editor');

  assert.equal(calls.renderText, 1, 'the plan should have been auto-rendered exactly once');
  assert.equal(calls.excel.length, 1, 'the Excel export should have gone ahead');
  assert.equal(calls.excel[0].parse.project_name, 'Project');
  assert.equal(calls.serverFallback.length, 0, 'the browser export should not have fallen back to the backend');
  assert.ok(
    !calls.showMessage.some((m) => /before using browser Excel or CSV export/.test(m.text)),
    'the old blocking message must not appear',
  );
  assert.ok(calls.showMessage.some((m) => m.type === 'success'), 'a success message should have been shown');
});

test('exporting an unrendered plan to CSV renders it automatically and completes the export', async () => {
  const { sandbox, calls } = makeSandbox({ planText: 'Task: Do the thing', initialParseResult: null });

  await sandbox.exportFile('csv', 'editor');

  assert.equal(calls.renderText, 1, 'the plan should have been auto-rendered exactly once');
  assert.equal(calls.csv.length, 1, 'the CSV export should have gone ahead');
  assert.equal(calls.serverFallback.length, 0);
  assert.ok(!calls.showMessage.some((m) => /before using browser Excel or CSV export/.test(m.text)));
});

test('an edit since the last render is picked up: export re-renders the new text before exporting', async () => {
  const { sandbox, calls } = makeSandbox({
    planText: 'Task: Updated text',
    initialParseResult: { planText: 'Task: Old text', result: { success: true, project_name: 'Old' } },
  });

  await sandbox.exportFile('excel', 'editor');

  assert.equal(calls.renderText, 1, 'the stale cached parse should have triggered a fresh render');
  assert.equal(calls.excel.length, 1);
  assert.equal(calls.excel[0].parse.project_name, 'Project', 'the export should use the freshly rendered parse, not the stale one');
});

test('a plan that is already rendered and unchanged exports directly, with no re-render and no nag message', async () => {
  const { sandbox, calls } = makeSandbox({
    planText: 'Task: Same text',
    initialParseResult: { planText: 'Task: Same text', result: { success: true, project_name: 'Already Rendered' } },
  });

  await sandbox.exportFile('excel', 'editor');

  assert.equal(calls.renderText, 0, 'an already-current render should not be redone');
  assert.equal(calls.excel.length, 1);
  assert.equal(calls.excel[0].parse.project_name, 'Already Rendered', 'the cached parse should be used as-is');
  assert.ok(
    !calls.showMessage.some((m) => /Rendering the latest plan changes/.test(m.text)),
    'no rendering progress note is needed when nothing was stale',
  );
});

test('a genuine render failure still surfaces as a real error, not swallowed as a "please render" nag', async () => {
  const { sandbox, calls } = makeSandbox({
    planText: 'Task: this plan cannot be scheduled',
    initialParseResult: null,
    renderSucceeds: false,
  });

  await sandbox.exportFile('excel', 'editor');

  assert.equal(calls.renderText, 1, 'a render was still attempted automatically');
  assert.equal(calls.excel.length, 0, 'the browser export must not proceed on a failed render');
  assert.equal(calls.consoleErrors.length, 1, 'the real scheduling error should be logged, not silently dropped');
  assert.equal(
    calls.serverFallback.length,
    1,
    'a genuine failure should still fall through to the backend export path rather than being swallowed entirely',
  );
  assert.ok(
    !calls.showMessage.some((m) => /before using browser Excel or CSV export/.test(m.text)),
    'the old blocking "please render first" message must not reappear for this failure either',
  );
});
