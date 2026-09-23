## What and why

<!-- What this changes, and the issue it closes. -->

## How it was checked

<!-- The commands you ran and what they showed. `ci/run.sh` runs what CI runs. -->

## Review checklist

- [ ] Tests cover the change, and `uv run pytest` passes.
- [ ] Touches the UI → the browser suites were run (`uv run pytest tests/ui`), and docs screenshots are re-captured if a view changed (`cd docs && make screenshots`).

**Design system** — only if this touches CSS, templates, or markup built in JS. See [`docs/design/contributing.md`](../docs/design/contributing.md).

- [ ] New colours, spacing, radii and shadows use a `--np-*` token, or have a reason recorded in the linter's `ALLOW` list. No new `--np-*` token is declared outside `visual-system.css`.
- [ ] `npm run lint:design` passes. If this change lowers the baseline, it is re-baselined in this PR; if it raises it, the reason is written above.
- [ ] `npm run check:contrast` passes, and any new text or control is legible in **both** themes.
- [ ] Anything that removes a focus outline puts a visible replacement in its place.
- [ ] A new component, or a new variant, is added to `static/component-gallery.js`, which puts it on `/components` and in Storybook, rather than living only in the view that uses it.
