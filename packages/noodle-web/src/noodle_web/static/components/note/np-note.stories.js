import './np-note.js';

const SAMPLE_ROWS = [
  { name: 'Draft the announcement copy', done: true },
  { name: 'Review with legal', done: false },
  { name: 'Schedule the send', done: false },
];

export default {
  title: 'Components/WhiteboardNote',
  render: ({ title, colour, rows, progress, avatars, comment, titleOnly, freeform }) => {
    const el = document.createElement('np-note');
    el.setAttribute('title', title);
    if (colour) el.setAttribute('colour', colour);
    if (progress) el.setAttribute('progress', progress);
    if (avatars) el.setAttribute('avatars', avatars);
    if (comment) el.setAttribute('comment', comment);
    if (titleOnly) el.setAttribute('title-only', '');
    if (freeform) el.setAttribute('freeform', '');
    el.rows = rows;
    el.style.height = '160px';
    return el;
  },
  argTypes: {
    title: { control: 'text' },
    colour: {
      control: { type: 'select' },
      options: ['#e0e0e0', '#EDB52A', '#108BB9', '#28a745', '#C21D1D', '#7b1fa2'],
    },
    rows: { control: 'object' },
    progress: { control: 'text' },
    avatars: { control: 'text' },
    comment: { control: 'text' },
    titleOnly: { control: 'boolean' },
    freeform: { control: 'boolean' },
  },
  args: {
    title: 'Launch checklist',
    colour: '#EDB52A',
    rows: SAMPLE_ROWS,
    progress: '1/3',
    avatars: 'AB,CD',
    comment: '',
    titleOnly: false,
    freeform: false,
  },
};

export const Default = {};

export const Empty = {
  args: {
    title: 'New note',
    rows: [],
    progress: '',
    avatars: '',
  },
};

export const TitleOnly = {
  args: {
    title: 'Zoomed-out note (title only)',
    titleOnly: true,
  },
};

export const Freeform = {
  args: {
    title: 'Freeform note',
    colour: '#108BB9',
    freeform: true,
    comment: 'Remember to check with the design team before the next review.',
    rows: [],
    progress: '',
    avatars: '',
  },
};

export const DarkAccent = {
  args: {
    title: 'Blocked — needs a decision',
    colour: '#C21D1D',
    rows: [
      { name: 'Confirm budget', done: false },
      { name: 'Get sign-off', done: false },
    ],
    progress: '0/2',
    avatars: 'KM',
  },
};

export const AllComplete = {
  args: {
    title: 'Sprint retro actions',
    colour: '#28a745',
    rows: [
      { name: 'Update the runbook', done: true },
      { name: 'Archive the board', done: true },
    ],
    progress: '2/2',
    avatars: 'AB,CD,EF',
  },
};
