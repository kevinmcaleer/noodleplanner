/**
 * <np-menu> -- the app's overflow menu (issue #1247, epic #1241).
 *
 * The whiteboard note's `...` menu is the one part of the note that was
 * already well behaved: safe-bounds clamping, Escape-to-close-and-refocus,
 * outside-click teardown, arrow traversal. None of it was reusable. Six
 * imperative `wbAppend*MenuSection()` builders spanning ~300 lines of
 * whiteboard-notes.js, styled from five separate blocks of
 * views/whiteboard.css, and one section per issue since #849.
 *
 * This is the same menu expressed as data, so it can be reviewed as one
 * object -- grouping, dividers, destructive treatment, keyboard model -- rather
 * than read back out of six call sites.
 *
 * ## Items are data
 *
 * Sections emit their own dividers. Callers used to append a bare separator
 * `<li>` themselves, in three different places, which is why the menu ended up
 * with `Promote` and `Open task details` sharing a group with `Rename` and
 * `Unlink`: two of the six builders simply never appended one.
 *
 *   menu.sections = [
 *     { items: [{ id: 'default-colour', label: 'Default colour' }] },
 *     { label: 'Colour', swatches: [...], selected: '#FCE38A' },
 *     { items: [{ id: 'rename', label: 'Rename' }] },
 *     { items: [
 *         { id: 'park', label: 'Send to parking lot' },
 *       ] },
 *     { items: [
 *         { id: 'remove', label: 'Remove from board', destructive: true },
 *         { id: 'delete',  label: 'Delete task', destructive: true, confirms: true },
 *       ] },
 *   ]
 *
 * ## Destructive is a flag, not a class name
 *
 * The shipping menu carries a three-way distinction that is easy to lose and
 * expensive to lose: `Remove from board` is red; `Delete task` is red *and*
 * confirms; `Send to parking lot` is deliberately neutral, because parking
 * relocates the text rather than destroying it -- whiteboard-notes.js says so
 * in a comment, which is the only thing that was protecting it. Here it is
 * `destructive` and `confirms` on the item, so tidying the menu cannot quietly
 * restyle parking as a delete.
 *
 * ## Keyboard
 *
 * The swatch grid is a grid. The menu it came from collected every
 * `[role="menuitem"]` into one flat ring and stepped one at a time, so on a
 * full note ArrowDown from `Default colour` walked all ten swatches before
 * reaching `Rename`, and the grid's six columns were invisible to the
 * keyboard. Left/Right move within a swatch row, Up/Down between rows and
 * between groups. Home/End go to the ends. Tab closes -- every item is a real
 * button and nothing intercepted Tab, so focus could leave an open menu and
 * leave it open.
 *
 * Swatches are `menuitemradio`, not `menuitem` carrying `aria-checked`, which
 * is not a supported combination and meant the selected colour was never
 * announced.
 *
 * ## Emits
 *
 * `select` with `{ id }` for an action, or `{ id: 'colour', colour }` for a
 * swatch. The component never acts: the whiteboard's own menu actions open
 * confirmations and rewrite markdown, and a component that reached for those
 * could not be rendered in Storybook.
 */

import { MENU_LAYOUT } from './menu-layout.js';

const MARKUP = `
  <ul class="wb-note-menu-list" part="list"></ul>
`;

let TEMPLATE = null;
function template() {
    if (!TEMPLATE) {
        TEMPLATE = document.createElement('template');
        TEMPLATE.innerHTML = MARKUP;
    }
    return TEMPLATE;
}

export class NpMenu extends HTMLElement {
    constructor() {
        super();
        this._sections = [];
        // Light DOM, for the same reason <np-note> is: this menu is styled by
        // the app's own `.wb-note-menu-*` rules, and the whiteboard's tests and
        // the ribbon find its items by those class names.
        this.addEventListener('keydown', (e) => this._onKeydown(e));
    }

    connectedCallback() {
        if (!this.hasAttribute('role')) this.setAttribute('role', 'menu');
        this.classList.add('wb-note-menu');
        this._render();
    }

    get sections() { return this._sections; }
    set sections(value) { this._sections = Array.isArray(value) ? value : []; this._render(); }

    /** Every focusable choice, in DOM order. */
    get items() {
        return Array.from(this.querySelectorAll(
            '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]'));
    }

    _render() {
        if (!this.isConnected) return;
        const list = this.querySelector('.wb-note-menu-list')
            || template().content.cloneNode(true).querySelector('.wb-note-menu-list');
        list.replaceChildren();
        // `role="none"` on the list and its items: the menu's children must be
        // menu items, and an unowned `list`/`listitem` sat between them before.
        list.setAttribute('role', 'none');

        this._sections.forEach((section, index) => {
            if (index > 0) {
                const divider = document.createElement('li');
                divider.className = 'wb-note-menu-divider';
                divider.setAttribute('role', 'separator');
                list.appendChild(divider);
            }
            if (section.label) {
                const label = document.createElement('li');
                label.className = 'wb-note-menu-label';
                label.setAttribute('role', 'none');
                label.textContent = section.label;
                list.appendChild(label);
            }
            if (section.swatches) {
                list.appendChild(this._buildSwatchGrid(section));
                return;
            }
            for (const item of section.items || []) {
                list.appendChild(this._buildItem(item));
            }
        });

        if (!list.isConnected) this.appendChild(list);
    }

    _buildItem(item) {
        const li = document.createElement('li');
        li.setAttribute('role', 'none');
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('role', 'menuitem');
        // The class names the app's own stylesheet and tests use. `data-action`
        // is the stable hook: four of these classes render identically, and the
        // only reason they are different names is that one of them is how a
        // caller finds one specific item.
        button.className = item.destructive
            ? (item.confirms ? 'wb-note-menu-remove wb-note-menu-delete' : 'wb-note-menu-remove')
            : (item.className || 'wb-note-menu-action');
        button.dataset.action = item.id;
        button.textContent = item.label;
        if (item.description) button.title = item.description;
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            this.dispatchEvent(new CustomEvent('select', {
                bubbles: true, composed: true, detail: { id: item.id },
            }));
        });
        li.appendChild(button);
        return li;
    }

    _buildSwatchGrid(section) {
        const li = document.createElement('li');
        li.setAttribute('role', 'none');
        const grid = document.createElement('div');
        grid.className = 'wb-note-menu-grid';
        grid.setAttribute('role', 'group');
        if (section.label) grid.setAttribute('aria-label', section.label);
        const current = String(section.selected || '').toLowerCase();
        for (const colour of section.swatches) {
            const selected = String(colour).toLowerCase() === current;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'wb-note-menu-swatch';
            // menuitemradio, not menuitem + aria-checked, which is not a
            // supported combination -- so the selected colour was never
            // announced at all.
            button.setAttribute('role', 'menuitemradio');
            button.setAttribute('aria-checked', selected ? 'true' : 'false');
            button.title = colour;
            button.style.background = colour;
            button.dataset.colour = colour;
            if (selected) {
                const check = document.createElement('span');
                check.className = 'wb-note-menu-swatch-check';
                check.textContent = '✓';
                if (section.checkColour) check.style.color = section.checkColour(colour);
                button.appendChild(check);
            }
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                this.dispatchEvent(new CustomEvent('select', {
                    bubbles: true, composed: true, detail: { id: 'colour', colour },
                }));
            });
            grid.appendChild(button);
        }
        li.appendChild(grid);
        return li;
    }

    _onKeydown(event) {
        const items = this.items;
        if (!items.length) return;
        const index = items.indexOf(document.activeElement);

        if (event.key === 'Escape' || event.key === 'Tab') {
            // Tab included: every item is a real button and nothing used to
            // intercept it, so focus could walk out of an open menu and leave
            // it open behind.
            this.dispatchEvent(new CustomEvent('dismiss', { bubbles: true, composed: true }));
            return;
        }

        const grid = document.activeElement && document.activeElement.closest('.wb-note-menu-grid');
        const move = (to) => {
            event.preventDefault();
            items[Math.max(0, Math.min(items.length - 1, to))].focus();
        };

        if (event.key === 'Home') return move(0);
        if (event.key === 'End') return move(items.length - 1);

        if (grid && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
            // Within a swatch row.
            return move(index + (event.key === 'ArrowRight' ? 1 : -1));
        }
        if (grid && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
            // Between rows of the grid -- a real row, not one step. The menu
            // this came from stepped one swatch at a time in every direction,
            // so its six columns were invisible to the keyboard.
            const swatches = Array.from(grid.querySelectorAll('[role="menuitemradio"]'));
            const columns = MENU_LAYOUT.swatchColumns;
            const within = swatches.indexOf(document.activeElement);
            const next = within + (event.key === 'ArrowDown' ? columns : -columns);
            if (next >= 0 && next < swatches.length) {
                event.preventDefault();
                swatches[next].focus();
                return;
            }
            // Off the top or the bottom of the grid: leave it for the item
            // before or after.
            const edge = event.key === 'ArrowDown'
                ? items.indexOf(swatches[swatches.length - 1]) + 1
                : items.indexOf(swatches[0]) - 1;
            return move(edge);
        }

        if (event.key === 'ArrowDown') return move(index < 0 ? 0 : index + 1);
        if (event.key === 'ArrowUp') return move(index < 0 ? items.length - 1 : index - 1);
    }
}

if (typeof customElements !== 'undefined' && !customElements.get('np-menu')) {
    customElements.define('np-menu', NpMenu);
}
