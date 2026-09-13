/**
 * <np-board> — Kanban board component (issue #1193: Storybook extraction
 * for the board view).
 *
 * Consolidates the app's `.kanban-board` / `.kanban-column` markup (see
 * static/views/kanban.css and static/kanban-board.js) into one definition
 * driven by the canonical `--np-*` tokens from visual-system.css, composing
 * the `np-card` component for each card. Renders inside a shadow root, so
 * only custom properties cross the boundary — the same convention as the
 * `np-button` pilot.
 *
 * Usage:
 *   <script type="module" src="/static/components/board/np-board.js"></script>
 *   <np-board></np-board>
 *   <script>
 *     document.querySelector('np-board').columns = [
 *       { title: 'To Do', cards: [{ title: 'Plan the sprint' }] },
 *       { title: 'In Progress', colour: '#108BB9', cards: [] },
 *     ];
 *   </script>
 *
 * `columns` is a JS property (an array of column objects); it can also be
 * set as a `columns="[...]"` JSON attribute for static/story usage.
 */

import '../card/np-card.js';

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
  <style>
    :host {
      display: block;
      font-family: var(--np-font-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
    }
    :host([hidden]) { display: none; }

    .board {
      display: flex;
      gap: 20px;
      overflow-x: auto;
      overflow-y: hidden;
      padding: 20px;
      background: var(--np-bg-alt, #f0f2f5);
      align-items: stretch;
    }

    .column {
      min-width: 280px;
      max-width: 340px;
      flex: 1;
      background: var(--np-surface, #ffffff);
      border-radius: var(--np-radius-md, 8px);
      display: flex;
      flex-direction: column;
      box-shadow: 0 2px 4px var(--np-shadow, rgba(0, 0, 0, 0.1));
    }

    .column-header {
      padding: 15px;
      background: var(--column-colour, var(--np-info-gradient, linear-gradient(135deg, #108BB9 0%, #0d7096 100%)));
      color: #fff;
      border-radius: var(--np-radius-md, 8px) var(--np-radius-md, 8px) 0 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
    }

    .column-title {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
      flex: 1;
      min-width: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .column-count {
      font-size: 12px;
      opacity: 0.9;
      background: rgba(255, 255, 255, 0.2);
      padding: 2px 8px;
      border-radius: 12px;
      flex-shrink: 0;
    }

    .column-body {
      flex: 1;
      overflow-y: auto;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      min-height: 60px;
    }

    .column-empty {
      text-align: center;
      padding: 40px 20px;
      color: var(--np-muted, #adb5bd);
      font-style: italic;
      font-size: 13px;
    }

    .column-footer {
      padding: 10px;
      background: var(--np-paper, #f8f9fa);
      border-radius: 0 0 var(--np-radius-md, 8px) var(--np-radius-md, 8px);
    }

    .add-card-btn {
      width: 100%;
      padding: 8px 12px;
      background: transparent;
      border: 2px dashed var(--np-border, #ced4da);
      border-radius: 4px;
      color: var(--np-muted, #6c757d);
      font-weight: 500;
      font-family: inherit;
      cursor: pointer;
      transition: all 0.2s;
    }
    .add-card-btn:hover {
      background: var(--np-sunken, #e9ecef);
      border-color: var(--np-accent, #EDB52A);
      color: var(--np-accent-ink, #EDB52A);
    }
    .add-card-btn:focus-visible {
      outline: var(--np-focus-ring-width, 2px) solid var(--np-focus-ring-color, currentColor);
      outline-offset: var(--np-focus-ring-offset, 2px);
    }

    .add-column {
      min-width: 240px;
      max-width: 240px;
      display: flex;
      align-items: flex-start;
    }
    .add-column-btn {
      width: 100%;
      height: 100px;
      padding: 20px;
      background: transparent;
      border: 3px dashed var(--np-border, #ced4da);
      border-radius: var(--np-radius-md, 8px);
      color: var(--np-muted, #6c757d);
      font-size: 16px;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      transition: all 0.2s;
    }
    .add-column-btn:hover {
      background: var(--np-paper, #f8f9fa);
      border-color: var(--np-accent, #EDB52A);
      color: var(--np-accent-ink, #EDB52A);
    }
    .add-column-btn:focus-visible {
      outline: var(--np-focus-ring-width, 2px) solid var(--np-focus-ring-color, currentColor);
      outline-offset: var(--np-focus-ring-offset, 2px);
    }
  </style>
  <div class="board" part="board"></div>
`;

export class NpBoard extends HTMLElement {
  static get observedAttributes() {
    return ['columns', 'show-add-column'];
  }

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.appendChild(TEMPLATE.content.cloneNode(true));
    this._board = root.querySelector('.board');
    this._columns = [];
  }

  connectedCallback() {
    this._render();
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === 'columns' && newValue) {
      try {
        this._columns = JSON.parse(newValue);
      } catch {
        this._columns = [];
      }
    }
    this._render();
  }

  get columns() {
    return this._columns;
  }

  set columns(value) {
    this._columns = Array.isArray(value) ? value : [];
    this._render();
  }

  _render() {
    if (!this._board) return;
    const columns = this._columns.map((col) => this._renderColumn(col));

    if (this.hasAttribute('show-add-column')) {
      const addColumn = document.createElement('div');
      addColumn.className = 'add-column';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'add-column-btn';
      btn.textContent = '+ Add Column';
      addColumn.appendChild(btn);
      columns.push(addColumn);
    }

    this._board.replaceChildren(...columns);
  }

  _renderColumn(col) {
    const column = document.createElement('div');
    column.className = 'column';

    const header = document.createElement('div');
    header.className = 'column-header';
    if (col.colour || col.color) {
      header.style.setProperty('--column-colour', col.colour || col.color);
    }

    const title = document.createElement('p');
    title.className = 'column-title';
    title.textContent = col.title || 'Untitled';
    header.appendChild(title);

    const count = document.createElement('span');
    count.className = 'column-count';
    count.textContent = String((col.cards || []).length);
    header.appendChild(count);

    column.appendChild(header);

    const body = document.createElement('div');
    body.className = 'column-body';
    const cards = col.cards || [];
    if (cards.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'column-empty';
      empty.textContent = 'No cards yet';
      body.appendChild(empty);
    } else {
      for (const cardData of cards) {
        body.appendChild(this._renderCard(cardData));
      }
    }
    column.appendChild(body);

    const footer = document.createElement('div');
    footer.className = 'column-footer';
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'add-card-btn';
    addBtn.textContent = '+ Add Card';
    footer.appendChild(addBtn);
    column.appendChild(footer);

    return column;
  }

  _renderCard(cardData) {
    const card = document.createElement('np-card');
    if (cardData.title) card.setAttribute('title', cardData.title);
    if (cardData.duration) card.setAttribute('duration', cardData.duration);
    if (cardData.comment) card.setAttribute('comment', cardData.comment);
    if (cardData.tags) card.setAttribute('tags', cardData.tags);
    if (cardData.resources) card.setAttribute('resources', cardData.resources);
    if (cardData.percent !== undefined && cardData.percent !== null) {
      card.setAttribute('percent', String(cardData.percent));
    }
    if (cardData.checked) card.setAttribute('checked', '');
    return card;
  }
}

if (!customElements.get('np-board')) {
  customElements.define('np-board', NpBoard);
}
