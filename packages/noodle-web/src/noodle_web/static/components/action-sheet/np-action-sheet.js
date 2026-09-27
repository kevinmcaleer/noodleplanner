/**
 * <np-action-sheet> -- a list of actions that slides up from the bottom of a
 * phone (#1382, epic #1376).
 *
 * The phone has no ribbon and no right-click, so the commands they carried
 * need somewhere a thumb can reach. This is that somewhere: the app bar's ⋯
 * opens the ribbon's commands in one (generated from ribbon-ia.js, #1382), the
 * plan title opens the project switcher in one (#1380), and a task row's ⋯ or
 * long-press opens its actions in one (#1385).
 *
 * The sheet is data:
 *
 *   sheet.heading = 'Gantt Tools';
 *   sheet.toolbar = [                       // a row of icon buttons on top
 *     { id: 'undo', label: 'Undo', icon: 'refresh', disabled: false },
 *   ];
 *   sheet.sections = [
 *     { id: 'gantt', label: 'Gantt Tools', items: [
 *         { id: 'gantt:Critical Path', label: 'Critical Path',
 *           help: 'Highlight the critical path', icon: 'flag', active: true },
 *         { id: 'gantt:Heat Map', label: 'Heat Map', disabled: true,
 *           help: 'Not available yet' },
 *         { id: 'delete', label: 'Delete task', destructive: true },
 *     ] },
 *   ];
 *   sheet.open(anchorButton);
 *
 * Every item shows its label, and its help as a second line -- on a desktop
 * that text is a hover-only `title`, which a phone never shows. `active`
 * items are pressed (aria-pressed and a tick); `disabled` ones say so and do
 * nothing. While open the sheet traps focus, and it closes on Escape, a tap on
 * the backdrop or a swipe down on its handle, handing focus back.
 *
 * Events (bubbling, composed):
 *   `select` { id }   an enabled item or toolbar button was chosen; the sheet
 *                     then closes itself unless the item has `keepOpen`
 *   `close`
 */

import { escapeHtml, onSwipe, spriteIcon, trapFocus, upgradeProperty } from '../overlay/overlay-kit.js';

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
  <style>
    :host {
      position: fixed;
      inset: 0;
      z-index: 1090;
      pointer-events: none;
      visibility: hidden;
      font-family: var(--np-font-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      color: var(--np-ink, #23201c);
      transition: visibility 0s linear var(--np-anim-duration, 0.2s);
    }
    :host([open]) {
      pointer-events: auto;
      visibility: visible;
      transition-delay: 0s;
    }

    .backdrop {
      position: absolute;
      inset: 0;
      background: var(--np-overlay, rgba(0, 0, 0, 0.6));
      opacity: 0;
      transition: opacity var(--np-anim-duration, 0.2s) var(--np-anim-easing, ease);
    }
    :host([open]) .backdrop { opacity: 1; }

    .panel {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      max-height: calc(100vh - 48px);
      max-height: calc(100dvh - 48px);
      display: flex;
      flex-direction: column;
      background: var(--np-surface, #fffdf9);
      border-radius: var(--np-radius-panel, 12px) var(--np-radius-panel, 12px) 0 0;
      box-shadow: var(--np-elevation-4, none);
      transform: translateY(100%);
      transition: transform var(--np-anim-duration, 0.2s) var(--np-anim-easing, ease);
      padding-bottom: env(safe-area-inset-bottom, 0px);
      padding-left: env(safe-area-inset-left, 0px);
      padding-right: env(safe-area-inset-right, 0px);
      box-sizing: border-box;
    }
    :host(:not([open])) .panel { box-shadow: none; }
    :host([open]) .panel { transform: translateY(0); }
    @media (min-width: 768px) {
      .panel {
        left: 50%;
        right: auto;
        width: min(560px, 100vw);
        margin-left: calc(min(560px, 100vw) / -2);
      }
    }

    .grab {
      touch-action: none;
      padding: var(--np-space-8, 8px) var(--np-space-16, 16px) 0;
    }
    .handle {
      width: 36px;
      height: 4px;
      margin: 0 auto var(--np-space-4, 4px);
      border-radius: var(--np-radius-pill, 999px);
      background: var(--np-border-strong, #ded9d0);
    }
    header {
      display: flex;
      align-items: center;
      gap: var(--np-space-8, 8px);
      min-height: var(--np-touch-target, 44px);
    }
    h2 {
      flex: 1;
      margin: 0;
      font-family: var(--np-font-heading, serif);
      font-size: 1.1em;
      font-weight: var(--np-weight-medium, 500);
    }
    h2:empty { display: none; }

    button {
      font: inherit;
      color: inherit;
      background: none;
      border: 0;
      cursor: pointer;
    }
    button:focus-visible { outline: none; box-shadow: var(--np-focus-ring); }

    .close {
      display: grid;
      place-items: center;
      width: var(--np-touch-target, 44px);
      height: var(--np-touch-target, 44px);
      margin-left: auto;
      border-radius: var(--np-radius-control, 8px);
      font-size: 1.5em;
      line-height: 1;
    }
    .close:hover { background: var(--np-sunken, #efe9de); }

    .toolbar {
      display: flex;
      gap: var(--np-space-8, 8px);
      padding: var(--np-space-4, 4px) var(--np-space-16, 16px) var(--np-space-8, 8px);
      border-bottom: 1px solid var(--np-hairline, #efe9de);
    }
    .toolbar:empty { display: none; }
    .tool {
      display: inline-flex;
      align-items: center;
      gap: var(--np-space-8, 8px);
      min-height: var(--np-touch-target, 44px);
      min-width: var(--np-touch-target, 44px);
      padding: 0 var(--np-space-12, 12px);
      border: 1px solid var(--np-border-control, #8c857a);
      border-radius: var(--np-radius-control, 8px);
      background: var(--np-surface, #fffdf9);
    }
    .tool:hover { background: var(--np-sunken, #efe9de); }
    .tool[aria-disabled="true"] { opacity: 0.5; cursor: default; }

    .scroll {
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: var(--np-space-4, 4px) 0 var(--np-space-12, 12px);
    }
    section + section { border-top: 1px solid var(--np-hairline, #efe9de); }
    h3 {
      margin: var(--np-space-12, 12px) var(--np-space-16, 16px) var(--np-space-4, 4px);
      font-size: var(--np-text-75, 0.75em);
      font-weight: var(--np-weight-semibold, 600);
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--np-muted, #635e55);
    }
    ul { list-style: none; margin: 0; padding: 0 var(--np-space-8, 8px); }

    .item {
      display: flex;
      align-items: center;
      gap: var(--np-space-12, 12px);
      width: 100%;
      min-height: var(--np-touch-target, 44px);
      padding: var(--np-space-8, 8px) var(--np-space-12, 12px);
      border-radius: var(--np-radius-control, 8px);
      text-align: left;
    }
    .item:hover { background: var(--np-sunken, #efe9de); }
    .item .icon { flex: 0 0 auto; }
    .text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .help {
      font-size: var(--np-text-80, 0.8em);
      color: var(--np-muted, #635e55);
    }
    .tick { flex: 0 0 auto; visibility: hidden; color: var(--np-accent-ink, #8a6205); }
    .item[aria-pressed="true"] .tick { visibility: visible; }
    .item[aria-pressed="true"] { font-weight: var(--np-weight-semibold, 600); }
    .item[aria-disabled="true"] { cursor: default; }
    .item[aria-disabled="true"] .label { color: var(--np-muted, #635e55); }
    .item.destructive { color: var(--np-danger-ink, #8c3a2c); }

    @media (prefers-reduced-motion: reduce) {
      .panel, .backdrop, :host { transition: none; }
    }
  </style>
  <div class="backdrop" part="backdrop"></div>
  <div class="panel" part="panel" role="dialog" aria-modal="true" aria-labelledby="heading">
    <div class="grab">
      <div class="handle" aria-hidden="true"></div>
      <header>
        <h2 id="heading"></h2>
        <button class="close" type="button" aria-label="Close">&times;</button>
      </header>
    </div>
    <div class="toolbar" part="toolbar" role="toolbar"></div>
    <div class="scroll" part="body"></div>
  </div>
`;

const TICK = '<svg class="tick" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3 8.5 6.5 12 13 4.5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export class NpActionSheet extends HTMLElement {
  static get observedAttributes() {
    return ['open'];
  }

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.appendChild(TEMPLATE.content.cloneNode(true));
    this._panel = root.querySelector('.panel');
    this._headingEl = root.querySelector('h2');
    this._toolbarEl = root.querySelector('.toolbar');
    this._body = root.querySelector('.scroll');
    this._heading = '';
    this._label = '';
    this._sections = [];
    this._toolbar = [];
    this._opener = null;
    this._releaseTrap = null;

    root.querySelector('.backdrop').addEventListener('click', () => this.close());
    root.querySelector('.close').addEventListener('click', () => this.close());
    onSwipe(root.querySelector('.grab'), 'down', () => this.close());

    const choose = (event) => {
      const button = event.target.closest('button[data-id]');
      if (!button || button.getAttribute('aria-disabled') === 'true') return;
      const id = button.dataset.id;
      const keepOpen = button.hasAttribute('data-keep-open');
      this.dispatchEvent(new CustomEvent('select', { detail: { id }, bubbles: true, composed: true }));
      if (!keepOpen) this.close();
    };
    this._body.addEventListener('click', choose);
    this._toolbarEl.addEventListener('click', choose);
  }

  connectedCallback() {
    for (const name of ['sections', 'toolbar', 'heading', 'label']) upgradeProperty(this, name);
    if (!this.hasAttribute('open')) this.setAttribute('aria-hidden', 'true');
    this._render();
  }

  get heading() { return this._heading; }
  set heading(value) {
    this._heading = String(value || '');
    this._headingEl.textContent = this._heading;
    this._syncLabel();
  }

  /** The dialog's accessible name when it has no visible heading. */
  get label() { return this._label; }
  set label(value) {
    this._label = String(value || '');
    this._syncLabel();
  }

  get sections() { return this._sections; }
  set sections(value) {
    this._sections = Array.isArray(value) ? value : [];
    this._render();
  }

  get toolbar() { return this._toolbar; }
  set toolbar(value) {
    this._toolbar = Array.isArray(value) ? value : [];
    this._render();
  }

  get isOpen() { return this.hasAttribute('open'); }

  open(opener = null) {
    if (this.isOpen) return;
    this._opener = opener;
    this.setAttribute('open', '');
    this.removeAttribute('aria-hidden');
    this._body.scrollTop = 0;
    this._releaseTrap = trapFocus(this, () => this.close());
    const first = this._toolbarEl.querySelector('button:not([aria-disabled="true"])') ||
      this._body.querySelector('button:not([aria-disabled="true"])') ||
      this.shadowRoot.querySelector('.close');
    requestAnimationFrame(() => first.focus());
  }

  close() {
    if (!this.isOpen) return;
    this.removeAttribute('open');
    this.setAttribute('aria-hidden', 'true');
    if (this._releaseTrap) this._releaseTrap();
    this._releaseTrap = null;
    const opener = this._opener;
    this._opener = null;
    if (opener && typeof opener.focus === 'function' && opener.isConnected) opener.focus();
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  _syncLabel() {
    const panel = this._panel;
    if (this._heading) {
      panel.setAttribute('aria-labelledby', 'heading');
      panel.removeAttribute('aria-label');
    } else {
      panel.removeAttribute('aria-labelledby');
      panel.setAttribute('aria-label', this._label || 'Actions');
    }
  }

  _button(item, cls) {
    const disabled = item.disabled ? ' aria-disabled="true"' : '';
    const pressed = item.active != null && cls === 'item' ? ` aria-pressed="${item.active ? 'true' : 'false'}"` : '';
    const keep = item.keepOpen ? ' data-keep-open' : '';
    const destructive = item.destructive ? ' destructive' : '';
    const title = cls === 'tool' && item.label ? ` aria-label="${escapeHtml(item.label)}"` : '';
    if (cls === 'tool') {
      return `<button type="button" class="tool" data-id="${escapeHtml(item.id)}"${disabled}${keep}${title}>
        ${spriteIcon(item.icon, 18)}<span>${escapeHtml(item.label)}</span></button>`;
    }
    const help = item.help ? `<span class="help">${escapeHtml(item.help)}</span>` : '';
    return `<button type="button" class="item${destructive}" data-id="${escapeHtml(item.id)}"${disabled}${pressed}${keep}>
      ${spriteIcon(item.icon, 20)}<span class="text"><span class="label">${escapeHtml(item.label)}</span>${help}</span>${item.active != null ? TICK : ''}
    </button>`;
  }

  _render() {
    this._headingEl.textContent = this._heading;
    this._syncLabel();
    this._toolbarEl.innerHTML = this._toolbar.map((item) => this._button(item, 'tool')).join('');
    this._body.innerHTML = this._sections.map((section) => {
      const heading = section.label ? `<h3 id="s-${escapeHtml(section.id)}">${escapeHtml(section.label)}</h3>` : '';
      const labelledBy = section.label ? ` aria-labelledby="s-${escapeHtml(section.id)}"` : '';
      const items = (section.items || []).map((item) => `<li>${this._button(item, 'item')}</li>`).join('');
      return `<section data-section="${escapeHtml(section.id || '')}">${heading}<ul${labelledBy}>${items}</ul></section>`;
    }).join('');
  }
}

if (!customElements.get('np-action-sheet')) {
  customElements.define('np-action-sheet', NpActionSheet);
}
