/**
 * <np-card> — Kanban card component (issue #1193: Storybook extraction for
 * the board view).
 *
 * Consolidates the app's `.kanban-card` markup (see
 * static/views/kanban.css and static/kanban-board.js) into one definition
 * driven by the canonical `--np-*` tokens from visual-system.css. Renders
 * inside a shadow root, so only custom properties cross the boundary — the
 * same convention as the `np-button` pilot.
 *
 * Usage:
 *   <script type="module" src="/static/components/card/np-card.js"></script>
 *   <np-card title="Design the onboarding flow" duration="3d" percent="40"
 *            resources="AB,CD" tags="UX,Design"></np-card>
 *
 * A click on the internal checkbox/piechart control is a real DOM click
 * event, composed across the shadow boundary, so existing code can listen
 * on the host element as it would on the plain markup this replaces.
 */

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
  <style>
    :host {
      display: block;
      font-family: var(--np-font-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
    }
    :host([hidden]) { display: none; }

    .card {
      background: var(--np-surface, #ffffff);
      border-radius: var(--np-radius-sm, 6px);
      padding: 12px;
      box-shadow: 0 1px 3px var(--np-shadow, rgba(0, 0, 0, 0.12));
      border: 1px solid var(--np-border, #e9ecef);
      transition: box-shadow 0.2s ease, transform 0.2s ease, border-color 0.2s ease;
      cursor: pointer;
      outline: none;
    }
    .card:hover {
      box-shadow: 0 4px 8px var(--np-shadow-strong, rgba(0, 0, 0, 0.15));
      transform: translateY(-2px);
      border-color: var(--np-accent, #EDB52A);
    }
    .card:focus-visible {
      outline: var(--np-focus-ring-width, 2px) solid var(--np-focus-ring-color, currentColor);
      outline-offset: var(--np-focus-ring-offset, 2px);
      box-shadow: 0 4px 8px var(--np-shadow-strong, rgba(0, 0, 0, 0.15));
    }
    .card:active {
      transform: translateY(0);
      box-shadow: 0 2px 4px var(--np-shadow, rgba(0, 0, 0, 0.1));
    }

    :host([dragging]) .card {
      opacity: 0.5;
      transform: rotate(3deg);
      cursor: grabbing;
    }

    .controls-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }

    .checkbox {
      -webkit-appearance: none;
      appearance: none;
      cursor: pointer;
      width: 16px;
      height: 16px;
      margin: 0;
      border: 2px solid var(--np-muted, #adb5bd);
      border-radius: 50%;
      background: var(--np-surface, #ffffff);
      transition: transform 0.15s ease;
      flex-shrink: 0;
    }
    .checkbox:hover { transform: scale(1.2); }
    .checkbox:checked {
      background: var(--np-success, #28a745);
      border-color: var(--np-success, #28a745);
    }
    .checkbox:checked::after {
      content: '\\2713';
      display: block;
      color: #fff;
      font-size: 10px;
      line-height: 12px;
      text-align: center;
      font-weight: bold;
    }

    .piechart {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: conic-gradient(var(--np-success, #28a745) 0% var(--percent, 0%), var(--np-sunken, #e0e0e0) var(--percent, 0%) 100%);
      cursor: pointer;
      flex-shrink: 0;
      position: relative;
    }
    .piechart:hover { transform: scale(1.2); }
    .piechart.complete { background: var(--np-success, #28a745); }
    .piechart.complete::after {
      content: '\\2713';
      display: block;
      color: #fff;
      font-size: 10px;
      line-height: 16px;
      text-align: center;
      font-weight: bold;
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 8px;
    }

    .title {
      font-size: 14px;
      font-weight: 600;
      margin: 0;
      flex: 1;
      min-width: 0;
      color: var(--np-ink, #23201c);
      line-height: 1.4;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .resources {
      display: flex;
      flex-shrink: 0;
    }
    .avatar {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: var(--np-info-gradient, linear-gradient(135deg, #108BB9 0%, #0d7096 100%));
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      font-weight: bold;
      margin-left: -6px;
      border: 2px solid var(--np-surface, #ffffff);
      box-shadow: 0 1px 2px var(--np-shadow, rgba(0, 0, 0, 0.1));
    }
    .avatar:first-child { margin-left: 0; }

    .body { font-size: 13px; }

    .meta {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin-top: 6px;
    }
    .duration {
      font-size: 12px;
      padding: 2px 8px;
      border-radius: 4px;
      font-weight: 500;
      background: var(--np-blue-subtle, #e7f5ff);
      color: var(--np-dark-blue, #1971c2);
    }

    .comment {
      font-size: 12px;
      color: var(--np-muted, #6c757d);
      font-style: italic;
      margin: 6px 0 0 0;
      line-height: 1.4;
    }

    .footer {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--np-border-light, #f1f3f5);
    }
    .footer:empty { display: none; }

    .labels {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
    }
    .label {
      background: var(--np-sunken, #e9ecef);
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 11px;
      color: var(--np-body, #495057);
      font-weight: 500;
    }
  </style>
  <div class="card" part="card" tabindex="0">
    <div class="controls-row" part="controls"></div>
    <div class="header">
      <p class="title" part="title"></p>
      <div class="resources" part="resources"></div>
    </div>
    <div class="body">
      <div class="meta" part="meta"></div>
      <p class="comment" part="comment" hidden></p>
    </div>
    <div class="footer" part="footer">
      <div class="labels" part="labels"></div>
    </div>
  </div>
`;

export class NpCard extends HTMLElement {
  static get observedAttributes() {
    return ['title', 'duration', 'comment', 'tags', 'resources', 'percent', 'checked', 'dragging'];
  }

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.appendChild(TEMPLATE.content.cloneNode(true));
    this._card = root.querySelector('.card');
    this._controlsRow = root.querySelector('.controls-row');
    this._title = root.querySelector('.title');
    this._resources = root.querySelector('.resources');
    this._meta = root.querySelector('.meta');
    this._comment = root.querySelector('.comment');
    this._labels = root.querySelector('.labels');
  }

  connectedCallback() {
    this._render();
  }

  attributeChangedCallback() {
    this._render();
  }

  _render() {
    this._title.textContent = this.getAttribute('title') || '';

    const resources = this._splitList(this.getAttribute('resources'));
    this._resources.replaceChildren(
      ...resources.slice(0, 5).map((initials) => {
        const el = document.createElement('div');
        el.className = 'avatar';
        el.textContent = initials;
        return el;
      })
    );

    const duration = this.getAttribute('duration');
    this._meta.replaceChildren();
    if (duration) {
      const badge = document.createElement('span');
      badge.className = 'duration';
      badge.textContent = duration;
      this._meta.appendChild(badge);
    }

    const comment = this.getAttribute('comment');
    this._comment.hidden = !comment;
    this._comment.textContent = comment || '';

    const tags = this._splitList(this.getAttribute('tags'));
    this._labels.replaceChildren(
      ...tags.map((tag) => {
        const el = document.createElement('span');
        el.className = 'label';
        el.textContent = tag;
        return el;
      })
    );

    this._renderControl();
  }

  _renderControl() {
    const percentAttr = this.getAttribute('percent');
    this._controlsRow.replaceChildren();
    if (percentAttr !== null) {
      const percent = Math.max(0, Math.min(100, Number(percentAttr) || 0));
      const pie = document.createElement('div');
      pie.className = 'piechart';
      if (percent >= 100) pie.classList.add('complete');
      pie.style.setProperty('--percent', `${percent}%`);
      pie.setAttribute('role', 'button');
      pie.setAttribute('aria-label', `${percent}% complete`);
      this._controlsRow.appendChild(pie);
    } else {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'checkbox';
      checkbox.checked = this.hasAttribute('checked');
      this._controlsRow.appendChild(checkbox);
    }
  }

  _splitList(value) {
    if (!value) return [];
    return value.split(',').map((v) => v.trim()).filter(Boolean);
  }
}

if (!customElements.get('np-card')) {
  customElements.define('np-card', NpCard);
}
