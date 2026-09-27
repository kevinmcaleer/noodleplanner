/**
 * <np-app-bar> -- the phone's top bar (#1380, epic #1376).
 *
 * On a phone the ribbon took 347px of an 844px screen, and with the status
 * bar 56% of the screen was chrome before the view got a pixel. This bar is
 * what replaces both: 56px, holding
 *
 *   ☰         opens the navigation drawer            -> `menu` event
 *   title ▾   the plan's name; opens the switcher    -> `title` event
 *   status    a slot beside the title (the plan's RAG dot)
 *   actions   a slot at the end (search, the bell, ⋯ for commands)
 *
 * The component draws the bar and raises events; it never navigates or opens
 * anything itself, so it renders in Storybook with no app behind it.
 *
 * Usage:
 *   <script type="module" src="/static/components/app-bar/np-app-bar.js"></script>
 *   <np-app-bar heading="Website Redesign" subheading="Tasks">
 *     <span slot="status" class="rag-dot"></span>
 *     <np-button slot="actions" variant="neutral" icon-only label="Search">…</np-button>
 *   </np-app-bar>
 *
 * Attributes:
 *   heading        the plan's name
 *   subheading     a second, smaller line (the current view)
 *   menu-expanded  reflects the drawer's state onto ☰'s aria-expanded
 *
 * Events (bubbling, composed): `menu`, `title`.
 *
 * Every target is 44px. The bar pads itself below the notch with
 * env(safe-area-inset-top) (index.html sets viewport-fit=cover).
 */

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
  <style>
    :host {
      display: block;
      font-family: var(--np-font-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      background: var(--np-surface, #fffdf9);
      color: var(--np-ink, #23201c);
      border-bottom: 1px solid var(--np-border, #e3ddd3);
    }
    :host([hidden]) { display: none; }

    /* Clear of the notch and the rounded corners: the bar's own padding,
       not :host's -- the page's rules outrank :host, and base.css resets
       every element's padding. The 56px is the bar below the inset. */
    .bar {
      display: flex;
      align-items: center;
      gap: var(--np-space-4, 4px);
      height: 56px;
      padding: env(safe-area-inset-top, 0px) calc(var(--np-space-4, 4px) + env(safe-area-inset-right, 0px))
        0 calc(var(--np-space-4, 4px) + env(safe-area-inset-left, 0px));
      box-sizing: content-box;
    }

    button {
      font: inherit;
      color: inherit;
      background: none;
      border: 0;
      cursor: pointer;
      border-radius: var(--np-radius-control, 8px);
    }
    button:hover { background: var(--np-sunken, #efe9de); }
    button:focus-visible { outline: none; box-shadow: var(--np-focus-ring); }

    .menu {
      flex: 0 0 auto;
      display: grid;
      place-items: center;
      width: var(--np-touch-target, 44px);
      height: var(--np-touch-target, 44px);
      padding: 0;
    }

    .title {
      flex: 1 1 auto;
      min-width: 0;
      min-height: var(--np-touch-target, 44px);
      display: flex;
      align-items: center;
      gap: var(--np-space-8, 8px);
      padding: 0 var(--np-space-8, 8px);
      text-align: left;
    }
    .titles {
      min-width: 0;
      display: flex;
      flex-direction: column;
      line-height: var(--np-leading-tight, 1.2);
    }
    .heading {
      font-family: var(--np-font-heading, serif);
      font-size: 1.1em;
      font-weight: var(--np-weight-medium, 500);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .subheading {
      font-size: var(--np-text-80, 0.8em);
      color: var(--np-muted, #635e55);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .subheading:empty { display: none; }
    .caret { flex: 0 0 auto; color: var(--np-muted, #635e55); }

    ::slotted([slot="status"]) { flex: 0 0 auto; }

    .actions {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      gap: var(--np-space-2, 2px);
    }
  </style>
  <div class="bar" part="bar">
    <button class="menu" part="menu" type="button" aria-label="Open navigation" aria-expanded="false" aria-haspopup="dialog">
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>
      </svg>
    </button>
    <button class="title" part="title" type="button" aria-haspopup="dialog">
      <span class="titles">
        <span class="heading" part="heading"></span>
        <span class="subheading" part="subheading"></span>
      </span>
      <slot name="status"></slot>
      <svg class="caret" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
        <path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
    <div class="actions" part="actions"><slot name="actions"></slot></div>
  </div>
`;

export class NpAppBar extends HTMLElement {
  static get observedAttributes() {
    return ['heading', 'subheading', 'menu-expanded'];
  }

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.appendChild(TEMPLATE.content.cloneNode(true));
    this._menu = root.querySelector('.menu');
    this._title = root.querySelector('.title');
    this._heading = root.querySelector('.heading');
    this._subheading = root.querySelector('.subheading');

    this._menu.addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('menu', { bubbles: true, composed: true }));
    });
    this._title.addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('title', { bubbles: true, composed: true }));
    });
  }

  connectedCallback() { this._render(); }
  attributeChangedCallback() { this._render(); }

  /** The ☰ button, so a drawer can hand focus back to it on close. */
  get menuButton() { return this._menu; }

  /** The title button, so the switcher can hand focus back to it. */
  get titleButton() { return this._title; }

  _render() {
    const heading = this.getAttribute('heading') || 'Untitled plan';
    const subheading = this.getAttribute('subheading') || '';
    this._heading.textContent = heading;
    this._subheading.textContent = subheading;
    this._title.setAttribute('aria-label', subheading
      ? `${heading}, ${subheading}. Switch plan`
      : `${heading}. Switch plan`);
    this._menu.setAttribute('aria-expanded', this.getAttribute('menu-expanded') === 'true' ? 'true' : 'false');
  }
}

if (!customElements.get('np-app-bar')) {
  customElements.define('np-app-bar', NpAppBar);
}
