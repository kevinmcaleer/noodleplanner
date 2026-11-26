/**
 * <np-side-nav> -- the list of tables down the left of the table views
 * interface (table-shell.js).
 *
 * Where <np-nav-drawer> is the phone's navigation -- an overlay that slides
 * over the page and closes itself -- this is the same list as a permanent
 * column for a tablet or a desktop. It has two widths: the full list, and an
 * icon rail (`collapsed`) that leaves a tablet's width to the view. The
 * button at its top switches between them.
 *
 * Like the drawer it is data, not markup:
 *
 *   nav.sections = [
 *     { id: 'home', items: [
 *         { id: 'dashboard', label: 'Dashboard', icon: 'project-report' } ] },
 *     { id: 'tables', label: 'Tables', items: [
 *         { id: 'plan', label: 'Plan', icon: 'task-list', current: true }, … ] },
 *     { id: 'more', end: true, items: [
 *         { id: 'settings', label: 'Settings', icon: 'settings' } ] },
 *   ];
 *
 * A section with `end: true` sits at the bottom of the column. An item with
 * `current: true` is marked `aria-current="page"`.
 *
 * Attributes:
 *   collapsed  show the icon rail; each item keeps its name as its
 *              accessible label and tooltip
 *   touch      give every item the 44px touch target
 *   label      the navigation's accessible name ("Tables" by default)
 *
 * Events (bubbling, composed):
 *   `select` { id }          an item was chosen
 *   `toggle` { collapsed }   the collapse button was pressed; the host
 *                            decides whether to set `collapsed`
 */

import { escapeHtml, spriteIcon, upgradeProperty } from '../overlay/overlay-kit.js';

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
  <style>
    :host {
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      width: 224px;
      min-height: 0;
      font-family: var(--np-font-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      font-size: var(--np-text-90, 0.9em);
      color: var(--np-ink, #23201c);
      background: var(--np-surface-alt, #f3eee5);
      border-right: 1px solid var(--np-border, #e3ddd3);
    }
    :host([hidden]) { display: none; }
    :host([collapsed]) { width: 56px; }
    :host([collapsed][touch]) { width: 60px; }

    nav {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: var(--np-space-8, 8px);
    }

    section.end { margin-top: auto; }
    section + section {
      margin-top: var(--np-space-8, 8px);
      padding-top: var(--np-space-8, 8px);
      border-top: 1px solid var(--np-border, #e3ddd3);
    }
    section.end { border-top: 1px solid var(--np-border, #e3ddd3); padding-top: var(--np-space-8, 8px); }

    h3 {
      margin: var(--np-space-4, 4px) var(--np-space-8, 8px);
      font-size: var(--np-text-80, 0.8em);
      font-weight: var(--np-weight-semibold, 600);
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--np-muted, #635e55);
    }
    :host([collapsed]) h3 { display: none; }

    ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--np-space-2, 2px); }

    button {
      display: flex;
      align-items: center;
      gap: var(--np-space-12, 12px);
      width: 100%;
      min-height: 36px;
      padding: var(--np-space-4, 4px) var(--np-space-8, 8px);
      font: inherit;
      color: var(--np-body, #5c5850);
      text-align: left;
      background: none;
      border: 0;
      border-radius: var(--np-radius-control, 8px);
      cursor: pointer;
    }
    :host([touch]) button { min-height: var(--np-touch-target, 44px); }
    button:hover { background: var(--np-sunken, #efe9de); color: var(--np-ink, #23201c); }
    button:focus-visible { outline: none; box-shadow: var(--np-focus-ring); }
    button[aria-current="page"] {
      background: var(--np-accent-tint, #fbefce);
      color: var(--np-accent-ink, #8a6205);
      font-weight: var(--np-weight-semibold, 600);
    }
    button .icon { flex: 0 0 auto; }
    .label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    :host([collapsed]) button { justify-content: center; padding: var(--np-space-4, 4px); }
    :host([collapsed]) .label { display: none; }

    .toggle { color: var(--np-muted, #635e55); }
    :host(:not([collapsed])) .toggle { justify-content: flex-end; width: auto; margin-left: auto; }
    header { display: flex; padding: var(--np-space-8, 8px) var(--np-space-8, 8px) 0; }
  </style>
  <header><button class="toggle" type="button" part="toggle"></button></header>
  <nav part="nav" aria-label="Tables"></nav>
`;

export class NpSideNav extends HTMLElement {
  static get observedAttributes() {
    return ['collapsed', 'label'];
  }

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.appendChild(TEMPLATE.content.cloneNode(true));
    this._nav = root.querySelector('nav');
    this._toggle = root.querySelector('.toggle');
    this._sections = [];
    this._nav.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-id]');
      if (!button) return;
      this._emit('select', { id: button.dataset.id });
    });
    this._toggle.addEventListener('click', () => {
      this._emit('toggle', { collapsed: !this.hasAttribute('collapsed') });
    });
  }

  connectedCallback() {
    upgradeProperty(this, 'sections');
    this._render();
  }

  attributeChangedCallback(name) {
    if (name === 'label') this._nav.setAttribute('aria-label', this.getAttribute('label') || 'Tables');
    else this._renderToggle();
  }

  get sections() { return this._sections; }
  set sections(value) {
    this._sections = Array.isArray(value) ? value : [];
    this._render();
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  _renderToggle() {
    const collapsed = this.hasAttribute('collapsed');
    const label = collapsed ? 'Show table names' : 'Hide table names';
    this._toggle.innerHTML = spriteIcon(collapsed ? 'indent' : 'outdent', 18);
    this._toggle.setAttribute('aria-label', label);
    this._toggle.setAttribute('title', label);
    this._toggle.setAttribute('aria-expanded', String(!collapsed));
  }

  _render() {
    this._nav.innerHTML = this._sections.map((section) => {
      const heading = section.label ? `<h3>${escapeHtml(section.label)}</h3>` : '';
      const items = (section.items || []).map((item) => `
        <li><button type="button" data-id="${escapeHtml(item.id)}" title="${escapeHtml(item.label)}"
            aria-label="${escapeHtml(item.label)}"${item.current ? ' aria-current="page"' : ''}>
          ${spriteIcon(item.icon, 18)}<span class="label">${escapeHtml(item.label)}</span>
        </button></li>`).join('');
      return `<section${section.end ? ' class="end"' : ''}>${heading}<ul>${items}</ul></section>`;
    }).join('');
    this._renderToggle();
  }
}

if (!customElements.get('np-side-nav')) {
  customElements.define('np-side-nav', NpSideNav);
}
