/**
 * <np-notice> -- a short, dismissible note with one action (#1387, epic
 * #1376).
 *
 * On a phone some views are a canvas or a wide chart by nature -- the Gantt,
 * the timeline, the mind map. They stay reachable, and this says so without
 * getting in the way: "Gantt is best on a larger screen. [Open Tasks] [×]",
 * pointing at the nearest phone-first view (view-catalogue.js's `nearest`).
 * The page places it; it takes no room from the view it sits over.
 *
 * Usage:
 *   <script type="module" src="/static/components/notice/np-notice.js"></script>
 *   <np-notice action="Open Tasks">Gantt is best on a larger screen.</np-notice>
 *
 * Attributes: `action`, the action button's label (no button without it);
 * `dismiss-label`, the close button's accessible name ("Dismiss").
 * Events (bubbling, composed): `action`, and `dismiss` when closed -- the
 * notice hides itself; the page remembers the choice if it wants to.
 */

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
  <style>
    :host {
      display: flex;
      align-items: center;
      gap: var(--np-space-8, 8px);
      padding: var(--np-space-4, 4px) var(--np-space-4, 4px) var(--np-space-4, 4px) var(--np-space-16, 16px);
      border: 1px solid var(--np-border, #e3ddd3);
      border-radius: var(--np-radius-card, 12px);
      background: var(--np-surface, #fffdf9);
      color: var(--np-ink, #23201c);
      box-shadow: var(--np-elevation-3, none);
      font-family: var(--np-font-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      font-size: var(--np-text-90, 0.9em);
    }
    :host([hidden]) { display: none; }
    .message { flex: 1 1 auto; min-width: 0; }
    button {
      flex: 0 0 auto;
      min-height: var(--np-touch-target, 44px);
      min-width: var(--np-touch-target, 44px);
      border: 0;
      border-radius: var(--np-radius-control, 8px);
      font: inherit;
      cursor: pointer;
    }
    .action {
      padding: 0 var(--np-space-12, 12px);
      background: var(--np-accent, #edb52a);
      color: var(--np-on-accent, #23201c);
      font-weight: var(--np-weight-semibold, 600);
    }
    .action[hidden] { display: none; }
    .close {
      display: grid;
      place-items: center;
      padding: 0;
      background: transparent;
      color: var(--np-muted, #6b665d);
      font-size: 1.4em;
      line-height: 1;
    }
    .close:hover { background: var(--np-sunken, #efe9de); color: var(--np-ink, #23201c); }
    button:focus-visible { outline: none; box-shadow: var(--np-focus-ring); }
  </style>
  <span class="message" part="message" role="status"><slot></slot></span>
  <button type="button" class="action" part="action" hidden></button>
  <button type="button" class="close" part="close" aria-label="Dismiss">&times;</button>
`;

export class NpNotice extends HTMLElement {
  static get observedAttributes() {
    return ['action', 'dismiss-label'];
  }

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.appendChild(TEMPLATE.content.cloneNode(true));
    this._action = root.querySelector('.action');
    this._close = root.querySelector('.close');
    this._action.addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('action', { bubbles: true, composed: true }));
    });
    this._close.addEventListener('click', () => {
      this.hidden = true;
      this.dispatchEvent(new CustomEvent('dismiss', { bubbles: true, composed: true }));
    });
  }

  connectedCallback() { this._render(); }
  attributeChangedCallback() { this._render(); }

  _render() {
    const action = this.getAttribute('action');
    this._action.hidden = !action;
    this._action.textContent = action || '';
    this._close.setAttribute('aria-label', this.getAttribute('dismiss-label') || 'Dismiss');
  }
}

if (!customElements.get('np-notice')) {
  customElements.define('np-notice', NpNotice);
}
