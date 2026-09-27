/**
 * touch-gestures.js -- long-press, swipe and drag for a finger (#1385, #1386,
 * epic #1376).
 *
 * The app grew a long-press five times -- the spreadsheet's cells, the
 * editor's line numbers, the Gantt's mini pie, a whiteboard note's header and
 * its checklist rows -- each with its own delay (350, 500, 550ms), its own
 * idea of how far a finger may wander before it is not a press, and its own
 * pair of touch *and* mouse listeners. This is the one they share, on
 * pointer events, alongside the two other gestures a phone needs: a swipe
 * across a row, and a drag from a handle.
 *
 * Each ignores a mouse by default (a mouse has hover, right-click and HTML5
 * drag-and-drop already) and returns a function that removes its listeners.
 *
 *   NoodleTouch.onLongPress(el, (point) => …, { delay, tolerance, selector })
 *   NoodleTouch.onSwipe(el, { left, right, move, end }, { distance, selector })
 *   NoodleTouch.dragByPointer(handle, { start, move, drop, cancel })
 *
 * `selector` delegates: the gesture starts on a descendant of `el` matching it,
 * and the callbacks get that element as `point.target`. `ignore` is a
 * selector a gesture never starts on (a control inside the row with a
 * gesture of its own).
 *
 * A classic script exposing `NoodleTouch`, and importable as a module for its
 * side effect (np-note.js does), so it is written to run either way and to
 * define itself once.
 */
(function (root) {
    'use strict';
    if (root.NoodleTouch) return;

    const LONG_PRESS_MS = 500;
    const TOLERANCE_PX = 8;
    const SWIPE_PX = 64;

    function accepts(event, pointerTypes) {
        return event.isPrimary !== false && pointerTypes.includes(event.pointerType || 'mouse');
    }

    function targetOf(el, event, selector, ignore) {
        if (ignore && event.target && event.target.closest && event.target.closest(ignore)) return null;
        if (!selector) return el;
        const hit = event.target && event.target.closest ? event.target.closest(selector) : null;
        return hit && el.contains(hit) ? hit : null;
    }

    /**
     * `callback({ clientX, clientY, target })` once a finger has rested for
     * `delay` ms without moving `tolerance` px. The click that follows the
     * lift is swallowed, so a long-press never also counts as a tap.
     */
    function onLongPress(el, callback, options) {
        const opts = options || {};
        const delay = opts.delay || LONG_PRESS_MS;
        const tolerance = opts.tolerance || TOLERANCE_PX;
        const pointerTypes = opts.pointerTypes || ['touch', 'pen'];
        let press = null;
        let swallowClick = false;

        const clear = () => {
            if (press) clearTimeout(press.timer);
            press = null;
        };
        const down = (event) => {
            if (!accepts(event, pointerTypes)) return;
            const target = targetOf(el, event, opts.selector, opts.ignore);
            if (!target) return;
            clear();
            const point = { clientX: event.clientX, clientY: event.clientY, target, pointerId: event.pointerId };
            press = {
                ...point,
                timer: setTimeout(() => {
                    press = null;
                    swallowClick = true;
                    callback(point);
                }, delay),
            };
        };
        const move = (event) => {
            if (!press || event.pointerId !== press.pointerId) return;
            if (Math.hypot(event.clientX - press.clientX, event.clientY - press.clientY) > tolerance) clear();
        };
        const click = (event) => {
            if (!swallowClick) return;
            swallowClick = false;
            event.preventDefault();
            // Immediate: a click listener on this same element must not see it.
            event.stopImmediatePropagation();
        };
        // The browser's own long-press menu (a link's, an image's) would open
        // over ours.
        const contextmenu = (event) => {
            if (press || swallowClick) event.preventDefault();
        };
        const up = () => {
            clear();
            // A lift with no click after it (a scroll began) must not leave
            // the next real tap swallowed.
            if (swallowClick) setTimeout(() => { swallowClick = false; }, 400);
        };

        el.addEventListener('pointerdown', down);
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', clear);
        el.addEventListener('click', click, true);
        el.addEventListener('contextmenu', contextmenu);
        return () => {
            clear();
            el.removeEventListener('pointerdown', down);
            el.removeEventListener('pointermove', move);
            el.removeEventListener('pointerup', up);
            el.removeEventListener('pointercancel', clear);
            el.removeEventListener('click', click, true);
            el.removeEventListener('contextmenu', contextmenu);
        };
    }

    /**
     * A horizontal swipe. `handlers.move({ dx, target })` follows the finger
     * once it is clearly moving sideways (so the caller can slide the row),
     * `handlers.left` / `handlers.right` fire past `distance` px, and
     * `handlers.end({ target })` always closes the gesture. A mostly vertical
     * movement is left to the page's scroll -- give the element
     * `touch-action: pan-y` so the browser does not take the sideways part too.
     */
    function onSwipe(el, handlers, options) {
        const opts = options || {};
        const distance = opts.distance || SWIPE_PX;
        const pointerTypes = opts.pointerTypes || ['touch', 'pen'];
        let swipe = null;
        let swallowClick = false;

        const down = (event) => {
            if (!accepts(event, pointerTypes)) return;
            const target = targetOf(el, event, opts.selector, opts.ignore);
            if (!target) return;
            swipe = { id: event.pointerId, x: event.clientX, y: event.clientY, target, sideways: false };
        };
        const move = (event) => {
            if (!swipe || event.pointerId !== swipe.id) return;
            const dx = event.clientX - swipe.x;
            const dy = event.clientY - swipe.y;
            if (!swipe.sideways) {
                if (Math.abs(dy) > TOLERANCE_PX && Math.abs(dy) > Math.abs(dx)) {
                    swipe = null; // a scroll
                    return;
                }
                if (Math.abs(dx) <= TOLERANCE_PX) return;
                swipe.sideways = true;
            }
            if (handlers.move) handlers.move({ dx, target: swipe.target });
        };
        const finish = (event, cancelled) => {
            if (!swipe || (event && event.pointerId !== swipe.id)) return;
            const { target, sideways, x } = swipe;
            const dx = event ? event.clientX - x : 0;
            swipe = null;
            if (!sideways) return;
            swallowClick = true;
            setTimeout(() => { swallowClick = false; }, 400);
            if (handlers.end) handlers.end({ target, dx });
            if (cancelled) return;
            if (dx >= distance && handlers.right) handlers.right({ target, dx });
            else if (dx <= -distance && handlers.left) handlers.left({ target, dx });
        };
        const up = (event) => finish(event, false);
        const cancel = (event) => finish(event, true);
        const click = (event) => {
            if (!swallowClick) return;
            swallowClick = false;
            event.preventDefault();
            // Immediate: a click listener on this same element must not see it.
            event.stopImmediatePropagation();
        };

        el.addEventListener('pointerdown', down);
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', cancel);
        el.addEventListener('click', click, true);
        return () => {
            el.removeEventListener('pointerdown', down);
            el.removeEventListener('pointermove', move);
            el.removeEventListener('pointerup', up);
            el.removeEventListener('pointercancel', cancel);
            el.removeEventListener('click', click, true);
        };
    }

    /**
     * Drag from `handle` by pointer -- the touch counterpart of an HTML5
     * `draggable` handle, which a finger cannot start. Once the pointer has
     * moved `tolerance` px, `start(point)` then `move(point)` per movement
     * and `drop(point)` on lift; `point.over` is the element under the finger
     * (the dragged element's own pointer capture would otherwise hide it).
     * The handle wants `touch-action: none`.
     */
    function dragByPointer(handle, handlers, options) {
        const opts = options || {};
        const tolerance = opts.tolerance || TOLERANCE_PX;
        const pointerTypes = opts.pointerTypes || ['touch', 'pen'];
        let drag = null;

        const pointOf = (event) => ({
            clientX: event.clientX,
            clientY: event.clientY,
            over: document.elementFromPoint(event.clientX, event.clientY),
        });
        const down = (event) => {
            if (!accepts(event, pointerTypes)) return;
            drag = { id: event.pointerId, x: event.clientX, y: event.clientY, active: false };
            try { handle.setPointerCapture(event.pointerId); } catch (_) { /* not capturable */ }
        };
        const move = (event) => {
            if (!drag || event.pointerId !== drag.id) return;
            if (!drag.active) {
                if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) <= tolerance) return;
                drag.active = true;
                if (handlers.start) handlers.start(pointOf(event));
            }
            event.preventDefault();
            if (handlers.move) handlers.move(pointOf(event));
        };
        const up = (event) => {
            if (!drag || event.pointerId !== drag.id) return;
            const active = drag.active;
            drag = null;
            if (active && handlers.drop) handlers.drop(pointOf(event));
        };
        const cancel = (event) => {
            if (!drag || event.pointerId !== drag.id) return;
            const active = drag.active;
            drag = null;
            if (active && handlers.cancel) handlers.cancel();
        };

        handle.addEventListener('pointerdown', down);
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
        handle.addEventListener('pointercancel', cancel);
        return () => {
            handle.removeEventListener('pointerdown', down);
            handle.removeEventListener('pointermove', move);
            handle.removeEventListener('pointerup', up);
            handle.removeEventListener('pointercancel', cancel);
        };
    }

    root.NoodleTouch = { LONG_PRESS_MS, TOLERANCE_PX, SWIPE_PX, onLongPress, onSwipe, dragByPointer };
})(typeof globalThis !== 'undefined' ? globalThis : this);
