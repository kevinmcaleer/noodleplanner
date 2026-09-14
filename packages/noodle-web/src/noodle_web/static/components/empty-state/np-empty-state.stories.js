import './np-empty-state.js';

export default {
  title: 'Components/EmptyState',
  render: ({ heading, variant, dashed, body, icon, actions }) => {
    const el = document.createElement('np-empty-state');
    if (heading) el.setAttribute('heading', heading);
    if (variant && variant !== 'text') el.setAttribute('variant', variant);
    if (dashed) el.setAttribute('dashed', '');

    if (icon) {
      const iconEl = document.createElement('span');
      iconEl.slot = 'icon';
      iconEl.textContent = icon;
      el.appendChild(iconEl);
    }

    (body ? body.split('\n').map((line) => line.trim()).filter(Boolean) : []).forEach((line) => {
      const p = document.createElement('p');
      p.textContent = line;
      el.appendChild(p);
    });

    (actions ? actions.split(',').map((a) => a.trim()).filter(Boolean) : []).forEach((label, index) => {
      const btn = document.createElement('button');
      btn.slot = 'actions';
      btn.textContent = label;
      btn.style.cssText =
        index === 0
          ? 'background:var(--np-accent,#EDB52A);border:1px solid var(--np-accent,#EDB52A);' +
            'color:var(--np-on-accent,#23201c);border-radius:6px;padding:8px 16px;font-size:0.9em;' +
            'font-weight:600;cursor:pointer;'
          : 'background:var(--np-surface-alt,#f4efe6);border:1px solid var(--np-border,#e9ecef);' +
            'color:var(--np-ink,#23201c);border-radius:6px;padding:8px 16px;font-size:0.9em;' +
            'font-weight:600;cursor:pointer;';
      el.appendChild(btn);
    });

    return el;
  },
  argTypes: {
    heading: { control: 'text' },
    variant: { control: { type: 'select' }, options: ['text', 'card'] },
    dashed: { control: 'boolean' },
    body: { control: 'text' },
    icon: { control: 'text' },
    actions: { control: 'text' },
  },
  args: {
    heading: '',
    variant: 'text',
    dashed: false,
    body: '',
    icon: '',
    actions: '',
  },
  parameters: {
    docs: {
      description: {
        component:
          'Consolidates the 19 per-area `*-empty-state` classes design-system.md §6 calls "the ' +
          'strongest single consolidation target in the app" into two tiers: bare inline text, or a ' +
          'card with an optional icon/heading/body/actions. The welcome screen and pre-render ' +
          '`.placeholder-view` family are a deliberately separate, sibling kind of "nothing here" — ' +
          'not covered by this component.',
      },
    },
  },
};

export const Text = {
  name: 'Text (inline, e.g. a table/widget)',
  args: {
    body: 'No upcoming milestones.',
  },
};

export const CardWithHeading = {
  name: 'Card, heading + body + action',
  args: {
    variant: 'card',
    heading: 'RAID Log',
    body: 'Track Risks, Actions, Issues, Decisions, and Dependencies.\nClick "+ Add Item" to get started, or upload an existing RAID log.',
  },
  parameters: {
    docs: {
      description: {
        story: 'Matches `.raid-empty-state` (also reused verbatim for comms, lessons, and escalations today).',
      },
    },
  },
};

export const CardDashed = {
  name: 'Card, dashed border',
  args: {
    variant: 'card',
    dashed: true,
    heading: 'No recent plans yet',
    body: 'Create a new plan or open one to get started.',
  },
  parameters: {
    docs: {
      description: {
        story: 'Matches `.backstage-recent-empty` / `.search-view-empty` — the lighter, boxed-but-not-elevated look.',
      },
    },
  },
};

export const CardWithIconAndActions = {
  name: 'Card, icon + multiple actions',
  args: {
    variant: 'card',
    icon: '📝',
    heading: 'Nothing on the board yet',
    body: "Start with a post-it. Double-click anywhere to add one — each post-it is a task in your plan.",
    actions: 'New post-it,Add an existing task,Add all summary tasks',
  },
  parameters: {
    docs: {
      description: {
        story:
          'Matches `.wb-empty-state` — the richest existing example, a floating card with a primary ' +
          'and two secondary actions.',
      },
    },
  },
};
