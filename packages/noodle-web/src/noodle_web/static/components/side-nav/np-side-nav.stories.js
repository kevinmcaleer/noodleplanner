import './np-side-nav.js';

const SECTIONS = [
  { id: 'home', items: [{ id: 'dashboard', label: 'Dashboard', icon: 'project-report' }] },
  {
    id: 'tables',
    label: 'Tables',
    items: [
      { id: 'plan', label: 'Plan', icon: 'task-list' },
      { id: 'raid', label: 'RAID log', icon: 'raid-log' },
      { id: 'highlights', label: 'Highlight reports', icon: 'highlights' },
      { id: 'lessons', label: 'Lessons learned', icon: 'bulb' },
      { id: 'budget', label: 'Budget', icon: 'money' },
      { id: 'benefits', label: 'Benefits', icon: 'benefits' },
      { id: 'resources', label: 'Resources', icon: 'resources' },
      { id: 'stakeholders', label: 'Stakeholders', icon: 'stakeholders' },
    ],
  },
  {
    id: 'more',
    end: true,
    items: [
      { id: 'guide', label: 'Syntax guide', icon: 'doc' },
      { id: 'settings', label: 'Settings', icon: 'settings' },
    ],
  },
];

function build({ current, collapsed, touch }) {
  const frame = document.createElement('div');
  frame.style.cssText = 'display: flex; height: 560px; border: 1px solid var(--np-border);';
  const nav = document.createElement('np-side-nav');
  const mark = (id) => SECTIONS.map((section) => ({
    ...section,
    items: section.items.map((item) => ({ ...item, current: item.id === id })),
  }));
  nav.sections = mark(current);
  nav.toggleAttribute('collapsed', !!collapsed);
  nav.toggleAttribute('touch', !!touch);
  nav.addEventListener('select', (e) => {
    console.log('np-side-nav: select', e.detail.id);
    nav.sections = mark(e.detail.id);
  });
  nav.addEventListener('toggle', (e) => nav.toggleAttribute('collapsed', e.detail.collapsed));
  frame.appendChild(nav);
  return frame;
}

const SideNav = {
  title: 'Components/SideNav',
  render: build,
  argTypes: {
    current: { control: { type: 'select' }, options: SECTIONS.flatMap((s) => s.items.map((i) => i.id)) },
    collapsed: { control: 'boolean' },
    touch: { control: 'boolean' },
  },
  args: { current: 'plan', collapsed: false, touch: false },
  parameters: {
    docs: {
      description: {
        component:
          'The list of tables down the left of the table views interface: the phone drawer\'s list as a ' +
          'permanent column. `collapsed` is the icon rail a tablet starts on, and `touch` gives every ' +
          'item the 44px target. The button at the top raises `toggle`; the host sets `collapsed`.',
      },
    },
  },
};
export default SideNav;

export const Expanded = {};
export const IconRail = { args: { collapsed: true } };
export const IconRailOnATablet = { name: 'Icon rail on a tablet', args: { collapsed: true, touch: true, current: 'raid' } };
