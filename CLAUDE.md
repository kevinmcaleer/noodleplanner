# CLAUDE.md — Notes for AI-assisted development

## Project overview

NoodlePlanner is a browser-based project planning tool. The main app is a
FastAPI backend (`packages/noodle-web`) serving a single-page HTML/JS frontend.
Documentation is built with Sphinx and lives in `docs/`.

## Key directories

- `packages/noodle-web/src/noodle_web/` — web app (templates, static assets, API)
- `docs/` — Sphinx documentation (tutorials, how-to, reference, explanation)
- `tests/` — pytest test suite including Selenium usability tests

## Working on a goal: always use a worktree

**Never do the work in the primary checkout itself** — `/home/kev/noodleplanner`
on the deployment host, or wherever the clone lives in a cloud or CI session.
When you pick up a goal, an issue, or any change beyond a read, create your own
worktree first:

```bash
cd /home/kev/noodleplanner
git fetch origin
git worktree add /home/kev/noodleplanner-worktrees/<name> -b <type>/<issue>-<slug> origin/main
cd /home/kev/noodleplanner-worktrees/<name>
ln -s /home/kev/noodleplanner/node_modules node_modules
```

Two independent reasons, both of which have bitten real sessions:

1. **On the deployment host, that checkout is live production.**
   `docker-compose.yml` bind-mounts `./packages` and `./templates` into the
   running `noodleplanner` container, which serves with `--reload
   --reload-dir /app/packages`. Any edit to a tracked file under those paths —
   even uncommitted, even on a feature branch — is served to real traffic
   immediately. There is no review step between your editor and the site. A
   cloud or CI checkout has no such container, so this reason does not apply
   there; the second one still does.
2. **`main` moves fast.** Branches cut from a stale `origin/main` drift far
   enough that the work has to be rebuilt. One session branched, built a
   feature, opened a PR, and only discovered at merge time that `main` had
   moved 81 commits and another PR had already rewritten the same file. Always
   `git fetch` immediately before `git worktree add`, and branch from
   `origin/main`, not from a local `main` that may be behind.

Branch naming follows the repo's history: `feat/842-msproject-sync-preserve-sections`,
`fix/minimal-timeline-sub-summary-parent-rows`, `docs/cloudflare-tunnel-credentials`.

### Check for drift before you push

`main` can move underneath you mid-task. Before opening a PR:

```bash
git fetch origin && git rev-list --left-right --count origin/main...HEAD
```

The left number is how far behind you are. If it is not small, merge
`origin/main` in and re-test **before** pushing — a green PR built on a stale
base can still be wrong, because CI only checks the merge, not whether someone
has since rewritten what you touched.

### Traps in a worktree

- **`git add -A` stages the `node_modules` symlink.** `.gitignore` has
  `node_modules/` with a trailing slash, which does not match a symlink of that
  name. Check `git status --short` for an `A node_modules` line before
  committing.
- **Run your own server on a non-8007 port.** 8007 is the production
  container. Start uvicorn from the worktree with `uv run`, so it serves the
  worktree's static files rather than the primary checkout's.
- **Don't symlink `.venv` from the primary checkout.** `uv run` creates the
  worktree its own environment and installs `noodle_core` and `noodle_web`
  editable against *that* worktree's paths, so `uv run pytest` exercises your
  source. A hand-symlinked `.venv` points its editable installs back at the
  primary checkout, and the suite then silently tests `main`'s Python rather
  than yours. If you have inherited one, either delete it and let `uv` rebuild,
  or prefix the run:

  ```bash
  PYTHONPATH="$(pwd)/packages/noodle-core/src:$(pwd)/packages/noodle-web/src" pytest
  ```

  `ci/lib.sh` does the same thing unconditionally, so `ci/run.sh` and the
  `ci/jobs/*.sh` scripts are already safe from this whichever way your
  environment was built.

- **Compare test failures against `main` before blaming your change.** The
  suite has pre-existing failures, and the browser suites are the usual
  offenders. Run the same files on a clean `main` checkout and diff the
  failure sets. See "Running the tests" below for which suites run by default.

### When it is merged

```bash
git worktree remove /home/kev/noodleplanner-worktrees/<name>
git branch -d <branch>
```

Leave the primary checkout on a clean `main` at all times.

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
npm run lint:design      # hardcoded colours and fonts, off-scale spacing, focus, token placement
npm run check:contrast   # WCAG AA across every token pairing the app renders
```

Both are in CI as the gating `design` job. The linter is a ratchet against
`ci/design-system-baseline.json`: it tolerates whatever violations that file
already records and fails only on new ones, so a clean push cannot be blocked
by pre-existing debt. The count is deliberately not quoted here — it only goes
down, and a number in prose is wrong the first time someone pays some off.
`npm run lint:design` prints the current figure.

`docs/design/contributing.md` explains the rules and when a raw value is
legitimate. `/components` serves a gallery of every component in both themes.
Storybook renders the same gallery plus a story that forces every base control
into its hover, focus and disabled states. `ci/run.sh storybook` builds it and
renders every story, and it is a gating CI job too.

## Reminders

- **Work in a worktree, never in the primary checkout.** See the section
  above — on the deployment host that checkout is bind-mounted into the live
  production container, and `main` moves fast enough that a stale branch means
  rework.
- **Update screenshots when features change.** If you modify a view, add a
  navigation element, or change the editor, re-run `make screenshots` so the
  docs stay accurate. Check the RST files under `docs/` for `.. figure::`
  directives that reference screenshots.
