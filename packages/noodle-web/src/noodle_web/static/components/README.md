# Component modules

This directory holds real, reusable UI pieces extracted out of the
monolithic `templates/index.html` / `static/script.js` — the opposite of
how the rest of the app works today (see the root `CLAUDE.md` and
`docs/design/consolidation-and-handoff.md` for that history).

Each component is a folder containing:

- `<name>.js` — a framework-free Web Component (`customElements.define`).
  Styles live in a shadow root; only CSS custom properties (the `--np-*`
  design tokens from `static/visual-system.css`) cross that boundary, so a
  component never depends on a global class name.
- `<name>.stories.js` — a Storybook CSF3 story for it.

## Running Storybook

```sh
npm install
npm run storybook          # dev server on http://localhost:6006
npm run build-storybook    # static build to storybook-static/ (gitignored)
```

Config lives in `.storybook/` at the repo root. `preview.mjs` imports the
same token stylesheets `templates/index.html` links
(`base.css` → `dark-mode.css` → `visual-system.css`), and a toolbar toggle
switches `data-theme` so components preview in both themes.

## Using a component in the app

Nothing under `static/components/` is wired into the live app yet — these
are pilots proving the extraction pattern, not a migration. To use one:

```html
<script type="module" src="/static/components/button/np-button.js"></script>
<np-button variant="primary" size="small">Save</np-button>
<np-button variant="neutral">Back</np-button>
<np-button variant="danger" outline>Remove</np-button>

<script type="module" src="/static/components/card/np-card.js"></script>
<np-card title="Design the onboarding flow" duration="3 days"
         resources="AB,CD" tags="UX, Design" percent="40"></np-card>

<script type="module" src="/static/components/board/np-board.js"></script>
<np-board></np-board>
<script type="module">
  document.querySelector('np-board').columns = [
    { title: 'To Do', cards: [{ title: 'Plan the sprint' }] },
    { title: 'In Progress', colour: '#108BB9', cards: [] },
  ];
</script>

<script type="module" src="/static/components/note/np-note.js"></script>
<np-note title="Launch checklist" colour="#EDB52A" progress="1/3"
         avatars="AB,CD"></np-note>
<script type="module">
  document.querySelector('np-note').rows = [
    { name: 'Draft copy', done: true },
    { name: 'Review with legal', done: false },
  ];
</script>

<script type="module" src="/static/components/panel-header/np-panel-header.js"></script>
<np-panel-header title="Task Name" editable>
  <button slot="actions">🔍 Inspect</button>
</np-panel-header>
<np-panel-header title="Status Message Log" variant="neutral"></np-panel-header>

<script type="module" src="/static/components/empty-state/np-empty-state.js"></script>
<np-empty-state>No upcoming milestones.</np-empty-state>
<np-empty-state variant="card" heading="RAID Log">
  <p>Track Risks, Actions, Issues, Decisions, and Dependencies.</p>
  <button slot="actions">+ Add Item</button>
</np-empty-state>
```

`<np-board>` composes `<np-card>` internally for each column's cards, the
same relationship `.kanban-board` / `.kanban-card` have in
`static/views/kanban.css` and `static/kanban-board.js`. `<np-note>`
extracts `.wb-note-card` from `static/views/whiteboard.css` /
`static/whiteboard-notes.js` — the whiteboard's post-it note, including
its `title-only` (zoomed-out) and `freeform` (no checklist) variants.
`<np-panel-header>` reconciles `.detail-pane-header` and `.modal-header`
(components.css) into one header, with `variant="accent"` /
`variant="neutral"` standing in for the tone the two diverged on.
`<np-empty-state>` consolidates the 19 per-area `*-empty-state` classes
(`.raid-empty-state`, `.kanban-empty-state`, `.wb-empty-state`, …) into
one component with a `variant="text"` / `variant="card"` tier and
optional icon/heading/actions slots — not the welcome screen or
`.placeholder-view` family, which are a deliberately separate kind of
"nothing here" (see design-system.md §6).

Swapping the existing `.btn-primary` / `.kanban-card` / `.wb-note-card`
usages across `templates/index.html` and the view CSS over to these
components is deliberately out of scope here — see the "Storybook" section
of `docs/design/consolidation-and-handoff.md` for the state of that work
and what extracting the next component should look like.
