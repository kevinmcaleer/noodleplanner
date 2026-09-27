import './np-detail-sheet.js';
import '../panel-header/np-panel-header.js';

/**
 * The sheet is shown here in a frame the size of the device, standing in for
 * the app's #detailPane, which is what takes the layout (components.css,
 * [data-layout]). The `back` attribute the sheet sets on its header in a
 * full-screen layout is set by the story instead, since Storybook's own
 * <html> is not the app's.
 */
const FRAMES = {
  phone: { width: 390, height: 720, back: true },
  tablet: { width: 768, height: 900, back: true },
  landscape: { width: 600, height: 720, back: false },
  desktop: { width: 600, height: 720, back: false },
};

function field(label, control) {
  const group = document.createElement('div');
  group.className = 'form-group';
  const id = `story-${label.toLowerCase().replace(/\W+/g, '-')}`;
  group.innerHTML = `<label for="${id}">${label}</label>`;
  control.id = id;
  control.classList.add('form-control');
  group.appendChild(control);
  return group;
}

function input(value) {
  const el = document.createElement('input');
  el.type = 'text';
  el.value = value;
  return el;
}

function select(options) {
  const el = document.createElement('select');
  el.innerHTML = options.map((o) => `<option>${o}</option>`).join('');
  return el;
}

function section(key, title, primary, children) {
  const details = document.createElement('details');
  details.className = 'sheet-section';
  details.dataset.section = `story-${key}`;
  if (primary) details.setAttribute('data-primary', '');
  const summary = document.createElement('summary');
  summary.textContent = title;
  details.append(summary, ...children);
  return details;
}

const DetailSheet = {
  title: 'Components/DetailSheet',
  render: ({ device, title, withSections, withDelete }) => {
    const frameSpec = FRAMES[device] || FRAMES.phone;
    const frame = document.createElement('div');
    frame.style.cssText =
      `width: ${frameSpec.width}px; height: ${frameSpec.height}px; max-width: 100%;` +
      'display: flex; border: 1px solid var(--np-border); overflow: hidden;';

    const sheet = document.createElement('np-detail-sheet');
    sheet.className = 'detail-pane-section active';
    sheet.style.flex = '1 1 auto';
    sheet.onClose = () => console.log('np-detail-sheet: the form\'s own close handler ran');

    const header = document.createElement('np-panel-header');
    header.slot = 'header';
    header.setAttribute('variant', 'neutral');
    header.toggleAttribute('back', frameSpec.back);
    const heading = document.createElement('h2');
    heading.slot = 'title';
    heading.textContent = title;
    header.appendChild(heading);
    if (withDelete) {
      const del = document.createElement('button');
      del.type = 'button';
      del.slot = 'overflow';
      del.setAttribute('data-destructive', '');
      del.textContent = 'Delete item';
      del.addEventListener('click', () => console.log('np-detail-sheet: delete'));
      header.appendChild(del);
    }

    const body = document.createElement('div');
    body.className = 'modal-body';
    const fields = [
      field('Title', input('Supplier may miss the June delivery')),
      field('Type', select(['Risk', 'Action', 'Issue', 'Decision', 'Dependency'])),
    ];
    if (withSections) {
      body.append(
        ...fields,
        section('schedule', 'Schedule', true, [field('Due', input('2026-06-12'))]),
        section('people', 'People', false, [field('Owner', input('@alex'))]),
        section('notes', 'Notes', false, [field('Mitigation', document.createElement('textarea'))]),
      );
    } else {
      body.append(...fields, field('Description', document.createElement('textarea')));
    }

    const footer = document.createElement('div');
    footer.className = 'form-actions';
    footer.slot = 'footer';
    footer.innerHTML =
      '<button type="button" class="btn-secondary">Cancel</button>' +
      '<button type="button" class="btn-primary">Save</button>';

    sheet.append(header, body, footer);
    frame.appendChild(sheet);
    return frame;
  },
  argTypes: {
    device: { control: { type: 'select' }, options: Object.keys(FRAMES) },
    title: { control: 'text' },
    withSections: { control: 'boolean' },
    withDelete: { control: 'boolean' },
  },
  args: {
    device: 'phone',
    title: 'Edit RAID Item',
    withSections: false,
    withDelete: true,
  },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The one shell every form in the detail pane shares (#1383): a header (an ' +
          '`<np-panel-header>` in `slot="header"`), a body that scrolls, and a footer that holds the ' +
          'main action (`slot="footer"`). Escape, a backdrop tap, the header\'s × or ← all run the ' +
          'form\'s own close handler (`onClose`, or the global named by `close-action`). The pane ' +
          'is full screen on a phone and an upright tablet, where × becomes ← Back; a 600px sheet ' +
          'in landscape; the side pane on a desktop. Secondary actions such as Delete live in ' +
          'the header\'s ⋯ menu.',
      },
    },
  },
};

export default DetailSheet;

export const OnAPhone = {
  name: 'On a phone',
};

export const OnAnUprightTablet = {
  name: 'On an upright tablet',
  args: { device: 'tablet' },
};

export const InLandscape = {
  name: 'In landscape (a 600px sheet)',
  args: { device: 'landscape' },
};

export const OnADesktop = {
  name: 'On a desktop (the side pane)',
  args: { device: 'desktop' },
};

export const WithSections = {
  name: 'With collapsible sections',
  args: { withSections: true, title: 'Research' },
  parameters: {
    docs: {
      description: {
        story:
          '`<details class="sheet-section" data-section>` groups of fields. Each remembers ' +
          'whether it was left open; until then a phone opens only the ones marked ' +
          '`data-primary` and every other layout opens them all.',
      },
    },
  },
};
