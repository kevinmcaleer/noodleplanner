/**
 * <np-nav-drawer> -- the phone's slide-out navigation (#1380, epic #1376).
 *
 * Everything the ribbon and the status bar reached on a desktop, in one list
 * that slides in from the left: the Project / Programme / Portfolio switch,
 * every view grouped as Plan, Tracking and Resources, the portfolio's views,
 * and the File, Settings, Help and history entries. It follows the app's
 * existing slide-out pattern (overlay, translateX, `.open`) that #detailPane
 * and #aiChatPanel use.
 *
 * The drawer is data, not markup: the app hands it `sections` built from the
 * router (view-catalogue.js), so a new view cannot go missing from it.
 *
 *   drawer.heading = 'Noodle Planner';
 *   drawer.footer = 'App v1.2.3';
 *   drawer.sections = [
 *     { id: 'scope', label: 'Scope', kind: 'segmented', items: [
 *         { id: 'scope:project', label: 'Project', current: true }, … ] },
 *     { id: 'plan', label: 'Plan', items: [
 *         { id: 'view:tasks', label: 'Tasks', icon: 'task-list', current: true },
 *         { id: 'view:gantt', label: 'Gantt', icon: 'gantt-chart',
 *           note: 'Best on a larger screen' }, … ] },
 *   ];
 *   drawer.open(document.querySelector('np-app-bar').menuButton);
 *
 * While open it traps focus, and it closes on Escape, a tap on the backdrop
 * or a swipe to the left, handing focus back to whatever opened it.
 *
 * Events (bubbling, composed):
 *   `select` { id }   an item was chosen; the drawer then closes itself
 *   `open`, `close`
 */

import { escapeHtml, onSwipe, spriteIcon, trapFocus, upgradeProperty } from '../overlay/overlay-kit.js';

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
  <style>
    :host {
      position: fixed;
      inset: 0;
      z-index: 1080;
      pointer-events: none;
      font-family: var(--np-font-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      color: var(--np-ink, #23201c);
      visibility: hidden;
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
      top: 0;
      bottom: 0;
      left: 0;
      width: min(320px, 85vw);
      display: flex;
      flex-direction: column;
      background: var(--np-surface, #fffdf9);
      box-shadow: var(--np-elevation-4, none);
      transform: translateX(-100%);
      transition: transform var(--np-anim-duration, 0.2s) var(--np-anim-easing, ease);
      padding-top: env(safe-area-inset-top, 0px);
      padding-bottom: env(safe-area-inset-bottom, 0px);
      padding-left: env(safe-area-inset-left, 0px);
      box-sizing: border-box;
      touch-action: pan-y;
    }
    :host(:not([open])) .panel { box-shadow: none; }
    :host([open]) .panel { transform: translateX(0); }

    header {
      display: flex;
      align-items: center;
      gap: var(--np-space-8, 8px);
      min-height: 56px;
      padding: 0 var(--np-space-4, 4px) 0 var(--np-space-16, 16px);
      border-bottom: 1px solid var(--np-border, #e3ddd3);
    }
    h2 {
      flex: 1;
      margin: 0;
      font-family: var(--np-font-heading, serif);
      font-size: 1.2em;
      font-weight: var(--np-weight-medium, 500);
    }

    .scroll {
      flex: 1;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: var(--np-space-8, 8px) 0 var(--np-space-16, 16px);
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
    ul { list-style: none; margin: 0; padding: 0 var(--np-space-8, 8px) var(--np-space-8, 8px); }

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
      border-radius: var(--np-radius-control, 8px);
      font-size: 1.5em;
      line-height: 1;
    }
    .close:hover { background: var(--np-sunken, #efe9de); }

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
    .item[aria-current="page"] {
      background: var(--np-accent-tint, #fbefce);
      color: var(--np-accent-ink, #8a6205);
      font-weight: var(--np-weight-semibold, 600);
    }
    .item .icon { flex: 0 0 auto; }
    .label { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .note {
      font-size: var(--np-text-80, 0.8em);
      font-weight: var(--np-weight-regular, 400);
      color: var(--np-muted, #635e55);
    }
    .item[aria-current="page"] .note { color: inherit; }
    .badge {
      flex: 0 0 auto;
      min-width: 20px;
      padding: 0 var(--np-space-4, 4px);
      border-radius: var(--np-radius-pill, 999px);
      background: var(--np-danger-tint, #f6e3e0);
      color: var(--np-danger-ink, #8c3a2c);
      font-size: var(--np-text-75, 0.75em);
      text-align: center;
    }

    .segmented {
      display: flex;
      gap: var(--np-space-4, 4px);
      margin: 0 var(--np-space-12, 12px) var(--np-space-8, 8px);
      padding: var(--np-space-4, 4px);
      background: var(--np-surface-alt, #f3eee5);
      border-radius: var(--np-radius-control, 8px);
    }
    .segmented button {
      flex: 1;
      min-height: var(--np-touch-target, 44px);
      border-radius: var(--np-radius-md, 6px);
      font-size: var(--np-text-90, 0.9em);
      color: var(--np-body, #5c5850);
    }
    .segmented button[aria-pressed="true"] {
      background: var(--np-surface, #fffdf9);
      color: var(--np-ink, #23201c);
      font-weight: var(--np-weight-semibold, 600);
      box-shadow: var(--np-elevation-1, none);
    }

    footer {
      padding: var(--np-space-12, 12px) var(--np-space-16, 16px);
      border-top: 1px solid var(--np-border, #e3ddd3);
      font-size: var(--np-text-80, 0.8em);
      color: var(--np-muted, #635e55);
    }
    footer:empty { display: none; }

    @media (prefers-reduced-motion: reduce) {
      .panel, .backdrop, :host { transition: none; }
    }
  </style>
  <div class="backdrop" part="backdrop"></div>
  <nav class="panel" part="panel" role="dialog" aria-modal="true" aria-labelledby="heading">
    <header>
      <h2 id="heading"></h2>
      <button class="close" type="button" aria-label="Close navigation">&times;</button>
    </header>
    <div class="scroll" part="body"></div>
    <footer part="footer"></footer>
  </nav>
`;

export class NpNavDrawer extends HTMLElement {
  static get observedAttributes() {
    return ['open'];
  }

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.appendChild(TEMPLATE.content.cloneNode(true));
    this._panel = root.querySelector('.panel');
    this._body = root.querySelector('.scroll');
    this._headingEl = root.querySelector('h2');
    this._footerEl = root.querySelector('footer');
    this._sections = [];
    this._heading = 'Noodle Planner';
    this._footer = '';
    this._opener = null;
    this._releaseTrap = null;

    root.querySelector('.backdrop').addEventListener('click', () => this.close());
    root.querySelector('.close').addEventListener('click', () => this.close());
    onSwipe(this._panel, 'left', () => this.close());
    this._body.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-id]');
      if (!button) return;
      const id = button.dataset.id;
      this.dispatchEvent(new CustomEvent('select', { detail: { id }, bubbles: true, composed: true }));
      this.close({ restoreFocus: false });
    });
  }

  connectedCallback() {
    for (const name of ['sections', 'heading', 'footer']) upgradeProperty(this, name);
    if (!this.hasAttribute('open')) this.setAttribute('aria-hidden', 'true');
    this._render();
  }

  get sections() { return this._sections; }
  set sections(value) {
    this._sections = Array.isArray(value) ? value : [];
    this._render();
  }

  get heading() { return this._heading; }
  set heading(value) {
    this._heading = String(value || '');
    this._headingEl.textContent = this._heading;
  }

  get footer() { return this._footer; }
  set footer(value) {
    this._footer = String(value || '');
    this._footerEl.textContent = this._footer;
  }

  get isOpen() { return this.hasAttribute('open'); }

  open(opener = null) {
    if (this.isOpen) return;
    this._opener = opener;
    this.setAttribute('open', '');
    this.removeAttribute('aria-hidden');
    this._releaseTrap = trapFocus(this, () => this.close());
    // Focus the current view, else the first item, once the panel is in.
    const target = this._body.querySelector('[aria-current="page"], [aria-pressed="true"]') ||
      this._body.querySelector('button');
    requestAnimationFrame(() => (target || this.shadowRoot.querySelector('.close')).focus());
    this.dispatchEvent(new CustomEvent('open', { bubbles: true, composed: true }));
  }

  close({ restoreFocus = true } = {}) {
    if (!this.isOpen) return;
    this.removeAttribute('open');
    this.setAttribute('aria-hidden', 'true');
    if (this._releaseTrap) this._releaseTrap();
    this._releaseTrap = null;
    const opener = this._opener;
    this._opener = null;
    if (restoreFocus && opener && typeof opener.focus === 'function') opener.focus();
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  _render() {
    this._headingEl.textContent = this._heading;
    this._footerEl.textContent = this._footer;
    this._body.innerHTML = this._sections.map((section) => {
      const heading = section.label ? `<h3 id="s-${escapeHtml(section.id)}">${escapeHtml(section.label)}</h3>` : '';
      const labelledBy = section.label ? ` aria-labelledby="s-${escapeHtml(section.id)}"` : '';
      if (section.kind === 'segmented') {
        const buttons = (section.items || []).map((item) =>
          `<button type="button" data-id="${escapeHtml(item.id)}" aria-pressed="${item.current ? 'true' : 'false'}">${escapeHtml(item.label)}</button>`
        ).join('');
        return `<section data-section="${escapeHtml(section.id)}">${heading}<div class="segmented" role="group"${labelledBy}>${buttons}</div></section>`;
      }
      const items = (section.items || []).map((item) => {
        const note = item.note ? `<span class="note">${escapeHtml(item.note)}</span>` : '';
        const badge = item.badge ? `<span class="badge" aria-label="${escapeHtml(item.badgeLabel || item.badge)}">${escapeHtml(item.badge)}</span>` : '';
        const current = item.current ? ' aria-current="page"' : '';
        return `<li><button type="button" class="item" data-id="${escapeHtml(item.id)}"${current}>
          ${spriteIcon(item.icon, 20)}<span class="label">${escapeHtml(item.label)}${note}</span>${badge}
        </button></li>`;
      }).join('');
      return `<section data-section="${escapeHtml(section.id)}">${heading}<ul${labelledBy}>${items}</ul></section>`;
    }).join('');
  }
}

if (!customElements.get('np-nav-drawer')) {
  customElements.define('np-nav-drawer', NpNavDrawer);
}
