/**
 * Escape closes the parking lot panel -- including after a quick reopen.
 *
 * Closing the panel removes its document-level Escape listener at once but
 * leaves the panel in the DOM for the slide-out transition. Reopening it
 * inside that window (the ribbon button pressed twice quickly) takes
 * wbOpenParkingLotPanel()'s `existing` branch, which slides the same panel
 * back in -- and never put the listener back, so Escape did nothing until
 * the panel was closed some other way.
 *
 * The three functions involved are lifted out of whiteboard-notes.js into a
 * sandbox with a stand-in document that keeps real addEventListener
 * semantics (one registration per listener and capture flag).
 *
 * Run with: node --test tests/test_whiteboard_parking_lot_escape.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const source = readFileSync(join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'static', 'whiteboard-notes.js'), 'utf8');

function liftFunctions(sandbox, names) {
  for (const name of names) {
    const start = source.indexOf(`\nfunction ${name}(`);
    assert.notEqual(start, -1, `${name} not found`);
    const end = source.indexOf('\n}\n', start);
    assert.notEqual(end, -1, `${name} has no closing brace at column 0`);
    vm.runInNewContext(source.slice(start, end + 3), sandbox);
  }
}

function fakeElement(tag) {
  const classes = new Set();
  const el = {
    tagName: tag, id: '', className: '', textContent: '', dataset: {}, children: [], isConnected: false,
    classList: {
      add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c),
    },
    setAttribute() {}, addEventListener() {}, removeEventListener() {}, focus() {},
    appendChild(child) { el.children.push(child); child.isConnected = true; return child; },
    remove() { el.isConnected = false; doc.byId.delete(el.id); },
  };
  return el;
}

// One registration per (listener, capture), like the real DOM.
const listeners = { true: new Set(), false: new Set() };
const doc = {
  byId: new Map(),
  body: null,
  getElementById(id) {
    for (const el of walk(doc.body)) if (el.id === id && el.isConnected) return el;
    return null;
  },
  createElement: (tag) => fakeElement(tag),
  addEventListener: (type, fn, capture) => { if (type === 'keydown') listeners[!!capture].add(fn); },
  removeEventListener: (type, fn, capture) => { if (type === 'keydown') listeners[!!capture].delete(fn); },
};
doc.body = fakeElement('body');
doc.body.isConnected = true;
function* walk(el) {
  yield el;
  for (const child of el.children) if (child.isConnected) yield* walk(child);
}

function pressEscape() {
  const event = { key: 'Escape', preventDefault() {} };
  for (const fn of [...listeners.true, ...listeners.false]) fn(event);
}

const sandbox = {
  console,
  document: doc,
  setTimeout: () => 0, // the detach timer never fires: the panel stays mid-close
  clearTimeout() {},
  requestAnimationFrame: (fn) => fn(),
  WB_PARKING_LOT_PANEL_ANIM_MS: 200,
  wbRenderParkingLotList() {},
  wbParkingLotPanelChanged() {},
  wbWireParkingLotCanvasDropTarget() {},
};
liftFunctions(sandbox, ['wbOpenParkingLotPanel', 'wbCloseParkingLotPanel', 'wbParkingLotPanelKeydown']);

const panel = () => doc.getElementById('wbParkingLotPanel');
const isOpen = () => !!panel() && panel().classList.contains('open') && !panel().dataset.wbClosing;

test('Escape closes a freshly opened panel', () => {
  sandbox.wbOpenParkingLotPanel();
  assert.ok(isOpen());
  pressEscape();
  assert.equal(isOpen(), false);
});

test('Escape still closes the panel after it is reopened mid-slide-out', () => {
  // The previous test left the panel closing but still attached.
  assert.ok(panel() && panel().dataset.wbClosing, 'expected a panel mid-close');
  sandbox.wbOpenParkingLotPanel();
  assert.ok(isOpen());
  pressEscape();
  assert.equal(isOpen(), false, 'Escape did nothing: the reopened panel had no keydown listener');
});

test('reopening an open panel does not stack a second listener', () => {
  sandbox.wbOpenParkingLotPanel();
  sandbox.wbOpenParkingLotPanel();
  assert.equal(listeners.true.size, 1);
  pressEscape();
  assert.equal(listeners.true.size, 0);
});
