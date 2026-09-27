/**
 * <np-fab> -- a floating "+" for the current view's main create action
 * (#1382, epic #1376).
 *
 * On a phone there is no ribbon Home -> New Task, no toolbar "+ Add Item"
 * within easy reach of a thumb, and no right-click. The floating button sits
 * bottom-right, clear of the home indicator, and does one thing: the view's
 * own create action -- a task in Tasks or Outline, a card on the Board, an
 * item in the RAID log. The app sets which (CREATE_FOR_VIEW in ribbon-ia.js)
 * and hides it on views with none.
 *
 * Usage:
 *   <script type="module" src="/static/components/fab/np-fab.js"></script>
 *   <np-fab label="New task"></np-fab>
 *
 * Attributes: `label`, the accessible name (and tooltip) of what it creates.
 * Events: a plain `click` on the host.
 *
 * 56px, the size a primary floating action takes on both phone platforms,
 * so it is also comfortably over the 44px touch minimum.
 */

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
  <style>
    :host {
      position: fixed;
      right: calc(var(--np-space-16, 16px) + env(safe-area-inset-right, 0px));
      bottom: calc(var(--np-space-16, 16px) + env(safe-area-inset-bottom, 0px));
      z-index: 1030;
    }
    :host([hidden]) { display: none; }

    button {
      display: grid;
      place-items: center;
      width: 56px;
      height: 56px;
      padding: 0;
      border: 0;
      border-radius: var(--np-radius-circle, 50%);
      background: var(--np-accent, #edb52a);
      color: var(--np-on-accent, #23201c);
      box-shadow: var(--np-elevation-3, none);
      cursor: pointer;
    }
    button:hover { background: var(--np-accent-hover, #d9a31c); }
    button:focus-visible { outline: none; box-shadow: var(--np-focus-ring), var(--np-elevation-3, none); }
  </style>
  <button type="button" part="button">
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/>
    </svg>
  </button>
`;

export class NpFab extends HTMLElement {
  static get observedAttributes() {
    return ['label'];
  }

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open', delegatesFocus: true });
    root.appendChild(TEMPLATE.content.cloneNode(true));
    this._button = root.querySelector('button');
  }

  connectedCallback() { this._render(); }
  attributeChangedCallback() { this._render(); }

  _render() {
    const label = this.getAttribute('label') || 'Add';
    this._button.setAttribute('aria-label', label);
    this._button.title = label;
  }
}

if (!customElements.get('np-fab')) {
  customElements.define('np-fab', NpFab);
}
