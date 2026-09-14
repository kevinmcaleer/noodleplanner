/**
 * <np-empty-state> — "nothing here yet" (design-system.md §6/§10: 37
 * screens, second-highest frequency after panel header). The UI inventory
 * calls the 19 per-area classes doing this job (`.raid-empty-state`,
 * `.budget-empty-state`, `.kanban-empty-state`, `.wb-empty-state`, …)
 * "the strongest single consolidation target in the app" — every one of
 * them turned out to be the same shape at a different tier: bare
 * centred text, or a card with an optional icon/heading/body/actions.
 *
 * Deliberately out of scope: the welcome screen and the pre-render
 * `.placeholder-view` family. design-system.md calls those a separate,
 * sibling kind of "nothing here" (onboarding, not "no data yet") that
 * likely keeps its own shell rather than collapsing into this one.
 *
 * Two tiers, one component:
 *   - variant="text" (default) — bare centred italic text, no box. Covers
 *     `.quad-empty-state`, `.vh-empty`, `.ns-empty`, `.card-list-empty`, …
 *     — the one-line placeholder inside a table or widget.
 *   - variant="card" — a padded card with an optional `icon` slot, an
 *     optional `heading` attribute, body text in the default slot, and an
 *     optional `actions` slot for CTA buttons. `dashed` swaps the card's
 *     solid border + shadow (`.portfolio-empty-state`, `.wb-empty-state`)
 *     for the lighter dashed-border look (`.search-view-empty`,
 *     `.backstage-recent-empty`).
 *
 * Padding/colour are normalised onto `--np-*` tokens throughout — several
 * of the classes above used raw px padding (`80px 40px`) and raw hex text
 * colour (`#adb5bd`, `#495057`); this component doesn't reproduce that
 * drift.
 *
 * Usage:
 *   <script type="module" src="/static/components/empty-state/np-empty-state.js"></script>
 *   <np-empty-state>No upcoming milestones.</np-empty-state>
 *
 *   <np-empty-state variant="card" heading="RAID Log">
 *     <p>Track Risks, Actions, Issues, Decisions, and Dependencies.</p>
 *     <button slot="actions">+ Add Item</button>
 *   </np-empty-state>
 *
 *   <np-empty-state variant="card" dashed heading="No recent plans yet">
 *     Create a new plan or open one to get started.
 *   </np-empty-state>
 */

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
  <style>
    :host {
      display: block;
      font-family: var(--np-font-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
    }
    :host([hidden]) { display: none; }

    .wrap {
      text-align: center;
      color: var(--np-muted, #adb5bd);
      padding: var(--np-space-32, 32px) var(--np-space-12, 12px);
      font-style: italic;
    }

    :host([variant="card"]) .wrap {
      font-style: normal;
      max-width: 420px;
      margin: 0 auto;
      padding: var(--np-space-40, 40px) var(--np-space-32, 32px);
      border-radius: var(--np-radius-lg, 12px);
      background: var(--np-surface, #ffffff);
      border: 1px solid var(--np-border, #e9ecef);
      box-shadow: 0 2px 8px var(--np-shadow, rgba(0, 0, 0, 0.08));
    }
    :host([variant="card"][dashed]) .wrap {
      border-style: dashed;
      box-shadow: none;
      background: var(--np-surface-alt, #f8f5ee);
    }

    .icon {
      font-size: 32px;
      line-height: 1;
      margin-bottom: var(--np-space-12, 12px);
    }
    .icon:empty { display: none; }

    .heading {
      margin: 0 0 var(--np-space-8, 8px);
      font-size: 1.1em;
      font-weight: 700;
      color: var(--np-ink, #23201c);
    }
    .heading[hidden] { display: none; }

    .body ::slotted(p) {
      margin: 0 0 var(--np-space-8, 8px);
    }
    .body ::slotted(p:last-child) {
      margin-bottom: 0;
    }
    :host(:not([variant="card"])) .body {
      font-size: inherit;
    }
    :host([variant="card"]) .body {
      font-size: 0.95em;
      line-height: 1.5;
      color: var(--np-body, #495057);
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: var(--np-space-8, 8px);
      margin-top: var(--np-space-20, 20px);
    }
    .actions:empty { display: none; }
  </style>
  <div class="wrap" part="wrap">
    <div class="icon" part="icon"><slot name="icon"></slot></div>
    <p class="heading" part="heading" hidden></p>
    <div class="body" part="body"><slot></slot></div>
    <div class="actions" part="actions"><slot name="actions"></slot></div>
  </div>
`;

export class NpEmptyState extends HTMLElement {
  static get observedAttributes() {
    return ['heading'];
  }

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.appendChild(TEMPLATE.content.cloneNode(true));
    this._heading = root.querySelector('.heading');
  }

  connectedCallback() {
    this._render();
  }

  attributeChangedCallback() {
    this._render();
  }

  _render() {
    const heading = this.getAttribute('heading');
    this._heading.hidden = !heading;
    this._heading.textContent = heading || '';
  }
}

if (!customElements.get('np-empty-state')) {
  customElements.define('np-empty-state', NpEmptyState);
}
