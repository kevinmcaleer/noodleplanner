/**
 * <np-responsive-table> -- a table that becomes a stack of cards on a phone
 * (#1387, epic #1376).
 *
 * The RAID log, Actions, Milestones, Stakeholders, Budget, Comms, Benefits,
 * Lessons, Resources and the portfolio's tables were each a wide table in a
 * sideways scroller: at 390px a row's title showed and its status was two
 * swipes away. Wrapped in this, a row is a card on a phone:
 *
 *   ┌───────────────────────────────┐
 *   │ Late supplier              ▾  │  the primary column: the card's title
 *   │ Open · 16 · sam               │  the priority 1-3 columns: a meta line
 *   ├───────────────────────────────┤
 *   │ Description  The supplier …   │  every other column, on ▾
 *   │ Raised by    alex             │
 *   └───────────────────────────────┘
 *
 * Tapping the card is tapping the row -- which, in every view that has one,
 * opens that item in its detail sheet (#1383).
 *
 * ## Declaring priority
 *
 * Each column says how much it matters on a phone, on its header:
 *
 *   <th data-priority="primary">Title</th>   the card's title (one column)
 *   <th data-priority="1">Status</th>        the meta line, in order (1-3)
 *   <th>Description</th>                     behind ▾ (the default)
 *   <th data-priority="none">Actions</th>    never on the card
 *
 * A table built by script can declare them on the host instead, by header
 * text: `<np-responsive-table priorities='{"Title": "primary", "Status": "1"}'>`.
 *
 * ## Why the table is restyled, not rebuilt
 *
 * The cards are the table's own rows and cells, laid out as cards by CSS
 * (np-responsive-table.css, beside this file) -- not copies. Every view wires its rows
 * with listeners (a click opens the item, a right-click its menu, a
 * long-press the same, #1386) and its cells with buttons; a copy would carry
 * none of them. This component only labels the cells with their column's
 * name and priority as rows arrive (a MutationObserver: views redraw their
 * tables wholesale), and adds each card's ▾. Light DOM, like <np-note>, for
 * the same reason: the cells are styled by the app's stylesheets.
 *
 * ## When it stacks
 *
 * `stacked` is set while the app's layout is a phone (layout-mode.js's
 * `data-layout`, so Settings -> Layout's override reaches it too); `stack=
 * "always"` stacks regardless, for a narrow panel or a story.
 */

const EXPAND_CLASS = 'np-rt-expand';

function headerCells(table) {
    const head = table.tHead && table.tHead.rows[table.tHead.rows.length - 1];
    return head ? [...head.cells] : [];
}

/** A header's name, without the sort arrow a sorted column adds to it. */
function labelOf(th) {
    if (th.dataset.label) return th.dataset.label;
    if (th.getAttribute('aria-label')) return th.getAttribute('aria-label').trim();
    const text = [...th.childNodes]
        .filter((node) => !(node.nodeType === 1 && (node.matches('.sort-indicator, [aria-hidden="true"]'))))
        .map((node) => node.textContent)
        .join('');
    return text.replace(/\s+/g, ' ').trim();
}

export class NpResponsiveTable extends HTMLElement {
    static get observedAttributes() {
        return ['stack', 'priorities'];
    }

    constructor() {
        super();
        this._observer = new MutationObserver(() => this._schedule());
        this._onLayout = () => this._syncStacked();
        this._frame = null;
    }

    connectedCallback() {
        this._observer.observe(this, { childList: true, subtree: true });
        document.addEventListener('layoutchange', this._onLayout);
        this._syncStacked();
        this._label();
        // A tap on ▾ opens the card's details; a tap anywhere else on a card
        // is the row's own click. Captured at the host, so the row -- whose
        // own click would open the item -- never sees a tap on ▾.
        if (!this._wired) {
            this._wired = true;
            this.addEventListener('click', (event) => {
                const button = event.target.closest && event.target.closest(`.${EXPAND_CLASS}`);
                if (!button || !this.contains(button)) return;
                event.stopPropagation();
                const row = button.closest('tr');
                const open = !row.classList.contains('np-rt-open');
                row.classList.toggle('np-rt-open', open);
                button.setAttribute('aria-expanded', String(open));
                button.setAttribute('aria-label', `${open ? 'Hide' : 'Show'} the details of ${button.dataset.title}`);
            }, true);
        }
    }

    disconnectedCallback() {
        this._observer.disconnect();
        document.removeEventListener('layoutchange', this._onLayout);
    }

    attributeChangedCallback() {
        if (!this.isConnected) return;
        this._syncStacked();
        this._label();
    }

    get table() {
        return this.querySelector('table');
    }

    _syncStacked() {
        const phone = document.documentElement.dataset.layout === 'phone';
        this.toggleAttribute('stacked', this.getAttribute('stack') === 'always' || phone);
    }

    _schedule() {
        if (this._frame) return;
        this._frame = requestAnimationFrame(() => {
            this._frame = null;
            this._label();
        });
    }

    _priorities() {
        try {
            const map = JSON.parse(this.getAttribute('priorities') || '{}');
            return map && typeof map === 'object' ? map : {};
        } catch (_) {
            return {};
        }
    }

    /** Label every body cell with its column's name and priority. */
    _label() {
        const table = this.table;
        if (!table) return;
        const byText = this._priorities();
        const columns = headerCells(table).map((th) => ({
            label: labelOf(th),
            priority: th.dataset.priority || byText[labelOf(th)] || 'detail',
            span: th.colSpan || 1,
        }));
        if (!columns.length) return;
        // Expand colspans so a body cell's index finds its column.
        const byIndex = columns.flatMap((column) => Array(column.span).fill(column));
        const hasDetail = byIndex.some((column) => column.priority === 'detail');
        // Pause the observer while writing, or labelling would trigger itself.
        this._observer.disconnect();
        for (const body of table.tBodies) {
            for (const row of body.rows) {
                // A full-width row (an empty state, a group heading) is left
                // to span the card.
                if (row.cells.length === 1 && byIndex.length > 1) {
                    row.dataset.rtFull = '';
                    continue;
                }
                let index = 0;
                let primary = null;
                for (const cell of row.cells) {
                    const column = byIndex[index] || { label: '', priority: 'detail' };
                    if (cell.dataset.label !== column.label) cell.dataset.label = column.label;
                    if (cell.dataset.priority !== column.priority) cell.dataset.priority = column.priority;
                    if (column.priority === 'primary') primary = cell;
                    index += cell.colSpan || 1;
                }
                if (primary && hasDetail && !primary.querySelector(`:scope > .${EXPAND_CLASS}`)) {
                    const title = primary.textContent.replace(/\s+/g, ' ').trim();
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = EXPAND_CLASS;
                    button.dataset.title = title;
                    button.setAttribute('aria-expanded', String(row.classList.contains('np-rt-open')));
                    button.setAttribute('aria-label', `Show the details of ${title}`);
                    button.innerHTML =
                        '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" ' +
                        'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
                        '<path d="M4 6l4 4 4-4"/></svg>';
                    primary.appendChild(button);
                }
            }
        }
        this._observer.observe(this, { childList: true, subtree: true });
    }
}

if (!customElements.get('np-responsive-table')) {
    customElements.define('np-responsive-table', NpResponsiveTable);
}
