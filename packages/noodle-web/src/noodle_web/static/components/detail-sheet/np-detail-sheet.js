/**
 * <np-detail-sheet> -- one shell for every form in the detail pane (#1383,
 * epic #1376).
 *
 * Twelve entity forms -- task (and milestone), product, RAID, benefits,
 * comms, lessons, budget, stakeholder, action, highlight and resource -- and
 * the pane's other sections were each hand-built HTML sharing only a
 * `.detail-pane-section` class. Each had its own header, its own footer (or
 * none), its actions somewhere in its body, and its own close function, which
 * Escape and a backdrop tap reached only through a switch in script.js that
 * named seven of them (benefits twice). This is the shell they share:
 *
 *   ┌──────────────────────────────┐
 *   │ header    ← / ×, title, ⋯    │  slot="header" (an <np-panel-header>)
 *   ├──────────────────────────────┤
 *   │ body      scrolls            │  default slot (the form's .modal-body)
 *   ├──────────────────────────────┤
 *   │ footer    the main action    │  slot="footer" (.form-actions)
 *   └──────────────────────────────┘
 *
 * Usage:
 *   <np-detail-sheet id="raidFormSection" class="detail-pane-section" close-action="closeRaidForm">
 *     <np-panel-header slot="header" variant="neutral">
 *       <h2 slot="title" id="raidFormTitle">New RAID Item</h2>
 *       <button slot="overflow" data-destructive onclick="confirmDeleteRaidItem()">Delete item</button>
 *     </np-panel-header>
 *     <div class="modal-body">…fields…</div>
 *     <div class="form-actions" slot="footer">…Cancel / Save…</div>
 *   </np-detail-sheet>
 *
 * ## Opening and closing
 *
 * `open()` shows this sheet in the app's #detailPane (openDetailPane()).
 * `requestClose()` is what Escape, a tap on the backdrop, the header's ×
 * or ← and the phone's back all call: it runs the form's own close handler --
 * `sheet.onClose = fn`, or the global function named by `close-action` -- so
 * each form's clean-up (timers, state, returning to where it came from) runs
 * whichever way it was dismissed. With no handler it just closes the pane.
 *
 * ## Presentation
 *
 * #detailPane takes the layout (components.css, [data-layout]): full screen
 * sliding up on a phone, full screen on a portrait tablet, a 600px sheet on
 * the right in landscape and today's side pane on a desktop. When it is full
 * screen, the header's × becomes ← Back.
 *
 * ## Sections
 *
 * `<details data-section="task-schedule">` blocks in the body are collapsible
 * groups of fields. Each remembers whether it was left open (per browser,
 * `noodleplanner:sheet-sections`). Until it has been toggled, a phone opens
 * only the ones marked `data-primary` -- the rest start closed -- and every
 * other layout opens them all.
 *
 * ## The on-screen keyboard
 *
 * `visualViewport` is watched while the module is loaded: the height the
 * keyboard takes is published as `--keyboard-inset` on <html>, which the pane
 * subtracts from its own height, so the header, the field being typed in and
 * the footer stay above the keyboard; the focused field is scrolled into view
 * when the keyboard appears.
 */

import { upgradeProperty } from '../overlay/overlay-kit.js';

const SECTIONS_KEY = 'noodleplanner:sheet-sections';

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
  <style>
    :host {
      flex-direction: column;
      min-height: 0;
      background: var(--np-surface, #fffdf9);
    }
    .body {
      flex: 1 1 auto;
      min-height: 0;
      display: flex;
      flex-direction: column;
    }
    .footer {
      flex: 0 0 auto;
      background: var(--np-surface, #fffdf9);
      border-top: 1px solid var(--np-border, #e3ddd3);
      padding: var(--np-space-12, 12px) var(--np-space-20, 20px);
    }
    .footer.empty { display: none; }
    ::slotted([slot="header"]) { flex: 0 0 auto; }
  </style>
  <slot name="header"></slot>
  <div class="body" part="body"><slot></slot></div>
  <div class="footer" part="footer"><slot name="footer"></slot></div>
`;

function readSections() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SECTIONS_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function writeSection(key, open) {
  const all = readSections();
  all[key] = !!open;
  try {
    localStorage.setItem(SECTIONS_KEY, JSON.stringify(all));
  } catch (_) { /* storage unavailable: the state lasts for the page */ }
}

function layout() {
  return document.documentElement.dataset.layout || 'desktop';
}

/** Full screen: a phone, or a tablet held upright. */
function isFullScreen() {
  const mode = layout();
  if (mode === 'phone') return true;
  return mode === 'tablet' && !!(window.matchMedia && window.matchMedia('(orientation: portrait)').matches);
}

// ---------------------------------------------------------------------------
// The on-screen keyboard, once for every sheet.
// ---------------------------------------------------------------------------
let keyboardWatched = false;
function watchKeyboard() {
  if (keyboardWatched || typeof window === 'undefined' || !window.visualViewport) return;
  keyboardWatched = true;
  const vv = window.visualViewport;
  let last = 0;
  const update = () => {
    const inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    document.documentElement.style.setProperty('--keyboard-inset', inset + 'px');
    // The keyboard just came up: keep the field being typed in on screen.
    if (inset > last) {
      const active = document.activeElement;
      if (active && active.closest && active.closest('np-detail-sheet')) {
        requestAnimationFrame(() => active.scrollIntoView({ block: 'center' }));
      }
    }
    last = inset;
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();
}

export class NpDetailSheet extends HTMLElement {
  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.appendChild(TEMPLATE.content.cloneNode(true));
    this._footer = root.querySelector('.footer');
    this._onClose = null;

    const footerSlot = root.querySelector('slot[name="footer"]');
    const syncFooter = () => this._footer.classList.toggle('empty', footerSlot.assignedElements().length === 0);
    footerSlot.addEventListener('slotchange', syncFooter);
    syncFooter();

    // The header's × (or ←) closes through the form's own handler.
    this.addEventListener('close', (event) => {
      if (event.target === this) return;
      event.stopPropagation();
      this.requestClose();
    });

    // Remember collapsible sections as they are toggled by hand.
    this.addEventListener('toggle', (event) => {
      const details = event.target;
      if (!(details instanceof HTMLDetailsElement) || !details.dataset.section || this._applyingSections) return;
      writeSection(details.dataset.section, details.open);
    }, true);

    this._onLayout = () => this._syncPresentation();
  }

  connectedCallback() {
    upgradeProperty(this, 'onClose');
    watchKeyboard();
    document.addEventListener('layoutchange', this._onLayout);
    if (window.matchMedia && !this._portrait) {
      this._portrait = window.matchMedia('(orientation: portrait)');
      this._portrait.addEventListener?.('change', this._onLayout);
    }
    this._syncPresentation();
  }

  disconnectedCallback() {
    document.removeEventListener('layoutchange', this._onLayout);
  }

  /** The form's close handler; takes precedence over `close-action`. */
  get onClose() { return this._onClose; }
  set onClose(fn) { this._onClose = typeof fn === 'function' ? fn : null; }

  get header() {
    return this.querySelector(':scope > [slot="header"]');
  }

  /** Show this sheet in the detail pane. */
  open() {
    this.applySections();
    this._syncPresentation();
    if (typeof window.openDetailPane === 'function') window.openDetailPane(this.id);
    else this.classList.add('active');
  }

  /** Close as the form would: its own handler, or else just the pane. */
  requestClose() {
    const named = this.getAttribute('close-action');
    const handler = this._onClose || (named && typeof window[named] === 'function' ? window[named] : null);
    if (handler) handler.call(this);
    else if (typeof window.closeDetailPane === 'function') window.closeDetailPane();
    else this.classList.remove('active');
  }

  /** Put each collapsible section in its remembered (or default) state. */
  applySections() {
    const remembered = readSections();
    const phone = layout() === 'phone';
    this._applyingSections = true;
    for (const details of this.querySelectorAll('details[data-section]')) {
      const key = details.dataset.section;
      details.open = typeof remembered[key] === 'boolean'
        ? remembered[key]
        : (!phone || details.hasAttribute('data-primary'));
    }
    // `toggle` is queued, not synchronous: keep ignoring it until it has run.
    setTimeout(() => { this._applyingSections = false; }, 0);
  }

  _syncPresentation() {
    const header = this.header;
    if (header && header.tagName === 'NP-PANEL-HEADER') header.toggleAttribute('back', isFullScreen());
  }
}

if (!customElements.get('np-detail-sheet')) {
  customElements.define('np-detail-sheet', NpDetailSheet);
}
