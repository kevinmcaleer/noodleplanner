/**
 * <np-peek-switch> -- choose how a detail form is shown (#1409): as a side
 * peek, a centre peek or a full page, the way Notion opens a database page.
 *
 *   ┌──────┬──┐   ┌──────────┐   ┌──────────┐
 *   │      │██│   │  ┌────┐  │   │██████████│
 *   │      │██│   │  │████│  │   │██████████│
 *   └──────┴──┘   └──────────┘   └──────────┘
 *    side peek     centre peek     full page
 *
 * A row of three icon buttons, one of them pressed. It knows nothing about
 * the detail pane: <np-detail-sheet> puts one at the top left of every form
 * and does the switching.
 *
 * Usage:
 *   <script type="module" src="/static/components/peek-switch/np-peek-switch.js"></script>
 *   <np-peek-switch value="side"></np-peek-switch>
 *
 * Attributes:
 *   - `value`: `side` (default), `center` or `full`.
 *
 * Events:
 *   - `peekchange` (bubbles, composed, detail: { value }) -- a button other
 *     than the pressed one was chosen. `value` has already changed.
 */

export const PEEK_MODES = ['side', 'center', 'full'];

const LABELS = {
  side: 'Side peek',
  center: 'Center peek',
  full: 'Full page',
};

// 20x20 outlines, stroked in currentColor so they follow the theme.
const ICONS = {
  side: '<rect x="2.5" y="4" width="15" height="12" rx="2"/><rect x="11" y="4" width="6.5" height="12" rx="1" class="fill"/>',
  center: '<rect x="2.5" y="4" width="15" height="12" rx="2"/><rect x="6" y="6.5" width="8" height="7" rx="1" class="fill"/>',
  full: '<rect x="2.5" y="4" width="15" height="12" rx="2" class="fill"/>',
};

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
  <style>
    :host {
      display: inline-flex;
      flex-shrink: 0;
    }
    :host([hidden]) { display: none; }

    .group {
      display: inline-flex;
      gap: var(--np-space-2, 2px);
      padding: var(--np-space-2, 2px);
      border-radius: var(--np-radius-sm, 4px);
    }

    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      padding: 0;
      border: none;
      border-radius: var(--np-radius-sm, 4px);
      background: none;
      color: var(--np-ink-muted, #6b645a);
      cursor: pointer;
      transition: background-color var(--np-anim-duration-fast, 0.15s) var(--np-anim-easing, ease);
    }
    button:hover {
      background: var(--np-sunken, #efe9de);
      color: var(--np-ink, #23201c);
    }
    button[aria-pressed="true"] {
      background: var(--np-selected, #e8e1d4);
      color: var(--np-ink, #23201c);
    }
    button:focus-visible {
      outline: var(--np-focus-ring-width, 2px) solid var(--np-focus-ring-color, currentColor);
      outline-offset: var(--np-focus-ring-offset, 2px);
    }

    svg {
      width: 20px;
      height: 20px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.5;
    }
    svg .fill { fill: currentColor; stroke: none; }

    @media (pointer: coarse) {
      button { min-width: 44px; min-height: 44px; }
    }
  </style>
  <div class="group" role="group" aria-label="Open as" part="group">
    ${PEEK_MODES.map((mode) => `
      <button type="button" data-peek="${mode}" aria-pressed="false"
              aria-label="${LABELS[mode]}" title="${LABELS[mode]}">
        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">${ICONS[mode]}</svg>
      </button>`).join('')}
  </div>
`;

export function normalisePeek(value) {
  const mode = String(value || '').trim().toLowerCase().replace(/[\s_-]*peek$/, '');
  if (mode === 'centre') return 'center';
  if (mode === 'full-page' || mode === 'fullpage' || mode === 'page') return 'full';
  return PEEK_MODES.includes(mode) ? mode : null;
}

export class NpPeekSwitch extends HTMLElement {
  static get observedAttributes() {
    return ['value'];
  }

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.appendChild(TEMPLATE.content.cloneNode(true));
    this._buttons = [...root.querySelectorAll('button')];
    for (const button of this._buttons) {
      button.addEventListener('click', () => {
        const mode = button.dataset.peek;
        if (mode === this.value) return;
        this.value = mode;
        this.dispatchEvent(new CustomEvent('peekchange', {
          bubbles: true, composed: true, detail: { value: mode },
        }));
      });
    }
  }

  connectedCallback() {
    this._render();
  }

  attributeChangedCallback() {
    this._render();
  }

  get value() {
    return normalisePeek(this.getAttribute('value')) || 'side';
  }

  set value(mode) {
    this.setAttribute('value', normalisePeek(mode) || 'side');
  }

  _render() {
    const current = this.value;
    for (const button of this._buttons) {
      button.setAttribute('aria-pressed', String(button.dataset.peek === current));
    }
  }
}

if (!customElements.get('np-peek-switch')) {
  customElements.define('np-peek-switch', NpPeekSwitch);
}
