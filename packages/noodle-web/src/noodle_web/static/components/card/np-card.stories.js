import './np-card.js';

export default {
  title: 'Components/Card',
  render: ({ title, duration, comment, tags, resources, percent, checked, dragging }) => {
    const el = document.createElement('np-card');
    el.setAttribute('title', title);
    if (duration) el.setAttribute('duration', duration);
    if (comment) el.setAttribute('comment', comment);
    if (tags) el.setAttribute('tags', tags);
    if (resources) el.setAttribute('resources', resources);
    if (percent !== '' && percent !== undefined && percent !== null) {
      el.setAttribute('percent', String(percent));
    }
    if (checked) el.setAttribute('checked', '');
    if (dragging) el.setAttribute('dragging', '');
    el.style.maxWidth = '320px';
    return el;
  },
  argTypes: {
    title: { control: 'text' },
    duration: { control: 'text' },
    comment: { control: 'text' },
    tags: { control: 'text' },
    resources: { control: 'text' },
    percent: { control: { type: 'range', min: 0, max: 100 } },
    checked: { control: 'boolean' },
    dragging: { control: 'boolean' },
  },
  args: {
    title: 'Design the onboarding flow',
    duration: '3 days',
    comment: 'Waiting on user research findings before final pass.',
    tags: 'UX, Design',
    resources: 'AB,CD',
    percent: undefined,
    checked: false,
    dragging: false,
  },
};

export const Default = {
  args: {
    title: 'Draft release notes',
    duration: '1 day',
    comment: '',
    tags: '',
    resources: '',
    percent: undefined,
  },
};

export const WithProgress = {
  args: {
    title: 'Migrate billing service',
    duration: '5 days',
    comment: 'Blocked on infra review.',
    tags: 'Backend, Infra',
    resources: 'JS,KM',
    percent: 40,
  },
};

export const Complete = {
  args: {
    title: 'Ship the landing page redesign',
    duration: '2 days',
    tags: 'Marketing',
    resources: 'KM',
    percent: 100,
  },
};

export const Checked = {
  args: {
    title: 'Review pull request #1188',
    duration: '',
    tags: '',
    resources: 'AB',
    percent: undefined,
    checked: true,
  },
};

export const ManyResourcesAndTags = {
  args: {
    title: 'Coordinate cross-team launch checklist',
    duration: '2 weeks',
    comment: 'Touches every squad — keep the checklist visible.',
    tags: 'Launch, Cross-team, Priority',
    resources: 'AB,CD,EF,GH,IJ,KL',
    percent: 65,
  },
};

export const Dragging = {
  args: {
    title: 'Card mid-drag between columns',
    duration: '1 day',
    dragging: true,
  },
};
