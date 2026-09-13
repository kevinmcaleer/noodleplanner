import './np-button.js';

export default {
  title: 'Components/Button',
  render: ({ variant, size, disabled, label, type }) => {
    const el = document.createElement('np-button');
    el.setAttribute('variant', variant);
    el.setAttribute('size', size);
    el.setAttribute('type', type);
    if (disabled) el.setAttribute('disabled', '');
    el.textContent = label;
    return el;
  },
  argTypes: {
    variant: {
      control: { type: 'select' },
      options: ['primary', 'secondary', 'danger', 'link'],
    },
    size: {
      control: { type: 'select' },
      options: ['small', 'medium', 'large'],
    },
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

export const Danger = {
  args: { variant: 'danger', label: 'Delete task' },
};

export const Link = {
  args: { variant: 'link', label: 'View details' },
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
      const el = document.createElement('np-button');
      el.setAttribute('variant', 'primary');
      el.setAttribute('size', size);
      el.textContent = size;
      wrap.appendChild(el);
    }
    return wrap;
  },
};
