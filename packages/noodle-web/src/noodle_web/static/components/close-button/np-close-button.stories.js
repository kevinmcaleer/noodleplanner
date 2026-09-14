import './np-close-button.js';

function withBackground(el, background, color) {
  const wrap = document.createElement('div');
  wrap.style.cssText = `display:inline-flex; padding:12px; border-radius:8px; background:${background}; color:${color};`;
  wrap.appendChild(el);
  return wrap;
}

export default {
  title: 'Components/CloseButton',
  render: ({ size, flat, label }) => {
    const el = document.createElement('np-close-button');
    if (size && size !== 'medium') el.setAttribute('size', size);
    if (flat) el.setAttribute('flat', '');
    if (label) el.setAttribute('label', label);
    el.addEventListener('close', () => console.log('np-close-button: close'));
    return el;
  },
  argTypes: {
    size: { control: { type: 'select' }, options: ['small', 'medium'] },
    flat: { control: 'boolean' },
    label: { control: 'text' },
  },
  args: {
    size: 'medium',
    flat: false,
    label: '',
  },
  parameters: {
    docs: {
      description: {
        component:
          'One real `<button>` for every dismiss control in the app (design-system.md §6/§10). Fixes ' +
          'the one non-conformant usage found in the codebase — a `<span onclick>` with no keyboard ' +
          'focus or `aria-label`. `size="small"` matches `.task-peek-close-btn`; the default matches ' +
          '`.close-btn` / `.wb-add-note-close`; `flat` matches `.estimate-popup-close` / ' +
          '`.card-popup-close`\'s bare-glyph look. `color: inherit` on the glyph, so it reads correctly ' +
          'on any surface tone without its own `variant` attribute.',
      },
    },
  },
};

export const Medium = {
  name: 'Medium (default)',
};

export const Small = {
  args: { size: 'small' },
};

export const Flat = {
  name: 'Flat (no hover box)',
  args: { flat: true },
};

export const OnAnAccentSurface = {
  name: 'On an accent surface',
  render: () => {
    const el = document.createElement('np-close-button');
    return withBackground(el, 'var(--np-accent-gradient, linear-gradient(135deg, #EDB52A 0%, #d99f1f 100%))', 'var(--np-on-accent, #23201c)');
  },
  parameters: {
    docs: {
      description: {
        story: '`color: inherit` picks up the surrounding on-accent text colour, the same tone `<np-panel-header variant="accent">` uses.',
      },
    },
  },
};

export const OnADarkToast = {
  name: 'On a dark surface',
  render: () => {
    const el = document.createElement('np-close-button');
    return withBackground(el, '#23201c', '#f4efe6');
  },
};
