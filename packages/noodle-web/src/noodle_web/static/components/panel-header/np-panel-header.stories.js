import './np-panel-header.js';

const PanelHeader = {
  title: 'Components/PanelHeader',
  render: ({ title, subtitle, variant, editable, actions, overflow, back }) => {
    const el = document.createElement('np-panel-header');
    el.setAttribute('title', title);
    if (subtitle) el.setAttribute('subtitle', subtitle);
    if (variant && variant !== 'accent') el.setAttribute('variant', variant);
    if (editable) el.setAttribute('editable', '');
    if (back) el.setAttribute('back', '');
    (actions ? actions.split(',').map((a) => a.trim()).filter(Boolean) : []).forEach((label) => {
      const btn = document.createElement('button');
      btn.slot = 'actions';
      btn.textContent = label;
      btn.style.cssText =
        'background:none;border:1px solid currentColor;border-radius:4px;color:inherit;' +
        'padding:4px 10px;font-size:0.85em;cursor:pointer;';
      el.appendChild(btn);
    });
    (overflow ? overflow.split(',').map((a) => a.trim()).filter(Boolean) : []).forEach((label) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.slot = 'overflow';
      if (/delete/i.test(label)) btn.setAttribute('data-destructive', '');
      btn.textContent = label;
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
    overflow: { control: 'text' },
    back: { control: 'boolean' },
  },
  args: {
    title: 'Task Name',
    subtitle: '',
    variant: 'accent',
    editable: false,
    actions: '',
    overflow: '',
    back: false,
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

export default PanelHeader;

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
          'Matches the Task form header exactly: a single-line contenteditable title (fires ' +
          '`titlechange`; Enter finishes the edit) plus ' +
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

export const OnAPhone = {
  name: 'On a phone (narrow pane)',
  args: {
    title: 'Design the onboarding flow',
    editable: true,
    actions: '🔍 Inspect,📦 Make Deliverable',
  },
  render: (args, context) => {
    const el = PanelHeader.render(args, context);
    const frame = document.createElement('div');
    frame.style.cssText = 'width: 390px; border: 1px solid var(--np-border);';
    frame.appendChild(el);
    return frame;
  },
  parameters: {
    docs: {
      description: {
        story:
          'Below 560px of its own width the title keeps its row and the actions join the ⋯ ' +
          'menu, with anything in the `overflow` slot (#1378, #1383). At 390px the title used to ' +
          'share its row with both actions and broke mid-word.',
      },
    },
  },
};

export const BackWithOverflow = {
  name: 'Full screen: ← Back and the ⋯ menu',
  args: {
    title: 'Edit RAID Item',
    variant: 'neutral',
    back: true,
    overflow: 'Delete item',
  },
  render: (args, context) => OnAPhone.render(args, context),
  parameters: {
    docs: {
      description: {
        story:
          'In a full-screen `<np-detail-sheet>` (a phone, an upright tablet) the close button is ' +
          '← Back and leads the row. Buttons in the `overflow` slot only ever appear in the ⋯ menu; ' +
          '`data-destructive` marks one red.',
      },
    },
  },
};
