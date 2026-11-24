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
  layout = dw.setDashboardWidgetSpan(layout, 'actions', 'desktop', { w: 12 });
  const text = dw.setDashboardBlock(PLAN, layout);
  assert.match(text, /dashboard:\n  - \{id: timeline, w: 9\}/);
  assert.match(text, /- \{id: budget, w: 6, hidden: true\}/);
  assert.match(text, /- \{id: actions, w: 12\}/);
  assert.ok(text.endsWith('---\n\n- Task one\n'));
  // Reading it back gives the same layout, and writing again is byte-identical.
  const back = dw.dashboardLayoutFromText(text);
  assert.deepEqual(back, layout);
  assert.equal(dw.setDashboardBlock(text, back), text);
});

test('a block in the middle of the front matter is replaced in place', () => {
  const text = '---\ntitle: A\ndashboard:\n  - {id: risks, w: 6}\nsponsor: B\n---\nbody\n';
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
  assert.equal(layout[0].w, 6);
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

// ---------------------------------------------------------------------------
// Free resizing, heights and a layout per device
// ---------------------------------------------------------------------------

test('each device has its own front-matter key, columns and defaults', () => {
  assert.deepEqual(Object.keys(dw.DASHBOARD_DEVICES), ['desktop', 'tablet', 'phone']);
  assert.equal(dw.DASHBOARD_DEVICES.desktop.cols, 12);
  assert.equal(dw.DASHBOARD_DEVICES.tablet.cols, 6);
  assert.equal(dw.DASHBOARD_DEVICES.phone.cols, 1);
  const t = dw.defaultDashboardLayout('tablet');
  assert.equal(t.find(i => i.id === 'timeline').w, 4);
  assert.equal(t.find(i => i.id === 'task_completion').w, 2);
  // the phone default is the order someone checks it in, not the desktop order
  assert.deepEqual(dw.defaultDashboardLayout('phone').slice(0, 4).map(i => i.id),
    ['milestones', 'up_next', 'risks', 'actions']);
  for (const d of ['desktop', 'tablet', 'phone']) {
    assert.ok(dw.defaultDashboardLayout(d).every(i => i.h == null && !i.hidden));
    assert.ok(dw.isDefaultDashboardLayout(dw.defaultDashboardLayout(d), d));
  }
});

test('the desktop block is still `dashboard:`; legacy sizes become columns', () => {
  const text = '---\ndashboard:\n  - {id: timeline, size: full}\n  - {id: milestones, size: narrow}\n---\n';
  const layout = dw.dashboardLayoutFromText(text, 'desktop');
  assert.equal(layout[0].w, 12);
  assert.equal(layout[1].w, 3);
});

test('layouts are independent per device and round-trip byte-identically', () => {
  let desk = dw.moveDashboardWidget(dw.defaultDashboardLayout('desktop'), 'risks', -3);
  let tab = dw.setDashboardWidgetSpan(dw.defaultDashboardLayout('tablet'), 'actions', 'tablet', { w: 6, h: 2 });
  let ph = dw.setDashboardWidgetHidden(dw.defaultDashboardLayout('phone'), 'budget', true);
  let text = dw.setDashboardBlock(PLAN, desk, 'desktop');
  text = dw.setDashboardBlock(text, tab, 'tablet');
  text = dw.setDashboardBlock(text, ph, 'phone');
  assert.match(text, /\ndashboard:\n/);
  assert.match(text, /\ndashboard_tablet:\n[\s\S]*- \{id: actions, w: 6, h: 2\}/);
  assert.match(text, /\ndashboard_phone:\n[\s\S]*- \{id: budget, w: 1, hidden: true\}/);
  assert.deepEqual(dw.dashboardLayoutFromText(text, 'desktop'), desk);
  assert.deepEqual(dw.dashboardLayoutFromText(text, 'tablet'), tab);
  assert.deepEqual(dw.dashboardLayoutFromText(text, 'phone'), ph);
  for (const [l, d] of [[desk, 'desktop'], [tab, 'tablet'], [ph, 'phone']]) {
    assert.equal(dw.setDashboardBlock(text, dw.dashboardLayoutFromText(text, d), d), text);
  }
  // editing one device leaves the others' text alone
  const again = dw.setDashboardBlock(text, dw.setDashboardWidgetHidden(tab, 'risks', true), 'tablet');
  assert.ok(again.includes(text.split('dashboard_tablet:')[0]));
  assert.equal(dw.dashboardLayoutFromText(again, 'desktop').length, desk.length);
  // resetting one device removes only its block
  const reset = dw.setDashboardBlock(again, null, 'tablet');
  assert.ok(!reset.includes('dashboard_tablet'));
  assert.ok(reset.includes('dashboard_phone:') && reset.includes('\ndashboard:\n'));
});

test('width snaps to whole columns and is clamped per device', () => {
  const desk = dw.defaultDashboardLayout('desktop');
  assert.equal(dw.setDashboardWidgetSpan(desk, 'risks', 'desktop', { w: 99 }).find(i => i.id === 'risks').w, 12);
  assert.equal(dw.setDashboardWidgetSpan(desk, 'risks', 'desktop', { w: 1 }).find(i => i.id === 'risks').w, 3);
  assert.equal(dw.setDashboardWidgetSpan(desk, 'risks', 'desktop', { w: 7.4 }).find(i => i.id === 'risks').w, 7);
  const tab = dw.defaultDashboardLayout('tablet');
  assert.equal(dw.setDashboardWidgetSpan(tab, 'risks', 'tablet', { w: 1 }).find(i => i.id === 'risks').w, 2);
  // a phone is one column whatever width is asked for
  const ph = dw.defaultDashboardLayout('phone');
  assert.equal(dw.setDashboardWidgetSpan(ph, 'risks', 'phone', { w: 5 }).find(i => i.id === 'risks').w, 1);
});

test('height is in rows; no height means size to the content', () => {
  const desk = dw.defaultDashboardLayout('desktop');
  const two = dw.setDashboardWidgetSpan(desk, 'milestones', 'desktop', { h: 2 });
  assert.equal(two.find(i => i.id === 'milestones').h, 2);
  assert.equal(dw.setDashboardWidgetSpan(two, 'milestones', 'desktop', { h: 0 }).find(i => i.id === 'milestones').h, null);
  assert.equal(dw.setDashboardWidgetSpan(desk, 'milestones', 'desktop', { h: 99 }).find(i => i.id === 'milestones').h, dw.DASHBOARD_MAX_ROWS);
  let l = dw.stepDashboardWidgetHeight(desk, 'up_next', 1);
  assert.equal(l.find(i => i.id === 'up_next').h, 2);
  l = dw.stepDashboardWidgetHeight(l, 'up_next', 1);
  assert.equal(l.find(i => i.id === 'up_next').h, 3);
  l = dw.stepDashboardWidgetHeight(l, 'up_next', -2);
  assert.equal(l.find(i => i.id === 'up_next').h, 1);
  l = dw.stepDashboardWidgetHeight(l, 'up_next', -1);
  assert.equal(l.find(i => i.id === 'up_next').h, null);
  const w = dw.stepDashboardWidgetWidth(desk, 'risks', 'desktop', 1);
  assert.equal(w.find(i => i.id === 'risks').w, 7);
});

test('a size change is written as w/h and read back', () => {
  const l = dw.setDashboardWidgetSpan(dw.defaultDashboardLayout('desktop'), 'risks', 'desktop', { w: 5, h: 3 });
  const text = dw.setDashboardBlock(PLAN, l, 'desktop');
  assert.match(text, /- \{id: risks, w: 5, h: 3\}/);
  const back = dw.dashboardLayoutFromText(text, 'desktop').find(i => i.id === 'risks');
  assert.equal(back.w, 5);
  assert.equal(back.h, 3);
});

test('unknown ids and hidden widgets survive on every device', () => {
  const text = '---\ndashboard_phone:\n  - {id: from_the_future, w: 1}\n  - {id: risks, w: 1, hidden: true}\n---\n';
  const l = dw.dashboardLayoutFromText(text, 'phone');
  assert.equal(l[0].unknown, true);
  assert.equal(l[1].hidden, true);
  assert.match(dw.setDashboardBlock(text, l, 'phone'), /from_the_future/);
  // the desktop layout is untouched by a phone-only block
  assert.ok(dw.isDefaultDashboardLayout(dw.dashboardLayoutFromText(text, 'desktop'), 'desktop'));
});
