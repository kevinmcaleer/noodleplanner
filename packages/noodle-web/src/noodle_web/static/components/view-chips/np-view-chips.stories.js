import './np-view-chips.js';

const VIEWS = [
  { id: 'project-report', label: 'Dashboard' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'notepad', label: 'Outline' },
  { id: 'kanban', label: 'Board' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'raid', label: 'RAID Log' },
];

const ViewChips = {
  title: 'Components/ViewChips',
  render: ({ active }) => {
    const frame = document.createElement('div');
    frame.style.cssText = 'width: 390px; border: 1px solid var(--np-border);';
    const chips = document.createElement('np-view-chips');
    chips.views = VIEWS;
    if (active) chips.setAttribute('active', active);
    chips.addEventListener('select', (e) => {
      console.log('np-view-chips: select', e.detail.id);
      chips.setAttribute('active', e.detail.id);
    });
    frame.appendChild(chips);
    return frame;
  },
  argTypes: {
    active: { control: { type: 'select' }, options: ['', ...VIEWS.map((v) => v.id)] },
  },
  args: { active: 'tasks' },
  parameters: {
    docs: {
      description: {
        component:
          'One-tap view switching under the phone\'s app bar (#1380): the phone-first views ' +
          '(view-catalogue.js, #1387) as a scrolling strip of 44px chips. The current view is ' +
          '`aria-current="page"` and scrolls into view.',
      },
    },
  },
};
export default ViewChips;

export const OnTasks = {};
export const ScrolledToRaid = { args: { active: 'raid' } };

/** The same strip as the whiteboard's Cards / Canvas switch on a phone (#1384). */
export const WhiteboardMode = {
  name: 'As a mode switch (whiteboard)',
  render: ({ active }) => {
    const frame = document.createElement('div');
    frame.style.cssText = 'width: 390px; border: 1px solid var(--np-border);';
    const chips = document.createElement('np-view-chips');
    chips.setAttribute('label', 'Show the whiteboard as');
    chips.views = [{ id: 'cards', label: 'Cards' }, { id: 'canvas', label: 'Canvas' }];
    chips.setAttribute('active', active || 'cards');
    chips.addEventListener('select', (e) => chips.setAttribute('active', e.detail.id));
    frame.appendChild(chips);
    return frame;
  },
  args: { active: 'cards' },
  argTypes: { active: { control: { type: 'select' }, options: ['cards', 'canvas'] } },
};

/** Underlined tabs for the table views bar (table-shell.js): the Plan table's views. */
export const AsTabs = {
  name: 'As tabs (table views)',
  render: ({ active }) => {
    const frame = document.createElement('div');
    frame.style.cssText = 'width: 560px; border-bottom: 1px solid var(--np-border); background: var(--np-surface);';
    const chips = document.createElement('np-view-chips');
    chips.setAttribute('variant', 'tabs');
    chips.setAttribute('label', 'Views of Plan');
    chips.views = [
      { id: 'tasks', label: 'Table' }, { id: 'gantt', label: 'Gantt' }, { id: 'kanban', label: 'Board' },
      { id: 'calendar', label: 'Calendar' }, { id: 'timeline', label: 'Timeline' },
      { id: 'milestones', label: 'Milestones' }, { id: 'pbs', label: 'PBS' },
      { id: 'product-flow', label: 'Product Flow' }, { id: 'mindmap', label: 'Mind Map' },
    ];
    chips.setAttribute('active', active || 'gantt');
    chips.addEventListener('select', (e) => chips.setAttribute('active', e.detail.id));
    frame.appendChild(chips);
    return frame;
  },
  args: { active: 'gantt' },
  argTypes: { active: { control: { type: 'select' }, options: ['tasks', 'gantt', 'kanban', 'calendar', 'timeline', 'milestones', 'pbs', 'product-flow', 'mindmap'] } },
};
