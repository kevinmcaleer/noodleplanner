/**
 * <np-close-button> — the small dismiss control inside a panel, popup, or
 * header (design-system.md §6/§10: 36 screens). The doc tracks it as its
 * own component, separate from the button-hierarchy variants — "a dismiss
 * action inside a panel or modal header, not a point on a
 * primary/secondary/tertiary scale" — and notes it's almost always part
 * of a panel header, so it's built here as a small standalone sibling to
 * <np-panel-header> rather than composed into it (<np-panel-header>'s own
 * inline `.close-btn` is left as-is).
 *
 * The design doc doesn't flag this one as visually inconsistent the way
 * it flags panel header, but the codebase has real drift once you look
 * past `.close-btn` itself: `.task-peek-close-btn` (22px box, 16px glyph),
 * `.wb-add-note-close` (28px box, 18px glyph), `.estimate-popup-close` /
 * `.card-popup-close` (no box at all, bare 20px glyph), and
 * `.ai-chat-header-btn` (a raw #fff colour, not a token). One usage
 * (`portfolio-resources.js`) is a `<span onclick>`, not a real button —
 * no keyboard focus, no `aria-label`. This component fixes that: it's
 * always a real `<button>`.
 *
 * Two axes cover the drift:
 *   - `size="small"` — matches `.task-peek-close-btn`'s scale.
 *     `size="medium"` (default) — matches `.close-btn` / `.wb-add-note-close`.
 *   - `flat` — drops the hover box/background, matching
 *     `.estimate-popup-close` / `.card-popup-close`'s bare-glyph look for
 *     tight inline contexts.
 * `color: inherit` on the glyph, so it reads correctly whether it's sat
 * on a neutral popup or an accent-toned header, without a separate
 * `variant` attribute of its own.
 *
 * Usage:
 *   <script type="module" src="/static/components/close-button/np-close-button.js"></script>
 *   <np-close-button></np-close-button>
 *   <np-close-button size="small" label="Dismiss"></np-close-button>
 *   <np-close-button flat></np-close-button>
 *
 * Events:
 *   - `close` (bubbles, composed) — the button was clicked.
 */

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
  <style>
    :host {
      display: inline-block;
      font-family: var(--np-font-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
    }
    :host([hidden]) { display: none; }

    button {
      display: flex;
      align-items: center;
      justify-content: center;
      background: none;
      border: none;
      color: inherit;
      font-size: 20px;
      line-height: 1;
      width: 30px;
      height: 30px;
      padding: 0;
      border-radius: var(--np-radius-sm, 4px);
      cursor: pointer;
      transition: background-color 0.2s;
    }
    button:hover { background-color: var(--np-sunken, rgba(0, 0, 0, 0.06)); }
    button:focus-visible {
      outline: var(--np-focus-ring-width, 2px) solid var(--np-focus-ring-color, currentColor);
      outline-offset: var(--np-focus-ring-offset, 2px);
    }

    :host([size="small"]) button {
      width: 22px;
      height: 22px;
      font-size: 16px;
    }

    :host([flat]) button {
      width: auto;
      height: auto;
      border-radius: 0;
    }
    :host([flat]) button:hover { background-color: transparent; }
  </style>
  <button type="button" part="button"><slot name="icon">&times;</slot></button>
`;

export class NpCloseButton extends HTMLElement {
  static get observedAttributes() {
    return ['label'];
  }

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.appendChild(TEMPLATE.content.cloneNode(true));
    this._button = root.querySelector('button');

    this._button.addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
    });
  }

  connectedCallback() {
    this._render();
  }

  attributeChangedCallback() {
    this._render();
  }

  _render() {
    this._button.setAttribute('aria-label', this.getAttribute('label') || 'Close');
  }
}

if (!customElements.get('np-close-button')) {
  customElements.define('np-close-button', NpCloseButton);
}
