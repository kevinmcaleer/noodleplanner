import './np-checkbox.js';

/**
 * The app had nine checkbox treatments and no component (#1245). These stories
 * are the state set that did not exist anywhere before -- in particular
 * `indeterminate`, which had no implementation in the app at all, so a
 * whiteboard summary row at 40% rendered pixel-identically to one at 0%.
 */

const mount = (args) => {
    const el = document.createElement('np-checkbox');
    for (const [key, value] of Object.entries(args)) {
        if (value === false || value === null || value === undefined || value === '') continue;
        el.setAttribute(key, value === true ? '' : String(value));
    }
    return el;
};

const grid = (cells) => {
    const wrap = document.createElement('div');
    wrap.style.cssText =
        'display:grid;grid-template-columns:repeat(4,max-content);gap:16px 24px;align-items:center;';
    for (const [label, node] of cells) {
        const caption = document.createElement('span');
        caption.style.cssText = 'font:12px/1 var(--np-font-ui);color:var(--np-text-secondary);';
        caption.textContent = label;
        const cell = document.createElement('div');
        cell.style.cssText = 'display:flex;align-items:center;gap:8px;';
        cell.append(node, caption);
        wrap.appendChild(cell);
    }
    return wrap;
};

export default {
    title: 'Components/Checkbox',
    render: mount,
    argTypes: {
        checked: { control: 'boolean' },
        indeterminate: { control: 'boolean' },
        disabled: { control: 'boolean' },
        dense: { control: 'boolean' },
        row: { control: { type: 'select' }, options: ['leaf', 'summary'] },
        label: { control: 'text' },
    },
    args: { checked: false, indeterminate: false, disabled: false, dense: false, row: 'leaf', label: 'Mark as complete' },
};

export const Unchecked = {};
export const Checked = { args: { checked: true } };

/** Only a summary row may be mixed -- a leaf is one task, done or not. */
export const Indeterminate = { args: { row: 'summary', indeterminate: true } };

export const Disabled = { args: { disabled: true } };
export const DisabledChecked = { args: { disabled: true, checked: true } };
export const DisabledIndeterminate = {
    args: { disabled: true, row: 'summary', indeterminate: true },
};

/** Every state at both sizes, which is the thing to review. */
export const AllStates = {
    render: () => grid([
        ['unchecked', mount({ label: 'unchecked' })],
        ['checked', mount({ checked: true, label: 'checked' })],
        ['mixed', mount({ row: 'summary', indeterminate: true, label: 'mixed' })],
        ['disabled', mount({ disabled: true, label: 'disabled' })],
        ['disabled + checked', mount({ disabled: true, checked: true, label: 'x' })],
        ['disabled + mixed', mount({ disabled: true, row: 'summary', indeterminate: true, label: 'x' })],
        ['dense', mount({ dense: true, label: 'dense' })],
        ['dense + checked', mount({ dense: true, checked: true, label: 'x' })],
        ['dense + mixed', mount({ dense: true, row: 'summary', indeterminate: true, label: 'x' })],
    ]),
};

/**
 * On a note's own surface, not the default one.
 *
 * A note's colour fills the whole card and its text colour is computed per
 * colour, so a control that reads correctly on `--np-surface` may not on a
 * marigold note. Two of the ten shipped pastels here, at the dense size the
 * checklist row uses.
 */
export const OnANoteSurface = {
    render: () => {
        const strip = document.createElement('div');
        strip.style.cssText = 'display:flex;gap:16px;';
        for (const colour of ['#FCE38A', '#A9D6F5', '#FFAFA3']) {
            const card = document.createElement('div');
            card.style.cssText =
                `display:flex;gap:8px;align-items:center;padding:12px;border-radius:8px;`
                + `background:${colour};color:#161616;font:12px/1 var(--np-font-ui);`;
            card.append(
                mount({ dense: true, label: 'x' }),
                mount({ dense: true, checked: true, label: 'x' }),
                mount({ dense: true, row: 'summary', indeterminate: true, label: 'x' }),
            );
            const text = document.createElement('span');
            text.textContent = colour;
            card.appendChild(text);
            strip.appendChild(card);
        }
        return strip;
    },
};
