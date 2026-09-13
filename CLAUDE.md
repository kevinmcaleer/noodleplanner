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

The suite is split in two. The Selenium tests drive a real headless Chrome
and take ~13 minutes; everything else takes ~8 seconds. The browser tests
carry `@pytest.mark.usability` and are **deselected by default**:

```bash
uv run pytest                  # everything except the browser tests (~8s)
uv run pytest -m usability     # only the browser tests (~13min)
uv run pytest -m ""            # everything
```

Run the fast suite constantly; run `-m usability` before pushing anything
that touches the UI, and remember a green `uv run pytest` alone has not
exercised the browser.

## Reminders

- **Update screenshots when features change.** If you modify a view, add a
  navigation element, or change the editor, re-run `make screenshots` so the
  docs stay accurate. Check the RST files under `docs/` for `.. figure::`
  directives that reference screenshots.
