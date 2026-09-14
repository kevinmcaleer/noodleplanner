import './np-panel-header.js';

export default {
  title: 'Components/PanelHeader',
  render: ({ title, subtitle, variant, editable, actions }) => {
    const el = document.createElement('np-panel-header');
    el.setAttribute('title', title);
    if (subtitle) el.setAttribute('subtitle', subtitle);
    if (variant && variant !== 'accent') el.setAttribute('variant', variant);
    if (editable) el.setAttribute('editable', '');
    (actions ? actions.split(',').map((a) => a.trim()).filter(Boolean) : []).forEach((label) => {
      const btn = document.createElement('button');
      btn.slot = 'actions';
      btn.textContent = label;
      btn.style.cssText =
        'background:none;border:1px solid currentColor;border-radius:4px;color:inherit;' +
        'padding:4px 10px;font-size:0.85em;cursor:pointer;';
      el.appendChild(btn);
    });
    el.addEventListener('close', () => console.log('np-panel-header: close'));
    el.addEventListener('titlechange', (e) => console.log('np-panel-header: titlechange', e.detail.value));
    return el;
  },
  argTypes: {
    title: { control: 'text' },
    subtitle: { control: 'text' },
    variant: { control: { type: 'select' }, options: ['accent', 'neutral'] },
    editable: { control: 'boolean' },
    actions: { control: 'text' },
  },
  args: {
    title: 'Task Name',
    subtitle: '',
    variant: 'accent',
    editable: false,
    actions: '',
  },
  parameters: {
    docs: {
      description: {
        component:
          'Reconciles `.detail-pane-header` and `.modal-header` (design-system.md §6/§10) into one ' +
          'component. `variant="accent"` matches today\'s drawer headers (Task form, Product form, ' +
          'Task Inspector); `variant="neutral"` matches today\'s dialog headers. Extra buttons go in ' +
          'the `actions` slot, ahead of the always-present close button.',
      },
    },
  },
};

export const Accent = {
  name: 'Accent (drawer)',
  args: {
    title: 'Design the onboarding flow',
  },
};

export const AccentEditable = {
  name: 'Accent, editable title + actions',
  args: {
    title: 'Draft release notes',
    editable: true,
    actions: '🔍 Inspect,📦 Product',
  },
  parameters: {
    docs: {
      description: {
        story:
          'Matches the Task form header exactly: a contenteditable title (fires `titlechange`) plus ' +
          'the Inspect/Product action buttons ahead of the close button.',
      },
    },
  },
};

export const Neutral = {
  name: 'Neutral (dialog)',
  args: {
    title: 'Confirm delete',
    variant: 'neutral',
  },
};

export const NeutralWithActions = {
  name: 'Neutral, with an action button',
  args: {
    title: 'Status Message Log',
    variant: 'neutral',
    actions: '⬇ Save to file',
  },
};

export const WithSubtitle = {
  args: {
    title: 'Task Inspector',
    subtitle: 'Riverside Platform Refresh',
    variant: 'neutral',
  },
};
