/**
 * <np-button> — pilot component module (issue #1193: standardise components).
 *
 * Consolidates the app's four independently-styled `.btn-primary` /
 * `.btn-secondary` / `.btn-danger` rules (base `components.css`, plus
 * `.tour-actions`, `.raid-toolbar` and `.levelling-buttons` overrides — see
 * docs/design/consolidation-and-handoff.md) into one definition driven by
 * the canonical `--np-*` tokens from visual-system.css. It renders inside a
 * shadow root, so custom properties are the only thing that crosses the
 * boundary — which is why it depends on tokens rather than any class name
 * from the app's global stylesheets.
 *
 * Usage:
 *   <script type="module" src="/static/components/button/np-button.js"></script>
 *   <np-button variant="primary">Save</np-button>
 *   <np-button variant="danger" size="small" disabled>Delete</np-button>
 *   <np-button variant="danger" outline>Remove</np-button>
 *   <np-button variant="neutral">Back</np-button>
 *
 *   <!-- icon + label: put icon markup in slot="icon" -->
 *   <np-button variant="primary">
 *     <svg slot="icon" class="icon"><use href="#icon-save"/></svg>
 *     Save
 *   </np-button>
 *
 *   <!-- icon only: `icon-only` drops the pill shape for a fixed square,
 *        and `label` supplies the accessible name since there is no
 *        visible text -->
 *   <np-button variant="neutral" icon-only label="Settings">
 *     <svg slot="icon" class="icon"><use href="#icon-settings"/></svg>
 *   </np-button>
 *
 * Three independent axes cover the standardisation candidates found by
 * auditing the app's 131 `*btn*` classes (docs/design/standardisation-backlog.md,
 * issue #1193):
 *
 * - `variant` ("primary" | "secondary" | "neutral" | "danger" | "link",
 *   default "primary") is the colour/tone axis.
 *   - "neutral" is new: a plain bordered/transparent button with no accent
 *     colour, for a "Back"/"Skip" role. It's what `.plan-wizard-back-btn`
 *     and `.plan-wizard-skip-btn` actually are — proof: with the tokens
 *     applied, the two are byte-identical to each other and only ever
 *     differed from `.plan-wizard-next-btn` (→ `variant="primary"`) by
 *     colour, never shape.
 * - `outline` (boolean, default off) renders `variant="primary"` or
 *   `variant="danger"` as a transparent/bordered button in that colour
 *   instead of filled — this is what the audit found `.status-bar-fix-btn`
 *   and the app's own Bootstrap `.btn-outline-primary` / `.btn-outline-secondary`
 *   classes already reach for by hand. It has no additional effect on
 *   "secondary" (already border-forward), "neutral" or "link".
 *
 * `size` ("small" | "medium" | "large", default "medium") maps onto the
 * padding/font-size pairs already in use for compact buttons across the app
 * (`.btn-sm` / `.btn-small`: 6-14px padding, 0.85em) plus a matching large
 * step; there was no existing "large" button to match against, so its
 * values are extrapolated from the same scale. Font size and weight step
 * together with size rather than as a separate control: every family in the
 * audit that varied type also varied size in lockstep, never independently.
 *
 * `icon-only` (boolean, default off) is the "Icon button" role the UI
 * inventory counts separately at 33 screens — a plain `<slot name="icon">`
 * covers icon+label for free (drop icon markup in `slot="icon"`, text in the
 * default slot, `gap` already spaces them), but a *bare* icon needs the pill
 * shape replaced with a fixed square and its label supplied out-of-band for
 * screen readers, since there is no visible text to compute an accessible
 * name from. `label` fills that role — the same pattern `<np-close-button>`
 * already uses for the same reason, kept as a dedicated attribute rather
 * than reusing the DOM's own `aria-label` because the accessible name has
 * to land on the real `<button>` inside this component's shadow root, not
 * on the custom-element host, so it always needs forwarding either way.
 * Sizes step 28/36/44px (small/medium/large) — 44px large matches the
 * WCAG touch target outright; small/medium are bumped to it under
 * `@media (pointer: coarse)` instead, the same rule several other
 * `@media (pointer: coarse)` blocks elsewhere in the app already reach for
 * by hand.
 * The slotted icon itself is sized to match (16/20/24px, or matching
 * `font-size` for an icon-font glyph like Bootstrap Icons) regardless of
 * what width/height the consumer's own markup carries, so a button's icon
 * is never a mismatched leftover size from wherever it was copied from.
 *
 * `aria-haspopup` and `aria-expanded` set on the host forward to the real
 * `<button>` the same way `label` does — a consumer toggling
 * `aria-expanded` on a popup-trigger button (exactly as it would on a
 * plain `<button>`) needs that relayed through for the same reason.
 *
 * A click on the internal <button> is a real DOM click event, composed
 * across the shadow boundary, so existing code can listen on the host
 * element exactly as it would on a plain <button>.
 */

const VARIANTS = new Set(['primary', 'secondary', 'neutral', 'danger', 'link']);
const SIZES = new Set(['small', 'medium', 'large']);

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
  <style>
    :host {
      display: inline-block;
      font-family: var(--np-font-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
    }
    :host([hidden]) { display: none; }
    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.4em;
      width: 100%;
      padding: 12px 24px;
      border-radius: var(--np-radius-sm, 5px);
      border: 2px solid transparent;
      font-size: 1em;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      transition: background-color 0.15s ease, color 0.15s ease,
        border-color 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease;
    }
    button:disabled {
      cursor: not-allowed;
      opacity: 0.55;
      transform: none !important;
      box-shadow: none !important;
    }
    button:focus-visible {
      outline: var(--np-focus-ring-width, 2px) solid var(--np-focus-ring-color, currentColor);
      outline-offset: var(--np-focus-ring-offset, 2px);
    }

    /* size="medium" is the default already set on button above; only the
       small/large steps need an override. */
    :host([size='small']) button {
      padding: 6px 14px;
      font-size: 0.85em;
    }
    :host([size='large']) button {
      padding: 14px 32px;
      font-size: 1.15em;
    }

    :host([variant='primary']) button {
      background: var(--np-accent-gradient, var(--np-accent, #EDB52A));
      color: var(--np-on-accent, #23201C);
    }
    :host([variant='primary']) button:not(:disabled):hover {
      background: var(--np-accent-hover, #D9A31C);
      transform: translateY(-1px);
    }

    :host([variant='secondary']) button {
      background: var(--np-surface, #FFFDF9);
      color: var(--np-accent-ink, var(--np-accent, #EDB52A));
      border-color: var(--np-accent, #EDB52A);
    }
    :host([variant='secondary']) button:not(:disabled):hover {
      background: var(--np-accent-tint, #FBEFCE);
    }

    :host([variant='neutral']) button {
      background: transparent;
      color: var(--np-text-secondary, #666666);
      border-color: var(--np-border-control, var(--np-border, #dee2e6));
    }
    :host([variant='neutral']) button:not(:disabled):hover {
      background: var(--np-bg-hover, #f0f1f4);
    }

    :host([variant='danger']) button {
      background: var(--np-danger, #C21D1D);
      color: #fff;
    }
    :host([variant='danger']) button:not(:disabled):hover {
      background: var(--np-danger-hover, #a01717);
      transform: translateY(-1px);
    }

    /* outline flips a filled tone (primary/danger) to transparent +
       coloured border/text. Secondary and neutral are already
       border-forward, so this attribute has nothing to add there. */
    :host([variant='primary'][outline]) button {
      background: transparent;
      color: var(--np-accent-ink, var(--np-accent, #EDB52A));
      border-color: var(--np-accent, #EDB52A);
    }
    :host([variant='primary'][outline]) button:not(:disabled):hover {
      background: var(--np-accent-tint, #FBEFCE);
      transform: none;
    }

    :host([variant='danger'][outline]) button {
      background: transparent;
      color: var(--np-danger, #C21D1D);
      border-color: var(--np-danger, #C21D1D);
    }
    :host([variant='danger'][outline]) button:not(:disabled):hover {
      background: var(--np-danger, #C21D1D);
      color: #fff;
      transform: none;
    }

    :host([variant='link']) {
      width: auto;
    }
    :host([variant='link']) button {
      width: auto;
      padding: 0;
      border: none;
      background: none;
      color: var(--np-accent, #EDB52A);
      /* font-size comes from the size="..." rules above — this selector's
         equal specificity and later position only need to win on the
         properties it actually sets (padding/border/background/color). */
    }
    :host([variant='link']) button:not(:disabled):hover {
      color: var(--np-accent-hover, #D9A31C);
      text-decoration: underline;
    }

    /* Icon sizing tracks the button's own size step regardless of the
       slotted markup's own width/height/font-size, so an icon copied from
       anywhere in the app comes out consistent. Both width/height (SVG)
       and font-size (icon-font glyphs, e.g. Bootstrap Icons) are set;
       each markup kind ignores whichever pair does not apply to it. */
    ::slotted([slot='icon']) {
      flex-shrink: 0;
    }
    :host([size='small']) ::slotted([slot='icon']) {
      width: 16px;
      height: 16px;
      font-size: 16px;
    }
    :host([size='medium']) ::slotted([slot='icon']) {
      width: 20px;
      height: 20px;
      font-size: 20px;
    }
    :host([size='large']) ::slotted([slot='icon']) {
      width: 24px;
      height: 24px;
      font-size: 24px;
    }

    /* icon-only replaces the pill shape with a fixed square and drops the
       label padding/gap -- there is nothing to pad away from or gap next
       to. Declared after the size rules above so it wins on the padding
       they set at equal specificity. */
    :host([icon-only]) button {
      width: 36px;
      height: 36px;
      padding: 0;
      gap: 0;
    }
    :host([icon-only][size='small']) button {
      width: 28px;
      height: 28px;
    }
    :host([icon-only][size='large']) button {
      width: 44px;
      height: 44px;
    }
    :host([icon-only]) ::slotted([slot='icon']) {
      margin: 0;
    }
    /* A neutral icon button has no border. The border is how a labelled
       neutral button (Back, Skip) reads as a button; a lone icon needs no
       box to be one, and every other icon control in the app -- the
       <np-close-button> beside these in a panel header, the status bar's
       own buttons -- has none, so a bordered one read as boxed-in beside
       them. The hover background still says "press me". */
    :host([icon-only][variant='neutral']) button {
      border-color: transparent;
    }

    /* small/medium icon-only steps (28px/36px) are below the 44px WCAG
       touch target size="large" already clears outright -- bumped here
       under a coarse pointer only, matching .product-comp-action-btn's own
       coarse-pointer rule (the migration this attribute replaces it in),
       rather than growing every mouse-driven icon button on the page. */
    @media (pointer: coarse) {
      :host([icon-only]) button {
        min-width: 44px;
        min-height: 44px;
      }
    }
  </style>
  <button type="button" part="button">
    <slot name="icon"></slot><slot></slot>
  </button>
`;

// ARIA states some consumers need to toggle at runtime (e.g. a popup
// trigger's aria-expanded) or set once (aria-haspopup) -- same forwarding
// problem _syncLabel solves for aria-label, generalised to the specific
// attributes actually in use rather than every possible aria-* name.
const ARIA_PASSTHROUGH = ['aria-haspopup', 'aria-expanded'];

export class NpButton extends HTMLElement {
  static get observedAttributes() {
    return ['variant', 'size', 'disabled', 'type', 'label', ...ARIA_PASSTHROUGH];
  }

  constructor() {
    super();
    // delegatesFocus so `.focus()` on the host resolves to the real
    // shadow-DOM <button> -- the host itself carries no tabindex of its
    // own. Mirrors <np-close-button>'s own fix for the same gap. Once
    // focused this way, the host itself matches `:focus`/`:focus-within`
    // (so an external hover-reveal hook like .nwd-delete-btn's should key
    // off one of those) but NOT `:focus-visible` -- confirmed via
    // Playwright as a Chromium quirk: :focus-visible tracks the actual
    // focused node (the shadow <button>, which does match it), not the
    // delegatesFocus host.
    const root = this.attachShadow({ mode: 'open', delegatesFocus: true });
    root.appendChild(TEMPLATE.content.cloneNode(true));
    this._button = root.querySelector('button');
  }

  connectedCallback() {
    if (!VARIANTS.has(this.getAttribute('variant'))) {
      this.setAttribute('variant', 'primary');
    }
    if (!SIZES.has(this.getAttribute('size'))) {
      this.setAttribute('size', 'medium');
    }
    this._syncDisabled();
    this._syncType();
    this._syncLabel();
    for (const attr of ARIA_PASSTHROUGH) this._syncAria(attr);
  }

  attributeChangedCallback(name) {
    if (name === 'disabled') this._syncDisabled();
    if (name === 'type') this._syncType();
    if (name === 'label') this._syncLabel();
    if (ARIA_PASSTHROUGH.includes(name)) this._syncAria(name);
  }

  get variant() {
    return this.getAttribute('variant') || 'primary';
  }

  set variant(value) {
    if (VARIANTS.has(value)) this.setAttribute('variant', value);
  }

  get size() {
    return this.getAttribute('size') || 'medium';
  }

  set size(value) {
    if (SIZES.has(value)) this.setAttribute('size', value);
  }

  get disabled() {
    return this.hasAttribute('disabled');
  }

  set disabled(value) {
    this.toggleAttribute('disabled', Boolean(value));
  }

  get outline() {
    return this.hasAttribute('outline');
  }

  set outline(value) {
    this.toggleAttribute('outline', Boolean(value));
  }

  get iconOnly() {
    return this.hasAttribute('icon-only');
  }

  set iconOnly(value) {
    this.toggleAttribute('icon-only', Boolean(value));
  }

  _syncDisabled() {
    this._button.disabled = this.disabled;
  }

  _syncType() {
    this._button.type = this.getAttribute('type') || 'button';
  }

  /** Forwards `label` onto the real, shadow-DOM <button> as its
   * `aria-label` -- the host itself carries no ARIA role, so setting
   * `aria-label` directly on the host would compute a name for an element
   * that is never the thing a screen reader focuses or activates. Needed
   * for `icon-only`, where there is no visible text to compute an
   * accessible name from; harmless to set on an icon+label button too
   * (the visible text already supplies a name, so this only overrides
   * that if `label` is also given, which is not the expected use). */
  _syncLabel() {
    const label = this.getAttribute('label');
    if (label) {
      this._button.setAttribute('aria-label', label);
    } else {
      this._button.removeAttribute('aria-label');
    }
  }

  /** Forwards one of ARIA_PASSTHROUGH's attributes from the host onto the
   * real shadow-DOM <button>, same rationale as _syncLabel: assistive tech
   * reads ARIA state off the actual interactive element, not the inert
   * custom-element host, so a consumer toggling e.g. aria-expanded on the
   * host (as it would on a plain <button>) needs it relayed through. */
  _syncAria(name) {
    if (this.hasAttribute(name)) {
      this._button.setAttribute(name, this.getAttribute(name));
    } else {
      this._button.removeAttribute(name);
    }
  }
}

if (!customElements.get('np-button')) {
  customElements.define('np-button', NpButton);
}
