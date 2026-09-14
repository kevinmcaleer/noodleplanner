/**
 * <np-panel-header> — the shared header bar for a slide-out panel or a
 * modal dialog (design-system.md §6/§10: "highest-frequency, not started" —
 * 39 screens).
 *
 * Reconciles `.detail-pane-header` (static/components.css, used by the Task
 * form / Product form / Task Inspector drawers) and `.modal-header`
 * (used by ~26 dialogs) into one component. The two diverged only in tone
 * and corner radius — both are flex rows of title + optional subtitle +
 * action buttons + a close button, both driven by the same `--np-space-20`
 * / `--np-space-32` padding — so that becomes the `variant` attribute:
 *   - "accent" (default): the gold gradient, square corners, on-accent
 *     text/close-button — matches today's drawer headers.
 *   - "neutral": `--np-surface-alt` background, ink text, rounded top
 *     corners — matches today's dialog headers.
 *
 * Usage:
 *   <script type="module" src="/static/components/panel-header/np-panel-header.js"></script>
 *   <np-panel-header title="Task Name" editable>
 *     <button slot="actions">🔍 Inspect</button>
 *   </np-panel-header>
 *   <np-panel-header title="Status Message Log" variant="neutral"></np-panel-header>
 *
 * Events:
 *   - `close` (bubbles, composed) — the close button was clicked.
 *   - `titlechange` (bubbles, composed, detail: { value }) — only fires
 *     when `editable` is set; the contenteditable title was edited, mirroring
 *     the `oninput` handler on today's `.detail-pane-title`.
 */

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
  <style>
    :host {
      display: block;
      font-family: var(--np-font-heading, var(--np-font-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif));
    }
    :host([hidden]) { display: none; }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: var(--np-space-12, 12px);
      padding: var(--np-space-20, 20px) var(--np-space-32, 32px);
      flex-shrink: 0;
      border-radius: 0;
      background: var(--np-accent-gradient, linear-gradient(135deg, #EDB52A 0%, #d99f1f 100%));
      color: var(--np-on-accent, #23201c);
    }

    :host([variant="neutral"]) .header {
      background: var(--np-surface-alt, #f4efe6);
      color: var(--np-ink, #23201c);
      border-radius: var(--np-radius-lg, 14px) var(--np-radius-lg, 14px) 0 0;
    }

    .titles {
      flex: 1;
      min-width: 0;
    }

    .title {
      margin: 0;
      font-size: 1.5em;
      font-weight: 500;
      color: inherit;
      padding: var(--np-space-4, 4px);
      border-radius: 4px;
      min-height: 1.2em;
      transition: background-color 0.2s;
    }
    .title[contenteditable] {
      cursor: text;
      outline: none;
    }
    .title[contenteditable]:hover { background-color: rgba(255, 255, 255, 0.1); }
    .title[contenteditable]:focus { background-color: rgba(255, 255, 255, 0.2); }
    :host([variant="neutral"]) .title[contenteditable]:hover { background-color: var(--np-sunken, rgba(0, 0, 0, 0.05)); }
    :host([variant="neutral"]) .title[contenteditable]:focus { background-color: var(--np-selected, rgba(0, 0, 0, 0.08)); }

    .subtitle {
      margin: var(--np-space-4, 4px) 0 0;
      font-size: 0.85em;
      font-weight: 400;
      color: inherit;
      opacity: 0.85;
    }
    .subtitle[hidden] { display: none; }

    .actions {
      display: flex;
      align-items: center;
      gap: var(--np-space-12, 12px);
      flex-shrink: 0;
    }
    ::slotted(*) { flex-shrink: 0; }

    .close-btn {
      background: none;
      border: none;
      color: inherit;
      font-size: 2em;
      line-height: 1;
      width: 30px;
      height: 30px;
      padding: 0;
      border-radius: 4px;
      cursor: pointer;
      transition: background-color 0.2s;
    }
    .close-btn:hover { background-color: rgba(255, 255, 255, 0.15); }
    .close-btn:focus-visible {
      outline: var(--np-focus-ring-width, 2px) solid var(--np-focus-ring-color, currentColor);
      outline-offset: var(--np-focus-ring-offset, 2px);
    }
    :host([variant="neutral"]) .close-btn:hover { background-color: var(--np-sunken, rgba(0, 0, 0, 0.06)); }

    @media (max-width: 768px) {
      .header {
        padding: var(--np-space-16, 16px) var(--np-space-20, 20px);
      }
      .title { font-size: 1.2em; }
    }
  </style>
  <div class="header" part="header">
    <div class="titles" part="titles">
      <p class="subtitle" part="subtitle" hidden></p>
    </div>
    <div class="actions" part="actions">
      <slot name="actions"></slot>
      <button class="close-btn" part="close-button" type="button" aria-label="Close">&times;</button>
    </div>
  </div>
`;

export class NpPanelHeader extends HTMLElement {
  static get observedAttributes() {
    return ['title', 'subtitle', 'variant', 'editable'];
  }

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.appendChild(TEMPLATE.content.cloneNode(true));
    this._titles = root.querySelector('.titles');
    this._subtitle = root.querySelector('.subtitle');
    this._closeBtn = root.querySelector('.close-btn');
    this._title = null;

    this._closeBtn.addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
    });
  }

  connectedCallback() {
    this._render();
  }

  attributeChangedCallback(name) {
    if (name === 'editable') {
      this._renderTitleElement();
    }
    this._render();
  }

  _renderTitleElement() {
    const editable = this.hasAttribute('editable');
    const existing = this._title;
    const tag = editable ? 'div' : 'h2';

    if (existing && existing.tagName.toLowerCase() === tag) return;

    const el = document.createElement(tag);
    el.className = 'title';
    el.setAttribute('part', 'title');
    if (editable) {
      el.setAttribute('contenteditable', 'true');
      el.addEventListener('input', () => {
        this.dispatchEvent(
          new CustomEvent('titlechange', {
            detail: { value: el.textContent || '' },
            bubbles: true,
            composed: true,
          })
        );
      });
    }
    if (existing) {
      el.textContent = existing.textContent;
      existing.replaceWith(el);
    } else {
      this._titles.insertBefore(el, this._subtitle);
    }
    this._title = el;
  }

  _render() {
    if (!this._title) this._renderTitleElement();

    const title = this.getAttribute('title') || '';
    if (this._title.textContent !== title) this._title.textContent = title;

    const subtitle = this.getAttribute('subtitle');
    this._subtitle.hidden = !subtitle;
    this._subtitle.textContent = subtitle || '';
  }
}

if (!customElements.get('np-panel-header')) {
  customElements.define('np-panel-header', NpPanelHeader);
}
