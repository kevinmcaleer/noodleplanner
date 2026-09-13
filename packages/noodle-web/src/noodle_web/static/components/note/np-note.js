/**
 * <np-note> — whiteboard post-it note component (issue #1193: Storybook
 * extraction for the whiteboard view).
 *
 * Consolidates the app's `.wb-note-card` markup (see
 * static/views/whiteboard.css and static/whiteboard-notes.js) into one
 * definition driven by the canonical `--np-*` tokens from
 * visual-system.css. Renders inside a shadow root, so only custom
 * properties cross the boundary — the same convention as the `np-button`
 * pilot.
 *
 * A note's colour fills the entire card — header, body and footer alike —
 * as one uniform block; the text colour is derived from that colour with a
 * real WCAG contrast check (see `_contrastTextColour` below, mirroring
 * `wbContrastTextColour()` in whiteboard-notes.js) so the note stays
 * legible on every palette colour.
 *
 * Usage:
 *   <script type="module" src="/static/components/note/np-note.js"></script>
 *   <np-note title="Launch checklist" colour="#EDB52A" progress="2/5"
 *            avatars="AB,CD"></np-note>
 *   <script>
 *     document.querySelector('np-note').rows = [
 *       { name: 'Draft copy', done: true },
 *       { name: 'Review with legal', done: false },
 *     ];
 *   </script>
 *
 * `rows` is a JS property (an array of `{ name, done }` objects); it can
 * also be set as a `rows="[...]"` JSON attribute for static/story usage.
 */

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
  <style>
    :host {
      display: block;
      width: 220px;
      font-family: var(--np-font-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      --note-accent: var(--np-border, #e0e0e0);
      --note-text: var(--np-text, #333333);
    }
    :host([hidden]) { display: none; }

    .card {
      display: flex;
      flex-direction: column;
      background: var(--note-accent);
      color: var(--note-text);
      border: 1px solid var(--note-accent);
      border-radius: 8px;
      box-shadow: 0 2px 6px var(--np-shadow, rgba(0, 0, 0, 0.1));
      overflow: hidden;
      box-sizing: border-box;
    }
    .card:active {
      box-shadow: 0 6px 16px var(--np-shadow-strong, rgba(0, 0, 0, 0.22));
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      padding: 8px 10px;
      border-bottom: 1px solid var(--np-border, #e0e0e0);
      cursor: grab;
    }

    .title {
      margin: 0;
      font-size: 13px;
      font-weight: 700;
      line-height: 1.3;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
      flex: 1;
    }

    .menu-btn {
      flex-shrink: 0;
      width: 22px;
      height: 22px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: inherit;
      cursor: pointer;
      font-size: 14px;
      line-height: 1;
      opacity: 0.7;
      font-family: inherit;
    }
    .menu-btn:hover,
    .menu-btn:focus-visible {
      opacity: 1;
      background: rgba(0, 0, 0, 0.08);
    }
    .menu-btn:focus-visible {
      outline: var(--np-focus-ring-width, 2px) solid currentColor;
      outline-offset: 1px;
    }

    .body {
      flex: 1;
      min-height: 24px;
      overflow-y: auto;
      padding: 4px 6px;
    }

    :host([title-only]) .body,
    :host([title-only]) .footer {
      display: none;
    }
    :host([freeform]) .footer {
      display: none;
    }

    .empty {
      padding: 10px 6px;
      font-size: 12px;
      opacity: 0.65;
      font-style: italic;
      text-align: center;
    }

    .freetext {
      padding: 8px 6px;
      font-size: 12px;
      line-height: 1.5;
      white-space: pre-wrap;
      overflow-wrap: break-word;
    }

    .row {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 4px;
      border-radius: 4px;
      min-width: 0;
    }
    .row:hover {
      background: rgba(0, 0, 0, 0.06);
    }

    .checkbox {
      -webkit-appearance: none;
      appearance: none;
      flex-shrink: 0;
      width: 15px;
      height: 15px;
      margin: 0;
      cursor: pointer;
      border: 2px solid currentColor;
      border-radius: 50%;
      opacity: 0.7;
      background: transparent;
    }
    .checkbox:checked {
      background: var(--np-success, #28a745);
      border-color: var(--np-success, #28a745);
      opacity: 1;
    }
    .checkbox:checked::after {
      content: '\\2713';
      display: block;
      color: #fff;
      font-size: 9px;
      line-height: 11px;
      text-align: center;
      font-weight: bold;
    }
    .checkbox:focus-visible {
      outline: var(--np-focus-ring-width, 2px) solid currentColor;
      outline-offset: 1px;
    }

    .row-name {
      flex: 1;
      min-width: 0;
      font-size: 12px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .row-name.done {
      text-decoration: line-through;
      opacity: 0.6;
    }

    .footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      padding: 6px 10px;
      border-top: 1px solid var(--np-border, #e0e0e0);
    }
    .footer:empty { display: none; }

    .progress {
      font-size: 11px;
      font-weight: 600;
      opacity: 0.8;
    }

    .avatars {
      display: flex;
    }
    .avatar {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: var(--np-info-gradient, linear-gradient(135deg, #108BB9 0%, #0d7096 100%));
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 9px;
      font-weight: bold;
      margin-left: -5px;
      border: 1.5px solid var(--np-surface, #ffffff);
    }
    .avatar:first-child { margin-left: 0; }
  </style>
  <div class="card" part="card">
    <div class="header" part="header">
      <p class="title" part="title"></p>
      <button type="button" class="menu-btn" part="menu-button" aria-label="Note options">&#8942;</button>
    </div>
    <div class="body" part="body"></div>
    <div class="footer" part="footer"></div>
  </div>
`;

function _contrastTextColour(colour) {
  const hex = (colour || '').trim();
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return '#333333';
  const value = match[1];
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  const linear = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  return luminance > 0.5 ? '#1a1a1a' : '#ffffff';
}

export class NpNote extends HTMLElement {
  static get observedAttributes() {
    return ['title', 'colour', 'color', 'rows', 'progress', 'avatars', 'comment', 'title-only', 'freeform'];
  }

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.appendChild(TEMPLATE.content.cloneNode(true));
    this._card = root.querySelector('.card');
    this._title = root.querySelector('.title');
    this._body = root.querySelector('.body');
    this._footer = root.querySelector('.footer');
    this._rows = [];
  }

  connectedCallback() {
    this._render();
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === 'rows' && newValue) {
      try {
        this._rows = JSON.parse(newValue);
      } catch {
        this._rows = [];
      }
    }
    this._render();
  }

  get rows() {
    return this._rows;
  }

  set rows(value) {
    this._rows = Array.isArray(value) ? value : [];
    this._render();
  }

  _render() {
    if (!this._card) return;

    const colour = this.getAttribute('colour') || this.getAttribute('color') || 'var(--np-border, #e0e0e0)';
    const isHex = /^#?[0-9a-f]{6}$/i.test(colour.trim());
    this.style.setProperty('--note-accent', colour);
    this.style.setProperty('--note-text', isHex ? _contrastTextColour(colour) : 'var(--np-text, #333333)');

    this._title.textContent = this.getAttribute('title') || 'Untitled note';

    const comment = this.getAttribute('comment');
    if (this.hasAttribute('freeform')) {
      const text = document.createElement('p');
      text.className = 'freetext';
      text.textContent = comment || '';
      this._body.replaceChildren(text);
    } else if (this._rows.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'No child tasks';
      this._body.replaceChildren(empty);
    } else {
      this._body.replaceChildren(
        ...this._rows.map((row) => this._renderRow(row))
      );
    }

    const progress = this.getAttribute('progress');
    const avatars = this._splitList(this.getAttribute('avatars'));
    this._footer.replaceChildren();
    if (progress) {
      const progressEl = document.createElement('span');
      progressEl.className = 'progress';
      progressEl.textContent = progress;
      this._footer.appendChild(progressEl);
    }
    if (avatars.length) {
      const avatarsEl = document.createElement('div');
      avatarsEl.className = 'avatars';
      avatarsEl.replaceChildren(
        ...avatars.slice(0, 5).map((initials) => {
          const el = document.createElement('div');
          el.className = 'avatar';
          el.textContent = initials;
          return el;
        })
      );
      this._footer.appendChild(avatarsEl);
    }
  }

  _renderRow(row) {
    const wrapper = document.createElement('div');
    wrapper.className = 'row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'checkbox';
    checkbox.checked = Boolean(row.done);
    wrapper.appendChild(checkbox);

    const name = document.createElement('span');
    name.className = 'row-name';
    if (row.done) name.classList.add('done');
    name.textContent = row.name || '';
    wrapper.appendChild(name);

    return wrapper;
  }

  _splitList(value) {
    if (!value) return [];
    return value.split(',').map((v) => v.trim()).filter(Boolean);
  }
}

if (!customElements.get('np-note')) {
  customElements.define('np-note', NpNote);
}
