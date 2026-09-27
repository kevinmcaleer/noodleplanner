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
 *     <button slot="overflow" data-destructive>Delete task</button>
 *   </np-panel-header>
 *   <np-panel-header title="Status Message Log" variant="neutral"></np-panel-header>
 *   <np-panel-header variant="neutral"><h2 slot="title" id="raidFormTitle">New RAID item</h2></np-panel-header>
 *
 * Slots:
 *   - `title`: an element to show as the title instead of the `title`
 *     attribute -- for a form whose script already writes its heading into an
 *     element by id (`raidFormTitle.textContent = …`).
 *   - `actions`: secondary buttons beside the title.
 *   - `overflow`: buttons that only ever appear in the ⋯ menu (Delete).
 *     `data-destructive` marks one red. A slotted button that is `hidden` or
 *     `display: none` is left out, so a form can still show and hide them.
 *
 * Narrow panes (#1378, #1383): below 560px of its own width the header keeps
 * the title's row for the title, and the `actions` join the ⋯ menu -- at 390px
 * the task form's title used to share its row with Inspect and Make
 * Deliverable and got about 45px, breaking "Design" into "Desig / n". A title
 * is clamped to two lines while it is not being edited. The close button is
 * 44px under a coarse pointer, like <np-close-button>'s, and `back` turns it
 * into ← Back, for a full-screen sheet on a phone (<np-detail-sheet>).
 *
 * Events:
 *   - `close` (bubbles, composed) — the close (or back) button was clicked.
 *   - `titlechange` (bubbles, composed, detail: { value }) — only fires
 *     when `editable` is set; the contenteditable title was edited, mirroring
 *     the `oninput` handler on today's `.detail-pane-title`.
 *
 * An editable title is a single line: Enter (or a soft keyboard's return)
 * ends the edit by blurring the title rather than inserting a line break, and
 * pasted text arrives as plain text with its line breaks collapsed to spaces.
 */

const NARROW = 560;

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
  <style>
    :host {
      display: block;
      container-type: inline-size;
      position: relative;
      font-family: var(--np-font-heading, var(--np-font-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif));
    }
    :host([hidden]) { display: none; }

    .header {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto auto;
      grid-template-areas: "titles actions more close";
      align-items: center;
      gap: var(--np-space-12, 12px);
      padding: var(--np-space-20, 20px) var(--np-space-32, 32px);
      flex-shrink: 0;
      border-radius: 0;
      background: var(--np-accent-gradient, linear-gradient(135deg, #EDB52A 0%, #d99f1f 100%));
      color: var(--np-on-accent, #23201c);
    }

    /* A full-screen sheet's ← Back leads the row, where back always is. */
    :host([back]) .header {
      grid-template-columns: auto minmax(0, 1fr) auto auto;
      grid-template-areas: "close titles actions more";
    }

    :host([variant="neutral"]) .header {
      background: var(--np-surface-alt, #f4efe6);
      color: var(--np-ink, #23201c);
      border-radius: var(--np-radius-lg, 14px) var(--np-radius-lg, 14px) 0 0;
    }

    .titles {
      grid-area: titles;
      min-width: 0;
    }

    .title,
    ::slotted([slot="title"]) {
      margin: 0;
      font-size: 1.5em;
      font-weight: 500;
      color: inherit;
      /* A word only breaks when it is wider than the whole row on its own. */
      overflow-wrap: break-word;
      word-break: normal;
    }
    ::slotted([slot="title"]) {
      font-family: inherit;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .title {
      padding: var(--np-space-4, 4px);
      border-radius: 4px;
      min-height: 1.2em;
      transition: background-color 0.2s;
    }
    .title:not(:focus) {
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .titles.slotted .title { display: none; }
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
      grid-area: actions;
      display: flex;
      align-items: center;
      gap: var(--np-space-12, 12px);
      min-width: 0;
    }
    .actions.empty,
    :host([compact]) .actions { display: none; }
    ::slotted(*) { flex-shrink: 0; }
    .overflow-slot { display: none; }

    button.icon {
      grid-area: close;
      display: flex;
      align-items: center;
      justify-content: center;
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
    button.more {
      grid-area: more;
      font-size: 1.4em;
    }
    button.more[hidden] { display: none; }
    button.icon:hover { background-color: rgba(255, 255, 255, 0.15); }
    button.icon:focus-visible {
      outline: var(--np-focus-ring-width, 2px) solid var(--np-focus-ring-color, currentColor);
      outline-offset: var(--np-focus-ring-offset, 2px);
    }
    :host([variant="neutral"]) button.icon:hover { background-color: var(--np-sunken, rgba(0, 0, 0, 0.06)); }

    .menu {
      position: absolute;
      right: var(--np-space-16, 16px);
      top: calc(100% - var(--np-space-8, 8px));
      z-index: 10;
      min-width: 220px;
      max-width: calc(100% - 32px);
      margin: 0;
      padding: var(--np-space-4, 4px);
      list-style: none;
      background: var(--np-surface, #fffdf9);
      color: var(--np-ink, #23201c);
      border: 1px solid var(--np-border, #e3ddd3);
      border-radius: var(--np-radius-control, 8px);
      box-shadow: var(--np-elevation-3, none);
      font-family: var(--np-font-ui, sans-serif);
      font-size: 0.95rem;
    }
    .menu[hidden] { display: none; }
    .menu button {
      display: flex;
      align-items: center;
      width: 100%;
      min-height: 40px;
      padding: var(--np-space-8, 8px) var(--np-space-12, 12px);
      border: 0;
      border-radius: var(--np-radius-md, 6px);
      background: none;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .menu button:hover { background: var(--np-sunken, #efe9de); }
    .menu button:focus-visible { outline: none; box-shadow: var(--np-focus-ring); }
    .menu button.destructive { color: var(--np-danger-ink, #8c3a2c); }

    @media (pointer: coarse) {
      button.icon { min-width: 44px; min-height: 44px; }
      .menu button { min-height: 44px; }
    }

    @media (max-width: 768px) {
      .header {
        padding: var(--np-space-16, 16px) var(--np-space-20, 20px);
      }
      .title, ::slotted([slot="title"]) { font-size: 1.2em; }
    }

    @container (max-width: 559px) {
      .header {
        grid-template-columns: minmax(0, 1fr) auto auto;
        grid-template-areas: "titles more close" "actions actions actions";
        row-gap: var(--np-space-8, 8px);
        padding-inline: var(--np-space-12, 12px) var(--np-space-8, 8px);
      }
      :host([back]) .header {
        grid-template-columns: auto minmax(0, 1fr) auto;
        grid-template-areas: "close titles more" "actions actions actions";
        padding-inline: var(--np-space-4, 4px) var(--np-space-8, 8px);
      }
      .actions { flex-wrap: wrap; }
    }
  </style>
  <div class="header" part="header">
    <div class="titles" part="titles">
      <slot name="title"></slot>
      <p class="subtitle" part="subtitle" hidden></p>
    </div>
    <div class="actions" part="actions">
      <slot name="actions"></slot>
    </div>
    <div class="overflow-slot"><slot name="overflow"></slot></div>
    <button class="icon more" part="more-button" type="button" aria-label="More actions" aria-haspopup="menu" aria-expanded="false" hidden>&#8943;</button>
    <button class="icon close-btn" part="close-button" type="button" aria-label="Close">&times;</button>
  </div>
  <ul class="menu" part="menu" role="menu" hidden></ul>
`;

function isShown(el) {
  return !el.hidden && el.style.display !== 'none';
}

function labelOf(el) {
  return (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim();
}

export class NpPanelHeader extends HTMLElement {
  static get observedAttributes() {
    return ['title', 'subtitle', 'variant', 'editable', 'back'];
  }

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.appendChild(TEMPLATE.content.cloneNode(true));
    this._titles = root.querySelector('.titles');
    this._subtitle = root.querySelector('.subtitle');
    this._closeBtn = root.querySelector('.close-btn');
    this._moreBtn = root.querySelector('.more');
    this._menu = root.querySelector('.menu');
    this._actions = root.querySelector('.actions');
    this._actionsSlot = root.querySelector('slot[name="actions"]');
    this._overflowSlot = root.querySelector('slot[name="overflow"]');
    this._titleSlot = root.querySelector('slot[name="title"]');
    this._title = null;
    this._menuItems = [];

    this._closeBtn.addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
    });

    // An empty actions row would still take a grid row (and a gap) when the
    // header wraps, so it is hidden while nothing is slotted into it.
    const sync = () => {
      this._actions.classList.toggle('empty', this._actionsSlot.assignedElements().length === 0);
      this._titles.classList.toggle('slotted', this._titleSlot.assignedElements().length > 0);
      this._syncMore();
    };
    this._actionsSlot.addEventListener('slotchange', sync);
    this._overflowSlot.addEventListener('slotchange', sync);
    this._titleSlot.addEventListener('slotchange', sync);
    sync();

    // A form shows and hides its Delete (or Make Deliverable) by setting
    // style.display on the button, so watch for that as well as slotting.
    this._visibility = new MutationObserver(() => this._syncMore());

    this._moreBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      if (this._menu.hidden) this._openMenu();
      else this._closeMenu(true);
    });
    this._menu.addEventListener('click', (event) => {
      const item = event.target.closest('button[data-index]');
      if (!item) return;
      const source = this._menuItems[Number(item.dataset.index)];
      this._closeMenu(false);
      if (source) source.click();
    });
    this._menu.addEventListener('keydown', (event) => {
      const items = [...this._menu.querySelectorAll('button')];
      const index = items.indexOf(this.shadowRoot.activeElement);
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this._closeMenu(true);
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        items[(index + step + items.length) % items.length]?.focus();
      } else if (event.key === 'Tab') {
        this._closeMenu(false);
      }
    });
    this._outside = (event) => {
      if (!event.composedPath().includes(this)) this._closeMenu(false);
    };
  }

  connectedCallback() {
    this._render();
    this._observeVisibility();
    if (typeof ResizeObserver === 'function' && !this._resize) {
      this._resize = new ResizeObserver((entries) => {
        const width = entries[0].contentRect.width;
        this.toggleAttribute('compact', width > 0 && width < NARROW);
        this._syncMore();
      });
      this._resize.observe(this);
    }
  }

  disconnectedCallback() {
    if (this._resize) this._resize.disconnect();
    this._resize = null;
    this._visibility.disconnect();
    this._closeMenu(false);
  }

  attributeChangedCallback(name) {
    if (name === 'editable') {
      this._renderTitleElement();
    }
    this._render();
  }

  _observeVisibility() {
    this._visibility.disconnect();
    this._visibility.observe(this, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'hidden'] });
  }

  /** The buttons the ⋯ menu offers: the overflow slot's, and on a narrow
   * pane the actions' too. */
  _moreSources() {
    const overflow = this._overflowSlot.assignedElements().filter(isShown);
    const actions = this.hasAttribute('compact') ? this._actionsSlot.assignedElements().filter(isShown) : [];
    return [...actions, ...overflow];
  }

  _syncMore() {
    this._moreBtn.hidden = this._moreSources().length === 0;
    if (this._moreBtn.hidden) this._closeMenu(false);
  }

  _openMenu() {
    this._menuItems = this._moreSources();
    this._menu.innerHTML = '';
    this._menuItems.forEach((source, index) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'none');
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.dataset.index = String(index);
      button.textContent = labelOf(source);
      if (source.hasAttribute('data-destructive')) button.classList.add('destructive');
      li.appendChild(button);
      this._menu.appendChild(li);
    });
    this._menu.hidden = false;
    this._moreBtn.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', this._outside, true);
    this._menu.querySelector('button')?.focus();
  }

  _closeMenu(refocus) {
    if (this._menu.hidden) return;
    this._menu.hidden = true;
    this._moreBtn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', this._outside, true);
    if (refocus) this._moreBtn.focus();
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
      // A title is one line of text: Enter finishes the edit instead of
      // starting a second line, and a paste comes in as plain text on one line.
      el.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return;
        event.preventDefault();
        el.blur();
      });
      // A soft keyboard's return can arrive with no usable keydown (Android
      // reports "Unidentified"), so the line break is refused here as well.
      el.addEventListener('beforeinput', (event) => {
        if (event.inputType !== 'insertParagraph' && event.inputType !== 'insertLineBreak') return;
        event.preventDefault();
        el.blur();
      });
      // Where insertText is refused, the browser's own paste goes ahead.
      el.addEventListener('paste', (event) => {
        const text = event.clipboardData && event.clipboardData.getData('text/plain');
        if (!text) return;
        if (document.execCommand('insertText', false, text.replace(/\s+/g, ' '))) event.preventDefault();
      });
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

    const back = this.hasAttribute('back');
    this._closeBtn.innerHTML = back ? '&larr;' : '&times;';
    this._closeBtn.setAttribute('aria-label', back ? 'Back' : 'Close');
  }
}

if (!customElements.get('np-panel-header')) {
  customElements.define('np-panel-header', NpPanelHeader);
}
