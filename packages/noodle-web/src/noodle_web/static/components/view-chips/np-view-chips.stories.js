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
