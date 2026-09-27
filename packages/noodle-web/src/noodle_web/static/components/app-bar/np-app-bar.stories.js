import './np-app-bar.js';
import '../button/np-button.js';

function action(slot, label, icon) {
  const btn = document.createElement('np-button');
  btn.setAttribute('slot', slot);
  btn.setAttribute('variant', 'neutral');
  btn.setAttribute('icon-only', '');
  btn.setAttribute('size', 'large');
  btn.setAttribute('label', label);
  btn.innerHTML = `<svg slot="icon" class="icon" aria-hidden="true"><use href="#icon-${icon}"/></svg>`;
  return btn;
}

const AppBar = {
  title: 'Components/AppBar',
  render: ({ heading, subheading, rag }) => {
    const frame = document.createElement('div');
    frame.style.cssText = 'width: 390px; border: 1px solid var(--np-border);';
    const bar = document.createElement('np-app-bar');
    bar.setAttribute('heading', heading);
    if (subheading) bar.setAttribute('subheading', subheading);
    if (rag) {
      const dot = document.createElement('span');
      dot.setAttribute('slot', 'status');
      dot.className = `status-bar-rag rag-${rag}`;
      dot.setAttribute('role', 'img');
      dot.setAttribute('aria-label', `RAG: ${rag}`);
      bar.appendChild(dot);
    }
    bar.append(action('actions', 'Search', 'search'), action('actions', 'Messages', 'bell'), action('actions', 'Commands', 'more'));
    bar.addEventListener('menu', () => console.log('np-app-bar: menu'));
    bar.addEventListener('title', () => console.log('np-app-bar: title'));
    frame.appendChild(bar);
    return frame;
  },
  argTypes: {
    heading: { control: 'text' },
    subheading: { control: 'text' },
    rag: { control: { type: 'select' }, options: ['', 'green', 'amber', 'red', 'blue'] },
  },
  args: { heading: 'Website Redesign 2026', subheading: 'Tasks', rag: 'green' },
  parameters: {
    docs: {
      description: {
        component:
          'The phone\'s top bar (#1380): ☰ opens the navigation drawer, the plan title opens the ' +
          'plan switcher, and the `actions` slot holds search, messages and ⋯. 56px, every target ' +
          '44px, padded below the notch. It raises `menu` and `title` events and does nothing itself.',
      },
    },
  },
};
export default AppBar;

export const Phone = {};

export const LongTitle = {
  args: { heading: 'Riverside Platform Refresh and Customer Portal Migration', subheading: 'RAID Log', rag: 'amber' },
};

export const NoPlan = {
  args: { heading: '', subheading: '', rag: '' },
};
