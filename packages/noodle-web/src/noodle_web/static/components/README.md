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

Nothing under `static/components/` is wired into the live app yet — this
is a pilot (`components/button/`) proving the extraction pattern, not a
migration. To use one:

```html
<script type="module" src="/static/components/button/np-button.js"></script>
<np-button variant="primary">Save</np-button>
```

Swapping the ~130 existing `.btn-primary` / `.btn-secondary` / `.btn-danger`
usages across `templates/index.html` and the view CSS over to `<np-button>`
is deliberately out of scope here — see the "Storybook" section of
`docs/design/consolidation-and-handoff.md` for the state of that work and
what extracting the next component should look like.
