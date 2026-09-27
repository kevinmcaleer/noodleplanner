import './np-fab.js';

const Fab = {
  title: 'Components/Fab',
  render: ({ label }) => {
    const frame = document.createElement('div');
    frame.style.cssText = 'position: relative; height: 320px; width: 390px; border: 1px solid var(--np-border); transform: translateZ(0);';
    const fab = document.createElement('np-fab');
    fab.setAttribute('label', label);
    fab.addEventListener('click', () => console.log('np-fab: click'));
    frame.appendChild(fab);
    return frame;
  },
  argTypes: { label: { control: 'text' } },
  args: { label: 'New task' },
  parameters: {
    docs: {
      description: {
        component:
          'The phone\'s floating "+" (#1382): the current view\'s main create action -- a task in ' +
          'Tasks or Outline, a card on the Board, an item in the RAID log. 56px, bottom-right, clear ' +
          'of the home indicator. (The frame here is transformed so the fixed button sits inside it.)',
      },
    },
  },
};
export default Fab;

export const NewTask = {};
export const NewRaidItem = { args: { label: 'New RAID item' } };
