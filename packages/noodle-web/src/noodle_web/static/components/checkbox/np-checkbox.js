/**
 * <np-checkbox> -- the app's one checkbox (issue #1245, epic #1241).
 *
 * ## Why this exists
 *
 * Before this there were nine checkbox treatments and no component:
 * `.wb-note-checkbox` (bare native, 15px), `.round-checkbox` (kanban, a 16px
 * `--np-success`-filled circle), `.task-peek-checkbox`, `.project-select-checkbox`,
 * `.wb-add-note-checkbox`, the two pilot components' private round ones, the
 * settings panel's `accent-color` native variant, and a bare
 * `input[type="checkbox"]` element rule in `views/gantt.css` that -- because
 * that stylesheet is linked globally -- sized every checkbox in the app.
 *
 * That last one is worth stating plainly, because it made most of the others
 * dead letters. `input[type="checkbox"]` is specificity 0-1-1; every one of
 * the class rules above is a single class at 0-1-0 and none carries
 * `!important`. So the cascade resolved width and height from the Gantt's rule
 * regardless of load order: the whiteboard's declared 15px never applied,
 * kanban's 16px circle never applied, and `.task-peek-checkbox`'s
 * coarse-pointer bump to 20px was a no-op because the global rule already
 * imposed 20px. That rule is now scoped to the `.checkbox-group` it belongs
 * to, so those declarations mean what they say again.
 *
 * Rendering the box inside a shadow root is what makes this robust rather than
 * one more rule in the same fight: global element selectors do not cross the
 * boundary, so no view stylesheet can silently resize this control.
 *
 * ## The states, and the one that did not exist
 *
 * `indeterminate` had no implementation anywhere in the app -- searching
 * `packages/`, `tests/`, `scripts/` and `docs/` for the word returned nothing.
 * A whiteboard note marks a summary row (`data-wb-row-summary`) and
 * `wbIsChildComplete()` is `percent >= 100`, so a summary at 40% rendered
 * pixel-identically to one at 0%. The data was already there --
 * `wbNoteProgress()` returns `{ completed, total }` for the footer.
 *
 * It is driven by the real `HTMLInputElement.indeterminate` property rather
 * than a class that merely looks mixed, so assistive technology reports it.
 * Only a `row="summary"` may be indeterminate; a leaf never is -- the
 * component enforces that rather than trusting the caller, because a leaf is
 * one task, done or not, and there is nothing for it to be mixed about.
 *
 * What decides it lives in the view model, not here: wbBuildNoteViewModel()
 * gives each summary child its own { completed, total } and
 * wbIsPartlyComplete() turns that into the boolean this attribute carries.
 * The rule is "some but not all of my direct children are complete" -- ticks,
 * not the engine's averaged percent. See docs/design/design-system.md §6.
 *
 * ## Semantics this control must not imply
 *
 * Checking a summary row marks *that row*. `wbToggleChildComplete()` writes
 * `100%`/`0%` onto that task's own markdown line and does not touch its
 * descendants, so its children keep their own percentages. The component
 * therefore never cascades, and `indeterminate` is a report of the children's
 * state rather than a control over it.
 *
 * ## Usage
 *
 *   <script type="module" src="/static/components/checkbox/np-checkbox.js"></script>
 *   <np-checkbox checked label="Mark Ship Widget as incomplete"></np-checkbox>
 *   <np-checkbox row="summary" indeterminate dense></np-checkbox>
 *
 * Emits a `change` event carrying `{ checked, indeterminate }`.
 */

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
  <style>
    :host {
      /* The pressable area, not the box. tests/ui/test_target_size.py holds a
         24px floor (WCAG 2.2 SC 2.5.8) and every checkbox in the app was under
         it -- 15, 16, 18 or 20px. The target grows with padding so the visible
         control stays small enough not to shout on a dense checklist row. */
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: var(--np-checkbox-target, 24px);
      min-height: var(--np-checkbox-target, 24px);
      flex-shrink: 0;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }
    :host([disabled]) { cursor: default; }
    :host([hidden]) { display: none; }

    input {
      appearance: none;
      -webkit-appearance: none;
      margin: 0;
      width: var(--np-checkbox-size, 16px);
      height: var(--np-checkbox-size, 16px);
      /* The boundary the user has to find. --np-border-control is the token
         whose own comment designates it for exactly that, and check-contrast
         already holds it to 3:1 against four surfaces. The treatments this
         replaces used --np-faint, currentColor and --np-muted: the first two
         are rungs of the ink ramp and the third is literally the text colour,
         so none of them was a control-boundary token. */
      border: 2px solid var(--np-border-control);
      border-radius: var(--np-checkbox-radius, 4px);
      background: var(--np-surface);
      cursor: inherit;
      display: grid;
      /* stretch, not center. The glyph below is sized 100% x 100% of its grid
         area, and place-content: center sizes that area to the item's own
         (empty) content -- which resolved to 0x0, so neither the tick nor the
         dash was ever drawn, in any consumer. Stretching gives the glyph the
         box's content area to clip its shape out of. */
      place-content: stretch;
      transition: background-color 0.15s ease, border-color 0.15s ease;
    }

    /* Dense: the whiteboard note's checklist rows, where the note is 260px wide
       and a row can carry five other controls. */
    :host([dense]) input {
      width: var(--np-checkbox-size-dense, 14px);
      height: var(--np-checkbox-size-dense, 14px);
      border-width: 1.5px;
    }

    input:checked,
    input:indeterminate {
      background: var(--np-success);
      border-color: var(--np-success);
    }

    /* One glyph element for both marks, so they cannot drift apart. */
    input::before {
      content: '';
      width: 100%;
      height: 100%;
      background: var(--np-on-success);
      clip-path: none;
      transform: scale(0);
      transition: transform 0.12s ease;
    }
    input:checked::before {
      transform: scale(1);
      /* A tick, drawn rather than typed: the treatments this replaces used a
         '\\2713' glyph, whose size and baseline depend on whichever font
         happens to resolve. */
      clip-path: polygon(19% 47%, 8% 58%, 39% 88%, 92% 27%, 81% 17%, 38% 66%);
    }
    input:indeterminate::before {
      transform: scale(1);
      clip-path: polygon(15% 44%, 85% 44%, 85% 56%, 15% 56%);
    }

    input:disabled {
      opacity: 0.45;
      cursor: default;
    }

    /* The app's own ring. The global rule in visual-system.css cannot reach a
       shadow root, which is why the pilot components each invented their own
       (or, in np-card's case, had none at all). */
    input:focus-visible {
      outline: var(--np-focus-ring-width, 2px) solid var(--np-focus-ring-color);
      outline-offset: var(--np-focus-ring-offset, 2px);
    }

    @media (prefers-reduced-motion: reduce) {
      input, input::before { transition: none; }
    }
  </style>
  <input type="checkbox" />
`;

export class NpCheckbox extends HTMLElement {
    static get observedAttributes() {
        return ['checked', 'indeterminate', 'disabled', 'label', 'row', 'dense'];
    }

    constructor() {
        super();
        // delegatesFocus so `.focus()` on the host lands on the real input, and
        // so the host does not need a tabindex of its own.
        const root = this.attachShadow({ mode: 'open', delegatesFocus: true });
        root.appendChild(TEMPLATE.content.cloneNode(true));
        this._input = root.querySelector('input');

        // The host is the 24px pressable target and the input inside it is
        // 14-16px, so most of that target is host padding. A click there has to
        // reach the input or the target is decorative -- which is also what
        // lets callers and tests keep clicking the element they always clicked.
        this.addEventListener('click', (event) => {
            if (event.target === this || event.composedPath()[0] === this) {
                if (this.hasAttribute('disabled')) return;
                this._input.click();
            }
        });

        this._input.addEventListener('change', () => {
            // Reflect back to attributes so the DOM and the component agree,
            // then report. `indeterminate` never survives a user click -- that
            // is the platform's behaviour and the right one: the user has just
            // made a definite choice.
            this.toggleAttribute('checked', this._input.checked);
            this.removeAttribute('indeterminate');
            this.dispatchEvent(new CustomEvent('change', {
                bubbles: true,
                composed: true,
                detail: { checked: this._input.checked, indeterminate: false },
            }));
        });
    }

    connectedCallback() { this._render(); }
    attributeChangedCallback() { this._render(); }

    get checked() { return this.hasAttribute('checked'); }
    set checked(value) { this.toggleAttribute('checked', Boolean(value)); }

    get indeterminate() { return this.hasAttribute('indeterminate'); }
    set indeterminate(value) { this.toggleAttribute('indeterminate', Boolean(value)); }

    get disabled() { return this.hasAttribute('disabled'); }
    set disabled(value) { this.toggleAttribute('disabled', Boolean(value)); }

    _render() {
        const input = this._input;
        if (!input) return;

        input.checked = this.hasAttribute('checked');
        input.disabled = this.hasAttribute('disabled');

        // A leaf row is never mixed: it is one task, done or not. Only a
        // summary reports its children's state.
        const summary = this.getAttribute('row') === 'summary';
        input.indeterminate = summary && this.hasAttribute('indeterminate');

        const label = this.getAttribute('label');
        if (label) input.setAttribute('aria-label', label);
        else input.removeAttribute('aria-label');
    }
}

if (!customElements.get('np-checkbox')) {
    customElements.define('np-checkbox', NpCheckbox);
}
