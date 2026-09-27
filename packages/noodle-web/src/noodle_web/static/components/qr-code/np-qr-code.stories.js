import './np-qr-code.js';

const QrCode = {
  title: 'Components/QrCode',
  render: ({ value, label, size }) => {
    const code = document.createElement('np-qr-code');
    code.setAttribute('value', value);
    code.setAttribute('label', label);
    code.setAttribute('size', String(size));
    return code;
  },
  argTypes: {
    value: { control: 'text' },
    label: { control: 'text' },
    size: { control: { type: 'number' } },
  },
  args: {
    value: 'https://noodleplanner.example/join#code=482913',
    label: 'Scan to join on a phone',
    size: 176,
  },
  parameters: {
    docs: {
      description: {
        component:
          'A QR code for a link (#1389): the planning session\'s join link, so a phone joins by ' +
          'pointing its camera at the host\'s screen. Dark modules on light paper in both themes ' +
          '(--np-qr-ink, --np-qr-paper), as a camera reads best, with the standard four-module ' +
          'quiet zone.',
      },
    },
  },
};
export default QrCode;

export const JoinLink = { name: 'A session\'s join link' };
export const Small = { args: { size: 120 } };
