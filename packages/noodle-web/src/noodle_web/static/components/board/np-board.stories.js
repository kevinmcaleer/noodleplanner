import './np-board.js';

const SAMPLE_COLUMNS = [
  {
    title: 'To Do',
    colour: '#6c757d',
    cards: [
      { title: 'Write the project brief', duration: '1 day', tags: 'Planning' },
      { title: 'Book kickoff meeting', resources: 'AB' },
    ],
  },
  {
    title: 'In Progress',
    colour: 'linear-gradient(135deg, #108BB9 0%, #0d7096 100%)',
    cards: [
      {
        title: 'Design the onboarding flow',
        duration: '3 days',
        comment: 'Waiting on user research findings.',
        tags: 'UX, Design',
        resources: 'AB,CD',
        percent: 40,
      },
      {
        title: 'Implement API rate limiting',
        duration: '2 days',
        resources: 'JS',
        percent: 65,
      },
    ],
  },
  {
    title: 'Done',
    colour: '#28a745',
    cards: [
      { title: 'Ship the landing page redesign', tags: 'Marketing', percent: 100 },
    ],
  },
  {
    title: 'Blocked',
    colour: '#C21D1D',
    cards: [],
  },
];

export default {
  title: 'Components/Board',
  render: ({ columns, showAddColumn }) => {
    const el = document.createElement('np-board');
    el.columns = columns;
    if (showAddColumn) el.setAttribute('show-add-column', '');
    return el;
  },
  argTypes: {
    columns: { control: 'object' },
    showAddColumn: { control: 'boolean' },
  },
  args: {
    columns: SAMPLE_COLUMNS,
    showAddColumn: false,
  },
};

export const Default = {};

export const WithAddColumn = {
  args: { showAddColumn: true },
};

export const Empty = {
  args: {
    columns: [
      { title: 'To Do', cards: [] },
      { title: 'In Progress', cards: [] },
      { title: 'Done', cards: [] },
    ],
  },
};

export const SingleColumn = {
  args: {
    columns: [SAMPLE_COLUMNS[1]],
  },
};
