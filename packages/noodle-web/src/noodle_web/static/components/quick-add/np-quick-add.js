/**
 * <np-quick-add> -- type a task the way the plan writes it (#1385, epic #1376).
 *
 * A phone should be somewhere to capture work, not only to read it. This is
 * a field at the foot of the plan list: type "Design review @alex 2d
 * 2026-10-02" and it is a task with a resource, a duration and a start date,
 * because the line is the plan's own grammar, parsed by the plan's own
 * tokenizer (task-tokenizer.js) -- not squashed into a name.
 *
 * Before it is added, chips under the field show what was recognised, the way
 * the task form's comment field previews a detected date (smart-date-tags.js).
 * The component draws them; the page says what they are, through `preview`,
 * so the component knows nothing of the grammar.
 *
 * Usage:
 *   <script type="module" src="/static/components/quick-add/np-quick-add.js"></script>
 *   <np-quick-add placeholder="Add a task to Design…"></np-quick-add>
 *   <script>
 *     quickAdd.preview = (text) => [{ kind: 'resource', label: '@alex' }, …];
 *     quickAdd.addEventListener('quickadd', (e) => addTask(e.detail.text));
 *   </script>
 *
 * Attributes: `placeholder`; `label`, the field's accessible name ("Add a
 * task" by default).
 * Property `preview(text)` -> [{ kind, label }].
 * Events: `quickadd` (bubbles, cancelable) with `{ text }` on Enter or the
 * Add button. The field clears for the next task unless the event is
 * cancelled -- a page that could not add the task keeps what was typed.
 *
 * Staying above the on-screen keyboard is the page's to arrange: the field is
 * in the flow at the foot of its view, and the view's height gives way to
 * `--keyboard-inset` (published by overlay-kit.js's watchKeyboard()).
 */

import { escapeHtml, upgradeProperty, watchKeyboard } from '../overlay/overlay-kit.js';

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
  <style>
    :host {
      display: block;
      font-family: var(--np-font-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      background: var(--np-surface, #fffdf9);
      border-top: 1px solid var(--np-border, #e3ddd3);
      padding: var(--np-space-8, 8px) var(--np-space-12, 12px);
      padding-bottom: calc(var(--np-space-8, 8px) + env(safe-area-inset-bottom, 0px));
    }
    :host([hidden]) { display: none; }

    form {
      display: flex;
      flex-direction: column;
      gap: var(--np-space-8, 8px);
      margin: 0;
    }
    .row {
      display: flex;
      gap: var(--np-space-8, 8px);
      align-items: center;
    }
    input {
      flex: 1 1 auto;
      min-width: 0;
      min-height: var(--np-touch-target, 44px);
      box-sizing: border-box;
      padding: 0 var(--np-space-12, 12px);
      font: inherit;
      /* 16px, or iOS zooms the page when the field is focused. */
      font-size: var(--np-touch-field-text, 16px);
      color: var(--np-ink, #23201c);
      background: var(--np-surface-alt, #f3eee5);
      border: 1px solid var(--np-border-control, #8a8378);
      border-radius: var(--np-radius-control, 8px);
    }
    input::placeholder { color: var(--np-muted, #6b665d); }
    input:focus-visible {
      outline: none;
      box-shadow: var(--np-focus-ring);
    }
    button {
      display: grid;
      place-items: center;
      flex: 0 0 auto;
      width: var(--np-touch-target, 44px);
      height: var(--np-touch-target, 44px);
      padding: 0;
      border: 0;
      border-radius: var(--np-radius-control, 8px);
      background: var(--np-accent, #edb52a);
      color: var(--np-on-accent, #23201c);
      cursor: pointer;
    }
    button:disabled {
      background: var(--np-sunken, #efe9de);
      color: var(--np-muted, #6b665d);
      cursor: default;
    }
    button:focus-visible {
      outline: none;
      box-shadow: var(--np-focus-ring);
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: var(--np-space-4, 4px);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .chips:empty { display: none; }
    .chip {
      padding: var(--np-space-2, 2px) var(--np-space-8, 8px);
      border-radius: var(--np-radius-pill, 999px);
      background: var(--np-accent-tint, #fbefd0);
      color: var(--np-accent-ink, #6b4d00);
      font-size: var(--np-text-85, 0.85em);
      white-space: nowrap;
    }
    .chip .kind {
      font-weight: var(--np-weight-semibold, 600);
      margin-right: var(--np-space-4, 4px);
    }
  </style>
  <form part="form" novalidate>
    <ul class="chips" part="chips" aria-live="polite"></ul>
    <div class="row">
      <input part="input" type="text" enterkeyhint="done" autocomplete="off" autocapitalize="sentences">
      <button type="submit" part="add-button" aria-label="Add task" disabled>
        <svg viewBox="0 0 16 16" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>
      </button>
    </div>
  </form>
`;

export class NpQuickAdd extends HTMLElement {
  static get observedAttributes() {
    return ['placeholder', 'label'];
  }

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open', delegatesFocus: true });
    root.appendChild(TEMPLATE.content.cloneNode(true));
    this._form = root.querySelector('form');
    this._input = root.querySelector('input');
    this._button = root.querySelector('button');
    this._chips = root.querySelector('.chips');
    this._preview = null;

    this._input.addEventListener('input', () => this._sync());
    this._form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.submit();
    });
    // Keep the keyboard up: a tap on Add must not take focus from the field.
    this._button.addEventListener('pointerdown', (event) => event.preventDefault());
  }

  connectedCallback() {
    upgradeProperty(this, 'preview');
    upgradeProperty(this, 'value');
    watchKeyboard();
    this._label();
    this._sync();
  }

  attributeChangedCallback() {
    this._label();
  }

  /** `(text) => [{ kind, label }]`: what the field has recognised. */
  get preview() { return this._preview; }
  set preview(fn) {
    this._preview = typeof fn === 'function' ? fn : null;
    this._sync();
  }

  get value() { return this._input.value; }
  set value(text) {
    this._input.value = text == null ? '' : String(text);
    this._sync();
  }

  focus(options) { this._input.focus(options); }

  /** Offer what was typed; clears unless the `quickadd` event is cancelled. */
  submit() {
    const text = this._input.value.trim();
    if (!text) return false;
    const accepted = this.dispatchEvent(new CustomEvent('quickadd', {
      bubbles: true,
      cancelable: true,
      detail: { text },
    }));
    if (accepted) this.value = '';
    return accepted;
  }

  _label() {
    this._input.placeholder = this.getAttribute('placeholder') || 'Add a task…';
    this._input.setAttribute('aria-label', this.getAttribute('label') || 'Add a task');
  }

  _sync() {
    const text = this._input.value.trim();
    this._button.disabled = !text;
    let chips = [];
    if (text && this._preview) {
      try { chips = this._preview(text) || []; } catch (_) { chips = []; }
    }
    this._chips.innerHTML = chips.map((chip) =>
      `<li class="chip" data-kind="${escapeHtml(chip.kind)}"><span class="kind">${escapeHtml(chip.kindLabel || chip.kind)}</span>${escapeHtml(chip.label)}</li>`
    ).join('');
  }
}

if (!customElements.get('np-quick-add')) {
  customElements.define('np-quick-add', NpQuickAdd);
}
