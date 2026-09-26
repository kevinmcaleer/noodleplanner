/**
 * The Product Breakdown Structure view (views-products.js) keeps one set of
 * pan/zoom listeners, and keeps the user's pan and zoom across edits.
 *
 * updatePbs() runs on every updateAllViews() pass -- every edit -- and
 * called initPbs(), which added a fresh wheel and pointerdown listener to
 * #pbsContainer each time. The container outlives every render (initPbs()
 * only replaces its contents), so after N edits one wheel notch zoomed by
 * 1.1^N and one drag ran N pans. updatePbs() then zoom-fitted the tree
 * every time too, throwing away wherever the user had panned or zoomed.
 *
 * Run with: node --test tests/test_pbs_pan_zoom.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const source = readFileSync(
  join(repo, 'packages', 'noodle-web', 'src', 'noodle_web', 'static', 'views-products.js'), 'utf8');

/** Top-level `function name(` ... `\n}` declarations from views-products.js. */
function liftFunctions(sandbox, names) {
  for (const name of names) {
    const start = source.indexOf(`\nfunction ${name}(`);
    assert.notEqual(start, -1, `${name} not found`);
    const end = source.indexOf('\n}\n', start);
    assert.notEqual(end, -1, `${name} has no closing brace at column 0`);
    vm.runInContext(source.slice(start, end + 3), sandbox);
  }
}

function fakeNode() {
  return {
    attributes: {},
    children: [],
    setAttribute(k, v) { this.attributes[k] = v; },
    appendChild(child) { this.children.push(child); return child; },
    remove() {},
  };
}

function fakeContainer(width, height) {
  const listeners = {};
  return {
    ...fakeNode(),
    clientWidth: width,
    clientHeight: height,
    dataset: {},
    style: {},
    set innerHTML(_) { this.children = []; },
    listeners,
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    setPointerCapture() {},
    hasPointerCapture: () => false,
    releasePointerCapture() {},
    fire(type, event) { for (const fn of listeners[type] || []) fn({ preventDefault() {}, ...event }); },
  };
}

function loadPbs(container) {
  const docListeners = {};
  const sandbox = vm.createContext({
    Math,
    // views-products.js's own top-level state, which lifting its functions
    // leaves behind
    pbsTasks: [], pbsTree: null, pbsSvg: null, pbsGroup: null,
    pbsZoom: 1, pbsPanX: 0, pbsPanY: 0, pbsIsDragging: false,
    pbsDragStartX: 0, pbsDragStartY: 0, pbsDragStartPanX: 0, pbsDragStartPanY: 0,
    pbsHasFitted: false,
    document: {
      getElementById: (id) => (id === 'pbsContainer' ? container : null),
      querySelector: () => null,
      addEventListener(type, fn) { (docListeners[type] ||= []).push(fn); },
      removeEventListener(type, fn) { docListeners[type] = (docListeners[type] || []).filter(f => f !== fn); },
    },
    setTimeout: () => {},
    checkDuplicateDeliverables() {},
    pbsCreateSVGElement: () => fakeNode(),
    pbsExtractDeliverables: (tasks) => tasks,
    pbsBuildTree: () => ({ x: 0, y: 0, width: 400, height: 100, children: [] }),
    pbsMeasure() {},
    pbsLayoutTree() {},
  });
  // pbsRender() draws into a fresh group carrying the current pan/zoom
  vm.runInContext(`function pbsRender() {
    pbsGroup = pbsCreateSVGElement('g', {});
    pbsGroup.setAttribute('transform', 'translate(' + pbsPanX + ',' + pbsPanY + ') scale(' + pbsZoom + ')');
    pbsSvg.appendChild(pbsGroup);
  }`, sandbox);
  liftFunctions(sandbox, ['initPbs', 'pbsApplyTransform', 'pbsZoomFit', 'pbsGetBounds', 'updatePbs']);
  return sandbox;
}

const TASKS = [{ name: 'Product', deliverable: 'prod' }];

test('re-rendering on every edit attaches the pan/zoom listeners once', () => {
  const container = fakeContainer(800, 600);
  const pbs = loadPbs(container);
  for (let edit = 0; edit < 5; edit++) pbs.updatePbs(TASKS, 'Plan');

  assert.equal((container.listeners.wheel || []).length, 1);
  assert.equal((container.listeners.pointerdown || []).length, 1);

  const before = pbs.pbsZoom;
  container.fire('wheel', { deltaY: -1 });
  assert.ok(Math.abs(pbs.pbsZoom - before * 1.1) < 1e-9, `one notch zoomed ${pbs.pbsZoom / before}x`);
});

test('the first render fits the tree; later renders keep the pan and zoom', () => {
  const container = fakeContainer(800, 600);
  const pbs = loadPbs(container);
  pbs.updatePbs(TASKS, 'Plan');
  const fitted = pbs.pbsZoom;
  assert.ok(fitted > 0 && fitted !== 1, 'fitted to the container');

  // the user zooms and pans, then keeps editing the plan
  container.fire('wheel', { deltaY: -1 });
  pbs.pbsPanX = 123;
  pbs.pbsPanY = 45;
  const zoomed = pbs.pbsZoom;
  pbs.updatePbs(TASKS, 'Plan');
  pbs.updatePbs(TASKS, 'Plan');

  assert.equal(pbs.pbsZoom, zoomed);
  assert.equal(pbs.pbsPanX, 123);
  assert.equal(pbs.pbsPanY, 45);
  assert.equal(pbs.pbsGroup.attributes.transform, `translate(123,45) scale(${zoomed})`);
});

test('a render while the view is hidden does not use up the first fit', () => {
  const container = fakeContainer(0, 0);
  const pbs = loadPbs(container);
  pbs.updatePbs(TASKS, 'Plan');
  assert.equal(pbs.pbsZoom, 1, 'nothing to fit to at 0x0');

  container.clientWidth = 800;
  container.clientHeight = 600;
  pbs.updatePbs(TASKS, 'Plan');
  assert.ok(pbs.pbsZoom !== 1 && pbs.pbsZoom > 0, 'fitted once it has a size');
});
