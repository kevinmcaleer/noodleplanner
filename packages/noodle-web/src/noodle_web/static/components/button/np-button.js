/**
 * <np-button> — pilot component module (issue: Storybook extraction).
 *
 * Consolidates the app's four independently-styled `.btn-primary` /
 * `.btn-secondary` / `.btn-danger` rules (base `components.css`, plus
 * `.tour-actions`, `.raid-toolbar` and `.levelling-buttons` overrides — see
 * docs/design/consolidation-and-handoff.md) into one definition driven by
 * the canonical `--np-*` tokens from visual-system.css. It renders inside a
 * shadow root, so custom properties are the only thing that crosses the
 * boundary — which is why it depends on tokens rather than any class name
 * from the app's global stylesheets.
 *
 * Usage:
 *   <script type="module" src="/static/components/button/np-button.js"></script>
 *   <np-button variant="primary">Save</np-button>
 *   <np-button variant="danger" disabled>Delete</np-button>
 *
 * A click on the internal <button> is a real DOM click event, composed
 * across the shadow boundary, so existing code can listen on the host
 * element exactly as it would on a plain <button>.
 */

const VARIANTS = new Set(['primary', 'secondary', 'danger', 'link']);

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
  <style>
    :host {
      display: inline-block;
      font-family: var(--np-font-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
    }
    :host([hidden]) { display: none; }
    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.4em;
      width: 100%;
      padding: 12px 24px;
      border-radius: var(--np-radius-sm, 5px);
      border: 2px solid transparent;
      font-size: 1em;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      transition: background-color 0.15s ease, color 0.15s ease,
        border-color 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease;
    }
    button:disabled {
      cursor: not-allowed;
      opacity: 0.55;
      transform: none !important;
      box-shadow: none !important;
    }
    button:focus-visible {
      outline: var(--np-focus-ring-width, 2px) solid var(--np-focus-ring-color, currentColor);
      outline-offset: var(--np-focus-ring-offset, 2px);
    }

    :host([variant='primary']) button {
      background: var(--np-accent-gradient, var(--np-accent, #EDB52A));
      color: var(--np-on-accent, #23201C);
    }
    :host([variant='primary']) button:not(:disabled):hover {
      background: var(--np-accent-hover, #D9A31C);
      transform: translateY(-1px);
    }

    :host([variant='secondary']) button {
      background: var(--np-surface, #FFFDF9);
      color: var(--np-accent-ink, var(--np-accent, #EDB52A));
      border-color: var(--np-accent, #EDB52A);
    }
    :host([variant='secondary']) button:not(:disabled):hover {
      background: var(--np-accent-tint, #FBEFCE);
    }

    :host([variant='danger']) button {
      background: var(--np-danger, #C21D1D);
      color: #fff;
    }
    :host([variant='danger']) button:not(:disabled):hover {
      background: var(--np-danger-hover, #a01717);
      transform: translateY(-1px);
    }

    :host([variant='link']) {
      width: auto;
    }
    :host([variant='link']) button {
      width: auto;
      padding: 0;
      border: none;
      background: none;
      color: var(--np-accent, #EDB52A);
      font-size: 1.1em;
    }
    :host([variant='link']) button:not(:disabled):hover {
      color: var(--np-accent-hover, #D9A31C);
      text-decoration: underline;
    }
  </style>
  <button type="button" part="button">
    <slot></slot>
  </button>
`;

export class NpButton extends HTMLElement {
  static get observedAttributes() {
    return ['variant', 'disabled', 'type'];
  }

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.appendChild(TEMPLATE.content.cloneNode(true));
    this._button = root.querySelector('button');
  }

  connectedCallback() {
    if (!VARIANTS.has(this.getAttribute('variant'))) {
      this.setAttribute('variant', 'primary');
    }
    this._syncDisabled();
    this._syncType();
  }

  attributeChangedCallback(name) {
    if (name === 'disabled') this._syncDisabled();
    if (name === 'type') this._syncType();
  }

  get variant() {
    return this.getAttribute('variant') || 'primary';
  }

  set variant(value) {
    if (VARIANTS.has(value)) this.setAttribute('variant', value);
  }

  get disabled() {
    return this.hasAttribute('disabled');
  }

  set disabled(value) {
    this.toggleAttribute('disabled', Boolean(value));
  }

  _syncDisabled() {
    this._button.disabled = this.disabled;
  }

  _syncType() {
    this._button.type = this.getAttribute('type') || 'button';
  }
}

if (!customElements.get('np-button')) {
  customElements.define('np-button', NpButton);
}
