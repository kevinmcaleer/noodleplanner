/**
 * Dashboard widget layout (#779): the `dashboard:` front-matter block, its
 * defaults, forward compatibility and byte-identical round trip.
 * Run with: node --test tests/test_dashboard_widgets.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const dw = require('../packages/noodle-web/src/noodle_web/static/dashboard-widgets.js');

const PLAN = '---\ntitle: Demo\nsponsor: Ann\n---\n\n- Task one\n';

test('no dashboard key is the default layout and writes nothing', () => {
  const layout = dw.dashboardLayoutFromText(PLAN);
  assert.ok(dw.isDefaultDashboardLayout(layout));
  assert.equal(dw.setDashboardBlock(PLAN, layout), PLAN);
  assert.equal(dw.setDashboardBlock(PLAN, null), PLAN);
});

test('moving, hiding and resizing write a readable block that round-trips', () => {
  let layout = dw.dashboardLayoutFromText(PLAN);
  layout = dw.moveDashboardWidget(layout, 'risks', -3);
  layout = dw.setDashboardWidgetHidden(layout, 'budget', true);
  layout = dw.setDashboardWidgetSize(layout, 'actions', 'full');
  const text = dw.setDashboardBlock(PLAN, layout);
  assert.match(text, /dashboard:\n  - \{id: timeline, size: wide\}/);
  assert.match(text, /- \{id: budget, size: half, hidden: true\}/);
  assert.match(text, /- \{id: actions, size: full\}/);
  assert.ok(text.endsWith('---\n\n- Task one\n'));
  // Reading it back gives the same layout, and writing again is byte-identical.
  const back = dw.dashboardLayoutFromText(text);
  assert.deepEqual(back, layout);
  assert.equal(dw.setDashboardBlock(text, back), text);
});

test('a block in the middle of the front matter is replaced in place', () => {
  const text = '---\ntitle: A\ndashboard:\n  - {id: risks, size: half}\nsponsor: B\n---\nbody\n';
  const layout = dw.setDashboardWidgetHidden(dw.dashboardLayoutFromText(text), 'risks', true);
  const out = dw.setDashboardBlock(text, layout);
  assert.ok(out.startsWith('---\ntitle: A\ndashboard:\n'));
  assert.ok(out.includes('\nsponsor: B\n---\nbody\n'));
});

test('reset removes the block and leaves the rest alone', () => {
  const layout = dw.moveDashboardWidget(dw.defaultDashboardLayout(), 'actions', -2);
  const text = dw.setDashboardBlock(PLAN, layout);
  assert.notEqual(text, PLAN);
  assert.equal(dw.setDashboardBlock(text, null), PLAN);
});

test('unknown ids are ignored but survive a save; new widgets append', () => {
  const text = '---\ndashboard:\n  - {id: from_the_future, size: half}\n  - {id: milestones, size: full}\n---\n';
  const layout = dw.dashboardLayoutFromText(text);
  assert.equal(layout[0].unknown, true);
  assert.equal(layout[1].id, 'milestones');
  // every known widget not listed is appended, visible
  assert.equal(layout.filter(i => !i.unknown).length, dw.DASHBOARD_WIDGETS.length);
  assert.equal(layout.at(-1).hidden, false);
  assert.match(dw.setDashboardBlock(text, layout), /from_the_future/);
  // moving steps over the invisible entry
  const moved = dw.moveDashboardWidget(layout, 'milestones', -1);
  assert.equal(moved[0].id, 'milestones');
});

test('bad sizes fall back and duplicates collapse', () => {
  const text = '---\ndashboard:\n  - {id: risks, size: gigantic}\n  - {id: risks, size: full}\n---\n';
  const layout = dw.dashboardLayoutFromText(text);
  assert.equal(layout.filter(i => i.id === 'risks').length, 1);
  assert.equal(layout[0].size, 'half');
});

test('a plan without front matter gets one when customised', () => {
  const layout = dw.moveDashboardWidget(dw.defaultDashboardLayout(), 'actions', -1);
  const out = dw.setDashboardBlock('- Task\n', layout);
  assert.ok(out.startsWith('---\ndashboard:\n'));
  assert.ok(out.endsWith('---\n- Task\n'));
});

test('drag reorder places a widget before another', () => {
  const l = dw.moveDashboardWidgetBefore(dw.defaultDashboardLayout(), 'actions', 'timeline');
  assert.equal(l[0].id, 'actions');
  assert.equal(dw.moveDashboardWidgetBefore(l, 'actions', null).at(-1).id, 'actions');
});
