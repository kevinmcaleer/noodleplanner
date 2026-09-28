import './np-rag.js';

/**
 * A task's RAG status as one dot: the dot <np-task-row> shows, and the RAG
 * cell of a report table. Four status tokens and a hollow "no status" ring,
 * from the engine's own words or a colour.
 */

const mount = (args) => {
    const el = document.createElement('np-rag');
    for (const [key, value] of Object.entries(args)) {
        if (value === false || value === null || value === undefined || value === '') continue;
        el.setAttribute(key, value === true ? '' : String(value));
    }
    return el;
};

export default {
    title: 'Components/Rag',
    render: mount,
    argTypes: {
        status: {
            control: { type: 'select' },
            options: ['', 'Not started', 'On track', 'Ahead of schedule', 'Behind schedule', 'Task overdue',
                'Complete', 'green', 'amber', 'red'],
        },
        done: { control: 'boolean' },
        label: { control: 'text' },
        labelled: { control: 'boolean' },
    },
    args: { status: 'On track', done: false, label: '', labelled: false },
};

export const Dot = {};

/** With the words beside it, as a report table's RAG column shows it. */
export const Labelled = { args: { labelled: true } };

/** No status yet: a hollow ring, named "No status". */
export const NoStatus = { args: { status: '', labelled: true } };

/** A ticked task is blue whatever its status says. */
export const Done = { args: { status: 'Behind schedule', done: true, label: 'Complete', labelled: true } };

/** Every status the engine reports, and the colours older plans hold. */
export const AllStatuses = {
    render: () => {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:grid;grid-template-columns:repeat(3,max-content);gap:12px 32px;'
            + 'font:14px/1.4 var(--np-font-ui);color:var(--np-body);';
        for (const status of ['Not started', 'On track', 'Ahead of schedule', 'Behind schedule',
            'Task overdue', 'Complete', 'green', 'amber', 'red', '']) {
            wrap.appendChild(mount({ status, labelled: true }));
        }
        return wrap;
    },
};
