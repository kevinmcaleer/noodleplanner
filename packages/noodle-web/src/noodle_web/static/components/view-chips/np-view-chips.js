/**
 * <np-view-chips> -- one-tap view switching under the phone's app bar (#1380).
 *
 * On a phone every view switch used to be two small taps into the ribbon's
 * Home -> Views group, which at 390px had already folded into "» More". This
 * is a horizontally scrolling strip of the views someone uses on a phone
 * (Dashboard, Tasks, Outline, Board, Calendar, RAID -- the catalogue's
 * phone-first tier, #1387), one tap each. Every other view is two taps away,
 * in the drawer.
 *
 * Usage:
 *   <script type="module" src="/static/components/view-chips/np-view-chips.js"></script>
 *   <np-view-chips active="tasks"></np-view-chips>
 *   <script>chips.views = [{ id: 'tasks', label: 'Tasks' }, …]</script>
 *
 * Property `views`: [{ id, label }]. Attribute `active`: the current view's
 * id, or none. The active chip is marked `aria-current="page"` and scrolled
 * into view when it changes.
 *
 * Events (bubbling, composed): `select` with `{ id }`.
 */

import { escapeHtml, upgradeProperty } from '../overlay/overlay-kit.js';

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
  <style>
    :host {
      display: block;
      font-family: var(--np-font-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      background: var(--np-surface, #fffdf9);
      border-bottom: 1px solid var(--np-border, #e3ddd3);
    }
    :host([hidden]) { display: none; }

    nav {
      display: flex;
      gap: var(--np-space-8, 8px);
      padding: var(--np-space-4, 4px) var(--np-space-12, 12px);
      overflow-x: auto;
      scroll-snap-type: x proximity;
      scrollbar-width: none;
      -webkit-overflow-scrolling: touch;
    }
    nav::-webkit-scrollbar { display: none; }

    button {
      flex: 0 0 auto;
      scroll-snap-align: start;
      min-height: var(--np-touch-target, 44px);
      min-width: var(--np-touch-target, 44px);
      padding: 0 var(--np-space-16, 16px);
      font: inherit;
      font-size: var(--np-text-90, 0.9em);
      font-weight: var(--np-weight-medium, 500);
      color: var(--np-body, #5c5850);
      background: var(--np-surface-alt, #f3eee5);
      border: 1px solid var(--np-border, #e3ddd3);
      border-radius: var(--np-radius-pill, 999px);
      cursor: pointer;
      white-space: nowrap;
    }
    button:hover { background: var(--np-sunken, #efe9de); }
    button:focus-visible { outline: none; box-shadow: var(--np-focus-ring); }
    button[aria-current="page"] {
      color: var(--np-on-accent, #23201c);
      background: var(--np-accent, #edb52a);
      border-color: var(--np-accent, #edb52a);
    }
  </style>
  <nav part="nav" aria-label="Views"></nav>
`;

export class NpViewChips extends HTMLElement {
  static get observedAttributes() {
    return ['active'];
  }

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.appendChild(TEMPLATE.content.cloneNode(true));
    this._nav = root.querySelector('nav');
    this._views = [];
    this._nav.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-id]');
      if (!button) return;
      this.dispatchEvent(new CustomEvent('select', {
        detail: { id: button.dataset.id },
        bubbles: true,
        composed: true,
      }));
    });
  }

  connectedCallback() {
    upgradeProperty(this, 'views');
    this._render();
  }

  attributeChangedCallback() { this._markActive(); }

  get views() { return this._views; }
  set views(value) {
    this._views = Array.isArray(value) ? value : [];
    this._render();
  }

  _render() {
    this._nav.innerHTML = this._views.map((view) =>
      `<button type="button" data-id="${escapeHtml(view.id)}">${escapeHtml(view.label)}</button>`
    ).join('');
    this._markActive();
  }

  _markActive() {
    const active = this.getAttribute('active');
    let current = null;
    for (const button of this._nav.querySelectorAll('button')) {
      const on = button.dataset.id === active;
      if (on) {
        button.setAttribute('aria-current', 'page');
        current = button;
      } else {
        button.removeAttribute('aria-current');
      }
    }
    if (current && this.isConnected) {
      // Scroll the strip, never the page: scrollIntoView() would also move
      // the document if the strip were partly off screen.
      const strip = this._nav;
      const left = current.offsetLeft - strip.clientWidth / 2 + current.offsetWidth / 2;
      strip.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
    }
  }
}

if (!customElements.get('np-view-chips')) {
  customElements.define('np-view-chips', NpViewChips);
}
