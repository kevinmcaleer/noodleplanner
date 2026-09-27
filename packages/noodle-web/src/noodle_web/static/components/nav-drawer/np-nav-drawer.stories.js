import './np-nav-drawer.js';

const SECTIONS = [
  { id: 'scope', label: 'Scope', kind: 'segmented', items: [
    { id: 'scope:project', label: 'Project', current: true },
    { id: 'scope:programme', label: 'Programme' },
    { id: 'scope:portfolio', label: 'Portfolio' },
  ] },
  { id: 'plan', label: 'Plan', items: [
    { id: 'view:project-report', label: 'Dashboard', icon: 'project-report' },
    { id: 'view:tasks', label: 'Tasks', icon: 'task-list', current: true },
    { id: 'view:notepad', label: 'Outline', icon: 'task-list' },
    { id: 'view:gantt', label: 'Gantt', icon: 'gantt-chart', note: 'Best on a larger screen' },
    { id: 'view:kanban', label: 'Board', icon: 'board' },
  ] },
  { id: 'tracking', label: 'Tracking', items: [
    { id: 'view:raid', label: 'RAID Log', icon: 'raid-log' },
    { id: 'view:actions', label: 'Actions', icon: 'task-list' },
  ] },
  { id: 'more', label: 'Plan', items: [
    { id: 'cmd:messages', label: 'Messages', icon: 'warn', badge: '!', badgeLabel: 'Action needed' },
    { id: 'cmd:settings', label: 'Settings', icon: 'settings' },
  ] },
];

const NavDrawer = {
  title: 'Components/NavDrawer',
  render: ({ open }) => {
    const drawer = document.createElement('np-nav-drawer');
    drawer.heading = 'Noodle Planner';
    drawer.footer = 'App v1.0.0';
    drawer.sections = SECTIONS;
    drawer.addEventListener('select', (e) => console.log('np-nav-drawer: select', e.detail.id));
    if (open) requestAnimationFrame(() => drawer.open());
    const frame = document.createElement('div');
    frame.style.cssText = 'height: 640px;';
    const opener = document.createElement('button');
    opener.type = 'button';
    opener.textContent = 'Open the drawer';
    opener.addEventListener('click', () => drawer.open(opener));
    frame.append(opener, drawer);
    return frame;
  },
  argTypes: { open: { control: 'boolean' } },
  args: { open: true },
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'The phone\'s slide-out navigation (#1380). Data, not markup: the app builds `sections` ' +
          'from the router so no view can go missing. Traps focus while open; Escape, a backdrop ' +
          'tap or a swipe left closes it and hands focus back to its opener.',
      },
    },
  },
};
export default NavDrawer;

export const Open = {};
export const Closed = { args: { open: false } };
