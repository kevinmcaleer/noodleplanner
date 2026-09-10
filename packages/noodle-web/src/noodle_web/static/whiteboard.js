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
    const transformStr = `translate(${wbPanX}, ${wbPanY}) scale(${wbZoom})`;
    if (animate) {
        wbGroup.style.transition = `transform ${WB_ANIM_MS}ms ease`;
        wbGroup.setAttribute('transform', transformStr);
        setTimeout(() => {
            wbGroup.style.transition = '';
        }, WB_ANIM_MS);
    } else {
        wbGroup.style.transition = '';
        wbGroup.setAttribute('transform', transformStr);
    }
    // Notes (issue #846) degrade to a title-only card below a zoom
    // threshold, independent of any plan-text change -- refresh that
    // per-note class on every pan/zoom tick.
    if (typeof wbUpdateNoteZoomTiers === 'function') wbUpdateNoteZoomTiers();
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
    const visible = wbVisibleCanvasRect();
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
    if (!panel || panel.classList.contains('hidden')) return rect;

    const p = panel.getBoundingClientRect();
    if (!p.width || !p.height) return rect;

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
function whiteboardZoomFit() {
    const notes = wbGroup ? wbGroup.querySelectorAll('.wb-note') : [];
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

    wbZoom = wbClampZoom(Math.min(visible.width / boardW, visible.height / boardH));
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

    const fo = entry.fo;
    const x = parseFloat(fo.getAttribute('x') || '0');
    const y = parseFloat(fo.getAttribute('y') || '0');
    const w = parseFloat(fo.getAttribute('width') || '0');
    const h = parseFloat(fo.getAttribute('height') || '0');

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

// ── Wheel / mouse / touch handlers ──────────────────────────────────────

function wbHandleWheel(e) {
    e.preventDefault();
    if (!wbSvg) return;
    const rect = wbSvg.getBoundingClientRect();
    const anchorX = e.clientX - rect.left;
    const anchorY = e.clientY - rect.top;

    if (e.ctrlKey || e.metaKey) {
        // Ctrl/Cmd+wheel, and trackpad pinch (reported by browsers as a
        // wheel event with ctrlKey set) — zoom anchored on the pointer.
        const factor = e.deltaY < 0 ? WB_ZOOM_WHEEL_STEP : 1 / WB_ZOOM_WHEEL_STEP;
        wbZoomAt(anchorX, anchorY, factor, false);
    } else {
        wbPanX -= e.deltaX || 0;
        wbPanY -= e.deltaY || 0;
        wbApplyTransform(false);
        wbScheduleSaveViewport();
    }
}

function wbHandleMouseDown(e) {
    if (e.button !== 0) return;
    if (e.target === wbSvg || e.target === wbGroup || (e.target.closest && e.target.closest('.wb-grid'))) {
        // A press on bare canvas dismisses any selected noodle, the same
        // way clicking away from a note closes its `...` menu -- and
        // (issue #1109) deselects any selected note too.
        if (typeof wbClearNoodleSelection === 'function') wbClearNoodleSelection();
        if (typeof wbClearDepNoodleSelection === 'function') wbClearDepNoodleSelection();
        if (typeof wbClearNoteSelection === 'function') wbClearNoteSelection();
        wbIsDragging = true;
        wbDragStartX = e.clientX;
        wbDragStartY = e.clientY;
        wbDragStartPanX = wbPanX;
        wbDragStartPanY = wbPanY;
        if (wbSvg) wbSvg.classList.add('wb-dragging');
        e.preventDefault();
    }
}

function wbHandleMouseMove(e) {
    if (!wbIsDragging) return;
    wbPanX = wbDragStartPanX + (e.clientX - wbDragStartX);
    wbPanY = wbDragStartPanY + (e.clientY - wbDragStartY);
    wbApplyTransform(false);
}

function wbHandleMouseUp() {
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

// ── Keyboard ─────────────────────────────────────────────────────────────

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
        if (typeof wbClearNoodleSelection === 'function') wbClearNoodleSelection();
        if (typeof wbClearDepNoodleSelection === 'function') wbClearDepNoodleSelection();
    }
    if ((e.key === 'n' || e.key === 'N') && typeof wbCreateNoteInViewportCentre === 'function') {
        e.preventDefault();
        wbCreateNoteInViewportCentre();
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
}
