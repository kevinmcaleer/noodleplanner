/**
 * Composed forms — the task details form (design-system.md §6 "Composed
 * forms" / §10 step 5).
 *
 * "Storybook renders components at every level of the hierarchy, not just
 * small ones. The full task details form gets its own story, composed from
 * the already-verified button, field, slider and panel-header stories.
 * Two-level payoff: verify each small piece once in its own story, then in
 * the composed story only check the composition (spacing, layout, order) —
 * not whether the slider itself works."
 *
 * `<np-panel-header>` and `<np-button>` are real, already-verified `np-*`
 * components (own Storybook folders: Components/PanelHeader,
 * Components/Button) and are used here as such. "Field" and "slider" are
 * not extracted as `np-*` components yet — the UI inventory's own component
 * tally for this panel lists Text input / Select / Textarea / Form group /
 * Form grid as generic, unextracted pieces — so this composition uses their
 * real markup and classes exactly as `#taskFormSection` (templates/index.html)
 * renders them today, not a stand-in. When field/slider components exist,
 * this story is the one to update in place.
 *
 * A representative subset of the real ~40-field form (Duration, RAG,
 * three-date row, completion %, resources/labels, comment, form actions) —
 * enough field-type variety to check grid/spacing/order, not an exhaustive
 * copy.
 */

import '../panel-header/np-panel-header.js';
import '../button/np-button.js';

function formGroup(labelText, forId, inputEl, hint) {
    const group = document.createElement('div');
    group.className = 'form-group';
    const label = document.createElement('label');
    label.setAttribute('for', forId);
    label.textContent = labelText;
    group.appendChild(label);
    group.appendChild(inputEl);
    if (hint) {
        const small = document.createElement('small');
        small.textContent = hint;
        group.appendChild(small);
    }
    return group;
}

function textInput(id, value, type) {
    const el = document.createElement('input');
    el.type = type || 'text';
    el.id = id;
    if (value !== undefined && value !== null) el.value = value;
    return el;
}

function grid(cols, children) {
    const el = document.createElement('div');
    el.className = cols === 3 ? 'form-grid-3col' : 'form-grid-2col';
    children.forEach((c) => el.appendChild(c));
    return el;
}

function ragDisplay(status, bgColor, reasoning) {
    const wrap = document.createElement('div');
    wrap.className = 'form-group';
    const label = document.createElement('label');
    label.textContent = 'RAG Status';
    wrap.appendChild(label);
    const display = document.createElement('div');
    display.id = 'ragDisplay';
    display.style.cssText = 'padding:8px;border-radius:4px;font-weight:bold;text-align:center;margin-bottom:5px;';
    display.style.backgroundColor = bgColor;
    display.style.color = 'white';
    display.textContent = status;
    wrap.appendChild(display);
    const small = document.createElement('small');
    small.id = 'ragReasoning';
    small.style.cssText = 'display:block;color:var(--np-faint);';
    small.textContent = reasoning;
    wrap.appendChild(small);
    return wrap;
}

function completionField(percent) {
    const group = document.createElement('div');
    group.className = 'form-group';
    const label = document.createElement('label');
    label.setAttribute('for', 'taskPercent');
    label.textContent = 'Completion %';
    group.appendChild(label);

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px;align-items:center;';
    const num = textInput('taskPercent', percent, 'number');
    num.min = '0';
    num.max = '100';
    num.style.cssText = 'width:80px;flex-shrink:0;';
    row.appendChild(num);

    const track = document.createElement('div');
    track.className = 'progress percent-progress-clickable';
    track.title = 'Click to mark 100% complete';
    track.style.cssText = 'flex:1;height:25px;';
    const bar = document.createElement('div');
    bar.className = 'progress-bar progress-bar-striped bg-success';
    bar.setAttribute('role', 'progressbar');
    bar.style.cssText = `width:${percent}%;transition:width 0.3s ease;`;
    const barText = document.createElement('span');
    barText.textContent = percent + '%';
    bar.appendChild(barText);
    track.appendChild(bar);
    row.appendChild(track);
    group.appendChild(row);

    const toolbar = document.createElement('div');
    toolbar.className = 'percent-quick-toolbar';
    toolbar.setAttribute('role', 'group');
    toolbar.setAttribute('aria-label', 'Quick-set completion percentage');
    [0, 25, 50, 75, 100].forEach((v) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'percent-quick-btn';
        btn.textContent = v + '%';
        toolbar.appendChild(btn);
    });
    group.appendChild(toolbar);

    return group;
}

function autocompleteField(labelText, id, value, hint) {
    const group = document.createElement('div');
    group.className = 'form-group';
    const label = document.createElement('label');
    label.setAttribute('for', id);
    label.textContent = labelText;
    group.appendChild(label);
    const container = document.createElement('div');
    container.className = 'autocomplete-container';
    container.appendChild(textInput(id, value));
    const dropdown = document.createElement('div');
    dropdown.className = 'autocomplete-dropdown';
    container.appendChild(dropdown);
    group.appendChild(container);
    if (hint) {
        const small = document.createElement('small');
        small.textContent = hint;
        group.appendChild(small);
    }
    return group;
}

function buildForm(task) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'max-width:600px;border:1px solid var(--np-border);border-radius:var(--np-radius-lg);overflow:hidden;';

    const header = document.createElement('np-panel-header');
    header.setAttribute('variant', 'accent');
    header.setAttribute('editable', '');
    header.setAttribute('title', task.name);
    const inspect = document.createElement('button');
    inspect.slot = 'actions';
    inspect.className = 'task-form-inspect-btn';
    inspect.title = 'Inspect task';
    inspect.textContent = '\u{1F50D} Inspect';
    header.appendChild(inspect);
    wrap.appendChild(header);

    const body = document.createElement('form');
    body.style.cssText = 'padding:var(--np-space-24, 24px);background:var(--np-paper);display:flex;flex-direction:column;gap:var(--np-space-16, 16px);';
    body.addEventListener('submit', (e) => e.preventDefault());

    body.appendChild(
        grid(2, [
            formGroup('Duration (days)', 'taskDuration', textInput('taskDuration', task.duration, 'number'), 'Edit duration or use dates below'),
            ragDisplay(task.ragStatus, task.ragColor, task.ragReasoning),
        ])
    );

    body.appendChild(
        grid(3, [
            formGroup('Start Date', 'taskStartDate', textInput('taskStartDate', task.start, 'date')),
            formGroup('Finish Date', 'taskFinishDate', textInput('taskFinishDate', task.finish, 'date')),
            formGroup('Deadline', 'taskDeadline', textInput('taskDeadline', task.deadline, 'date')),
        ])
    );

    body.appendChild(completionField(task.percent));

    body.appendChild(
        grid(2, [
            autocompleteField('Resources', 'taskResources', task.resources, 'Separate multiple resources with commas'),
            autocompleteField('Labels', 'taskLabels', task.labels, 'Tags/labels for categorization'),
        ])
    );

    const commentGroup = document.createElement('div');
    commentGroup.className = 'form-group';
    const commentLabel = document.createElement('label');
    commentLabel.setAttribute('for', 'taskComment');
    commentLabel.textContent = 'Comment';
    const textarea = document.createElement('textarea');
    textarea.id = 'taskComment';
    textarea.textContent = task.comment;
    commentGroup.appendChild(commentLabel);
    commentGroup.appendChild(textarea);
    body.appendChild(commentGroup);

    const actions = document.createElement('div');
    actions.className = 'form-actions';
    const doneBtn = document.createElement('np-button');
    doneBtn.setAttribute('variant', 'primary');
    doneBtn.textContent = 'Done';
    const deleteBtn = document.createElement('np-button');
    deleteBtn.setAttribute('variant', 'danger');
    deleteBtn.textContent = 'Delete Task';
    actions.appendChild(doneBtn);
    actions.appendChild(deleteBtn);
    body.appendChild(actions);

    wrap.appendChild(body);
    return wrap;
}

export default {
    title: 'Compositions/Task details form',
    render: (args) => buildForm(args),
    parameters: {
        docs: {
            description: {
                component:
                    'design-system.md §6 "Composed forms": verify each small piece once in its own story, ' +
                    'then here only check the composition — spacing, layout, order — not whether any one ' +
                    'field works. Composed from the real `<np-panel-header>` and `<np-button>` components ' +
                    'plus the real `#taskFormSection` field markup (`.form-group`, `.form-grid-2col`/`-3col`, ' +
                    'the completion-% control, the resource/label autocomplete fields) — not a redrawn copy.',
            },
        },
    },
};

export const Default = {
    args: {
        name: 'Design the onboarding flow',
        duration: 5,
        ragStatus: 'On Track',
        ragColor: '#4caf50',
        ragReasoning: 'On track: 40% complete against 45% expected by today',
        start: '2026-09-10',
        finish: '2026-09-17',
        deadline: '',
        percent: 40,
        resources: 'Kevin McAleer, Katie Fox',
        labels: 'UX, Design',
        comment: 'Waiting on user research findings before the final pass.',
    },
};

export const OverdueTask = {
    name: 'Overdue task',
    args: {
        ...Default.args,
        name: 'Migrate billing service',
        ragStatus: 'Task Overdue',
        ragColor: '#f44336',
        ragReasoning: 'Task overdue - no progress reported',
        duration: 3,
        start: '2026-09-01',
        finish: '2026-09-04',
        percent: 0,
        resources: 'Jo Smith',
        labels: 'Backend, Infra',
        comment: 'Blocked on infra review.',
    },
};

export const CompleteTask = {
    name: 'Complete task',
    args: {
        ...Default.args,
        name: 'Ship the landing page redesign',
        ragStatus: 'Complete',
        ragColor: '#1976d2',
        ragReasoning: 'Task is complete',
        duration: 2,
        percent: 100,
        resources: 'Kevin McAleer',
        labels: 'Marketing',
        comment: '',
    },
};
