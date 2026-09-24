/**
 * Regression test: the EVM / Forecast S-curve chart drew every x coordinate
 * as NaN for a plan that starts and finishes inside one calendar month.
 *
 * buildEvmTimeSeries() samples the plan monthly from the first of the start
 * month, so such a plan yields a one-entry series. renderEvmChart() mapped
 * index i to `left + (i / (count - 1)) * chartW`, which is 0 / 0 for a single
 * sample, and Chromium logged 24 console errors of the form
 * `<polyline> attribute points: Expected number, "NaN,290"` -- the failure
 * tests/ui/test_usability.py::test_render_does_not_show_error reported
 * whenever it ran with the whole test plan inside one month.
 *
 * Both functions are lifted from script.js into a vm sandbox (the same
 * technique as tests/test_forecast_view.mjs), so this exercises the real
 * series builder feeding the real renderer.
 *
 * Run with: node --test tests/test_evm_chart_single_sample.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const scriptSrc = readFileSync(
  join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'static', 'script.js'),
  'utf8'
);

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

function makeSandbox() {
  const svg = {
    attrs: {},
    innerHTML: '',
    parentElement: { clientWidth: 700 },
    setAttribute(name, value) { this.attrs[name] = value; },
  };
  const legend = { innerHTML: '' };
  const sandbox = {
    Date,
    Math,
    svg,
    legend,
    document: {
      documentElement: {},
      getElementById: (id) => ({ evmChart: svg, evmChartLegend: legend })[id] || null,
    },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
  };
  liftFunctions(sandbox, scriptSrc, [
    'buildEvmTimeSeries',
    'evmChartXScale',
    'renderEvmChart',
    'formatEvmAxisValue',
  ]);
  return sandbox;
}

/** Every numeric-looking SVG geometry attribute in the markup. */
function geometryValues(markup) {
  const values = [];
  for (const m of markup.matchAll(/\b(x|x1|x2|cx|y|y1|y2|cy)="([^"]*)"/g)) values.push(`${m[1]}=${m[2]}`);
  for (const m of markup.matchAll(/\bpoints="([^"]*)"/g)) values.push(`points=${m[1]}`);
  return values;
}

test('a plan inside one calendar month builds a single-sample EVM series', () => {
  const sandbox = makeSandbox();
  const series = sandbox.buildEvmTimeSeries(
    [], 100, new Date(2026, 8, 24), new Date(2026, 8, 30), false, 0, 0
  );
  assert.equal(series.dates.length, 1, 'expected one monthly sample for a plan inside September');
});

test('renderEvmChart() draws no NaN coordinates for a single-sample series', () => {
  const sandbox = makeSandbox();
  const projectStart = new Date(2026, 8, 24);
  const projectEnd = new Date(2026, 8, 30);
  const timeSeries = sandbox.buildEvmTimeSeries([], 100, projectStart, projectEnd, false, 0, 0);
  assert.equal(timeSeries.dates.length, 1);

  sandbox.evmData = {
    timeSeries,
    today: new Date(2026, 8, 24),
    BAC: 100,
    EV: 0,
    AC: 0,
    EAC: 100,
    scheduleForecast: projectEnd,
    hasBudgetData: false,
  };
  sandbox.renderEvmChart();

  const markup = sandbox.svg.innerHTML;
  assert.match(markup, /<polyline /, 'the PV line should still be drawn');
  assert.match(markup, /<circle /, 'the single data point should still be drawn');
  const bad = geometryValues(markup).filter((v) => /NaN|undefined|Infinity/.test(v));
  assert.deepEqual(bad, [], 'every SVG coordinate should be a finite number');
});

test('evmChartXScale() spreads several samples edge to edge and centres a lone one', () => {
  const { evmChartXScale } = makeSandbox();
  const many = evmChartXScale(3, 70, 600);
  assert.equal(many(0), 70);
  assert.equal(many(1), 370);
  assert.equal(many(2), 670);

  const one = evmChartXScale(1, 70, 600);
  assert.equal(one(0), 370);
});
