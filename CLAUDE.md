# CLAUDE.md — Notes for AI-assisted development

## Project overview

NoodlePlanner is a browser-based project planning tool. The main app is a
FastAPI backend (`packages/noodle-web`) serving a single-page HTML/JS frontend.
Documentation is built with Sphinx and lives in `docs/`.

## Key directories

- `packages/noodle-web/src/noodle_web/` — web app (templates, static assets, API)
- `docs/` — Sphinx documentation (tutorials, how-to, reference, explanation)
- `tests/` — pytest test suite including Selenium usability tests

## Documentation screenshots

Screenshots used in the Sphinx docs are stored in `docs/_static/img/` and are
captured automatically by `docs/capture_screenshots.py`.

**When to re-capture:** after any change to the UI layout, navigation, views,
or front-matter handling, run:

```bash
cd docs && make screenshots
```

This requires a running NoodlePlanner instance at `http://localhost:8007`
(or pass `--base-url` to the script).

The screenshot script uses headless Chrome via Selenium — the same setup as
`tests/test_usability.py`.

## Running the tests

The browser-driven suites are the slow ones -- minutes against seconds for
everything else -- so they are **deselected by default**, matching the
selection in `ci/jobs/python.sh`:

```bash
uv run pytest                  # everything except the browser suites (~8s)
uv run pytest -m usability     # the Selenium suite
uv run pytest tests/ui         # the Playwright suite
uv run pytest -m ""            # everything
npm run test:js                # the JS/engine suite
```

The browser tests are mid-migration from Selenium to Playwright: the ported
ones live in `tests/ui/` (marker `ui`), the rest still carry
`@pytest.mark.usability`. A `-m` on the command line overrides the default,
which is how the `ci/jobs/*.sh` scripts each select their own suite --
`ci/run.sh` runs them the way CI does.

Run the fast suite constantly; run the browser suites before pushing
anything that touches the UI, and remember a green `uv run pytest` alone has
not exercised the browser.

## UI and design system

The design tokens live in
`packages/noodle-web/src/noodle_web/static/visual-system.css` and nowhere else.
Before pushing a change that touches CSS, run the two design gates:

```bash
npm run lint:design      # hardcoded colours, off-scale spacing, focus, token placement
npm run check:contrast   # WCAG AA across every token pairing the app renders
```

Both are in CI as the gating `design` job. The linter is a ratchet against
`ci/design-system-baseline.json`: it tolerates the ~1,950 existing violations
and fails only on new ones, so a clean push cannot be blocked by pre-existing
debt.

`docs/design/contributing.md` explains the rules and when a raw value is
legitimate. `/components` serves a gallery of every component in both themes.

## Reminders

- **Update screenshots when features change.** If you modify a view, add a
  navigation element, or change the editor, re-run `make screenshots` so the
  docs stay accurate. Check the RST files under `docs/` for `.. figure::`
  directives that reference screenshots.
