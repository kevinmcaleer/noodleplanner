/**
 * <np-toolbar> -- one row of commands for the view that is open (the table
 * views interface's toolbar, table-shell.js).
 *
 * The ribbon shows every command of a tab at once, in groups three rows
 * deep. This is the same idea at one row: the commands that act on the open
 * view as labelled buttons, in their groups, and a few standing menus
 * (Reports, Export, Import) at the far end. When the buttons do not fit, the
 * strip scrolls sideways and fades at the edge that has more.
 *
 * Like the other shell components it is data, not markup:
 *
 *   toolbar.groups = [
 *     { id: 'schedule', label: 'Schedule', items: [
 *         { id: 'link', label: 'Link', icon: 'link' },
 *         { id: 'critical', label: 'Critical Path', icon: 'target', active: true },
 *         { id: 'preset', label: 'Highlight Preset', icon: 'pin', caret: true } ] },
 *     { id: 'reports', label: 'Reports', icon: 'project-report', menu: true, items: [
 *         { id: 'report:analysis', label: 'Analysis', icon: 'chart' }, … ] },
 *   ];
 *
 * A group is a run of buttons, or with `menu: true` a single button, named
 * for the group and pinned to the end of the row, that opens the group's
 * items as a menu. A menu group with no items of its own raises `select`
 * with its own id instead, for a menu whose choices the host only knows when
 * asked (`openMenu(group.id, choices)`). An item can be `active` (a pressed toggle), `disabled`,
 * or carry `caret: true` to say it opens choices of its own -- the host
 * answers its `select` by calling `openMenu(id, choices)`.
 *
 * Attributes:
 *   label   the toolbar's accessible name ("Commands" by default)
 *   touch   give every button the 44px touch target
 *
 * Events (bubbling, composed):
 *   `select` { id }   a button or a menu item was chosen
 *
 * Methods:
 *   openMenu(id, items)   open `items` ([{ id, label, icon?, active? }]) as
 *                         a menu under the button `id`
 *   closeMenu()
 *
 * The menu closes on Escape (focus returns to its button), on a choice, on a
 * click anywhere else, and when the window scrolls or resizes. Up, Down, Home
 * and End move within it.
 */

import { escapeHtml, spriteIcon, upgradeProperty } from '../overlay/overlay-kit.js';

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
  <style>
    :host {
      display: flex;
      align-items: center;
      box-sizing: border-box;
      min-width: 0;
      gap: var(--np-space-8, 8px);
      padding: var(--np-space-4, 4px) var(--np-space-12, 12px);
      font-family: var(--np-font-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      font-size: var(--np-text-85, 0.85em);
      color: var(--np-body, #5c5850);
      background: var(--np-surface-alt, #f3eee5);
      border-bottom: 1px solid var(--np-border, #e3ddd3);
    }
    :host([hidden]) { display: none; }

    .strip {
      flex: 1 1 auto;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: var(--np-space-4, 4px);
      overflow-x: auto;
      scrollbar-width: none;
      -webkit-overflow-scrolling: touch;
      /* Room for the focus ring, which overflow would clip. */
      padding: var(--np-space-2, 2px);
    }
    .strip::-webkit-scrollbar { display: none; }
    :host([data-more-start]) .strip {
      -webkit-mask-image: linear-gradient(to right, transparent, #000 32px);
      mask-image: linear-gradient(to right, transparent, #000 32px);
    }
    :host([data-more-end]) .strip {
      -webkit-mask-image: linear-gradient(to left, transparent, #000 32px);
      mask-image: linear-gradient(to left, transparent, #000 32px);
    }
    :host([data-more-start][data-more-end]) .strip {
      -webkit-mask-image: linear-gradient(to right, transparent, #000 32px, #000 calc(100% - 32px), transparent);
      mask-image: linear-gradient(to right, transparent, #000 32px, #000 calc(100% - 32px), transparent);
    }

    .end {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      gap: var(--np-space-4, 4px);
    }
    .end:empty { display: none; }

    .group {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      gap: var(--np-space-2, 2px);
    }
    .group + .group {
      margin-left: var(--np-space-4, 4px);
      padding-left: var(--np-space-8, 8px);
      border-left: 1px solid var(--np-border, #e3ddd3);
    }

    button {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      gap: var(--np-space-4, 4px);
      min-height: 32px;
      padding: 0 var(--np-space-8, 8px);
      font: inherit;
      font-weight: var(--np-weight-medium, 500);
      color: inherit;
      white-space: nowrap;
      background: transparent;
      border: 1px solid transparent;
      border-radius: var(--np-radius-control, 8px);
      cursor: pointer;
    }
    :host([touch]) button { min-height: var(--np-touch-target, 44px); min-width: var(--np-touch-target, 44px); }
    button:hover:not(:disabled) { color: var(--np-ink, #23201c); background: var(--np-sunken, #efe9de); }
    button:focus-visible { outline: none; box-shadow: var(--np-focus-ring); }
    button:disabled { opacity: 0.5; cursor: default; }
    button[aria-pressed="true"],
    button[aria-expanded="true"] {
      color: var(--np-accent-ink, #8a6205);
      background: var(--np-accent-tint, #fbefce);
      border-color: var(--np-accent, #edb52a);
    }
    button .icon { flex: 0 0 auto; }
    .caret {
      width: 0;
      height: 0;
      margin-left: var(--np-space-2, 2px);
      border-left: 4px solid transparent;
      border-right: 4px solid transparent;
      border-top: 5px solid currentColor;
    }

    .menu {
      position: fixed;
      z-index: 1090;
      box-sizing: border-box;
      min-width: 200px;
      max-width: min(320px, calc(100vw - 16px));
      max-height: min(70vh, 480px);
      overflow-y: auto;
      margin: 0;
      padding: var(--np-space-4, 4px);
      list-style: none;
      font-size: var(--np-text-110, 1.1em);
      color: var(--np-ink, #23201c);
      background: var(--np-surface, #fffdf9);
      border: 1px solid var(--np-border, #e3ddd3);
      border-radius: var(--np-radius-card, 12px);
      box-shadow: var(--np-elevation-3, none);
    }
    .menu[hidden] { display: none; }
    .menu button {
      display: flex;
      width: 100%;
      gap: var(--np-space-8, 8px);
      min-height: 36px;
      padding: 0 var(--np-space-12, 12px);
      font-weight: var(--np-weight-regular, 400);
      text-align: left;
    }
    :host([touch]) .menu button { min-height: var(--np-touch-target, 44px); }
    .menu button[aria-checked="true"] { font-weight: var(--np-weight-semibold, 600); color: var(--np-accent-ink, #8a6205); }
  </style>
  <div class="strip" part="strip" role="toolbar" aria-label="Commands"></div>
  <div class="end" part="end"></div>
  <ul class="menu" part="menu" role="menu" hidden></ul>
`;

export class NpToolbar extends HTMLElement {
  static get observedAttributes() {
    return ['label'];
  }

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.appendChild(TEMPLATE.content.cloneNode(true));
    this._strip = root.querySelector('.strip');
    this._end = root.querySelector('.end');
    this._menu = root.querySelector('.menu');
    this._groups = [];
    this._menuFor = null;

    const onButton = (event) => {
      const button = event.target.closest('button[data-id], button[data-menu]');
      if (!button || button.disabled) return;
      if (button.dataset.menu) {
        if (this._menuFor === button) this.closeMenu();
        else this._openFor(button, this._groupItems(button.dataset.menu));
        return;
      }
      this.closeMenu({ restoreFocus: false });
      this._emit(button.dataset.id);
    };
    this._strip.addEventListener('click', onButton);
    this._end.addEventListener('click', onButton);
    this._menu.addEventListener('click', (event) => {
      const item = event.target.closest('button[data-id]');
      if (!item) return;
      this.closeMenu();
      this._emit(item.dataset.id);
    });
    this._menu.addEventListener('keydown', (event) => this._onMenuKey(event));
    this._strip.addEventListener('scroll', () => this._markOverflow(), { passive: true });
    this._strip.addEventListener('wheel', (event) => {
      if (this._strip.scrollWidth <= this._strip.clientWidth) return;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      this._strip.scrollLeft += event.deltaY;
    }, { passive: false });
    this._resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this._markOverflow()) : null;

    this._onOutside = (event) => {
      if (!this._menuFor) return;
      if (event.composedPath().includes(this._menu) || event.composedPath().includes(this._menuFor)) return;
      this.closeMenu({ restoreFocus: false });
    };
    this._onMove = (event) => {
      // The menu's own scrolling is not the page moving under it.
      if (event && event.type === 'scroll' && event.composedPath && event.composedPath().includes(this._menu)) return;
      this.closeMenu({ restoreFocus: false });
    };
  }

  connectedCallback() {
    upgradeProperty(this, 'groups');
    if (this._resize) this._resize.observe(this._strip);
    document.addEventListener('pointerdown', this._onOutside, true);
    window.addEventListener('resize', this._onMove);
    window.addEventListener('scroll', this._onMove, true);
    this._render();
  }

  disconnectedCallback() {
    if (this._resize) this._resize.disconnect();
    document.removeEventListener('pointerdown', this._onOutside, true);
    window.removeEventListener('resize', this._onMove);
    window.removeEventListener('scroll', this._onMove, true);
  }

  attributeChangedCallback() {
    this._strip.setAttribute('aria-label', this.getAttribute('label') || 'Commands');
  }

  get groups() { return this._groups; }
  set groups(value) {
    this._groups = Array.isArray(value) ? value : [];
    this._render();
  }

  /** Open `items` as a menu under the button with this id. */
  openMenu(id, items) {
    const button = [...this.shadowRoot.querySelectorAll('button[data-id]')]
      .find((el) => el.dataset.id === id && !el.closest('.menu'));
    if (button) this._openFor(button, items || []);
  }

  closeMenu({ restoreFocus = true } = {}) {
    const opener = this._menuFor;
    if (!opener) return;
    const hadFocus = this.shadowRoot.activeElement && this._menu.contains(this.shadowRoot.activeElement);
    this._menu.hidden = true;
    this._menu.replaceChildren();
    opener.setAttribute('aria-expanded', 'false');
    this._menuFor = null;
    if (restoreFocus && hadFocus) opener.focus();
  }

  get menuOpen() { return !!this._menuFor; }

  _emit(id) {
    this.dispatchEvent(new CustomEvent('select', { detail: { id }, bubbles: true, composed: true }));
  }

  _groupItems(groupId) {
    const group = this._groups.find((g) => g.id === groupId);
    return group ? group.items || [] : [];
  }

  _openFor(button, items) {
    this.closeMenu({ restoreFocus: false });
    if (!items.length) return;
    this._menu.innerHTML = items.map((item) => `
      <li role="none"><button type="button" role="${typeof item.active === 'boolean' ? 'menuitemradio' : 'menuitem'}"
          data-id="${escapeHtml(item.id)}"${typeof item.active === 'boolean' ? ` aria-checked="${item.active}"` : ''}
          ${item.disabled ? 'disabled' : ''}>
        ${spriteIcon(item.icon, 16)}<span>${escapeHtml(item.label)}</span>
      </button></li>`).join('');
    this._menu.hidden = false;
    this._menuFor = button;
    button.setAttribute('aria-expanded', 'true');

    // Under the button, kept inside the window.
    const anchor = button.getBoundingClientRect();
    const menu = this._menu.getBoundingClientRect();
    const margin = 8;
    const left = Math.max(margin, Math.min(anchor.left, window.innerWidth - menu.width - margin));
    const below = anchor.bottom + 4;
    const top = below + menu.height > window.innerHeight - margin
      ? Math.max(margin, anchor.top - menu.height - 4)
      : below;
    this._menu.style.left = `${Math.round(left)}px`;
    this._menu.style.top = `${Math.round(top)}px`;

    const first = this._menu.querySelector('button:not(:disabled)');
    if (first) first.focus();
  }

  _onMenuKey(event) {
    const items = [...this._menu.querySelectorAll('button:not(:disabled)')];
    const at = items.indexOf(this.shadowRoot.activeElement);
    const go = (index) => { event.preventDefault(); items[(index + items.length) % items.length].focus(); };
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this._focusOpenerAndClose(); }
    else if (event.key === 'Tab') this.closeMenu({ restoreFocus: false });
    else if (!items.length) return;
    else if (event.key === 'ArrowDown') go(at + 1);
    else if (event.key === 'ArrowUp') go(at - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(items.length - 1);
  }

  _focusOpenerAndClose() {
    const opener = this._menuFor;
    this.closeMenu({ restoreFocus: false });
    if (opener) opener.focus();
  }

  _button(item) {
    const pressed = typeof item.active === 'boolean' ? ` aria-pressed="${item.active}"` : '';
    const popup = item.caret ? ' aria-haspopup="menu" aria-expanded="false"' : '';
    return `<button type="button" data-id="${escapeHtml(item.id)}"${pressed}${popup}
        ${item.help ? `title="${escapeHtml(item.help)}"` : ''}${item.disabled ? ' disabled' : ''}>
      ${spriteIcon(item.icon, 16)}<span>${escapeHtml(item.label)}</span>${item.caret ? '<span class="caret" aria-hidden="true"></span>' : ''}
    </button>`;
  }

  _render() {
    this.closeMenu({ restoreFocus: false });
    const inline = this._groups.filter((group) => !group.menu && (group.items || []).length);
    const menus = this._groups.filter((group) => group.menu);
    this._strip.innerHTML = inline.map((group) => `
      <div class="group" role="group" aria-label="${escapeHtml(group.label || '')}">
        ${group.items.map((item) => this._button(item)).join('')}
      </div>`).join('');
    this._end.innerHTML = menus.map((group) => `
      <button type="button" ${(group.items || []).length ? 'data-menu' : 'data-id'}="${escapeHtml(group.id)}" aria-haspopup="menu" aria-expanded="false"
          ${group.help ? `title="${escapeHtml(group.help)}"` : ''}>
        ${spriteIcon(group.icon, 16)}<span>${escapeHtml(group.label)}</span><span class="caret" aria-hidden="true"></span>
      </button>`).join('');
    this._markOverflow();
  }

  /** Which sides have buttons scrolled out of sight, for the edge fades. */
  _markOverflow() {
    const max = this._strip.scrollWidth - this._strip.clientWidth;
    this.toggleAttribute('data-more-start', this._strip.scrollLeft > 1);
    this.toggleAttribute('data-more-end', this._strip.scrollLeft < max - 1);
  }
}

if (!customElements.get('np-toolbar')) {
  customElements.define('np-toolbar', NpToolbar);
}
