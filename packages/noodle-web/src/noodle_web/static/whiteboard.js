/**
 * Whiteboard View — empty infinite canvas with pan/zoom (issue #845).
 *
 * This is the empty canvas and its controls only. It never reads or writes
 * plan data (the .md file) — pan/zoom is pure view state, persisted per
 * project in localStorage the same way mindmap.js scopes its branch-colour
 * key by project id (see mindmapBranchColourKey()).
 *
 * A single <g class="wb-layer"> element carries the pan/zoom transform
 * (translate(...) scale(...)), matching mindmapApplyTransform()'s approach
 * so panning stays cheap — a later issue (notes, per #844's storage format)
 * is expected to append note elements as siblings inside that same layer
 * rather than repositioning individual elements on every pan/zoom tick.
 *
 * Fit-to-content choice: this issue ships an empty board with no notes to
 * fit around, so "Fit" is implemented as a centred 100% reset — the same
 * result as the "100%" button. wbZoomFitBounds() below is written so that
 * once a later issue adds note elements (expected to carry a `.wb-note`
 * class), whiteboardZoomFit() will automatically start computing a real
 * bounding box instead, without needing to be touched again.
 */

// ── Configuration ───────────────────────────────────────────────────────
const WB_MIN_ZOOM = 0.25;
const WB_MAX_ZOOM = 4;
const WB_ZOOM_CLICK_STEP = 1.25;   // multiplicative factor for +/- buttons and keys
const WB_ZOOM_WHEEL_STEP = 1.08;   // multiplicative factor per wheel tick
const WB_KEY_PAN_STEP = 48;        // px per arrow-key press
const WB_GRID_SIZE = 28;           // dot spacing, in board units
const WB_SAVE_DEBOUNCE_MS = 300;
const WB_ANIM_MS = 200;

// ── State ────────────────────────────────────────────────────────────────
let wbSvg = null;
let wbGroup = null;
// The layer drawn *above* the notes (the lasso), carrying the same pan/zoom
// transform as wbGroup -- see wbPlaceBoardObject() for why the notes
// themselves sit between the two, untransformed.
let wbOverlayGroup = null;
let wbZoom = 1;
let wbPanX = 0;
let wbPanY = 0;

let wbIsDragging = false;
let wbDragStartX = 0;
let wbDragStartY = 0;
let wbDragStartPanX = 0;
let wbDragStartPanY = 0;

let wbTouchStartDist = 0;
let wbTouchStartZoom = 1;
let wbTouchMidX = 0;
let wbTouchMidY = 0;

let wbSaveDebounceTimer = null;

// The last non-empty visible canvas rect (see wbCurrentViewportBoardRect()),
// and a new note waiting to be brought on screen once the canvas is shown
// (see whiteboardRevealNote()).
let wbLastVisibleRect = null;
let wbPendingRevealTask = null;

// ── Pure helpers (no DOM — unit tested directly) ───────────────────────

/**
 * Clamp a zoom level to the whiteboard's allowed range (25%-400%).
 */
function wbClampZoom(zoom) {
    return Math.min(WB_MAX_ZOOM, Math.max(WB_MIN_ZOOM, zoom));
}

/**
 * Whether the zoom-in / zoom-out buttons should be disabled at the current
 * zoom level (at or past the clamp limits).
 */
function wbZoomButtonState(zoom) {
    const eps = 0.001;
    return {
        zoomInDisabled: zoom >= WB_MAX_ZOOM - eps,
        zoomOutDisabled: zoom <= WB_MIN_ZOOM + eps
    };
}

/**
 * Given the current pan/zoom and a screen-space anchor point (relative to
 * the canvas element), compute the new pan so the board point under the
 * anchor stays under the anchor after zooming from oldZoom to newZoom.
 *
 * Transform is `translate(panX, panY) scale(zoom)`, so a board point p
 * renders at screen point `pan + zoom * p`. Keeping `anchor` fixed means
 * solving `anchor = newPan + newZoom * ((anchor - oldPan) / oldZoom)`.
 */
function wbAnchoredZoomPan(panX, panY, oldZoom, newZoom, anchorX, anchorY) {
    const ratio = newZoom / oldZoom;
    return {
        panX: anchorX - (anchorX - panX) * ratio,
        panY: anchorY - (anchorY - panY) * ratio
    };
}

/**
 * localStorage key for the persisted viewport, scoped to a project — same
 * prefixed-by-projectId convention as mindmapBranchColourKey().
 */
function wbViewportStorageKey(projectId) {
    return 'whiteboard_viewport_' + (projectId || 'default');
}

function wbSerializeViewport(zoom, panX, panY) {
    return JSON.stringify({ zoom, panX, panY });
}

/**
 * Parse a persisted viewport string. Returns null if missing/invalid so
 * callers can fall back to the first-ever-open behaviour.
 */
function wbParseViewport(raw) {
    if (!raw) return null;
    try {
        const data = JSON.parse(raw);
        if (
            !data ||
            typeof data.zoom !== 'number' || !isFinite(data.zoom) ||
            typeof data.panX !== 'number' || !isFinite(data.panX) ||
            typeof data.panY !== 'number' || !isFinite(data.panY)
        ) {
            return null;
        }
        return { zoom: wbClampZoom(data.zoom), panX: data.panX, panY: data.panY };
    } catch (e) {
        return null;
    }
}

// ── Persistence (view state only — never touches plan text) ────────────

function wbProjectId() {
    return (typeof getCurrentProjectId === 'function' && getCurrentProjectId()) || 'default';
}

function wbSaveViewportNow() {
    try {
        localStorage.setItem(
            wbViewportStorageKey(wbProjectId()),
            wbSerializeViewport(wbZoom, wbPanX, wbPanY)
        );
    } catch (e) {
        // Storage full/unavailable — pan/zoom simply won't persist.
    }
}

function wbScheduleSaveViewport() {
    if (wbSaveDebounceTimer) clearTimeout(wbSaveDebounceTimer);
    wbSaveDebounceTimer = setTimeout(wbSaveViewportNow, WB_SAVE_DEBOUNCE_MS);
}

function wbLoadViewport() {
    try {
        return wbParseViewport(localStorage.getItem(wbViewportStorageKey(wbProjectId())));
    } catch (e) {
        return null;
    }
}

// ── Transform / rendering ───────────────────────────────────────────────

function wbApplyTransform(animate) {
    if (!wbGroup) return;
    // The first placement has nothing on screen to animate from.
    if (!wbGroup.getAttribute('transform')) animate = false;
    const transformStr = `translate(${wbPanX}, ${wbPanY}) scale(${wbZoom})`;
    const groups = [wbGroup, wbOverlayGroup].filter(Boolean);
    const target = { zoom: wbZoom, panX: wbPanX, panY: wbPanY };
    if (animate) {
        groups.forEach((g) => {
            g.style.transition = `transform ${WB_ANIM_MS}ms ease`;
            g.setAttribute('transform', transformStr);
        });
        setTimeout(() => {
            groups.forEach((g) => { g.style.transition = ''; });
        }, WB_ANIM_MS);
        wbTweenBoardObjects(target);
    } else {
        groups.forEach((g) => {
            g.style.transition = '';
            g.setAttribute('transform', transformStr);
        });
        wbTweenBoardObjects(null);
        wbPlaceBoardObjects(target);
    }
    // Notes (issue #846) degrade to a title-only card below a zoom
    // threshold, independent of any plan-text change -- refresh that
    // per-note class on every pan/zoom tick.
    if (typeof wbUpdateNoteZoomTiers === 'function') wbUpdateNoteZoomTiers();
}

// ── Notes and text objects: placed in screen space ─────────────────────
//
// Notes and text objects are HTML inside SVG <foreignObject>s. WebKit
// (Safari) paints any HTML in a <foreignObject> that gets a layer of its
// own -- position: relative/absolute, which the note card and its grip,
// rails and scissors all use -- *without* the transforms of the SVG
// around it. Inside the panned and zoomed wbGroup that left every note
// frozen at its unpanned, unzoomed spot (behind the outline panel, for a
// note near the board origin) while the canvas and the noodles moved.
// A nested <svg viewBox> is ignored the same way; only the
// <foreignObject>'s own x/y are honoured.
//
// So they live in an *untransformed* layer between wbGroup and
// wbOverlayGroup, and each one is placed in screen space from its board
// geometry: x/y/width/height are the board rect run through the current
// pan/zoom, and the content inside is laid out at board size and scaled
// with CSS `zoom`. Board geometry is kept in data-wb-x/-y/-width/-height,
// the single source of truth -- read it with wbBoardRect() and write it
// with wbSetBoardRect(), never through the x/y/width/height attributes.

/** The pan/zoom the board objects are currently drawn at -- which lags
 * wbZoom/wbPanX/wbPanY while an animated transform is under way. */
let wbShownView = { zoom: 1, panX: 0, panY: 0 };
let wbTweenFrame = null;

/** A <foreignObject>'s board-space rect, from its data-wb-* attributes. */
function wbBoardRect(fo) {
    const d = (fo && fo.dataset) || {};
    return {
        x: parseFloat(d.wbX || '0') || 0,
        y: parseFloat(d.wbY || '0') || 0,
        width: parseFloat(d.wbWidth || '0') || 0,
        height: parseFloat(d.wbHeight || '0') || 0,
    };
}

/** Set some of a <foreignObject>'s board rect (`{x, y, width, height}`,
 * any subset) and redraw it where that now puts it on screen. */
function wbSetBoardRect(fo, rect) {
    if (!fo) return;
    if (rect.x != null) fo.dataset.wbX = String(rect.x);
    if (rect.y != null) fo.dataset.wbY = String(rect.y);
    if (rect.width != null) fo.dataset.wbWidth = String(rect.width);
    if (rect.height != null) fo.dataset.wbHeight = String(rect.height);
    wbPlaceBoardObject(fo);
}

/** Draw one <foreignObject> at its board rect under `view` (default: the
 * pan/zoom currently shown). */
function wbPlaceBoardObject(fo, view) {
    const v = view || wbShownView;
    const r = wbBoardRect(fo);
    const sx = v.panX + r.x * v.zoom;
    const sy = v.panY + r.y * v.zoom;
    fo.setAttribute('x', String(sx));
    fo.setAttribute('y', String(sy));
    fo.setAttribute('width', String(r.width * v.zoom));
    fo.setAttribute('height', String(r.height * v.zoom));
    const content = fo.firstElementChild;
    if (content && content.style) {
        // A note's card fills its rect; a text object's wrap sizes to its
        // own text inside an oversized box, so it only takes the zoom.
        if (fo.classList.contains('wb-note')) {
            content.style.width = r.width + 'px';
            content.style.height = r.height + 'px';
        }
        content.style.zoom = String(v.zoom);
        // WebKit only re-places a <foreignObject>'s layered content when
        // that content's own style changes -- moving the x/y attributes
        // alone left a panned note painted where it was. Any style write
        // does it; this one also records where the note was put.
        content.style.setProperty('--wb-placed-at', `${sx} ${sy}`);
    }
}

/** Redraw every note and text object at `view` (default: the target). */
function wbPlaceBoardObjects(view) {
    const v = view || { zoom: wbZoom, panX: wbPanX, panY: wbPanY };
    wbShownView = { zoom: v.zoom, panX: v.panX, panY: v.panY };
    const layer = wbSvg ? wbSvg.querySelector('.wb-notes-layer') : null;
    if (!layer) return;
    layer.querySelectorAll('foreignObject').forEach((fo) => wbPlaceBoardObject(fo, wbShownView));
}

/** CSS `ease` -- cubic-bezier(0.25, 0.1, 0.25, 1) -- at progress `t`, so a
 * tweened note keeps pace with the wbGroup it sits over, which the
 * browser animates with a `transition: transform ... ease`. */
function wbEase(t) {
    const x1 = 0.25, y1 = 0.1, x2 = 0.25, y2 = 1;
    const bez = (p1, p2, s) => 3 * p1 * s * (1 - s) * (1 - s) + 3 * p2 * s * s * (1 - s) + s * s * s;
    let lo = 0, hi = 1, s = t;
    for (let i = 0; i < 20; i++) {
        s = (lo + hi) / 2;
        if (bez(x1, x2, s) < t) lo = s; else hi = s;
    }
    return bez(y1, y2, s);
}

/** Animate the board objects from what is shown to `target` over
 * WB_ANIM_MS; `null` just cancels a tween in flight. Falls back to an
 * immediate redraw where there is no requestAnimationFrame. */
function wbTweenBoardObjects(target) {
    const raf = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame : null;
    if (wbTweenFrame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(wbTweenFrame);
    wbTweenFrame = null;
    if (!target) return;
    if (!raf) { wbPlaceBoardObjects(target); return; }

    const from = { ...wbShownView };
    const start = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    const frame = (now) => {
        const t = Math.min(1, (now - start) / WB_ANIM_MS);
        const k = wbEase(t);
        // Interpolated in screen space the way a CSS transform is: pan and
        // zoom move linearly in their own terms, so a board point tracks
        // the group underneath it exactly.
        wbPlaceBoardObjects({
            zoom: from.zoom + (target.zoom - from.zoom) * k,
            panX: from.panX + (target.panX - from.panX) * k,
            panY: from.panY + (target.panY - from.panY) * k,
        });
        wbTweenFrame = t < 1 ? raf(frame) : null;
    };
    wbTweenFrame = raf(frame);
}

function wbUpdateZoomLabel() {
    const label = document.getElementById('whiteboardZoomLabel');
    if (label) label.textContent = Math.round(wbZoom * 100) + '%';
}

function wbUpdateZoomButtons() {
    const { zoomInDisabled, zoomOutDisabled } = wbZoomButtonState(wbZoom);
    const inBtn = document.getElementById('whiteboardZoomInBtn');
    const outBtn = document.getElementById('whiteboardZoomOutBtn');
    if (inBtn) {
        inBtn.disabled = zoomInDisabled;
        inBtn.setAttribute('aria-disabled', String(zoomInDisabled));
    }
    if (outBtn) {
        outBtn.disabled = zoomOutDisabled;
        outBtn.setAttribute('aria-disabled', String(zoomOutDisabled));
    }
}

function wbCanvasCenter() {
    if (!wbSvg) return { x: 0, y: 0 };
    const rect = wbSvg.getBoundingClientRect();
    return { x: rect.width / 2, y: rect.height / 2 };
}

/**
 * Convert an on-screen viewport (a `screenWidth` x `screenHeight` window
 * whose top-left is (0,0) in canvas-relative screen space -- the same
 * space wbHandleWheel()'s anchorX/anchorY use) into a board-space
 * rectangle, given the current pan/zoom. This is the inverse of the
 * `translate(panX, panY) scale(zoom)` transform wbApplyTransform() applies
 * (see wbAnchoredZoomPan()'s comment for the same screen = pan + zoom *
 * board relationship this un-does): a board point p renders at screen
 * point `pan + zoom * p`, so the screen origin (0,0) maps back to board
 * point `-pan / zoom`, and a screenWidth/screenHeight window maps to a
 * `screenWidth/zoom` x `screenHeight/zoom` board-space window.
 *
 * `screenX`/`screenY` (default 0, 0) offset that window's top-left within
 * canvas-relative screen space, so a caller can ask about a *sub*-region
 * of the canvas -- which is what wbCurrentViewportBoardRect() does to skip
 * the strip hidden behind the floating outline panel.
 *
 * Pure (no DOM) so it's unit-testable directly -- see
 * wbCurrentViewportBoardRect() below for the live-state wrapper issue
 * #847's Add-note flow (whiteboard-notes.js) actually calls.
 */
function wbViewportToBoardRect(panX, panY, zoom, screenWidth, screenHeight, screenX = 0, screenY = 0) {
    const z = (typeof zoom === 'number' && zoom > 0) ? zoom : 1;
    return {
        x: (screenX - panX) / z,
        y: (screenY - panY) / z,
        width: screenWidth / z,
        height: screenHeight / z,
    };
}

/**
 * wbViewportToBoardRect() for the whiteboard's live canvas size and
 * current pan/zoom -- "the current viewport", in board coordinates, that
 * issue #847's Add-note flow places new notes inside. Falls back to a
 * generous default rect if the canvas hasn't been built yet (the picker
 * can only be opened from the whiteboard tab, so in practice wbSvg is
 * always set by the time this is called).
 */
function wbCurrentViewportBoardRect() {
    if (!wbSvg) return { x: 0, y: 0, width: 1200, height: 800 };
    // The *visible* canvas, not the full one: the floating outline panel
    // covers part of it (see wbVisibleCanvasRect()), and a note placed in
    // the "first free space in the viewport" would otherwise be free to
    // land behind the panel, where the user never sees it appear.
    //
    // While the whiteboard view is hidden (a note created from the ribbon
    // with another view showing) the canvas measures 0x0, and the "middle
    // of the screen" would collapse onto its top-left corner -- where the
    // outline panel sits. Use the size it had when last shown instead.
    let visible = wbVisibleCanvasRect();
    if (!visible.width || !visible.height) {
        if (!wbLastVisibleRect) return { x: 0, y: 0, width: 1200, height: 800 };
        visible = wbLastVisibleRect;
    }
    return wbViewportToBoardRect(
        wbPanX, wbPanY, wbZoom, visible.width, visible.height, visible.x, visible.y);
}

/**
 * The part of the canvas that isn't hidden behind a floating overlay --
 * currently just the outline panel (whiteboard-outline.js), which sits
 * over the left edge. Returned in canvas-relative screen space.
 *
 * Anything that frames content ("fit to content", "show me this note")
 * has to aim at *this* rectangle rather than the full canvas, or it
 * centres the board underneath the panel and the thing the user asked to
 * see ends up behind it. Measured from the live element rather than the
 * CSS constant so the narrow-viewport layout, where the panel becomes a
 * top overlay instead of a left column, is handled by the same code.
 */
function wbVisibleCanvasRect() {
    const full = wbSvg
        ? wbSvg.getBoundingClientRect()
        : { left: 0, top: 0, width: 0, height: 0 };
    const rect = { x: 0, y: 0, width: full.width, height: full.height };

    const panel = document.getElementById('whiteboardOutlinePanel');
    if (!panel || panel.classList.contains('hidden')) return wbRememberVisibleRect(rect);

    const p = panel.getBoundingClientRect();
    if (!p.width || !p.height) return wbRememberVisibleRect(rect);

    // A panel that spans most of the canvas height is a left column; one
    // that only takes the top is the narrow-viewport overlay.
    const gap = 12;
    if (p.height > full.height * 0.6) {
        const inset = Math.max(0, p.right - full.left) + gap;
        if (inset < full.width * 0.75) {
            rect.x = inset;
            rect.width = full.width - inset;
        }
    } else {
        const inset = Math.max(0, p.bottom - full.top) + gap;
        if (inset < full.height * 0.75) {
            rect.y = inset;
            rect.height = full.height - inset;
        }
    }
    return wbRememberVisibleRect(rect);
}

/** Keep the last non-empty visible rect (see wbCurrentViewportBoardRect()). */
function wbRememberVisibleRect(rect) {
    if (rect.width && rect.height) wbLastVisibleRect = rect;
    return rect;
}

/**
 * Zoom by `factor`, anchored on a screen-space point relative to the
 * canvas (so the board point under that point stays fixed).
 */
function wbZoomAt(anchorX, anchorY, factor, animate) {
    const newZoom = wbClampZoom(wbZoom * factor);
    if (newZoom === wbZoom) return;
    const next = wbAnchoredZoomPan(wbPanX, wbPanY, wbZoom, newZoom, anchorX, anchorY);
    wbZoom = newZoom;
    wbPanX = next.panX;
    wbPanY = next.panY;
    wbApplyTransform(animate);
    wbUpdateZoomLabel();
    wbUpdateZoomButtons();
    wbScheduleSaveViewport();
}

// ── Toolbar / keyboard entry points (onclick targets in index.html) ────

function whiteboardZoomIn() {
    const c = wbCanvasCenter();
    wbZoomAt(c.x, c.y, WB_ZOOM_CLICK_STEP, true);
}

function whiteboardZoomOut() {
    const c = wbCanvasCenter();
    wbZoomAt(c.x, c.y, 1 / WB_ZOOM_CLICK_STEP, true);
}

/**
 * Reset to 100%, centred on the canvas.
 */
function whiteboardZoomReset() {
    wbZoom = 1;
    const visible = wbVisibleCanvasRect();
    wbPanX = visible.x + visible.width / 2;
    wbPanY = visible.y + visible.height / 2;
    wbApplyTransform(true);
    wbUpdateZoomLabel();
    wbUpdateZoomButtons();
    wbScheduleSaveViewport();
}

/**
 * Fit the board to its content. No notes exist yet in this issue, so this
 * is equivalent to whiteboardZoomReset(). Once notes exist (`.wb-note`
 * elements inside the layer), this automatically switches to framing their
 * bounding box the way mindmapZoomFit() does for mm-node elements.
 */
function whiteboardZoomFit(options) {
    const maxZoom = (options && options.maxZoom) || WB_MAX_ZOOM;
    const notes = wbSvg ? wbSvg.querySelectorAll('.wb-notes-layer .wb-note') : [];
    if (!notes || notes.length === 0) {
        whiteboardZoomReset();
        return;
    }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    notes.forEach((el) => {
        const x = parseFloat(el.dataset.wbX || '0');
        const y = parseFloat(el.dataset.wbY || '0');
        const w = parseFloat(el.dataset.wbWidth || '0');
        const h = parseFloat(el.dataset.wbHeight || '0');
        if (x < minX) minX = x;
        if (x + w > maxX) maxX = x + w;
        if (y < minY) minY = y;
        if (y + h > maxY) maxY = y + h;
    });
    if (minX === Infinity || !wbSvg) {
        whiteboardZoomReset();
        return;
    }

    // Frame into the canvas the user can actually see -- the floating
    // outline panel covers part of it (see wbVisibleCanvasRect()), and
    // fitting to the full canvas would centre the board behind it.
    const visible = wbVisibleCanvasRect();
    const padding = 80;
    const boardW = Math.max(1, maxX - minX + padding * 2);
    const boardH = Math.max(1, maxY - minY + padding * 2);
    const centreX = (minX + maxX) / 2;
    const centreY = (minY + maxY) / 2;

    wbZoom = wbClampZoom(Math.min(visible.width / boardW, visible.height / boardH, maxZoom));
    wbPanX = visible.x + visible.width / 2 - centreX * wbZoom;
    wbPanY = visible.y + visible.height / 2 - centreY * wbZoom;

    wbApplyTransform(true);
    wbUpdateZoomLabel();
    wbUpdateZoomButtons();
    wbScheduleSaveViewport();
}

/**
 * Pan (and, if the board is zoomed far out, zoom in) so the note for
 * `taskName` sits in the middle of the canvas, then flash it. This is what
 * the floating outline panel calls when a row is clicked -- the "find my
 * note again" half of the outline's job (see whiteboard-outline.js).
 *
 * Zoom is only ever raised, never lowered: someone who has deliberately
 * zoomed in to read a note should not be yanked back out just because they
 * clicked a different row in the outline.
 */
function whiteboardFocusNote(taskName) {
    if (!wbSvg || typeof wbNoteNodes === 'undefined' || !wbNoteNodes) return false;
    const entry = wbNoteNodes.get(taskName);
    if (!entry || !entry.fo) return false;

    const { x, y, width: w, height: h } = wbBoardRect(entry.fo);

    // Centre it in the *visible* canvas -- panning a note to the middle of
    // the full canvas would park it behind the very panel that was just
    // clicked to find it.
    const visible = wbVisibleCanvasRect();
    const padding = (typeof WB_OUTLINE_FOCUS_PADDING === 'number') ? WB_OUTLINE_FOCUS_PADDING : 60;
    const fitZoom = wbClampZoom(Math.min(
        visible.width / Math.max(1, w + padding * 2),
        visible.height / Math.max(1, h + padding * 2)
    ));
    if (fitZoom > wbZoom) wbZoom = fitZoom;

    wbPanX = visible.x + visible.width / 2 - (x + w / 2) * wbZoom;
    wbPanY = visible.y + visible.height / 2 - (y + h / 2) * wbZoom;

    wbApplyTransform(true);
    wbUpdateZoomLabel();
    wbUpdateZoomButtons();
    wbScheduleSaveViewport();

    // Flash the note itself so it is obvious which one was found, even on
    // a board where several notes look alike.
    const card = entry.refs && entry.refs.card;
    if (card) {
        card.classList.remove('wb-note-flash');
        // Force a reflow so re-adding the class restarts the animation.
        void card.offsetWidth;
        card.classList.add('wb-note-flash');
        setTimeout(() => card.classList.remove('wb-note-flash'), 1400);
    }
    return true;
}

/**
 * Zoom and pan so a board rect fills the visible canvas, with a margin --
 * the object toolbar's "Zoom to". Unlike whiteboardFocusNote() it zooms out
 * as well as in, so a group bigger than the screen is framed whole.
 */
function wbZoomToBoardRect(rect) {
    if (!wbSvg || !rect) return false;
    const visible = wbVisibleCanvasRect();
    if (!visible.width || !visible.height) return false;
    const padding = 60;
    wbZoom = wbClampZoom(Math.min(
        visible.width / Math.max(1, rect.width + padding * 2),
        visible.height / Math.max(1, rect.height + padding * 2)
    ));
    wbPanX = visible.x + visible.width / 2 - (rect.x + rect.width / 2) * wbZoom;
    wbPanY = visible.y + visible.height / 2 - (rect.y + rect.height / 2) * wbZoom;
    wbApplyTransform(true);
    wbUpdateZoomLabel();
    wbUpdateZoomButtons();
    wbScheduleSaveViewport();
    return true;
}

/**
 * Bring a new note on screen: if the note for `taskName` is not wholly
 * inside the visible canvas (the canvas minus the outline panel), pan --
 * never zoom -- so it sits in the middle of it. No-op (returns false) when
 * it is already on screen, so a note placed beside the selected one does
 * not jerk the board about -- unless `options.centre`, which initWhiteboard()
 * passes for a note made while the view was hidden: nobody has seen where
 * it landed yet, so it is simply centred.
 *
 * This is what a *new* note calls (whiteboard-notes.js's wbRevealNewNote()):
 * placement tries hard to find room on screen, but a full screen has none,
 * and a note created off screen shows up in the markdown and the outline
 * while the canvas looks unchanged. Called while the whiteboard view is
 * hidden it is remembered and done when the view is next shown
 * (initWhiteboard()), since there is nothing to measure until then.
 */
/** Remember `taskName` as the note whiteboardRevealNote() should bring on
 * screen, until it manages to -- see wbRevealNewNote(). */
function whiteboardQueueReveal(taskName) {
    wbPendingRevealTask = taskName;
}

function whiteboardRevealNote(taskName, options) {
    if (!wbSvg || typeof wbNoteNodes === 'undefined' || !wbNoteNodes) return false;
    const entry = wbNoteNodes.get(taskName);
    if (!entry || !entry.fo) return false;

    const { x, y, width: w, height: h } = wbBoardRect(entry.fo);

    const visible = wbVisibleCanvasRect();
    if (!visible.width || !visible.height) {
        wbPendingRevealTask = taskName; // canvas hidden: nothing to aim at yet
        return false;
    }
    if (wbPendingRevealTask === taskName) wbPendingRevealTask = null;

    const left = wbPanX + x * wbZoom;
    const top = wbPanY + y * wbZoom;
    const onScreen = left >= visible.x && top >= visible.y &&
        left + w * wbZoom <= visible.x + visible.width &&
        top + h * wbZoom <= visible.y + visible.height;
    if (onScreen && !(options && options.centre)) return false;

    wbPanX = visible.x + visible.width / 2 - (x + w / 2) * wbZoom;
    wbPanY = visible.y + visible.height / 2 - (y + h / 2) * wbZoom;
    wbApplyTransform(true);
    wbScheduleSaveViewport();
    return true;
}

/**
 * Whether any note overlaps the visible canvas at the current pan/zoom.
 * True for an empty board -- there is nothing to be missing.
 */
function wbAnyNoteOnScreen() {
    const notes = wbSvg ? wbSvg.querySelectorAll('.wb-notes-layer .wb-note') : [];
    if (!notes.length) return true;
    const visible = wbVisibleCanvasRect();
    const view = wbViewportToBoardRect(
        wbPanX, wbPanY, wbZoom, visible.width, visible.height, visible.x, visible.y);
    return Array.from(notes).some((el) => {
        const x = parseFloat(el.dataset.wbX || '0');
        const y = parseFloat(el.dataset.wbY || '0');
        const w = parseFloat(el.dataset.wbWidth || '0');
        const h = parseFloat(el.dataset.wbHeight || '0');
        return x < view.x + view.width && x + w > view.x &&
            y < view.y + view.height && y + h > view.y;
    });
}

// ── Wheel / mouse / touch handlers ──────────────────────────────────────

/**
 * A wheel event's delta in pixels. A mouse wheel in Firefox reports lines
 * (deltaMode 1) and a page-flip wheel reports pages (deltaMode 2); a
 * trackpad always reports pixels. Normalising here is what makes a
 * two-finger swipe and a mouse wheel move the board by comparable amounts.
 */
function wbWheelPixels(delta, mode) {
    const d = delta || 0;
    if (mode === 1) return d * 16;
    if (mode === 2) return d * ((wbSvg && wbSvg.clientHeight) || 800);
    return d;
}

function wbHandleWheel(e) {
    e.preventDefault();
    if (!wbSvg) return;
    const rect = wbSvg.getBoundingClientRect();
    const anchorX = e.clientX - rect.left;
    const anchorY = e.clientY - rect.top;
    const dx = wbWheelPixels(e.deltaX, e.deltaMode);
    const dy = wbWheelPixels(e.deltaY, e.deltaMode);

    if (e.ctrlKey || e.metaKey) {
        // Ctrl/Cmd+wheel, and trackpad pinch (reported by browsers as a
        // wheel event with ctrlKey set) — zoom anchored on the pointer.
        //
        // A pinch arrives as a stream of small deltas (a few px each), so
        // it zooms in proportion to the delta; a fixed step per event made
        // a gentle pinch lurch. A notched mouse wheel (~100px per tick)
        // keeps the fixed WB_ZOOM_WHEEL_STEP it always had.
        const factor = Math.abs(dy) < 50
            ? Math.exp(-dy * 0.01)
            : (dy < 0 ? WB_ZOOM_WHEEL_STEP : 1 / WB_ZOOM_WHEEL_STEP);
        if (factor !== 1) wbZoomAt(anchorX, anchorY, factor, false);
    } else {
        // Two-finger swipe on a trackpad (and a plain mouse wheel): pan,
        // the way Obsidian's canvas does. Shift+wheel on a mouse scrolls
        // sideways, which browsers mostly report as deltaX already; the
        // swap covers the ones that still report it as deltaY.
        const horizontal = e.shiftKey && !dx;
        wbPanX -= horizontal ? dy : dx;
        wbPanY -= horizontal ? 0 : dy;
        wbApplyTransform(false);
        wbScheduleSaveViewport();
    }
}

// ── Canvas gestures ─────────────────────────────────────────────────────
//
// As on Obsidian's canvas, a drag on bare canvas draws a selection lasso:
// every note it touches is selected, and the selection toolbar (or
// Ctrl/Cmd+G) groups them. Moving round the board is a two-finger swipe
// on a trackpad (wbHandleWheel()), a middle-button drag, or a drag with
// Space held.

/** Space is held down: a plain drag pans instead of lassoing. */
let wbSpacePan = false;

function wbBeginPan(clientX, clientY) {
    wbIsDragging = true;
    wbDragStartX = clientX;
    wbDragStartY = clientY;
    wbDragStartPanX = wbPanX;
    wbDragStartPanY = wbPanY;
    if (wbSvg) wbSvg.classList.add('wb-dragging');
}

function wbHandleMouseDown(e) {
    // Middle-button drag pans from anywhere on the board.
    if (e.button === 1) {
        wbBeginPan(e.clientX, e.clientY);
        e.preventDefault();
        return;
    }
    if (e.button !== 0) return;
    if (e.target === wbSvg || e.target === wbGroup || (e.target.closest && e.target.closest('.wb-grid'))) {
        // preventDefault() below stops the press focusing the board, and
        // the board's keys (Ctrl/Cmd+G on what the lasso selects, Delete,
        // Space) listen on it -- so focus it here.
        const container = document.getElementById('whiteboardContainer');
        if (container && document.activeElement !== container) container.focus({ preventScroll: true });
        // Space held means "pan just this once".
        if (wbSpacePan) {
            wbBeginPan(e.clientX, e.clientY);
            e.preventDefault();
            return;
        }
        // A press on bare canvas dismisses any selected noodle, the same
        // way clicking away from a note closes its `...` menu -- and
        // (issue #1109) deselects any selected note too. Shift keeps the
        // note selection, so a shift-drag adds to it.
        if (typeof wbClearNoodleSelection === 'function') wbClearNoodleSelection();
        if (typeof wbClearDepNoodleSelection === 'function') wbClearDepNoodleSelection();
        if (!e.shiftKey && typeof wbClearNoteSelection === 'function') wbClearNoteSelection();
        if (typeof wbClearGroupSelection === 'function') wbClearGroupSelection();
        if (typeof wbClearTextSelection === 'function') wbClearTextSelection();
        if (typeof wbBeginLasso === 'function'
            && wbBeginLasso(e.clientX, e.clientY, e.shiftKey ? 'add' : 'select')) {
            e.preventDefault();
            return;
        }
        wbBeginPan(e.clientX, e.clientY);
        e.preventDefault();
    }
}

function wbHandleMouseMove(e) {
    if (typeof wbLasso !== 'undefined' && wbLasso) { wbUpdateLasso(e.clientX, e.clientY); return; }
    if (!wbIsDragging) return;
    wbPanX = wbDragStartPanX + (e.clientX - wbDragStartX);
    wbPanY = wbDragStartPanY + (e.clientY - wbDragStartY);
    wbApplyTransform(false);
}

function wbHandleMouseUp() {
    if (typeof wbLasso !== 'undefined' && wbLasso) { wbEndLasso(); return; }
    if (wbIsDragging) {
        wbIsDragging = false;
        if (wbSvg) wbSvg.classList.remove('wb-dragging');
        wbScheduleSaveViewport();
    }
}

function wbHandleTouchStart(e) {
    // A touch that starts on a note (header, body, resize handle, ...) or
    // any other in-canvas element is never a canvas pan/pinch gesture --
    // whiteboard-notes.js's own touch handlers own it instead (issue #848;
    // see wbNoteHeaderTouchStart()/wbNoteResizeTouchStart() there, and the
    // matching target check in wbHandleMouseDown() just below for the
    // mouse equivalent this mirrors).
    if (e.target && e.target !== wbSvg && e.target !== wbGroup &&
        !(e.target.closest && e.target.closest('.wb-grid'))) {
        return;
    }
    if (e.touches.length === 1) {
        // One finger pans on a touchscreen, where there is no trackpad
        // swipe to fall back on; two fingers pan and pinch.
        wbIsDragging = true;
        wbDragStartX = e.touches[0].clientX;
        wbDragStartY = e.touches[0].clientY;
        wbDragStartPanX = wbPanX;
        wbDragStartPanY = wbPanY;
    } else if (e.touches.length === 2) {
        wbIsDragging = false;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        wbTouchStartDist = Math.sqrt(dx * dx + dy * dy);
        wbTouchStartZoom = wbZoom;
        if (wbSvg) {
            const rect = wbSvg.getBoundingClientRect();
            wbTouchMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
            wbTouchMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
        }
    }
}

function wbHandleTouchMove(e) {
    e.preventDefault();
    if (e.touches.length === 1 && wbIsDragging) {
        wbPanX = wbDragStartPanX + (e.touches[0].clientX - wbDragStartX);
        wbPanY = wbDragStartPanY + (e.touches[0].clientY - wbDragStartY);
        wbApplyTransform(false);
    } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (wbTouchStartDist > 0) {
            // Two fingers pan as well as pinch: the midpoint's travel since
            // the last move drags the board with it, so a two-finger swipe
            // on a touchscreen moves the canvas the way it does on a
            // trackpad.
            const rect = wbSvg ? wbSvg.getBoundingClientRect() : { left: 0, top: 0 };
            const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
            const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
            wbPanX += midX - wbTouchMidX;
            wbPanY += midY - wbTouchMidY;
            wbTouchMidX = midX;
            wbTouchMidY = midY;
            const newZoom = wbClampZoom(wbTouchStartZoom * (dist / wbTouchStartDist));
            const next = wbAnchoredZoomPan(wbPanX, wbPanY, wbZoom, newZoom, wbTouchMidX, wbTouchMidY);
            wbZoom = newZoom;
            wbPanX = next.panX;
            wbPanY = next.panY;
            wbApplyTransform(false);
            wbUpdateZoomLabel();
            wbUpdateZoomButtons();
        }
    }
}

function wbHandleTouchEnd(e) {
    if (e.touches && e.touches.length === 0) {
        wbIsDragging = false;
        wbTouchStartDist = 0;
        wbScheduleSaveViewport();
    } else if (!e.touches || e.touches.length < 2) {
        wbTouchStartDist = 0;
    }
}

/**
 * Double-clicking bare canvas drops a new post-it there -- the fastest
 * path from "I have a thought" to "it is in the plan", and the reason the
 * board can now author structure rather than only display it. Ignored on
 * anything that isn't empty canvas, so double-clicking a note's title
 * still means "rename".
 */
function wbHandleCanvasDoubleClick(e) {
    if (!(e.target === wbSvg || e.target === wbGroup ||
          (e.target.closest && e.target.closest('.wb-grid')))) return;
    if (typeof wbCreateNoteAtClientPoint !== 'function') return;
    e.preventDefault();
    wbCreateNoteAtClientPoint(e.clientX, e.clientY);
}

/**
 * Right-click: a note opens its own `...` menu at the pointer, bare canvas
 * opens the canvas menu (both in whiteboard-notes.js). Anything else -- a
 * group boundary, a text object, a noodle, the side panels -- keeps the
 * browser's menu, and so does any field being typed in, where cut, copy and
 * paste are what a right-click is for.
 *
 * The keyboard's context-menu key (or Shift+F10) arrives here too, with no
 * pointer position: on the canvas it opens the selected note's menu under
 * its button, or the canvas menu mid-screen when nothing is selected.
 */
function wbHandleContextMenu(e) {
    const target = e.target;
    if (!target || target.isContentEditable ||
        /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName || '')) {
        return;
    }
    if (typeof wbOpenNoteMenu !== 'function') return;
    const fromKeyboard = e.clientX === 0 && e.clientY === 0;
    const container = document.getElementById('whiteboardContainer');

    const note = target.closest && target.closest('foreignObject.wb-note');
    if (note && note.dataset.wbTask) {
        e.preventDefault();
        if (fromKeyboard) {
            wbOpenNoteMenuFromKeyboard(note.dataset.wbTask);
        } else {
            wbOpenNoteMenuAt(note.dataset.wbTask, e.clientX, e.clientY);
        }
        return;
    }

    if (fromKeyboard && target === container) {
        e.preventDefault();
        const selected = wbGetSelectedNoteTask();
        if (selected && wbNoteNodes.has(selected)) {
            wbOpenNoteMenuFromKeyboard(selected);
        } else {
            const centre = wbCanvasCenter();
            const rect = wbSvg.getBoundingClientRect();
            wbOpenCanvasMenu(rect.left + centre.x, rect.top + centre.y);
        }
        return;
    }

    if (target === wbSvg || target === wbGroup ||
        (target.closest && target.closest('.wb-grid'))) {
        e.preventDefault();
        wbOpenCanvasMenu(e.clientX, e.clientY);
    }
}

// ── Keyboard ─────────────────────────────────────────────────────────────

function wbEndSpacePan() {
    if (!wbSpacePan) return;
    wbSpacePan = false;
    const container = (typeof document !== 'undefined') ? document.getElementById('whiteboardContainer') : null;
    if (container) container.classList.remove('wb-space-pan');
}

function wbHandleKeyup(e) {
    if (e.key === ' ') wbEndSpacePan();
}

function wbHandleKeydown(e) {
    // Never steal keys from a field the user is typing in -- the outline
    // panel's search box and a note's inline title editor both live inside
    // this container, so "f" must type an f rather than fitting the board.
    const target = e.target;
    if (target && (target.isContentEditable ||
                   /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName || ''))) {
        return;
    }

    // Noodle editing keys, before the pan/zoom set: a selected noodle owns
    // Delete/Backspace and Escape while it is selected.
    if (e.key === 'Delete' || e.key === 'Backspace') {
        if (typeof wbCutSelectedNoodle === 'function' && wbCutSelectedNoodle()) { e.preventDefault(); return; }
        if (typeof wbCutSelectedDependencyNoodle === 'function' && wbCutSelectedDependencyNoodle()) { e.preventDefault(); return; }
    }
    if (e.key === 'Escape') {
        if (typeof wbClearGroupSelection === 'function') wbClearGroupSelection();
        if (typeof wbClearNoodleSelection === 'function') wbClearNoodleSelection();
        if (typeof wbClearDepNoodleSelection === 'function') wbClearDepNoodleSelection();
        if (typeof wbClearTextSelection === 'function') wbClearTextSelection();
    }
    if ((e.key === 'n' || e.key === 'N') && typeof wbCreateNoteInViewportCentre === 'function') {
        e.preventDefault();
        wbCreateNoteInViewportCentre();
        return;
    }
    // Ctrl/Cmd+G groups the selected notes, Obsidian's shortcut for it.
    if ((e.key === 'g' || e.key === 'G') && (e.ctrlKey || e.metaKey) && !e.altKey) {
        e.preventDefault();
        if (typeof wbGroupSelectionFromRibbon === 'function') wbGroupSelectionFromRibbon();
        return;
    }
    // Hold Space to pan with a plain drag instead of lassoing.
    if (e.key === ' ' && !/^(BUTTON|A)$/.test(target && target.tagName || '')) {
        e.preventDefault();
        if (!wbSpacePan) {
            wbSpacePan = true;
            const container = document.getElementById('whiteboardContainer');
            if (container) container.classList.add('wb-space-pan');
        }
        return;
    }
    // Issue #1018: a free-floating text object -- the "no task, no card"
    // sibling of `n`'s post-it, same viewport-centre placement.
    if ((e.key === 't' || e.key === 'T') && typeof wbCreateTextObjectInViewportCentre === 'function') {
        e.preventDefault();
        wbCreateTextObjectInViewportCentre();
        return;
    }

    switch (e.key) {
        case 'ArrowUp':
            e.preventDefault();
            wbPanY += WB_KEY_PAN_STEP;
            wbApplyTransform(false);
            wbScheduleSaveViewport();
            break;
        case 'ArrowDown':
            e.preventDefault();
            wbPanY -= WB_KEY_PAN_STEP;
            wbApplyTransform(false);
            wbScheduleSaveViewport();
            break;
        case 'ArrowLeft':
            e.preventDefault();
            wbPanX += WB_KEY_PAN_STEP;
            wbApplyTransform(false);
            wbScheduleSaveViewport();
            break;
        case 'ArrowRight':
            e.preventDefault();
            wbPanX -= WB_KEY_PAN_STEP;
            wbApplyTransform(false);
            wbScheduleSaveViewport();
            break;
        case '+':
        case '=':
            e.preventDefault();
            whiteboardZoomIn();
            break;
        case '-':
        case '_':
            e.preventDefault();
            whiteboardZoomOut();
            break;
        case '0':
            e.preventDefault();
            whiteboardZoomReset();
            break;
        case 'f':
        case 'F':
            e.preventDefault();
            whiteboardZoomFit();
            break;
    }
}

// ── Initialization ────────────────────────────────────────────────────

/**
 * Build (once) or re-activate the whiteboard canvas. Safe to call every
 * time the view is switched to — it only creates the SVG/grid on first
 * call, and simply re-applies the current transform on later calls so an
 * in-session view switch is free.
 */
function initWhiteboard() {
    const container = document.getElementById('whiteboardContainer');
    if (!container) return;

    const firstInit = !container.querySelector('svg.wb-svg');

    if (firstInit) {
        wbSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        wbSvg.classList.add('wb-svg');
        wbSvg.setAttribute('width', '100%');
        wbSvg.setAttribute('height', '100%');
        wbSvg.setAttribute('aria-hidden', 'true');

        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        const pattern = document.createElementNS('http://www.w3.org/2000/svg', 'pattern');
        pattern.setAttribute('id', 'wb-dot-pattern');
        pattern.setAttribute('width', String(WB_GRID_SIZE));
        pattern.setAttribute('height', String(WB_GRID_SIZE));
        pattern.setAttribute('patternUnits', 'userSpaceOnUse');
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('cx', String(WB_GRID_SIZE / 2));
        dot.setAttribute('cy', String(WB_GRID_SIZE / 2));
        dot.setAttribute('r', '1.3');
        dot.setAttribute('class', 'wb-grid-dot');
        pattern.appendChild(dot);
        defs.appendChild(pattern);
        wbSvg.appendChild(defs);

        wbGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        wbGroup.classList.add('wb-layer');
        wbSvg.appendChild(wbGroup);

        // One big dot-filled rect standing in for an "infinite" grid. Since
        // it lives inside wb-layer, the ancestor transform scales the
        // pattern tiling along with everything else — no per-zoom redraw.
        const grid = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        grid.setAttribute('class', 'wb-grid');
        grid.setAttribute('x', '-20000');
        grid.setAttribute('y', '-20000');
        grid.setAttribute('width', '40000');
        grid.setAttribute('height', '40000');
        grid.setAttribute('fill', 'url(#wb-dot-pattern)');
        wbGroup.appendChild(grid);

        // Notes and text objects: untransformed, between the board and the
        // overlay -- see wbPlaceBoardObject().
        const notesLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        notesLayer.setAttribute('class', 'wb-notes-layer');
        wbSvg.appendChild(notesLayer);

        wbOverlayGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        wbOverlayGroup.classList.add('wb-overlay-layer');
        wbSvg.appendChild(wbOverlayGroup);

        container.appendChild(wbSvg);

        wbSvg.addEventListener('wheel', wbHandleWheel, { passive: false });
        wbSvg.addEventListener('mousedown', wbHandleMouseDown);
        wbSvg.addEventListener('dblclick', wbHandleCanvasDoubleClick);
        window.addEventListener('mousemove', wbHandleMouseMove);
        window.addEventListener('mouseup', wbHandleMouseUp);

        wbSvg.addEventListener('touchstart', wbHandleTouchStart, { passive: false });
        wbSvg.addEventListener('touchmove', wbHandleTouchMove, { passive: false });
        wbSvg.addEventListener('touchend', wbHandleTouchEnd);
        wbSvg.addEventListener('touchcancel', wbHandleTouchEnd);
    } else {
        wbSvg = container.querySelector('svg.wb-svg');
        wbGroup = wbSvg.querySelector('.wb-layer');
        wbOverlayGroup = wbSvg.querySelector('.wb-overlay-layer');
    }

    // Render notes (issue #846) before any fit-to-content below runs, so
    // a first-ever open computes its bounding box against the real notes
    // rather than an empty board. wbRenderNotes() draws the noodles and
    // refreshes the floating outline panel as part of the same pass, so
    // all three stay in step by construction.
    if (typeof wbRenderNotes === 'function') wbRenderNotes();
    if (typeof wbUpdateOutlineToolbarButton === 'function') wbUpdateOutlineToolbarButton();

    container.setAttribute('tabindex', '0');
    if (!container.dataset.wbKeydownBound) {
        container.addEventListener('keydown', wbHandleKeydown);
        container.addEventListener('keyup', wbHandleKeyup);
        // Focus leaving the board mid-hold would otherwise strand Space "down".
        container.addEventListener('blur', wbEndSpacePan);
        container.addEventListener('contextmenu', wbHandleContextMenu);
        container.dataset.wbKeydownBound = 'true';
    }

    if (firstInit) {
        const saved = wbLoadViewport();
        if (saved) {
            wbZoom = saved.zoom;
            wbPanX = saved.panX;
            wbPanY = saved.panY;
            wbApplyTransform(false);
            wbUpdateZoomLabel();
            wbUpdateZoomButtons();
        } else {
            // First ever open for this project — no content to fit, so
            // this is a centred 100% view (see whiteboardZoomFit() above).
            whiteboardZoomFit();
        }
    } else {
        // Re-activating: container may have been resized while hidden, but
        // pan/zoom themselves are unchanged — just refresh derived UI.
        wbApplyTransform(false);
        wbUpdateZoomLabel();
        wbUpdateZoomButtons();
    }

    // A saved or carried-over viewport can point at an empty stretch of
    // board -- notes moved, the canvas resized while hidden, a plan
    // replaced -- and the board then looks blank although it has notes.
    // Frame them instead. Skipped while the canvas has no size yet, since
    // "nothing on screen" means nothing then.
    //
    // A note created while the view was hidden goes first: centring it is
    // what the person who just made it wants to see. The fit is capped at
    // 100% so one small note is not blown up to fill the screen.
    const visible = wbVisibleCanvasRect();
    if (!visible.width || !visible.height) return;
    if (wbPendingRevealTask) whiteboardRevealNote(wbPendingRevealTask, { centre: true });
    if (!wbAnyNoteOnScreen()) whiteboardZoomFit({ maxZoom: 1 });
}
