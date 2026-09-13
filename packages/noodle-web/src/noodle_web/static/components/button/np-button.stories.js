import './np-button.js';

export default {
  title: 'Components/Button',
  render: ({ variant, disabled, label, type }) => {
    const el = document.createElement('np-button');
    el.setAttribute('variant', variant);
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
    disabled: { control: 'boolean' },
    type: {
      control: { type: 'select' },
      options: ['button', 'submit', 'reset'],
    },
    label: { control: 'text' },
  },
  args: {
    variant: 'primary',
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
