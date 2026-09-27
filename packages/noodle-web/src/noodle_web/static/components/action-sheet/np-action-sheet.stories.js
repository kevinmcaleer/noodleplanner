import './np-action-sheet.js';

const ActionSheet = {
  title: 'Components/ActionSheet',
  render: ({ open, heading, withToolbar }) => {
    const sheet = document.createElement('np-action-sheet');
    sheet.heading = heading;
    sheet.toolbar = withToolbar ? [
      { id: 'undo', label: 'Undo', icon: 'refresh' },
      { id: 'redo', label: 'Redo', icon: 'refresh', disabled: true },
    ] : [];
    sheet.sections = [
      { id: 'gantt', label: 'Gantt Tools', items: [
        { id: 'critical', label: 'Critical Path', help: 'Highlight the tasks that set the finish date', icon: 'flag', active: true },
        { id: 'baseline', label: 'Baseline', help: 'Save, show or clear a baseline', icon: 'target', active: false },
        { id: 'heat', label: 'Heat Map', help: 'Not available yet', icon: 'grid', disabled: true },
      ] },
      { id: 'home', label: 'Home', items: [
        { id: 'new-task', label: 'New Task', icon: 'add' },
        { id: 'delete', label: 'Delete', icon: 'delete', destructive: true },
      ] },
    ];
    sheet.addEventListener('select', (e) => console.log('np-action-sheet: select', e.detail.id));
    if (open) requestAnimationFrame(() => sheet.open());
    const frame = document.createElement('div');
    frame.style.cssText = 'height: 640px;';
    const opener = document.createElement('button');
    opener.type = 'button';
    opener.textContent = 'Open the sheet';
    opener.addEventListener('click', () => sheet.open(opener));
    frame.append(opener, sheet);
    return frame;
  },
  argTypes: {
    open: { control: 'boolean' },
    heading: { control: 'text' },
    withToolbar: { control: 'boolean' },
  },
  args: { open: true, heading: 'Commands', withToolbar: true },
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'A list of actions that slides up from the bottom of a phone (#1382): the ribbon\'s ' +
          'commands, the plan switcher, a task row\'s actions. Every item shows its help as a second ' +
          'line instead of a hover-only tooltip; pressed and unavailable states are shown, not hidden.',
      },
    },
  },
};
export default ActionSheet;

export const Commands = {};
export const PlanSwitcher = {
  render: (args) => {
    const frame = ActionSheet.render({ ...args, withToolbar: false });
    const sheet = frame.querySelector('np-action-sheet');
    sheet.sections = [
      { id: 'projects', items: [
        { id: 'p1', label: 'Website Redesign 2026', icon: 'project-report', active: true },
        { id: 'p2', label: 'Office Move', icon: 'project-report', active: false },
      ] },
      { id: 'actions', items: [{ id: 'new', label: 'New plan', icon: 'add' }] },
    ];
    return frame;
  },
  args: { heading: 'Plans' },
};
