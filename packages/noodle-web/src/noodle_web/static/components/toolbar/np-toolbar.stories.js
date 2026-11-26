import './np-toolbar.js';

const GANTT = [
  {
    id: 'schedule',
    label: 'Schedule',
    items: [
      { id: 'link', label: 'Link', icon: 'link' },
      { id: 'unlink', label: 'Unlink', icon: 'unlink' },
      { id: 'critical', label: 'Critical Path', icon: 'target', active: true },
      { id: 'baseline', label: 'Baseline', icon: 'clock', active: false },
    ],
  },
  {
    id: 'scale',
    label: 'Scale',
    items: [
      { id: 'days', label: 'Days', icon: 'calendar', active: false },
      { id: 'weeks', label: 'Weeks', icon: 'grid', active: true },
      { id: 'months', label: 'Months', icon: 'timeline', active: false },
    ],
  },
  {
    id: 'highlight',
    label: 'Editor Highlighting',
    items: [{ id: 'preset', label: 'Highlight Preset', icon: 'pin', caret: true }],
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: 'project-report',
    menu: true,
    items: [
      { id: 'report:project', label: 'Project Report', icon: 'project-report' },
      { id: 'report:highlights', label: 'Highlights', icon: 'highlights' },
      { id: 'report:analysis', label: 'Analysis', icon: 'chart' },
      { id: 'report:slippage', label: 'Slippage', icon: 'flag' },
    ],
  },
  { id: 'export', label: 'Export', icon: 'download', menu: true, items: [
    { id: 'export:xlsx', label: 'Excel (.xlsx)' }, { id: 'export:pdf', label: 'PDF' }, { id: 'export:pptx', label: 'PowerPoint' },
  ] },
];

function build({ width, touch }) {
  const frame = document.createElement('div');
  frame.style.cssText = `width: ${width}px; height: 260px; border: 1px solid var(--np-border); background: var(--np-surface);`;
  const toolbar = document.createElement('np-toolbar');
  toolbar.groups = GANTT;
  toolbar.toggleAttribute('touch', !!touch);
  toolbar.addEventListener('select', (e) => {
    console.log('np-toolbar: select', e.detail.id);
    if (e.detail.id === 'preset') {
      toolbar.openMenu('preset', [
        { id: 'preset:all', label: 'Everything', active: true },
        { id: 'preset:dates', label: 'Dates only', active: false },
        { id: 'preset:none', label: 'Nothing', active: false },
      ]);
    }
  });
  frame.appendChild(toolbar);
  return frame;
}

const Toolbar = {
  title: 'Components/Toolbar',
  render: build,
  argTypes: { width: { control: { type: 'range', min: 320, max: 1100, step: 10 } }, touch: { control: 'boolean' } },
  args: { width: 900, touch: false },
  parameters: {
    docs: {
      description: {
        component:
          'One row of commands for the open view, for the table views interface: the view\'s commands as ' +
          'labelled buttons in their groups, and standing menus (Reports, Export) pinned to the end. ' +
          'Pressed toggles take the accent tint. When the buttons do not fit, the strip scrolls and fades ' +
          'at the edge with more. A `caret` button raises `select`; the host answers with `openMenu()`.',
      },
    },
  },
};
export default Toolbar;

export const GanttTools = {};
export const Narrow = { name: 'Narrow: the strip scrolls', args: { width: 480 } };
export const Touch = { name: 'On a tablet (44px targets)', args: { width: 760, touch: true } };
