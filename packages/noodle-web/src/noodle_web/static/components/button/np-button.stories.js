import './np-button.js';

function makeButton({ variant, size, outline, disabled, label, type }) {
  const el = document.createElement('np-button');
  el.setAttribute('variant', variant);
  el.setAttribute('size', size);
  el.setAttribute('type', type);
  if (outline) el.setAttribute('outline', '');
  if (disabled) el.setAttribute('disabled', '');
  el.textContent = label;
  return el;
}

export default {
  title: 'Components/Button',
  render: (args) => makeButton(args),
  argTypes: {
    variant: {
      control: { type: 'select' },
      options: ['primary', 'secondary', 'neutral', 'danger', 'link'],
    },
    size: {
      control: { type: 'select' },
      options: ['small', 'medium', 'large'],
    },
    outline: { control: 'boolean' },
    disabled: { control: 'boolean' },
    type: {
      control: { type: 'select' },
      options: ['button', 'submit', 'reset'],
    },
    label: { control: 'text' },
  },
  args: {
    variant: 'primary',
    size: 'medium',
    outline: false,
    disabled: false,
    type: 'button',
    label: 'Save changes',
  },
};

export const Primary = {
  args: { variant: 'primary', label: 'Save changes' },
};

export const Secondary = {
  args: { variant: 'secondary', label: 'Cancel' },
};

export const Neutral = {
  args: { variant: 'neutral', label: 'Back' },
  parameters: {
    docs: {
      description: {
        story:
          'Covers `.plan-wizard-back-btn` / `.plan-wizard-skip-btn` — a plain bordered button with no accent colour, for a "go back" or "not now" role. Those two classes are already byte-identical to each other once you strip the shared shape; this is that shape.',
      },
    },
  },
};

export const Danger = {
  args: { variant: 'danger', label: 'Delete task' },
};

export const Link = {
  args: { variant: 'link', label: 'View details' },
};

export const PrimaryOutline = {
  name: 'Primary — outline',
  args: { variant: 'primary', outline: true, label: 'Continue' },
};

export const DangerOutline = {
  name: 'Danger — outline',
  args: { variant: 'danger', outline: true, label: 'Remove' },
  parameters: {
    docs: {
      description: {
        story:
          'Covers `.status-bar-fix-btn` and the app\'s hand-rolled `.btn-outline-primary` / `.btn-outline-secondary` classes — a coloured border and text on a transparent background, filling in on hover.',
      },
    },
  },
};

export const Disabled = {
  args: { variant: 'primary', label: 'Saving…', disabled: true },
};

export const Sizes = {
  render: () => {
    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.alignItems = 'center';
    wrap.style.gap = '12px';
    for (const size of ['small', 'medium', 'large']) {
      wrap.appendChild(
        makeButton({ variant: 'primary', size, label: size, type: 'button' }),
      );
    }
    return wrap;
  },
};

/**
 * Every tone at every size, filled and outline — the full grid this
 * component replaces 131 one-off classes with. Use this story to eyeball a
 * combination before wiring it into a view.
 */
export const VariantMatrix = {
  name: 'Variant matrix',
  render: () => {
    const VARIANTS = ['primary', 'secondary', 'neutral', 'danger', 'link'];
    const SIZES = ['small', 'medium', 'large'];

    const table = document.createElement('div');
    table.style.display = 'grid';
    table.style.gridTemplateColumns = `120px repeat(${SIZES.length * 2}, max-content)`;
    table.style.gap = '14px 20px';
    table.style.alignItems = 'center';
    table.style.fontFamily = 'system-ui, sans-serif';
    table.style.fontSize = '12px';

    const headerCell = (text) => {
      const d = document.createElement('div');
      d.textContent = text;
      d.style.color = 'var(--np-text-secondary, #666)';
      d.style.fontWeight = '600';
      return d;
    };

    table.appendChild(headerCell(''));
    for (const size of SIZES) {
      table.appendChild(headerCell(`${size} · filled`));
      table.appendChild(headerCell(`${size} · outline`));
    }

    for (const variant of VARIANTS) {
      table.appendChild(headerCell(variant));
      for (const size of SIZES) {
        table.appendChild(
          makeButton({ variant, size, outline: false, label: variant, type: 'button' }),
        );
        const canOutline = variant === 'primary' || variant === 'danger';
        if (canOutline) {
          table.appendChild(
            makeButton({ variant, size, outline: true, label: variant, type: 'button' }),
          );
        } else {
          const dash = document.createElement('span');
          dash.textContent = '—';
          dash.style.color = 'var(--np-text-muted, #999)';
          table.appendChild(dash);
        }
      }
    }
    return table;
  },
};

/**
 * The plan wizard's three nav buttons, rebuilt from three classes
 * (`.plan-wizard-back-btn`, `.plan-wizard-skip-btn`, `.plan-wizard-next-btn`)
 * down to two variants of one component — see the "Neutral" story for why
 * back/skip collapse into one tone.
 */
export const PlanWizardNavExample = {
  name: 'Example — plan wizard nav',
  render: () => {
    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.gap = '10px';
    wrap.appendChild(makeButton({ variant: 'neutral', size: 'small', label: 'Back', type: 'button' }));
    wrap.appendChild(makeButton({ variant: 'neutral', size: 'small', label: 'Skip', type: 'button' }));
    wrap.appendChild(makeButton({ variant: 'primary', size: 'small', label: 'Next', type: 'button' }));
    return wrap;
  },
};

/**
 * The status bar's bordered "chip" family collapses to one tone at two
 * sizes, plus the outline modifier for its one danger case
 * (`.status-bar-fix-btn`).
 */
export const StatusBarChipExample = {
  name: 'Example — status bar chips',
  render: () => {
    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.alignItems = 'center';
    wrap.style.gap = '10px';
    wrap.appendChild(makeButton({ variant: 'neutral', size: 'medium', label: '⏱ History', type: 'button' }));
    wrap.appendChild(makeButton({ variant: 'neutral', size: 'small', label: '💬', type: 'button' }));
    wrap.appendChild(makeButton({ variant: 'danger', outline: true, size: 'small', label: 'Fix it', type: 'button' }));
    return wrap;
  },
};
