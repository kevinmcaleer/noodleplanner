import './np-notice.js';

const Notice = {
  title: 'Components/Notice',
  render: ({ message, action }) => {
    const frame = document.createElement('div');
    frame.style.cssText = 'width: 358px; max-width: 100%;';
    const notice = document.createElement('np-notice');
    if (action) notice.setAttribute('action', action);
    notice.textContent = message;
    notice.addEventListener('action', () => console.log('np-notice: action'));
    notice.addEventListener('dismiss', () => console.log('np-notice: dismiss'));
    frame.appendChild(notice);
    return frame;
  },
  argTypes: {
    message: { control: 'text' },
    action: { control: 'text' },
  },
  args: { message: 'Gantt is best on a larger screen.', action: 'Open Tasks' },
  parameters: {
    docs: {
      description: {
        component:
          'A short, dismissible note with one action (#1387): on a phone, a view that is best on a ' +
          'larger screen says so and points at the nearest phone-first view, without taking room ' +
          'from the view itself.',
      },
    },
  },
};
export default Notice;

export const LargerScreen = { name: 'Best on a larger screen' };
export const WithoutAnAction = { args: { message: 'Saved to this browser.', action: '' } };
