import './np-resource-stack.js';

/**
 * #1199's resource smarttag: a profile circle with initials, and a mini
 * profile card on hover or focus carrying name, role, email and a link into
 * the resource details form.
 *
 * It replaces six diameters for one concept (14, 18, 20, 23, 24 and 28px
 * across the note row, the note footer, task peek, the ribbon, the subtask row
 * and kanban), four different caps -- one of them kanban's
 * `:nth-child(n+11) { display: none }`, which hides the eleventh onward with no
 * indication anything was hidden -- and four implementations of one initials
 * algorithm.
 */

const DETAILS = {
    'Sam Smith': { name: 'Sam Smith', role: 'Developer', email: 'sam@example.com', shortname: 'sam' },
    'Jo Lee': { name: 'Jo Lee', role: 'Reviewer', email: 'jo@example.com', shortname: 'jo' },
    // No email: the card renders without a blank row rather than an empty one.
    'Alex Ray': { name: 'Alex Ray', role: 'Designer', shortname: 'al' },
    'Kim Ito': { name: 'Kim Ito', role: 'QA', email: 'kim@example.com', shortname: 'ki' },
    'Ro Patel': { name: 'Ro Patel', role: 'Analyst', email: 'ro@example.com', shortname: 'ro' },
};

const mount = ({ names, max, size }) => {
    const el = document.createElement('np-resource-stack');
    if (max) el.setAttribute('max', String(max));
    if (size) el.setAttribute('size', String(size));
    el.names = names;
    el.details = DETAILS;
    el.addEventListener('resource-open', (e) => console.log('resource-open', e.detail));
    el.addEventListener('resource-activate', (e) => console.log('resource-activate', e.detail));
    // The card is absolutely positioned against the host, so give it room.
    const wrap = document.createElement('div');
    wrap.style.cssText = 'padding:8px 8px 160px;';
    wrap.appendChild(el);
    return wrap;
};

export default {
    title: 'Components/ResourceStack',
    render: mount,
    argTypes: {
        names: { control: 'object' },
        max: { control: { type: 'number' } },
        size: { control: { type: 'number' } },
    },
    args: { names: ['Sam Smith', 'Jo Lee'], max: 3, size: 20 },
};

export const One = { args: { names: ['Sam Smith'] } };
export const Several = { args: { names: ['Sam Smith', 'Jo Lee', 'Alex Ray'] } };

/** Exactly at the cap -- no overflow chip. */
export const AtTheCap = { args: { names: ['Sam Smith', 'Jo Lee', 'Alex Ray'], max: 3 } };

/** Over it. The chip is a control, not a label: opening it lists the names the
 * cap hid, which is the thing kanban's own overflow rule never did. */
export const OverTheCap = {
    args: { names: ['Sam Smith', 'Jo Lee', 'Alex Ray', 'Kim Ito', 'Ro Patel'], max: 3 },
};

/** One-word and empty names, which is where the four copies of the initials
 * algorithm disagreed. "Mary Jane Watson" is MW -- first and *last* word. */
export const AwkwardNames = {
    args: { names: ['Cher', 'Mary Jane Watson', '', 'X'], max: 6 },
};

/** The two sizes the whiteboard note uses: 14px on a checklist row, 20px in
 * the note footer. */
export const Sizes = {
    render: () => {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;gap:32px;align-items:center;padding:8px 8px 160px;';
        for (const size of [14, 20, 28]) {
            const el = document.createElement('np-resource-stack');
            el.setAttribute('size', String(size));
            el.setAttribute('max', '3');
            el.names = ['Sam Smith', 'Jo Lee', 'Alex Ray', 'Kim Ito'];
            el.details = DETAILS;
            wrap.appendChild(el);
        }
        return wrap;
    },
};

/** The ribbon's planning-session participants: people rather than
 * resources, so the card's `role` line is their presence and `card-action`
 * relabels its link. A chip, or that link, opens the session chat. */
export const SessionParticipants = {
    render: () => {
        const el = document.createElement('np-resource-stack');
        el.setAttribute('max', '4');
        el.setAttribute('size', '24');
        el.setAttribute('card-action', 'Open session chat');
        el.names = ['Alex Ray', 'Jo Lee', 'Sam Smith'];
        el.details = {
            'Alex Ray': { name: 'Alex Ray', role: 'Active' },
            'Jo Lee': { name: 'Jo Lee', role: 'Active' },
            'Sam Smith': { name: 'Sam Smith', role: 'Inactive' },
        };
        const wrap = document.createElement('div');
        wrap.style.cssText = 'padding:8px 8px 160px;';
        wrap.appendChild(el);
        return wrap;
    },
};
