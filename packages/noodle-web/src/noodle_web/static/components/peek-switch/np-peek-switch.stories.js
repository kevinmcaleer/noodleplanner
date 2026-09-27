import './np-peek-switch.js';

export default {
  title: 'Components/PeekSwitch',
  render: ({ value }) => {
    const el = document.createElement('np-peek-switch');
    el.setAttribute('value', value);
    el.addEventListener('peekchange', (event) => console.log('np-peek-switch: peekchange', event.detail.value));
    return el;
  },
  argTypes: {
    value: { control: { type: 'inline-radio' }, options: ['side', 'center', 'full'] },
  },
  args: {
    value: 'side',
  },
  parameters: {
    docs: {
      description: {
        component:
          'How a detail form is shown (#1409), the way Notion opens a database page: a side peek, a ' +
          'centre peek or a full page. `<np-detail-sheet>` puts one at the top left of every form and ' +
          'does the switching; the switch only says which is pressed and raises `peekchange`.',
      },
    },
  },
};

export const SidePeek = {
  name: 'Side peek (default)',
};

export const CenterPeek = {
  args: { value: 'center' },
};

export const FullPage = {
  args: { value: 'full' },
};
