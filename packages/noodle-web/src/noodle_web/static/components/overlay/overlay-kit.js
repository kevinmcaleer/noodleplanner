/**
 * overlay-kit.js -- what the phone's overlays share (#1380, #1382, #1383).
 *
 * <np-nav-drawer>, <np-action-sheet> and <np-detail-sheet> are all a panel
 * that slides over the page with a backdrop behind it, and each has to trap
 * focus while it is open, close on Escape, a backdrop tap or a swipe, and put
 * focus back where it came from. This is that behaviour once, rather than
 * three copies that drift -- the fate of the five hand-rolled long-presses
 * #1386 consolidates.
 *
 * Plain functions, no element of its own, so each component keeps its own
 * markup and styling.
 */

const FOCUSABLE = [
    'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
    '[contenteditable="true"]',
].join(', ');

const DELEGATING = new Set(['NP-BUTTON', 'NP-CLOSE-BUTTON', 'NP-CHECKBOX']);

function visible(el) {
    return !!(el.getClientRects && el.getClientRects().length) &&
        getComputedStyle(el).visibility !== 'hidden';
}

/**
 * Every focusable element inside `root`, in tab order, looking through open
 * shadow roots and into slotted content -- a component's own controls live
 * in its shadow root while its slotted content is light DOM.
 */
export function focusables(root) {
    const out = [];
    const walk = (node) => {
        // A host's light children render through its shadow root's slots,
        // so a shadowed host is walked through the shadow root only.
        const children = node instanceof HTMLSlotElement
            ? node.assignedElements({ flatten: true })
            : [...(node.shadowRoot ? node.shadowRoot.children : node.children)];
        for (const child of children) {
            // The design system's buttons delegate focus to the <button> in
            // their shadow root: the host is the focus stop.
            if (DELEGATING.has(child.tagName)) {
                if (!child.hasAttribute('disabled') && visible(child)) out.push(child);
                continue;
            }
            if (child.matches && child.matches(FOCUSABLE) && visible(child)) out.push(child);
            walk(child);
        }
    };
    walk(root);
    return out;
}

/** The element that has focus, looking inside shadow roots. */
export function deepActiveElement() {
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    return el;
}

/**
 * Keep Tab and Shift+Tab inside `container` (an element or shadow root's
 * host). Returns a function that removes the trap.
 */
export function trapFocus(container, onEscape) {
    const onKey = (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            if (onEscape) onEscape();
            return;
        }
        if (event.key !== 'Tab') return;
        const items = focusables(container);
        if (!items.length) {
            event.preventDefault();
            return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        const active = deepActiveElement();
        const inside = items.some((el) => el === active || el.contains(active) ||
            (el.shadowRoot && el.shadowRoot.contains(active)));
        if (event.shiftKey && (active === first || first.contains(active) || !inside)) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && (active === last || last.contains(active) || !inside)) {
            event.preventDefault();
            first.focus();
        }
    };
    // Capture on document, so Escape reaches the open overlay before the
    // app's own document-level Escape handler closes something else.
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
}

/**
 * Call `onSwipe` when a touch or pen drags `el` far enough in `direction`
 * ('left' | 'right' | 'down'). Mouse drags are ignored: a mouse has the
 * backdrop and Escape. Returns a function that removes the listeners.
 */
export function onSwipe(el, direction, onSwipeDone, { distance = 56 } = {}) {
    let start = null;
    const down = (event) => {
        if (event.pointerType === 'mouse' || !event.isPrimary) return;
        start = { id: event.pointerId, x: event.clientX, y: event.clientY };
    };
    const up = (event) => {
        if (!start || event.pointerId !== start.id) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        start = null;
        const along = direction === 'down' ? dy : direction === 'left' ? -dx : dx;
        const across = direction === 'down' ? Math.abs(dx) : Math.abs(dy);
        if (along >= distance && along > across * 1.5) onSwipeDone();
    };
    const cancel = () => { start = null; };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    return () => {
        el.removeEventListener('pointerdown', down);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', cancel);
    };
}

/**
 * An icon from the app's SVG sprite (templates/_icon_sprite.html), inlined.
 *
 * `<use href="#icon-x">` resolves against the tree it is in, and a shadow
 * root cannot see the document's sprite, so a component copies the symbol's
 * artwork in. Returns '' when the sprite (or that icon) is not on the page.
 */
export function spriteIcon(name, size = 20) {
    if (!name || typeof document === 'undefined') return '';
    const symbol = document.getElementById(`icon-${name}`);
    if (!symbol) return '';
    const box = symbol.getAttribute('viewBox') || '0 0 24 24';
    // The sprite's artwork is strokes styled by layout.css's svg.icon rule,
    // which a shadow root does not see: the same styling, as attributes.
    return `<svg class="icon" width="${size}" height="${size}" viewBox="${box}" aria-hidden="true" focusable="false"
        fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${symbol.innerHTML}</svg>`;
}

export function escapeHtml(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
}

/**
 * The element property upgrade dance: a property set on an element before
 * its class was defined (a classic script configuring a component that
 * loads as a module) is an own property shadowing the class's setter. Take
 * it off and set it again, so the setter runs.
 */
export function upgradeProperty(el, name) {
    if (Object.prototype.hasOwnProperty.call(el, name)) {
        const value = el[name];
        delete el[name];
        el[name] = value;
    }
}
