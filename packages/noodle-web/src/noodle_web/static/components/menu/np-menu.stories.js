import './np-menu.js';

/**
 * The whiteboard note's `...` menu, as one object (#1247).
 *
 * It was six imperative `wbAppend*MenuSection()` builders across ~300 lines of
 * whiteboard-notes.js, styled from five separate blocks of
 * views/whiteboard.css, accreting one section per issue since #849. Reviewing
 * its grouping, its destructive treatment or its keyboard model meant reading
 * all six.
 */

const PASTELS = [
    '#FFF3B0', '#FCE38A', '#FFD6E0', '#F7A8B8', '#CFF4D2',
    '#B8E6B8', '#C7E5FF', '#A9D6F5', '#FFCBC1', '#FFAFA3',
];

const noteSections = ({ parent, freeform, colour }) => {
    const structure = [{ id: 'rename', label: 'Rename' }];
    if (parent) structure.push({ id: 'unlink', label: `Unlink from "${parent}"` });
    if (freeform) {
        structure.push({ id: 'promote', label: 'Promote to task', className: 'wb-note-menu-promote' });
    }
    structure.push({ id: 'open-task', label: 'Open task details', className: 'wb-note-menu-open-task' });
    return [
        { items: [{ id: 'default-colour', label: 'Default colour', className: 'wb-note-menu-default' }] },
        { label: 'Colour', swatches: PASTELS, selected: colour },
        { items: structure },
        // Neutral, not destructive: parking relocates the text.
        { items: [{ id: 'park', label: 'Send to parking lot' }] },
        {
            items: [
                { id: 'remove', label: 'Remove from board', destructive: true },
                { id: 'delete', label: 'Delete task', destructive: true, confirms: true },
            ],
        },
    ];
};

const mount = (args) => {
    const menu = document.createElement('np-menu');
    menu.setAttribute('aria-label', 'Note options');
    // The real menu is `position: fixed` and appended to document.body, so it
    // is never clipped by the note's own `overflow: hidden`. In a story it is
    // pinned in flow instead, which is the one difference from the app.
    menu.style.cssText = 'position:static;display:inline-block;';
    menu.sections = noteSections(args);
    menu.addEventListener('select', (e) => console.log('select', e.detail));
    menu.addEventListener('dismiss', () => console.log('dismiss'));
    return menu;
};

export default {
    title: 'Components/Menu',
    render: mount,
    argTypes: {
        parent: { control: 'text' },
        freeform: { control: 'boolean' },
        colour: { control: { type: 'select' }, options: ['', ...PASTELS] },
    },
    args: { parent: 'Phase 1', freeform: false, colour: '#FCE38A' },
};

/** Every item a note can show: nine actions, a ten-swatch grid, four dividers. */
export const Maximal = { args: { parent: 'Phase 1', freeform: true } };

/** A top-level checklist note: no Unlink, no Promote. */
export const Minimal = { args: { parent: '', freeform: false } };

/** The destructive group on its own -- three treatments that must stay
 * distinguishable: neutral parking, red remove, and red-plus-confirm delete. */
export const DestructiveGroup = {
    render: () => {
        const menu = document.createElement('np-menu');
        menu.setAttribute('aria-label', 'Destructive actions');
        menu.style.cssText = 'position:static;display:inline-block;';
        menu.sections = [
            { items: [{ id: 'park', label: 'Send to parking lot' }] },
            {
                items: [
                    { id: 'remove', label: 'Remove from board', destructive: true },
                    { id: 'delete', label: 'Delete task', destructive: true, confirms: true },
                ],
            },
        ];
        return menu;
    },
};
