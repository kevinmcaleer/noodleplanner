import './np-task-row.js';

/**
 * One task, one row: the Penpot "Task row" component (02 . Components), and
 * the replacement for the subtask cards, the dependency table's rows and the
 * product form's activities -- three lists in two forms that had drifted into
 * three different looks for the same thing.
 *
 * Type x Density x State, plus the three lists it replaces composed the way
 * the task and product forms use them.
 */

const log = (el) => {
    for (const type of ['task-open', 'task-toggle', 'task-action', 'task-assign',
        'name-commit', 'name-cancel', 'relation-change', 'collapse-toggle']) {
        el.addEventListener(type, (e) => console.log(type, e.detail));
    }
    return el;
};

const row = (attrs) => {
    const el = document.createElement('np-task-row');
    for (const [k, v] of Object.entries(attrs)) {
        if (v === false || v == null || v === '') continue;
        el.setAttribute(k, v === true ? '' : String(v));
    }
    return log(el);
};

const frame = (width = 480) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = `width:${width}px;max-width:100%;display:flex;flex-direction:column;gap:2px;`;
    return wrap;
};

const panel = (title) => {
    const box = document.createElement('section');
    box.style.cssText = 'width:504px;max-width:100%;box-sizing:border-box;padding:var(--np-space-16) var(--np-space-12);'
        + 'border:1px solid var(--np-border);border-radius:var(--np-radius-card);background:var(--np-surface);'
        + 'display:flex;flex-direction:column;gap:2px;';
    const h = document.createElement('h3');
    h.textContent = title;
    h.style.cssText = 'margin:0 0 var(--np-space-8) var(--np-space-8);font-size:var(--np-text-85);font-weight:var(--np-weight-semibold);';
    box.appendChild(h);
    return box;
};

export default {
    title: 'Components/TaskRow',
    render: (args) => {
        const wrap = frame();
        wrap.appendChild(row(args));
        return wrap;
    },
    argTypes: {
        type: { control: 'inline-radio', options: ['list', 'relation', 'picker', 'outline'] },
        density: { control: 'inline-radio', options: ['regular', 'compact'] },
        percent: { control: { type: 'range', min: 0, max: 100, step: 5 } },
        rag: { control: 'select', options: ['', 'On track', 'Behind schedule', 'Task overdue', 'Complete'] },
        relation: { control: 'inline-radio', options: ['FS', 'SS', 'FF', 'SF'] },
        action: { control: 'inline-radio', options: ['', 'menu', 'remove', 'open'] },
        summary: { control: 'boolean' },
        indeterminate: { control: 'boolean' },
        editing: { control: 'boolean' },
        selected: { control: 'boolean' },
        handle: { control: 'boolean' },
        assignable: { control: 'boolean' },
        readonly: { control: 'boolean' },
        depth: { control: { type: 'number', min: 0, max: 4 } },
    },
    args: {
        type: 'list', density: 'regular', name: 'Draft stakeholder brief', meta: '3 Sep – 9 Sep',
        percent: 0, rag: 'On track', resources: 'Sam Smith', assignable: true, action: 'menu',
    },
};

export const List = {};
export const PartlyDone = { args: { percent: 40 } };
export const Done = { args: { percent: 100 } };
export const Unassigned = { args: { resources: '' } };
export const Summary = {
    args: { name: 'Procurement', meta: '1 Sep – 30 Sep', summary: true, indeterminate: true,
        collapsible: true, count: '2/5', rag: 'Behind schedule', resources: 'Sam Smith, Jo Lee, Alex Ray, Kim Ito' },
};
/** The task peek's rows: a child with children says how many, and its
 * "open" action -- always shown, unlike menu and remove -- drills in. */
export const PeekSummary = {
    args: { density: 'compact', name: 'Sub B', summary: true, count: '2', action: 'open',
        'action-label': 'Sub B has 2 subtasks. Peek subtasks.', meta: '', rag: '', resources: 'Jo Lee',
        assignable: false },
};
export const Editing = { args: { editing: true, name: '', placeholder: 'Enter subtask name...' } };
export const Relation = {
    args: { type: 'relation', 'task-id': '14', name: 'Sign off design', relation: 'FS', lag: '+2d',
        meta: '3 Sep', rag: 'Behind schedule', action: 'remove', resources: 'Jo Lee', assignable: false },
};
export const RelationEditing = { args: { ...Relation.args, editing: true } };
export const Picker = {
    args: { type: 'picker', density: 'compact', 'task-id': '27', name: 'Order hardware',
        meta: '12 – 16 Sep', rag: 'On track', resources: 'Sam Smith', assignable: false, action: '', selected: true },
};
export const Outline = {
    args: { type: 'outline', name: 'Kick-off workshop', meta: '2d', handle: true, rag: '', resources: '',
        assignable: false },
};

/** Every type at both densities, side by side -- the Penpot variant sheet. */
export const Matrix = {
    render: () => {
        const grid = document.createElement('div');
        grid.style.cssText = 'display:grid;grid-template-columns:repeat(2, 480px);gap:var(--np-space-12) var(--np-space-24);';
        const specs = [
            { name: 'Draft stakeholder brief', meta: '3 Sep – 9 Sep', rag: 'green', resources: 'Sam Smith', action: 'menu', handle: true },
            { name: 'Draft stakeholder brief', meta: '3 Sep – 9 Sep', rag: 'green', percent: 40, assignable: true, action: 'menu', handle: true },
            { name: 'Draft stakeholder brief', meta: '3 Sep – 9 Sep', rag: 'green', resources: 'Sam Smith', percent: 100 },
            { name: 'Procurement', meta: '1 Sep – 30 Sep', rag: 'amber', resources: 'Sam Smith, Jo Lee, Alex Ray, Kim Ito', summary: true, indeterminate: true, collapsible: true },
            { type: 'relation', 'task-id': '14', name: 'Sign off design', relation: 'FS', lag: '+2d', meta: '3 Sep', rag: 'amber', resources: 'Jo Lee', action: 'remove' },
            { type: 'relation', 'task-id': '14', name: 'Sign off design', relation: 'FS', lag: '+2d', meta: '3 Sep', rag: 'amber', resources: 'Jo Lee', action: 'remove', editing: true },
            { type: 'picker', 'task-id': '27', name: 'Order hardware', meta: '12 – 16 Sep', rag: 'green', resources: 'Sam Smith' },
            { type: 'picker', 'task-id': '27', name: 'Order hardware', meta: '12 – 16 Sep', rag: 'green', resources: 'Sam Smith', selected: true },
            { type: 'outline', name: 'Kick-off workshop', meta: '2d', handle: true, action: 'menu', collapsible: true },
            { type: 'outline', name: 'Discovery', summary: true, indeterminate: true, collapsible: true, handle: true, action: 'menu' },
        ];
        for (const spec of specs) {
            for (const density of ['regular', 'compact']) grid.appendChild(row({ ...spec, density }));
        }
        return grid;
    },
};

/** The three lists this replaces, composed the way the forms use them. */
export const InUse = {
    render: () => {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:var(--np-space-24);align-items:flex-start;';

        const subtasks = panel('Subtasks');
        subtasks.append(
            row({ name: 'Draft stakeholder brief', meta: '1 Sep – 3 Sep', percent: 100, rag: 'Complete', resources: 'Sam Smith', assignable: true, collapsible: true }),
            row({ name: 'Book workshop venue', meta: '4 Sep – 5 Sep', rag: 'On track', resources: 'Jo Lee', assignable: true, collapsible: true }),
            row({ name: 'Procurement', meta: '8 Sep – 30 Sep', summary: true, indeterminate: true, collapsible: true, rag: 'Behind schedule', resources: 'Sam Smith, Jo Lee, Alex Ray, Kim Ito', assignable: true }),
            row({ name: 'Raise purchase order', meta: '8 Sep – 12 Sep', percent: 40, depth: 1, rag: 'On track', assignable: true, collapsible: true }),
            row({ name: 'Get three quotes', meta: '8 Sep – 10 Sep', percent: 100, depth: 1, rag: 'Complete', resources: 'Alex Ray', assignable: true, collapsible: true }),
        );

        const deps = panel('Dependencies');
        deps.append(
            row({ type: 'relation', 'task-id': '14', name: 'Sign off design', relation: 'FS', lag: '+2d', meta: '3 Sep', rag: 'Behind schedule', action: 'remove' }),
            row({ type: 'relation', 'task-id': '9', name: 'Agree budget', relation: 'SS', meta: '1 Sep', rag: 'On track', action: 'remove' }),
        );

        const activities = panel('Activities');
        activities.append(
            row({ density: 'compact', name: 'Shortlist venues', meta: '1 Sep – 2 Sep', percent: 100, rag: 'Complete', resources: 'Sam Smith', action: 'remove' }),
            row({ density: 'compact', name: 'Site visits', meta: '3 Sep – 5 Sep', percent: 40, rag: 'On track', action: 'remove', resources: '' }),
            row({ density: 'compact', name: 'Sign venue contract', meta: '8 Sep', rag: 'On track', resources: 'Jo Lee', action: 'remove' }),
        );

        wrap.append(subtasks, deps, activities);
        return wrap;
    },
};
