import './np-quick-add.js';

// A stand-in for the page's preview: the app reads the plan's own tokenizer
// (task-tokenizer.js); the story recognises enough of the grammar to show the
// chips.
const preview = (text) => {
  const chips = [];
  for (const [kind, kindLabel, pattern] of [
    ['resource', 'Who', /@\w+/g],
    ['duration', 'Takes', /\b\d+[dwmy]\b/g],
    ['date', 'Starts', /\b\d{4}-\d{2}-\d{2}\b/g],
    ['percent', 'Done', /\b\d{1,3}%/g],
  ]) {
    for (const match of text.match(pattern) || []) chips.push({ kind, kindLabel, label: match });
  }
  return chips;
};

const QuickAdd = {
  title: 'Components/QuickAdd',
  render: ({ placeholder, value }) => {
    const frame = document.createElement('div');
    frame.style.cssText = 'width: 390px; max-width: 100%; border: 1px solid var(--np-border);';
    const field = document.createElement('np-quick-add');
    if (placeholder) field.setAttribute('placeholder', placeholder);
    field.preview = preview;
    field.value = value || '';
    field.addEventListener('quickadd', (e) => console.log('np-quick-add: quickadd', e.detail.text));
    frame.appendChild(field);
    return frame;
  },
  argTypes: {
    placeholder: { control: 'text' },
    value: { control: 'text' },
  },
  args: { placeholder: 'Add a task to Design…', value: '' },
  parameters: {
    docs: {
      description: {
        component:
          'A field at the foot of the plan list on a phone (#1385). What is typed is a task line in ' +
          'the plan\'s own grammar, so `Design review @alex 2d 2026-10-02` sets the resource, duration ' +
          'and start date; chips show what was recognised before it is added. Enter or the + button ' +
          'fires `quickadd`.',
      },
    },
  },
};
export default QuickAdd;

export const Empty = {};
export const WithTokens = {
  name: 'Recognising tokens',
  args: { value: 'Design review @alex 2d 2026-10-02' },
};
