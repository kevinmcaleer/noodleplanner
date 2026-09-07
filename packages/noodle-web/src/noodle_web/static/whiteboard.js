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
    const c = wbCanvasCenter();
    wbPanX = c.x;
    wbPanY = c.y;
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

    const svgRect = wbSvg.getBoundingClientRect();
    const padding = 80;
    const boardW = Math.max(1, maxX - minX + padding * 2);
    const boardH = Math.max(1, maxY - minY + padding * 2);
    const centreX = (minX + maxX) / 2;
    const centreY = (minY + maxY) / 2;

    wbZoom = wbClampZoom(Math.min(svgRect.width / boardW, svgRect.height / boardH));
    wbPanX = svgRect.width / 2 - centreX * wbZoom;
    wbPanY = svgRect.height / 2 - centreY * wbZoom;

    wbApplyTransform(true);
    wbUpdateZoomLabel();
    wbUpdateZoomButtons();
    wbScheduleSaveViewport();
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

// ── Keyboard ─────────────────────────────────────────────────────────────

function wbHandleKeydown(e) {
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
    // rather than an empty board.
    if (typeof wbRenderNotes === 'function') wbRenderNotes();

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
