import './np-responsive-table.js';

const ROWS = [
  { id: 'R1', type: 'Risk', title: 'Supplier slips on the June delivery', owner: 'Sam', score: 12, status: 'Open', description: 'Parts for the pilot arrive late.' },
  { id: 'I2', type: 'Issue', title: 'Budget overrun on hosting', owner: 'Jo', score: 15, status: 'Open', description: 'The quote came in 20% over.' },
  { id: 'D3', type: 'Decision', title: 'Go with vendor B', owner: '', score: 1, status: 'Closed', description: '' },
];

/** A RAID-log-shaped table, with the app's own badge classes in its cells. */
function table() {
  const el = document.createElement('table');
  el.className = 'raid-table';
  el.innerHTML = `
    <thead><tr>
      <th data-priority="none">ID</th>
      <th data-priority="2">Type</th>
      <th data-priority="primary">Title</th>
      <th>Description</th>
      <th>Owner</th>
      <th data-priority="3">Score</th>
      <th data-priority="1">Status</th>
    </tr></thead>
    <tbody>${ROWS.map((row) => `
      <tr>
        <td>${row.id}</td>
        <td><span class="raid-type-badge raid-type-${row.type.toLowerCase()}">${row.type}</span></td>
        <td>${row.title}</td>
        <td>${row.description}</td>
        <td>${row.owner}</td>
        <td>${row.score}</td>
        <td><span class="raid-status-badge raid-status-${row.status.toLowerCase()}">${row.status}</span></td>
      </tr>`).join('')}
    </tbody>`;
  el.addEventListener('click', (event) => {
    const row = event.target.closest('tbody tr');
    if (row) console.log('np-responsive-table: row click', row.cells[2].textContent.trim());
  });
  return el;
}

const ResponsiveTable = {
  title: 'Components/ResponsiveTable',
  render: ({ stack, width }) => {
    const frame = document.createElement('div');
    frame.style.cssText = `width: ${width}px; max-width: 100%;`;
    const host = document.createElement('np-responsive-table');
    if (stack) host.setAttribute('stack', 'always');
    host.appendChild(table());
    frame.appendChild(host);
    return frame;
  },
  argTypes: {
    stack: { control: 'boolean' },
    width: { control: { type: 'number' } },
  },
  args: { stack: true, width: 390 },
  parameters: {
    docs: {
      description: {
        component:
          'A wide table that becomes a stack of cards on a phone (#1387). Each column declares its ' +
          'priority on its header: `primary` is the card\'s title, `1`-`3` the meta line under it, ' +
          'the rest open on ▾, and `none` is never on a card. The cards are the table\'s own rows ' +
          'restyled, so a row\'s click (opening the item in its detail sheet), its menu and its ' +
          'buttons all keep working.',
      },
    },
  },
};
export default ResponsiveTable;

export const OnAPhone = { name: 'On a phone (stacked)' };

export const OneCardOpen = {
  name: 'A card opened',
  render: (args, context) => {
    const frame = ResponsiveTable.render(args, context);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const button = frame.querySelector('.np-rt-expand');
      if (button) button.click();
    }));
    return frame;
  },
};

export const OnADesktop = {
  name: 'On a desktop (a table)',
  args: { stack: false, width: 900 },
};
