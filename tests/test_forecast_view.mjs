/**
 * Regression tests for issue #1114: "Forecast view: EVM chart with schedule
 * and cost at completion". Previously the Track ribbon's Forecast button
 * just opened the existing EVM view verbatim (VIEW_FOR_LABEL's
 * `Forecast: 'evm'`, added in #1159/#1090). This gives Forecast its own
 * view, led with the schedule-at-completion / cost-at-completion headline
 * and the standard EVM forecast measures (EAC, ETC, VAC, TCPI, forecast
 * finish date), sharing calculateEVM()'s cached results and the same
 * PV/EV/AC S-curve chart renderer as the EVM view rather than recomputing
 * or reimplementing either.
 *
 * Covers:
 *  - ribbon-ia.js: the Track tab's Cost group has a Forecast button
 *    (unchanged by this issue, but the button this whole feature hangs off).
 *  - ribbon.js: the "Forecast" label now resolves to the 'forecast' view,
 *    not 'evm'.
 *  - state.js: 'forecast' is a recognised tracking view.
 *  - script.js: 'forecast' is registered as an output view (OUTPUT_VIEWS)
 *    and updateForecastView() runs on every plan re-render.
 *  - index.html: the forecast view's container, summary, KPI grid and
 *    chart markup exist with the ids updateForecastView()/renderEvmChart()
 *    drive.
 *  - script.js: calculateEVM(), exercised against a lifted copy of the
 *    real function (same liftFunctions/fakeElement technique as
 *    tests/test_escalations_view.mjs), produces correct EAC/ETC/VAC/TCPI
 *    and a schedule forecast date for three representative scenarios: on
 *    track, over budget (CPI < 1), and behind schedule (SPI < 1).
 *
 * Run with: node --test tests/test_forecast_view.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

import { TABS } from '../packages/noodle-web/src/noodle_web/static/ribbon-ia.js';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const staticDir = join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'static');
const templatesDir = join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'templates');

const ribbonSrc = readFileSync(join(staticDir, 'ribbon.js'), 'utf8');
const scriptSrc = readFileSync(join(staticDir, 'script.js'), 'utf8');
const stateSrc = readFileSync(join(staticDir, 'state.js'), 'utf8');
const html = readFileSync(join(templatesDir, 'index.html'), 'utf8');

// ---------------------------------------------------------------------------
// ribbon-ia.js: the Track tab's Cost group has a Forecast button
// ---------------------------------------------------------------------------

test('the Track ribbon Cost group has a Forecast button', () => {
  const trackTab = TABS.find((t) => t.id === 'track');
  assert.ok(trackTab, 'no "track" tab in TABS');
  const costGroup = trackTab.groups.find((g) => g.name === 'Cost');
  assert.ok(costGroup, 'Track tab has no "Cost" group');
  const labels = [
    ...(costGroup.lg || []).map((b) => b[1]),
    ...(costGroup.cols || []).flatMap((col) => col.map((b) => b[1])),
  ];
  assert.ok(labels.includes('Forecast'), 'Track ribbon Cost group is missing a "Forecast" button');
});

// ---------------------------------------------------------------------------
// ribbon.js: the "Forecast" label resolves to the 'forecast' view, not 'evm'
// ---------------------------------------------------------------------------

test("ribbon.js resolves the \"Forecast\" label to its own 'forecast' view", () => {
  const m = ribbonSrc.match(/const VIEW_FOR_LABEL = \{([\s\S]*?)\n\};/);
  assert.ok(m, "could not find ribbon.js's VIEW_FOR_LABEL table");
  assert.match(m[1], /Forecast:\s*'forecast'/, '"Forecast" should map to its own \'forecast\' view');
  assert.doesNotMatch(m[1], /Forecast:\s*'evm'/, '"Forecast" should no longer alias the EVM view');
});

// ---------------------------------------------------------------------------
// state.js: 'forecast' is a recognised tracking view
// ---------------------------------------------------------------------------

test("'forecast' is registered as a tracking view in state.js", () => {
  const m = stateSrc.match(/const TRACKING_VIEWS = \[([\s\S]*?)\];/);
  assert.ok(m, 'could not find TRACKING_VIEWS in state.js');
  assert.match(m[1], /'forecast'/);
});

// ---------------------------------------------------------------------------
// script.js: 'forecast' is wired up as an output view and kept up to date
// ---------------------------------------------------------------------------

test("script.js registers 'forecast' as an output view and updates it on every render", () => {
  const outputViewsMatch = scriptSrc.match(/const OUTPUT_VIEWS = \{([\s\S]*?)\n\};/);
  assert.ok(outputViewsMatch, 'could not find OUTPUT_VIEWS in script.js');
  assert.match(outputViewsMatch[1], /'forecast':\s*'planTab'/, "OUTPUT_VIEWS should register 'forecast'");
  assert.match(
    scriptSrc,
    /name:\s*'forecast',\s*fn:\s*\(\)\s*=>\s*updateForecastView\(\)/,
    'updateForecastView() should run in the viewUpdates list on every plan render'
  );
});

// ---------------------------------------------------------------------------
// index.html: the forecast view's markup exists
// ---------------------------------------------------------------------------

test('index.html has the forecast view container, summary, KPI grid and chart', () => {
  assert.match(html, /id="forecast-view"/);
  assert.match(html, /class="[^"]*forecast-placeholder/);
  assert.match(html, /class="[^"]*forecast-content/);
  assert.match(html, /id="forecastSummary"/);
  assert.match(html, /id="forecastKpiGrid"/);
  assert.match(html, /id="forecastChart"/);
  assert.match(html, /id="forecastChartLegend"/);
});

test('the Tracking dropdown menu has a Forecast entry that switches to the forecast view', () => {
  assert.match(html, /data-view="forecast" onclick="switchToView\('forecast'\)/);
});

// ---------------------------------------------------------------------------
// script.js: calculateEVM(), lifted into a sandbox, for representative
// forecast scenarios (same liftFunctions/fakeElement technique as
// tests/test_escalations_view.mjs).
// ---------------------------------------------------------------------------

/** Top-level `function name(` ... `\n}` declarations from a classic script,
 * lifted into a sandboxed vm context. */
function liftFunctions(sandbox, source, names) {
  for (const name of names) {
    const start = source.indexOf(`\nfunction ${name}(`);
    assert.notEqual(start, -1, `${name} not found`);
    const end = source.indexOf('\n}\n', start);
    assert.notEqual(end, -1, `${name} has no closing brace at column 0`);
    vm.runInNewContext(source.slice(start, end + 3), sandbox);
  }
  return sandbox;
}

function makeTask({ start, finish, durationDays, percent }) {
  return {
    is_summary: false,
    duration_days: durationDays,
    start: start.toISOString(),
    finish: finish.toISOString(),
    percent,
  };
}

function makeSandbox({ agreedBudget = 0, budgetItems = [] } = {}) {
  const sandbox = { agreedBudget, budgetItems };
  liftFunctions(sandbox, scriptSrc, ['buildEvmTimeSeries', 'calculateEVM']);
  return sandbox;
}

// A fixed "today" (midnight, matching calculateEVM's own today.setHours(0,0,0,0))
// that every scenario's task dates are built relative to, so the fractions
// below are exact regardless of which day the suite happens to run on.
const today = new Date();
today.setHours(0, 0, 0, 0);
const addDays = (base, days) => new Date(base.getTime() + days * 86400000);

test('calculateEVM(): on track (CPI = 1, SPI = 1) forecasts finishing on budget and on the planned date', () => {
  const projectStart = addDays(today, -30);
  const projectEnd = addDays(today, 30); // 60-day project, 30 elapsed (50%)
  const sandbox = makeSandbox({
    agreedBudget: 1000,
    budgetItems: [{ total: 500 }], // AC = 500 = EV -> CPI = 1
  });
  const tasks = [makeTask({ start: projectStart, finish: projectEnd, durationDays: 60, percent: 50 })]; // EV = 500 = PV -> SPI = 1

  const data = sandbox.calculateEVM(tasks);

  assert.ok(data, 'calculateEVM should return a result for a valid task set');
  assert.equal(data.BAC, 1000);
  assert.equal(data.PV, 500);
  assert.equal(data.EV, 500);
  assert.equal(data.AC, 500);
  assert.equal(data.CPI, 1);
  assert.equal(data.SPI, 1);
  assert.equal(data.EAC, 1000, 'on track: EAC should equal BAC');
  assert.equal(data.ETC, 500, 'on track: ETC should be the remaining budget');
  assert.equal(data.VAC, 0, 'on track: no variance at completion');
  assert.equal(data.TCPI, 1, 'on track: no extra efficiency required');
  const scheduleSlipDays = Math.round((data.scheduleForecast.getTime() - projectEnd.getTime()) / 86400000);
  assert.equal(scheduleSlipDays, 0, 'on track: forecast finish should match the planned finish date');
});

test('calculateEVM(): over budget (CPI < 1) forecasts a higher cost at completion, unaffected schedule', () => {
  const projectStart = addDays(today, -30);
  const projectEnd = addDays(today, 30); // 60-day project, 30 elapsed (50%)
  const sandbox = makeSandbox({
    agreedBudget: 1000,
    budgetItems: [{ total: 800 }], // AC = 800, EV = 500 -> CPI = 0.625
  });
  const tasks = [makeTask({ start: projectStart, finish: projectEnd, durationDays: 60, percent: 50 })]; // on schedule

  const data = sandbox.calculateEVM(tasks);

  assert.equal(data.CPI, 0.625);
  assert.equal(data.SPI, 1, 'schedule performance should be unaffected by an overspend');
  assert.equal(data.EAC, 1600, 'EAC = BAC / CPI = 1000 / 0.625');
  assert.equal(data.ETC, 800, 'ETC = EAC - AC = 1600 - 800');
  assert.equal(data.VAC, -600, 'VAC = BAC - EAC = 1000 - 1600, i.e. 600 over budget');
  assert.equal(data.TCPI, 2.5, 'TCPI = (BAC - EV) / (BAC - AC) = 500 / 200');
  const scheduleSlipDays = Math.round((data.scheduleForecast.getTime() - projectEnd.getTime()) / 86400000);
  assert.equal(scheduleSlipDays, 0, 'an over-budget-but-on-schedule project should still forecast the planned finish date');
});

test('calculateEVM(): behind schedule (SPI < 1) forecasts a later finish date, unaffected cost', () => {
  const projectStart = addDays(today, -30);
  const projectEnd = addDays(today, 30); // 60-day project, 30 elapsed (50%)
  const sandbox = makeSandbox({
    agreedBudget: 1000,
    budgetItems: [{ total: 250 }], // AC = 250 = EV -> CPI = 1 (cost on track)
  });
  const tasks = [makeTask({ start: projectStart, finish: projectEnd, durationDays: 60, percent: 25 })]; // EV = 250, PV = 500 -> SPI = 0.5

  const data = sandbox.calculateEVM(tasks);

  assert.equal(data.SPI, 0.5);
  assert.equal(data.CPI, 1, 'cost performance should be unaffected by running behind schedule');
  assert.equal(data.EAC, 1000, 'cost at completion should be unaffected by a schedule slip alone');
  assert.equal(data.TCPI, 1);
  const scheduleSlipDays = Math.round((data.scheduleForecast.getTime() - projectEnd.getTime()) / 86400000);
  assert.equal(scheduleSlipDays, 60, 'SPI 0.5 over a 60-day project should forecast finishing 60 days late');
});

test('calculateEVM(): returns null when there is no usable task data (insufficient-data state)', () => {
  const sandbox = makeSandbox({ agreedBudget: 1000, budgetItems: [{ total: 500 }] });
  assert.equal(sandbox.calculateEVM([]), null);
  assert.equal(sandbox.calculateEVM(null), null);
  // Tasks with no duration/dates (e.g. all summary rows) leave no work tasks.
  assert.equal(sandbox.calculateEVM([{ is_summary: true, duration_days: 10, start: '2026-01-01', finish: '2026-02-01' }]), null);
});
