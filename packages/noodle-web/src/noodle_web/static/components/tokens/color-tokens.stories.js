import colorLight from '@design-tokens/color-light.json';
import colorDark from '@design-tokens/color-dark.json';

/**
 * Renders the exact colour tokens from docs/design/tokens/color-light.json
 * and color-dark.json — the W3C Design Tokens JSON that Penpot imports
 * natively (Design -> Tokens -> Import), generated from
 * visual-system.css by scripts/token-audit.mjs (see
 * docs/design/consolidation-and-handoff.md's "Penpot" section).
 *
 * This is a read-only reference, not a themed component: it renders the
 * light and dark value of every token side by side from the JSON data
 * itself, rather than resolving `--np-*` custom properties live, so it
 * stays true to what Penpot actually has even if a story's own page isn't
 * running under the `data-theme` toggle.
 */

function buildPage() {
  const names = Object.keys(colorLight).sort((a, b) => a.localeCompare(b));

  const container = document.createElement('div');
  container.style.fontFamily = "var(--np-font-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif)";
  container.style.padding = '20px';

  const intro = document.createElement('p');
  intro.style.maxWidth = '640px';
  intro.style.marginBottom = '16px';
  intro.style.color = 'var(--np-muted, #6c757d)';
  intro.style.fontSize = '13px';
  intro.innerHTML =
    'Source: <code>docs/design/tokens/color-light.json</code> / <code>color-dark.json</code> — ' +
    'the same files Penpot imports (Design &rarr; Tokens &rarr; Import). Generated from ' +
    '<code>visual-system.css</code> by <code>scripts/token-audit.mjs</code>; edit the CSS, not this page.';
  container.appendChild(intro);

  const filter = document.createElement('input');
  filter.type = 'search';
  filter.placeholder = `Filter ${names.length} tokens by name…`;
  filter.style.width = '100%';
  filter.style.maxWidth = '320px';
  filter.style.padding = '8px 12px';
  filter.style.marginBottom = '20px';
  filter.style.border = '1px solid var(--np-border, #ced4da)';
  filter.style.borderRadius = 'var(--np-radius-sm, 4px)';
  filter.style.font = 'inherit';
  filter.style.fontSize = '14px';
  filter.style.boxSizing = 'border-box';
  container.appendChild(filter);

  const grid = document.createElement('div');
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(200px, 1fr))';
  grid.style.gap = '12px';
  container.appendChild(grid);

  const cards = names.map((name) => {
    const card = document.createElement('div');
    card.dataset.tokenName = name;
    card.style.border = '1px solid var(--np-border, #e9ecef)';
    card.style.borderRadius = 'var(--np-radius-md, 6px)';
    card.style.overflow = 'hidden';
    card.style.background = 'var(--np-surface, #fff)';

    const swatches = document.createElement('div');
    swatches.style.display = 'flex';
    swatches.style.height = '56px';

    for (const [label, tokens] of [['Light', colorLight], ['Dark', colorDark]]) {
      const half = document.createElement('div');
      half.style.flex = '1';
      half.style.background = tokens[name]?.$value || 'transparent';
      half.title = `${label}: ${tokens[name]?.$value}`;
      swatches.appendChild(half);
    }
    card.appendChild(swatches);

    const body = document.createElement('div');
    body.style.padding = '8px 10px';

    const title = document.createElement('div');
    title.textContent = name;
    title.style.fontFamily = "var(--np-font-data, 'IBM Plex Mono', monospace)";
    title.style.fontSize = '12px';
    title.style.fontWeight = '600';
    title.style.color = 'var(--np-ink, #23201c)';
    title.style.overflow = 'hidden';
    title.style.textOverflow = 'ellipsis';
    title.style.whiteSpace = 'nowrap';
    body.appendChild(title);

    const values = document.createElement('div');
    values.style.display = 'flex';
    values.style.justifyContent = 'space-between';
    values.style.fontSize = '11px';
    values.style.color = 'var(--np-muted, #6c757d)';
    values.style.marginTop = '2px';
    values.innerHTML = `<span>${colorLight[name].$value}</span><span>${colorDark[name].$value}</span>`;
    body.appendChild(values);

    card.appendChild(body);
    grid.appendChild(card);
    return card;
  });

  filter.addEventListener('input', () => {
    const query = filter.value.trim().toLowerCase();
    for (const card of cards) {
      card.hidden = query.length > 0 && !card.dataset.tokenName.includes(query);
    }
  });

  return container;
}

export default {
  title: 'Design Tokens/Colours',
  parameters: {
    layout: 'fullscreen',
  },
};

export const AllTokens = {
  render: () => buildPage(),
};
