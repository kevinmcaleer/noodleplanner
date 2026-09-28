/**
 * <np-rag> -- a task's RAG status as one dot.
 *
 * The dot <np-task-row> shows before its people, on its own so a report
 * table's cell can show the same dot as a task row. Before it, the reports
 * painted RAG their own ways: a whole cell filled in hex (Milestones), a
 * 12px dot on one hex palette (Look Ahead), a 14px dot on another
 * (Programme Dependencies), and text in a pill (Up Next). This is one 8px
 * dot on the four status tokens -- --np-success, --np-warning, --np-danger
 * and --np-info -- and a hollow ring when there is no status.
 *
 * The status is the engine's own words ("On track", "Task overdue") or a
 * colour ("green", "amber", "red"); rag.js maps both, and
 * tests/test_np_task_row.mjs holds that table to script.js's
 * ragStatusToColour().
 *
 * Usage:
 *   <script type="module" src="/static/components/rag/np-rag.js"></script>
 *   <np-rag status="On track"></np-rag>
 *   <np-rag status="Task overdue" labelled></np-rag>
 *   <np-rag status="amber" label="Waiting on sign-off"></np-rag>
 *
 * Attributes:
 *   status    the RAG status, or a colour. Anything else is "no status".
 *   done      the task is complete: blue, whatever the status says -- the
 *             colour a ticked task row turns.
 *   label     the words the dot stands for, for its tooltip and screen
 *             readers. Defaults to the status, then "No status".
 *   labelled  shows those words beside the dot, for a table cell with the
 *             room. Without it the dot is an image named "Status: <label>".
 */

import { ragColour } from './rag.js';

export { ragColour };

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
  <style>
    :host {
      display: inline-flex;
      align-items: center;
      gap: var(--np-space-4);
      vertical-align: middle;
      color: inherit;
      font: inherit;
    }
    :host([hidden]) { display: none; }

    .dot {
      flex: 0 0 auto;
      box-sizing: border-box;
      width: var(--np-space-8);
      height: var(--np-space-8);
      border-radius: var(--np-radius-circle);
      border: 1.5px solid var(--np-border-control);
    }
    .dot[data-rag="green"] { background: var(--np-success); border-color: var(--np-success); }
    .dot[data-rag="amber"] { background: var(--np-warning); border-color: var(--np-warning); }
    .dot[data-rag="red"]   { background: var(--np-danger);  border-color: var(--np-danger); }
    .dot[data-rag="blue"]  { background: var(--np-info);    border-color: var(--np-info); }

    .label { white-space: nowrap; }
    .label[hidden] { display: none; }
  </style>
  <span class="dot" part="dot"></span><span class="label" part="label" hidden></span>
`;

export class NpRag extends HTMLElement {
    static get observedAttributes() {
        return ['status', 'done', 'label', 'labelled'];
    }

    constructor() {
        super();
        const root = this.attachShadow({ mode: 'open' });
        root.appendChild(TEMPLATE.content.cloneNode(true));
        this._dot = root.querySelector('.dot');
        this._label = root.querySelector('.label');
        this._render();
    }

    attributeChangedCallback() {
        this._render();
    }

    /** green, amber, red, blue, or '' for no status. */
    get colour() {
        return this.hasAttribute('done') ? 'blue' : ragColour(this.getAttribute('status'));
    }

    _render() {
        const colour = this.colour;
        if (colour) this._dot.dataset.rag = colour; else delete this._dot.dataset.rag;
        const label = this.getAttribute('label') || this.getAttribute('status') || 'No status';
        const labelled = this.hasAttribute('labelled');
        this._label.textContent = label;
        this._label.hidden = !labelled;
        this._dot.title = label;
        if (labelled) {
            // The words are on screen; the dot only repeats them.
            this._dot.removeAttribute('role');
            this._dot.removeAttribute('aria-label');
            this._dot.setAttribute('aria-hidden', 'true');
        } else {
            this._dot.removeAttribute('aria-hidden');
            this._dot.setAttribute('role', 'img');
            this._dot.setAttribute('aria-label', `Status: ${label}`);
        }
    }
}

if (!customElements.get('np-rag')) customElements.define('np-rag', NpRag);
