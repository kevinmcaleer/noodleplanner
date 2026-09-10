/**
 * Tests for the Whiteboard view's pan/zoom logic (issue #845).
 *
 * Runs the real whiteboard.js in a sandbox and exercises:
 *   1. the pure helpers (zoom clamping, button-disable state, anchored
 *      zoom math, viewport key/serialize/parse) directly — no DOM needed;
 *   2. initWhiteboard() against a minimal DOM/SVG/localStorage stub, to
 *      check first-ever-open vs. restore-from-localStorage behaviour and
 *      that pan/zoom changes are persisted per project and never touch
 *      anything resembling plan text.
 *
 * Run with: node tests/test_whiteboard_viewport.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'packages', 'noodle-web', 'src',
        'noodle_web', 'static', 'whiteboard.js'),
    'utf8'
);

let failures = 0;
function assert(condition, msg) {
    if (!condition) {
        failures++;
        console.error('FAIL:', msg);
    } else {
        console.log('PASS:', msg);
    }
}
function assertClose(actual, expected, msg, eps = 1e-6) {
    assert(Math.abs(actual - expected) < eps, `${msg} (actual=${actual}, expected=${expected})`);
}

// ── Part 1: pure helpers, no DOM ────────────────────────────────────────
{
    const sandbox = { console };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);

    const {
        wbClampZoom,
        wbZoomButtonState,
        wbAnchoredZoomPan,
        wbViewportStorageKey,
        wbSerializeViewport,
        wbParseViewport,
        wbViewportToBoardRect,
    } = sandbox;

    // NOTE: WB_MIN_ZOOM/WB_MAX_ZOOM are declared `const` at module scope in
    // whiteboard.js, so — like any top-level let/const in a vm context —
    // they don't attach as own properties of the sandbox object (only
    // `var` and function declarations do). We confirm the 25%/400% range
    // behaviourally instead, via wbClampZoom() and wbZoomButtonState()
    // below, which is what actually matters.
    assertClose(wbClampZoom(1), 1, 'clamp is a no-op inside range');
    assertClose(wbClampZoom(0.1), 0.25, 'clamp floors at 25%');
    assertClose(wbClampZoom(10), 4, 'clamp ceilings at 400%');

    {
        const { zoomInDisabled, zoomOutDisabled } = wbZoomButtonState(1);
        assert(zoomInDisabled === false && zoomOutDisabled === false, 'neither button disabled at 100%');
    }
    {
        const { zoomInDisabled, zoomOutDisabled } = wbZoomButtonState(4);
        assert(zoomInDisabled === true && zoomOutDisabled === false, 'zoom-in disabled at 400% cap');
    }
    {
        const { zoomInDisabled, zoomOutDisabled } = wbZoomButtonState(0.25);
        assert(zoomInDisabled === false && zoomOutDisabled === true, 'zoom-out disabled at 25% floor');
    }

    // Anchored zoom: the board point under the anchor must render at the
    // same screen position before and after the zoom change.
    {
        const panX = 50, panY = 30, oldZoom = 1, newZoom = 2, anchorX = 200, anchorY = 150;
        const boardX = (anchorX - panX) / oldZoom;
        const boardY = (anchorY - panY) / oldZoom;

        const next = wbAnchoredZoomPan(panX, panY, oldZoom, newZoom, anchorX, anchorY);
        const screenXAfter = next.panX + newZoom * boardX;
        const screenYAfter = next.panY + newZoom * boardY;

        assertClose(screenXAfter, anchorX, 'anchored zoom keeps board point under cursor (x)');
        assertClose(screenYAfter, anchorY, 'anchored zoom keeps board point under cursor (y)');
    }
    {
        // Zooming out should behave symmetrically.
        const panX = -40, panY = 90, oldZoom = 2, newZoom = 0.5, anchorX = 10, anchorY = 400;
        const boardX = (anchorX - panX) / oldZoom;
        const boardY = (anchorY - panY) / oldZoom;
        const next = wbAnchoredZoomPan(panX, panY, oldZoom, newZoom, anchorX, anchorY);
        assertClose(next.panX + newZoom * boardX, anchorX, 'anchored zoom-out keeps board point under cursor (x)');
        assertClose(next.panY + newZoom * boardY, anchorY, 'anchored zoom-out keeps board point under cursor (y)');
    }

    // wbViewportToBoardRect() (issue #847): the inverse of the same
    // translate(pan) scale(zoom) transform exercised above -- given the
    // current pan/zoom and an on-screen window, it must recover the exact
    // board-space rectangle that window shows right now.
    {
        // At 100% zoom with no pan, the screen window maps 1:1 onto board
        // space starting at the origin.
        const identity = wbViewportToBoardRect(0, 0, 1, 1200, 800);
        assertClose(identity.x, 0, 'no pan/zoom: viewport rect x is the screen origin');
        assertClose(identity.y, 0, 'no pan/zoom: viewport rect y is the screen origin');
        assertClose(identity.width, 1200, 'no pan/zoom: viewport rect width matches the screen 1:1');
        assertClose(identity.height, 800, 'no pan/zoom: viewport rect height matches the screen 1:1');

        // Panned and zoomed: the board point currently rendering at the
        // screen origin must be recoverable from panX/panY/zoom, and the
        // rect's size must shrink by 1/zoom (zoomed in -> less board is
        // visible for the same screen size).
        const panX = 100, panY = -50, zoom = 2;
        const rect = wbViewportToBoardRect(panX, panY, zoom, 1200, 800);
        // screen = pan + zoom * board  =>  board = (screen - pan) / zoom, at screen (0,0):
        assertClose(rect.x, (0 - panX) / zoom, 'panned/zoomed viewport rect x is the inverse transform of the screen origin');
        assertClose(rect.y, (0 - panY) / zoom, 'panned/zoomed viewport rect y is the inverse transform of the screen origin');
        assertClose(rect.width, 1200 / zoom, 'panned/zoomed viewport rect width is screen width / zoom');
        assertClose(rect.height, 800 / zoom, 'panned/zoomed viewport rect height is screen height / zoom');

        // Round-trip through wbAnchoredZoomPan()'s own screen = pan + zoom
        // * board relationship: the board point this rect claims is under
        // the screen origin must actually render back at the screen
        // origin under the same pan/zoom.
        assertClose(panX + zoom * rect.x, 0, 'the rect\'s own top-left board point renders back at the screen origin (x)');
        assertClose(panY + zoom * rect.y, 0, 'the rect\'s own top-left board point renders back at the screen origin (y)');

        // An invalid/zero zoom must never divide by zero.
        const safe = wbViewportToBoardRect(0, 0, 0, 1200, 800);
        assert(isFinite(safe.x) && isFinite(safe.width), 'a zero zoom falls back to treating it as 1 rather than producing Infinity/NaN');

        // Optional screenX/screenY offset: the floating outline panel covers
        // the left of the canvas, so wbCurrentViewportBoardRect() asks about
        // the *visible* sub-region rather than the whole canvas -- otherwise
        // "first free space in the viewport" could place a new note behind
        // the panel, where the user never sees it appear.
        const full = wbViewportToBoardRect(-100, -50, 2, 800, 600);
        const inset = wbViewportToBoardRect(-100, -50, 2, 528, 600, 272, 0);
        assertClose(inset.x, (272 + 100) / 2, 'a screen-x offset shifts the board rect by offset / zoom');
        assertClose(inset.y, full.y, '...leaving y alone when only x is offset');
        assertClose(inset.width, 528 / 2, 'the narrowed window is still scaled by zoom');
        assert(inset.x > full.x, 'skipping the panel starts the scan to the right of the full canvas');

        const vertical = wbViewportToBoardRect(0, 0, 1, 800, 500, 0, 100);
        assertClose(vertical.y, 100, 'a screen-y offset shifts the board rect down');
        assertClose(vertical.x, 0, '...leaving x alone when only y is offset');
    }

    // Per-project storage key convention (mirrors mindmap_branch_colours_<projectId>).
    assert(wbViewportStorageKey('abc123') === 'whiteboard_viewport_abc123', 'key is prefixed and scoped by project id');
    assert(wbViewportStorageKey(null) === 'whiteboard_viewport_default', 'falls back to "default" project id');

    const raw = wbSerializeViewport(1.5, 10, -20);
    const parsed = wbParseViewport(raw);
    assert(parsed && parsed.zoom === 1.5 && parsed.panX === 10 && parsed.panY === -20, 'serialize/parse round-trips a viewport');

    assert(wbParseViewport(null) === null, 'parsing null returns null');
    assert(wbParseViewport('not json') === null, 'parsing garbage returns null instead of throwing');
    assert(wbParseViewport('{"zoom":"nope","panX":1,"panY":1}') === null, 'parsing a non-numeric field returns null');

    const oob = wbParseViewport(wbSerializeViewport(99, 0, 0));
    assert(oob && oob.zoom === 4, 'a persisted out-of-range zoom is clamped back into range on load');
}

// ── Part 2: initWhiteboard() against a minimal DOM/SVG stub ────────────

function makeLocalStorage() {
    const data = new Map();
    return {
        getItem(k) { return data.has(k) ? data.get(k) : null; },
        setItem(k, v) { data.set(k, String(v)); },
        removeItem(k) { data.delete(k); },
        clear() { data.clear(); },
        snapshot() { return Object.fromEntries(data); },
    };
}

/**
 * A very small fake DOM: just enough surface area for initWhiteboard() and
 * its listeners to run without throwing. SVG elements are represented as
 * plain objects with attribute maps, classList, and a queryable children
 * array — no rendering, but exactly what a translate/scale transform test
 * needs to inspect.
 */
function makeFakeDom() {
    // Mirrors real DOM behaviour: classList and the `class` attribute are
    // two views onto the same state, whichever whiteboard.js happens to
    // use (it uses both — classList.add() for the svg/layer, setAttribute
    // for the grid rect/dot, exactly as a real browser would keep in sync).
    function makeClassList(el) {
        const set = new Set();
        return {
            add(c) { set.add(c); el.attrs.class = Array.from(set).join(' '); },
            remove(c) { set.delete(c); el.attrs.class = Array.from(set).join(' '); },
            contains(c) { return set.has(c); },
            _syncFromAttr(v) {
                set.clear();
                String(v || '').split(/\s+/).filter(Boolean).forEach((c) => set.add(c));
            },
        };
    }

    function makeElement(tag) {
        const el = {
            tag,
            attrs: {},
            children: [],
            style: {},
            dataset: {},
            listeners: {},
            setAttribute(k, v) {
                el.attrs[k] = String(v);
                if (k === 'class') el.classList._syncFromAttr(v);
            },
            getAttribute(k) { return Object.prototype.hasOwnProperty.call(el.attrs, k) ? el.attrs[k] : null; },
            appendChild(child) { el.children.push(child); child.parentEl = el; return child; },
            addEventListener(type, fn) {
                el.listeners[type] = el.listeners[type] || [];
                el.listeners[type].push(fn);
            },
            querySelector(sel) {
                // Only the handful of selectors whiteboard.js actually uses.
                const wantsClass = sel.startsWith('.') ? sel.slice(1) : null;
                const wantsSvgClass = sel.startsWith('svg.') ? sel.slice(4) : null;
                function search(node) {
                    for (const child of node.children) {
                        if (wantsSvgClass && child.tag === 'svg' && child.classList.contains(wantsSvgClass)) return child;
                        if (wantsClass && child.classList.contains(wantsClass)) return child;
                        const found = search(child);
                        if (found) return found;
                    }
                    return null;
                }
                return search(el);
            },
            querySelectorAll() { return []; },
            getBoundingClientRect() { return { width: 800, height: 600, left: 0, top: 0 }; },
            classList: null,
        };
        el.classList = makeClassList(el);
        return el;
    }

    const byId = new Map();
    const document = {
        createElementNS(_ns, tag) { return makeElement(tag); },
        getElementById(id) { return byId.get(id) || null; },
        _register(id, el) { byId.set(id, el); },
    };
    return { document, makeElement };
}

{
    const ls = makeLocalStorage();
    const { document, makeElement } = makeFakeDom();

    const container = makeElement('div');
    container.id = 'whiteboardContainer';
    document._register('whiteboardContainer', container);

    const zoomLabel = makeElement('span');
    document._register('whiteboardZoomLabel', zoomLabel);
    const zoomInBtn = makeElement('button');
    document._register('whiteboardZoomInBtn', zoomInBtn);
    const zoomOutBtn = makeElement('button');
    document._register('whiteboardZoomOutBtn', zoomOutBtn);

    const sandbox = {
        console,
        document,
        window: { addEventListener() {} },
        localStorage: ls,
        setTimeout,
        clearTimeout,
        getCurrentProjectId: () => 'proj-1',
    };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);

    // NOTE ON ASSERTIONS BELOW: whiteboard.js's pan/zoom state (wbZoom,
    // wbPanX, wbPanY, ...) is deliberately module-scoped with `let`, as any
    // normal browser script would do. In a vm context, `let`/`const`
    // bindings at top level do NOT become own properties of the sandbox
    // object (only `var` and function declarations do) — real DOM
    // elements are unaffected by that, so we assert on observable output
    // (the zoom label text, the transform attribute, localStorage) rather
    // than reaching into internal state. That is arguably the more honest
    // behavioural test anyway.

    // First ever open: no persisted viewport for this project → the board
    // falls back to whiteboardZoomFit(), which (no notes yet) resets to a
    // centred 100% view (400,300 of an 800x600 canvas rect).
    sandbox.initWhiteboard();
    assert(zoomLabel.textContent === '100%', 'first-ever-open resets to 100% zoom');

    const svg = container.querySelector('svg.wb-svg');
    assert(!!svg, 'initWhiteboard() creates the SVG canvas element');
    const grid = svg.querySelector('.wb-grid');
    assert(!!grid, 'initWhiteboard() creates the dot-grid background rect');
    const layer = svg.querySelector('.wb-layer');
    assert(layer.getAttribute('transform') === 'translate(400, 300) scale(1)', 'first-ever-open centres the single transform on the canvas');

    // Simulate a pan, exactly as the keyboard handler would, and confirm
    // it lands on the single <g> layer as one translate(...) scale(...)
    // string (not per-element positioning).
    sandbox.wbHandleKeydown({ key: 'ArrowRight', preventDefault() {} });
    assert(layer.getAttribute('transform') === 'translate(352, 300) scale(1)', 'pan is applied as a single transform on the layer group');

    sandbox.whiteboardZoomIn();
    assert(zoomLabel.textContent === '125%', 'zoom-in increases zoom by the click step');

    // Force past the 400% cap and check the button disables.
    for (let i = 0; i < 30; i++) sandbox.whiteboardZoomIn();
    assert(zoomLabel.textContent === '400%', 'zoom is clamped at 400% no matter how many times zoom-in fires');
    assert(zoomInBtn.disabled === true, 'zoom-in button disables at the 400% cap');

    for (let i = 0; i < 60; i++) sandbox.whiteboardZoomOut();
    assert(zoomLabel.textContent === '25%', 'zoom is clamped at 25% no matter how many times zoom-out fires');
    assert(zoomOutBtn.disabled === true, 'zoom-out button disables at the 25% floor');

    // Persistence: force the debounced save to run immediately, then
    // confirm it landed under a key scoped to the current project and
    // that nothing resembling plan/markdown text was ever written.
    sandbox.wbSaveViewportNow();
    const stored = ls.snapshot();
    const keys = Object.keys(stored);
    assert(keys.length === 1 && keys[0] === 'whiteboard_viewport_proj-1', 'viewport is saved under a project-scoped key');
    assert(!/[\r\n]/.test(stored[keys[0]]), 'persisted value is a flat JSON viewport blob, not multi-line plan text');
    const savedParsed = JSON.parse(stored[keys[0]]);
    assert(savedParsed.zoom === 0.25, 'persisted value reflects the current zoom');

    // Re-initialising (as happens on reload, in a fresh sandbox) should
    // restore exactly what was saved rather than re-fitting.
    {
        const container2 = makeElement('div');
        container2.id = 'whiteboardContainer';
        const zoomLabel2 = makeElement('span');
        const zoomInBtn2 = makeElement('button');
        const zoomOutBtn2 = makeElement('button');
        const document2 = {
            createElementNS(_ns, tag) { return makeElement(tag); },
            getElementById(id) {
                if (id === 'whiteboardContainer') return container2;
                if (id === 'whiteboardZoomLabel') return zoomLabel2;
                if (id === 'whiteboardZoomInBtn') return zoomInBtn2;
                if (id === 'whiteboardZoomOutBtn') return zoomOutBtn2;
                return null;
            },
        };
        const sandbox2 = {
            console,
            document: document2,
            window: { addEventListener() {} },
            localStorage: ls, // same storage — simulates a page reload
            setTimeout,
            clearTimeout,
            getCurrentProjectId: () => 'proj-1',
        };
        vm.createContext(sandbox2);
        vm.runInContext(source, sandbox2);
        sandbox2.initWhiteboard();
        assert(zoomLabel2.textContent === '25%', 'reload restores the persisted zoom for the same project');
    }

    // A different project must not see the first project's viewport.
    {
        const container3 = makeElement('div');
        container3.id = 'whiteboardContainer';
        const zoomLabel3 = makeElement('span');
        const document3 = {
            createElementNS(_ns, tag) { return makeElement(tag); },
            getElementById(id) {
                if (id === 'whiteboardContainer') return container3;
                if (id === 'whiteboardZoomLabel') return zoomLabel3;
                return null;
            },
        };
        const sandbox3 = {
            console,
            document: document3,
            window: { addEventListener() {} },
            localStorage: ls,
            setTimeout,
            clearTimeout,
            getCurrentProjectId: () => 'proj-2',
        };
        vm.createContext(sandbox3);
        vm.runInContext(source, sandbox3);
        sandbox3.initWhiteboard();
        assert(zoomLabel3.textContent === '100%', 'a different project gets its own first-ever-open (not project-1\'s saved zoom)');
    }
}

if (failures > 0) {
    console.error(`\n${failures} test(s) failed.`);
    process.exit(1);
}

console.log('\nAll tests passed.');
