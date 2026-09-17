/**
 * <np-resource-stack> -- the app's resource smarttag (issue #1199).
 *
 * "Wherever a resource is used in the app - provide a profile circle with
 * their initials, and if the user hovers over it, popup a mini resource
 * profile card, showing their name, role, email address, and a link to pop
 * open the resource details form." That is #1199's wording, and this is it.
 *
 * Built here rather than privately inside the whiteboard (#1246) because a
 * private `wb-note-*` stack would be one more unstandardised avatar treatment
 * and would have to be torn out again when #1199 lands. The whiteboard note is
 * the proving ground, not the owner.
 *
 * ## What it replaces
 *
 * Six diameters for one concept: `.wb-note-row-avatar` 14px,
 * `.wb-note-avatar` 20px, `.task-peek-avatars .wb-note-avatar` 18px,
 * `.ribbon-avatar` 23px, `.subtask-resource-avatar` 24px, `.resource-avatar`
 * 28px. Four caps: unbounded on the note row, six in the note footer, four in
 * the peek popover, and kanban's
 * `.resource-avatar:nth-child(n+11) { display: none }`, which hides the
 * eleventh onward with no indication anything was hidden. And four
 * implementations of one initials algorithm.
 *
 * ## Initials
 *
 * One implementation, `initialsFor()` below, ported from whiteboard-notes.js's
 * wbGetInitials() -- first and *last* word, not first and second, which is a
 * real difference on "Mary Jane Watson" (MW, not MJ). The other three copies
 * are tpGetInitials() (task-peek.js, which already delegates to wbGetInitials
 * when it is loaded and duplicates the body when it is not),
 * KanbanBoard.getInitials() and getResourceInitials() (script.js). The two
 * pilot components sidestepped the question entirely by taking pre-computed
 * initials as a string attribute, which is why np-note's story used to pass
 * `avatars="AB,CD"`. This takes *names* and derives them.
 *
 * ## Data
 *
 * `names` is the list of resources. `details` optionally maps a name or
 * shortname to `{ name, role, email }` for the profile card -- the app fills
 * it from front matter (`- @short: Full Name, Role, email, ...`), which is
 * where role and email already live; Storybook passes literals. A resource
 * with no email renders the card without a blank row.
 *
 * Opening the full resource form is the host app's job: the component emits
 * `resource-open` with `{ name, shortname }` rather than reaching for
 * script.js's openResourceForm() itself, so it stays usable in Storybook.
 * Clicking a chip emits `resource-activate`, which the whiteboard wires to its
 * assign menu -- so viewing who is on a task and changing it are one control
 * rather than a chip plus a detached `+`.
 *
 * ## Usage
 *
 *   <np-resource-stack names="Sam Smith,Jo Lee" max="3"></np-resource-stack>
 *   <script>
 *     document.querySelector('np-resource-stack').details = {
 *       'Sam Smith': { name: 'Sam Smith', role: 'Developer',
 *                      email: 'sam@example.com', shortname: 'sam' },
 *     };
 *   </script>
 */

// Its own module so it can be imported without a DOM -- see initials.js.
export { initialsFor } from './initials.js';
import { initialsFor } from './initials.js';

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
  <style>
    :host {
      display: inline-flex;
      align-items: center;
      position: relative;
      font-family: var(--np-font-ui);
    }
    :host([hidden]) { display: none; }

    .stack { display: inline-flex; align-items: center; }

    .chip {
      /* A flat token pairing, not a gradient. Every avatar in the app painted
         white over var(--np-info-gradient), which scripts/check-contrast.mjs
         cannot parse and therefore never scored -- so the one thing about an
         avatar that could be wrong was the one thing nothing checked.
         --np-info / --np-on-info are scored. (No backticks in here: this whole
         block is a JS template literal.) */
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      width: var(--np-avatar-size, 20px);
      height: var(--np-avatar-size, 20px);
      padding: 0;
      /* The separator ring is a theme surface by default, which is right
         on a themed panel and wrong on a whiteboard note: a pastel fill
         is not --np-surface in either theme, so the ring either vanished
         or went dark over light paper. The note sets --np-avatar-ring to
         its own fill (#1250); everything else keeps the default. */
      border: 1.5px solid var(--np-avatar-ring, var(--np-surface));
      border-radius: 50%;
      background: var(--np-avatar-bg, var(--np-info));
      color: var(--np-avatar-ink, var(--np-on-info));
      font-size: calc(var(--np-avatar-size, 20px) * 0.5);
      font-weight: bold;
      line-height: 1;
      cursor: pointer;
      margin-left: var(--np-avatar-overlap, -5px);
    }
    .chip:first-child { margin-left: 0; }

    /* The overflow chip. Not a dead label: it is a button, and opening it
       reveals the names the cap hid. kanban's own overflow rule hides the
       eleventh avatar onward with nothing to say it did. */
    .chip.more {
      /* Same story as the ring above -- and worse here, because the
         overflow chip is a *fill*: --np-surface-alt on a light pastel is
         a chip with no edge at all. */
      background: var(--np-avatar-overflow-bg, var(--np-surface-alt));
      color: var(--np-avatar-overflow-ink, var(--np-text-secondary));
      font-size: calc(var(--np-avatar-size, 20px) * 0.4);
    }

    .chip:focus-visible {
      outline: var(--np-focus-ring-width, 2px) solid var(--np-focus-ring-color);
      outline-offset: 1px;
      z-index: 1;
    }

    .card {
      position: absolute;
      top: calc(100% + 6px);
      left: 0;
      z-index: 1500;
      min-width: 180px;
      max-width: 260px;
      padding: var(--np-space-8);
      border: 1px solid var(--np-border);
      border-radius: 8px;
      background: var(--np-surface);
      color: var(--np-text);
      box-shadow: 0 10px 28px var(--np-shadow);
      font-size: 12px;
      text-align: left;
    }
    .card[hidden] { display: none; }
    .card .name { display: block; font-weight: 700; }
    .card .role,
    .card .email { display: block; color: var(--np-text-secondary); }
    .card .email { overflow-wrap: anywhere; }
    .card .open {
      margin-top: var(--np-space-8);
      padding: 0;
      border: 0;
      background: none;
      color: var(--np-accent-ink);
      font: inherit;
      text-decoration: underline;
      cursor: pointer;
    }
    .card .open:focus-visible {
      outline: var(--np-focus-ring-width, 2px) solid var(--np-focus-ring-color);
      outline-offset: 2px;
    }
    .card ul { margin: 0; padding-left: var(--np-space-16); }
  </style>
  <span class="stack" part="stack"></span>
  <div class="card" part="card" role="dialog" hidden></div>
`;

export class NpResourceStack extends HTMLElement {
    static get observedAttributes() { return ['names', 'max', 'size']; }

    constructor() {
        super();
        const root = this.attachShadow({ mode: 'open' });
        root.appendChild(TEMPLATE.content.cloneNode(true));
        this._stack = root.querySelector('.stack');
        this._card = root.querySelector('.card');
        this._names = [];
        this._details = {};

        this.addEventListener('focusout', (event) => {
            if (!this.contains(event.relatedTarget) && !this.shadowRoot.contains(event.relatedTarget)) {
                this._hideCard();
            }
        });
        this.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !this._card.hidden) {
                event.stopPropagation();
                this._hideCard();
            }
        });
    }

    connectedCallback() { this._render(); }
    attributeChangedCallback(name, _old, value) {
        if (name === 'names') {
            this._names = String(value || '').split(',').map((n) => n.trim()).filter(Boolean);
        }
        this._render();
    }

    get names() { return this._names; }
    set names(value) { this._names = Array.isArray(value) ? value : []; this._render(); }

    get details() { return this._details; }
    set details(value) { this._details = value || {}; this._render(); }

    /** Everything past the cap. Exposed so a caller can label its own chip. */
    get overflow() { return Math.max(0, this._names.length - this._cap()); }

    _cap() {
        const max = Number(this.getAttribute('max'));
        return Number.isFinite(max) && max > 0 ? max : 3;
    }

    _detailsFor(name) {
        const key = String(name || '').toLowerCase();
        for (const [k, v] of Object.entries(this._details)) {
            if (String(k).toLowerCase() === key) return { name, ...v };
            if (v && String(v.name || '').toLowerCase() === key) return { name, ...v };
        }
        return { name };
    }

    _render() {
        if (!this._stack) return;
        const size = this.getAttribute('size');
        if (size) this.style.setProperty('--np-avatar-size', `${Number(size)}px`);

        const cap = this._cap();
        const shown = this._names.slice(0, cap);
        const hidden = this._names.slice(cap);

        const chips = shown.map((name) => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'chip';
            chip.textContent = initialsFor(name);
            chip.setAttribute('aria-label', name);
            chip.addEventListener('mouseenter', () => this._showCard(chip, [name]));
            chip.addEventListener('focus', () => this._showCard(chip, [name]));
            chip.addEventListener('mouseleave', () => this._maybeHide());
            chip.addEventListener('click', (event) => {
                event.stopPropagation();
                this.dispatchEvent(new CustomEvent('resource-activate', {
                    bubbles: true, composed: true, detail: this._detailsFor(name),
                }));
            });
            return chip;
        });

        if (hidden.length) {
            const more = document.createElement('button');
            more.type = 'button';
            more.className = 'chip more';
            more.textContent = `+${hidden.length}`;
            more.setAttribute('aria-label', `${hidden.length} more: ${hidden.join(', ')}`);
            more.addEventListener('mouseenter', () => this._showCard(more, hidden));
            more.addEventListener('focus', () => this._showCard(more, hidden));
            more.addEventListener('mouseleave', () => this._maybeHide());
            more.addEventListener('click', (event) => {
                event.stopPropagation();
                this._showCard(more, hidden);
            });
            chips.push(more);
        }

        this._stack.replaceChildren(...chips);
        this._hideCard();
    }

    _showCard(anchor, names) {
        this._card.replaceChildren();
        this._card.setAttribute('aria-label',
            names.length === 1 ? names[0] : `${names.length} resources`);

        if (names.length === 1) {
            const d = this._detailsFor(names[0]);
            const name = document.createElement('span');
            name.className = 'name';
            name.textContent = d.name;
            this._card.appendChild(name);
            if (d.role) {
                const role = document.createElement('span');
                role.className = 'role';
                role.textContent = d.role;
                this._card.appendChild(role);
            }
            // No blank row for a resource with no email.
            if (d.email) {
                const email = document.createElement('span');
                email.className = 'email';
                email.textContent = d.email;
                this._card.appendChild(email);
            }
            const open = document.createElement('button');
            open.type = 'button';
            open.className = 'open';
            open.textContent = 'Resource details';
            open.addEventListener('click', (event) => {
                event.stopPropagation();
                this.dispatchEvent(new CustomEvent('resource-open', {
                    bubbles: true, composed: true, detail: d,
                }));
            });
            this._card.appendChild(open);
        } else {
            // The overflow chip reveals what the cap hid, which is the whole
            // reason it is a control rather than a label.
            const list = document.createElement('ul');
            for (const name of names) {
                const item = document.createElement('li');
                const d = this._detailsFor(name);
                item.textContent = d.role ? `${d.name} — ${d.role}` : d.name;
                list.appendChild(item);
            }
            this._card.appendChild(list);
        }

        this._card.hidden = false;
        this._anchor = anchor;
    }

    _maybeHide() {
        // Focus keeps the card open; only a pointer leaving closes it, so a
        // keyboard user is not racing a mouseleave.
        if (this.shadowRoot.activeElement) return;
        this._hideCard();
    }

    _hideCard() {
        if (this._card) this._card.hidden = true;
        this._anchor = null;
    }
}

if (!customElements.get('np-resource-stack')) {
    customElements.define('np-resource-stack', NpResourceStack);
}
