/**
 * The whiteboard does per-pointer-event work once per animation frame, not
 * once per event.
 *
 *  - Dragging a group boundary re-derived every boundary and redrew every
 *    dependency noodle on each mousemove -- and wbRenderDependencyNoodles()
 *    re-parses the whole plan (PlanModel.parse) every time. A mouse reports
 *    several moves per frame, so most of that work was thrown away unseen.
 *  - Panning and zooming (wheel, mouse drag, touch) re-placed every note on
 *    the board -- O(notes) attribute and style writes -- on each event, and
 *    the wheel and touch handlers then measured the canvas, forcing the
 *    browser to lay those writes out before the next event.
 *
 * Both now keep only the latest state per event and apply it in one
 * requestAnimationFrame. The board's own <g> transform is still written at
 * once (two attributes), so anything reading it -- including the
 * Selenium canvas tests -- sees the current pan/zoom straight away.
 *
 * whiteboard.js and whiteboard-groups.js each run whole in a vm, with a
 * stand-in DOM and a requestAnimationFrame queue the test runs by hand.
 *
 * Run with: node --test tests/test_whiteboard_frame_batching.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const staticDir = join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'static');
const read = (name) => readFileSync(join(staticDir, name), 'utf8');

/** A requestAnimationFrame the test steps by hand. */
function frameQueue() {
  let next = 1;
  const pending = new Map();
  return {
    requestAnimationFrame: (fn) => { const id = next++; pending.set(id, fn); return id; },
    cancelAnimationFrame: (id) => { pending.delete(id); },
    get size() { return pending.size; },
    run() {
      const fns = [...pending.values()];
      pending.clear();
      for (const fn of fns) fn(0);
    },
  };
}

const timers = {
  setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); t.unref(); return t; },
  clearTimeout,
};

// ---------------------------------------------------------------------------
// Pan and zoom (whiteboard.js)
// ---------------------------------------------------------------------------

function loadBoard(noteCount = 5) {
  const frames = frameQueue();
  const counts = { canvasMeasures: 0, noteWrites: 0, zoomTiers: 0 };
  const fakeStyle = () => ({ setProperty() {} });
  const notes = Array.from({ length: noteCount }, (_, i) => ({
    dataset: { wbX: String(i * 300), wbY: '0', wbWidth: '260', wbHeight: '200' },
    attrs: {},
    classList: { contains: () => true },
    firstElementChild: { style: fakeStyle() },
    setAttribute(name, value) { counts.noteWrites++; this.attrs[name] = value; },
  }));
  const layer = { querySelectorAll: () => notes };
  const svg = {
    classList: { add() {}, remove() {} },
    querySelector: (sel) => (sel === '.wb-notes-layer' ? layer : null),
    getBoundingClientRect() {
      counts.canvasMeasures++;
      return { left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800 };
    },
  };
  const group = {
    attrs: {}, style: {},
    getAttribute(name) { return this.attrs[name] || null; },
    setAttribute(name, value) { this.attrs[name] = value; },
  };
  const sandbox = {
    console, ...timers, ...frames,
    localStorage: { setItem() {}, getItem: () => null },
    document: { getElementById: () => null, querySelector: () => null },
    wbUpdateNoteZoomTiers() { counts.zoomTiers++; },
  };
  vm.createContext(sandbox);
  vm.runInContext(read('whiteboard.js') + `
;globalThis.__wb = {
  mount(svg, group) { wbSvg = svg; wbGroup = group; },
  view: () => ({ zoom: wbZoom, panX: wbPanX, panY: wbPanY }),
};`, sandbox);
  sandbox.__wb.mount(svg, group);
  // The board's first placement, as initWhiteboard() does it.
  sandbox.wbApplyTransform(false);
  counts.canvasMeasures = 0;
  counts.noteWrites = 0;
  counts.zoomTiers = 0;
  return { sandbox, frames, counts, notes, group };
}

const wheel = (deltaY, extra) => ({
  deltaX: 0, deltaY, deltaMode: 0, clientX: 500, clientY: 400,
  target: { closest: () => null }, preventDefault() {}, ...extra,
});

test('pan: five wheel events in one frame place the notes once', () => {
  const { sandbox, frames, counts, notes, group } = loadBoard();
  for (let i = 0; i < 5; i++) sandbox.wbHandleWheel(wheel(10));

  // The board's own transform follows every event...
  assert.equal(group.attrs.transform, 'translate(0, -50) scale(1)');
  // ...the notes wait for the frame.
  assert.equal(counts.noteWrites, 0, 'every wheel event re-placed every note');
  frames.run();
  assert.equal(counts.noteWrites, notes.length * 4, 'each note placed exactly once for the frame');
  assert.equal(notes[1].attrs.y, '-50');
  assert.equal(counts.zoomTiers, 1);
  assert.ok(counts.canvasMeasures <= 1, `the canvas was measured ${counts.canvasMeasures} times in one frame`);
});

test('zoom: a pinch stream in one frame places the notes once, at the final zoom', () => {
  const { sandbox, frames, counts, notes } = loadBoard();
  for (let i = 0; i < 4; i++) sandbox.wbHandleWheel(wheel(-10, { ctrlKey: true }));
  assert.equal(counts.noteWrites, 0);
  frames.run();
  const { zoom } = sandbox.__wb.view();
  assert.ok(zoom > 1);
  assert.equal(counts.noteWrites, notes.length * 4);
  assert.equal(notes[0].attrs.width, String(260 * zoom));
});

test('pan: a mouse-drag pan applies once per frame', () => {
  const { sandbox, frames, counts, notes } = loadBoard();
  sandbox.wbBeginPan(100, 100);
  for (let i = 1; i <= 6; i++) sandbox.wbHandleMouseMove({ clientX: 100 + i * 10, clientY: 100 });
  assert.equal(counts.noteWrites, 0);
  frames.run();
  assert.equal(counts.noteWrites, notes.length * 4);
  assert.equal(notes[0].attrs.x, '60');
  sandbox.wbHandleMouseUp();
});

test('an explicit wbApplyTransform() (zoom buttons, fit) still places the notes at once', () => {
  const { sandbox, frames, counts, notes } = loadBoard();
  sandbox.wbHandleWheel(wheel(10));
  sandbox.wbApplyTransform(false);
  assert.equal(counts.noteWrites, notes.length * 4);
  // ...and the frame the wheel queued does not place them a second time.
  frames.run();
  assert.equal(counts.noteWrites, notes.length * 4);
});

test('wbFlushTransform() places the notes now, for code about to measure them', () => {
  const { sandbox, frames, counts, notes } = loadBoard();
  sandbox.wbHandleWheel(wheel(30));
  sandbox.wbFlushTransform();
  assert.equal(notes[0].attrs.y, '-30');
  const writes = counts.noteWrites;
  frames.run();
  assert.equal(counts.noteWrites, writes, 'the flushed frame ran again');
});

// ---------------------------------------------------------------------------
// Dragging a group boundary (whiteboard-groups.js)
// ---------------------------------------------------------------------------

function loadGroups() {
  const frames = frameQueue();
  const counts = { groups: 0, noodles: 0 };
  const commits = [];
  const note = (x, y) => ({ fo: { dataset: { wbX: String(x), wbY: String(y) } } });
  const wbNoteNodes = new Map([['Alpha', note(0, 0)], ['Beta', note(300, 0)]]);
  const editor = { value: 'plan' };
  const sandbox = {
    console, ...frames,
    document: { getElementById: (id) => (id === 'planEditor' ? editor : null) },
    wbNoteNodes,
    wbLastTasks: [],
    wbNoteCurrentRect: (entry) => ({ x: Number(entry.fo.dataset.wbX), y: Number(entry.fo.dataset.wbY) }),
    wbSetBoardRect(fo, rect) { fo.dataset.wbX = String(rect.x); fo.dataset.wbY = String(rect.y); },
    wbSetDragCursor() {},
    wbRenderDependencyNoodles() { counts.noodles++; },
    updatePlanWhiteboardText: (text, rows) => JSON.stringify(rows),
    wbCommitMarkdown(text) { commits.push(JSON.parse(text)); },
  };
  vm.createContext(sandbox);
  vm.runInContext(read('whiteboard-groups.js'), sandbox);
  // Stand-ins for the file's own DOM-bound helpers (script functions are
  // properties of the global object, so the file's callers see these).
  sandbox.wbGroupNoteDescendants = () => ['Alpha', 'Beta'];
  sandbox.wbRenderGroupsFromBoard = () => { counts.groups++; };
  sandbox.wbReadBoardRows = () => [{ task: 'Alpha', x: 0, y: 0 }, { task: 'Beta', x: 300, y: 0 }];
  return { sandbox, frames, counts, commits, wbNoteNodes };
}

const press = (x, y) => ({ button: 0, clientX: x, clientY: y, preventDefault() {}, stopPropagation() {} });

test('group drag: moves in one frame redraw the boundary and noodles once', () => {
  const { sandbox, frames, counts, wbNoteNodes } = loadGroups();
  sandbox.wbGroupMouseDown(press(10, 10), 'Research');
  for (let i = 1; i <= 5; i++) sandbox.wbGroupMouseMove({ clientX: 10 + i * 8, clientY: 10 + i * 4 });
  assert.equal(counts.noodles, 0, 'each mousemove re-parsed the plan to redraw the noodles');
  assert.equal(counts.groups, 0);
  frames.run();
  assert.equal(counts.noodles, 1);
  assert.equal(counts.groups, 1);
  assert.equal(wbNoteNodes.get('Beta').fo.dataset.wbX, '340');
  assert.equal(wbNoteNodes.get('Beta').fo.dataset.wbY, '20');
});

test('group drag: releasing before the frame commits the final position', () => {
  const { sandbox, frames, commits } = loadGroups();
  sandbox.wbGroupMouseDown(press(10, 10), 'Research');
  sandbox.wbGroupMouseMove({ clientX: 30, clientY: 10 });
  sandbox.wbGroupMouseMove({ clientX: 60, clientY: 25 });
  sandbox.wbGroupMouseUp();
  assert.equal(commits.length, 1);
  assert.deepEqual(commits[0].map((r) => [r.task, r.x, r.y]), [['Alpha', 50, 15], ['Beta', 350, 15]]);
  frames.run(); // nothing left to apply once the drag has ended
  assert.equal(commits.length, 1);
});
